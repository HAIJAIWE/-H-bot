// tests/main/services/translator/channelRest.test.ts
//
// 频道「私域 REST 家族」（34 个模式）的规格表与动作表。
//
// 这里守的是三件容易**静默错**的事：
//   1. 模式集合三处同源（规格表 / 节点选项表 / 网关动作表）—— 少一处就是「节点能选、网关不认」
//   2. 路径段与 body 的硬要求 —— 缺字段必须在**本地**抛中文错，不能带空 id 去打官方换 400
//   3. GET 一律不带 body（undici 直接拒），查询参数从 body 里挑出来拼到网址上
import { describe, it, expect } from 'vitest'
import {
  CHANNEL_REST_MODES,
  CHANNEL_REST_SPECS,
  buildChannelRequest,
  channelExtraActions,
  readJsonBody,
  parseJsonParam,
  channelCreateBody,
  channelUpdateBody,
  announceCreateBody,
  type ChannelRestHost,
  type ChannelRestContext,
} from '../../../../src/main/services/translator/actions/channelRest'
import { CHANNEL_REST_MODE_OPTIONS } from '../../../../src/shared/nodes/channelRestModes'

/** 一份能同时满足所有模式必填项的参数字袋（各用例再按需覆盖单字段） */
const BASE: Record<string, unknown> = {
  guild_id: 'g1',
  channel_id: 'c1',
  role_id: 'r1',
  user_id: 'u1',
  message_id: 'm1',
  schedule_id: 's1',
  thread_id: 't1',
  body: JSON.stringify({
    api_identify: { path: '/guilds/g1', method: 'GET' },
    name: '周会',
    title: '公告帖',
    mute_seconds: 60,
    add: '1',
    user_ids: ['u1'],
  }),
}

const bag = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...BASE, ...over })

function fakeHost(result: { ok: boolean; data?: unknown; error?: string }): {
  host: ChannelRestHost
  calls: { method: string; path: string; body: unknown }[]
} {
  const calls: { method: string; path: string; body: unknown }[] = []
  const host: ChannelRestHost = {
    async callOfficialApi(method, path, body) {
      calls.push({ method, path, body })
      return result
    },
  }
  return { host, calls }
}

function fakeCtx(params: Record<string, unknown> = bag()): ChannelRestContext & {
  responded: unknown[]
  failed: string[]
} {
  const responded: unknown[] = []
  const failed: string[] = []
  return {
    action: 'channel_op',
    params,
    echo: 'echo-1',
    responder: {
      respond(_echo, data) {
        responded.push(data)
      },
      fail(_echo, error) {
        failed.push(error)
      },
    },
    responded,
    failed,
  }
}

describe('模式集合：规格表 / 选项表 / 动作表三处同源', () => {
  it('规格表覆盖 34 个模式，键无重复', () => {
    expect(CHANNEL_REST_MODES).toHaveLength(34)
    expect(new Set(CHANNEL_REST_MODES).size).toBe(34)
    expect(Object.keys(CHANNEL_REST_SPECS)).toEqual([...CHANNEL_REST_MODES])
  })

  it('节点选项表与规格表取值完全一致（顺序也一致，分组只影响展示）', () => {
    expect(CHANNEL_REST_MODE_OPTIONS.map(o => o.value)).toEqual([...CHANNEL_REST_MODES])
  })

  it('每个模式都有网关 handler（动作表由规格表派生）', () => {
    expect(Object.keys(channelExtraActions).sort()).toEqual([...CHANNEL_REST_MODES].sort())
  })

  it('每个模式都能用一份完整参数解析出 method + path', () => {
    for (const mode of CHANNEL_REST_MODES) {
      const req = buildChannelRequest(mode, bag())
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(req.method)
      expect(req.path.startsWith('/')).toBe(true)
      expect(req.path).not.toMatch(/\/\//)
      if (req.method === 'GET') expect(req.body).toBeUndefined()
    }
  })

  it('未知模式直接抛错，指出是哪个模式', () => {
    expect(() => buildChannelRequest('nope', {})).toThrow('未知的频道操作: nope')
  })
})

describe('频道信息族', () => {
  it('guild_get / guild_me / guild_permission 的路径', () => {
    expect(buildChannelRequest('guild_get', bag())).toEqual({ method: 'GET', path: '/guilds/g1' })
    expect(buildChannelRequest('guild_me', bag())).toEqual({ method: 'GET', path: '/users/@me' })
    expect(buildChannelRequest('guild_permission', bag())).toEqual({
      method: 'GET',
      path: '/guilds/g1/api_permission',
    })
  })

  it('列表分页参数从 body 里挑到网址上，GET 不带体', () => {
    const req = buildChannelRequest(
      'guild_my_list',
      bag({ body: JSON.stringify({ before: '100', limit: 20, other: 'x' }) }),
    )
    expect(req.method).toBe('GET')
    expect(req.path).toBe('/users/@me/guilds?before=100&limit=20')
    expect(req.body).toBeUndefined()
  })

  it('权限申请必须带 api_identify，否则本地就拦下', () => {
    expect(() =>
      buildChannelRequest('guild_permission_demand', bag({ body: JSON.stringify({}) })),
    ).toThrow('body 里需要 api_identify')
    const req = buildChannelRequest('guild_permission_demand', bag())
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/guilds/g1/api_permission/demand')
    expect(req.body).toMatchObject({ channel_id: 'c1' })
  })
})

describe('身份组与成员族', () => {
  it('身份组 CRUD 的 method 与路径', () => {
    expect(buildChannelRequest('role_list', bag()).method).toBe('GET')
    expect(buildChannelRequest('role_create', bag())).toMatchObject({
      method: 'POST',
      path: '/guilds/g1/roles',
    })
    expect(buildChannelRequest('role_update', bag())).toMatchObject({
      method: 'PATCH',
      path: '/guilds/g1/roles/r1',
    })
    expect(buildChannelRequest('role_delete', bag())).toEqual({
      method: 'DELETE',
      path: '/guilds/g1/roles/r1',
    })
  })

  it('子频道管理员加组要带 channel；不给就发空体', () => {
    expect(buildChannelRequest('role_member_add', bag()).body).toEqual({
      channel: { id: 'c1' },
    })
    expect(buildChannelRequest('role_member_add', bag({ channel_id: '' })).body).toEqual({})
    expect(buildChannelRequest('role_member_remove', bag()).method).toBe('DELETE')
  })

  it('身份组成员列表支持 start_index / limit', () => {
    const req = buildChannelRequest(
      'role_members',
      bag({ body: JSON.stringify({ start_index: 0, limit: 100 }) }),
    )
    expect(req.path).toBe('/guilds/g1/roles/r1/members?start_index=0&limit=100')
  })

  it('移除成员把 add_blacklist / delete_history_msg_days 转成规范类型', () => {
    const req = buildChannelRequest(
      'member_remove',
      bag({ body: JSON.stringify({ add_blacklist: 1, delete_history_msg_days: '7' }) }),
    )
    expect(req.method).toBe('DELETE')
    expect(req.path).toBe('/guilds/g1/members/u1')
    expect(req.body).toEqual({ add_blacklist: true, delete_history_msg_days: 7 })
  })

  it('成员列表分页、单个成员查询', () => {
    expect(buildChannelRequest('member_list', bag({ body: undefined })).path).toBe(
      '/guilds/g1/members',
    )
    expect(
      buildChannelRequest('member_list', bag({ body: JSON.stringify({ limit: 5 }) })).path,
    ).toBe('/guilds/g1/members?limit=5')
    expect(buildChannelRequest('member_get', bag())).toEqual({
      method: 'GET',
      path: '/guilds/g1/members/u1',
    })
  })
})

describe('禁言与子频道权限族', () => {
  it('禁言时长二选一，都没有就本地报错并说清楚可以填 0', () => {
    expect(() => buildChannelRequest('mute_member', bag({ body: JSON.stringify({}) }))).toThrow(
      'mute_seconds',
    )
    const cleared = buildChannelRequest(
      'mute_member',
      bag({ body: JSON.stringify({ mute_seconds: 0 }) }),
    )
    expect(cleared).toMatchObject({ method: 'PATCH', path: '/guilds/g1/members/u1/mute' })
    expect(cleared.body).toEqual({ mute_seconds: '0' })
  })

  it('截止时间戳同样接受，且能两个都传', () => {
    const req = buildChannelRequest(
      'mute_guild',
      bag({ body: JSON.stringify({ mute_end_timestamp: 1735689600000, mute_seconds: 60 }) }),
    )
    expect(req.path).toBe('/guilds/g1/mute')
    expect(req.body).toEqual({
      mute_end_timestamp: '1735689600000',
      mute_seconds: '60',
    })
  })

  it('批量禁言必须有 user_ids', () => {
    expect(() =>
      buildChannelRequest('mute_multi', bag({ body: JSON.stringify({ mute_seconds: 60 }) })),
    ).toThrow('user_ids')
    const req = buildChannelRequest(
      'mute_multi',
      bag({ body: JSON.stringify({ mute_seconds: 60, user_ids: ['u1', 'u2'] }) }),
    )
    expect(req.body).toEqual({ mute_seconds: '60', user_ids: ['u1', 'u2'] })
  })

  it('子频道权限至少要给 add 或 remove', () => {
    expect(() => buildChannelRequest('member_perm_put', bag({ body: JSON.stringify({}) }))).toThrow(
      'add',
    )
    const req = buildChannelRequest('role_perm_put', bag({ body: JSON.stringify({ remove: '4' }) }))
    expect(req).toMatchObject({
      method: 'PUT',
      path: '/channels/c1/roles/r1/permissions',
    })
    expect(req.body).toEqual({ remove: '4' })
    expect(buildChannelRequest('member_perm_get', bag()).path).toBe(
      '/channels/c1/members/u1/permissions',
    )
    expect(buildChannelRequest('role_perm_get', bag()).path).toBe(
      '/channels/c1/roles/r1/permissions',
    )
  })
})

describe('频道私信 / 日程 / 论坛 / 消息族', () => {
  it('私信会话要 recipient_id + source_guild_id', () => {
    expect(buildChannelRequest('dm_create', bag())).toEqual({
      method: 'POST',
      path: '/users/@me/dms',
      body: { recipient_id: 'u1', source_guild_id: 'g1' },
    })
    expect(buildChannelRequest('dm_send', bag()).path).toBe('/dms/g1/messages')
  })

  it('日程列表可带 since，创建自动套一层 schedule', () => {
    expect(
      buildChannelRequest(
        'schedule_list',
        bag({ body: JSON.stringify({ since: '1700000000000' }) }),
      ).path,
    ).toBe('/channels/c1/schedules?since=1700000000000')
    const created = buildChannelRequest(
      'schedule_create',
      bag({ body: JSON.stringify({ name: '周会', start_timestamp: '1' }) }),
    )
    expect(created.body).toEqual({ schedule: { name: '周会', start_timestamp: '1' } })
  })

  it('已套好的 schedule 原样透传；缺 name 才报错', () => {
    const wrapped = { schedule: { name: '周会' } }
    expect(
      buildChannelRequest('schedule_update', bag({ body: JSON.stringify(wrapped) })).body,
    ).toEqual(wrapped)
    expect(() => buildChannelRequest('schedule_create', bag({ body: JSON.stringify({}) }))).toThrow(
      'body 里需要 name',
    )
  })

  it('日程单条与删除用 schedule_id', () => {
    expect(buildChannelRequest('schedule_get', bag()).path).toBe('/channels/c1/schedules/s1')
    expect(buildChannelRequest('schedule_delete', bag()).method).toBe('DELETE')
  })

  it('论坛发帖是 PUT，且必须带 title', () => {
    expect(() =>
      buildChannelRequest('thread_create', bag({ body: JSON.stringify({ content: 'x' }) })),
    ).toThrow('title')
    expect(buildChannelRequest('thread_create', bag())).toMatchObject({
      method: 'PUT',
      path: '/channels/c1/threads',
    })
    expect(buildChannelRequest('thread_get', bag()).path).toBe('/channels/c1/threads/t1')
    expect(buildChannelRequest('thread_list', bag()).path).toBe('/channels/c1/threads')
  })

  it('消息详情按 message_id 拉单条', () => {
    expect(buildChannelRequest('message_get', bag())).toEqual({
      method: 'GET',
      path: '/channels/c1/messages/m1',
    })
  })
})

describe('参数校验：缺字段时抛中文错，并带上模式名', () => {
  it('缺路径段就抛「xxx 不能为空」，错误里带模式名', () => {
    expect(() => buildChannelRequest('role_list', bag({ guild_id: '' }))).toThrow(
      'role_list guild_id 不能为空',
    )
    expect(() => buildChannelRequest('message_get', bag({ message_id: '  ' }))).toThrow(
      'message_id 不能为空',
    )
  })

  it('路径段做 URL 编码，别让特殊字符拼坏路由', () => {
    expect(buildChannelRequest('role_update', bag({ role_id: 'a/b?c' })).path).toBe(
      '/guilds/g1/roles/a%2Fb%3Fc',
    )
  })

  it('坏 JSON 直接失败，并指出是哪一段', () => {
    expect(() => buildChannelRequest('role_create', bag({ body: '{oops' }))).toThrow(
      'body 不是合法 JSON',
    )
  })
})

describe('JSON 参数解析', () => {
  it('parseJsonParam 收字符串、对象、空值，拒绝坏 JSON', () => {
    expect(parseJsonParam(undefined, 'x')).toBeUndefined()
    expect(parseJsonParam('   ', 'x')).toBeUndefined()
    expect(parseJsonParam('{"a":1}', 'x')).toEqual({ a: 1 })
    expect(parseJsonParam({ a: 1 }, 'x')).toEqual({ a: 1 })
    expect(() => parseJsonParam('[1,', 'x')).toThrow('x 不是合法 JSON')
  })

  it('readJsonBody 只接受普通对象（数组/标量都不行）', () => {
    expect(readJsonBody(undefined)).toBeUndefined()
    expect(readJsonBody('{"a":1}')).toEqual({ a: 1 })
    expect(() => readJsonBody('[1,2]')).toThrow('body 必须是 JSON 对象')
    expect(() => readJsonBody('42')).toThrow('body 必须是 JSON 对象')
  })
})

describe('节点端口 → 请求体（body 端口留空时的兜底）', () => {
  it('创建子频道把类型名翻译成官方整数码', () => {
    expect(channelCreateBody({ type: 'text', name: '闲聊', position: 2 })).toEqual({
      type: 0,
      name: '闲聊',
      position: 2,
    })
    expect(channelCreateBody({ type: 'forum' }).type).toBe(10007)
    expect(() => channelCreateBody({ type: 'nope' })).toThrow('不认识的子频道类型')
  })

  it('更新子频道只在给了字段时才写进 body', () => {
    expect(channelUpdateBody({})).toEqual({})
    expect(channelUpdateBody({ name: '新名字', parent_id: 'g1' })).toEqual({
      name: '新名字',
      parent_id: 'g1',
    })
  })

  it('公告两种形态：推荐子频道 vs 消息 id，都没有就报错', () => {
    expect(
      announceCreateBody({
        recommend_channels: JSON.stringify([{ channel_id: 'c1', introduce: 'x' }]),
      }),
    ).toMatchObject({ announces_type: 0 })
    expect(announceCreateBody({ message_id: 'm9', channel_id: 'c1' })).toEqual({
      message_id: 'm9',
      channel_id: 'c1',
    })
    expect(() => announceCreateBody({})).toThrow('公告需要 message_id')
  })
})

describe('handler：成功回 data，失败回错误', () => {
  it('成功时把官方 data 原样回给节点', async () => {
    const { host, calls } = fakeHost({ ok: true, data: { roles: [] } })
    const ctx = fakeCtx()
    await channelExtraActions.role_list(host, ctx)
    expect(calls).toEqual([{ method: 'GET', path: '/guilds/g1/roles', body: undefined }])
    expect(ctx.responded).toEqual([{ roles: [] }])
    expect(ctx.failed).toEqual([])
  })

  it('官方失败时把 error 交给 responder.fail', async () => {
    const { host } = fakeHost({ ok: false, error: '403 没有权限' })
    const ctx = fakeCtx()
    await channelExtraActions.role_list(host, ctx)
    expect(ctx.failed).toEqual(['403 没有权限'])
    expect(ctx.responded).toEqual([])
  })

  it('官方失败且没给原因时也有兜底文案', async () => {
    const { host } = fakeHost({ ok: false })
    const ctx = fakeCtx()
    await channelExtraActions.member_list(host, ctx)
    expect(ctx.failed).toEqual(['频道接口调用失败'])
  })

  it('参数不合法时**不发请求**，直接失败', async () => {
    const { host, calls } = fakeHost({ ok: true })
    const ctx = fakeCtx({ guild_id: '' })
    await channelExtraActions.role_list(host, ctx)
    expect(calls).toEqual([])
    expect(ctx.failed.join('')).toContain('guild_id 不能为空')
  })

  it('成功但官方没回数据时回 null（节点侧看到的是「无返回」而不是 undefined）', async () => {
    const { host } = fakeHost({ ok: true })
    const ctx = fakeCtx()
    await channelExtraActions.role_delete(host, ctx)
    expect(ctx.responded).toEqual([null])
  })
})
