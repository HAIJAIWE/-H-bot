// tests/main/services/agent-core/modelAdapter.test.ts
import { describe, it, expect } from 'vitest';
import { createModelFn } from '@main/services/agent-core/modelAdapter';

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never;

describe('★ 模型适配器（注入 call，不 mock 模块）', () => {
  it('★ onToolCalls 翻成 calls（args 保持对象）', async () => {
    const fake = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'x' } }]);
      cb.onComplete('');
    }) as never;
    const reply = await createModelFn(config, { call: fake })([{ role: 'user', content: 'hi' }]);
    expect(reply.calls?.[0]).toEqual({ id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'x' } });
  });

  it('★ 真机形状：provider 回调的是原始 OpenAI tool_calls，也要归一成 name + 对象 args', async () => {
    // 2026-10-18 真机：这里不归一的话每个调用都是 name:undefined → 循环跑满 12 轮"未知工具"
    const fake = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([
        {
          index: 0,
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
        },
      ]);
      cb.onComplete('');
    }) as never;
    const reply = await createModelFn(config, { call: fake })([{ role: 'user', content: 'hi' }]);
    expect(reply.calls?.[0]).toEqual({ id: 'c1', name: 'read_file', args: { path: 'a.txt' } });
  });

  it('★ 工具定义带参数 schema（否则模型只能猜 path / command）', async () => {
    let seen: any[] = [];
    const fake = (async (_c: unknown, _m: unknown, t: any, cb: any) => {
      seen = t;
      cb.onComplete('');
    }) as never;
    await createModelFn(config, { call: fake })([{ role: 'user', content: 'hi' }]);
    const read = seen.find((d) => d.name === 'read_file');
    expect(read.parameters.properties.path.type).toBe('string');
    expect(read.parameters.required).toEqual(['path']);
    const cmd = seen.find((d) => d.name === 'run_command');
    expect(cmd.parameters.required).toEqual(['command']);
  });

  it('★ 文本增量透传（流式界面靠它边出边显示）', async () => {
    const chunks: string[] = [];
    const fake = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onChunk({ type: 'text', content: '你' });
      cb.onChunk({ type: 'text', content: '好' });
      cb.onComplete('你好');
    }) as never;
    const reply = await createModelFn(config, {
      call: fake,
      onChunk: (t) => chunks.push(t),
    })([{ role: 'user', content: 'hi' }]);
    expect(chunks).toEqual(['你', '好']);
    expect(reply.text).toBe('你好');
  });

  it('工具结果按 user 消息回灌（带工具名前缀）', async () => {
    let seen: any[] = [];
    const fake = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      seen = m;
      cb.onComplete('done');
    }) as never;
    const reply = await createModelFn(config, { call: fake })([
      { role: 'user', content: 'go' },
      { role: 'tool', name: 'read_file', content: 'file body' },
    ]);
    expect(reply.text).toBe('done');
    expect(JSON.stringify(seen[1])).toContain('[工具 read_file]');
  });
});
