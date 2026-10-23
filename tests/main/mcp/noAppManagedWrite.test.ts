// tests/main/mcp/noAppManagedWrite.test.ts
//
// # 应用自己管理的文件：外部客户端一律不许写
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

// 为什么这一层必须在主进程：渲染层也会拦，但那时外面已经拿到 "dispatched" 了 ——
// 客户端以为改动生效，实际什么都没写（谎报）。
const BLOCKED = [
  '.qqbat/flow.json',
  '.qqbat/project.json',
  'src/plugins/generated/x.ts',
  'src/plugins/exported/y.js',
];
const ALLOWED = [
  '.qqbat/flow.json.bak',
  'src/plugins/generated-notes.md',
];

describe('应用管理的文件被拒，且不是"虚拒"', () => {
  it.each(BLOCKED)('★ %s 被拒绝，且不发 ai:clientInstruction', async (path) => {
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('write_file', { path, content: 'x' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('应用自己管理');
    expect(mockSend).not.toHaveBeenCalled();
    // 拒绝发生在开轮次之前：不该留下空轮次
    expect(await listTurns(project)).toEqual([]);
  });

  it.each(ALLOWED)('%s 只是"像"，不该被误锁', async (path) => {
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('write_file', { path, content: 'x' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('dispatched');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
