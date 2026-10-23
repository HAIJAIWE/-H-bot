// tests/main/services/flow/turnProjection.test.ts
//
// 一轮的**投影**：把三份原料（轮次日志 / trace / 元信息）拼成一份视图。
// 这里只测纯函数那一半（不碰盘）：分组、按 turnId 过滤、失败计数、耗时求和。
import { describe, it, expect } from 'vitest';
import { buildTurnProjection } from '@main/services/flow/turnProjection';
import type { TraceEntry } from '@main/services/ai/trace';

const META = { id: 't1', startedAt: '2026-10-18T00:00:00.000Z', userMessage: '改一下', fileCount: 0 };

const tool = (name: string, ok: boolean, ms: number, turnId?: string): TraceEntry => ({
  ts: '2026-10-18T00:00:01.000Z',
  kind: 'tool',
  name,
  ms,
  ok,
  ...(turnId === undefined ? { turnId: 't1' } : { turnId }),
});

describe('★ 轮次投影：从原料拼一份视图', () => {
  it('文件分组：新建 vs 改已有', () => {
    const p = buildTurnProjection(META, { restore: ['src/a.ts'], remove: ['new.txt'] }, []);
    expect(p.files).toEqual([
      { path: 'new.txt', change: 'created' },
      { path: 'src/a.ts', change: 'modified' },
    ]);
    expect(p.stats.fileCount).toBe(2);
  });

  it('没有撤回预览时文件为空（不造一个假文件）', () => {
    const p = buildTurnProjection(META, null, []);
    expect(p.files).toEqual([]);
    expect(p.stats.fileCount).toBe(0);
  });

  it('★ 工具按 turnId 过滤：别的轮次的工具不算进来', () => {
    const p = buildTurnProjection(META, null, [
      tool('read_file', true, 10),
      tool('write_file', false, 20),
      tool('run_command', true, 30, 'other-turn'),
    ]);
    expect(p.tools.map((t) => t.name)).toEqual(['read_file', 'write_file']);
    expect(p.stats.toolCount).toBe(2);
    expect(p.stats.failedTools).toBe(1);
  });

  it('耗时是这一轮所有条目（含模型调用）之和', () => {
    const llm: TraceEntry = { ts: 'x', kind: 'llm', name: 'm', ms: 100, ok: true, turnId: 't1' };
    const p = buildTurnProjection(META, null, [llm, tool('read_file', true, 10)]);
    expect(p.stats.ms).toBe(110);
  });

  it('非工具条目不会混进 tools 列表（llm 不算工具）', () => {
    const llm: TraceEntry = { ts: 'x', kind: 'llm', name: 'model', ms: 5, ok: true, turnId: 't1' };
    const p = buildTurnProjection(META, null, [llm]);
    expect(p.tools).toEqual([]);
    expect(p.stats.toolCount).toBe(0);
  });

  it('★ 行数变化与"动过数据"标记原样带出来（界面卡片与撤回预览同源）', () => {
    const p = buildTurnProjection(
      META,
      {
        restore: ['src/a.ts'],
        remove: [],
        changes: [{ path: 'src/a.ts', kind: 'modified', added: 3, removed: 1, exact: true }],
        data: true,
      },
      [],
    );
    expect(p.changes).toEqual([
      { path: 'src/a.ts', kind: 'modified', added: 3, removed: 1, exact: true },
    ]);
    expect(p.data).toBe(true);
  });

  it('投影不携带文件原文（还原只有一个入口：rollbackTurn）', () => {
    const p = buildTurnProjection(META, { restore: ['a.ts'], remove: [] }, []);
    expect(JSON.stringify(p)).not.toContain('before');
  });
});
