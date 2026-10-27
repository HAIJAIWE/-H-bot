// src/main/services/agent-runtime/projectTurn.ts
//
// # 项目内一轮运行体（从 aiAgentCore 搬出来，第 63 批）
//
// 这里只关心「一轮怎么跑」：记忆、预设/角色、工具表、轮循环、提案、标题。
// 它与 Electron 的全部接触面被压成 3 个注入点：
//   · emit(channel, payload)              —— 事件往哪送到宿主决定（IPC / WS / 日志）
//   · deps.approval(ctx)                  —— 审批闸门怎么建（宿主有窗口，运行时没有）
//   · deps.dispatch(instruction, ...)     —— 要界面执行的旧工具指令（等回执）
// 守卫 tests/guards/agentRuntimeElectronFree.test.ts 会扫这个目录，别把窗口拖进来。

import { randomUUID } from 'node:crypto'
import { resolveAuthorAiConfig } from '../ai/appAiConfig'
import { maybeGenerateThreadTitle, maybeRefreshThreadTitle } from '../ai/threadTitles'
import type { ThreadTitleRecord } from '@shared/ai/threadTitleTypes'
import { describeMissingFileReferences } from '../ai/fileReference'
import { effectiveMaxParallelToolCalls } from '../ai/parallelToolCallsSettings'
import { threadTitleAutoRefreshEnabled } from '../ai/threadTitleSettings'
import { appendTrace } from '../ai/trace'
import {
  appendHistoryEntries,
  describeDropped,
  historyToMessages,
  loadHistory,
} from '../ai/historyStore'
import { readAllowRules } from '../ai/allowRules'
import { saveSpillText } from '../ai/spillStore'
import { beginTurn, endTurn, recordFileBefore } from '../flow/turnJournal'
import type { RunTurnInput, RunTurnResult } from '../agent-core/runTurn'
import { runAgentTurn } from '../agent-core/runTurn'
import { assistantHistoryEntry } from '../agent-core/uiTrace'
import { listTools } from '../agent-core/core'
import { clearTodos, getTodos } from '../agent-core/todoStore'
import { resolveDefaultPreset, resolvePresetForRun } from '../ai/presets'
import { decideSessionPreset, writePresetSession } from '../ai/presetLock'
import type { AgentPresetRow } from '@shared/ai/presetRoster'
import { listMainPlugins, pluginOwnedTools } from '../plugins/host'
import { scopeToolsByPlugins } from '../plugins/scoping'
import { buildPendingContext } from '../ai/pendingContext'
import { validateProposalOperations } from '../ai/proposalValidation'
import { buildVerdict } from '../ai/verifier'
import { createProposal, type ProposalOperation } from '@shared/types/proposal'
import type { Verdict } from '@shared/types/agent'
import type { LegacyInstructionOutcome, LegacyToolBridge } from '../agent-core/legacyTools'
import { adaptLegacyTools } from '../agent-core/legacyTools'
import { mergeTools } from '../agent-core/toolCatalog'
import { resolveSummaryLlm } from '../ai/summaryLlm'
import { makeTurnSummarizer } from '../agent-core/contextGate'
import { AUTHOR_PROFILE } from '@shared/agent/policy'
import { ROLE_OF_MODE, type AgentRole } from '@shared/ai/roleDomains'
import { AGENT_ROLE_HINT } from '@shared/ai/roleHints'
import { activeFileHintFor, withImageNote } from '../ai/promptHints'
import { summarizeDroppedHistory } from '../ai/contextDigest'
import { buildTimeContext } from '../ai/timeContext'
import { logger } from '../infra/logger'
/** 宿主提供的能力（全部是函数，没有 Electron 类型）。 */
export interface ProjectTurnDeps {
  /**
   * 建审批闸门。宿主手里才有窗口，所以「问人」那一环由宿主组装：
   * 运行时只管把上下文（角色/全权/规则表/本轮已放行）交出去。
   */
  approval: (ctx: {
    projectPath: string
    role: AgentRole
    effectiveFullAccess: boolean
    allowRules: Awaited<ReturnType<typeof readAllowRules>>
    approved: Set<string>
  }) => RunTurnInput['approval']
  /** 旧工具里需要界面执行的指令：发出去并等回执，超时/无窗口都收敛成失败。 */
  dispatch: (instruction: {
    name: string
    args: Record<string, unknown>
    projectPath: string
  }) => Promise<LegacyInstructionOutcome>
}

export interface ProjectTurnInput {
  projectPath: string
  requirement: string
  threadId: string
  memoryFile: string
  signal: AbortSignal
  emit: (channel: string, payload: unknown) => void
  /** 插话队列（step 只对本轮有效，turn 跨进程排队）—— 由宿主持有 STEER 表。 */
  stepQueue: string[]
  turnQueue: string[]
  persistInbox: () => void
  images?: RunTurnInput['images']
  fullAccess?: boolean
  planFirst?: boolean
  maxRounds?: number
  activeFilePath?: string
  preset?: string | null
  agentMode?: keyof typeof ROLE_OF_MODE
  allowedTools?: string[]
}

/** 回执形状：成功轮带 RunTurnResult（可能为空 —— 没有跑起来时只有 ok/error）。 */
export type ProjectTurnResult =
  ({ ok: true; messageId?: string } & Partial<RunTurnResult>) | { ok: false; error: string }

export async function runProjectTurn(
  input: ProjectTurnInput,
  deps: ProjectTurnDeps,
): Promise<ProjectTurnResult> {
  const {
    projectPath,
    requirement,
    threadId,
    memoryFile,
    signal,
    emit,
    stepQueue,
    turnQueue,
    persistInbox,
    images,
    fullAccess,
    planFirst,
    maxRounds,
    activeFilePath,
    preset,
    agentMode,
    allowedTools,
  } = input
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
    /**
     * 时间上下文（第 55 批）：本轮第一次采样要拿"上一条模型可见消息"的时间。
     * 取 `past` 的最后一条而不是读时钟文件 —— 记忆就是时间轴，顺序天然对齐。
     * 注意必须在**本轮要求被 append 之前**取；之后每轮追加完更新即可。
     */
    let lastMessageAt: string | null = past.length > 0 ? (past[past.length - 1].ts ?? null) : null
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
    /**
     * 本轮内已选"别再问"的动作类别（write / command）。
     *
     * 语义与批准策略那边一致（只在这一次运行里记住放行）：**只在这一轮有效**，
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
     * 轮与轮之间的正文要隔开：模型第一轮说"我先看看文件"、第二轮才是答案，
     * 两条直接拼在一起会变成一句话。工具开始 = 这一轮正文结束的信号。
     */
    let streamed = false
    let boundary = false
    let reasoningForUi = '' // 本轮思考（RunTurnResult 不带它，想在重启后还看得到只能自己攒）
    const chunk = (text: string): void => {
      const sep = boundary && streamed ? '\n\n' : ''
      boundary = false
      streamed = true
      emit('ai:chunk', { projectPath, text: sep + text })
    }
    /** 思考过程单独一条：不参与轮间分隔符，也不进正文累积 */
    const reasoningChunk = (text: string): void => {
      reasoningForUi += text
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
     * ── 会话预设（2026-10-26 第 48 批：宿主侧唯一裁决 + fail-closed）──────
     *
     * 以前这里读**两次**盘（先 resolvePresetTools 拿白名单、再 readPreset 拿角色），
     * 而且查不到就 `undefined`：白名单静默消失、角色悄悄退回页面默认，全程没有任何提示。
     * 现在一次解析；传了名字却查不到 / 那一条坏了，**这一轮不开跑**并把原因说清楚。
     *
     * 第 50 批起先过**线程锁**（对齐 DSH 的 agent-preset/locked）：线程已经有过一轮，
     * 就只能沿用当初那一套组合。界面忘传 preset 时用锁里的值补上（不能因为少传一个字段
     * 就悄悄放开权限）；显式换名直接拒绝。落盘只在空白线程 + 预设解析成功之后 ——
     * 解析失败还写锁，等于把一条跑不起来的选择钉死在这个会话上。
     */
    /**
     * 三态必须分开处理（第 51 批）：
     *  · 字符串 = 明确选了；
     *  · `null`   = 明确选了"跟页面"；
     *  · 缺省     = 这一轮没表态 —— **只有空白线程**才套项目默认。
     *
     * 已经跑过的线程不套默认：默认是"新会话从哪开始"，不是"旧会话被无声改口径"。
     * 默认值读坏了也 fail-closed（默认同样是权限口径）。
     */
    let requestedPreset = preset
    if (requestedPreset === undefined) {
      if (past.length === 0) {
        const defaults = await resolveDefaultPreset(projectPath)
        if (!defaults.ok) return { ok: false, error: defaults.error }
        requestedPreset = defaults.preset
      } else {
        requestedPreset = null
      }
    }
    const decided = await decideSessionPreset(
      projectPath,
      threadId,
      past.length > 0,
      requestedPreset,
    )
    if (!decided.ok) return { ok: false, error: decided.error }
    let runPreset: AgentPresetRow | undefined
    if (decided.decision.preset) {
      const resolved = await resolvePresetForRun(projectPath, decided.decision.preset)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      runPreset = resolved.preset
    }
    if (decided.decision.persist) {
      try {
        await writePresetSession(projectPath, threadId, decided.decision.preset)
      } catch (e) {
        return {
          ok: false,
          error:
            '这一轮的预设没能记下来（' +
            (e instanceof Error ? e.message : String(e)) +
            '）。为了不让这个会话的权限组合变成"没人知道"，这一轮没有开始。',
        }
      }
    }
    /**
     * **本轮工具白名单**（会话级预设的原语）：传了就只有这些工具进提示与调用表。
     * 名字不存在的项直接忽略（插件卸了/改名了不该让整轮发不出去），
     * 全都不存在时得到空表 —— 循环仍然能跑纯对话，只是没有工具可用。
     *
     * 预设提供"默认白名单"；显式 allowedTools 优先（调用方的临时意图要盖过预设）。
     */
    const allowedToolNames =
      allowedTools && allowedTools.length > 0 ? allowedTools : runPreset?.allowedTools
    /**
     * 工具表 = 全量 → 插件集（会话作用域）→ 工具白名单（预设/显式）。
     * 空表也照交：循环仍能跑纯对话，只是没有工具可用。
     */
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
    const role: AgentRole = runPreset?.role ?? ROLE_OF_MODE[agentMode ?? 'blocks']
    /**
     * **审批口径**：调用方显式表态（true/false）优先，只有 `undefined` 才让预设补位。
     * 界面上那个开关关着时传的是 undefined 而不是 false，正是为了留这个口子
     * （否则"预设声明了无人值守"永远不可能生效）。
     */
    const effectiveFullAccess = fullAccess ?? runPreset?.permissionMode === 'full'
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
    const roleNote = [AGENT_ROLE_HINT[role], LOOP_ROLE_GATE_NOTE, fileNote, runPreset?.prompt]
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
      signal: signal,
      role,
      pendingOperations,
      // 与助手链路同一个构造器：自检类工具拿"加上待确认操作后的流程图"，而不是磁盘现状
      context: () => buildPendingContext(projectPath, pendingOperations),
      // 界面指令：发出去并**等回执**；超时/无窗口都收敛成 failed，绝不假成功
      dispatch: async instruction =>
        deps.dispatch({ name: instruction.name, args: instruction.args, projectPath }),
    }
    // 同名（read_file / write_file / validate_flow）循环版优先，规则见 toolCatalog
    const mergedTools = mergeTools(listTools(), adaptLegacyTools(legacyBridge))
    const scoped = scopeToolsByPlugins(mergedTools, pluginOwnedTools(), runPreset?.plugins)
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
     * 第 58 批：`@` 引用只写进句子、不塞文件内容（见 prompt 里的 file-reference 段），
     * 所以"这个路径根本不存在"只能由模型自己去试。我们这边**已经知道**它不存在，
     * 就在系统提示里先说一句 —— 一次不存在就是一轮白跑。
     */
    const mentionNote = describeMissingFileReferences(projectPath, currentRequirement)
    /**
     * 贴图只属于**这一句**（用户说"你看这是怎么回事"附的图）：
     * 排队进来的下一句、或者插话续跑的那一轮，都不该把上一张图再发一遍 ——
     * 既贵（一张按 1000 token 估）又会让模型以为新问题也带着同一张图。
     */
    let pendingImages = images
    let last: RunTurnResult | null = null
    /**
     * 最后一次**落了盘**的 assistant 消息 id（第 58 批）。
     *
     * 为什么要从回执里也带一份：`ai:response` 与 invoke 的回执是两条独立消息，
     * 谁先到没有保证（见下面 runAgentCoreTurn 的兜底注释）。回执先到、渲染层
     * 自己收尾时，界面手上没有 id 就挂不出反馈按钮 —— 同一条回答于是"有时能反馈、
     * 有时不能"。带上它，两条路都能拿到同一个 id。
     */
    /**
     * 这次运行里**逐轮攒下来的用户要求**（第 60 批）。
     *
     * `past` 是循环开始前读的历史，排队进来的下一轮不在里面；而标题刷新要"这个线程
     * 至今说过的全部需求"，所以这里单独记一份（顺序 = 时间序，含本轮）。
     */
    const runRequirements: string[] = []
    /**
     * 标题落盘后通知界面：首轮生成与每轮刷新共用同一种事件形状
     * （渲染层只认 `ai:threadTitle`，两处各拼一遍迟早会漂）。
     */
    const emitThreadTitle = (record: ThreadTitleRecord): void => {
      emit('ai:threadTitle', {
        projectPath,
        threadId,
        title: record.title,
        source: record.source,
      })
    }
    let lastMessageId: string | null = null
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
      const turnTs = new Date().toISOString() // 本轮要求的时间：既落盘，也做下一轮的"距上一条"
      // 时间上下文在 append 前算：previousMessageAt 必须是**本轮之前**最后一条（第 55 批）
      const timeNote = buildTimeContext({ previousMessageAt: lastMessageAt })
      await appendHistoryEntries(
        projectPath,
        [
          {
            ts: turnTs,
            role: 'user',
            content: withImageNote(currentRequirement, turnImages?.length ?? 0),
          },
        ],
        memoryFile,
      )
      // 第 60 批：标题刷新要"这个线程说过的全部需求"，本轮的也要在内
      runRequirements.push(currentRequirement)
      lastMessageAt = turnTs
      streamed = false
      boundary = false
      reasoningForUi = ''
      const turnStartedAt = Date.now() // 「工作了 N 秒」的来源，落盘后重启也还在
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
         * 审批闸门（角色写域闸 → 全权直通 → 已记住的规则 → 问人）：
         * 实现在 `aiAgentCoreApproval.ts`，这里只喂上下文（第 60 批抽出）。
         */
        approval: deps.approval({ projectPath, role, effectiveFullAccess, allowRules, approved }),

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
        /**
         * **审批口径进提示**（M1，第 60 批）：完全权限时系统提示要说清"没有审批点了"，
         * 否则模型会按旧提示"等用户点允许"，白白停在那里。见 prompt.ts 的 approval-policy 段。
         */
        approvalMode: effectiveFullAccess ? 'never' : 'ask',
        ...(turnTools ? { tools: turnTools } : {}),
        ...(planFirst ? { planOnly: true } : {}),
        // 图只进第一轮的用户回合（见上面的 pendingImages）
        ...(turnImages && turnImages.length > 0 ? { images: turnImages } : {}),
        ...(roleNote ? { roleNote } : {}),
        ...(historyNote ? { historyNote } : {}),
        /**
         * 第 58 批：用户 `@` 了不存在的路径时先告诉他，别让模型自己去踩。
         * 空串（绝大多数情况）不传，系统提示里不会多出一个空段。
         */
        ...(mentionNote ? { mentionNote } : {}),
        /**
         * 第 59 批：一批工具里最多几个同时跑。设置项改的是这个值；
         * 关掉时 `effectiveMaxParallelToolCalls()` 返回 1（串行），不是 undefined
         * （那会回落循环默认 10，等于"关了还在并行"）。
         */
        maxParallelToolCalls: effectiveMaxParallelToolCalls(),
        /** 第 59 批：会话检索工具要靠它把"当前这段对话"排除掉 */
        threadId,
        // 第 55 批：时间上下文（每轮一次采样）与文件观察门（覆盖既有文件前必须读过）
        timeNote,
        fsObservation: true,
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
        signal: signal,
        // ── 流式观测：模型边吐字、工具边执行，界面就能边显示 ──
        onTextChunk: chunk,
        /**
         * 步进（第几轮 / 共几轮）：渲染层的步骤条只认这个通道。
         * 循环以前只发 agentState（idle/thinking），渲染层拿不到 step，
         * 「第 3 / 18 步」永远是空的 —— 监听方在 src/renderer/src/stores/aiStore.ts:1862。
         */
        onStep: ({ step, maxSteps }) => emit('ai:agentStep', { projectPath, step, maxSteps }),
        /**
         * **本轮统计**（状态条）：轮数 / 工具数 / token / 上下文占用。
         * 以前这条只由旧助手链路发 —— 旧引擎删掉后不补这一发，状态条就永远是空的。
         */
        onStats: stats => emit('ai:stats', { projectPath, stats }),
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
       *
       * `assistantMessageId`（第 58 批）：这条回答的**稳定 id**，随 `ai:response` 一起发出去，
       * 界面靠它把 👍/👎 反馈挂到正确的消息上（位置派生 id 在压缩/重读后会变）。
       */
      const assistantMessageId = randomUUID()
      if (result.finalText.trim()) {
        await appendHistoryEntries(
          projectPath,
          [
            assistantHistoryEntry({
              id: assistantMessageId,
              content: result.finalText,
              reasoning: reasoningForUi,
              toolResults: result.toolResults,
              startedAt: turnStartedAt,
            }),
          ],
          memoryFile,
        )
        // 落盘成功才记：回执里的 id 必须能在历史里找到（渲染层拿它反馈）
        lastMessageId = assistantMessageId
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
      if (!proposalSent)
        emit('ai:response', {
          projectPath,
          message: result.finalText,
          // 只有真正落了盘的 assistant 记录才有 id：提案路径没落这条正文，
          // 渲染层拿到 undefined 就不显示反馈按钮（不给"点了也存不下"的入口）
          ...(result.finalText.trim() ? { messageId: assistantMessageId } : {}),
        })
      emit('ai:agentState', { projectPath, state: 'idle' })
      /**
       * 会话自动标题（第 56 批 + 第 60 批的"每轮刷新"）。
       *
       * 两条路分工（对齐上游 `session-title` 的 per-turn refresh，但首轮保留本仓更准的做法）：
       *   · **首轮**（循环开始前历史里没有任何用户消息）：用「需求 + 首段回答」生成一次。
       *     早一点的节点没有"多轮消息"可折叠，回答里的主题词反而更有用。
       *   · **之后每一轮**：把到本轮为止**全部用户消息**折叠进去刷新一次，受设置开关控制
       *     （`settings.aiProvider.threadTitleRefresh`）。模型被明确要求"没变就原样返回"，
       *     所以大多数轮次是零改动、零落盘。
       *
       * 两条都是**旁路请求**（fire-and-forget）：没 key / 失败 / 结果为空 / 被取消都静默，
       * fallback 顶上，绝不影响这一轮已经收尾的事实；用户重命名过的线程（user 来源）
       * 在服务里被 pin 住，两条路都不会覆盖它。过期判定（生成期间用户改了名、
       * 或另一条刷新先落盘）也在服务里用修订号栅栏做掉。
       */
      const isFirstTurn = !past.some(entry => entry.role === 'user')
      if (isFirstTurn && result.finalText.trim()) {
        void maybeGenerateThreadTitle({
          projectPath,
          threadId,
          prompt: currentRequirement,
          responseText: result.finalText,
          config,
          signal: signal,
        }).then(record => {
          if (record) emitThreadTitle(record)
        })
      } else if (!isFirstTurn && !signal.aborted && threadTitleAutoRefreshEnabled()) {
        const userMessages = [
          ...past.filter(entry => entry.role === 'user').map(entry => String(entry.content ?? '')),
          ...runRequirements,
        ]
        void maybeRefreshThreadTitle({
          projectPath,
          threadId,
          messages: userMessages,
          config,
          signal: signal,
        }).then(record => {
          if (record) emitThreadTitle(record)
        })
      }
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
    return {
      ok: true,
      ...(last as RunTurnResult),
      // 落盘 id 也走回执（第 58 批）：回执可能比 ai:response 先到，渲染层兜底收尾时要它
      ...(lastMessageId ? { messageId: lastMessageId } : {}),
    }
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
            reason: signal.aborted ? 'cancelled' : 'error',
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
  }
}
