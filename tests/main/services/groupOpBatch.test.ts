// tests/main/services/groupOpBatch.test.ts
//
// group_op 的批量模式 + 遗留模式拒绝 —— 对齐 10/18 客户端语义（_recovery/client-src/groupOp.client.js）。
//
// 背景：节点目录早就把「批量踢出 / 加入黑名单 / 移出黑名单」放进下拉、也渲染了 user_ids 端口，
// 但 handler 里根本没有这三个分支 —— 用户在画布上选得到、跑起来只会得到一句「未知 mode」。
// 同时 mute_all / set_card / set_title 这类官方根本没有的能力，以前会去调用一个必然失败的接口；
// 现在统一返回「模式不可用 + 原因」（原因表在 shared/nodes/fieldOptions.ts）。
import { describe, expect, it, vi } from 'vitest'

import { GROUP_OP_LEGACY_REASONS } from '@shared/nodes/fieldOptions'
import type { BotInterface } from '@main/services/builtinNodes/builtinNodes'
import { groupOp, parseUserIds, type GroupOpOptions } from '@main/services/builtinNodes/groupOp'

const BLACKLIST_DURATION_SEC = 30 * 24 * 3600
const event = { user_id: 10001, group_id: 20002, message: { type: 'text', data: {} } }

/** 记录每次 callApi 的假 bot（可选：让某几个号码抛错，模拟权限不足/不在群里） */
function makeBot(failUids: string[] = []) {
  const calls: Array<{ api: string; params: Record<string, unknown> }> = []
  const callApi = vi.fn(async (api: string, params: Record<string, unknown>) => {
    calls.push({ api, params })
    const uid = String(params.user_id ?? '')
    if (failUids.includes(uid)) throw new Error(`无法操作 ${uid}`)
    return {}
  })
  return { bot: { callApi } as unknown as BotInterface, calls, callApi }
}

function options(patch: Partial<GroupOpOptions>): GroupOpOptions {
  return { mode: 'ban', ...patch }
}

describe('parseUserIds：用户直接粘一行也要能用', () => {
  it('逗号 / 中文逗号 / 空格 / 换行 / 顿号都能分', () => {
    expect(parseUserIds('111,222 333、444\n555')).toEqual(['111', '222', '333', '444', '555'])
  })

  it('丢非数字、去重，保留首次出现的顺序', () => {
    expect(parseUserIds('222,abc,111,222, 333')).toEqual(['222', '111', '333'])
    expect(parseUserIds(['111', 222, '111'])).toEqual(['111', '222'])
  })

  it('空输入返回空数组（不是 [""]）', () => {
    expect(parseUserIds('')).toEqual([])
    expect(parseUserIds(null)).toEqual([])
    expect(parseUserIds(undefined)).toEqual([])
  })
})

describe('批量模式：逐个下发，成功给回执', () => {
  it('批量踢出：每个号码一次 set_group_kick，回执说清处理了几个', async () => {
    const { bot, calls } = makeBot()
    const r = await groupOp(bot, event, options({ mode: 'kick_batch', group_id: '67890', user_ids: '111,222' }))
    expect(r).toEqual({ success: true, error: '', message: '已处理 2 个目标' })
    expect(calls).toEqual([
      { api: 'set_group_kick', params: { group_id: 67890, user_id: 111, reject_add_request: false } },
      { api: 'set_group_kick', params: { group_id: 67890, user_id: 222, reject_add_request: false } },
    ])
  })

  it('加入黑名单：用 30 天禁言近似，并在回执里说明会自动到期', async () => {
    const { bot, calls } = makeBot()
    const r = await groupOp(bot, event, options({ mode: 'blacklist_add', group_id: '67890', user_ids: '111' }))
    expect(calls[0].params).toMatchObject({ duration: BLACKLIST_DURATION_SEC })
    expect(r.success).toBe(true)
    expect(r.message).toContain('30 天')
    expect(r.message).toContain('自动解除')
  })

  it('移出黑名单：duration 0（解除禁言）', async () => {
    const { bot, calls } = makeBot()
    const r = await groupOp(bot, event, options({ mode: 'blacklist_del', group_id: '67890', user_ids: '111' }))
    expect(calls[0]).toEqual({ api: 'set_group_ban', params: { group_id: 67890, user_id: 111, duration: 0 } })
    expect(r).toEqual({ success: true, error: '', message: '已处理 1 个目标' })
  })

  it('群号为空时取事件里的群（群消息里直接批量操作）', async () => {
    const { bot, calls } = makeBot()
    await groupOp(bot, event, options({ mode: 'kick_batch', user_ids: '111' }))
    expect(calls[0].params.group_id).toBe(event.group_id)
  })

  it('部分失败：整批跑完再汇总，失败的是谁要说出来', async () => {
    const { bot, calls } = makeBot(['222'])
    const r = await groupOp(bot, event, options({ mode: 'kick_batch', group_id: '67890', user_ids: '111,222,333' }))
    expect(calls).toHaveLength(3) // 一个失败不该让后面的人跳过
    expect(r.success).toBe(false)
    expect(r.error).toContain('3 个目标里有 1 个失败: 222')
  })

  it('user_ids 一个有效号码都没有时明确报错，不空跑', async () => {
    const { bot, callApi } = makeBot()
    const r = await groupOp(bot, event, options({ mode: 'kick_batch', group_id: '67890', user_ids: 'abc, def' }))
    expect(r).toEqual({
      success: false,
      error: 'user_ids 不能为空（多个 QQ 号用逗号或空格分隔）',
    })
    expect(callApi).not.toHaveBeenCalled()
  })
})

describe('遗留模式：明确拒绝并给原因，而不是去打必失败的接口', () => {
  it.each(Object.keys(GROUP_OP_LEGACY_REASONS))('%s 被拒绝且原因来自单一真相表', async (mode) => {
    const { bot, callApi } = makeBot()
    const r = await groupOp(bot, event, options({ mode: mode as GroupOpOptions['mode'] }))
    expect(r.success).toBe(false)
    expect(r.error).toBe(`「${mode}」不可用：${GROUP_OP_LEGACY_REASONS[mode]}`)
    expect(callApi).not.toHaveBeenCalled()
  })
})

describe('ban 时长：负值归零、超过 30 天按官方上限截断', () => {
  it('999999999 秒被截到 2592000', async () => {
    const { bot, calls } = makeBot()
    const r = await groupOp(bot, event, options({ mode: 'ban', group_id: '67890', user_id: '111', duration: 999999999 }))
    expect(r.success).toBe(true)
    expect(calls[0].params.duration).toBe(BLACKLIST_DURATION_SEC)
  })

  it('负数当 0（立即解除）', async () => {
    const { bot, calls } = makeBot()
    await groupOp(bot, event, options({ mode: 'ban', group_id: '67890', user_id: '111', duration: -5 }))
    expect(calls[0].params.duration).toBe(0)
  })
})

describe('未知 mode：仍然明确报错', () => {
  it('列出支持的取值，别静默成功', async () => {
    const { bot } = makeBot()
    const r = await groupOp(bot, event, options({ mode: 'nope' as GroupOpOptions['mode'] }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('未知 mode: nope')
  })
})
