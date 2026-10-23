// tests/main/ipc/aiAgentCore-ipc.test.ts
//
// # 闸门（行为）：agent-core 运行入口的**接线**
//
// 通道名/key 名有 ipcPayloadContract + ipcReachability 两条静态闸门管着，
// 但它们都看不出**接线是不是真的通**：schema 有没有被用、审批有没有接到弹窗、
// 轮数上限有没有透传。这里用 mock 把六件外部依赖挡掉，只测这几件事。
//
// 为什么不复用 ai-ipc.test.ts：那个文件 mock 了整套助手服务（720 行），
// 这一条通道**不经过**那些服务 —— 塞进去只会让两边的 mock 互相干扰。
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (event: unknown, args: unknown) => Promise<unknown>;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  resolveConfig: vi.fn(),
  runAgentTurn: vi.fn(),
  requestApproval: vi.fn(),
  appendTrace: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: vi.fn() } }),
  },
}));

vi.mock('@main/services/ai/appAiConfig', () => ({ resolveAuthorAiConfig: h.resolveConfig }));
vi.mock('@main/services/ai/trace', () => ({ appendTrace: h.appendTrace }));
vi.mock('@main/services/ai/toolApproval', () => ({ requestApproval: h.requestApproval }));
vi.mock('@main/services/agent-core/runTurn', () => ({ runAgentTurn: h.runAgentTurn }));
vi.mock('@main/services/infra/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerAiAgentCoreIpc } from '@main/ipc/aiAgentCore';

const CONFIG = { baseUrl: 'http://example.invalid', apiKey: 'k', model: 'm' };
const RESULT = {
  finalText: '做完了',
  rounds: 2,
  phase: { kind: 'finished', reason: 'completed' },
  toolResults: [{ name: 'write_file', args: { path: 'a.ts' }, output: '已写入' }],
};

/** 调一次通道（注册只有启动时一次，所以延迟到调用处再注册） */
async function invoke(payload: unknown): Promise<unknown> {
  if (!h.handlers.has('ai:agentCoreRun')) registerAiAgentCoreIpc();
  const fn = h.handlers.get('ai:agentCoreRun');
  expect(fn, '通道没注册').toBeTruthy();
  return fn!({ sender: {} }, payload);
}

describe('ai:agentCoreRun 接线', () => {
  beforeEach(() => {
    h.handlers.clear();
    h.resolveConfig.mockReset().mockResolvedValue(CONFIG);
    h.runAgentTurn.mockReset().mockResolvedValue(RESULT);
    h.requestApproval.mockReset().mockResolvedValue('allow');
    h.appendTrace.mockReset();
  });

  it('★ 载荷过 schema：缺 requirement 直接拒，不往下跑', async () => {
    const res = (await invoke({ projectPath: 'D:/p' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('参数校验失败');
    // 校验失败不该去碰模型配置，更不该开始循环
    expect(h.resolveConfig).not.toHaveBeenCalled();
    expect(h.runAgentTurn).not.toHaveBeenCalled();
  });

  it('参数不是对象也拒（undefined / null）', async () => {
    expect(((await invoke(undefined)) as { ok: boolean }).ok).toBe(false);
    expect(((await invoke(null)) as { ok: boolean }).ok).toBe(false);
  });

  it('没有模型配置 → 明确说"先配好"，不静默失败', async () => {
    h.resolveConfig.mockResolvedValue(null);
    const res = (await invoke({ projectPath: 'D:/p', requirement: '改一下' })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('没有可用的模型配置');
    expect(h.runAgentTurn).not.toHaveBeenCalled();
  });

  it('★ 正常一轮：回执带 finalText / rounds / phase / toolResults（含 args）', async () => {
    const res = (await invoke({ projectPath: 'D:/p', requirement: '改一下' })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.finalText).toBe('做完了');
    expect(res.rounds).toBe(2);
    expect(res.phase).toEqual({ kind: 'finished', reason: 'completed' });
    expect(res.toolResults).toEqual(RESULT.toolResults);
    const passed = h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.projectPath).toBe('D:/p');
    expect(passed.requirement).toBe('改一下');
    expect(passed.config).toEqual(CONFIG);
    // 没传 maxRounds 就不该带这个键（循环用自己的默认值）
    expect('maxRounds' in passed).toBe(false);
  });

  it('maxRounds 透传（只认正整数，schema 挡掉 0 和负数）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改一下', maxRounds: 3 });
    expect((h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>).maxRounds).toBe(3);

    h.runAgentTurn.mockClear();
    expect(((await invoke({ projectPath: 'D:/p', requirement: 'x', maxRounds: 0 })) as { ok: boolean }).ok).toBe(false);
    expect(h.runAgentTurn).not.toHaveBeenCalled();
  });

  it('★ 审批接到现有弹窗：写盘问 write_file、跑命令问 run_command，allow 才算同意', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改一下' });
    const approval = (h.runAgentTurn.mock.calls[0][0] as {
      approval: (req: unknown) => Promise<boolean>;
    }).approval;

    await expect(approval({ kind: 'write', summary: 'src/a.ts' })).resolves.toBe(true);
    expect(h.requestApproval.mock.calls[0][0]).toMatchObject({
      projectPath: 'D:/p',
      toolName: 'write_file',
      args: { path: 'src/a.ts' },
      hint: 'src/a.ts',
    });
    // callId 每轮唯一：重复的 callId 会把上一次的等待按拒绝收掉
    await approval({ kind: 'write', summary: 'src/b.ts' });
    const ids = h.requestApproval.mock.calls.map((c) => (c[0] as { callId: string }).callId);
    expect(new Set(ids).size).toBe(ids.length);

    h.requestApproval.mockResolvedValue('deny');
    await expect(approval({ kind: 'command', summary: 'pnpm test' })).resolves.toBe(false);
    expect(h.requestApproval.mock.calls.at(-1)?.[0]).toMatchObject({
      toolName: 'run_command',
      args: { command: 'pnpm test' },
    });
  });
});
