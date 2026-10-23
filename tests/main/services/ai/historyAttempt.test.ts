// tests/main/services/ai/historyAttempt.test.ts
//
// **失败尝试留痕**（对齐 DSH assistant/attempt）：进日志、可追溯，但**不进模型历史**。
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendHistoryEntries,
  historyFilePath,
  historyToMessages,
  loadHistory,
} from '@main/services/ai/historyStore';

describe('★ 失败尝试（attempt）：进日志、不进模型历史', () => {
  it('写进去能读回来，reason/ok 保留', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-attempt-'));
    await appendHistoryEntries(ws, [
      { ts: new Date().toISOString(), role: 'user', content: '做点事' },
      {
        ts: new Date().toISOString(),
        role: 'attempt',
        content: '模型返回 500',
        reason: 'error',
        ok: false,
      },
    ]);
    const entries = await loadHistory(ws);
    expect(entries.map((e) => e.role)).toEqual(['user', 'attempt']);
    expect(entries[1]).toMatchObject({ reason: 'error', ok: false });
  });

  it('★ 不进模型历史，也不占记忆预算', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-attempt-'));
    await appendHistoryEntries(ws, [
      { ts: new Date().toISOString(), role: 'user', content: '第一句' },
      {
        ts: new Date().toISOString(),
        role: 'attempt',
        content: 'x'.repeat(5000),
        reason: 'cancelled',
      },
      { ts: new Date().toISOString(), role: 'assistant', content: '第一句的回答' },
    ]);
    const { messages } = historyToMessages(await loadHistory(ws));
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(messages)).not.toContain('xxxx');
  });

  it('普通对话行不带 attempt 字段（老版本仍读得懂）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-attempt-'));
    await appendHistoryEntries(ws, [
      { ts: new Date().toISOString(), role: 'user', content: '你好' },
    ]);
    const raw = await readFile(historyFilePath(ws), 'utf-8');
    expect(raw).not.toContain('"reason"');
    expect(raw).not.toContain('"ok"');
  });
});
