// tests/main/services/agent-core/sessionLog.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SessionLog } from '@main/services/agent-core/sessionLog';

describe('★ 会话事件日志', () => {
  it('seq 单调递增，since 只取之后的', async () => {
    const log = new SessionLog();
    await log.append({ type: 'turn.start', payload: {} });
    await log.append({ type: 'tool.call', payload: { name: 'read_file' } });
    await log.append({ type: 'tool.result', payload: { ok: true } });
    expect(log.all().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.since(1).map((e) => e.type)).toEqual(['tool.call', 'tool.result']);
  });

  it('★ 每次追加都通知持久层（崩溃可恢复）', async () => {
    const append = vi.fn();
    const log = new SessionLog({ append, load: () => [] });
    await log.append({ type: 'note', payload: 'x' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ seq: 1, type: 'note' }));
  });

  it('★ fork：只保留到某条，seq 重排从 1 开始（分叉是独立会话）', async () => {
    const log = new SessionLog();
    await log.append({ type: 'a', payload: 1 });
    await log.append({ type: 'b', payload: 2 });
    await log.append({ type: 'c', payload: 3 });
    const forked = log.fork(2);
    expect(forked.all().map((e) => e.type)).toEqual(['a', 'b']);
    expect(forked.all().map((e) => e.seq)).toEqual([1, 2]);
  });

  it('restore 从持久层读回并按 seq 排序', async () => {
    const log = new SessionLog({
      append: () => {},
      load: async () => [
        { seq: 2, ts: 't2', type: 'b', payload: 2 },
        { seq: 1, ts: 't1', type: 'a', payload: 1 },
      ],
    });
    expect(await log.restore()).toBe(2);
    expect(log.all().map((e) => e.type)).toEqual(['a', 'b']);
  });
});
