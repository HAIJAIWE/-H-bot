// src/main/ipc/aiInstruction.ts
//
// # MCP 写指令回执通道（ai:instructionResult）
//
// 主进程下发写指令（ai:clientInstruction）→ 渲染层执行 → **渲染层必须回执**。
// 没有这条通道，主进程就永远等不到结论，只能靠超时判失败 ——
// 表现是「MCP 说改完了 / 说失败了，但说不清到底改没改」，这正是 P1-1 要治的假成功。
//
// 谁在调：
// - src/preload/index.ts 的 ai.resolveInstruction 调 ai:instructionResult
// - 渲染层 src/renderer/src/stores/aiStore.ts 在 handleClientInstruction 之后调它
//
// 回执语义（不设「未知」状态，见 @shared/protocol/instruction）：
// applied = 真的做了；rejected = 没做也没改动；failed = 可能没生效。
// 迟到回执（已超时）由 resolveInstruction 丢弃，返回 false 不当作错误。
import { ipcMain } from 'electron';
import { isInstructionResult } from '@shared/protocol/instruction';
import { resolveInstruction } from '../services/ai/instructionBridge';
import { tryIpc } from './_shared';

export function registerAiInstructionIpc(): void {
  ipcMain.handle('ai:instructionResult', async (_event, args: unknown) => {
    // IPC 参数不可信：只认三个明确结局（isInstructionResult 是唯一判据，别在这里另写一套）
    if (!isInstructionResult(args)) {
      return {
        ok: false as const,
        error: '参数校验失败: 需要 { requestId, outcome }，outcome.status 只能是 applied / rejected / failed',
      };
    }
    // false = 没有挂起项（已超时或伪造 id）。对渲染层不算失败：主进程那边的超时
    // 已经把这个调用判完，这里只是把「这条回执没对上任何人」说清楚。
    return tryIpc(() => resolveInstruction(args));
  });
}
