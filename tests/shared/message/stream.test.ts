// tests/shared/message/stream.test.ts
//
// 闸门：流式消息的分片计划（纯函数）。
//
// 这一层要守住四件事，都是官方协议或真机观感要求：
//   1. **按码点切**：`'😀'.length === 2`，用 slice 会把代理对劈成半个 emoji（客户端显示乱码方块）；
//   2. **末片 `input_state=10`**：少了它对方的界面永远停在「生成中」；
//   3. **异常参数回退默认值**：`chunkSize=0` 不能让整条消息发不出去；
//   4. 空文本返回 `[]`（由调用方报错，而不是发一条空消息）。
import { describe, it, expect } from 'vitest'
import {
  buildStreamChunkPlan,
  STREAM_DEFAULT_CHUNK_SIZE,
  STREAM_MAX_CHUNKS,
} from '@shared/message/stream'

describe('流式消息分片计划', () => {
  it('空文本 → 空计划（调用方据此报错，不发空消息）', () => {
    expect(buildStreamChunkPlan('')).toEqual([])
    expect(buildStreamChunkPlan('   ').length).toBe(1)
  })

  it('短文本 → 单分片，且直接是结束态', () => {
    expect(buildStreamChunkPlan('你好')).toEqual([{ index: 0, inputState: 10, contentRaw: '你好' }])
  })

  it('多分片：index 递增，只有末片是 10', () => {
    const plan = buildStreamChunkPlan('abcdefghij', { chunkSize: 4 })
    expect(plan.map((c) => c.contentRaw)).toEqual(['abcd', 'efgh', 'ij'])
    expect(plan.map((c) => c.index)).toEqual([0, 1, 2])
    expect(plan.map((c) => c.inputState)).toEqual([1, 1, 10])
  })

  it('按码点切：emoji 不会被劈成半个（拼回来必须与原文一模一样）', () => {
    const text = '😀'.repeat(5) + '🎉'.repeat(5)
    const plan = buildStreamChunkPlan(text, { chunkSize: 3 })
    for (const chunk of plan) {
      // 每个分片的码点数都不能超过窗口；出现代理对残片时 Array.from 的长度会异常
      expect(Array.from(chunk.contentRaw).length).toBeLessThanOrEqual(3)
    }
    expect(plan.map((c) => c.contentRaw).join('')).toBe(text)
  })

  it('窗口后半段有标点就优先断句（不在句子中间硬切）', () => {
    const text = 'a'.repeat(8) + '。' + 'b'.repeat(8)
    const plan = buildStreamChunkPlan(text, { chunkSize: 10 })
    expect(plan[0]?.contentRaw).toBe('aaaaaaaa。')
    expect(plan.map((c) => c.contentRaw).join('')).toBe(text)
  })

  it('后半段没有断点就按窗口硬切（长句也不会卡住）', () => {
    const plan = buildStreamChunkPlan('a'.repeat(25), { chunkSize: 10 })
    expect(plan.map((c) => c.contentRaw)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)])
  })

  it('chunkSize <= 0 / 非数字 → 回退默认值（不能因为一个 0 让消息发不出去）', () => {
    const text = 'x'.repeat(STREAM_DEFAULT_CHUNK_SIZE + 5)
    for (const bad of [0, -10, Number.NaN]) {
      const plan = buildStreamChunkPlan(text, { chunkSize: bad })
      expect(plan[0]?.contentRaw.length, `chunkSize=${String(bad)}`).toBe(STREAM_DEFAULT_CHUNK_SIZE)
      expect(plan.length).toBe(2)
    }
  })

  it('分片数超上限：余下的并进最后一片，不丢内容', () => {
    const text = 'a'.repeat(STREAM_MAX_CHUNKS + 3)
    const plan = buildStreamChunkPlan(text, { chunkSize: 1 })
    expect(plan.length).toBe(STREAM_MAX_CHUNKS)
    expect(plan[plan.length - 1]?.inputState).toBe(10)
    expect(plan.map((c) => c.contentRaw).join('')).toBe(text)
  })
})
