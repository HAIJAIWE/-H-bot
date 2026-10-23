// tests/main/mcp/toolApproval.test.ts
//
// # MCP 的工具闸：判据同源 + 真的停下来等
//
// 现场（P0-13 ①）：助手路径每个工具都过 classifyTool，MCP 的 callTool 却直接派发 ——
// 外部 IDE 一句话就能起停机器人、跑测试（会写玩家数据）、调能力，从来没有经过用户。
//
// 三条纪律：
//   ① 判据必须与助手路径**同一个函数**（toolGuard.classifyTool），不另造一张危险表；
//   ② 没有窗口 = 拒绝（fail-safe），不能默认放行；
//   ③ 用户拒绝 / 超时 = 拒绝，被拒的调用一条指令都不发。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAutoReply } from '../../helpers/autoReplyInstruction';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockSend, mockIsDestroyed, mockGetAllWindows } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockIsDestroyed: vi.fn(() => false),
  mockGetAllWindows: vi.fn((): unknown[] => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
  app: {
    getPath: vi.fn((name: string) => `/mock/${name}`),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false,
    getName: vi.fn(() => 'qqbat'),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
}));

import { createMcpServer } from '@main/mcp/server';
import { mcpToolVerdict, resolveGuardMode, TOOL_GUARD_MODE_ENV } from '@main/mcp/mcpToolGuard';
import { MCP_TURN_JOURNAL_ENV } from '@main/mcp/mcpTurnJournal';
import { getToolCategory } from '@main/services/ai/tools';
import { classifyTool } from '@main/services/ai/toolGuard';
import { resolveApproval, _resetApprovals } from '@main/services/ai/toolApproval';

let project: string;
let savedGuard: string | undefined;
let savedJournal: string | undefined;

function makeWin(): unknown {
  return { isDestroyed: mockIsDestroyed, webContents: { send: withAutoReply(mockSend) } };
}

function sentChannels(): string[] {
  return mockSend.mock.calls.map((c) => String(c[0]));
}

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? '').join('\n');
}

/** 从已发出的 ai:approvalRequest 里取 callId，并回一个决定 */
function answerApproval(decision: 'allow' | 'deny' | 'always'): void {
  const call = mockSend.mock.calls.find((c) => c[0] === 'ai:approvalRequest');
  expect(call, '应当先发出 ai:approvalRequest（不能直接派发）').toBeTruthy();
  const payload = call?.[1] as { callId?: string };
  expect(payload?.callId).toBeTruthy();
  expect(resolveApproval(payload.callId as string, decision)).toBe(true);
}

beforeEach(async () => {
  _resetApprovals();
  mockSend.mockReset();
  mockIsDestroyed.mockReset();
  mockIsDestroyed.mockReturnValue(false);
  mockGetAllWindows.mockReset();
  mockGetAllWindows.mockReturnValue([makeWin()]);
  savedGuard = process.env[TOOL_GUARD_MODE_ENV];
  savedJournal = process.env[MCP_TURN_JOURNAL_ENV];
  delete process.env[TOOL_GUARD_MODE_ENV]; // 走默认 acceptEdits
  delete process.env[MCP_TURN_JOURNAL_ENV];
  project = await mkdtemp(join(tmpdir(), 'qqbat-mcp-approval-'));
  await mkdir(join(project, '.qqbat'), { recursive: true });
  await writeFile(
    join(project, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', nodes: [], edges: [] }),
    'utf-8',
  );
});

afterEach(async () => {
  _resetApprovals();
  if (savedGuard === undefined) delete process.env[TOOL_GUARD_MODE_ENV];
  else process.env[TOOL_GUARD_MODE_ENV] = savedGuard;
  if (savedJournal === undefined) delete process.env[MCP_TURN_JOURNAL_ENV];
  else process.env[MCP_TURN_JOURNAL_ENV] = savedJournal;
  await rm(project, { recursive: true, force: true });
});

describe('★ 判据：与助手路径同一个函数（不是新造的危险工具表）', () => {
  it('不可撤回的 ⇒ ask；纯读 / 可撤回的写 ⇒ auto', () => {
    for (const name of ['run_bot', 'stop_bot', 'run_test', 'invoke_capability']) {
      expect(mcpToolVerdict(name), `${name} 必须问用户`).toBe('ask');
    }
    for (const name of ['read_flow', 'list_nodes', 'read_code', 'write_code']) {
      expect(mcpToolVerdict(name), `${name} 不该问`).toBe('auto');
    }
  });

  it('★ 改图类在 MCP 下必须问（外部客户端没有提案卡片）', () => {
    for (const name of ['add_node', 'connect_nodes', 'delete_node', 'apply_template']) {
      expect(mcpToolVerdict(name), `${name} 在 MCP 下必须问`).toBe('ask');
    }
  });

  it('★ 同源：结论 = classifyTool(..., { mode, context: "mcp" }) 算出来的', () => {
    // 断言的是"接线用的是那条判据"，而不是在这里再列一遍表
    for (const name of ['run_bot', 'run_test', 'read_flow', 'add_node', 'begin_batch']) {
      expect(mcpToolVerdict(name)).toBe(
        classifyTool(name, getToolCategory(name), {
          mode: resolveGuardMode(),
          context: 'mcp',
        }),
      );
    }
  });

  it('模式解析：默认 acceptEdits；可被 QQBAT_TOOL_GUARD 覆盖；乱填回默认', () => {
    expect(resolveGuardMode({} as NodeJS.ProcessEnv)).toBe('acceptEdits');
    expect(resolveGuardMode({ [TOOL_GUARD_MODE_ENV]: 'auto' } as NodeJS.ProcessEnv)).toBe('auto');
    expect(resolveGuardMode({ [TOOL_GUARD_MODE_ENV]: 'readonly' } as NodeJS.ProcessEnv)).toBe(
      'readonly',
    );
    expect(resolveGuardMode({ [TOOL_GUARD_MODE_ENV]: '乱填' } as NodeJS.ProcessEnv)).toBe(
      'acceptEdits',
    );
  });
});

describe('★ 真的停下来等（不是发条提示就继续）', () => {
  it('allow ⇒ 才派发', async () => {
    const server = createMcpServer({ projectPath: project });
    const pending = server.callTool('add_node', {
      nodeKind: 'message_send',
      label: 'x',
      position: { x: 0, y: 0 },
    });

    await vi.waitFor(() => expect(sentChannels()).toContain('ai:approvalRequest'));
    // 关键：问的时候**还没派发**
    expect(sentChannels()).not.toContain('ai:clientInstruction');

    answerApproval('allow');
    const res = await pending;
    expect(res.isError).toBeFalsy();
    expect(sentChannels()).toContain('ai:clientInstruction');
  });

  it('deny ⇒ isError，且一条指令都不发', async () => {
    const server = createMcpServer({ projectPath: project });
    const pending = server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    await vi.waitFor(() => expect(sentChannels()).toContain('ai:approvalRequest'));
    answerApproval('deny');
    const res = await pending;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('用户拒绝');
    expect(sentChannels()).not.toContain('ai:clientInstruction');
  });

  it('always ⇒ 本连接内不再问第二次', async () => {
    const server = createMcpServer({ projectPath: project });
    const first = server.callTool('add_node', { nodeKind: 'message_send', label: 'a' });
    await vi.waitFor(() => expect(sentChannels()).toContain('ai:approvalRequest'));
    answerApproval('always');
    await first;

    mockSend.mockClear();
    const second = await server.callTool('add_node', { nodeKind: 'message_send', label: 'b' });
    expect(second.isError).toBeFalsy();
    expect(sentChannels()).not.toContain('ai:approvalRequest');
    expect(sentChannels()).toContain('ai:clientInstruction');
  });

  it('★ 没有窗口 ⇒ 拒绝（fail-safe），不能默认放行', async () => {
    mockGetAllWindows.mockReturnValue([]);
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('窗口');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('★ 模式覆盖（与助手路径同一个环境变量）', () => {
  it('readonly ⇒ 连可撤回的写也要问；拒绝后不派发', async () => {
    process.env[TOOL_GUARD_MODE_ENV] = 'readonly';
    const server = createMcpServer({ projectPath: project });
    const pending = server.callTool('write_file', { path: 'new.ts', content: 'x' });
    await vi.waitFor(() => expect(sentChannels()).toContain('ai:approvalRequest'));
    answerApproval('deny');
    const res = await pending;
    expect(res.isError).toBe(true);
    expect(sentChannels()).not.toContain('ai:clientInstruction');
  });

  it('auto ⇒ 连不可撤回的也不问，直接派发', async () => {
    process.env[TOOL_GUARD_MODE_ENV] = 'auto';
    const server = createMcpServer({ projectPath: project });
    const res = await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    expect(res.isError).toBeFalsy();
    expect(sentChannels()).not.toContain('ai:approvalRequest');
    expect(sentChannels()).toContain('ai:clientInstruction');
  });
});
