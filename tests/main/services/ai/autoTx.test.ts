// tests/main/services/ai/autoTx.test.ts
//
// # 闸门：**运行级自动事务**（P0-4）—— 多轮 mutation 的原子性
//
// ## 真机事故（本闸门存在的理由）
//
// 助手删掉节点、准备重建时模型额度 403 中断 → 删除已经落盘、重建没发生：
// **用户的流程永久少一个节点，而且没有任何提示**。
// 根因不是"模型不听话"，而是多轮改动之间**没有事务边界**。
// 仓库里其实已经有 begin_batch/commit_batch/rollback_batch —— 但它们要**模型自己想起来用**。
//
// 本文件钉住四件事（全部是**结构性断言**，不靠"模型会自觉"）：
//   ① 第一次真要改东西时，事务**自己**开（不看模型有没有调 begin_batch）；
//   ② 三种中断（403 / 抛错 / 取消）⇒ **磁盘回到运行前**（真读真写，不是断言事件名）；
//      ⚠️ 2026-10-18（P1-4）契约变更：出错**仍然交部分提案**（标"部分，因错误提前结束"），
//      与「上下文超限 / 规划超时」两条降级路径一致 —— 成本已经付过，由用户在卡片上决定要不要。
//      **取消**是例外：取消不交任何东西（用户的意图就是"别做了"）。
//   ③ 正常收尾 ⇒ **提交**（改动留着，且不误伤）；用户自己开的批次**不许被打乱**；
//   ④ 开关关掉 ⇒ 一切照旧（不自动开、不自动提交、不自动回滚 —— 磁盘留着半成品，与改造前一致）。
//
// ## 2026-10-23 恢复说明
// 原文件在恢复树里被 porter 截成三段（mock 头之后直接跳进 `mockRounds`、中段丢了
// describe 头、尾部断在"用户自己开过批次"那个用例中间），磁带里只有局部 read，没有完整快照。
// 这里按 `src/main/services/ai/autoTx.ts` + `index.ts`（closeAutoTxRun / finally）的现状重写：
// 判据、三种中断、正常收尾、让位、开关五组都在；**没有**凭空补"用户自己批次之后"的用例。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { callLlmMock } = vi.hoisted(() => ({ callLlmMock: vi.fn() }));

/**
 * 只替换 `callLlm`：保留 llm.ts 的其余导出（`callLlmWithFallback` 在 llmFallback.ts 里，
 * 它 import 的正是这个被替换的 `callLlm`）。整模块替换会让 callLlmWithFallback 变成 undefined。
 */
vi.mock('@main/services/ai/llm', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, callLlm: callLlmMock };
});

import { resolveInstruction } from '@main/services/ai/instructionBridge';
import {
  beginBatch,
  cancelAiChat,
  commitBatch,
  isBatchModeFor,
  processAiChat,
  setAiConfig,
} from '@main/services/ai';
import { autoTxRollbackReason, decideAutoTxOutcome, isAutoTxEnabled } from '@main/services/ai/autoTx';
import { recordFileBefore } from '@main/services/flow/turnJournal';

/** 这一段运行里**真的落过盘**的文件（假装是渲染层/直连路径写下去的） */
const TOUCHED = 'plugins/ai-x/index.js';
const BEFORE = 'OLD';
const AFTER = 'NEW';

/** 测试里的渲染层：收到指令立刻回 applied（P1-1 回执协议；不回会让每条指令等 15s 超时） */
function autoReplyApplied(channel: string, payload: any): void {
  const requestId = payload?.requestId as string | undefined;
  if (channel === 'ai:clientInstruction' && requestId) {
    resolveInstruction({ requestId, outcome: { status: 'applied' } });
  }
}

function makeFakeWin() {
  const sent: Array<{ channel: string; payload: any }> = [];
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
        autoReplyApplied(channel, payload);
      },
    },
    isDestroyed: () => false,
  };
  return { win: win as never, sent };
}

const addNodeCall = {
  id: 'c-add',
  type: 'function',
  function: {
    name: 'add_node',
    arguments: JSON.stringify({ nodeKind: 'message_send', tempRef: 'new_x' }),
  },
};

type Round = (cb: any) => void | Promise<void>;

/** 把"第 n 轮模型说了什么"写成一张表：每项自己决定调哪些工具、吐什么文本、要不要抛错 */
function mockRounds(rounds: Round[]): void {
  let i = 0;
  callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
    const round = rounds[i] ?? rounds[rounds.length - 1];
    i += 1;
    await round(cb);
  });
}

/** 事务开没开（我们发的是既有那条 begin_batch 指令） */
const instructionNames = (sent: Array<{ channel: string; payload: any }>): string[] =>
  sent
    .filter((s) => s.channel === 'ai:clientInstruction')
    .map((s) => String(s.payload?.instruction?.name ?? ''));

const proposalOf = (sent: Array<{ channel: string; payload: any }>) =>
  (sent.find((s) => s.channel === 'ai:proposal')?.payload?.proposal ?? null) as {
    summary: string;
    operations: Array<{ kind: string }>;
  } | null;

const warnings = (sent: Array<{ channel: string; payload: any }>): string[] =>
  sent.filter((s) => s.channel === 'ai:warning').map((s) => String(s.payload?.message ?? ''));

let projectPath: string;
let savedEnv: string | undefined;

beforeEach(async () => {
  callLlmMock.mockReset();
  savedEnv = process.env.QQBAT_AUTO_TX;
  delete process.env.QQBAT_AUTO_TX;
  setAiConfig({ provider: 'glm', apiKey: 'k', model: 'm' } as never);
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-autotx-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
  await mkdir(join(projectPath, 'plugins', 'ai-x'), { recursive: true });
  await writeFile(
    join(projectPath, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', systems: [], nodes: [], edges: [] }),
  );
  await writeFile(join(projectPath, TOUCHED), BEFORE);
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.QQBAT_AUTO_TX;
  else process.env.QQBAT_AUTO_TX = savedEnv;
  // 万一有用例把批次留在活动态，别把 30s 定时器带进下一个用例
  try {
    commitBatch(projectPath);
  } catch {
    /* 项目目录已删也无所谓 */
  }
  /**
   * 清理要**重试**：运行里还有 fire-and-forget 的写（trace 是 void appendTrace），
   * 它们在 rm 遍历目录之后才落盘，rmdir 会撞 ENOTEMPTY。
   * 这不是被测代码的失败，是测试收尾与后台写的竞态 —— 重试几次即可，别改用固定 sleep。
   */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(projectPath, { recursive: true, force: true });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
});

const diskOf = (): Promise<string> => readFile(join(projectPath, TOUCHED), 'utf-8');

/** 第 2 轮：模拟"这一次运行真的把文件写下去了"（走**真实**的日志接口 + 真写盘） */
async function touchDiskThen(cb: any, thrower: unknown): Promise<void> {
  await recordFileBefore(projectPath, TOUCHED);
  await writeFile(join(projectPath, TOUCHED), AFTER);
  if (thrower !== null) throw thrower;
  cb.onComplete('提交');
}

// =============================================================================
// 判据（纯函数：不跑循环也能穷举）
// =============================================================================

describe('★ 自动事务的判据', () => {
  it('开关：只有 QQBAT_AUTO_TX=1 才开（默认关）', () => {
    expect(isAutoTxEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutoTxEnabled({ QQBAT_AUTO_TX: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutoTxEnabled({ QQBAT_AUTO_TX: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutoTxEnabled({ QQBAT_AUTO_TX: '1' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('处置判据：开关关 / 不是我们开的事务 ⇒ 一律不归它管', () => {
    const base = { enabled: true, opened: true, aborted: false, errored: false, degraded: false };
    expect(decideAutoTxOutcome({ ...base, enabled: false })).toBe('none');
    expect(decideAutoTxOutcome({ ...base, opened: false })).toBe('none');
  });

  it('处置判据：报错 / 取消 / 没能正常收尾 ⇒ 回滚；其余 ⇒ 提交', () => {
    const base = { enabled: true, opened: true, aborted: false, errored: false, degraded: false };
    expect(decideAutoTxOutcome(base)).toBe('commit');
    expect(decideAutoTxOutcome({ ...base, aborted: true })).toBe('rollback');
    expect(decideAutoTxOutcome({ ...base, errored: true })).toBe('rollback');
    expect(decideAutoTxOutcome({ ...base, degraded: true })).toBe('rollback');
    // 取消优先：即使用 abort 引起的报错同时置了 errored，也还是回滚（两个都回滚，这里钉住不会返回 commit）
    expect(decideAutoTxOutcome({ ...base, aborted: true, errored: true })).toBe('rollback');
  });

  it('回滚原因文案（只给人读，不参与判据）', () => {
    expect(autoTxRollbackReason('commit')).toContain('正常收尾');
    expect(autoTxRollbackReason('rollback')).toContain('报错');
    expect(autoTxRollbackReason('none')).toContain('不归');
  });
});

// =============================================================================
// 三种中断：磁盘不许留半成品
// =============================================================================

describe('★ 中断必回滚：磁盘回到这次运行之前', () => {
  it('★ 403（额度用尽）⇒ 自动开事务 + 自动回滚 + 磁盘还原 + 交部分提案', async () => {
    process.env.QQBAT_AUTO_TX = '1';
    mockRounds([
      async (cb) => {
        await cb.onToolCalls([addNodeCall]);
        cb.onComplete('');
      },
      (cb) => touchDiskThen(cb, new Error('HTTP 403 FreeTierOnly: quota exceeded')),
    ]);
    const { win, sent } = makeFakeWin();

    await processAiChat(projectPath, '加个节点', win, { mode: 'blocks' });

    // ① 事务**自己**开了（模型这一轮压根没调 begin_batch）
    expect(instructionNames(sent), '第一次 mutation 前必须自动开事务').toContain('begin_batch');
    // ② 走的是**既有的**失败回滚通道（渲染层收到就 rollbackBatch）
    expect(sent.some((s) => s.channel === 'ai:needRollback')).toBe(true);
    // ③ ★ 磁盘：这一次运行写下去的内容被还原
    expect(await diskOf(), '中断后磁盘必须回到运行前').toBe(BEFORE);
    // ④ **部分提案照发**（P1-4，2026-10-18）：
    //    以前"出错就什么都不交"，代价是十几轮的成本与已规划操作全丢；
    //    现在与「上下文超限 / 轮数用尽」一致 —— 交一张标了"部分"的卡片，由用户决定。
    const partial = proposalOf(sent);
    expect(partial, '失败时要把已累积的操作交出去').toBeTruthy();
    expect(partial!.operations.map((o) => o.kind)).toContain('add_node');
    expect(partial!.summary, '必须标明这是"部分"计划').toContain('部分');
    // ⑤ 失败原因仍然要说（不能只给卡片不说为什么）
    expect(sent.some((s) => s.channel === 'ai:error')).toBe(true);
    // ⑥ 事务状态收干净了（否则下一个请求会以为自己还在事务里）
    expect(isBatchModeFor(projectPath)).toBe(false);
    // ⑦ 真动过盘 ⇒ 要给用户一句可见的交代（不然就是"少了个节点也没提示"的老事故）
    expect(warnings(sent).join(' | ')).toContain('自动回滚');
  });

  it('★ 抛错（网络/解析）⇒ 同样回滚，磁盘还原', async () => {
    process.env.QQBAT_AUTO_TX = '1';
    mockRounds([
      async (cb) => {
        await cb.onToolCalls([addNodeCall]);
        cb.onComplete('');
      },
      (cb) => touchDiskThen(cb, new Error('socket hang up')),
    ]);
    const { win, sent } = makeFakeWin();

    await processAiChat(projectPath, '加个节点', win, { mode: 'blocks' });

    expect(instructionNames(sent)).toContain('begin_batch');
    expect(sent.some((s) => s.channel === 'ai:needRollback')).toBe(true);
    expect(await diskOf()).toBe(BEFORE);
    expect(isBatchModeFor(projectPath)).toBe(false);
  });

  it('★ 用户取消 ⇒ 回滚（即使既有的取消逻辑已经把批次状态提交掉）', async () => {
    process.env.QQBAT_AUTO_TX = '1';
    mockRounds([
      async (cb) => {
        await cb.onToolCalls([addNodeCall]);
        cb.onComplete('');
      },
      async (cb) => {
        await recordFileBefore(projectPath, TOUCHED);
        await writeFile(join(projectPath, TOUCHED), AFTER);
        cancelAiChat(projectPath); // 用户点了「停止」
        throw new Error('AbortError');
      },
    ]);
    const { win, sent } = makeFakeWin();

    await processAiChat(projectPath, '加个节点', win, { mode: 'blocks' });

    expect(instructionNames(sent)).toContain('begin_batch');
    expect(sent.some((s) => s.channel === 'ai:needRollback')).toBe(true);
    expect(await diskOf(), '取消也要回到运行前').toBe(BEFORE);
    // 取消不交提案：用户的意图就是"别做了"
    expect(proposalOf(sent)).toBeNull();
    expect(sent.some((s) => s.channel === 'ai:error'), '取消不算故障，不发 error').toBe(false);
  });
});

// =============================================================================
// 正常收尾 / 用户自己的批次 / 开关关掉
// =============================================================================

describe('★ 正常收尾才提交；别人的事务不碰；关掉就照旧', () => {
  it('★ 正常收尾 ⇒ 提交：改动留着、提案照出、没有回滚', async () => {
    process.env.QQBAT_AUTO_TX = '1';
    mockRounds([
      async (cb) => {
        await cb.onToolCalls([addNodeCall]);
        cb.onComplete('');
      },
      async (cb) => {
        await recordFileBefore(projectPath, TOUCHED);
        await writeFile(join(projectPath, TOUCHED), AFTER);
        cb.onComplete('提交');
      },
    ]);
    const { win, sent } = makeFakeWin();

    await processAiChat(projectPath, '加个节点', win, { mode: 'blocks' });

    expect(instructionNames(sent)).toContain('begin_batch');
    expect(instructionNames(sent), '正常收尾要提交').toContain('commit_batch');
    expect(
      sent.some((s) => s.channel === 'ai:needRollback'),
      '正常收尾不许回滚',
    ).toBe(false);
    expect(await diskOf(), '正常收尾的改动必须留着').toBe(AFTER);
    expect(proposalOf(sent)?.operations.map((o) => o.kind)).toEqual(['add_node']);
    expect(isBatchModeFor(projectPath)).toBe(false);
  });

  it('★ 用户自己开过批次 ⇒ 自动逻辑不重复开、也不替它提交/回滚', async () => {
    process.env.QQBAT_AUTO_TX = '1';
    const { win, sent } = makeFakeWin();
    // 用户（或模型）自己先开了一笔事务：自动逻辑必须**让位**
    beginBatch(projectPath, win);
    expect(isBatchModeFor(projectPath)).toBe(true);

    mockRounds([
      async (cb) => {
        await cb.onToolCalls([addNodeCall]);
        cb.onComplete('');
      },
      async (cb) => {
        await recordFileBefore(projectPath, TOUCHED);
        await writeFile(join(projectPath, TOUCHED), AFTER);
        cb.onComplete('提交');
      },
    ]);

    await processAiChat(projectPath, '加个节点', win, { mode: 'blocks' });

    expect(instructionNames(sent), '不重复开事务').not.toContain('begin_batch');
    expect(instructionNames(sent), '不替别人提交').not.toContain('commit_batch');
    expect(sent.some((s) => s.channel === 'ai:needRollback')).toBe(false);
    // 那笔事务还是活的（提交/回滚由它自己那条路决定）
    expect(isBatchModeFor(projectPath)).toBe(true);
    expect(await diskOf()).toBe(AFTER);
  });

  it('★ 开关关掉 ⇒ 一切照旧：不开、不提交、不回滚', async () => {
    // beforeEach 已经 delete 了 env（默认关）
    mockRounds([
      async (cb) => {
        await cb.onToolCalls([addNodeCall]);
        cb.onComplete('');
      },
      (cb) => touchDiskThen(cb, new Error('HTTP 403 FreeTierOnly: quota exceeded')),
    ]);
    const { win, sent } = makeFakeWin();

    await processAiChat(projectPath, '加个节点', win, { mode: 'blocks' });

    expect(instructionNames(sent)).not.toContain('begin_batch');
    expect(instructionNames(sent)).not.toContain('commit_batch');
    expect(sent.some((s) => s.channel === 'ai:needRollback')).toBe(false);
    // 改造前的行为就是**留着半成品**（这正是 P0-4 要治的病，关掉开关就退回病态）
    expect(await diskOf()).toBe(AFTER);
    expect(proposalOf(sent)?.operations.map((o) => o.kind)).toEqual(['add_node']);
  });
});
