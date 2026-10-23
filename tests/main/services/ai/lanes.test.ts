// tests/main/services/ai/lanes.test.ts
//
// # 并行子代理（Phase 4）
//
// 可以安全并行，因为 mutation 不落盘（只累积成操作）。需要仲裁的只有**合并**：
// 临时引用撞名、同一节点被两条 lane 改。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runOneRoundMock } = vi.hoisted(() => ({ runOneRoundMock: vi.fn() }));
vi.mock('@main/services/ai/chatRun', () => ({ runOneRound: runOneRoundMock }));

import {
  isSubagentLanesEnabled,
  mergeLaneOps,
  namespaceLaneOps,
  renderLaneReports,
  runPlanLanes,
  splitPlanIntoLanes,
} from '@main/services/ai/lanes';

// 注意必须用块体：钩子直接返回 mock 的话，runner 会把它当成清理函数再调一次（零参调用）
beforeEach(() => {
  runOneRoundMock.mockReset();
});

const addNode = (tempRef: string) => ({ kind: 'add_node', tempRef, nodeKind: 'message_send' }) as never;
const connect = (sourceRef: string, targetRef: string) =>
  ({ kind: 'connect', sourceRef, sourcePortId: 'out', targetRef, targetPortId: 'in' }) as never;

describe('★ 并行子代理：切分、命名空间、合并仲裁', () => {
  it('计划切成 ≤2 组（相邻步骤轮询）', () => {
    const steps = [{ intent: 'a' }, { intent: 'b' }, { intent: 'c' }, { intent: 'd' }];
    const groups = splitPlanIntoLanes(steps, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0].map((s) => s.intent)).toEqual(['a', 'c']);
    expect(splitPlanIntoLanes([{ intent: 'x' }], 2)).toHaveLength(1);
  });

  it('★ 临时引用加 lane 前缀；指向既存节点的 id 原样保留', () => {
    const ops = namespaceLaneOps(
      [addNode('new_a'), connect('new_a', 'existing-node-1')],
      'L1',
    ) as Array<Record<string, string>>;
    expect(ops[0].tempRef).toBe('L1_new_a');
    expect(ops[1].sourceRef).toBe('L1_new_a');
    expect(ops[1].targetRef).toBe('existing-node-1');
  });

  it('★ 同一节点被两条 lane 改 ⇒ 保留先到者并记账（不猜意图）', () => {
    const merged = mergeLaneOps([
      { laneId: 'L1', report: 'a', ok: true, // 提案里的操作名是 update_config（工具名才叫 update_node）
      operations: [{ kind: 'update_config', nodeRef: 'n1', config: {} } as never] },
      { laneId: 'L2', report: 'b', ok: true, operations: [{ kind: 'update_config', nodeRef: 'n1', config: { x: 1 } } as never] },
    ]);
    expect(merged.operations).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]).toContain('n1');
  });

  it('★ 并行跑：两条 lane 各自产出，父代理合并；报告里能看到子代理', async () => {
    let call = 0;
    runOneRoundMock.mockImplementation(async (state: { pendingOperations: unknown[]; fullResponse: string; hadToolCalls: boolean }) => {
      call += 1;
      state.hadToolCalls = true;
      state.pendingOperations.push({ kind: 'add_node', tempRef: 'new_' + call, nodeKind: 'message_send' });
      state.fullResponse = 'lane ' + call + ' 完成了';
    });

    const merged = await runPlanLanes({
      projectPath: '/p',
      requirement: '加两条指令',
      plan: { goal: 'g', steps: [{ intent: 'a' }, { intent: 'b' }], risks: [], by: 'llm' },
      config: { provider: 'glm', apiKey: 'k', model: 'm' } as never,
      signal: new AbortController().signal,
    });

    expect(merged?.lanes).toHaveLength(2);
    expect(merged?.operations.length).toBeGreaterThanOrEqual(1);
    const text = renderLaneReports(merged!);
    expect(text).toContain('并行子代理的报告');
    expect(text).toContain('L1');
  });

  it('★ fail-open：一条 lane 抛错只丢那一条；全挂返回 null', async () => {
    let call = 0;
    runOneRoundMock.mockImplementation(async (state: { pendingOperations: unknown[]; fullResponse: string; hadToolCalls: boolean }) => {
      call += 1;
      if (call === 1) throw new Error('network');
      state.hadToolCalls = false;
      state.fullResponse = '只有一条活着';
    });
    const partial = await runPlanLanes({
      projectPath: '/p',
      requirement: 'r',
      plan: { goal: 'g', steps: [{ intent: 'a' }, { intent: 'b' }], risks: [], by: 'llm' },
      config: { provider: 'glm', apiKey: 'k', model: 'm' } as never,
      signal: new AbortController().signal,
    });
    expect(partial?.lanes).toHaveLength(1);

    call = 0;
    runOneRoundMock.mockImplementation(async () => {
      call += 1;
      if (call <= 2) throw new Error('down');
    });
    expect(
      await runPlanLanes({
        projectPath: '/p',
        requirement: 'r',
        plan: { goal: 'g', steps: [{ intent: 'a' }, { intent: 'b' }], risks: [], by: 'llm' },
        config: { provider: 'glm', apiKey: 'k', model: 'm' } as never,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  });

  it('开关：默认开，QQBAT_SUBAGENT_LANES=0 关', () => {
    expect(isSubagentLanesEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isSubagentLanesEnabled({ QQBAT_SUBAGENT_LANES: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
