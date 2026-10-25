// src/main/ipc/aiAgentCore.ts
//
// # agent-core 运行入口（`ai:agentCoreRun`）
//
// workspace-first 循环（读文件 → 写文件 → 跑命令 → 校验流程）从这条通道接到界面上。
// 接口钉在 `docs/ai/agent-core-wiring.md`，改形状先改那份文档。
//
// ## 为什么单独一个文件，而不是塞进 `ai.ts`
//
// `ai.ts` 已经 793 行（闸门红线 800）。这条通道是**另一件事**：另一套循环、
// 另一处审批时机、另一种回执形状。挤进同一个文件只会让两边都更难读，
// 而"再长 11 行刚好过线"正是 fileGrowth 那条闸门要防的偷懒。
//
// ## 审批
//
// 走**现有**那条链（`requestApproval` → `ai:approvalRequest` → 界面弹窗 →
// `ai:resolveApproval`），不新开一套：同一个动作在两条路径上必须问同一个问题。
// 语义保持**默认拒绝** —— 没弹窗、没点同意、超时、取消，都不写盘。
import { ipcMain, BrowserWindow } from 'electron'
import { aiAgentCoreRunSchema, aiAgentCoreSteerSchema, aiSavePresetsSchema } from '../schemas/ai'
import { resolveAuthorAiConfig } from '../services/ai/appAiConfig'
import { appendTrace } from '../services/ai/trace'
import { requestApproval } from '../services/ai/toolApproval'
import {
  appendHistoryEntries,
  describeDropped,
  historyToMessages,
  loadHistory,
} from '../services/ai/historyStore'
import { addAllowRule, readAllowRules, ruleMatches } from '../services/ai/allowRules'
import { DEFAULT_THREAD_ID, threadFile } from '../services/ai/threads'
import { saveSpillText } from '../services/ai/spillStore'
import { loadInbox, saveInbox, type PendingInbox } from '../services/ai/inboxStore'
import { beginTurn, endTurn, recordFileBefore } from '../services/flow/turnJournal'
import type { RunTurnResult } from '../services/agent-core/runTurn'
import { isAbsolute, relative } from 'path'
import { runAgentTurn } from '../services/agent-core/runTurn'
import { runOnboardingTurn } from './aiAgentCoreOnboarding'
import { listTools } from '../services/agent-core/core'
import { clearTodos, getTodos } from '../services/agent-core/todoStore'
import { readPreset, resolvePresetTools, writePresets } from '../services/ai/presets'
import { listMainPlugins, pluginOwnedTools } from '../services/plugins/host'
import { scopeToolsByPlugins } from '../services/plugins/scoping'
import { dispatchInstruction } from '../services/ai/instructionBridge'
import { buildPendingContext } from '../services/ai/pendingContext'
import { validateProposalOperations } from '../services/ai/proposalValidation'
import { buildVerdict } from '../services/ai/verifier'
import { createProposal, type ProposalOperation } from '@shared/types/proposal'
import type { Verdict } from '@shared/types/agent'
import { adaptLegacyTools, type LegacyToolBridge } from '../services/agent-core/legacyTools'
import { mergeTools } from '../services/agent-core/toolCatalog'
import { resolveSummaryLlm } from '../services/ai/summaryLlm'
import { makeTurnSummarizer } from '../services/agent-core/contextGate'
import { AUTHOR_PROFILE } from '@shared/agent/policy'
import {
  ROLE_OF_MODE,
  mayRoleWritePath,
  rolePathBoundaryMessage,
  type AgentRole,
} from '@shared/ai/roleDomains'
import { AGENT_ROLE_HINT } from '@shared/ai/roleHints'
import { activeFileHintFor, withImageNote } from '../services/ai/promptHints'
import { summarizeDroppedHistory } from '../services/ai/contextDigest'
import type { ApprovalRequest } from '../services/agent-core/contracts'
import { logger } from '../services/infra/logger'

/** 审批弹窗里的工具名：沿用助手那套名字，界面上的文案就不会出现第二套说法 */
const TOOL_NAME: Record<ApprovalRequest['kind'], string> = {
  write: 'write_file',
  command: 'run_command',
  irreversible: 'run_command',
}

/** 审批弹窗里要展示的结构化参数（"改哪个文件 / 跑什么命令"） */
function approvalArgs(req: ApprovalRequest): Record<string, unknown> {
  if (req.kind === 'write') return { path: req.summary, ...req.detail }
  return { command: req.summary, ...req.detail }
}

/**
 * 正在跑的循环（按项目）：`ai:cancelChat` 与 `ai:isRunning` 要能看见它。
 *
 * 为什么必须有：界面上的「停止」是**真拦**的意思（这条链路的既有纪律 —— 假动作会让
 * 用户以为停了、模型却在后台继续写）。没有 signal，循环会跑满 10 轮、把审批弹窗
 * 一个个弹出来，而用户已经点了停止。
 */
const RUNNING = new Map<string, AbortController>()

/**
 * **插话队列**（按项目）：循环每到一个步边界取一条，塞进正在跑的对话。
 *
 * 与 DSH 的 inbox 是同一个语义（`next-step`）：不新开一轮，而是**当场纠偏**。
 * 差异也明说：DSH 还有 `next-turn`（等下一轮再说），我们一次调用就是一轮，
 * 所以只实现 next-step —— 没赶上的留在队列里，收尾时如实告诉用户。
 */
const STEER = new Map<string, PendingInbox>()

/** 该项目此刻有没有 agent-core 循环在飞（`ai:isRunning` 用它合流） */
export function isAgentCoreRunning(projectPath: string): boolean {
  return RUNNING.has(projectPath)
}

/** 停下该项目的循环（返回 false = 本来就没在跑） */
export function cancelAgentCoreRun(projectPath: string): boolean {
  const ctrl = RUNNING.get(projectPath)
  if (!ctrl) return false
  ctrl.abort()
  return true
}

export function registerAiAgentCoreIpc(): void {
  /**
   * `ai:savePresets` —— 保存会话预设（整表覆盖，写 .qqbat/agent-presets.json）。
   *
   * 回 warnings 而不是拒绝未知工具/插件：预设允许"先写、后装"；
   * 界面把 warnings 显示出来即可，真正的权限边界在运行时（工具表过滤）。
   */
  ipcMain.handle('ai:savePresets', async (_event, args: unknown) => {
    const parsed = aiSavePresetsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const { projectPath, presets } = parsed.data
    try {
      await writePresets(projectPath, presets)
      const tools = new Set(listTools().map(t => t.name))
      const plugins = new Set(listMainPlugins().map(p => p.id))
      const warnings: string[] = []
      for (const preset of presets) {
        for (const tool of preset.allowedTools ?? []) {
          if (!tools.has(tool)) warnings.push(`预设「${preset.name}」引用了不存在的工具: ${tool}`)
        }
        for (const plugin of preset.plugins ?? []) {
          if (!plugins.has(plugin))
            warnings.push(`预设「${preset.name}」引用了未装载的插件: ${plugin}`)
        }
      }
      return { ok: true, data: { saved: presets.length, warnings } }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('ai:agentCoreRun', async (event, args: unknown) => {
    const parsed = aiAgentCoreRunSchema.safeParse(args)
    if (!parsed.success) {
      logger.warn('[ipc/aiAgentCore] 参数校验失败:', parsed.error.message)
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const { projectPath, requirement, maxRounds } = parsed.data
    /**
     * 四个以前「传了但没读」的字段（2026-10-25 补接）：
     *   · planFirst      —— 先计划：只给查询类工具，写/命令物理上不在表里；
     *   · fullAccess     —— 完全权限：不再逐个问人（**不**越过角色的写域闸）；
     *   · images         —— 贴图：只作用于这一轮（图不进记忆，见 promptHints.withImageNote）；
     *   · activeFilePath —— 用户当前在代码编辑器里打开的文件（只对代码页/双向有意义）。
     *
     * schema 一直收着它们，注释还写着「少收一个字段就等于静默丢功能」，
     * 而 handler 从来没读过 —— 界面按了没反应，是最难被当成 bug 报的那种静默。
     * 渲染层这四项早就一路传到了 IPC（见 aiStore.runAgentCoreTurn），断在主进程这一环。
     */
    const { planFirst, fullAccess, images, activeFilePath } = parsed.data
    /**
     * 线程：与助手共用同一个选择器 —— 传了就这条线程的记忆，不传 = 默认那份。
     * `threadFile` 负责把 id 收敛成安全路径（`../../etc/passwd` 只会得到无害文件名），
     * 并在 `default` 时指回老文件（升级前的历史不能丢）。
     */
    const threadId = parsed.data.threadId ?? DEFAULT_THREAD_ID
    const memoryFile = threadFile(projectPath, threadId)
    // 一个项目同时只跑一个循环：两条并行循环会各自弹审批、各自写盘，用户分不清谁是谁
    if (RUNNING.has(projectPath)) {
      return { ok: false, error: '这个项目的循环还在跑：先停下来再发新的要求。' }
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    /**
     * **开荒**（还没有项目）：同一条循环，另一套装配（2026-10-25 双引擎收口）。
     *
     * 以前这里走的是助手链路 `ai:chat`，于是"有没有项目"决定的是**用哪套引擎** ——
     * 工具表、提案形状、报错文案全都不一样。用户看到的是一开荒就换了个 AI。
     * 现在分支只剩"装配不同"：循环、事件通道、提案卡片都是同一份。
     *
     * 放在 `RUNNING` 登记**之前**：开荒没有项目路径可作键，也不该跟项目内运行互斥
     * （它们操作的不是同一个工作区，不会被"两条循环抢着写盘"伤到）。
     */
    if (projectPath.trim() === '') {
      return runOnboardingTurn({ win, requirement, ...(images ? { images } : {}) })
    }
    const ctrl = new AbortController()
    RUNNING.set(projectPath, ctrl)
    /**
     * 待办队列（durable）：
     *   · `step` 插话只对**当前**这一轮有效 —— 启动时清掉（上一轮插的话早就过期了）；
     *   · `turn` 排队跨进程有意义 —— 从盘上读回来接着跑（应用崩了也不丢）。
     */
    const inbox = STEER.get(projectPath) ?? (await loadInbox(projectPath))
    inbox.step.length = 0
    STEER.set(projectPath, inbox)
    const stepQueue = inbox.step
    const turnQueue = inbox.turn
    const persistInbox = (): void => {
      void Promise.resolve(saveInbox(projectPath, inbox)).catch((e: unknown) =>
        logger.warn('[ipc/aiAgentCore] 待办队列落盘失败:', String(e)),
      )
    }
    persistInbox()
    /**
     * 事件出口：**复用助手那条链路已有的五个通道**（chunk / toolCall / agentState /
     * response / error），渲染层那边一行监听都不用改 —— 流式、工具行、状态栏、
     * 收尾、错误提示全都是现成的。新开通道只会多三处登记和一套重复的界面逻辑。
     *
     * 只有 `ai:compact` 是循环独有的（助手链路没有"循环内压缩"这件事），
     * 所以它按新通道办：preload 监听 + 渲染层类型 + aiStore 订阅 + 事件契约闸门，
     * 四处都登记过（tests/guards/agentCoreEventContract.test.ts）。
     */
    const emit = (channel: string, payload: unknown): void => {
      win?.webContents.send(channel, payload)
    }
    try {
      const config = await resolveAuthorAiConfig(projectPath)
      if (!config) {
        const error = '没有可用的模型配置（先在设置里配好）'
        emit('ai:error', { projectPath, message: error })
        return { ok: false, error }
      }
      /**
       * ── 跨轮记忆（2026-10-18）────────────────────────────────────────
       *
       * 记忆**就是助手那条 .qqbat/ai-history.jsonl**，不另起一份：
       *  · 用户眼里只有"这个助手" —— 换个模式就失忆是最难解释的体验；
       *  · 那份文件已经有撕裂尾帧处理、按字节收敛、token 预算裁剪、格式版本 ——
       *    再写一份就是把踩过的坑重踩一遍（本仓库为"同一件事抄两份"付过多次代价）。
       *
       * 顺序很重要：**先读记忆、再把这一轮的要求记下来** —— 反了的话本轮要求会在
       * 上下文里出现两次。
       */
      const past = await loadHistory(projectPath, memoryFile)
      const { messages: history, retention } = historyToMessages(past)
      /**
       * 历史注记 = "省略了 N 条" + **被省略内容的确定性摘要**。
       * 只有前半句时，模型知道"有更早的对话"却不知道是什么，长任务里会重复问已经答过的事。
       */
      const summaryLlm = await resolveSummaryLlm(projectPath)
      /**
       * 循环内压缩的语义摘要器：只在 `QQBAT_CONTEXT_SUMMARY=model` 时存在。
       * 没配模型就是 undefined → 压缩退回确定性摘要（压缩每轮都要走，不能靠外部服务）。
       */
      const turnSummarizer = makeTurnSummarizer(summaryLlm)
      const historyNote = [
        describeDropped(retention),
        await summarizeDroppedHistory(past, retention.kept, summaryLlm),
      ]
        .filter(Boolean)
        .join('\n\n')
      // 每一轮的要求在**轮循环里**记（一次调用可能连续跑多轮，见下方）

      let seq = 0
      /**
       * 本轮内已选"别再问"的动作类别（write / command）。
       *
       * 语义刻意与助手那条链一致（chatRun 的 `state.approvedTools`）：**只在这一轮有效**，
       * 不落盘、不跨轮 —— 所以按钮文案是"本轮内别再问"而不是"以后别再问"。
       * 跨轮持久化需要一张规则表 + 能撤销它的界面；没有撤销口的自动放行，本仓库明文反对。
       */
      const approved = new Set<string>()
      /**
       * 「以后别再问」的规则表（跨轮、可撤销，见 allowRules.ts）。
       * 与内存里的 `approved` 分工：内存管"这一轮"，表管"以后"。
       */
      const allowRules = await readAllowRules(projectPath)
      /**
       * 规则里的写路径存**项目内相对路径**（POSIX 分隔符）：
       * 绝对路径写进规则表会让项目一搬家就全部失效，而且界面上也难读。
       */
      /**
       * 规则表只认 write / command / tool 三类：'irreversible' 归到 command
       * （它是"改动很大的一种命令"，与命令共用审批弹窗与撤销语义）。
       */
      const ruleKindOf = (kind: ApprovalRequest['kind']): 'write' | 'command' =>
        kind === 'write' ? 'write' : 'command'
      const matchOf = (req: ApprovalRequest): string => {
        if (req.kind !== 'write') return req.summary.trim()
        const rel = relative(projectPath, req.summary)
        return rel && !rel.startsWith('..') && !isAbsolute(rel)
          ? rel.split('\\').join('/')
          : req.summary.trim()
      }
      /**
       * 轮与轮之间的正文要隔开：模型第一轮说"我先看看文件"、第二轮才是答案，
       * 两条直接拼在一起会变成一句话。工具开始 = 这一轮正文结束的信号。
       */
      let streamed = false
      let boundary = false
      const chunk = (text: string): void => {
        const sep = boundary && streamed ? '\n\n' : ''
        boundary = false
        streamed = true
        emit('ai:chunk', { projectPath, text: sep + text })
      }
      /** 思考过程单独一条：不参与轮间分隔符，也不进正文累积 */
      const reasoningChunk = (text: string): void => {
        emit('ai:chunk', { projectPath, text, kind: 'reasoning' })
      }
      /**
       * ── 轮循环（对齐 DSH 的 next-turn）────────────────────────────────
       *
       * 一次调用可以连续跑**多轮**：跑完一轮先正常收尾（response + idle，界面照常提交），
       * 如果 `turn` 队列里还排着就接着开一轮。界面那边一行不用改 —— 它看到的就是
       * "又一轮开始了"（thinking → chunk → toolCall → response）。
       *
       * 为什么不让渲染层自己连发：队列要 durable（崩了不丢），而计划中的"这一轮结束后
       * 自动开始"是主进程的状态，放在界面就得再存一份，迟早漂。
       */
      /**
       * **本轮工具白名单**（会话级预设的原语）：传了就只有这些工具进提示与调用表。
       * 名字不存在的项直接忽略（插件卸了/改名了不该让整轮发不出去），
       * 全都不存在时得到空表 —— 循环仍然能跑纯对话，只是没有工具可用。
       */
      // 预设提供"默认白名单"；显式 allowedTools 优先（调用方的临时意图要盖过预设）
      const presetTools = parsed.data.preset
        ? await resolvePresetTools(projectPath, parsed.data.preset)
        : undefined
      const allowedToolNames =
        parsed.data.allowedTools && parsed.data.allowedTools.length > 0
          ? parsed.data.allowedTools
          : presetTools
      /**
       * 工具表 = 全量 → 插件集（会话作用域）→ 工具白名单（预设/显式）。
       * 空表也照交：循环仍能跑纯对话，只是没有工具可用。
       */
      const preset = parsed.data.preset
        ? await readPreset(projectPath, parsed.data.preset)
        : undefined
      /**
       * ── 角色（2026-10-24）──────────────────────────────────────────────
       *
       * 循环链路以前**完全不看角色**：界面上的四个按钮只影响助手链路，
       * 项目一打开、话全走循环，于是"切了角色"实际没生效 —— 界面在演，主进程没接。
       *
       * 现在两条链路同一个映射（roleDomains 是唯一真源）：
       *   · 预设里写死的 `role` 优先（预设是"这一轮怎么跑"的显式声明）；
       *   · 否则按页面推（低代码页 = builder，代码页 = coder，缺省 builder）。
       * 角色同时决定两件事：系统提示里的强调句、**写盘的作用域**（见下面的审批闸）。
       */
      const role: AgentRole = preset?.role ?? ROLE_OF_MODE[parsed.data.agentMode ?? 'blocks']
      /**
       * **审批口径**：调用方显式表态（true/false）优先，只有 `undefined` 才让预设补位。
       * 界面上那个开关关着时传的是 undefined 而不是 false，正是为了留这个口子
       * （否则"预设声明了无人值守"永远不可能生效）。
       */
      const effectiveFullAccess = fullAccess ?? preset?.permissionMode === 'full'
      /**
       * 四段强调句是按**助手链路的工具名**写的（write_code / add_node…），
       * 而循环手上是通用文件工具（write_file / run_command…）。不补这一句，
       * 模型会以为 write_file 根本不存在，或者反过来不知道自己还有写域限制。
       */
      const LOOP_ROLE_GATE_NOTE =
        '（本轮是智能体循环：写盘按**路径**判作用域 —— 「.qqbat/flow.json」与面板/模板 = 界面域，' +
        '「src/」「plugins/」与代码文件 = 代码域。越界的写在弹审批之前就会被拒，别换个路径再试。）'
      /**
       * 「用户当前打开的文件」：只对代码页/双向有意义，且**文件真在磁盘上**才写。
       * 空串是常态（低代码页、没开文件、路径不合规），filter(Boolean) 会把它滤掉。
       */
      const fileNote = activeFileHintFor(role, projectPath, activeFilePath)
      const roleNote = [AGENT_ROLE_HINT[role], LOOP_ROLE_GATE_NOTE, fileNote, preset?.prompt]
        .filter(Boolean)
        .join('\n\n')
      /**
       * ── 旧工具接进循环（2026-10-25）────────────────────────────────────
       *
       * 循环手上原本只有 6 个通用文件工具；助手链路那 27 个领域工具
       * （read_flow / list_nodes / add_node / validate_flow …）循环里**根本看不到** ——
       * 「一个引擎」于是只能是句空话：用户说"给 /test 加个发消息节点"，
       * 循环只能自己改 flow.json，改完没有提案、没有预览图、没有结构校验。
       *
       * 这里把同一批定义接进来（`adaptLegacyTools`），语义**照旧**，一件不新造：
       *   · query 走 executeTool，要界面执行的走 dispatchInstruction 等回执；
       *   · mutation **不执行**，只攒进 pendingOperations，轮末发提案等用户确认。
       */
      const pendingOperations: ProposalOperation[] = []
      const legacyBridge: LegacyToolBridge = {
        projectPath,
        signal: ctrl.signal,
        role,
        pendingOperations,
        // 与助手链路同一个构造器：自检类工具拿"加上待确认操作后的流程图"，而不是磁盘现状
        context: () => buildPendingContext(projectPath, pendingOperations),
        // 界面指令：发出去并**等回执**；超时/无窗口都收敛成 failed，绝不假成功
        dispatch: async instruction => {
          const res = await dispatchInstruction(win, {
            name: instruction.name,
            args: instruction.args,
            projectPath,
          })
          return res.outcome
        },
      }
      // 同名（read_file / write_file / validate_flow）循环版优先，规则见 toolCatalog
      const mergedTools = mergeTools(listTools(), adaptLegacyTools(legacyBridge))
      const scoped = scopeToolsByPlugins(mergedTools, pluginOwnedTools(), preset?.plugins)
      /**
       * 收窄后**总是**交出去：不传的话 runTurn 会退回 listTools()（只有 6 个），
       * 旧工具就又白接了 —— 这是本仓库第 N 次"算完没交出去"。
       */
      const turnTools =
        allowedToolNames && allowedToolNames.length > 0
          ? scoped.filter(t => allowedToolNames.includes(t.name))
          : scoped
      let currentRequirement = requirement
      /**
       * 贴图只属于**这一句**（用户说"你看这是怎么回事"附的图）：
       * 排队进来的下一句、或者插话续跑的那一轮，都不该把上一张图再发一遍 ——
       * 既贵（一张按 1000 token 估）又会让模型以为新问题也带着同一张图。
       */
      let pendingImages = images
      let last: RunTurnResult | null = null
      /** 当前轮次 id（trace 带它，轮次投影才归得了组；beginTurn 之前是 undefined） */
      let traceTurnId: string | undefined
      for (;;) {
        const turnImages = pendingImages
        pendingImages = undefined
        /**
         * 每轮清空待确认操作：提案是**这一轮**的产物。
         * 留着上一轮的会让模型看见"已经提交过"的假历史，也会让提案越滚越大。
         */
        pendingOperations.length = 0
        /**
         * 每轮开始都要把这一轮的要求记进记忆（顺序与以前一致：先读历史、再记要求）。
         * 图本身不落盘（一张截图 base64 就几 MB，会撑爆 JSONL），只在记忆里留一句
         * 「（附了 N 张图，仅那一轮可见）」—— 与助手链路同一个口径（promptHints）。
         */
        await appendHistoryEntries(
          projectPath,
          [
            {
              ts: new Date().toISOString(),
              role: 'user',
              content: withImageNote(currentRequirement, turnImages?.length ?? 0),
            },
          ],
          memoryFile,
        )
        streamed = false
        boundary = false
        /**
         * 任务清单是**这一轮**的脚手架：新要求进来时先清空，否则界面会挂着
         * 一份"早就做完的旧计划"，模型也可能把它当成这一轮的进度。
         * 空的 `ai:todo` 同时把界面清干净（不发的话上一轮的清单会一直留在那）。
         */
        clearTodos(projectPath)
        emit('ai:todo', { projectPath, todos: [] })
        emit('ai:agentState', { projectPath, state: 'thinking' })
        /**
         * **轮次日志**（与助手链路同一个 turnJournal）：这一轮改过哪些文件、改之前什么样。
         * 不接它，循环模式写完盘之后**撤回按钮永远不会亮** —— 一个会自己写文件的循环，
         * 没有撤销口是硬伤（"改了但退不回去"）。
         */
        try {
          traceTurnId = await beginTurn(projectPath, currentRequirement)
        } catch (e) {
          logger.warn('[ipc/aiAgentCore] 开始轮次日志失败（本轮将不可撤回）:', String(e))
        }
        const result = await runAgentTurn({
          projectPath,
          requirement: currentRequirement,
          config,
          /**
           * 每次写盘 / 跑命令都要问。callId 每轮唯一（`requestApproval` 按它去重，
           * 重复的 callId 会把**上一次**的等待按拒绝收掉）。
           */
          approval: async (req, signal) => {
            /**
             * **角色的写域闸**（2026-10-24）：越界的写**先拒**，连弹窗都不弹 ——
             * 让用户点"允许"来绕过角色边界，等于边界不存在。
             *
             * 拒绝用 throw 而不是 return false：调度器会把异常变成
             * `[工具失败] <原因>` 回灌给模型，原因里带"这是谁的活、怎么才能做"，
             * 模型才有可执行的下一步；return false 只会得到一句"未通过闸门"。
             */
            if (req.kind === 'write') {
              const rel = relative(projectPath, req.summary)
              const inside = rel && !rel.startsWith('..') && !isAbsolute(rel)
              const relPath = (inside ? rel : req.summary).split('\\').join('/')
              if (!mayRoleWritePath(role, relPath)) {
                const message = rolePathBoundaryMessage(role, relPath)
                logger.warn('[ipc/aiAgentCore] 角色写域拒绝：' + message)
                throw new Error(message)
              }
            }
            /**
             * **完全权限**：跳过「问人」，但**不**跳过角色的写域闸（上面那段在它之前），
             * 也不写 allowRules —— 它只对这一次运行有效（界面文案就是「本次运行」）。
             * 口径可能是调用方开关，也可能是预设的 permissionMode，所以判 effectiveFullAccess。
             */
            if (effectiveFullAccess) return true
            const match = matchOf(req)
            const ruleKind = ruleKindOf(req.kind)
            // ① 本轮内说过"别再问" ② 以前点过"以后别再问" → 都直接放行（不再弹窗）
            if (approved.has(ruleKind) || ruleMatches(allowRules, { kind: ruleKind, match })) {
              logger.info(`[ipc/aiAgentCore] 按已记住的规则放行：${req.kind} ${match}`)
              return true
            }
            seq += 1
            const decision = await requestApproval(
              {
                projectPath,
                callId: `agentcore-${seq}-${Date.now()}`,
                toolName: TOOL_NAME[req.kind],
                args: approvalArgs(req),
                hint: req.summary,
              },
              {
                emit: (channel, payload) => win?.webContents.send(channel, payload),
                ...(signal ? { signal } : {}),
              },
            )
            if (decision === 'always') {
              approved.add(ruleKind)
              // 落盘：以后同类动作不再问（界面里能看见、能删，见 ChatPanel 的「已记住」）
              await addAllowRule(projectPath, { kind: ruleKind, match })
              allowRules.push({ kind: ruleKind, match, addedAt: new Date().toISOString() })
            }
            return decision !== 'deny'
          },
          // trace 补上轮次 id —— 投影按它归组；循环自己不知道"这是第几轮"
          trace: (p, e) =>
            appendTrace(p, {
              ...e,
              ...(traceTurnId ? { turnId: traceTurnId } : {}),
            } as unknown as Parameters<typeof appendTrace>[1]),
          /**
           * 超长工具结果**完整落盘**（与助手链路同一个 spillStore，同一个目录）：
           * 模型只拿头尾 + 路径，需要细节时用 search_text/分段 read_file 读回来。
           */
          spill: (toolName, text) => saveSpillText(projectPath, toolName, text),
          // 写盘前记 before（turnJournal 在没有进行中的轮次时会静默跳过）
          onBeforeWrite: relPath => recordFileBefore(projectPath, relPath),
          history,
          /**
           * 预设（allowedTools / plugins）与「先计划」裁过的工具表。
           * 以前 `turnTools` 算完就丢 —— 界面上选了预设，循环里照样拿全量工具，
           * 「权限配置」其实不生效；先计划也只改了提示词，写工具仍然调得到。
           */
          ...(turnTools ? { tools: turnTools } : {}),
          ...(planFirst ? { planOnly: true } : {}),
          // 图只进第一轮的用户回合（见上面的 pendingImages）
          ...(turnImages && turnImages.length > 0 ? { images: turnImages } : {}),
          ...(roleNote ? { roleNote } : {}),
          ...(historyNote ? { historyNote } : {}),
          ...(maxRounds ? { maxRounds } : {}),
          /**
           * 循环内的上下文闸门：messages 在一轮里只增不减（每跑一次工具多一条输出），
           * 12 轮 × 单条 24k 字符足够撑爆窗口。预算与助手链路同源（AUTHOR_PROFILE）。
           */
          compaction: {
            budgetTokens: AUTHOR_PROFILE.conversationTokenBudget,
            ...(turnSummarizer ? { summarize: turnSummarizer } : {}),
          },
          /**
           * 循环内压缩发生了：日志留一份，**界面也要留一条**（2026-10-25）。
           * 压缩是"悄悄发生"的动作 —— 早先回合被换成摘要之后，用户看到模型忘了前面的事，
           * 却没有任何解释。这条事件就是那句解释。
           */
          onCompact: info => {
            logger.info('[ipc/aiAgentCore] 循环内上下文闸门:', JSON.stringify(info))
            // 只剪了工具结果、一条回合都没压时**不发**事件：界面那句「省略 N 条早先回合」
            // 在 N = 0 时是假话（原文还在，只是中间几千字被掐掉了，且没有摘要替换它）。
            if (info.dropped <= 0) return
            emit('ai:compact', {
              projectPath,
              dropped: info.dropped,
              tokensBefore: info.tokensBefore,
              tokensAfter: info.tokensAfter,
            })
          },
          signal: ctrl.signal,
          // ── 流式观测：模型边吐字、工具边执行，界面就能边显示 ──
          onTextChunk: chunk,
          /**
           * 步进（第几轮 / 共几轮）：渲染层的步骤条只认这个通道。
           * 循环以前只发 agentState（idle/thinking），渲染层拿不到 step，
           * 「第 3 / 18 步」永远是空的 —— 监听方在 src/renderer/src/stores/aiStore.ts:1862。
           */
          onStep: ({ step, maxSteps }) => emit('ai:agentStep', { projectPath, step, maxSteps }),
          /**
           * **步边界收插话**：用户中途说的话在这里塞进正在跑的对话。
           * 也写进记忆（否则下一轮模型不记得用户中途纠偏过）。
           */
          inbox: () => {
            const next = stepQueue.shift()
            if (next) persistInbox()
            if (!next) return null
            // Promise.resolve：写记忆是"顺手做"，它失败/没返回 promise 都不该打断这一轮
            void Promise.resolve(
              appendHistoryEntries(
                projectPath,
                [{ ts: new Date().toISOString(), role: 'user', content: '[插话] ' + next }],
                memoryFile,
              ),
            ).catch((e: unknown) => logger.warn('[ipc/aiAgentCore] 插话写记忆失败:', String(e)))
            return { role: 'user', content: '[用户中途插话] ' + next }
          },
          onToolStart: call => {
            boundary = true
            emit('ai:toolCall', {
              projectPath,
              id: call.id,
              name: call.name,
              args: call.args,
              status: 'running',
              timestamp: Date.now(),
            })
          },
          onToolEnd: (call, output) => {
            emit('ai:toolCall', {
              projectPath,
              id: call.id,
              name: call.name,
              args: call.args,
              // 工具失败在 core 里是**返回值**而不是抛异常（"[工具失败] …"），只能按前缀判
              status: output.startsWith('[工具失败]') ? 'error' : 'done',
              result: output,
              timestamp: Date.now(),
            })
            /**
             * 清单变了就广播。读的是 store 而不是解析回执 —— 回执是给模型看的英文一句话，
             * 解析它等于把"人看的文案"当协议用。
             */
            if (call.name === 'todo_write' && !output.startsWith('[工具失败]')) {
              emit('ai:todo', { projectPath, todos: getTodos(projectPath) })
            }
          },
        })
        /**
         * ⚠️ **先记账，再宣布收尾**（2026-10-18 真机踩到）。
         *
         * 渲染层收到 `ai:response` 会立刻去读轮次投影（listTurns）刷新「本轮改动」卡。
         * 以前先发 response、后 endTurn —— 那一刻轮次文件还没落盘，卡片查不到就当没有，
         * 用户看到的是"改了文件但本轮改动卡不出现"。
         * 顺序必须是：写记忆 → 结束轮次（落盘）→ 发 response / idle。
         */
        /**
         * 答案也写进记忆（下一轮才"记得"）。没给出文字就不写 ——
         * 存一条空 assistant 只会让模型下一轮看到一段莫名其妙的白。
         */
        if (result.finalText.trim()) {
          await appendHistoryEntries(
            projectPath,
            [{ ts: new Date().toISOString(), role: 'assistant', content: result.finalText }],
            memoryFile,
          )
        }
        // **成功的**写/命令才算改动：审批被拒的那次输出是 "[工具失败] …"，
        // 记成"改过"会在撤回列表里多出一轮什么都没变的空记录。
        const hadChanges = result.toolResults.some(
          t =>
            (t.name === 'write_file' || t.name === 'run_command') &&
            !t.output.startsWith('[工具失败]'),
        )
        try {
          await endTurn(projectPath, { hadChanges })
        } catch (e) {
          logger.warn('[ipc/aiAgentCore] 收轮次日志失败:', String(e))
        }
        last = result
        /**
         * ── 提案（2026-10-25）──────────────────────────────────────────
         *
         * mutation 类旧工具**不执行**：操作攒在 pendingOperations 里，由这里统一校验、
         * 出裁决、发提案 —— 用户点了确认才落盘。与助手链路同一个口径：
         * **有提案时只发 ai:proposal、不发 ai:response**（渲染层按这条分工收尾；
         * 两条都发会让同一轮长出"正文 + 提案"两份尾巴）。
         */
        let proposalSent = false
        if (pendingOperations.length > 0) {
          try {
            const validation = await validateProposalOperations(projectPath, pendingOperations)
            // verifier 是还原文件（参数没有类型），它的 issues[].severity 被推成 string；
            // 这里按它对外承诺的形状收一下，不改那个文件（改它等于把整篇还原代码重排一遍）。
            const verdict = buildVerdict(pendingOperations, validation) as unknown as Verdict
            const proposal = createProposal(
              currentRequirement,
              pendingOperations,
              validation,
              verdict,
            )
            emit('ai:proposal', { projectPath, proposal })
            proposalSent = true
            logger.info(
              '[ipc/aiAgentCore] 已发出提案：' +
                pendingOperations.length +
                ' 个操作；结构校验' +
                (verdict.ok ? '通过' : '有 ' + verdict.issues.length + ' 条问题'),
            )
          } catch (e) {
            // 提案发不出去时**退回正文**：至少让用户看见模型说了什么，而不是一片空白
            logger.warn('[ipc/aiAgentCore] 组装提案失败（退回正文）:', String(e))
          }
        }
        /**
         * 收尾交给渲染层那套现有逻辑（它会把正文 + 本轮工具行合成一条消息）。
         * 顺序：先 response（提交正文与工具），再 idle（状态栏回"就绪"）。
         */
        if (!proposalSent) emit('ai:response', { projectPath, message: result.finalText })
        emit('ai:agentState', { projectPath, state: 'idle' })
        /**
         * 还有排队的下一轮吗？有就接着开（用户的"排队"消息**不能**等他再发一次）。
         * 队列在取走后立刻落盘：崩在这一刻也不该重复跑同一句。
         */
        const nextTurn = turnQueue.shift()
        persistInbox()
        if (!nextTurn) break
        currentRequirement = nextTurn
      }
      /**
       * 没赶上这一轮的**插话**不能静默丢掉（用户以为说进去了）。
       * 用 warning 通道收尾：渲染层会把它变成一条可见提示。
       * （排队的下一轮不会漏：上面那个循环会一直取到空。）
       */
      const leftover = stepQueue.splice(0)
      persistInbox()
      if (leftover.length > 0) {
        emit('ai:warning', {
          projectPath,
          message:
            '有 ' +
            leftover.length +
            ' 条插话没赶上这一轮（本轮已经收尾）：' +
            leftover.join('；') +
            '。请重新发送。',
        })
      }
      return { ok: true, ...(last as RunTurnResult) }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.warn('[ipc/aiAgentCore] 运行失败:', message)
      /**
       * **失败的尝试要留痕**（对齐 DSH 的 assistant/attempt）：进记忆日志但**不进模型历史**
       * （historyToMessages 会跳过它）。不然应用一重启，"上次为什么没做完"就彻底查不到了。
       * 写失败只当没发生：诊断信息绝不该反向毁掉一次运行的收尾。
       */
      try {
        await appendHistoryEntries(
          projectPath,
          [
            {
              ts: new Date().toISOString(),
              role: 'attempt',
              content: message.slice(0, 2000),
              reason: ctrl.signal.aborted ? 'cancelled' : 'error',
              ok: false,
            },
          ],
          memoryFile,
        )
      } catch (writeError) {
        logger.warn('[ipc/aiAgentCore] 记录失败尝试失败:', String(writeError))
      }
      // 错误也必须走到界面（渲染层据此收尾：不然后台挂了、界面一直转圈）
      emit('ai:error', { projectPath, message })
      emit('ai:agentState', { projectPath, state: 'idle' })
      return { ok: false, error: message }
    } finally {
      RUNNING.delete(projectPath)
      STEER.delete(projectPath)
    }
  })

  /**
   * **插话**：把一句话塞进正在跑的那一轮（下一个步边界注入）。
   *
   * 没在跑就直接拒绝 —— 否则用户以为说进去了，实际丢在队列里等下一次运行，
   * 那和"静默失败"是同一种体验。要新开一轮请用 `ai:agentCoreRun`。
   */
  ipcMain.handle('ai:agentCoreSteer', async (_event, args: unknown) => {
    const parsed = aiAgentCoreSteerSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const inbox = STEER.get(parsed.data.projectPath)
    if (!inbox) {
      return { ok: false, error: '这个项目现在没有在跑：要新提要求请直接发送。' }
    }
    const target = parsed.data.target ?? 'step'
    const queue = target === 'turn' ? inbox.turn : inbox.step
    queue.push(parsed.data.text.trim())
    // 立刻落盘：排队的那一轮要跨崩溃活着；插话虽然只对当前轮有效，留着也无害
    void Promise.resolve(saveInbox(parsed.data.projectPath, inbox)).catch((e: unknown) =>
      logger.warn('[ipc/aiAgentCore] 待办队列落盘失败:', String(e)),
    )
    return { ok: true, data: { queued: queue.length, target } }
  })
}
