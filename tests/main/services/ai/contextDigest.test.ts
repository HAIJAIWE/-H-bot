// tests/main/services/ai/contextDigest.test.ts
import { describe, it, expect } from 'vitest';
import { digestDroppedHistory } from '@main/services/ai/contextDigest';
import type { HistoryEntry } from '@main/services/ai/historyStore';

const e = (role: HistoryEntry['role'], content: string): HistoryEntry => ({
  ts: '2026-10-19T00:00:00.000Z',
  role,
  content,
});

describe('★ 历史压缩摘要（确定性）', () => {
  it('★ 只摘要被裁掉的部分；保留部分不重复出现', () => {
    const entries = [e('user', '旧问题A'), e('assistant', '旧回答A'), e('user', '新问题'), e('assistant', '新回答')];
    const kept = entries.slice(2);
    const digest = digestDroppedHistory(entries, kept);
    expect(digest).toContain('用户：旧问题A');
    expect(digest).toContain('助手：旧回答A');
    expect(digest).not.toContain('新问题');
  });

  it('attempt 不进摘要（失败尝试不是对话内容）', () => {
    const entries = [e('user', 'a'), e('assistant', 'b'), { ...e('attempt', '失败的尝试'), reason: 'error' as const }];
    const digest = digestDroppedHistory(entries, []);
    expect(digest).not.toContain('失败的尝试');
  });

  it('少于两条用户消息 → 不摘要（已有"N 条省略"注记，别更吵）', () => {
    expect(digestDroppedHistory([e('user', '只有一个问题')], [])).toBe('');
  });

  it('有上限：超长内容截断并明确"继续省略"', () => {
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < 40; i += 1) {
      entries.push(e('user', '很长的用户消息'.repeat(10)));
      entries.push(e('assistant', '很长的助手回答'.repeat(10)));
    }
    const digest = digestDroppedHistory(entries, []);
    expect(digest.length).toBeLessThan(1600);
    expect(digest).toContain('继续省略');
  });
});
