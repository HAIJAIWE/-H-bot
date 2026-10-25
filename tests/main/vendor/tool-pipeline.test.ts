// tests/main/vendor/tool-pipeline.test.ts
//
// 上游 tool-pipeline 的纯函数：fail-closed 并行判定、取消文案、错误归一、waterfall 组合。
// 这里钉的是**机械事实** —— 文案逐字、只认字面 true、短路真的短。
import { describe, it, expect } from 'vitest'
import type { Waterfall } from '@main/vendor/dsh/tool-pipeline/pipeline'
import {
  TOOL_ABORTED_BEFORE_DISPATCH_TEXT,
  TOOL_ABORTED_TEXT,
  cancellationText,
  composeWaterfall,
  failClosedMode,
  failureMessageFromText,
  fuseToolSignals,
  isAborted,
  toolErrorMessage,
} from '@main/vendor/dsh/tool-pipeline/pipeline'

describe('failClosedMode：只有字面 true 才并行', () => {
  it('没声明 / undefined → exclusive（未知不并行）', () => {
    expect(failClosedMode(undefined, { path: 'a' })).toBe('exclusive')
  })

  it('返回 true → parallel；返回 1、"true"、抛错 → exclusive', () => {
    expect(failClosedMode(() => true, { path: 'a' })).toBe('parallel')
    expect(failClosedMode(() => 1 as unknown as boolean, {})).toBe('exclusive')
    expect(failClosedMode(() => 'true' as unknown as boolean, {})).toBe('exclusive')
    expect(
      failClosedMode(() => {
        throw new Error('boom')
      }, {}),
    ).toBe('exclusive')
  })
})

describe('toolErrorMessage：任意抛出物归一成一句人话', () => {
  it('Error 取 message；带字符串 message 的对象取它', () => {
    expect(toolErrorMessage(new Error('磁盘只读'))).toBe('磁盘只读')
    expect(toolErrorMessage({ message: '上游 502' })).toBe('上游 502')
    expect(toolErrorMessage({ message: 42 })).toBe('[object Object]')
  })

  it('数字 / null / 无原型对象：String()，String() 也抛就兜底', () => {
    expect(toolErrorMessage(42)).toBe('42')
    expect(toolErrorMessage(null)).toBe('null')
    expect(toolErrorMessage(Object.create(null))).toBe('<unprintable thrown value>')
  })
})

describe('failureMessageFromText：block 的空反馈补默认文案', () => {
  it('空串 → 上游默认句；非空原样', () => {
    expect(failureMessageFromText('')).toBe('tool result blocked by post-execute policy')
    expect(failureMessageFromText('别动生产库')).toBe('别动生产库')
  })
})

describe('composeWaterfall：从右往左折叠、value 一路传下去', () => {
  it('顺序：hooks[0] 最外层，最后落到 terminal', async () => {
    const seen: number[] = []
    const order: string[] = []
    const hooks: Waterfall<number, string>[] = [
      async (value, next) => {
        seen.push(value)
        order.push('a')
        return next()
      },
      async (value, next) => {
        seen.push(value)
        order.push('b')
        return next()
      },
    ]
    const run = composeWaterfall(hooks, async () => {
      order.push('terminal')
      return 'ok'
    })
    await expect(run(7)).resolves.toBe('ok')
    expect(order).toEqual(['a', 'b', 'terminal'])
    expect(seen).toEqual([7, 7])
  })

  it('短路：第二个不调 next → third 与 terminal 都不执行', async () => {
    const order: string[] = []
    const hooks: Waterfall<number, string>[] = [
      async (_value, next) => {
        order.push('a')
        return next()
      },
      async () => {
        order.push('b')
        return 'blocked'
      },
      async (_value, next) => {
        order.push('c')
        return next()
      },
    ]
    const run = composeWaterfall(hooks, async () => {
      order.push('terminal')
      return 'ok'
    })
    await expect(run(1)).resolves.toBe('blocked')
    expect(order).toEqual(['a', 'b'])
  })
})

describe('fuseToolSignals：caller 取消要传进本次 dispatch 的取消域', () => {
  it('caller abort → wrapper 跟着 abort，reason 保留', () => {
    const caller = new AbortController()
    const wrapper = new AbortController()
    const dispose = fuseToolSignals(caller.signal, wrapper)
    caller.abort('stop')
    expect(wrapper.signal.aborted).toBe(true)
    expect(wrapper.signal.reason).toBe('stop')
    dispose()
  })

  it('dispose 之后不再传播；wrapper 已 abort / caller 没给也不炸', () => {
    const caller = new AbortController()
    const wrapper = new AbortController()
    fuseToolSignals(caller.signal, wrapper)()
    caller.abort()
    expect(wrapper.signal.aborted).toBe(false)

    const already = new AbortController()
    already.abort()
    expect(fuseToolSignals(undefined, already)).toBeTypeOf('function')

    const noop = fuseToolSignals(undefined, new AbortController())
    expect(noop()).toBeUndefined()
  })
})

describe('取消文案与常量：模型看到的那句话逐字不变', () => {
  it('cancellationText 两态 + 常量原文', () => {
    expect(cancellationText(true)).toBe(TOOL_ABORTED_TEXT)
    expect(cancellationText(false)).toBe(TOOL_ABORTED_BEFORE_DISPATCH_TEXT)
    expect(TOOL_ABORTED_TEXT).toBe('Error: tool call aborted')
    expect(TOOL_ABORTED_BEFORE_DISPATCH_TEXT).toBe('Error: tool call aborted before dispatch')
    expect(isAborted(undefined)).toBe(false)
    expect(isAborted(new AbortController().signal)).toBe(false)
    const aborted = new AbortController()
    aborted.abort()
    expect(isAborted(aborted.signal)).toBe(true)
  })
})
