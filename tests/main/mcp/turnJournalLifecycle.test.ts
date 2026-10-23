// tests/main/mcp/turnJournalLifecycle.test.ts
//
// # MCP 轮次的"一轮"边界：什么时候开、什么时候关、什么时候不关
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAutoReply } from '../../helpers/autoReplyInstruction';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockGetAllWindows, mockSend, mockIsDestroyed } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn((): unknown[] => []),
  mockSend: vi.fn(),
  mockIsDestroyed: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
  app: {
    getPath: vi.fn(() => '/mock'),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false,
    getName: vi.fn(() => 'qqbat'),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
}));

import { createMcpServer } from '@main/mcp/server';
import { MCP_TURN_JOURNAL_ENV } from '@main/mcp/mcpTurnJournal';
import { TOOL_GUARD_MODE_ENV } from '@main/mcp/mcpToolGuard';
import {
  _resetRunningTurns,
  currentTurnId,
  listTurns,
  readTurn,
  beginTurn,
  endTurn,
  rollbackTurn,
} from '@main/services/flow/turnJournal';

let project: string;
let savedJournal: string | undefined;
let savedGuard: string | undefined;

function mockWindow(): void {
  mockGetAllWindows.mockReturnValue([
    { isDestroyed: mockIsDestroyed, webContents: { send: withAutoReply(mockSend) } } as unknown as object,
  ]);
}

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? '').join('\n');
}

beforeEach(async () => {
  _resetRunningTurns();
  mockSend.mockReset();
  mockIsDestroyed.mockReturnValue(false);
  mockGetAllWindows.mockReset();
  mockWindow();
  savedJournal = process.env[MCP_TURN_JOURNAL_ENV];
  savedGuard = process.env[TOOL_GUARD_MODE_ENV];
  process.env[MCP_TURN_JOURNAL_ENV] = '1';
  process.env[TOOL_GUARD_MODE_ENV] = 'auto';
  project = await mkdtemp(join(tmpdir(), 'qqbat-mcp-x-'));
  await mkdir(join(project, '.qqbat'), { recursive: true });
  await writeFile(
    join(project, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', nodes: [], edges: [] }),
    'utf-8',
  );
});

afterEach(async () => {
  _resetRunningTurns();
  if (savedJournal === undefined) delete process.env[MCP_TURN_JOURNAL_ENV];
  else process.env[MCP_TURN_JOURNAL_ENV] = savedJournal;
  if (savedGuard === undefined) delete process.env[TOOL_GUARD_MODE_ENV];
  else process.env[TOOL_GUARD_MODE_ENV] = savedGuard;
  await rm(project, { recursive: true, force: true });
});

describe('轮次的边界', () => {
  it('★ 两次 mutation 是两轮（不是并成一轮）', async () => {
    const server = createMcpServer({ projectPath: project });
    await server.callTool('add_node', { nodeKind: 'message_send', label: 'a' });
    expect(currentTurnId(project)).toBeNull();
    await server.callTool('add_node', { nodeKind: 'message_send', label: 'b' });
    expect(currentTurnId(project)).toBeNull();
    const turns = await listTurns(project);
    expect(turns).toHaveLength(2);
    // id 可排序：列表第一条是后发生的那一轮
    expect(turns[0].id > turns[1].id).toBe(true);
  });

  it('★ dispose() 不会收掉应用内正在进行的轮次', async () => {
    const appTurn = await beginTurn(project, '应用内的轮次');
    const server = createMcpServer({ projectPath: project });
    await server.dispose();
    expect(currentTurnId(project)).toBe(appTurn);
    expect(await listTurns(project)).toEqual([]);
  });

  it('dispose() 幂等（SSE 关流 + 显式 stop 会各调一次）', async () => {
    const server = createMcpServer({ projectPath: project });
    await server.dispose();
    await expect(server.dispose()).resolves.toBeUndefined();
  });

  it('开关关掉时 mutation 照样派发，只是不记轮次', async () => {
    delete process.env[MCP_TURN_JOURNAL_ENV];
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', { nodeKind: 'message_send', label: 'a' });
    expect(res.isError).toBeFalsy();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await listTurns(project)).toEqual([]);
  });

  it('★ 失败的调用不留轮次（异常也走同一个收尾点）', async () => {
    const server = createMcpServer({ projectPath: project });
    // 缺必填参数：executeTool 里就被挡下（不会派发）。
    // 注意它回的是**普通 result 文本**（"缺少必填参数"），不是 isError —— 见 execute.ts 的
    // missingRequiredArgs 分支，那里刻意不抛错，好让模型自己补参数重试。
    const res = await server.callTool('write_file', { path: 'x.ts' });
    expect(textOf(res)).toContain('缺少必填参数');
    expect(mockSend).not.toHaveBeenCalled();
    expect(await listTurns(project)).toEqual([]);
    expect(currentTurnId(project)).toBeNull();
  });
});
