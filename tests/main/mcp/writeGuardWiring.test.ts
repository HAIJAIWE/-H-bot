// tests/main/mcp/writeGuardWiring.test.ts
//
// # writeGuard 真的接在 MCP 这条路上（不是只写在 writeGuard.ts 里）
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

describe('先读后写', () => {
  it('★ 覆盖一个没读过的文件 ⇒ 拒绝，且不发指令', async () => {
    await mkdir(join(project, 'plugins', 'a'), { recursive: true });
    await writeFile(join(project, 'plugins', 'a', 'index.js'), '// 用户手写\n', 'utf-8');
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('write_file', { path: 'plugins/a/index.js', content: 'x' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('你还没读过它');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('★ 先 read_file 再写 ⇒ 放行', async () => {
    await mkdir(join(project, 'plugins', 'a'), { recursive: true });
    await writeFile(join(project, 'plugins', 'a', 'index.js'), '// 用户手写\n', 'utf-8');
    const server = createMcpServer({ projectPath: project });
    const read = await server.callTool('read_file', { path: 'plugins/a/index.js' });
    expect(read.isError).toBeFalsy();
    const res = await server.callTool('write_file', { path: 'plugins/a/index.js', content: '// 改过\n' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('dispatched');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('新文件不需要先读（磁盘上没有可覆盖的东西）', async () => {
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('write_file', { path: 'fresh.ts', content: 'x' });
    expect(res.isError).toBeFalsy();
  });

  it('write_code 走的是 filePath 字段，同样受"先读后写"约束', async () => {
    await writeFile(join(project, 'notes.md'), 'old', 'utf-8');
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('write_code', { filePath: 'notes.md', content: 'new' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('你还没读过它');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('读过的记录按项目隔离（换个项目就又要先读）', async () => {
    await writeFile(join(project, 'a.ts'), 'old', 'utf-8');
    const other = await mkdtemp(join(tmpdir(), 'qqbat-mcp-other-'));
    try {
      await writeFile(join(other, 'a.ts'), 'old', 'utf-8');
      const serverA = createMcpServer({ projectPath: project });
      await serverA.callTool('read_file', { path: 'a.ts' });
      const serverB = createMcpServer({ projectPath: other });
      const res = await serverB.callTool('write_file', { path: 'a.ts', content: 'new' });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain('你还没读过它');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
