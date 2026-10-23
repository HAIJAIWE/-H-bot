// tests/main/services/ai/planner.test.ts
//
// # 规划者（多智能体第一阶段）
//
// 它是**另一个上下文**：没有写工具、产出结构化 Plan，执行者读计划动手。
// 三条纪律：格式可解析、失败放行、短需求/纯提问不浪费一轮。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callLlmMock } = vi.hoisted(() => ({ callLlmMock: vi.fn() }));
vi.mock('@main/services/ai/llm', () => ({ callLlm: callLlmMock }));

import {
  buildPlannerSystemPrompt,
  isPlanningEnabled,
  parsePlanJson,
  planWithModel,
  renderPlan,
  shouldPlan,
} from '@main/services/ai/planner';

// 注意必须用块体：钩子直接返回 mock 的话，runner 会把它当成清理函数再调一次（零参调用）
beforeEach(() => {
  callLlmMock.mockReset();
});

describe('★ 规划者：结构、放行、克制', () => {
  it('解析合法 JSON（容忍代码块包裹）', () => {
    const plan = parsePlanJson(
      '{"goal":"加签到","steps":[{"intent":"查片段","tools":["list_templates"]}],"risks":["别重复触发器"]}',
    );
    expect(plan?.goal).toBe('加签到');
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.risks).toEqual(['别重复触发器']);
  });

  it('格式不对 ⇒ null（不是抛错，也不是空计划）', () => {
    expect(parsePlanJson('我觉得应该先看看流程')).toBeNull();
    expect(parsePlanJson('{"goal":"x","steps":[]}')).toBeNull();
  });

  it('★ 调用失败 / 乱回 ⇒ 一律 null（fail-open，主循环照跑）', async () => {
    callLlmMock.mockRejectedValueOnce(new Error('network'));
    expect(
      await planWithModel({
        requirement: '给我加一条签到指令',
        config: { provider: 'glm', apiKey: 'k', model: 'm' } as never,
        signal: new AbortController().signal,
      }),
    ).toBeNull();

    callLlmMock.mockImplementationOnce(async (_c: unknown, _m: unknown, _t: unknown, cb: { onComplete: (t: string) => void }) =>
      cb.onComplete('不是 JSON'),
    );
    expect(
      await planWithModel({
        requirement: '给我加一条签到指令',
        config: { provider: 'glm', apiKey: 'k', model: 'm' } as never,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  });

  it('克制：短需求不规划，纯提问不规划，动作型长需求才规划', () => {
    expect(shouldPlan('加个签到')).toBe(false);
    expect(shouldPlan('这个 message_send 节点是干嘛的？')).toBe(false);
    expect(shouldPlan('帮我把签到改成分三档奖励，并且加一个冷却检查')).toBe(true);
  });

  it('开关：默认开，QQBAT_MULTI_AGENT=0 关', () => {
    expect(isPlanningEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isPlanningEnabled({ QQBAT_MULTI_AGENT: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('渲染成执行者能读的上下文（目标 + 步骤 + 风险）', () => {
    const text = renderPlan({
      goal: '加签到',
      steps: [{ intent: '查片段', tools: ['list_templates'] }],
      risks: ['别重复触发器'],
      by: 'llm',
    });
    expect(text).toContain('规划者产出的计划');
    expect(text).toContain('加签到');
    expect(text).toContain('list_templates');
    expect(text).toContain('别重复触发器');
    expect(buildPlannerSystemPrompt()).toContain('JSON');
  });
});
