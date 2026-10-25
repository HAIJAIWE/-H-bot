// src/main/services/agent-core/core.ts
//
// **agent-core 骨架**（2026-10-18，workspace-first 重写的第一步）。
//
// 形态对齐主流 harness（DSH / Claude Code）：
//   模型 → 调工具（读写文件 / 跑命令）→ 看结果 → 再调 → 直到给出最终回答。
// 与旧链路的区别：动作空间是**工作区**，不是 40 个领域 schema 工具。
//
// 这一版只包含：单循环 + 路径沙箱 + 命令白名单 + 写闸门 + 轮数上限。
// 不依赖模型 SDK（模型调用由外部注入），所以可以离线测完整循环。
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { AgentServices } from './contracts'
import {
  classifyToolFailure,
  toolFailureForCode,
  type ToolFailureCode,
} from '@shared/ai/toolFailure'
import { runInSandbox } from './sandbox'
import { runToolGroup } from './scheduler'
import { parseFlow } from '../ai/flowIndex'
import { normalizeFlow, validateFlow } from '@shared/nodes/flowNormalize'
import { applyCompaction, type CompactionOptions, type CompactionOutcome } from './contextGate'
import { MAX_TOOL_OUTPUT_CHARS, modelFacingOutput } from './toolOutput'
import { TODO_TOOL } from './todoTool'

export { MAX_TOOL_OUTPUT_CHARS, clampToolOutput } from './toolOutput'

export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  /**
   * 用户贴的图（data URL，只有 user 回合会带）。
   *
   * 循环自己从不产生图片 —— 它只负责把这一轮的要求原样带过去；真正把它们
   * 翻成 provider 的多段 content 是 modelAdapter（见 apiContentOf）。
   */
  images?: readonly string[]
  name?: string
}
/**
 * 一批工具调用里最多几个同时在跑（默认 10，与 DSH 的 `maxParallelToolCalls` 默认值一致；1 = 全串行）。
 * 只有声明为 query（或显式 executionMode:'parallel'）的调用会进池，其余是屏障。
 */
export const MAX_PARALLEL_TOOL_CALLS_DEFAULT = 10

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}
export interface ModelReply {
  text?: string
  calls?: ToolCall[]
}
export type ModelFn = (messages: ChatTurn[]) => Promise<ModelReply>

/**
 * 需要人点头的动作。
 *
 * ⚠️ `command` 这一类是 2026-10-18 补的：在这之前**只有写文件要审批**，
 * 而白名单里的命令能做的事比写文件更多（`git push`、`npx <任何包>`）——
 * 一个会自己跑命令的循环不该有"不用问"的口子。
 */
export type GateRequest = { kind: 'write'; path: string } | { kind: 'command'; command: string }

export interface ToolContext {
  workspace: string
  signal?: AbortSignal
  /** 动作闸门：返回 false = 拒绝（真实接入时是用户审批；测试里是断言钩子） */
  gate?: (req: GateRequest) => Promise<boolean>
  /**
   * **写盘之前**的钩子（项目内相对路径）：轮次日志靠它记下"改之前是什么样"，
   * 撤回才有依据。不传 = 不记（脚本/测试的默认，无副作用）。
   *
   * 失败不该挡住写入（日志是"能撤销"的增强，不是写入的前置条件）——
   * 调用方自己吞异常，这里只管调用。
   */
  onBeforeWrite?: (relPath: string) => Promise<void>
  /** 命令执行超时（毫秒） */
  commandTimeoutMs?: number
}

export interface Tool {
  name: string
  description: string
  /**
   * 给模型看的参数 JSON Schema。
   *
   * 没有它模型只能猜参数名（2026-10-18 真机验证：第一版把 `properties` 写成空对象，
   * 模型照样瞎猜 —— 能不能猜对全靠运气）。测试里的临时工具可以不填。
   */
  parameters?: Record<string, unknown>
  /**
   * 只读工具：不改盘、不需要审批。
   * 「先计划」模式（planOnly）只放这类工具 —— 光靠提示词约束"只许看"是不可靠的。
   */
  readOnly?: boolean
  /** 工具类别：query = 只读（计划阶段可用），mutation = 会改东西 */
  category?: 'query' | 'mutation'
  /**
   * 批内调度语义（对齐 DSH）：`parallel` 可与同批的只读调用并行，
   * `exclusive` 是屏障（它前后的调用不与它重叠）。不写就按 category 保守推断。
   */
  executionMode?: 'parallel' | 'exclusive'
  /** 单次执行超时（毫秒）；不写就用调用方默认值 */
  timeoutMs?: number
  /**
   * 执行工具。返回纯文本，或带显式 ok/error 的结构化结果（见 ToolRunOutcome）——
   * 后者让「以 [工具失败] 开头的正常文本」不被误判（回归用例见 core.test.ts）。
   */
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolRunOutcome>
}

export const MAX_ROUNDS_DEFAULT = 12

/** 工作区内的相对路径解析：越界一律拒绝（绝对路径也不行） */
export function resolveInWorkspace(workspace: string, rel: unknown): string {
  const raw = String(rel ?? '').trim()
  if (!raw) throw new Error('缺少 path')
  if (isAbsolute(raw)) throw new Error('不允许绝对路径: ' + raw)
  const abs = resolve(workspace, raw)
  const relBack = relative(workspace, abs)
  if (relBack.startsWith('..') || isAbsolute(relBack)) throw new Error('路径越界: ' + raw)
  return abs
}

export interface CommandResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

/**
 * 受控命令执行：白名单 + 禁元字符 + 超时 + 不走 shell。
 *
 * ⚠️ 实现在 `./sandbox.ts`（`runInSandbox` → 当前 SandboxProvider）。
 * 这里曾经自己抄了一份 spawn：两份白名单一起漂移时，换个沙箱实现只影响一半路径 ——
 * 那正是「沙箱 seam」存在的意义被抹掉的典型形态（2026-10-23 合并）。
 */
export function runCommand(input: string, ctx: ToolContext): Promise<CommandResult> {
  return runInSandbox({
    command: input,
    cwd: ctx.workspace,
    ...(ctx.commandTimeoutMs ? { timeoutMs: ctx.commandTimeoutMs } : {}),
  })
}

/* ── 找东西（2026-10-18 补）─────────────────────────────────────────
 *
 * 只有 read_file 的时候，模型想知道"X 定义在哪"只能一个个文件读 —— 这是它最常干的事，
 * 也是上下文烧得最快的地方。工具集里补两个只读的"找"：列目录、按 glob 搜文本。
 * 都不改盘、不需要审批（与 read_file 同一档）。
 */

/** 搜索/列举时永远跳过的目录：它们既不是用户的内容，量还大 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.qqbat'])

/** 一次列举最多给多少条（再多模型也读不完，只是烧上下文） */
export const MAX_LIST_ENTRIES = 200
/** 搜文本最多命中多少行 */
export const MAX_SEARCH_HITS = 80
/** 搜文本时单个文件的最大字节（超过就跳过：二进制/大文件对"找定义"没帮助） */
const MAX_SEARCH_FILE_BYTES = 512 * 1024
/** 搜文本最多扫多少个文件 */
const MAX_SEARCH_FILES = 4000

function globSegmentMatch(name: string, pat: string): boolean {
  if (pat === '**') return true
  const re = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
  return new RegExp('^' + re + '$').test(name)
}

/** 极小的 glob：支持 `*`、`?`、`**`；不含斜杠时只比文件名（与主流习惯一致） */
export function matchGlob(relPath: string, glob: string): boolean {
  const path = relPath.split('\\').join('/')
  const g = glob.trim()
  if (!g) return true
  if (!g.includes('/')) return globSegmentMatch(path.split('/').pop() ?? path, g)
  const parts = path.split('/')
  const pats = g.split('/')
  const memo = new Map<string, boolean>()
  const go = (pi: number, gi: number): boolean => {
    const key = pi + ':' + gi
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let ok: boolean
    if (gi === pats.length) ok = pi === parts.length
    else if (pats[gi] === '**')
      ok =
        go(pi, gi + 1) || // ** 匹配 0 段
        (pi < parts.length && go(pi + 1, gi)) // 或吃掉一段继续
    else ok = pi < parts.length && globSegmentMatch(parts[pi], pats[gi]) && go(pi + 1, gi + 1)
    memo.set(key, ok)
    return ok
  }
  return go(0, 0)
}

/** 工作区里的文件（相对路径，POSIX 分隔符）；按 glob 过滤 */
async function walkFiles(
  workspace: string,
  glob: string | undefined,
  onFile: (rel: string, abs: string) => Promise<void>,
): Promise<void> {
  let seen = 0
  const walk = async (dir: string): Promise<void> => {
    if (seen >= MAX_SEARCH_FILES) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (seen >= MAX_SEARCH_FILES) return
      const abs = join(dir, e.name)
      if (e.name === '.qqbat') {
        /**
         * ⚠️ `.qqbat` 整体跳过，**但溢出的工具结果例外**（`.qqbat/ai-spill/`）：
         * 超长结果的节选里写着"用 search_text 在这份文件里搜关键词" —— 如果这里跳过，
         * 那句指引就是**假的**（模型照做会搜不到）。那些文件不是项目内容，
         * 却是模型自己刚产出的、最需要回查的东西。
         */
        const spill = join(abs, 'ai-spill')
        const info = await stat(spill).catch(() => null)
        if (info?.isDirectory()) await walk(spill)
        continue
      }
      if (SKIP_DIRS.has(e.name)) continue
      if (e.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!e.isFile()) continue
      const rel = relative(workspace, abs).split('\\').join('/')
      if (glob && !matchGlob(rel, glob)) continue
      seen += 1
      await onFile(rel, abs)
    }
  }
  await walk(workspace)
}

export const CORE_TOOLS: Tool[] = [
  {
    name: 'read_file',
    description: '读工作区内的文本文件（大文件请配合 offset/limit 分块读）',
    readOnly: true,
    category: 'query',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工作区内的相对路径，如 src/index.ts' },
        offset: { type: 'number', description: '从第几行开始（1 起，可省略）' },
        limit: { type: 'number', description: '最多读多少行（可省略；省略 = 读到结尾）' },
      },
      required: ['path'],
    },
    async run(args, ctx) {
      const abs = resolveInWorkspace(ctx.workspace, args.path)
      const raw = await readFile(abs, 'utf-8')
      const offset = Math.max(1, Math.floor(Number(args.offset ?? 1)) || 1)
      const limit = Math.floor(Number(args.limit ?? 0)) || 0
      if (offset === 1 && limit <= 0) return raw
      const lines = raw.split('\n')
      const from = Math.min(offset, lines.length + 1) - 1
      const to = limit > 0 ? Math.min(from + limit, lines.length) : lines.length
      const body = lines.slice(from, to).join('\n')
      // 分块读时必须说清"你看到的是哪一段"——否则模型会以为文件就这么长
      return '[第 ' + (from + 1) + '-' + to + ' 行，共 ' + lines.length + ' 行]\n' + body
    },
  },
  {
    name: 'write_file',
    category: 'mutation',
    description: '写工作区内的文本文件（整文件覆盖；必须过写闸门）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工作区内的相对路径' },
        content: { type: 'string', description: '新的完整文件内容' },
      },
      required: ['path', 'content'],
    },
    async run(args, ctx) {
      const abs = resolveInWorkspace(ctx.workspace, args.path)
      const verdict = ctx.gate ? await ctx.gate({ kind: 'write', path: abs }) : true
      if (!verdict) throw new Error('写操作被拒绝（未通过闸门）')
      // 闸门过了才记 before：被拒的写入没有改动，记了反而会让撤回多删一个文件
      if (ctx.onBeforeWrite) {
        try {
          await ctx.onBeforeWrite(String(args.path ?? ''))
        } catch {
          // 记不上就记不上（见 ToolContext.onBeforeWrite 的说明）
        }
      }
      await writeFile(abs, String(args.content ?? ''), 'utf-8')
      return '已写入 ' + String(args.path)
    },
  },
  {
    name: 'run_command',
    category: 'mutation',
    description: '在工作区里跑白名单命令（node / pnpm / git / npx），同步拿回 stdout/stderr',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '整条命令行，如 "pnpm test"' },
      },
      required: ['command'],
    },
    async run(args, ctx) {
      const line = String(args.command ?? '').trim()
      const verdict = ctx.gate ? await ctx.gate({ kind: 'command', command: line }) : true
      if (!verdict) throw new Error('命令被拒绝（未通过闸门）')
      const r = await runCommand(line, ctx)
      return (
        (r.ok ? '' : '[退出码 ' + String(r.code) + ']\n') +
        r.stdout +
        (r.stderr ? '\n[stderr]\n' + r.stderr : '')
      )
    },
  },
  {
    name: 'validate_flow',
    category: 'query',
    description: '校验 .qqbat/flow.json 的结构（端口断开/悬空引用等），返回问题列表',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '流程文件相对路径，默认 .qqbat/flow.json' },
      },
    },
    async run(args, ctx) {
      const rel = String(args.path ?? '.qqbat/flow.json')
      const abs = resolveInWorkspace(ctx.workspace, rel)
      const raw = await readFile(abs, 'utf-8')
      const parsed = parseFlow(raw)
      if (!parsed) return '[无效] 不是合法的 flow.json'
      const { graph } = normalizeFlow(parsed as unknown as Parameters<typeof normalizeFlow>[0])
      const issues = validateFlow(graph)
      if (issues.length === 0) return '没问题（结构校验通过）'
      return issues
        .slice(0, 20)
        .map(
          i =>
            '-' +
            ' [' +
            i.severity +
            '] ' +
            i.message +
            (i.nodeId ? '（节点 ' + i.nodeId + '）' : ''),
        )
        .join('\n')
    },
  },
  {
    name: 'list_dir',
    category: 'query',
    description: '列目录下的条目（子目录以 / 结尾；跳过 node_modules/.git/dist/out/.qqbat）',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工作区内的相对路径，默认 .' },
      },
    },
    async run(args, ctx) {
      const rel = String(args.path ?? '.').trim() || '.'
      const abs = resolveInWorkspace(ctx.workspace, rel)
      const entries = await readdir(abs, { withFileTypes: true })
      const rows = entries
        .filter(e => !SKIP_DIRS.has(e.name))
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
        )
        .slice(0, MAX_LIST_ENTRIES)
        .map(e => (e.isDirectory() ? e.name + '/' : e.name))
      if (rows.length === 0) return '（空目录）'
      const more =
        entries.length > rows.length ? `\n…（还有 ${entries.length - rows.length} 个没列）` : ''
      return rows.join('\n') + more
    },
  },
  {
    name: 'search_text',
    category: 'query',
    description:
      '在工作区里按正则搜文本，返回「文件:行号: 内容」（只读，跳过 node_modules/.git 等）',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式，如 "function\\s+foo"' },
        glob: {
          type: 'string',
          description: '可选：只搜匹配的文件名/路径，如 *.ts 或 src/**/*.tsx',
        },
        ignoreCase: { type: 'boolean', description: '忽略大小写' },
        limit: { type: 'number', description: '最多命中多少行（默认 40，上限 80）' },
      },
      required: ['pattern'],
    },
    async run(args, ctx) {
      const pattern = String(args.pattern ?? '')
      if (!pattern) throw new Error('缺少 pattern')
      let re: RegExp
      try {
        re = new RegExp(pattern, args.ignoreCase ? 'i' : '')
      } catch (e) {
        // 正则写错不是"工具坏了"，是把原因原样告诉模型 —— 它会自己改
        return '[无效正则] ' + (e instanceof Error ? e.message : String(e))
      }
      const limit = Math.min(Math.max(Number(args.limit ?? 40) || 40, 1), MAX_SEARCH_HITS)
      const glob = args.glob ? String(args.glob) : undefined
      const hits: string[] = []
      await walkFiles(ctx.workspace, glob, async (rel, abs) => {
        if (hits.length >= limit) return
        const info = await stat(abs).catch(() => null)
        if (!info || info.size > MAX_SEARCH_FILE_BYTES) return
        const text = await readFile(abs, 'utf-8').catch(() => null)
        if (text === null) return // 二进制/无权限：跳过，别让一次搜索整轮失败
        const lines = text.split('\n')
        for (let i = 0; i < lines.length && hits.length < limit; i += 1) {
          if (re.test(lines[i]))
            hits.push(rel + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 200))
        }
      })
      if (hits.length === 0) return '没有匹配'
      return hits.join('\n') + (hits.length >= limit ? '\n…（命中数达到上限 ' + limit + '）' : '')
    },
  },
]

/**
 * ── 工具注册表（2026-10-18，对齐 DSH 的 `dsh-tools` 缝）──────────────────
 *
 * 循环**不认具体的工具数组**，只认这张表：内置的 6 个在模块加载时注册，
 * 以后要加工具（插件、业务侧、测试）调 `registerTool()` 就行，不用改循环。
 *
 * 现在只是"缝"，还没拆文件：定义仍在本文件里。等 core.ts 接近 800 行时，
 * 把工具实现搬去 `tools.ts`、这里只留注册表 —— 契约不变，调用方一行不改。
 */
const TOOL_REGISTRY = new Map<string, Tool>()

/** 注册一个工具：名字必须是小写下划线（模型要能稳定复述），且不许重名 */
export function registerTool(tool: Tool): void {
  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
    throw new Error('工具名必须是小写字母开头的 snake_case: ' + tool.name)
  }
  if (!tool.description.trim()) throw new Error('工具缺少 description: ' + tool.name)
  if (TOOL_REGISTRY.has(tool.name)) throw new Error('工具重复注册: ' + tool.name)
  TOOL_REGISTRY.set(tool.name, tool)
}

/** 当前可用工具（副本；调用方改数组不影响注册表） */
export function listTools(): Tool[] {
  return [...TOOL_REGISTRY.values()]
}

/**
 * 撤销注册（插件停用 / 卸载用）。幂等。
 * 插件化之后"停用 = 工具真的不在表里"，而不是界面上藏起来 ——
 * 藏起来的工具模型照样能调，那是最糟的一种"看起来停用了"。
 */
export function unregisterTool(name: string): void {
  TOOL_REGISTRY.delete(name)
}

// 内置工具进注册表（必须放在 TOOL_REGISTRY 声明之后：const 有 TDZ）
for (const builtin of CORE_TOOLS) registerTool(builtin)
// todo_write 不在 CORE_TOOLS 里（那 6 个由内置插件认领，插件加载时会校验"一个不漏"），
// 单独注册：它不归任何插件，预设的 plugins 白名单删不掉它。
registerTool(TODO_TOOL)

export interface LoopOptions {
  workspace: string
  /**
   * 开跑前就摆好的对话（系统提示 + 用户要求）。
   *
   * ⚠️ 必须有：2026-10-18 真机验证发现第一版**没有**把 requirement 放进去 ——
   * 第一轮请求的 `messages` 是空数组，厂商直接 400（"last message role"）。
   * 测试里模型是假的，所以那处漏接一直没被发现。
   */
  initialTurns?: ChatTurn[]
  model: ModelFn
  tools?: Tool[]
  maxRounds?: number
  /** 一批里最多同时跑几个工具（默认 10；1 = 全串行，测试与保守模型用） */
  maxParallelToolCalls?: number
  signal?: AbortSignal
  /**
   * **step 边界收输入**：每轮开始前问一次有没有新消息（用户中途插话/纠偏）。
   * 返回 null 表示没有。没有它，运行中用户只能等这一轮跑完。
   */
  inbox?: () => ChatTurn | null
  /**
   * **步边界**（每轮"问模型"之前一次）：step 从 1 开始，maxSteps 是本轮上限。
   * 界面据此显示"第 N/M 步"—— 与工具行不同，它描述的是"这一轮在第几步"，不是某次工具。
   */
  onStep?: (info: { step: number; maxSteps: number }) => void
  gate?: ToolContext['gate']
  /** 写盘之前的钩子（轮次日志用；不传 = 不记） */
  onBeforeWrite?: ToolContext['onBeforeWrite']
  /** 五个服务（沙箱/审批/上下文/会话/观测）；给了就用，没给走默认实现 */
  services?: AgentServices
  commandTimeoutMs?: number
  /**
   * 工具**开始**执行（流式界面靠它先摆一行"运行中"）。
   *
   * 没有它的话，界面只能等整轮跑完才看到工具行 —— 一次十几秒的循环在用户眼里
   * 就是"什么都没发生"（2026-10-18 真机：一轮 150 秒，只看到一个计时器在跳）。
   */
  onToolStart?: (call: ToolCall) => void
  /** 工具**结束**（输出／失败原因；ok 显式给出时以它为准，没给看前缀；failure 是结构化分类） */
  onToolResult?: (
    call: ToolCall,
    output: string,
    ok?: boolean,
    failure?: import('@shared/ai/toolFailure').ToolFailure,
  ) => void
  /**
   * 单个工具结果回灌给模型的**字符上限**（默认 24k，约 8k token）。
   * 超了保留头尾、中间标明省略了多少 —— 见 clampToolOutput 的理由。
   */
  maxToolOutputChars?: number
  /**
   * 溢出存储：把**完整**工具结果落盘，返回可读路径（失败返回 undefined）。
   *
   * 契约照抄 `ai/spillStore`：**绝不抛错**。返回 undefined 时按 fail-open 处理 ——
   * **不裁**（宁可上下文大一点，也不给一个没有出路的省略，与助手链路同一条规则）。
   */
  spill?: (toolName: string, text: string) => Promise<string | undefined>
  /**
   * 每轮问模型前过一道上下文闸门（见 `./contextGate`）：默认不开，开了就按预算压中段。
   * 跨轮历史由调用方裁（historyNote），这里管的是**同一轮里**只增不减的 messages。
   */
  compaction?: CompactionOptions
  /** 真的压了才回调（没超预算不会打扰调用方） */
  onCompact?: (info: CompactionOutcome) => void
}

/**
 * 循环阶段（对齐主流 harness 的 Phase）：
 * idle → running(step) → finished(reason)。
 * 单独成型是为了可测：结束原因由状态机决定，不靠散落的 break 推断。
 */
export type LoopPhase =
  | { kind: 'idle' }
  | { kind: 'running'; step: number }
  | { kind: 'finished'; reason: 'completed' | 'max-rounds' | 'cancelled' }

export interface LoopResult {
  finalText: string
  rounds: number
  /** 每个工具调用的输出（诊断/断言用） */
  toolResults: Array<{
    name: string
    args: Record<string, unknown>
    output: string
    failure?: import('@shared/ai/toolFailure').ToolFailure
  }>
  /** 结束时处在哪个阶段（completed / max-rounds / cancelled） */
  phase: LoopPhase
}

/** 工具返回值的归一形状（工具可以只返回字符串，也可以带 ok/error） */
export interface ToolRunOutcome {
  text: string
  ok?: boolean
  /** 结构化错误码（工具自己知道原因时给；没给就按文本启发式分类） */
  error?: { code: ToolFailureCode; message?: string }
}

/**
 * 把工具的返回值归一成 `{ text, ok?, error? }`。
 *
 * 兼容四种历史形状：纯字符串（绝大多数）、`{ output }`、`{ text }`、`{ content }`。
 * 认不出来时用 JSON 兜底 —— 宁可给模型一串 JSON，也不要给空字符串（那等于没说）。
 */
const FAILURE_CODES: readonly ToolFailureCode[] = [
  'permission_denied',
  'cancelled',
  'timeout',
  'not_found',
  'invalid_args',
  'upstream_error',
  'unknown',
]

/** 工具自己给的 code 只认白名单内的；认不出就归 unknown（不把任意字符串塞进类型） */
function normalizeFailureCode(raw: unknown): ToolFailureCode {
  return typeof raw === 'string' && (FAILURE_CODES as readonly string[]).includes(raw)
    ? (raw as ToolFailureCode)
    : 'unknown'
}

export function normalizeToolOutcome(raw: unknown): ToolRunOutcome {
  if (typeof raw === 'string') return { text: raw }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const textRaw = o.text ?? o.output ?? o.content ?? o.message
    const text = typeof textRaw === 'string' ? textRaw : JSON.stringify(raw)
    const ok =
      typeof o.ok === 'boolean' ? o.ok : typeof o.success === 'boolean' ? o.success : undefined
    const errRaw = o.error
    let error: { code: ToolFailureCode; message?: string } | undefined
    if (typeof errRaw === 'string') {
      error = { code: 'unknown', message: errRaw }
    } else if (errRaw && typeof errRaw === 'object') {
      const e = errRaw as Record<string, unknown>
      const code = normalizeFailureCode(e.code)
      error = { code, ...(typeof e.message === 'string' ? { message: e.message } : {}) }
    }
    return { text, ...(ok !== undefined ? { ok } : {}), ...(error ? { error } : {}) }
  }
  return { text: String(raw ?? '') }
}

/**
 * 给一个 promise 加超时：到点拒绝（消息里带毫秒数），并**清掉计时器**。
 * 计时器不清理会让 Node 进程多挂 ms 毫秒（脚本退出时尤其明显）。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = '工具执行'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** 调度器/诊断用的工具结果条目（按模型顺序落地的那些） */
export interface ToolResultEntry {
  name: string
  args: Record<string, unknown>
  output: string
  ok?: boolean
  failure?: import('@shared/ai/toolFailure').ToolFailure
}

/**
 * 单循环：反复「问模型 → 执行它要的工具 → 把结果回灌」，直到它给纯文本或轮数用尽。
 * 轮数用尽不是异常：返回已拿到的 finalText（调用方决定怎么报告）。
 */
export async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  // 默认从**注册表**取：插件/业务侧注册的工具不必改循环就能被调用
  const tools = opts.tools ?? listTools()
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS_DEFAULT
  const maxParallelToolCalls = Math.max(
    1,
    opts.maxParallelToolCalls ?? MAX_PARALLEL_TOOL_CALLS_DEFAULT,
  )
  const ctx: ToolContext = {
    workspace: opts.workspace,
    signal: opts.signal,
    gate:
      opts.gate ??
      (opts.services
        ? (req: GateRequest) =>
            opts.services!.approval.request({
              kind: req.kind,
              summary: req.kind === 'write' ? req.path : req.command,
            })
        : undefined),
    commandTimeoutMs: opts.commandTimeoutMs,
    ...(opts.onBeforeWrite ? { onBeforeWrite: opts.onBeforeWrite } : {}),
  }
  const messages: ChatTurn[] = [...(opts.initialTurns ?? [])]
  const toolResults: LoopResult['toolResults'] = []
  let finalText = ''
  let rounds = 0
  let phase: LoopPhase = { kind: 'idle' }
  while (rounds < maxRounds) {
    if (opts.signal?.aborted) {
      phase = { kind: 'finished', reason: 'cancelled' }
      break
    }
    rounds += 1
    phase = { kind: 'running', step: rounds }
    opts.onStep?.({ step: rounds, maxSteps: maxRounds })
    // 轮边界：先消费 inbox（中途插话），再问模型
    const injected = opts.inbox?.()
    if (injected) messages.push(injected)
    // 问模型之前先看上下文装不装得下：撑爆时厂商不会报错，它只会截掉系统提示
    const compacted = await applyCompaction(messages, opts.compaction)
    if (compacted) opts.onCompact?.(compacted)
    const reply = await opts.model(messages)
    finalText = reply.text ?? ''
    const calls = reply.calls ?? []
    if (calls.length === 0) {
      phase = { kind: 'finished', reason: 'completed' }
      break
    }
    /**
     * 一批调用怎么跑，交给调度器（`./scheduler.ts`）：
     *   · 独占调用（写盘/跑命令）是**屏障**，它自己跑，前后不许重叠；
     *   · 查询类走**有界滚动池**（maxParallelToolCalls），完成一个补一个；
     *   · 结果**按模型给的顺序**提交 —— 并行只该省时间，不该改变模型看到的世界。
     *
     * 以前这里是顺序 for：语义一样但慢，而且「取消后不再起新的」没有共同出口。
     */
    let cursor = 0
    while (cursor < calls.length) {
      const { consumed } = await runToolGroup(calls, cursor, rounds, {
        ctx,
        tools,
        messages,
        results: toolResults,
        maxParallel: maxParallelToolCalls,
        isAborted: () => opts.signal?.aborted === true,
        modelFacing: (name, output) => modelFacingOutput(name, output, opts),
        ...(opts.onToolStart ? { onToolStart: opts.onToolStart } : {}),
        ...(opts.onToolResult ? { onToolResult: opts.onToolResult } : {}),
        ...(opts.services
          ? {
              trace: (e: { kind: 'tool'; name: string; ms: number; ok: boolean }): void => {
                opts.services?.trace.record(opts.workspace, e)
              },
              appendSession: async (t: { role: 'tool'; content: string }): Promise<void> => {
                await opts.services?.session.append(opts.workspace, t)
              },
            }
          : {}),
      })
      if (consumed <= 0) break
      cursor += consumed
      if (opts.signal?.aborted) break
    }
  }
  if (phase.kind !== 'finished') phase = { kind: 'finished', reason: 'max-rounds' }
  return { finalText, rounds, toolResults, phase }
}
/* ── 再导出：调用方只 import 这一个模块（10/18 之后的形状）─────────────
 *
 * 沙箱（`./sandbox`）与批内调度（`./scheduler`）各有自己的文件 —— 职责不同、
 * 规则密度也不同。但 ipc 与测试都按「从 core 一次导入」来写，所以这里再导出；
 * 少了它，测试里 `setSandboxProvider is not a function`、
 * `executionModeOf is not a function` 全红 —— 而生产代码其实是对的。
 */
export {
  getSandboxProvider,
  localSandbox,
  runInSandbox,
  setSandboxProvider,
  type CommandRequest,
  type SandboxProvider,
} from './sandbox'
export { executionModeOf } from './scheduler'
