// tests/renderer/stores/aiStoreInstructionReceipt.test.ts
//
// # 回执协议在**渲染层这一端**的闸门（P1-1）
//
// 主进程侧已经有 instructionBridge 的单测（超时 / 迟到回执 / 按项目结算），
// 但"渲染层收到指令后到底回没回、回的是什么"只被 console 掩盖过。
// 本文件钉住四件事：
//   ① 成功 ⇒ applied（否则主进程会按超时判失败，模型会重试同一件事）
//   ② 抛错 ⇒ failed + 原因（不能静默）
//   ③ 属于别的项目/窗口 ⇒ rejected（必须回，别让主进程白等 15s）
//   ④ 没有 requestId（老主进程）⇒ 不回执（向后兼容）
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: {
    getState: () => ({
      snapshot: () => ({ nodes: [], edges: [] }),
      rollback: vi.fn(),
      addNode: vi.fn(),
      removeNode: vi.fn(),
      addEdge: vi.fn(),
      updateNodeConfig: vi.fn(),
      updateNodeLabel: vi.fn(),
      loadedProjectPath: '/p',
    }),
  },
  beginHistoryBatch: () => {},
  endHistoryBatch: () => {},
  pushHistoryPoint: () => {},
}));

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ currentProject: { path: '/p' } }),
    subscribe: () => () => {},
  },
}));

vi.mock('@renderer/stores/uiStore', () => ({
  useUiStore: { getState: () => ({ centerTab: 'blocks' }) },
}));

import { useAiStore, emptyConversation } from '@renderer/stores/aiStore';

const fileWrite = vi.fn();
const resolveInstruction = vi.fn(async () => ({ ok: true }));
const noopUnsub = () => () => {};
let instructionCb:
  | ((data: {
      projectPath?: string;
      requestId?: string;
      instruction: { name: string; args: Record<string, unknown> };
    }) => void)
  | undefined;

beforeEach(() => {
  fileWrite.mockReset();
  fileWrite.mockResolvedValue({ ok: true });
  resolveInstruction.mockReset();
  resolveInstruction.mockResolvedValue({ ok: true });
  instructionCb = undefined;
  (globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = {
    ai: {
      chat: vi.fn(async () => ({ ok: true })),
      cancelChat: vi.fn(async () => ({ ok: true, data: { cancelled: true } })),
      onToolCall: () => noopUnsub(),
      onChunk: () => noopUnsub(),
      onResponse: () => noopUnsub(),
      onProposal: () => noopUnsub(),
      onAgentState: () => noopUnsub(),
      onNeedRollback: () => noopUnsub(),
      onClientInstruction: (cb: typeof instructionCb) => {
        instructionCb = cb;
        return noopUnsub();
      },
      resolveInstruction,
    },
    file: { write: fileWrite, read: vi.fn(), list: vi.fn() },
  };
  useAiStore.setState({
    ...emptyConversation(),
    conversations: {},
    conversationPath: '/p',
    agentState: { state: 'idle' },
  });
  useAiStore.getState().init();
});

/** 触发一条指令并等一拍（handler 是 async，订阅处 catch 掉了 rejection） */
async function fire(data: {
  projectPath?: string;
  requestId?: string;
  name: string;
  args: Record<string, unknown>;
}): Promise<void> {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  instructionCb?.({
    projectPath: data.projectPath,
    requestId: data.requestId,
    instruction: { name: data.name, args: data.args },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  errSpy.mockRestore();
}

type Receipt = { requestId: string; outcome: { status: string; reason?: string } };
const receiptOf = (): Receipt | undefined =>
  // vi.fn() 的参数是空元组，直接 .at(-1)?.[0] 会 TS2493；显式标出回执形状
  (resolveInstruction.mock.calls as unknown as Array<[Receipt]>).at(-1)?.[0];

describe('★ 写指令回执：渲染层必须给出明确结局（P1-1）', () => {
  it('★ 写成功 ⇒ applied（不回的话主进程会超时判失败，模型会重做一遍）', async () => {
    await fire({
      projectPath: '/p',
      requestId: 'req-1',
      name: 'write_code',
      args: { projectPath: '/p', filePath: 'plugins/ai-x/index.js', content: 'ok' },
    });

    expect(fileWrite).toHaveBeenCalled();
    const r = receiptOf();
    expect(r?.requestId).toBe('req-1');
    expect(r?.outcome.status).toBe('applied');
  });

  it('★ 写入抛错 ⇒ failed + 原因（不许静默）', async () => {
    fileWrite.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    await fire({
      projectPath: '/p',
      requestId: 'req-2',
      name: 'write_code',
      args: { projectPath: '/p', filePath: 'plugins/ai-x/index.js', content: 'x' },
    });

    const r = receiptOf();
    expect(r?.requestId).toBe('req-2');
    expect(r?.outcome.status).toBe('failed');
    expect(r?.outcome.reason).toContain('EACCES');
  });

  it('★ 应用管理的文件被拒 ⇒ failed（不是成功，也不是静默）', async () => {
    await fire({
      projectPath: '/p',
      requestId: 'req-3',
      name: 'write_code',
      args: { projectPath: '/p', filePath: '.qqbat/flow.json', content: '{}' },
    });

    expect(fileWrite).not.toHaveBeenCalled();
    expect(receiptOf()?.outcome.status).toBe('failed');
  });

  it('★ 属于别的项目/窗口 ⇒ rejected（必须回，别让主进程白等 15 秒）', async () => {
    await fire({
      projectPath: '/another-project',
      requestId: 'req-4',
      name: 'write_code',
      args: { projectPath: '/another-project', filePath: 'a.js', content: 'x' },
    });

    expect(fileWrite).not.toHaveBeenCalled();
    const r = receiptOf();
    expect(r?.requestId).toBe('req-4');
    expect(r?.outcome.status).toBe('rejected');
  });

  it('没有 requestId（老主进程）⇒ 不回执（向后兼容，别去调一个不存在的 id）', async () => {
    await fire({
      projectPath: '/p',
      name: 'write_code',
      args: { projectPath: '/p', filePath: 'plugins/ai-x/index.js', content: 'ok' },
    });

    expect(fileWrite).toHaveBeenCalled();
    expect(resolveInstruction).not.toHaveBeenCalled();
  });
});
