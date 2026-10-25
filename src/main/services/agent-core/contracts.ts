// src/main/services/agent-core/contracts.ts
//
// **agent-core 的五个服务契约**（2026-10-18，复刻主流 harness 的分层边界）。
//
// 为什么先定契约再写实现：现在这些关注点散在 toolGuard / toolApproval / tokenBudget /
// spillStore / trace / historyStore 里，互相直接 import。谁都能改谁，改一处得读一片。
// 定了契约之后：循环只依赖这五个接口，实现可以被替换/被测试替身顶掉，
// 也才有资格谈「工具插件化」。
//
// ⚠️ 这里只有**类型**，没有实现 —— 实现挂在各自模块后面，行为一行不变。

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema；worker 工具可以给 additionalProperties */
  parameters: Record<string, unknown>
}

export interface ToolInvocation {
  name: string
  args: Record<string, unknown>
}

/** 沙箱：唯一允许执行外部代码的地方（命令 / 代码片段） */
export interface SandboxService {
  /** 在受控环境里跑一行命令；白名单之外一律拒绝 */
  runCommand(
    input: string,
    opts: { cwd: string; timeoutMs?: number },
  ): Promise<{
    ok: boolean
    code: number | null
    stdout: string
    stderr: string
  }>
  /** 跑一段纯计算代码片段（vm 隔离，无 fs/net） */
  runSnippet(input: { code: string; args?: unknown; timeoutMs?: number }): Promise<{
    ok: boolean
    output: string
    error: string
    ms: number
  }>
}

export interface ApprovalRequest {
  /**
   * `tool` 是 2026-10-26 补的第三类：会改东西、但既不是"写某个文件"也不是"跑某条命令"的动作
   * （插件工具、宿主注册的工具）。在此之前它们要么不问人，要么被迫冒充命令名。
   */
  kind: 'write' | 'command' | 'irreversible' | 'tool'
  /** 给人看的一句话（写哪个文件 / 跑什么命令 / 哪个工具） */
  summary: string
  /**
   * `kind:'tool'` 时是工具的**真名**（弹窗标题与"以后别再问"的匹配键都要它）。
   * 其它类别没有这个名字 —— 它们的工具名由调用方按类别映射。
   */
  tool?: string
  /** 结构化细节，给弹窗/日志用 */
  detail?: Record<string, unknown>
}

/** 审批：所有会改东西的动作都要过这里（提案制就是它的一种实现） */
export interface ApprovalService {
  request(req: ApprovalRequest, signal?: AbortSignal): Promise<boolean>
}

/** 上下文：预算、压缩、溢出落盘都收在这一个口子后面 */
export interface ContextService {
  /** 估算 token（与厂商无关的粗估） */
  estimate(text: string): number
  /** 超预算时的结构化压缩 */
  compact(messages: readonly unknown[], budgetTokens: number): Promise<readonly unknown[]>
  /** 单条工具结果超长时落盘，返回替代文本 */
  spill(text: string): Promise<string>
}

/** 会话存储：历史、线程、轮次 */
export interface SessionStore {
  append(projectPath: string, turn: { role: string; content: string }): Promise<void>
  load(projectPath: string, limit?: number): Promise<Array<{ role: string; content: string }>>
}

export interface TraceEvent {
  kind: string
  name: string
  ms: number
  ok: boolean
  note?: string
  /**
   * 属于哪一轮（轮次投影按它归组）。
   *
   * 循环本身不知道"轮次 id"（它一次调用可能连续跑多轮，见 ipc/aiAgentCore 的轮循环），
   * 所以由**调用方**在 trace 回调里补上 —— 这是刻意的：契约层不该反向依赖轮次日志。
   */
  turnId?: string
}

/** 观测：一轮里每个 LLM/工具调用的记录 */
export interface TraceSink {
  record(projectPath: string, event: TraceEvent): void
}

/** 循环依赖的全部外部能力（测试里可以整体替换成替身） */
export interface AgentServices {
  sandbox: SandboxService
  approval: ApprovalService
  context: ContextService
  session: SessionStore
  trace: TraceSink
}
