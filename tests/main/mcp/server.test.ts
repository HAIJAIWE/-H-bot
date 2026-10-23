// tests/main/mcp/server.test.ts
//
// # MCP Server 的基本契约（10/18 构建）
//
// 这份文件原先被 porter 截成"两段 revision 拼在一起"（一半断言 status:'applied' + requestId
// 回执协议，一半还留着 'ai:executeInstruction' 的老故事）。当前构建的契约是：
//   · mutation 类工具经 `ai:clientInstruction` 派发给渲染层，回 `{ status: 'dispatched', instruction }`；
//   · **没有** requestId 回执等待（那是更晚的 revision）；
//   · 没有窗口 / 窗口已销毁 ⇒ isError，且一条指令都不发（不能谎报 dispatched）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAutoReply } from '../../helpers/autoReplyInstruction';

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
import { TOOL_GUARD_MODE_ENV } from '@main/mcp/mcpToolGuard';
import { MCP_TURN_JOURNAL_ENV } from '@main/mcp/mcpTurnJournal';

let savedGuard: string | undefined;
let savedJournal: string | undefined;

function makeWin(): unknown {
  return { isDestroyed: mockIsDestroyed, webContents: { send: withAutoReply(mockSend) } };
}

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? '').join('\n');
}

beforeEach(() => {
  mockSend.mockReset();
  mockIsDestroyed.mockReset();
  mockIsDestroyed.mockReturnValue(false);
  mockGetAllWindows.mockReset();
  mockGetAllWindows.mockReturnValue([]);
  savedGuard = process.env[TOOL_GUARD_MODE_ENV];
  savedJournal = process.env[MCP_TURN_JOURNAL_ENV];
  // 这一组只验"派发通道"，闸门与轮次各有专门的文件
  process.env[TOOL_GUARD_MODE_ENV] = 'auto';
  delete process.env[MCP_TURN_JOURNAL_ENV];
});

afterEach(() => {
  if (savedGuard === undefined) delete process.env[TOOL_GUARD_MODE_ENV];
  else process.env[TOOL_GUARD_MODE_ENV] = savedGuard;
  if (savedJournal === undefined) delete process.env[MCP_TURN_JOURNAL_ENV];
  else process.env[MCP_TURN_JOURNAL_ENV] = savedJournal;
});

describe('MCP Server', () => {
  it('创建 server 实例并暴露工具清单', () => {
    const server = createMcpServer({ projectPath: '/test' });
    expect(server).toBeDefined();
    expect(server.getTools()).toContain('list_nodes');
    expect(server.getTools()).toContain('read_flow');
  });

  it('listTools 返回 MCP 协议形状（name/description/inputSchema）', async () => {
    const server = createMcpServer({ projectPath: '/test' });
    const result = await server.listTools();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
    const listNodes = result.tools.find((t: { name: string }) => t.name === 'list_nodes');
    expect(listNodes).toBeDefined();
    expect(listNodes).toHaveProperty('description');
    expect(listNodes).toHaveProperty('inputSchema');
  });

  it('callTool 直接执行 query 类工具（不经提案）', async () => {
    const server = createMcpServer({ projectPath: '/test' });
    const result = await server.callTool('list_nodes', {});
    expect(result.content).toBeInstanceOf(Array);
    expect(result.content[0]).toHaveProperty('type', 'text');
  });

  it('★ mutation 走 ai:clientInstruction（preload 唯一监听的通道）', async () => {
    mockGetAllWindows.mockReturnValue([makeWin()]);
    const server = createMcpServer({ projectPath: '/proj-1' });
    const result = await server.callTool('add_node', {
      nodeKind: 'message_send',
      label: '测试节点',
      position: { x: 10, y: 20 },
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [channel, payload] = mockSend.mock.calls[0];
    // 必须是 ai:clientInstruction —— 历史上发过 ai:executeInstruction，全仓无人监听，指令静默丢失
    expect(channel).toBe('ai:clientInstruction');
    expect(payload).toHaveProperty('projectPath', '/proj-1');
    expect(payload.instruction).toHaveProperty('name', 'add_node');
    expect(payload.instruction.args).toHaveProperty('label', '测试节点');

    const parsed = JSON.parse(textOf(result));
    expect(parsed).toHaveProperty('status', 'dispatched');
    expect(parsed.instruction).toHaveProperty('name', 'add_node');
  });

  it('无可用窗口 ⇒ isError 且不发指令（不能谎报 dispatched）', async () => {
    const server = createMcpServer({ projectPath: '/proj-3' });
    const result = await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('窗口');
  });

  it('窗口已销毁 ⇒ 同样按失败处理', async () => {
    mockIsDestroyed.mockReturnValue(true);
    mockGetAllWindows.mockReturnValue([makeWin()]);
    const server = createMcpServer({ projectPath: '/proj-4' });
    const result = await server.callTool('add_node', { nodeKind: 'message_send', label: 'x' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('窗口');
  });

  it('未知工具名 ⇒ 可读的 isError（并提示先用 list_tools）', async () => {
    const server = createMcpServer({ projectPath: '/test' });
    const result = await server.callTool('not_a_real_tool', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('未知工具');
    expect(textOf(result)).toContain('list_tools');
  });

  it('缺必填参数 ⇒ 普通 result 文本（让模型自己补，不当成异常）', async () => {
    mockGetAllWindows.mockReturnValue([makeWin()]);
    const server = createMcpServer({ projectPath: '/test' });
    const result = await server.callTool('write_file', { path: 'x.ts' });
    expect(textOf(result)).toContain('缺少必填参数');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
