// tests/main/services/officialIntents.test.ts
//
// intents 订阅位：基础位恒定、可选位按优先级、4014 时从末尾丢。
// 官方对没权限的位直接 4014 断连，所以「先全订、被拒逐位退回」是唯一可行策略，
// 丢位顺序写错会让互动回调（1<<26）先被丢掉 —— 单测钉住这一点。
import { describe, it, expect } from 'vitest'
import {
  BASE_INTENTS,
  OPTIONAL_INTENTS,
  INTENT_LABELS,
  intentsOf,
  intentLabel,
  officialIntents,
  dropLowestOptionalIntent,
} from '@main/services/official/intents'

const bit = (n: number) => 1 << n

describe('基础 intents', () => {
  it('GUILDS | GROUP_AND_C2C_EVENT | PUBLIC_GUILD_MESSAGES', () => {
    expect(BASE_INTENTS).toBe(bit(0) | bit(25) | bit(30))
    expect(BASE_INTENTS).toBe(1107296257)
  })

  it('空可选集合 = 基础位', () => {
    expect(intentsOf([])).toBe(BASE_INTENTS)
  })

  it('每个可选位都能叠加进去', () => {
    for (const b of OPTIONAL_INTENTS) {
      expect(intentsOf([b]) & b).toBe(b)
    }
  })
})

describe('officialIntents：兼容旧布尔签名', () => {
  it('不传 = 只订基础位', () => {
    expect(officialIntents()).toBe(BASE_INTENTS)
    expect(officialIntents(null)).toBe(BASE_INTENTS)
    expect(officialIntents([])).toBe(BASE_INTENTS)
  })

  it('true 等价旧行为：额外只订 1<<24', () => {
    expect(officialIntents(true)).toBe(BASE_INTENTS | bit(24))
  })

  it('false = 基础位', () => {
    expect(officialIntents(false)).toBe(BASE_INTENTS)
  })

  it('数组 = 基础位 + 数组里的位（互动 1<<26 默认在内）', () => {
    const v = officialIntents(OPTIONAL_INTENTS)
    expect(v & bit(26)).toBe(bit(26))
    expect(v & bit(24)).toBe(bit(24))
    expect(v & bit(27)).toBe(bit(27))
    for (const base of [bit(0), bit(25), bit(30)]) expect(v & base).toBe(base)
  })
})

describe('4014 逐位退回：从优先级最低的丢起', () => {
  it('第一次丢审核 (1<<27)', () => {
    const r = dropLowestOptionalIntent(OPTIONAL_INTENTS)
    expect(r.dropped).toBe(bit(27))
    expect(r.remaining).toEqual([bit(26), bit(24)])
  })

  it('第二次丢群成员 (1<<24)，互动位最后才丢', () => {
    const r1 = dropLowestOptionalIntent(OPTIONAL_INTENTS)
    const r2 = dropLowestOptionalIntent(r1.remaining)
    expect(r2.dropped).toBe(bit(24))
    expect(r2.remaining).toEqual([bit(26)])
  })

  it('第三次才丢互动 (1<<26)，之后没有可选位可丢', () => {
    let bits: readonly number[] = OPTIONAL_INTENTS
    const dropped: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = dropLowestOptionalIntent(bits)
      dropped.push(r.dropped)
      bits = r.remaining
    }
    expect(dropped).toEqual([bit(27), bit(24), bit(26), 0])
    expect(bits).toEqual([])
  })

  it('空数组安全返回 0', () => {
    expect(dropLowestOptionalIntent([])).toEqual({ dropped: 0, remaining: [] })
  })
})

describe('intentLabel', () => {
  it('已知位给中文名', () => {
    expect(intentLabel(bit(26))).toBe('按钮与菜单互动回调')
    expect(intentLabel(bit(24))).toBe('群成员变动 / 入群申请')
    expect(intentLabel(bit(27))).toBe('主动消息审核结果')
  })

  it('未知位退化成 1<<n，不抛错', () => {
    expect(intentLabel(bit(22))).toBe('1<<22')
    expect(INTENT_LABELS[22]).toBeUndefined()
  })
})
