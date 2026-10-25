// src/main/services/agent-core/toolGate.ts
//
// **一次工具调用的动作范围与审批契约**（2026-10-26，第 46 批"审批的单一入口"）。
//
// 为什么单独一个文件：审批这件事此前有三个入口 —— 写文件自己问、跑命令自己问、
// 插件工具**根本不问**。把"要不要问人"从每个工具的 run 里搬到 toolPipeline.prepare 之后，
// 契约（GateRequest / ToolContext）和推断规则（approvalRequestOf）得有个共同的家，
// 否则 prepare 要反过来 import core（循环依赖），或者再抄一份形状（两份一起漂移）。
//
// 这里只有**类型**和两个纯函数：真正的"问人"发生在 toolPipeline 里（它拿到 ctx.gate）。
import type { ApprovalRequest } from './contracts'

/**
 * 需要人点头的动作。
 *
 * ⚠️ `command` 这一类是 2026-10-18 补的：在这之前**只有写文件要审批**，
 * 而白名单里的命令能做的事比写文件更多（`git push`、`npx <任何包>`）——
 * 一个会自己跑命令的循环不该有"不用问"的口子。
 *
 * `tool`（2026-10-26）是第三类：会改东西、但既不是写某个文件也不是跑某条命令的动作。
 * 插件工具、宿主注册的工具都落在这里 —— 在此之前它们**完全不过闸门**，
 * 而界面给它们标的 category 是 mutation。
 */
export type GateRequest =
  | { kind: 'write'; path: string }
  | { kind: 'command'; command: string }
  | { kind: 'tool'; tool: string; args?: Record<string, unknown> }

export interface ToolContext {
  workspace: string
  signal?: AbortSignal
  /**
   * 动作闸门：返回 false = 拒绝（真实接入时是用户审批；测试里是断言钩子）。
   *
   * ⚠️ 工具自己**不读**它（2026-10-26 起）：闸门统一在 `toolPipeline.prepare` 里过一次，
   * 工具只声明"这次调用要审批什么"（见 `ApprovalTool.approval`）。工具里各写一遍闸门的下场是
   * 新增一类动作（插件工具）时无人记得补，于是它标着 mutation 却从不问人。
   */
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

/**
 * 闸门请求 → 审批服务要的形状。
 *
 * 只有一个真源：审批弹窗的标题、结构化参数、"以后别再问"的匹配键都从这**一份**映射出来，
 * 否则每加一类动作就要在 IPC 里补一个分支，漏一个就是"问了但记不住"或"记错了"。
 */
export function toApprovalRequest(req: GateRequest): ApprovalRequest {
  if (req.kind === 'write') return { kind: 'write', summary: req.path }
  if (req.kind === 'command') return { kind: 'command', summary: req.command }
  return {
    kind: 'tool',
    summary: req.tool,
    tool: req.tool,
    ...(req.args ? { detail: { args: req.args } } : {}),
  }
}

/** 能声明审批的工具（`Tool` 实现了它；这里只留审批关心的三个字段，避免循环依赖） */
export interface ApprovalTool {
  name: string
  /** 工具类别：query = 只读（计划阶段可用），mutation = 会改东西 */
  category?: 'query' | 'mutation'
  /**
   * 这次调用要不要审批、审批什么。
   *
   * - 返回 null = 不用问（只读动作、或者**已经被别的机制确认过的动作** ——
   *   旧工具的 mutation 是提案制：用户先点确认才落盘，这里再问一遍就是重复审批）；
   * - 不声明就按 category 保守推断：mutation 一律 `{kind:'tool'}`，query 不问人。
   *
   * 它返回的是**要问什么**，不是"问了之后能不能跑"—— 后者由 `ctx.gate` 回答。
   * 抛异常也算拒绝（角色写域就是这么拒的）：调度器会把原因原样回灌给模型。
   */
  approval?: (args: Record<string, unknown>, ctx: ToolContext) => GateRequest | null
}

/**
 * 一次调用要审批什么（审批的**唯一**入口，`toolPipeline.prepare` 用它）。
 *
 * 显式声明优先；没声明时按 category 保守推断 —— 宁可多问一句，不要少问。
 */
export function approvalRequestOf(
  tool: ApprovalTool | undefined,
  args: Record<string, unknown>,
  ctx: ToolContext,
): GateRequest | null {
  if (!tool) return null
  if (tool.approval) return tool.approval(args, ctx)
  if (tool.category === 'mutation') return { kind: 'tool', tool: tool.name, args }
  return null
}
