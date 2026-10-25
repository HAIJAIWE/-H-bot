// tests/shared/vendor/llm-assembler.test.ts
//
// # 搬来的流组装器：上游那几条判断不许被"顺手改简单"
//
// 这些注释就是判据 —— 每一条都对应上游 `packages/llm/llm/src/assembler.ts` 的一个分支：
//   · 首见 index 建块；delta-only 协议（没有 block-start/end）也要能拼；
//   · `block-end` **首次关闭为准**，之后同一 index 的 delta 一律忽略（坏流不能撑爆内存，也不能改已完成的块）；
//   · `finish_reason === 'length'` 时**工具调用一个都不留** —— 半截 JSON 交给执行器等于乱执行；
//   · 中断收尾只留**非空白的正文/思考**（工具调用不保留，保留就得编造结果）；
//   · 缺 id 时退回 `call-<index>`。
import { describe, it, expect } from 'vitest'
import { BlockAssembler } from '@shared/vendor/dsh/llm-assembler/assembler'

describe('BlockAssembler：块生命周期', () => {
  it('★ block-end 首次关闭为准：关闭后的 delta 被忽略，块内容不回退', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'text-delta', index: 0, text: 'a' })
    assembler.push({ type: 'block-end', index: 0, block: { type: 'text', text: 'A' } })
    assembler.push({ type: 'text-delta', index: 0, text: 'zzz' })

    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'A' }])
  })

  it('delta-only 协议：没有 block-start/end 也能按 index 拼出正文', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'text-delta', index: 0, text: '你' })
    assembler.push({ type: 'text-delta', index: 0, text: '好' })

    expect(assembler.blocks()).toEqual([{ type: 'text', text: '你好' }])
  })

  it('工具调用参数逐片累加，缺 id 时退回 call-<index>', () => {
    const assembler = new BlockAssembler()
    assembler.push({
      type: 'tool-call-delta',
      index: 2,
      id: '',
      name: 'read_file',
      argumentsDelta: '{"a"',
    })
    assembler.push({ type: 'tool-call-delta', index: 2, id: '', argumentsDelta: ':1}' })

    expect(assembler.blocks()).toEqual([
      { type: 'tool-call', id: 'call-2', name: 'read_file', arguments: '{"a":1}' },
    ])
  })

  it('结束后再来 name 也不覆盖已记下的名字（只认第一次非空）', () => {
    const assembler = new BlockAssembler()
    assembler.push({
      type: 'tool-call-delta',
      index: 2,
      id: 'c1',
      name: 'read_file',
      argumentsDelta: '',
    })
    assembler.push({ type: 'tool-call-delta', index: 2, id: 'c1', argumentsDelta: '{}' })

    expect(assembler.blocks()[0]).toMatchObject({ name: 'read_file', id: 'c1' })
  })
})

describe('BlockAssembler：截断与中断', () => {
  it('★ max-tokens 时工具调用整块丢弃，正文照留', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'text-delta', index: 0, text: '说到一半' })
    assembler.push({
      type: 'tool-call-delta',
      index: 2,
      id: 'c1',
      name: 'run_command',
      argumentsDelta: '{"comm',
    })
    assembler.push({ type: 'finish', reason: { kind: 'max-tokens' } })

    expect(assembler.blocks()).toEqual([{ type: 'text', text: '说到一半' }])
    expect(assembler.finish).toEqual({ kind: 'max-tokens' })
  })

  it('中断收尾只留非空白的正文/思考，工具调用与空白块都不留', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'text-delta', index: 0, text: '已经说出来的' })
    assembler.push({ type: 'reasoning-delta', index: 1, text: '   ' })
    assembler.push({
      type: 'tool-call-delta',
      index: 2,
      id: 'c1',
      name: 'read_file',
      argumentsDelta: '{}',
    })

    expect(assembler.interruptedBlocks()).toEqual([{ type: 'text', text: '已经说出来的' }])
  })

  it('没给 finish 时按 stop 算；usage 原样保存', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } })

    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.usage).toEqual({ inputTokens: 3, outputTokens: 5 })
  })
})
