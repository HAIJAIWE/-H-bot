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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Handler = (event: unknown, args: unknown) => Promise<unknown>;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  resolveConfig: vi.fn(),
  runAgentTurn: vi.fn(),
  requestApproval: vi.fn(),
  appendTrace: vi.fn(),
  readPreset: vi.fn(),
  resolvePresetTools: vi.fn(),
  /** 主进程发出去的事件（只在回调里发的那些，比如 ai:compact，要靠它断言） */
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
  BrowserWindow: {
    // send 必须是**稳定**的 mock：事件在循环回调里才发，用例要先拿到同一个函数
    fromWebContents: () => ({ webContents: { send: h.send } }),
  },
}));

vi.mock('@main/services/ai/appAiConfig', () => ({ resolveAuthorAiConfig: h.resolveConfig }));
vi.mock('@main/services/ai/trace', () => ({ appendTrace: h.appendTrace }));
vi.mock('@main/services/ai/toolApproval', () => ({ requestApproval: h.requestApproval }));
vi.mock('@main/services/agent-core/runTurn', () => ({ runAgentTurn: h.runAgentTurn }));
vi.mock('@main/services/ai/presets', () => ({
  readPreset: h.readPreset,
  resolvePresetTools: h.resolvePresetTools,
  writePresets: vi.fn(),
}));
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
    h.readPreset.mockReset().mockResolvedValue(undefined);
    h.resolvePresetTools.mockReset().mockResolvedValue(undefined);
    h.send.mockReset();
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
    // 用 coder（代码页）：下面写的是 src/，builder 会被角色的写域闸先拒掉
    await invoke({ projectPath: 'D:/p', requirement: '改一下', agentMode: 'code' });
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

  it('★ 先计划：planFirst 变成循环的 planOnly（只读工具由 runTurn 那层物理裁掉）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '先出计划', planFirst: true });
    const passed = h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.planOnly).toBe(true);

    h.runAgentTurn.mockClear();
    await invoke({ projectPath: 'D:/p', requirement: '直接做' });
    // 没开就是没开：不该塞一个 false 进去（循环按缺省处理）
    expect('planOnly' in (h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>)).toBe(false);
  });

  it('★ 完全权限：不再弹窗，但角色的写域闸仍然拦得住（开关不是免死金牌）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '放开做', fullAccess: true }); // 缺省 builder
    const approval = (h.runAgentTurn.mock.calls[0][0] as {
      approval: (req: unknown) => Promise<boolean>;
    }).approval;

    // 界面域：直接放行，而且连规则表都没碰（本次运行有效，不落盘）
    await expect(approval({ kind: 'command', summary: 'pnpm test' })).resolves.toBe(true);
    await expect(approval({ kind: 'write', summary: 'D:/p/.qqbat/flow.json' })).resolves.toBe(true);
    expect(h.requestApproval).not.toHaveBeenCalled();

    // 越界写照样拒：完全权限只跳过"问人"，不跳过角色的作用域
    await expect(approval({ kind: 'write', summary: 'D:/p/src/a.ts' })).rejects.toThrow(/不能写它/);
    expect(h.requestApproval).not.toHaveBeenCalled();
  });

  it('★ 预设/白名单裁过的工具表真的交给循环（以前 turnTools 算完就丢）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '只看', allowedTools: ['read_file'] });
    const tools = (h.runAgentTurn.mock.calls[0][0] as { tools?: Array<{ name: string }> }).tools;
    expect(tools?.map((t) => t.name)).toEqual(['read_file']);

    h.runAgentTurn.mockClear();
    // 不裁就不带这个键（循环按注册表全量走）
    await invoke({ projectPath: 'D:/p', requirement: '随便' });
    expect('tools' in (h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>)).toBe(false);
  });

  it('★ 角色的写域闸：builder 写 src/ 直接拒，连弹窗都不弹（点"允许"不能绕过角色边界）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改源码' }); // 缺省 = builder
    const approval = (h.runAgentTurn.mock.calls[0][0] as {
      approval: (req: unknown) => Promise<boolean>;
    }).approval;

    // 真机上 `GateRequest.path` 就是**绝对路径**（core.ts:274 → 适配成 summary），
    // 所以这里按绝对路径断言；顺手再测一次相对路径（手工调用/测试的常见写法）
    await expect(approval({ kind: 'write', summary: 'D:/p/src/a.ts' })).rejects.toThrow(/src\/a\.ts/);
    await expect(approval({ kind: 'write', summary: 'src/b.ts' })).rejects.toThrow(/不能写它/);
    expect(h.requestApproval).not.toHaveBeenCalled();

    // 同一角色的界面域照常问（拒绝的是越界，不是"这个角色不许写盘"）
    await expect(approval({ kind: 'write', summary: 'D:/p/.qqbat/flow.json' })).resolves.toBe(true);
    expect(h.requestApproval).toHaveBeenCalledTimes(1);
  });

  it('★ coder 反过来：界面域被拒（读不分域，只是不许写）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改源码', agentMode: 'code' });
    const approval = (h.runAgentTurn.mock.calls[0][0] as {
      approval: (req: unknown) => Promise<boolean>;
    }).approval;

    await expect(approval({ kind: 'write', summary: 'D:/p/.qqbat/flow.json' })).rejects.toThrow(
      /界面/,
    );
    expect(h.requestApproval).not.toHaveBeenCalled();
  });

  it('★ 角色说明进系统提示：agentMode 推角色；预设的 role 覆盖它、prompt 接在后面', async () => {
    await invoke({ projectPath: 'D:/p', requirement: 'x', agentMode: 'code' });
    const note = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote;
    expect(note).toBeTruthy();

    h.runAgentTurn.mockClear();
    h.readPreset.mockResolvedValue({ name: '夜巡', role: 'builder', prompt: '只动流程' });
    await invoke({ projectPath: 'D:/p', requirement: 'x', agentMode: 'code', preset: '夜巡' });
    const second = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote;
    expect(second).toContain('只动流程');
    // 预设的 role 真的盖过了页面推出的角色（否则两段说明会一模一样）
    expect(second).not.toBe(note);
  });

  it('★ 贴图真交给循环，而且记忆里只留一句「附了 N 张图」（图不落盘）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-img-'));
    try {
      const png = 'data:image/png;base64,iVBORw0KGgo=';
      await invoke({ projectPath: dir, requirement: '你看这是怎么回事', images: [png] });
      const passed = h.runAgentTurn.mock.calls[0][0] as { images?: string[] };
      expect(passed.images).toEqual([png]);

      // 记忆 == .qqbat 下那份 JSONL；图本身不进去，只有一句说明
      const raw = readFileSync(join(dir, '.qqbat', 'ai-history.jsonl'), 'utf-8');
      expect(raw).toContain('附了 1 张图');
      expect(raw).not.toContain('base64');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    h.runAgentTurn.mockClear();
    await invoke({ projectPath: 'D:/p', requirement: '没图' });
    // 没贴图就不带这个键（循环按纯文本走）
    expect('images' in (h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>)).toBe(false);
  });

  it('★ 贴图的格式与张数由 schema 兜底（界面可以被绕过）', async () => {
    // 非 data URL 的串不该被当真送进 provider
    const bad = (await invoke({
      projectPath: 'D:/p',
      requirement: 'x',
      images: ['https://example.invalid/a.png'],
    })) as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('参数校验失败');

    const tooMany = (await invoke({
      projectPath: 'D:/p',
      requirement: 'x',
      images: Array.from({ length: 5 }, () => 'data:image/png;base64,AAAA'),
    })) as { ok: boolean };
    expect(tooMany.ok).toBe(false);
    expect(h.runAgentTurn).not.toHaveBeenCalled();
  });

  it('★ 代码页把「当前打开的文件」写进提示；低代码页不写（不引它去动源码）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-file-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');

      await invoke({ projectPath: dir, requirement: '改这个', agentMode: 'code', activeFilePath: 'src/a.ts' });
      const note = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote;
      expect(note).toContain('src/a.ts');
      expect(note).toContain('不要再反问');

      h.runAgentTurn.mockClear();
      // 低代码页（builder）拿到同一个字段也不该用
      await invoke({ projectPath: dir, requirement: '改这个', activeFilePath: 'src/a.ts' });
      const builder = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote;
      expect(builder).not.toContain('src/a.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('★ 预设的 permissionMode:full 真的补位（调用方没表态时）', async () => {
    h.readPreset.mockResolvedValue({ name: '无人值守', permissionMode: 'full' });
    await invoke({ projectPath: 'D:/p', requirement: '放开来做', agentMode: 'code', preset: '无人值守' });
    const approval = (h.runAgentTurn.mock.calls[0][0] as {
      approval: (req: unknown) => Promise<boolean>;
    }).approval;

    // coder 的写域内：不弹窗直接过
    await expect(approval({ kind: 'write', summary: 'src/a.ts' })).resolves.toBe(true);
    expect(h.requestApproval).not.toHaveBeenCalled();

    // 但显式 false 要盖过预设（界面开关是显式表态）
    h.runAgentTurn.mockClear();
    await invoke({
      projectPath: 'D:/p',
      requirement: '还是问我',
      agentMode: 'code',
      preset: '无人值守',
      fullAccess: false,
    });
    const second = (h.runAgentTurn.mock.calls[0][0] as {
      approval: (req: unknown) => Promise<boolean>;
    }).approval;
    await expect(second({ kind: 'write', summary: 'src/a.ts' })).resolves.toBe(true);
    expect(h.requestApproval).toHaveBeenCalledTimes(1);
  });

  it('★ 循环内压缩要发 ai:compact（不然"模型突然变笨"没法解释）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '跑个长任务' });
    const onCompact = (h.runAgentTurn.mock.calls[0][0] as {
      onCompact?: (info: { dropped: number; tokensBefore: number; tokensAfter: number }) => void;
    }).onCompact;
    expect(typeof onCompact, '循环压缩的回调必须接上').toBe('function');

    h.send.mockClear();
    onCompact!({ dropped: 7, tokensBefore: 91234, tokensAfter: 12045 });
    /**
     * 通道 + 四个键都要对：少 projectPath → 渲染层 routeTo 不知道往哪个项目挂，
     * 少 dropped / tokensBefore / tokensAfter → 界面上那句话没有数字可填。
     */
    expect(h.send).toHaveBeenCalledWith('ai:compact', {
      projectPath: 'D:/p',
      dropped: 7,
      tokensBefore: 91234,
      tokensAfter: 12045,
    });
  });
});
