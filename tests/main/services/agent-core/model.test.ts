// tests/main/services/agent-core/model.test.ts
//
// 模型适配器：只做翻译，不碰网络（callLlm 被 mock）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callLlmMock } = vi.hoisted(() => ({ callLlmMock: vi.fn() }));
vi.mock('@main/services/ai/llm', () => ({ callLlm: callLlmMock }));

import { createModelFn } from '@main/services/agent-core/model';

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never;
// 注意必须用块体：钩子直接返回 mock 的话，runner 会把它当成清理函数再调一次（零参调用）
beforeEach(() => {
  callLlmMock.mockReset();
});

describe('★ 模型适配器', () => {
  it('★ 把 onToolCalls 翻成 calls（args 保持对象）', async () => {
    callLlmMock.mockImplementation(async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'x' } }]);
      cb.onComplete('');
    });
    const reply = await createModelFn(config)([{ role: 'user', content: 'hi' }]);
    expect(reply.calls?.[0]).toEqual({ id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'x' } });
  });

  it('工具结果按 user 消息回灌（带工具名前缀）', async () => {
    let seen: any[] = [];
    callLlmMock.mockImplementation(async (_c: unknown, m: any, _t: unknown, cb: any) => {
      seen = m;
      cb.onComplete('done');
    });
    const reply = await createModelFn(config)([
      { role: 'user', content: 'go' },
      { role: 'tool', name: 'read_file', content: 'file body' },
    ]);
    expect(reply.text).toBe('done');
    expect(JSON.stringify(seen[1])).toContain('[工具 read_file]');
  });
});
