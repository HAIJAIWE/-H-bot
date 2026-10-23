// tests/helpers/autoReplyInstruction.ts
//
// 测试里的"渲染层"：收到写指令立刻回 applied（P1-1 回执协议）。
//
// 为什么不回会超时：主进程现在**真的等**渲染层回执（默认 15s，MCP 30s）。
// 测试里的 send 是 mock/记录器，没人会回 —— 不回就等于"渲染层挂了"，
// 所有"派发成功"的断言都会变成失败（而且每条指令白等 15/30 秒）。
//
// 用法：把 webContents.send 包一层即可，不改变原有断言（调用记录仍然落在原 mock 上）。
import { resolveInstruction } from '@main/services/ai/instructionBridge';

export function withAutoReply<T extends (channel: string, payload: any) => unknown>(send: T): T {
  return ((channel: string, payload: any) => {
    send(channel, payload);
    if (channel === 'ai:clientInstruction' && payload && typeof payload.requestId === 'string') {
      resolveInstruction({
        requestId: payload.requestId,
        outcome: { status: 'applied', detail: '（测试自动回执）' },
      });
    }
  }) as T;
}
