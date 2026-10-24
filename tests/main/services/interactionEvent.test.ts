// tests/main/services/interactionEvent.test.ts
//
// INTERACTION_CREATE → 运行时事件。
// 端到端断点就在这里：intent 没订（ws.ts）、负载没翻译（本文件）、
// 匹配器拿不到 interaction_id（triggerMatcher）—— 三处都测住才算接通。
import { describe, it, expect, vi } from 'vitest'
import {
  interactionEventOf,
  interactionTypeOf,
  resolvedButtonOf,
} from '@main/services/official/interactionEvent'

function meta(resolveUid: (openid: string) => string = (o) => 'uid:' + o) {
  return { time: 1700000000, selfId: 10000, resolveUid }
}

function groupButtonPayload(over: Record<string, unknown> = {}) {
  return {
    id: 'interaction-abc',
    type: 11,
    scene: 'group',
    group_openid: 'group-openid-1',
    group_member_openid: 'member-openid-1',
    timestamp: 1700000000,
    data: {
      type: 11,
      resolved: {
        button_id: 'btn-1',
        button_data: '/签到',
        user_id: 'member-openid-1',
        message_id: 'msg-1',
      },
    },
    ...over,
  }
}

describe('interactionTypeOf / resolvedButtonOf', () => {
  it('优先读 data.type，退到外层 type', () => {
    expect(interactionTypeOf({ type: 11, data: { type: 12 } })).toBe(12)
    expect(interactionTypeOf({ type: 11 })).toBe(11)
    expect(interactionTypeOf({})).toBe(0)
    expect(interactionTypeOf({ type: '12' })).toBe(12)
  })

  it('按钮在 data.resolved，旧负载退到 data 顶层', () => {
    expect(resolvedButtonOf(groupButtonPayload())).toEqual({
      buttonId: 'btn-1',
      buttonData: '/签到',
    })
    expect(
      resolvedButtonOf({ data: { button_id: 'b2', button_data: 'd2' } }),
    ).toEqual({ buttonId: 'b2', buttonData: 'd2' })
    expect(resolvedButtonOf({})).toEqual({ buttonId: '', buttonData: '' })
  })
})

describe('interactionEventOf：可回执的 11 / 12', () => {
  it('type 11 → notice:interaction，字段齐全', () => {
    const ev = interactionEventOf(groupButtonPayload(), meta())
    expect(ev).toMatchObject({
      post_type: 'notice',
      notice_type: 'interaction',
      sub_type: '11',
      time: 1700000000,
      self_id: 10000,
      interaction_id: 'interaction-abc',
      interaction_type: 11,
      button_id: 'btn-1',
      button_data: '/签到',
      group_id: 'group-openid-1',
      message_id: 'msg-1',
      _openid: 'member-openid-1',
      _scene: 'group',
    })
  })

  it('user_id 走 resolveUid（openid → 运行时 UID）', () => {
    const resolveUid = vi.fn((o: string) => (o === 'member-openid-1' ? '10001' : ''))
    const ev = interactionEventOf(groupButtonPayload(), meta(resolveUid))
    expect(resolveUid).toHaveBeenCalledWith('member-openid-1')
    expect(ev?.user_id).toBe('10001')
  })

  it('没 openid 时 user_id 给空串且不调 resolveUid', () => {
    const resolveUid = vi.fn(() => 'x')
    const ev = interactionEventOf(
      groupButtonPayload({ group_member_openid: undefined, user_openid: undefined, data: { type: 11, resolved: {} } }),
      meta(resolveUid),
    )
    expect(resolveUid).not.toHaveBeenCalled()
    expect(ev?.user_id).toBe('')
  })

  it('外层没有 type 但 data.type=12 也算可回执', () => {
    const payload = groupButtonPayload({ type: undefined, data: { type: 12, resolved: { button_id: 'menu-1' } } })
    const ev = interactionEventOf(payload, meta())
    expect(ev?.sub_type).toBe('12')
    expect(ev?.button_id).toBe('menu-1')
  })

  it('频道场景带 guild_id / channel_id', () => {
    const ev = interactionEventOf(
      groupButtonPayload({ scene: 'guild', guild_id: 'guild-1', channel_id: 'channel-1', group_openid: undefined }),
      meta(),
    )
    expect(ev).toMatchObject({ guild_id: 'guild-1', channel_id: 'channel-1', _scene: 'guild' })
  })
})

describe('interactionEventOf：不该回执的一律 null', () => {
  it('13 反馈 / 14 清空会话 / 15 故事集等不产生事件', () => {
    for (const t of [13, 14, 15, 16, 18, 19, 20]) {
      expect(interactionEventOf(groupButtonPayload({ type: t, data: { type: t } }), meta())).toBeNull()
    }
  })

  it('缺 id 也返回 null（拿不到 interaction_id 没法回执）', () => {
    expect(interactionEventOf(groupButtonPayload({ id: undefined }), meta())).toBeNull()
    expect(interactionEventOf(groupButtonPayload({ id: '' }), meta())).toBeNull()
  })

  it('空负载安全返回 null', () => {
    expect(interactionEventOf(null as never, meta())).toBeNull()
  })
})
