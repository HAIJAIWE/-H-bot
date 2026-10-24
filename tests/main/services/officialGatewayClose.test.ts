// tests/main/services/officialGatewayClose.test.ts
//
// 网关关闭码 → 下一步动作（对照官方 bot-node-sdk / botpy 的语义）。
//
// 这张表是「重连策略」的唯一判定点：判错一个码的代价是 —
//   · 4004 当普通断线 → 拿废 token 无限重连（botpy 会先清 token）；
//   · 4001/4002/4007 还去 resume → 协议已经不可信，resume 必被再踢；
//   · 4914/4915 还重试 → 真正该做的「去开放平台处理」被埋进 5 次重连日志里。
import { describe, it, expect } from 'vitest'
import {
  CLOSE_REASONS,
  closeActionOf,
  closeReasonOf,
  fatalAdviceOf,
} from '@main/services/official/gatewayClose'

describe('closeActionOf：鉴权 / intents / 致命', () => {
  it('4004 → refresh（清 token 后重新取，不能直接 resume）', () => {
    expect(closeActionOf(4004, false)).toBe('refresh')
    expect(closeActionOf(4004, true)).toBe('refresh')
  })

  it('4013 / 4014 → intents（丢一个可选位再 identify）', () => {
    for (const code of [4013, 4014]) {
      expect(closeActionOf(code, false)).toBe('intents')
      expect(closeActionOf(code, true)).toBe('intents')
    }
  })

  it('4914 / 4915 → fatal（下架 / 封禁，重试没有意义）', () => {
    for (const code of [4914, 4915]) {
      expect(closeActionOf(code, false)).toBe('fatal')
      expect(closeActionOf(code, true)).toBe('fatal')
    }
  })
})

describe('closeActionOf：协议错误清 session 重新 identify', () => {
  // 与官方 SDK 对齐：这些码代表 payload/opcode/shard 层面已不可信，
  // 哪怕本地还有 session_id 也不能 resume。
  const freshCodes = [4001, 4002, 4007, 4010, 4011, 4012, 9001, 9005]

  for (const code of freshCodes) {
    it(`${code} → identify（有 session 也不 resume）`, () => {
      expect(closeActionOf(code, false)).toBe('identify')
      expect(closeActionOf(code, true)).toBe('identify')
    })
  }
})

describe('closeActionOf：可 resume 与传输层断线', () => {
  it('4008 / 4009 / 4900 有 session → resume', () => {
    for (const code of [4008, 4009, 4900]) {
      expect(closeActionOf(code, true)).toBe('resume')
      // 没 session 可恢复时只能重新 identify
      expect(closeActionOf(code, false)).toBe('identify')
    }
  })

  it('传输层关闭（1000/1001/1006/1011）：有 session 就尽量恢复', () => {
    for (const code of [1000, 1001, 1006, 1011]) {
      expect(closeActionOf(code, true)).toBe('resume')
      expect(closeActionOf(code, false)).toBe('identify')
    }
  })

  it('未知关闭码：按「能不能恢复」兜底', () => {
    expect(closeActionOf(4999, true)).toBe('resume')
    expect(closeActionOf(4999, false)).toBe('identify')
  })

  it('没有关闭码 / 非数字：按 hasSession 兜底', () => {
    expect(closeActionOf(null, true)).toBe('resume')
    expect(closeActionOf(null, false)).toBe('identify')
    expect(closeActionOf(undefined, true)).toBe('resume')
    expect(closeActionOf(undefined, false)).toBe('identify')
    expect(closeActionOf(Number.NaN, false)).toBe('identify')
  })
})

describe('closeReasonOf：可直接贴日志的中文说明', () => {
  it('官方关闭码都有说明（表覆盖 14 个码）', () => {
    const codes = [
      4001, 4002, 4004, 4007, 4008, 4009, 4010,
      4011, 4012, 4013, 4014, 4900, 4914, 4915,
    ]
    expect(Object.keys(CLOSE_REASONS)).toHaveLength(codes.length)
    for (const code of codes) {
      const text = closeReasonOf(code)
      expect(text.length).toBeGreaterThan(4)
      expect(text).not.toContain('未知关闭码')
    }
  })

  it('未知码带上原始数字，便于对照网关日志', () => {
    expect(closeReasonOf(4999)).toBe('未知关闭码 4999')
  })

  it('没有关闭码时说明是网络问题，而不是「未知关闭码 undefined」', () => {
    expect(closeReasonOf(null)).toContain('网络')
    expect(closeReasonOf(undefined)).toContain('网络')
  })
})

describe('fatalAdviceOf：只说下一步该做什么', () => {
  it('4914 在非沙箱下建议先切沙箱验证', () => {
    const text = fatalAdviceOf(4914, false)
    expect(text).toContain('沙箱')
    expect(text).toContain('重新上架')
  })

  it('4914 在沙箱下不再建议切沙箱（已经是沙箱）', () => {
    const text = fatalAdviceOf(4914, true)
    expect(text).not.toContain('QQ_SANDBOX=true')
    expect(text).toContain('开放平台')
  })

  it('4915 指向申请解封', () => {
    expect(fatalAdviceOf(4915, false)).toContain('解封')
  })

  it('其它致命码给通用建议', () => {
    expect(fatalAdviceOf(4004, false)).toContain('检查机器人配置')
  })
})
