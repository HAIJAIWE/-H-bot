// tests/evals/multiAgentEvals.test.ts
//
// # 多智能体路径的端到端评测（2026-10-18）
//
// 12 条任务级 eval 跑的都是"多智能体关闭"的路径（测试里 QQBAT_MULTI_AGENT=0）。
// 本文件专测**开启**时：侦察 → 规划 → 执行 的整条链路，以及 trace 里能看见谁产出了什么。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { callLlmMock } = vi.hoisted(() => ({ callLlmMock: vi.fn() }));
vi.mock('@main/services/ai/llm', () => ({ callLlm: callLlmMock }));
vi.mock('@shared/types/ai-provider', () => ({
  providerRegistry: { getOrCreate: () => ({ embed: async () => [] }), setCurrent: () => {} },
}));

import { processAiChat, setAiConfig, clearAiHistory } from '@main/services/ai/index';
import { readTrace } from '@main/services/ai/trace';

let projectPath: string;
let sent: Array<{ channel: string; payload: any }>;

const fakeWin = () => ({ webContents: { send: (c: string, pay: any) => sent.push({ channel: c, payload: pay }) }, isDestroyed: () => false }) as never;

/** 按顺序脚本化模型：侦察 → 规划 → 执行（工具） → 收尾 */
function scriptMultiAgent(): void {
  let i = 0;
  callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
    i += 1;
    if (i === 1) {
      // 侦察者：一条事实
      cb.onComplete(JSON.stringify({ findings: ['已有 /签到 命令词'] }));
      return;
    }
    if (i === 2) {
      // 规划者：两步计划
      cb.onComplete(
        JSON.stringify({
          goal: '给签到加三档奖励',
          steps: [{ intent: '查现成片段', tools: ['list_templates'] }, { intent: '改回复文案' }],
          risks: [],
        }),
      );
      return;
    }
    if (i === 3) {
      // 执行者：直接调 add_node（进提案，不落盘）
      await cb.onToolCalls([
        {
          id: 'c1',
          type: 'function',
          function: {
            name: 'add_node',
            arguments: JSON.stringify({ nodeKind: 'message_send', tempRef: 'new_reward' }),
          },
        },
      ]);
      cb.onComplete('');
      return;
    }
    cb.onComplete('已按计划提交改动。');
  });
}

beforeEach(async () => {
  callLlmMock.mockReset();
  sent = [];
  process.env.QQBAT_MULTI_AGENT = '1';
  process.env.QQBAT_SUBAGENT_LANES = '0';
  setAiConfig({ provider: 'glm', apiKey: 'k', model: 'm' } as never);
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-ma-eval-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
  await writeFile(
    join(projectPath, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', systems: [], nodes: [], edges: [] }),
    'utf-8',
  );
  clearAiHistory(projectPath);
});

// 恢复说明（2026-10-23）：
// 这两个用例测的是 QQBAT_MULTI_AGENT=1 的「侦察 → 规划 → 执行」链路。已核实 10/18 的两个产物
// （out/main/index.js、renderer-index.js）里 QQBAT_MULTI_AGENT / QQBAT_SUBAGENT_LANES /
// runPlanLanes / scoutWithModel 命中数全为 0 —— 这条链路在恢复的构建里**还不存在**（scout.ts /
// lanes.ts 是之后的 revision）。等把 lanes 接进 index.ts 再打开（接入点已在 deadExports 基线登记）。
describe.skip('★ 多智能体端到端（侦察 → 规划 → 执行）', () => {
  it('★ 侦察/规划真的跑了，计划进上下文，执行产出提案', async () => {
    scriptMultiAgent();
    await processAiChat(projectPath, '帮我把签到改成分三档奖励，并且加一个冷却检查', fakeWin(), {} as never);

    // ① 三个角色都在 trace 里（父代理能看到谁产出了什么）
    const trace = await readTrace(projectPath);
    const names = trace.map((e) => e.name);
    expect(names, '侦察者没跑').toContain('scout');
    expect(names, '规划者没跑').toContain('planner');
    // ② 计划进了执行者的上下文 → 最终产出提案
    const proposal = sent.find((s) => s.channel === 'ai:proposal')?.payload?.proposal;
    expect(proposal, '没有产出提案').toBeTruthy();
    expect(proposal.operations.map((o: { kind: string }) => o.kind)).toContain('add_node');
    // ③ trace 行带 turnId（同一次运行可聚合）
    expect(trace.filter((e) => e.name === 'scout').every((e) => typeof e.turnId === 'string')).toBe(true);
  });

  it('★ 侦察失败 ⇒ 退回单 agent，规划仍可工作（fail-open）', async () => {
    let i = 0;
    callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      i += 1;
      if (i === 1) throw new Error('scout down');
      if (i === 2) {
        cb.onComplete(JSON.stringify({ goal: 'g', steps: [{ intent: '一步' }], risks: [] }));
        return;
      }
      cb.onComplete('完成。');
    });
    await processAiChat(projectPath, '帮我把签到改成分三档奖励，并加冷却检查', fakeWin(), {} as never);
    const trace = await readTrace(projectPath);
    expect(trace.map((e) => e.name)).not.toContain('scout');
    expect(trace.map((e) => e.name)).toContain('planner');
  });
});
