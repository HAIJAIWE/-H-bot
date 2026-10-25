// tests/main/services/agent-core/modelAdapter.test.ts
import { describe, it, expect } from 'vitest'
import { createModelFn } from '@main/services/agent-core/modelAdapter'

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never

describe('★ 模型适配器（注入 call，不 mock 模块）', () => {
  it('★ onToolCalls 翻成 calls（args 保持对象）', async () => {
    const fake = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'x' } }])
      cb.onComplete('')
    }) as never
    const reply = await createModelFn(config, { call: fake })([{ role: 'user', content: 'hi' }])
    expect(reply.calls?.[0]).toEqual({
      id: 'c1',
      name: 'write_file',
      args: { path: 'a.txt', content: 'x' },
    })
  })

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
      ])
      cb.onComplete('')
    }) as never
    const reply = await createModelFn(config, { call: fake })([{ role: 'user', content: 'hi' }])
    expect(reply.calls?.[0]).toEqual({ id: 'c1', name: 'read_file', args: { path: 'a.txt' } })
  })

  it('★ 工具定义带参数 schema（否则模型只能猜 path / command）', async () => {
    let seen: any[] = []
    const fake = (async (_c: unknown, _m: unknown, t: any, cb: any) => {
      seen = t
      cb.onComplete('')
    }) as never
    await createModelFn(config, { call: fake })([{ role: 'user', content: 'hi' }])
    const read = seen.find(d => d.name === 'read_file')
    expect(read.parameters.properties.path.type).toBe('string')
    expect(read.parameters.required).toEqual(['path'])
    const cmd = seen.find(d => d.name === 'run_command')
    expect(cmd.parameters.required).toEqual(['command'])
  })

  it('★ 文本增量透传（流式界面靠它边出边显示）', async () => {
    const chunks: string[] = []
    const fake = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onChunk({ type: 'text', content: '你' })
      cb.onChunk({ type: 'text', content: '好' })
      cb.onComplete('你好')
    }) as never
    const reply = await createModelFn(config, {
      call: fake,
      onChunk: t => chunks.push(t),
    })([{ role: 'user', content: 'hi' }])
    expect(chunks).toEqual(['你', '好'])
    expect(reply.text).toBe('你好')
  })

  it('★ 图随 user 回合交给 provider（循环以前把 images 丢了）', async () => {
    let seen: any[] = []
    const fake = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      seen = m
      cb.onComplete('看到了')
    }) as never
    const png = 'data:image/png;base64,AAAA'
    await createModelFn(config, { call: fake })([
      { role: 'user', content: '这是怎么回事', images: [png] },
      { role: 'assistant', content: '看起来是连线断了' },
    ])
    expect(seen[0].images).toEqual([png])
    // 没图的回合不能被写成 images: []（provider 会以为每条消息都带图）
    expect('images' in seen[1]).toBe(false)
  })

  it('★ 调用表用调用方给的工具，不再写死 CORE_TOOLS（真机：提示广告 36、实际只给 6）', async () => {
    let seen: any[] = []
    const fake = (async (_c: unknown, _m: unknown, t: any, cb: any) => {
      seen = t
      cb.onComplete('')
    }) as never
    const only = {
      name: 'verify_greet',
      description: '插件工具',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => 'hi',
    }
    await createModelFn(config, { call: fake, tools: [only] as never })([
      { role: 'user', content: 'hi' },
    ])
    expect(seen.map(d => d.name)).toEqual(['verify_greet'])
    // 以前这里固定是 CORE_TOOLS 那 6 个 —— 提示广告的工具与调用表必须同源
    expect(seen.map(d => d.name)).not.toContain('read_file')
  })

  it('★ assistant 的 toolCalls 与 tool 的 toolResult 原样交给 provider（靠 id 配对）', async () => {
    // 2026-10-25 真机：循环不记自己的调用，模型认不出"[工具 X] 内容"是它的结果，
    // 同一调用连发 12 轮不收尾。配对靠 provider 的 tool_call_id，两边都得留着。
    let seen: any[] = []
    const fake = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      seen = m
      cb.onComplete('ok')
    }) as never
    await createModelFn(config, { call: fake })([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }],
      },
      { role: 'tool', name: 'read_file', content: 'body', toolResult: 'body' },
    ])
    expect(seen[1].toolCalls).toEqual([{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }])
    expect(seen[2].toolResult).toBe('body')
  })

  it('工具结果按 user 消息回灌（带工具名前缀）', async () => {
    let seen: any[] = []
    const fake = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      seen = m
      cb.onComplete('done')
    }) as never
    const reply = await createModelFn(config, { call: fake })([
      { role: 'user', content: 'go' },
      { role: 'tool', name: 'read_file', content: 'file body' },
    ])
    expect(reply.text).toBe('done')
    expect(JSON.stringify(seen[1])).toContain('[工具 read_file]')
  })
})
