// tests/main/mcp/turnJournalConcurrency.test.ts
//
// # 并发：MCP 与应用内 AI 同时改同一个项目时，轮次归谁
//
// 两条纪律（见 server.ts 的 openTurnIfNeeded / 并发守卫）：
//   ① 已有进行中的轮次 ⇒ **加入**，不抢（抢了会把对方的记录顶掉）；
//   ② 开完轮次到派发之间被别人顶掉 ⇒ **不派发**（改动会落在消失的轮次里，撤不回来）。
//
// ② 的时序在真实世界里是"await 之间插进来一次 beginTurn"，测试里没法靠 sleep 稳定复现，
// 所以这里把 currentTurnId 包一层、**按调用次数**给出"第二次已经不是我"的序列 ——
// 触发的是同一行判断，不改变被测代码。
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

/** 只替换 currentTurnId 一个导出：其余（beginTurn/endTurn/文件读写）仍走真实实现 */
vi.mock('@main/services/flow/turnJournal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/flow/turnJournal')>();
  return { ...actual, currentTurnId: vi.fn(actual.currentTurnId) };
});

import { createMcpServer } from '@main/mcp/server';
import { MCP_TURN_JOURNAL_ENV } from '@main/mcp/mcpTurnJournal';
import { TOOL_GUARD_MODE_ENV } from '@main/mcp/mcpToolGuard';
import {
  _resetRunningTurns,
  currentTurnId,
  listTurns,
  peekTurn,
  beginTurn,
  endTurn,
} from '@main/services/flow/turnJournal';

const currentTurnIdMock = vi.mocked(currentTurnId);

let project: string;
let savedJournal: string | undefined;
let savedGuard: string | undefined;

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? '').join('\n');
}

beforeEach(async () => {
  _resetRunningTurns();
  currentTurnIdMock.mockClear();
  mockSend.mockReset();
  mockIsDestroyed.mockReturnValue(false);
  mockGetAllWindows.mockReset();
  mockGetAllWindows.mockReturnValue([
    { isDestroyed: mockIsDestroyed, webContents: { send: withAutoReply(mockSend) } } as unknown as object,
  ]);
  savedJournal = process.env[MCP_TURN_JOURNAL_ENV];
  savedGuard = process.env[TOOL_GUARD_MODE_ENV];
  process.env[MCP_TURN_JOURNAL_ENV] = '1';
  process.env[TOOL_GUARD_MODE_ENV] = 'auto';
  project = await mkdtemp(join(tmpdir(), 'qqbat-mcp-conc-'));
  await mkdir(join(project, '.qqbat'), { recursive: true });
  await writeFile(
    join(project, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', nodes: [], edges: [] }),
    'utf-8',
  );
});

afterEach(async () => {
  _resetRunningTurns();
  currentTurnIdMock.mockReset();
  if (savedJournal === undefined) delete process.env[MCP_TURN_JOURNAL_ENV];
  else process.env[MCP_TURN_JOURNAL_ENV] = savedJournal;
  if (savedGuard === undefined) delete process.env[TOOL_GUARD_MODE_ENV];
  else process.env[TOOL_GUARD_MODE_ENV] = savedGuard;
  await rm(project, { recursive: true, force: true });
});

describe('并发：加入而不是抢占', () => {
  it('★ 应用内已有轮次 ⇒ MCP 的 before 记进**那一轮**', async () => {
    await writeFile(join(project, 'a.ts'), 'OLD\n', 'utf-8');
    const appTurn = await beginTurn(project, '用户原话');
    const server = createMcpServer({ projectPath: project });
    // 先读后写：这条用例要测的是轮次归属，别被 writeGuard 的"没读过"挡在前面
    await server.callTool('read_file', { path: 'a.ts' });
    const res = await server.callTool('write_file', { path: 'a.ts', content: 'NEW\n' });
    expect(res.isError).toBeFalsy();
    // 轮次还是应用内那一轮，且 before 已经记进去了
    expect(currentTurnId(project)).toBe(appTurn);
    expect(peekTurn(project)?.files?.map((f: { path: string }) => f.path)).toEqual(['a.ts']);
    await endTurn(project, { hadChanges: true });
    const turns = await listTurns(project);
    expect(turns[0].userMessage).toBe('用户原话');
    expect(turns[0].fileCount).toBe(1);
  });

  it('★ 轮次被顶掉 ⇒ 报并发冲突、不发指令、也不替别人收尾', async () => {
    // 第一次问"有没有轮次"（openTurnIfNeeded）→ 没有；
    // 第二次问（派发前的守卫）→ 已经是别人的轮次了
    currentTurnIdMock.mockReturnValueOnce(null).mockReturnValueOnce('someone-else-turn');
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', { nodeKind: 'message_send', label: 'a' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('并发冲突');
    expect(mockSend).not.toHaveBeenCalled();
    // 守卫把 openTurn 置空了：dispose 时不会去 endTurn 别人的轮次
    await server.dispose();
  });
});
