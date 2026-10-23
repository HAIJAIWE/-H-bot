// tests/main/services/ai/scout.test.ts
//
// # 侦察者（多智能体第二阶段）
//
// 只读、有界、fail-open。它的价值是"把读出来的事实交给规划者"，
// 而不是再让一个模型说一遍废话。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runOneRoundMock } = vi.hoisted(() => ({ runOneRoundMock: vi.fn() }));
vi.mock('@main/services/ai/chatRun', () => ({ runOneRound: runOneRoundMock }));

import {
  buildScoutSystemPrompt,
  parseScoutJson,
  renderFindings,
  SCOUT_TOOL_NAMES,
  scoutTools,
  scoutWithModel,
} from '@main/services/ai/scout';

// 注意必须用块体：钩子直接返回 mock 的话，runner 会把它当成清理函数再调一次（零参调用）
beforeEach(() => {
  runOneRoundMock.mockReset();
});

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never;

describe('★ 侦察者：只读、有界、放行', () => {
  it('解析合法 JSON（最多 6 条）', () => {
    const seven = JSON.stringify({ findings: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    const out = parseScoutJson(seven);
    expect(out?.findings).toHaveLength(6);
    expect(parseScoutJson('随便说说')).toBeNull();
  });

  it('工具白名单里没有任何写工具', () => {
    const names = new Set(scoutTools().map((t) => t.name));
    for (const forbidden of ['write_code', 'write_file', 'add_node', 'delete_node', 'run_test']) {
      expect(names.has(forbidden), `侦察者不该有 ${forbidden}`).toBe(false);
    }
    expect(names.has('read_flow')).toBe(true);
    expect(SCOUT_TOOL_NAMES).toContain('read_logs');
  });

  it('★ 模型乱回 ⇒ null（fail-open：退回静态简报）', async () => {
    runOneRoundMock.mockImplementationOnce(async (state: { fullResponse: string; hadToolCalls: boolean }) => {
      state.fullResponse = '不是 JSON';
      state.hadToolCalls = false;
    });
    expect(
      await scoutWithModel({
        projectPath: '/p',
        requirement: '加签到',
        config,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  });

  it('★ 调用抛错 ⇒ null（不把"侦察失败"变成"用户做不了"）', async () => {
    runOneRoundMock.mockRejectedValueOnce(new Error('network'));
    expect(
      await scoutWithModel({
        projectPath: '/p',
        requirement: '加签到',
        config,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  });

  it('正常产出 + 渲染成规划者输入', async () => {
    runOneRoundMock.mockImplementationOnce(async (state: { fullResponse: string; hadToolCalls: boolean }) => {
      state.fullResponse = JSON.stringify({ findings: ['已有 /签到'] });
      state.hadToolCalls = false;
    });
    const out = await scoutWithModel({
      projectPath: '/p',
      requirement: '加签到',
      config,
      signal: new AbortController().signal,
    });
    expect(out?.findings).toEqual(['已有 /签到']);
    const text = renderFindings(out!);
    expect(text).toContain('已有 /签到');
    expect(buildScoutSystemPrompt()).toContain('JSON');
  });
});
