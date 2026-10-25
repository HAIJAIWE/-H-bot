// tests/main/services/agent-core/contextOverflow.test.ts
//
// # 只认"上下文超了"这一种 400
//
// 认错的代价：把 429/500 也当溢出，就会拿压缩掩盖真正的限流与服务端故障。
import { describe, it, expect } from 'vitest'
import { isContextOverflowError } from '@main/services/agent-core/contextOverflow'

/** 模拟 ProviderHttpError：自带 status，正文是厂商原话 */
const httpError = (status: number, message: string): Error =>
  Object.assign(new Error(message), { status })

describe('★ 上下文溢出的识别', () => {
  it('400 + 英文原文：认出', () => {
    expect(isContextOverflowError(httpError(400, 'maximum context length is 8192 tokens'))).toBe(
      true,
    )
    expect(
      isContextOverflowError(httpError(400, "This model's maximum context length is 128000")),
    ).toBe(true)
  })

  it('400 + 中文原文：认出', () => {
    expect(isContextOverflowError(httpError(400, '上下文长度超出限制'))).toBe(true)
    expect(isContextOverflowError(httpError(400, '输入过长，请减少上下文'))).toBe(true)
  })

  it('★ 429/500 正文里恰好有 context 也不认（限流/故障另有恢复路径）', () => {
    expect(
      isContextOverflowError(httpError(429, 'rate limited: too many context tokens per minute')),
    ).toBe(false)
    expect(
      isContextOverflowError(httpError(500, 'internal error while building context window')),
    ).toBe(false)
  })

  it('没有 status 的普通 Error 只能看正文（个别适配层会丢状态码）', () => {
    expect(isContextOverflowError(new Error('prompt is too long'))).toBe(true)
    expect(isContextOverflowError(new Error('connection reset by peer'))).toBe(false)
    expect(isContextOverflowError(new Error('tool failed'))).toBe(false)
  })

  it('非 Error 输入不炸：null / undefined / 字符串 / 对象', () => {
    expect(isContextOverflowError(null)).toBe(false)
    expect(isContextOverflowError(undefined)).toBe(false)
    expect(isContextOverflowError('context length exceeded')).toBe(true)
    expect(isContextOverflowError({ message: 'too many tokens' })).toBe(false)
  })
})
