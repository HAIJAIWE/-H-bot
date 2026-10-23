// tests/main/services/ai/trace.test.ts
//
// # 闸门：结构化 trace —— 一行一个 JSON，可直接聚合
//
// 文本日志能看出"第几轮"，看不出"哪一步慢/失败/多大"。多智能体上线后更明显：
// 一次对话里有主循环、复核（llm）、侦察（静态），文本里分不清谁是谁。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendTrace,
  KEEP_LINES,
  MAX_TRACE_BYTES,
  readTrace,
  traceFilePath,
} from '@main/services/ai/trace';

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'qqbat-trace-'));
  await mkdir(join(project, '.qqbat'), { recursive: true });
});

const entry = (over: Partial<Parameters<typeof appendTrace>[1]> = {}) => ({
  ts: new Date().toISOString(),
  kind: 'tool' as const,
  name: 'list_nodes',
  ms: 12,
  ok: true,
  ...over,
});

describe('trace', () => {
  it('★ 一行一个 JSON，字段齐全（可直接 jq/node 聚合）', async () => {
    await appendTrace(project, entry({ kind: 'llm', name: 'qwen-max', ms: 800, agent: 'builder' }));
    await appendTrace(project, entry({ name: 'apply_template', ok: false, note: '被拒绝' }));

    const raw = await readFile(traceFilePath(project), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    expect(first.kind).toBe('llm');
    expect(first.name).toBe('qwen-max');
    // 第二行是被拒绝的提案：ok=false 与 note 都要留着，聚合时才能区分「慢」和「失败」
    const second = JSON.parse(lines[1]);
    expect(second.kind).toBe('tool');
    expect(second.name).toBe('apply_template');
    expect(second.ok).toBe(false);
    expect(second.note).toBe('被拒绝');
  });

  it('★ 超过上限时轮转：只留最近 KEEP_LINES 行，文件不会无限长', async () => {
    // 2026-10-24 恢复注：原文件这段头部在 porter 拼装时被吃掉（只剩空行）。
    // 按下方「造一个超大文件」用例的意图补回 —— 一行就超上限时也必须轮转，否则 trace 会撑爆磁盘。
    const file = traceFilePath(project);
    await writeFile(file, 'x'.repeat(MAX_TRACE_BYTES + 10) + '\n', 'utf-8');
    await appendTrace(project, entry());

    const raw = await readFile(file, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(KEEP_LINES + 1);
    expect(raw.length).toBeLessThan(MAX_TRACE_BYTES);
  });

  it('坏行/不存在时读回不炸（一行坏不该毁掉整份 trace）', async () => {
    expect(await readTrace(project)).toEqual([]); // 文件还不存在
    await writeFile(traceFilePath(project), '{坏行\n' + JSON.stringify(entry()) + '\n', 'utf-8');
    const back = await readTrace(project);
    expect(back.length).toBe(1);
    expect(back[0].name).toBe('list_nodes');
  });

  it('★ 带 turnId 时能被同一个键筛出来（P1-7：一次任务的所有行可串联）', async () => {
    await appendTrace(project, entry({ kind: 'llm', name: 'm', turnId: 'turn-a' }));
    await appendTrace(project, entry({ kind: 'tool', name: 'read_flow', turnId: 'turn-a' }));
    await appendTrace(project, entry({ kind: 'tool', name: 'list_nodes', turnId: 'turn-b' }));
    // 没开轮次的调用（如 MCP 直调）不该被硬塞一个 null
    await appendTrace(project, entry({ kind: 'tool', name: 'preview_flow' }));

    const all = await readTrace(project);
    expect(all.filter((e) => e.turnId === 'turn-a').map((e) => e.name)).toEqual(['m', 'read_flow']);
    expect(all.filter((e) => e.turnId === 'turn-b')).toHaveLength(1);
    expect(all.filter((e) => e.turnId === undefined)).toHaveLength(1);
  });
});
