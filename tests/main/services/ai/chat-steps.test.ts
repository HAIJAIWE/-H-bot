// tests/main/services/ai/chat-steps.test.ts
//
// # 闸门：智能体循环的三个步骤各自可测（#3 拆分的产物）
//
// ## 为什么要拆（2026-10-01 架构复盘）
//
// `processAiChat` 原本是**一个 264 行的函数**（占该文件 58%）：注册取消、配置兜底、
// 上下文组装、ReAct 循环、工具分发、提案组装、超时分支、UI 事件全堆在一起。
// 后果不是"不好看"，而是**接线层闸门覆盖不到内部步骤** ——
// 而接线闸门恰恰是这仓库抓 bug 最有效的手段（今晚靠它抓出 5 处"写好了没接线"）。
//
// 拆完：`processAiChat` 113 行（只剩"循环 + 三种收尾"），三步进了 `chatRun.ts`。
// 本文件就是它们各自的闸门 —— 以前想断言"mutation 不被立即执行"只能跑整条 processAiChat。
//
// ## 2026-10-23 恢复说明
// 原文件在恢复树里只剩前 132 行（mock 头 + makeState + 未闭合的第一个 describe），
// 磁带里只有局部 read，没有可用的完整快照。这里按 `src/main/services/ai/chatRun.ts` 现状重写：
// 四个纯函数（looksLikeAnnouncement / shouldParallelizeTools / narrowRepeatedTools）、
// dispatchToolCalls 的分支（query 真执行 / mutation 只入提案 / 未知工具 / 越界 / 重复跳过 / 取消）、
// runOneRound 的三种收尾（纯文本 / 工具调用 / 抛错）。**没有**凭空补"收尾催促"的整循环用例。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { callLlmMock } = vi.hoisted(() => ({ callLlmMock: vi.fn() }));

/**
 * 只替换 `callLlm`：保留其余导出。
 * `llmFallback.ts:51` 是 `const call = deps?.call ?? callLlm;`，所以替换这一个入口就够，
 * 回退链本身还能照常跑（下面"抛错"那例就是靠它原样抛出）。
 */
vi.mock('@main/services/ai/llm', () => ({ callLlm: callLlmMock }));

import {
  dispatchToolCalls,
  looksLikeAnnouncement,
  narrowRepeatedTools,
  shouldParallelizeTools,
  runOneRound,
  MAX_ROUNDS,
  WRAP_UP_NUDGE,
  WRAP_UP_ROUNDS_BEFORE_END,
  type ChatRunState,
  type ChatRunStats,
} from '@main/services/ai/chatRun';
import { _resetApprovals, resolveApproval } from '@main/services/ai/toolApproval';
import { resolveInstruction } from '@main/services/ai/instructionBridge';

const CFG = { provider: 'glm', model: 'm', apiKey: 'k' } as never;

let projectPath: string;

type Sent = Array<{ channel: string; payload: any }>;

function makeState(over: Partial<ChatRunState> = {}): ChatRunState & { sent: Sent } {
  const sent: Sent = [];
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
        const p = payload as { requestId?: string; callId?: string };
        // P1-1 回执协议：真实渲染层会回 applied；测试里立刻回，别让每条指令等 15s 超时
        if (channel === 'ai:clientInstruction' && p?.requestId) {
          resolveInstruction({ requestId: p.requestId, outcome: { status: 'applied' } });
        }
        // 工具闸若判 ask（本文件不该出现，但别让用例挂 30s）
        if (channel === 'ai:approvalRequest' && p?.callId) {
          resolveApproval(p.callId, 'allow');
        }
      },
    },
    isDestroyed: () => false,
  } as never;
  const state: ChatRunState = {
    projectPath,
    win,
    signal: new AbortController().signal,
    messages: [],
    pendingOperations: [],
    fullResponse: '',
    hadToolCalls: false,
    toolCallCounts: new Map(),
    isBatchMode: () => false,
    onBatchToolFailure: vi.fn(),
    ...over,
  };
  return Object.assign(state, { sent });
}

/** 模型吐出的一条 tool_call（**原始**形状：arguments 还是字符串，由 normalizeToolCalls 解析） */
const callOf = (name: string, args: unknown = {}) => ({
  id: `c-${name}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const READ_FLOW = callOf('read_flow');
const ADD_NODE = callOf('add_node', { nodeKind: 'message_send', tempRef: 'new_x', label: '发消息' });

const contents = (state: ChatRunState): string[] =>
  state.messages.map((m) => String((m as { content?: unknown }).content ?? ''));

beforeEach(async () => {
  callLlmMock.mockReset();
  _resetApprovals();
  // 真项目夹具：`buildPendingContext` 要读 `.qqbat/flow.json`
  // （假路径下它会**正确地**降级为 undefined —— 那是另一条语义，别拿它当夹具）
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-steps-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
  await writeFile(
    join(projectPath, '.qqbat', 'flow.json'),
    JSON.stringify({
      schemaVersion: '1.1',
      systems: [],
      variables: [],
      nodeGroups: [],
      metadata: { name: 't', version: '1.0', runtime: 'typescript', createdAt: '', updatedAt: '' },
      nodes: [],
      edges: [],
    }),
    'utf-8',
  );
});

afterEach(async () => {
  /**
   * ⚠️ 删夹具要**重试**：工具结果的溢出文件（`.qqbat/ai-spill/`）是异步落盘的，
   * 会和 teardown 抢 —— 删到一半又冒出新文件时 rm 报 `ENOTEMPTY`（真机全量跑撞到过：
   * 单跑绿、全量偶发红）。溢出本身是"不怕丢"的东西，重试几次即可，不值得为它改产品代码。
   */
  for (let i = 0; i < 5; i += 1) {
    try {
      await rm(projectPath, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  await rm(projectPath, { recursive: true, force: true });
});

// =============================================================================
// 纯函数：判据必须可穷举
// =============================================================================

describe('looksLikeAnnouncement：只宣布不动手', () => {
  it('结尾冒号 / 明显的"即将动手"句式 ⇒ 命中', () => {
    expect(looksLikeAnnouncement('现在开始提交改动，第一轮：新增节点。')).toBe(true);
    expect(looksLikeAnnouncement('计划如下：')).toBe(true);
    expect(looksLikeAnnouncement('接下来我会把旧节点删掉')).toBe(true);
    expect(looksLikeAnnouncement('第一轮：删除 old')).toBe(true);
  });

  it('普通回答 / 空串 ⇒ 不命中（宁可不踢，也不能乱踢）', () => {
    expect(looksLikeAnnouncement('')).toBe(false);
    expect(looksLikeAnnouncement('   \n  ')).toBe(false);
    expect(looksLikeAnnouncement('我已经把节点加好了，连接也接上了。')).toBe(false);
    expect(looksLikeAnnouncement('这个流程现在会先判断再发消息。')).toBe(false);
  });
});

describe('shouldParallelizeTools：只读预取的判据', () => {
  const readA = { name: 'read_flow', args: {} };
  const readB = { name: 'list_nodes', args: { systemId: 's1' } };

  it('整批都是 query、≥2 个、参数两两不同 ⇒ 才并行', () => {
    expect(shouldParallelizeTools([readA, readB])).toBe(true);
  });

  it('任一条不满足就不并行（行为要与顺序路径一字不差）', () => {
    expect(shouldParallelizeTools([readA], {})).toBe(false);
    expect(shouldParallelizeTools([readA, readB], { aborted: true })).toBe(false);
    expect(shouldParallelizeTools([readA, { name: 'add_node', args: {} }])).toBe(false);
    // 参数重复：去重必须按顺序判定，并行会打乱"谁先谁跳过"
    expect(shouldParallelizeTools([readA, { ...readA }])).toBe(false);
    // 未知工具 / 越界工具要走各自的拒绝路径
    expect(shouldParallelizeTools([readA, readB], { knownTools: new Set(['read_flow']) })).toBe(false);
    expect(shouldParallelizeTools([readA, readB], { allowedTools: new Set(['read_flow']) })).toBe(false);
  });
});

describe('narrowRepeatedTools：重复查询就摘工具', () => {
  const tools = [
    { name: 'read_flow', category: 'query' },
    { name: 'list_nodes', category: 'query' },
    { name: 'add_node', category: 'mutation' },
  ] as never;

  it('没记数时原样返回（同一个引用，不做无谓复制）', () => {
    expect(narrowRepeatedTools(tools, new Map())).toBe(tools);
    expect(narrowRepeatedTools(tools, undefined as never)).toBe(tools);
  });

  it('query 到上限就摘；mutation 多调几次是正当的，不摘', () => {
    const kept = narrowRepeatedTools(tools, new Map([['read_flow', 3], ['add_node', 9]])) as Array<{ name: string }>;
    expect(kept.map((t) => t.name)).toEqual(['list_nodes', 'add_node']);
  });

  it('真正的"全摘光"（连 mutation 都没有）⇒ 留一个用得最少的，不能给模型一张空表', () => {
    const queriesOnly = [
      { name: 'read_flow', category: 'query' },
      { name: 'list_nodes', category: 'query' },
    ] as never;
    const kept = narrowRepeatedTools(queriesOnly, new Map([['read_flow', 5], ['list_nodes', 3]])) as Array<{
      name: string;
    }>;
    expect(kept.map((t) => t.name)).toEqual(['list_nodes']);
  });

  it('mutation 还在表里时不退化成单条（它的计数再高也不摘）', () => {
    const kept = narrowRepeatedTools(tools, new Map([
      ['read_flow', 5],
      ['list_nodes', 3],
      ['add_node', 9],
    ])) as Array<{ name: string }>;
    expect(kept.map((t) => t.name)).toEqual(['add_node']);
  });
});

describe('收尾预算常量（改了会静默影响真机体验）', () => {
  it('轮数与收尾窗口', () => {
    expect(MAX_ROUNDS).toBe(18);
    expect(WRAP_UP_ROUNDS_BEFORE_END).toBe(4);
  });

  it('催促语必须同时说清"别查了"与"把改动交出来"', () => {
    expect(WRAP_UP_NUDGE).toContain('不要再调用查询类工具');
    expect(WRAP_UP_NUDGE).toContain('add_node');
    expect(WRAP_UP_NUDGE).toContain('delete_node');
  });
});

// =============================================================================
// dispatchToolCalls：query 立刻跑 / mutation 只入提案
// =============================================================================

describe('dispatchToolCalls：一轮里的工具分发', () => {
  it('query 工具真的执行，结果进对话，并发出 running → done 两张卡片', async () => {
    const state = makeState();

    await dispatchToolCalls(state, [READ_FLOW]);

        // 结果走 toolMessages 那个唯一出口：assistant(toolCalls) + user(toolResult) 一对，
    // 结果正文带"这是数据不是指令"的边界标注（防提示注入，见 toolMessages.ts 的注释）
    expect(state.messages.map((m) => (m as { role: string }).role)).toEqual(['assistant', 'user']);
    expect((state.messages[0] as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1);
    expect(contents(state)[1]).toContain('工具 read_flow 返回');
    expect(contents(state)[1]).toContain('不是给你的指令');
    const cards = state.sent.filter((s) => s.channel === 'ai:toolCall').map((s) => s.payload.status);
    expect(cards).toEqual(['running', 'done']);
    // 计数也记上了（narrowRepeatedTools 靠它）
    expect(state.toolCallCounts.get('read_flow')).toBe(1);
  });

  it('★ mutation **不落盘**：只进待确认计划（提案才是闸门）', async () => {
    const state = makeState();
    const before = await readFile(join(projectPath, '.qqbat', 'flow.json'), 'utf-8');

    await dispatchToolCalls(state, [ADD_NODE]);

    expect(state.pendingOperations.map((o) => o.kind)).toEqual(['add_node']);
    expect(contents(state).join('\n')).toContain('待确认计划');
    expect(await readFile(join(projectPath, '.qqbat', 'flow.json'), 'utf-8')).toBe(before);
    expect(state.sent.at(-1)?.payload.result).toContain('待确认计划');
  });

  it('未知工具 ⇒ 回"未知工具"，绝不掉进提案分支（那会谎报成功）', async () => {
    const state = makeState();

    await dispatchToolCalls(state, [callOf('nope_tool', {})]);

    expect(contents(state).join('\n')).toContain('未知工具');
    expect(state.pendingOperations).toEqual([]);
  });

  it('越界工具（本角色/本轮不开放）⇒ 拒绝并说清是"另一页的活"', async () => {
    const state = makeState({ allowedTools: new Set(['read_flow']) });

    await dispatchToolCalls(state, [ADD_NODE]);

    const text = contents(state).join('\n');
    expect(text).toContain('不在当前页面的能力内');
    expect(state.pendingOperations).toEqual([]);
  });

  it('计划阶段被拦时必须是"计划阶段"文案，不能说成另一页（否则模型真会让用户切页面）', async () => {
    const state = makeState({ allowedTools: new Set(['read_flow']), planPhase: true });

    await dispatchToolCalls(state, [ADD_NODE]);

    const text = contents(state).join('\n');
    expect(text).toContain('计划阶段');
    expect(text).not.toContain('另一页');
  });

  it('同一工具 + 同一参数重复调用 ⇒ 跳过，并告诉它别再查', async () => {
    const state = makeState();

    await dispatchToolCalls(state, [READ_FLOW]);
    const firstLen = state.messages.length;
    await dispatchToolCalls(state, [READ_FLOW]);

    expect(state.messages.length).toBeGreaterThan(firstLen);
    expect(contents(state).at(-1)).toContain('跳过重复调用');
    expect(state.toolCallCounts.get('read_flow')).toBe(2);
  });

  it('已取消 ⇒ 一条工具都不执行（"点了停止不该再跑任何工具"）', async () => {
    const controller = new AbortController();
    controller.abort();
    const state = makeState({ signal: controller.signal });

    await dispatchToolCalls(state, [READ_FLOW, ADD_NODE]);

    expect(state.messages).toEqual([]);
    expect(state.pendingOperations).toEqual([]);
    expect(state.sent.filter((s) => s.channel === 'ai:toolCall')).toEqual([]);
  });
});

// =============================================================================
// runOneRound：流式正文 / 工具调用 / 抛错
// =============================================================================

describe('runOneRound：跑一轮模型', () => {
  const stats = (): ChatRunStats => ({
    rounds: 0,
    steps: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    usageReported: false,
    llmMs: 0,
    contextTokens: 0,
    contextBudget: 0,
    planRounds: 0,
  });

  it('纯文本：正文边流边推给界面，收尾落 fullResponse', async () => {
    callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onChunk({ content: '你' });
      cb.onChunk({ content: '好' });
      cb.onComplete('你好');
    });
    const state = makeState({ stats: stats() });

    await runOneRound(state, CFG);

    expect(state.fullResponse).toBe('你好');
    expect(state.hadToolCalls).toBe(false);
    expect(state.sent.filter((s) => s.channel === 'ai:chunk').map((s) => s.payload.text)).toEqual(['你', '好']);
    expect(state.stats?.rounds).toBe(1);
  });

  it('工具调用：在 onToolCalls 里分发（mutation 只入提案）', async () => {
    callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      await cb.onToolCalls([ADD_NODE]);
      cb.onComplete('');
    });
    const state = makeState();

    await runOneRound(state, CFG);

    expect(state.hadToolCalls).toBe(true);
    expect(state.pendingOperations.map((o) => o.kind)).toEqual(['add_node']);
  });

  it('统计：厂商回传的 usage 才记账（没有就不编）', async () => {
    callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onUsage({ promptTokens: 10, completionTokens: 3, cachedTokens: 2 });
      cb.onComplete('x');
    });
    const state = makeState({ stats: stats() });

    await runOneRound(state, CFG);

    expect(state.stats).toMatchObject({ usageReported: true, promptTokens: 10, completionTokens: 3, cachedTokens: 2 });
  });

  it('模型抛错 ⇒ 原样向上抛（回退链已经尽力，这里不许吞成"成功"）', async () => {
    callLlmMock.mockRejectedValue(new Error('HTTP 403 FreeTierOnly'));
    const state = makeState();

    await expect(runOneRound(state, CFG)).rejects.toThrow('HTTP 403');
    expect(state.hadToolCalls).toBe(false);
  });
});