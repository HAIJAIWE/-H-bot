// tests/main/services/agent-core/stepEvents.test.ts
//
// 步边界：每轮"问模型"之前发一次 onStep，step 从 1 开始，maxSteps = 本轮上限。
import { describe, it, expect } from 'vitest';
import { runAgentLoop, type Tool } from '@main/services/agent-core/core';

const noop: Tool = {
  name: 'noop',
  description: '什么也不做（测试用）',
  category: 'query',
  run: async () => 'ok',
};

describe('★ 循环步边界（onStep）', () => {
  it('★ 两次问模型 → step 1、2；maxSteps 用本轮上限', async () => {
    const steps: Array<{ step: number; maxSteps: number }> = [];
    let calls = 0;
    const result = await runAgentLoop({
      workspace: 'D:/ws',
      initialTurns: [{ role: 'user', content: 'x' }],
      tools: [noop],
      maxRounds: 5,
      onStep: (info) => steps.push(info),
      model: async () =>
        calls++ === 0
          ? { text: '', calls: [{ id: 'c1', name: 'noop', args: {} }] }
          : { text: 'done', calls: [] },
    });
    expect(steps).toEqual([
      { step: 1, maxSteps: 5 },
      { step: 2, maxSteps: 5 },
    ]);
    expect(result.finalText).toBe('done');
  });

  it('一轮就结束 → 只有 step 1', async () => {
    const steps: number[] = [];
    await runAgentLoop({
      workspace: 'D:/ws',
      initialTurns: [{ role: 'user', content: 'x' }],
      tools: [noop],
      onStep: (info) => steps.push(info.step),
      model: async () => ({ text: '直接回答', calls: [] }),
    });
    expect(steps).toEqual([1]);
  });
});
