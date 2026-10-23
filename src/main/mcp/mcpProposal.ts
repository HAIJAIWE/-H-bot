// src/main/mcp/mcpProposal.ts
//
// # 「组合类」工具在 MCP 下的落地方式（P0-13 ③）
//
// ## 为什么它们在 MCP 下必然报「未知工具」
//
// `apply_template` / `new_command` / `new_lookup` 是**只走提案路**的工具
// （`tests/guards/toolDefinitionDispatchSync.test.ts` 的 PROPOSAL_ONLY 钉住了
// 「不许有 execute 实现」）：助手路径用 `toolCallToOperations` 把它们转成提案操作，
// **用户点确认后由渲染层**用 `insertPresetTemplate` / `insertCommandChain` /
// `insertConfigQueryChain`（`renderer/src/lib/command/insertChain.ts`）铺链。
// 主进程侧没有任何铺链实现 —— 所以 MCP 直接 executeTool 只会抛「未知工具」。
//
// ## 修法：把计划交给应用内确认（不复制铺链逻辑）
//
// MCP 没有提案机制，但**渲染层的提案卡片是一条现成通道**：主进程发 `ai:proposal`，
// AI 面板出现「待确认计划」，用户点「应用」后走渲染层那份唯一实现。
// 于是外部 IDE 也能用这三种工具了，代价是**必须有一个人在应用里点一下** ——
// 与 ① 的「不可撤回的动作要经用户」是同一条纪律，不是退步。
//
// 另一条路是"把 insertChain 那套铺链逻辑搬一份到主进程"，但那种「同一件事两份实现」
// 正是本仓库反复出事的模式（见 insertChain.ts 文件头），所以不走。
import { createProposal, type Proposal } from '@shared/types/proposal';
import { toolCallToOperations } from '../services/ai/proposal';
import type { AgentRole } from '@shared/ai/roleDomains';

/** 只走提案路的组合类工具（与 toolDefinitionDispatchSync 的 PROPOSAL_ONLY 同一批） */
export const PROPOSAL_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'apply_template',
  'new_command',
  'new_lookup',
]);

/**
 * 把一次工具调用转成"待用户确认的提案"。
 *
 * 参数校验**复用 `toolCallToOperations`**（未知 templateId / dbPath 越界 / 参数不全
 * 都会在那里抛**给模型看得懂**的错误）—— 不在这里另写一套校验。
 *
 * @throws 参数不合法 / 不产生任何操作时抛出可读错误（server.ts 会给客户端一句 isError）
 */
export function buildProposalForToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectPath: string,
): Proposal {
  /**
   * 角色固定 `builder`（低代码页）：这三个工具改的都是**流程图** ——
   * 与 AI 面板默认角色一致；换成 coder 会触发 roleDomains 的跨页拦截（那是另一页的活）。
   */
  const role: AgentRole = 'builder';
  const operations = toolCallToOperations(toolName, args, projectPath, role);
  if (operations.length === 0) {
    throw new Error(`工具 ${toolName} 没有产生任何提案操作（参数不完整？）`);
  }
  return createProposal(`MCP：${toolName}（外部客户端提交，待你在应用内确认）`, operations);
}
