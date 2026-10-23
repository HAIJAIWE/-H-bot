// tests/main/mcp/turnJournal.test.ts
//
// # MCP 这一侧也要能"撤回这一轮"
// 背景：外部 IDE 通过 MCP 调工具时**不经过 AI 会话**，也就没有 autoTx 帮忙开/收轮次；
// 于是 MCP 自己开一轮，让「应用内撤回这一轮」同样能撤掉外部客户端做的改动。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAutoReply } from '../../helpers/autoReplyInstruction';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
  // 本文件测的是轮次接线，不是工具闸：闸单独在 toolApproval.test.ts 里钉
  process.env[TOOL_GUARD_MODE_ENV] = 'auto';
  project = await mkdtemp(join(tmpdir(), 'qqbat-mcp-turn-'));
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

describe('MCP 调用会自己开一轮，并在收尾时落盘', () => {
  it('★ mutation 派发成功 ⇒ 一条带「MCP：工具名」的轮次', async () => {
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', {
      nodeKind: 'message_send',
      label: 'x',
      position: { x: 0, y: 0 },
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('dispatched');
    // 指令真的发给了渲染层（否则"dispatched"是谎报）
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [channel, payload] = mockSend.mock.calls[0] as [string, { projectPath: string }];
    expect(channel).toBe('ai:clientInstruction');
    expect(payload.projectPath).toBe(project);

    const turns = await listTurns(project);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe('MCP：add_node');
    // 收尾后内存里不该还挂着这一轮
    expect(currentTurnId(project)).toBeNull();
  });

  it('★ 派发失败（没有应用窗口）⇒ 没有改动 ⇒ 不落盘', async () => {
    mockGetAllWindows.mockReturnValue([]);
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('指令未执行');
    expect(await listTurns(project)).toEqual([]);
  });

  it('query 类工具不记轮次（读文件不是"一轮改动"）', async () => {
    await writeFile(join(project, 'a.ts'), 'export const a = 1;\n', 'utf-8');
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('read_file', { path: 'a.ts' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('export const a = 1');
    expect(await listTurns(project)).toEqual([]);
    expect(currentTurnId(project)).toBeNull();
  });

  it('写文件工具：before 在派发**之前**就记进轮次（新建文件记 null）', async () => {
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('write_file', { path: 'brand-new.ts', content: 'x\n' });
    expect(res.isError).toBeFalsy();
    const turns = await listTurns(project);
    expect(turns).toHaveLength(1);
    expect(turns[0].fileCount).toBe(1);
    const view = await readTurn(project, turns[0].id);
    expect(view?.remove).toEqual(['brand-new.ts']);
    expect(view?.changes[0]).toMatchObject({ path: 'brand-new.ts', kind: 'added' });
  });

  it('开关关掉时 MCP 完全不记轮次（默认关闭，靠 env 显式打开）', async () => {
    delete process.env[MCP_TURN_JOURNAL_ENV];
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    expect(res.isError).toBeFalsy();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await listTurns(project)).toEqual([]);
    expect(currentTurnId(project)).toBeNull();
  });
});

describe('收尾只认自己的轮次', () => {
  it('★ 应用内已有轮次时 MCP 只"加入"，不抢、也不替它收尾', async () => {
    const appTurn = await beginTurn(project, '用户在应用内的原话');
    const server = createMcpServer({ projectPath: project });
    await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    // 别人的轮次还开着
    expect(currentTurnId(project)).toBe(appTurn);
    expect(await listTurns(project)).toEqual([]);
    await endTurn(project, { hadChanges: true });
    expect((await listTurns(project))[0].userMessage).toBe('用户在应用内的原话');
  });
});
