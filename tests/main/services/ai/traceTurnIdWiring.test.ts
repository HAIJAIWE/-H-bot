// tests/main/services/ai/traceTurnIdWiring.test.ts
//
// # P1-7 的运行时证据：trace 行真的挂到了当前轮
//
// trace.test.ts 只证明"字段能存能读"；本用例证明**写入方**（chatRun 的工具分发）
// 真的去 turnJournal 取了 turnId —— 否则字段永远是空的，而单测照样绿。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchToolCalls, type ChatRunState } from '@main/services/ai/chatRun';
import { beginTurn, endTurn } from '@main/services/flow/turnJournal';

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-trace-wiring-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
});

function makeState(): ChatRunState {
  return {
    projectPath,
    win: { webContents: { send: vi.fn() }, isDestroyed: () => false } as never,
    signal: new AbortController().signal,
    messages: [],
    pendingOperations: [],
    fullResponse: '',
    hadToolCalls: false,
    isBatchMode: () => false,
    onBatchToolFailure: vi.fn(),
  } as unknown as ChatRunState;
}

describe('★ trace 的 turnId 来自 turnJournal（P1-7 接线）', () => {
  it('★ 开了轮次 ⇒ 每条工具 trace 都带同一个 turnId', async () => {
    const turnId = await beginTurn(projectPath, '测试：列一下节点');
    try {
      await dispatchToolCalls(makeState(), [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'list_nodes', arguments: '{}' },
        },
      ]);
    } finally {
      await endTurn(projectPath, { hadChanges: false });
    }
    // trace 是 fire-and-forget（void appendTrace），等一拍再读
    await new Promise((r) => setTimeout(r, 30));

    const raw = await readFile(join(projectPath, '.qqbat', 'ai-trace.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l) as { turnId?: string });
    expect(lines.length, '至少有一条工具 trace').toBeGreaterThan(0);
    expect(lines.map((l) => l.turnId)).toEqual(lines.map(() => turnId));
  });
});
