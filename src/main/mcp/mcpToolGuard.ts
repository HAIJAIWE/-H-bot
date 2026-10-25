// src/main/mcp/mcpToolGuard.ts
//
// # MCP 路径的【工具闸】判据（P0-13 ①）
//
// ## 现场（交接文档 2026-10-17 第 4 节第 4 条）
//
// 循环路径（agent-core 的 tool-batch 派发前）都过 `toolGuard.classifyTool`：不可撤回的
// （run_bot / run_test / invoke_capability…）会**停下来等用户在应用内点确认**。
// 而 MCP 的 `callTool` 直接 executeTool 派发 —— 外部 IDE 一句话就能起停机器人、
// 写玩家数据、调能力，**从来没有经过用户**。这就是「工具闸只在助手路径生效」的洞。
//
// ## 本模块只放判据，弹窗与等待在 server.ts
//
// 判据必须与助手路径**同一个函数、同一份表**（`toolGuard.ts`）—— 不新造分类，
// 也不在这里再抄一张"哪些工具危险"的表。这里只解决两件 MCP 特有的事：
//   1. **模式从哪来**：循环那边由批准策略（`toolApproval`）按项目决定，
//      跨模块 import 不到；MCP 按同一个环境变量、同一个默认值自己解析一次。
//   2. **结论怎么表达**：直接复用 `ToolVerdict`（auto / ask / deny），不另发明枚举。
import { getToolCategory } from '../services/ai/tools'
import { classifyTool, type GuardMode, type ToolVerdict } from '../services/ai/toolGuard'

/**
 * 与助手路径**同一个环境变量**（`QQBAT_TOOL_GUARD=readonly|acceptEdits|auto`）。
 *
 * 注意：默认值取 acceptEdits（用户 2026-10-15 选定）—— 与循环那边的默认批准策略同一档。
 * 两条路读同一个变量，是为了让"真机对照"时一次改到两处，而不是只有助手那一半变了。
 */
export const TOOL_GUARD_MODE_ENV = 'QQBAT_TOOL_GUARD'

/** 解析工具闸模式。每次调用都读 env（诊断开关要能当场生效，也便于测试）。 */
export function resolveGuardMode(env: NodeJS.ProcessEnv = process.env): GuardMode {
  const raw = env[TOOL_GUARD_MODE_ENV]
  if (raw === 'readonly' || raw === 'acceptEdits' || raw === 'auto') return raw
  return 'acceptEdits'
}

/**
 * 这个工具在 MCP 路径上要不要先问用户。
 *
 * @param approved 本连接里用户已经说过「以后别再问」的工具（与助手路径的
 *   `state.approvedTools` 同一语义，只是作用域是**一条 MCP 连接**）。
 */
export function mcpToolVerdict(toolName: string, approved?: ReadonlySet<string>): ToolVerdict {
  return classifyTool(toolName, getToolCategory(toolName), {
    mode: resolveGuardMode(),
    context: 'mcp',
    approved,
  })
}
