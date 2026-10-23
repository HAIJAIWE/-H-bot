// tests/main/mcp/turnJournalRecovery.test.ts
//
// # 恢复：进程重启后，外部客户端做过的改动仍然能撤回
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

describe('重启后仍可撤回', () => {
  it('★ MCP 写过的文件，新 server 实例能从轮次历史里撤回', async () => {
    await writeFile(join(project, 'a.ts'), 'OLD\n', 'utf-8');
    const first = createMcpServer({ projectPath: project });
    // 先读后写（writeGuard：整文件覆盖必须先读过）
    await first.callTool('read_file', { path: 'a.ts' });
    const res = await first.callTool('write_file', { path: 'a.ts', content: 'NEW\n' });
    expect(res.isError).toBeFalsy();
    // 渲染层收到指令后真的落盘（这里手动模拟）
    await writeFile(join(project, 'a.ts'), 'NEW\n', 'utf-8');

    // 进程"重启"：新实例 + 内存里的 RUNNING 清空（只剩磁盘上的轮次文件）
    _resetRunningTurns();
    const second = createMcpServer({ projectPath: project });
    expect(second.getTools().length).toBeGreaterThan(0);

    const turns = await listTurns(project);
    expect(turns).toHaveLength(1);
    const view = await readTurn(project, turns[0].id);
    expect(view?.restore).toEqual(['a.ts']);

    const rolled = await rollbackTurn(project, turns[0].id);
    expect(rolled.restored).toEqual(['a.ts']);
    expect(await readFile(join(project, 'a.ts'), 'utf-8')).toBe('OLD\n');
    expect(await listTurns(project)).toEqual([]);
  });

  it('★ 新建文件的轮次：撤回 = 把文件删掉', async () => {
    const server = createMcpServer({ projectPath: project });
    await server.callTool('write_file', { path: 'brand-new.ts', content: 'x\n' });
    await writeFile(join(project, 'brand-new.ts'), 'x\n', 'utf-8');
    const turns = await listTurns(project);
    const rolled = await rollbackTurn(project, turns[0].id);
    expect(rolled.removed).toEqual(['brand-new.ts']);
  });

  it('flow.json 快照随轮次落盘（重启后仍能拿回"改之前那张图"）', async () => {
    const before = await readFile(join(project, '.qqbat', 'flow.json'), 'utf-8');
    const server = createMcpServer({ projectPath: project });
    await server.callTool('add_node', { nodeKind: 'message_send', label: 'a' });
    _resetRunningTurns();
    const turns = await listTurns(project);
    const rolled = await rollbackTurn(project, turns[0].id);
    expect(rolled.flowSnapshot).toBe(before);
  });
});
