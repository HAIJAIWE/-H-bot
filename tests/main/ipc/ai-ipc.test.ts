// tests/main/ipc/ai-ipc.test.ts
//
// # ai:* 通道的**接线**（不是业务逻辑）
//
// 这份文件原先只剩一个被截断的 mock 头（还在 mock 一个本构建里并不存在的
// `@shared/types/ai-provider.providerRegistry`）。按恢复树的现状重写成"接线"用例：
// 每个 handler 有没有把参数原样交给 service、失败时返不返 `{ok:false}`、
// 需要窗口的通道在没窗口时会不会硬着头皮往下走。
//
// 越界路径的拒绝由 `tests/main/ipc/projectPathGuard.test.ts` 专门覆盖，这里只钉"传参"。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const registered = new Map<string, Handler>();
  const ipcMainHandle = vi.fn((channel: string, fn: Handler) => {
    registered.set(channel, fn);
  });
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } };
  return {
    registered,
    ipcMainHandle,
    win,
    // 显式标注 4 参：mock.calls 的元组类型由它推出来（否则 calls[0] 是空元组，解构即报错）
    processAiChat: vi.fn<
      (
        projectPath: string,
        text: string,
        win: unknown,
        opts: { threadId?: string; images?: string[] },
      ) => Promise<void>
    >(async () => {}),
    setAiConfig: vi.fn(),
    getAiConfig: vi.fn(() => null),
    beginBatch: vi.fn(),
    commitBatch: vi.fn(),
    handleRollbackBatch: vi.fn(),
    cancelAiChat: vi.fn(() => true),
    isAiChatRunning: vi.fn(() => true),
    fromWebContents: vi.fn((): unknown => win),
    getHandler: (channel: string): Handler => {
      const fn = registered.get(channel);
      if (!fn) throw new Error(`handler ${channel} 未注册`);
      return fn;
    },
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle, on: vi.fn() },
  BrowserWindow: {
    fromWebContents: mocks.fromWebContents,
    getAllWindows: vi.fn(() => [mocks.win]),
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false,
    getName: vi.fn(() => 'qqbat'),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
}));

// ai/index.ts 依赖很重（llm / context / tools / proposal），这里整体 mock，只验接线
vi.mock('@main/services/ai', () => ({
  processAiChat: mocks.processAiChat,
  setAiConfig: mocks.setAiConfig,
  getAiConfig: mocks.getAiConfig,
  beginBatch: mocks.beginBatch,
  commitBatch: mocks.commitBatch,
  handleRollbackBatch: mocks.handleRollbackBatch,
  cancelAiChat: mocks.cancelAiChat,
  isAiChatRunning: mocks.isAiChatRunning,
}));

// ipc/ai.ts 的 `ai:tools` 现在给的是**循环注册表**（agent-core 的 listTools()，
// 也就是预设白名单真正过滤的那张表）；mock 打在真源上。
vi.mock('@main/services/agent-core/core', () => ({
  listTools: () => [
    { name: 'read_file', description: '读一个文件', category: 'query', parameters: { type: 'object' } },
    { name: 'write_file', description: '写一个文件', category: 'mutation' },
  ],
}));

vi.mock('@main/services/ai/budgetSettings', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeToolBudgetSetting: vi.fn(async () => {}),
    applyToolBudgetSetting: vi.fn(),
    currentToolBudgetSetting: vi.fn(() => ({ enabled: true, thresholdChars: 8192 })),
  };
});

vi.mock('@main/runtime/dynamicHandlers', () => ({
  getDynamicHandler: vi.fn(() => undefined),
  setBuiltinResolver: vi.fn(),
}));

vi.mock('@main/services/plugins/pluginLoader', () => ({
  loadProjectPlugins: vi.fn(async () => []),
}));

vi.mock('@main/services/devBackup/devMode', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, isFrameworkDevModeEnabled: vi.fn(() => false) };
});

import { registerAiIpc } from '@main/ipc/ai';

let baseDir: string;
let projectPath: string;

beforeEach(async () => {
  mocks.registered.clear();
  for (const fn of [
    mocks.processAiChat,
    mocks.setAiConfig,
    mocks.beginBatch,
    mocks.commitBatch,
    mocks.handleRollbackBatch,
    mocks.cancelAiChat,
    mocks.isAiChatRunning,
    mocks.fromWebContents,
  ]) {
    fn.mockClear();
  }
  mocks.fromWebContents.mockReturnValue(mocks.win);
  mocks.isAiChatRunning.mockReturnValue(true);
  baseDir = await mkdtemp(join(tmpdir(), 'qqbat-ai-ipc-'));
  projectPath = join(baseDir, 'demo');
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
  registerAiIpc({ getBaseDir: () => baseDir } as never);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function call(channel: string, args: unknown): Promise<any> {
  return await mocks.getHandler(channel)({ sender: {} }, args);
}

describe('注册面', () => {
  it('注册了助手链路用到的通道', () => {
    const channels = [...mocks.registered.keys()];
    for (const ch of ['ai:chat', 'ai:cancelChat', 'ai:isRunning', 'ai:tools', 'ai:resolveApproval']) {
      expect(channels).toContain(ch);
    }
  });
});

describe('接线', () => {
  it('ai:tools 返回的是循环注册表（预设白名单过滤的那张），字段补全成工具定义', async () => {
    const res = await call('ai:tools', {});
    expect(res.ok).toBe(true);
    // 前两条是循环注册表（mock 的两个），字段缺省就地补全
    expect(res.data.slice(0, 2)).toEqual([
      { name: 'read_file', description: '读一个文件', category: 'query', parameters: { type: 'object' } },
      { name: 'write_file', description: '写一个文件', category: 'mutation', parameters: {} },
    ]);
    const names = res.data.map((tool: { name: string }) => tool.name);
    // 旧 27 个定义也在这张表里 —— 循环接上 adaptLegacyTools 之后，界面上勾的就是它们
    expect(names).toContain('apply_template');
    // 同名（read_file / write_file / validate_flow）只留循环版：一个名字一套规则
    expect(names.filter((name: string) => name === 'read_file')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it('ai:cancelChat 把 projectPath 交给 cancelAiChat，并回执是否真取消了', async () => {
    const res = await call('ai:cancelChat', { projectPath });
    expect(res).toEqual({ ok: true, data: { cancelled: true } });
    expect(mocks.cancelAiChat).toHaveBeenCalledWith(projectPath);
  });

  it('ai:isRunning 包成 { running }（界面据此决定能不能点停止）', async () => {
    const res = await call('ai:isRunning', { projectPath });
    expect(res).toEqual({ ok: true, data: { running: true } });
    expect(mocks.isAiChatRunning).toHaveBeenCalledWith(projectPath);
  });

  it('ai:chat 把 message / 选项 / 窗口交给 processAiChat', async () => {
    const res = await call('ai:chat', {
      projectPath,
      message: '你好',
      threadId: 't1',
      images: ['data:image/png;base64,xxx'],
    });
    expect(res.ok).toBe(true);
    const [p, text, win, opts] = mocks.processAiChat.mock.calls[0];
    expect(p).toBe(projectPath);
    expect(text).toBe('你好');
    expect(win).toBe(mocks.win);
    expect(opts).toMatchObject({ threadId: 't1' });
    expect(opts.images).toEqual(['data:image/png;base64,xxx']);
  });

  it('ai:chat 拿不到窗口 ⇒ 明确失败（不静默丢弃）', async () => {
    mocks.fromWebContents.mockReturnValue(null);
    const res = await call('ai:chat', { projectPath, message: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('窗口');
    expect(mocks.processAiChat).not.toHaveBeenCalled();
  });

  it('ai:beginBatch 无窗口 ⇒ 明确失败；有窗口 ⇒ 交给 beginBatch', async () => {
    mocks.fromWebContents.mockReturnValue(null);
    const failed = await call('ai:beginBatch', { projectPath });
    expect(failed.ok).toBe(false);
    expect(mocks.beginBatch).not.toHaveBeenCalled();

    mocks.fromWebContents.mockReturnValue(mocks.win);
    const ok = await call('ai:beginBatch', { projectPath });
    expect(ok.ok).toBe(true);
    expect(mocks.beginBatch).toHaveBeenCalledWith(projectPath, mocks.win);
  });

  it('参数不合法 ⇒ 参数校验失败（和路径越界是两回事，别混成一条错误）', async () => {
    const res = await call('ai:cancelChat', { projectPath: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('参数校验失败');
    expect(mocks.cancelAiChat).not.toHaveBeenCalled();
  });
});
