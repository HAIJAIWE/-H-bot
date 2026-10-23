// tests/evals/agentEvals.test.ts
//
// # 任务级评测（evals）：把"它聪不聪明"变成一条命令
//
// ## 为什么需要它（评审文档 §三 P0）
//
// 在此之前，所有结论（"4.5 分钟 → 秒级"、"重复触发器被拦下"）都是**手工量的** ——
// 改一次代码，好不好只能靠真机体感。这一层把"一条真实需求 → 一组机械判定"固定下来：
//   · 判定只看**用户能看到的结果**：有没有出提案、提案里是什么操作、校验报不报错、几轮、多久
//   · 模型用**脚本化**替代（CI 里不该真调 API），但**工具、提案、校验、记忆都是真的**
//   · 真机评测另有一层：设 `QWEN_API_KEY` 时跑 liveModel.e2e（默认跳过）
//
// 判据必须客观：不允许"看起来更好了"这种断言。
//
// ## 恢复说明（2026-10-23）
// 10/18 打包产物里没有测试源码，磁带里这个文件只有前 70 行 + ⑪⑫⑬ 的尾巴（中间 400 行丢失）。
// 这里保留原来的桩结构（同样的 vi.hoisted mock / 同样的脚本化模型 / 同样的 `runCase` 口径），
// 只把**能按当前源码确证的判定**重写出来；丢失的 ①–⑩ 用例等拿到原文再补，不凭记忆编断言。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { callLlmMock, executeCalls, measureMock, systemMsgMock, resolveMock } = vi.hoisted(() => ({
  callLlmMock: vi.fn(),
  executeCalls: [] as Array<{ name: string; args: unknown }>,
  measureMock: vi.fn(),
  systemMsgMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock('@main/services/ai/llm', () => ({ callLlm: callLlmMock }));
// 工具**照常真执行**，只是记一笔调用（评测要看"到底调了几次、调了什么"）
vi.mock('@main/services/ai/tools', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    executeTool: async (call: { name: string; args: unknown }, ...rest: unknown[]) => {
      executeCalls.push({ name: call.name, args: call.args });
      return (original.executeTool as (...a: unknown[]) => Promise<unknown>)(call, ...rest);
    },
  };
});
vi.mock('@main/services/ai/context', () => ({ buildSystemMessage: systemMsgMock }));
vi.mock('@main/services/ai/tokenBudget', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, measureConversation: measureMock };
});
vi.mock('@main/services/ai/appAiConfig', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, resolveAuthorAiConfig: resolveMock };
});
vi.mock('@shared/types/ai-provider', () => ({
  providerRegistry: { getOrCreate: () => ({}), setCurrent: () => {} },
}));

import { processAiChat, setAiConfig } from '@main/services/ai/index';
import type { Proposal } from '@shared/types/proposal';
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog';

/** 一段脚本化模型：每项要么回文本，要么要调一组工具 */
type Step = { text?: string; tools?: Array<{ name: string; args?: Record<string, unknown> }> };

function scriptModel(steps: Step[]): void {
  let i = 0;
  callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
    // ⚠️ 脚本必须**会结束**：用完之后一律回纯文本（否则最后一步会被反复重放，
    //    评测里就会出现"18 轮 18 个 apply_template"这种假象 —— 第一次写就是这么踩的）
    const step: Step = i < steps.length ? steps[i] : { text: '（脚本结束）' };
    i += 1;
    if (step.tools && step.tools.length > 0 && cb.onToolCalls) {
      await cb.onToolCalls(
        step.tools.map((t, idx) => ({
          id: 'call_' + i + '_' + idx,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
        })),
      );
    }
    cb.onComplete(step.text ?? '');
  });
}

let projectPath: string;
let sent: Array<{ channel: string; payload: any }>;

const fakeWin = () =>
  ({
    webContents: { send: (c: string, pay: any) => sent.push({ channel: c, payload: pay }) },
    isDestroyed: () => false,
  }) as never;

/** 一次评测量的全部信号（与旧版 runCase 的口径一致：只看用户能看到的） */
interface RunResult {
  ops: string[];
  nodeKinds: string[];
  issueCodes: string[];
  modelCalls: number;
  ms: number;
  proposal: Proposal | null;
  chunkText: string;
  stats: any[];
}

async function runCase(requirement: string, mode?: 'blocks' | 'code' | 'duo' | 'creator'): Promise<RunResult> {
  sent = [];
  const started = Date.now();
  await processAiChat(projectPath, requirement, fakeWin(), (mode ? { mode } : {}) as never);
  const proposal = (sent.find((s) => s.channel === 'ai:proposal')?.payload?.proposal ??
    null) as Proposal | null;
  const chunks = sent.filter((s) => s.channel === 'ai:chunk');
  return {
    ops: proposal?.operations.map((o) => o.kind) ?? [],
    nodeKinds: (proposal?.operations ?? [])
      .filter((o) => o.kind === 'add_node')
      .map((o) => String((o as { nodeKind?: string }).nodeKind ?? '')),
    issueCodes: proposal?.validation?.introduced.map((i) => i.code) ?? [],
    modelCalls: callLlmMock.mock.calls.length,
    ms: Date.now() - started,
    proposal,
    chunkText: chunks.map((s) => String(s.payload?.text ?? '')).join(''),
    stats: sent.filter((s) => s.channel === 'ai:stats').map((s) => s.payload?.stats),
  };
}

// 目录是**真的**：模型提议的 nodeKind 必须能在目录里查到（假词表是历史高发事故）
const KNOWN_KINDS = new Set(NODE_CATALOG_V2.map((n) => n.kind));

beforeEach(async () => {
  callLlmMock.mockReset();
  executeCalls.length = 0;
  measureMock.mockReset();
  // 量上下文：给一个恒定的估算值，避免评测变成"随机器抖动的 token 数字"
  measureMock.mockReturnValue({ estimatedTokens: 10, chars: 100, heaviest: [] });
  systemMsgMock.mockReset();
  systemMsgMock.mockImplementation(async () => ({ role: 'system', content: 'SYS' }));
  resolveMock.mockReset();
  setAiConfig({ provider: 'glm', apiKey: 'k', model: 'm' } as never);
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-eval-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
  await writeFile(
    join(projectPath, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', systems: [], nodes: [], edges: [] }),
    'utf-8',
  );
  // 每个用例都是新的临时项目目录：没有历史记忆，不需要显式清（导出里也没有 clearAiHistory）
});

describe('★ 任务级评测（脚本化模型，工具/提案/校验全真跑）', () => {
  it('① 简单需求：产出提案，且提议的 nodeKind 都在节点目录里', async () => {
    scriptModel([
      {
        tools: [{ name: 'add_node', args: { nodeKind: 'message_send', tempRef: 'n1' } }],
        text: '提交',
      },
    ]);
    const r = await runCase('加一条回复');

    expect(r.proposal, '没有产出提案').toBeTruthy();
    expect(r.ops, '提案里没有 add_node').toContain('add_node');
    expect(r.nodeKinds.length).toBeGreaterThan(0);

    // ★ 最要紧的一条：它提议的 nodeKind 必须**真的存在于节点目录里**。
    for (const kind of r.nodeKinds) {
      expect(KNOWN_KINDS.has(kind), `提议了不存在的 nodeKind: ${kind}`).toBe(true);
    }
    // 全流程至少真的调了一次模型
    expect(r.modelCalls).toBeGreaterThan(0);
  });

  it('⑫ 后门：write_file 直改 .qqbat/flow.json 必须被拒（不落成操作、磁盘不动）', async () => {
    const flowPath = join(projectPath, '.qqbat', 'flow.json');
    const flowBefore = await readFile(flowPath, 'utf-8');
    scriptModel([
      {
        tools: [
          { name: 'write_file', args: { path: '.qqbat/flow.json', content: '{"nodes":[]}' } },
        ],
        text: '改好了',
      },
    ]);
    // 必须用**代码页角色**（coder 才拿得到 write_file）：否则会先被角色工具表挡掉，
    // 测到的就不是「提案层拒绝应用管理文件」这条护栏了。
    const r = await runCase('帮我梳理一下这条流程', 'code');

    expect(r.ops, 'write_file 直改流程数据必须被拒（这是后门）').not.toContain('write_code');
    expect(await readFile(flowPath, 'utf-8'), '磁盘上的 flow.json 被改了').toBe(flowBefore);
    // 工具确实被派发了、结果也回到了模型：脚本第二步还跑了一次（否则可能是被角色表挡掉，
    // 那测到的就不是本文件要钉的「提案层护栏」）。
    expect(r.modelCalls, '工具调用没有回到模型（可能根本没派发）').toBeGreaterThanOrEqual(2);
  });

  it('⑬ 接线：用户需求原文进 buildSystemMessage；ai:stats 发出且未回传用量时 usageReported=false', async () => {
    scriptModel([{ text: '好' }]);
    const requirement = '帮我梳理一下这条流程';
    const r = await runCase(requirement);

    // P3「领域知识包按需求装载」的前提：需求原文必须传进第 4 参；顺序接错就永远装不上
    const calls = systemMsgMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastOptions = calls[calls.length - 1]?.[3];
    expect(lastOptions?.requirement).toBe(requirement);

    // 状态条：事件真的发了；脚本没回传 usage ⇒ 不显示 token 数字（而不是显示 0）
    expect(r.stats.length, '没有发 ai:stats').toBeGreaterThan(0);
    const last = r.stats[r.stats.length - 1];
    expect(last.usageReported).toBe(false);
    expect(last.rounds).toBeGreaterThanOrEqual(1);
  });
});