// tests/renderer/stores/aiStoreAppManagedWrite.test.ts
//
// # 闸门：**渲染层的通用写通道**也不能写应用管理的文件（P0-7，MCP 那条路的后半段）
//
// 外部 IDE（MCP）的 `write_code` 走的是 `ai:clientInstruction` → 渲染层
// `handleClientInstruction` 的 write 分支 → `window.qqbat.file.write`。
// 这条分支原来只查 `..` 与绝对路径，**没有** `isAppManagedReadOnly` ——
// 于是一个外部客户端就能把 `.qqbat/flow.json` 写掉（画布的数据源）。
//
// 本文件钉三件事：
//   ① 应用管理的文件 → **不写**、界面 agentState 变红（可见）、控制台留痕；
//   ② 普通文件（含两条边界）→ 照旧写；
//   ③ 判据是**同一个函数**（`@shared/files/readOnlyPaths`）—— 边界行为必须与编辑器一致。
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
import { isAppManagedReadOnly } from '@shared/files/readOnlyPaths';

const fileWrite = vi.fn();
const noopUnsub = () => () => {};
let instructionCb:
  | ((data: {
      projectPath?: string;
      instruction: { name: string; args: Record<string, unknown> };
    }) => void)
  | undefined;

const APP_MANAGED = ['.qqbat/flow.json', '.qqbat/button_panels.json', '.qqbat/project.json'];
const WRITABLE = [
  'plugins/ai-x/index.js',
  '.env',
  'src/custom.ts',
  '.qqbat/project.json.bak-1', // 精确匹配：备份文件不该被锁
];

beforeEach(() => {
  fileWrite.mockReset();
  fileWrite.mockResolvedValue({ ok: true });
  instructionCb = undefined;
  (globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = {
    ai: {
      chat: vi.fn(async () => ({ ok: true })),
      cancelChat: vi.fn(async () => ({ ok: true, data: { cancelled: true } })),
      beginBatch: vi.fn(async () => ({ ok: true })),
      commitBatch: vi.fn(async () => ({ ok: true })),
      rollbackBatch: vi.fn(async () => ({ ok: true })),
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
    },
    file: { write: fileWrite, read: vi.fn(), list: vi.fn() },
  };
  useAiStore.setState({
    ...emptyConversation(),
    conversations: {},
    conversationPath: '/p',
    agentState: { state: 'idle' },
  });
  // 监听器要真的注册上 —— 本文件测的就是"指令进来之后会怎样"
  useAiStore.getState().init();
});

/** 触发一条客户端指令并等一拍（handler 是 async，订阅处 catch 掉了 rejection） */
async function fireInstruction(name: string, args: Record<string, unknown>): Promise<void> {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  instructionCb?.({ projectPath: '/p', instruction: { name, args } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  errSpy.mockRestore();
}

describe('★ 应用管理的文件：不写、可见、留痕', () => {
  it('★ write_code 写 .qqbat/flow.json ⇒ 不落盘 + agentState 变红（带路径）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    instructionCb?.({
      projectPath: '/p',
      instruction: {
        name: 'write_code',
        args: { projectPath: '/p', filePath: '.qqbat/flow.json', content: 'HACKED' },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fileWrite, '应用管理的文件绝不该被写').not.toHaveBeenCalled();
    const agent = useAiStore.getState().agentState;
    expect(agent.state, '要让用户看见（别静默）').toBe('error');
    expect(agent.message).toContain('.qqbat/flow.json');
    expect(errSpy, '诊断也要留痕（排查时能对上）').toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('★ 字段错开：判据只看**真正会写下去的那个路径**（原来的绕过链就此断掉）', async () => {
    // 原绕过链：MCP 侧校验 filePath（安全），渲染层却用 path 写（应用管理）—— 校验 A、写 B。
    // 现在两边按同一个顺序取（filename → filePath → path），下面这条必须被拒：
    await fireInstruction('write_code', {
      projectPath: '/p',
      filePath: '.qqbat/flow.json',
      path: 'plugins/ai-ok/index.js',
      content: 'HACKED',
    });
    expect(fileWrite, '真正会写的是 filePath（应用管理）⇒ 必须拒').not.toHaveBeenCalled();
    expect(useAiStore.getState().agentState.state).toBe('error');

    // 反过来：被忽略的字段里塞应用管理路径，不构成写入 ⇒ 只按会写的那个放行
    fileWrite.mockClear();
    useAiStore.setState({ agentState: { state: 'idle' } });
    await fireInstruction('write_code', {
      projectPath: '/p',
      filePath: 'plugins/ai-ok/index.js',
      path: '.qqbat/flow.json',
      content: 'ok',
    });
    expect(fileWrite, '写的是安全路径 ⇒ 放行').toHaveBeenCalledWith(
      '/p',
      'plugins/ai-ok/index.js',
      'ok',
    );
  });

  it.each(APP_MANAGED)('应用管理清单里的 %s ⇒ 不写、可见', async (filePath) => {
    await fireInstruction('write_code', { projectPath: '/p', filePath, content: 'x' });
    expect(fileWrite, filePath).not.toHaveBeenCalled();
    expect(useAiStore.getState().agentState.state).toBe('error');
    expect(useAiStore.getState().agentState.message).toContain(filePath);
  });

  it.each(WRITABLE)('普通文件 %s ⇒ 照写（含 .bak 后缀的边界）', async (filePath) => {
    await fireInstruction('write_code', { projectPath: '/p', filePath, content: 'ok' });
    expect(fileWrite).toHaveBeenCalledWith('/p', filePath, 'ok');
    expect(useAiStore.getState().agentState.state).toBe('idle');
  });

  it('write_file 走同一条通道（它的声明参数是 path）', async () => {
    await fireInstruction('write_file', {
      projectPath: '/p',
      path: 'plugins/ai-y/index.js',
      content: 'v',
    });
    expect(fileWrite).toHaveBeenCalledWith('/p', 'plugins/ai-y/index.js', 'v');
  });

  it('目录前缀同样被锁：src/plugins/generated/… 是生成物', async () => {
    await fireInstruction('write_file', {
      projectPath: '/p',
      path: 'src/plugins/generated/a.ts',
      content: 'x',
    });
    expect(fileWrite, '生成物也归应用管理').not.toHaveBeenCalled();
    expect(useAiStore.getState().agentState.state).toBe('error');
  });

  it('判据与编辑器是同一份清单（边界不许漂移）', () => {
    for (const p of APP_MANAGED) expect(isAppManagedReadOnly(p), p).toBe(true);
    for (const p of WRITABLE) expect(isAppManagedReadOnly(p), p).toBe(false);
  });
});

