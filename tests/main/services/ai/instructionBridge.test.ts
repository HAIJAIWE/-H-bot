// tests/main/services/ai/instructionBridge.test.ts
//
// **写指令回执协议**的闸门（P1-1，2026-10-18）。
//
// 守的是一条不变式：**派发 ≠ 成功**。只有渲染层回了 applied 才算成功；
// 超时、没窗口、迟到回执，都必须落到 failed/rejected，绝不能假装成功。
import { describe, it, expect } from 'vitest';
import type { BrowserWindow } from 'electron';
import {
  dispatchInstruction,
  pendingInstructionCount,
  resolveInstruction,
  settleInstructionsFor,
} from '@main/services/ai/instructionBridge';

function fakeWin() {
  const sent: Array<{ channel: string; payload: any }> = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: any) => sent.push({ channel, payload }),
    },
  } as unknown as BrowserWindow;
  return { win, sent };
}

const req = (projectPath: string) => ({
  name: 'add_node',
  args: { nodeKind: 'message_send' },
  projectPath,
});

describe('写指令回执：派发 ≠ 成功', () => {
  it('★ 派发带 requestId，回了 applied 才算成功', async () => {
    const { win, sent } = fakeWin();
    const promise = dispatchInstruction(win, req('/tmp/rpc-1'));
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('ai:clientInstruction');
    const requestId = sent[0].payload.requestId as string;
    expect(typeof requestId).toBe('string');
    expect(sent[0].payload.instruction).toEqual({
      name: 'add_node',
      args: { nodeKind: 'message_send' },
    });
    expect(sent[0].payload.projectPath).toBe('/tmp/rpc-1');

    expect(resolveInstruction({ requestId, outcome: { status: 'applied', detail: '加好了' } })).toBe(
      true,
    );
    const result = await promise;
    expect(result.outcome).toEqual({ status: 'applied', detail: '加好了' });
  });

  it('★ 渲染层拒绝 → rejected 原样带回（不是成功）', async () => {
    const { win, sent } = fakeWin();
    const promise = dispatchInstruction(win, req('/tmp/rpc-2'));
    resolveInstruction({
      requestId: sent[0].payload.requestId,
      outcome: { status: 'rejected', reason: '目标是只读文件' },
    });
    const result = await promise;
    expect(result.outcome.status).toBe('rejected');
  });

  it('★ 超时 → failed（宁可失败，也不许假成功）', async () => {
    const { win } = fakeWin();
    const result = await dispatchInstruction(win, req('/tmp/rpc-3'), { timeoutMs: 8 });
    expect(result.outcome.status).toBe('failed');
  });

  it('没有窗口 → failed，且根本不发指令', async () => {
    const result = await dispatchInstruction(null, req('/tmp/rpc-4'));
    expect(result.outcome.status).toBe('failed');
    expect(pendingInstructionCount()).toBe(0);
  });

  it('迟到回执 / 伪造 id → 返回 false（不能把已判失败的调用改回成功）', async () => {
    expect(resolveInstruction({ requestId: 'not-exist', outcome: { status: 'applied' } })).toBe(
      false,
    );
    const { win } = fakeWin();
    const promise = dispatchInstruction(win, req('/tmp/rpc-5'), { timeoutMs: 8 });
    await promise; // 超时后挂起项已被清掉
    expect(resolveInstruction({ requestId: 'not-exist-2', outcome: { status: 'applied' } })).toBe(
      false,
    );
  });

  it('★ 停止/切项目时按 projectPath 结算，全部判失败', async () => {
    const a = fakeWin();
    const b = fakeWin();
    const pa = dispatchInstruction(a.win, req('/tmp/rpc-6a'), { timeoutMs: 60_000 });
    const pb = dispatchInstruction(b.win, req('/tmp/rpc-6b'), { timeoutMs: 60_000 });
    expect(pendingInstructionCount()).toBe(2);
    expect(settleInstructionsFor('/tmp/rpc-6a', '用户停止了对话')).toBe(1);
    expect((await pa).outcome.status).toBe('failed');
    // 另一个项目不受影响
    expect(pendingInstructionCount()).toBe(1);
    expect(settleInstructionsFor('/tmp/rpc-6b', '测试清理')).toBe(1);
    expect((await pb).outcome.status).toBe('failed');
    expect(pendingInstructionCount()).toBe(0);
  });
});
