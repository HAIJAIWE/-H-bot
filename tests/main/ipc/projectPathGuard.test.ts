// tests/main/ipc/projectPathGuard.test.ts
//
// # 闸门：**渲染层传来的 projectPath 不能越出项目根**（WI-3，规格 §3.3(a)）
//
// ## 为什么
// `ipc/ai.ts` 拿渲染层传来的 `projectPath` 直接拼 `.qqbat/project.json` 去读写。
// 渲染层一旦被 XSS/调试器控制，只要传 `..\..\` 或一个指向别处的绝对路径，主进程就会按
// 攻击者指定的目录读写项目配置。
//
// ## 判据
// 越界必须是**明确拒绝**（`{ok:false}` + 路径越界类错误），不能被业务层 try/catch 吞掉。
// `ipc/ai.ts` 里的 `assertProjectPathAllowed(baseDir, …)` 就是这个判据（共 20 处调用点）。
//
// ## 本构建的已知缺口（不是本文件的断言，记录在案）
// 同一套闸门在 10/18 构建里**只接在 `ipc/ai.ts`**：`ipc/runtime.ts`（`runtime:start` →
// `ensureTranslatorRunning` 会往传入目录写 `.env`/`.qqbat`）与 `ipc/official.ts` 还没接。
// 它们的正例/反例等接线之后再加，这里不写"已覆盖"的假绿。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const registered = new Map<string, Handler>();
  const ipcMainHandle = vi.fn((channel: string, fn: Handler) => {
    // Electron 语义：同一通道后注册的覆盖先注册的
    registered.set(channel, fn);
  });
  return {
    registered,
    ipcMainHandle,
    win: { isDestroyed: () => false, webContents: { send: vi.fn() } },
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
    fromWebContents: vi.fn(() => mocks.win),
    getAllWindows: vi.fn(() => [mocks.win]),
  },
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getVersion: vi.fn(() => '0.0.0'),
    isPackaged: false,
    on: vi.fn(),
  },
}));

vi.mock('@main/services/ai', () => ({
  processAiChat: vi.fn(async () => {}),
  setAiConfig: vi.fn(),
  getAiConfig: vi.fn(() => null),
  beginBatch: vi.fn(),
  commitBatch: vi.fn(),
  handleRollbackBatch: vi.fn(),
  cancelAiChat: vi.fn(() => true),
  isAiChatRunning: vi.fn(() => false),
}));

vi.mock('@main/services/ai/tools', () => ({ ALL_TOOL_DEFINITIONS: [] }));

// budgetSettings 只需覆盖"写盘/应用"两条副作用，阈值常量仍用真值
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
  // 真实实现（assertWithinProject 的报错文案要一起验），只把"框架开发模式"钉成关闭，
  // 否则机器上万一开着框架模式，越界路径会被合法放行，用例就变成环境相关。
  return { ...actual, isFrameworkDevModeEnabled: vi.fn(() => false) };
});

import { registerAiIpc } from '@main/ipc/ai';

let baseDir: string;

const BASE_NAME = 'projects-here';

beforeEach(async () => {
  mocks.registered.clear();
  mocks.ipcMainHandle.mockClear();
  const root = await mkdtemp(join(tmpdir(), 'qqbat-pathguard-'));
  baseDir = join(root, BASE_NAME);
  await mkdir(baseDir, { recursive: true });
  registerAiIpc({ getBaseDir: () => baseDir } as never);
});

afterEach(async () => {
  await rm(join(baseDir, '..'), { recursive: true, force: true });
});

function event(): unknown {
  return { sender: {} };
}

async function call(channel: string, args: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const promise = mocks.getHandler(channel)(event(), args);
  const resolved = await promise;
  return resolved as { ok: boolean; error?: string; data?: unknown };
}

const ESCAPES: Array<[string, string]> = [
  ['相对穿越', join('..', '..', 'Windows', 'System32')],
  ['绝对路径', 'C:\\Windows\\System32'],
  ['同名前缀（projects-here-evil 不在 projects-here 里）', '..\\projects-here-evil'],
  ['多层穿越', '..\\..\\..\\..\\Windows'],
];

describe('越界一律明确拒绝', () => {
  it.each(ESCAPES)('%s ⇒ ai:cancelChat 拒绝', async (_label, evil) => {
    const res = await call('ai:cancelChat', { projectPath: join(baseDir, evil) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('越界');
  });

  it.each(ESCAPES)('%s ⇒ ai:isRunning 拒绝', async (_label, evil) => {
    const res = await call('ai:isRunning', { projectPath: join(baseDir, evil) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('越界');
  });

  it.each(ESCAPES)('%s ⇒ ai:chat 拒绝（不发出任何 AI 请求）', async (_label, evil) => {
    const res = await call('ai:chat', { projectPath: join(baseDir, evil), message: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('越界');
  });

  it('越界在 ai:beginBatch 上也拦（不只读接口）', async () => {
    const res = await call('ai:beginBatch', { projectPath: join(baseDir, '..', 'elsewhere') });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('越界');
  });

  it('项目根本身（还没建项目）不算越界 —— 只关后门，不关正门', async () => {
    const project = join(baseDir, 'demo');
    await mkdir(project, { recursive: true });
    const res = await call('ai:cancelChat', { projectPath: project });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ cancelled: true });
  });
});
