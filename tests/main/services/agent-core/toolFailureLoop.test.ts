// tests/main/services/agent-core/toolFailureLoop.test.ts
//
// 失败分类由循环算（显式 code 优先，否则按文本），并随 onToolResult / toolResults 出去；
// 模型侧仍只看文本 —— 结构化字段是给界面与诊断用的。
import { describe, it, expect } from 'vitest';
import { runAgentLoop, type Tool } from '@main/services/agent-core/core';

const noop: Tool = {
  name: 'noop',
  description: '测试工具',
  category: 'query',
  run: async () => 'ok',
};

const boom: Tool = {
  name: 'boom',
  description: '总是失败',
  category: 'mutation',
  run: async () => ({ text: '[工具失败] 自定义原因', ok: false, error: { code: 'invalid_args' } }),
};

describe('★ 工具失败分类（循环层）', () => {
  it('未知工具 → not_found，onToolResult 与 toolResults 都带 failure', async () => {
    const failures: Array<{ code: string } | undefined> = [];
    const result = await runAgentLoop({
      workspace: 'D:/ws',
      initialTurns: [{ role: 'user', content: 'x' }],
      tools: [noop],
      model: async () => ({ text: '', calls: [{ id: 'c1', name: 'nope', args: {} }] }),
      onToolResult: (_call, _out, _ok, failure) => failures.push(failure),
    });
    expect(failures[0]?.code).toBe('not_found');
    expect(result.toolResults[0]?.failure?.code).toBe('not_found');
    expect(result.toolResults[0]?.failure?.actions).toEqual(['change_args']);
  });

  it('工具显式给的 code 优先于文本启发式', async () => {
    let failureCode: string | undefined;
    await runAgentLoop({
      workspace: 'D:/ws',
      initialTurns: [{ role: 'user', content: 'x' }],
      tools: [boom],
      model: async () => ({ text: '', calls: [{ id: 'c1', name: 'boom', args: {} }] }),
      onToolResult: (_call, _out, _ok, failure) => {
        failureCode = failure?.code;
      },
    });
    expect(failureCode).toBe('invalid_args');
  });
});
