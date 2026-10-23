// tests/main/nodes/getContext.test.ts
//
// get_context（获取上下文）—— 模板里用得最多的节点（83 次），此前是空壳。
//
// 历史实现：`getContext(bot, event, key)` 直接 `return { value: null }`，而注册表按位置参数
// 只传了 `key`，目录声明的 mode 根本没进来。后果：从模板创建的项目里，取时长参数 / 取 @ 对象 /
// 取群号这些节点全部"执行成功但什么都没取到"。
import { describe, it, expect } from 'vitest'
import { getContext } from '@main/services/builtinNodes/builtinNodes'

const bot = {
  callApi: async (api: string, params: Record<string, unknown>) => {
    if (api === 'get_group_member_list') return [{ user_id: 1 }, { user_id: 2 }]
    if (api === 'get_group_member_info') {
      return {
        group_id: Number(params.group_id),
        user_id: Number(params.user_id),
        nickname: '张三',
        card: '',
        role: 'admin',
        bot: false,
        joined_at: '2025-08-20T09:15:00+08:00',
      }
    }
    if (api === 'get_group_bot_state') {
      return {
        group_id: Number(params.group_id),
        role: 'admin',
        is_admin: true,
        allow_proactive_msg: false,
        recv_msg_setting: 'only_mention',
      }
    }
    if (api === 'list_group_blacklist') {
      return {
        users: [{ user_id: 7, nickname: '捣乱的', banned_at: '2025-07-01T10:30:00+08:00' }],
        next_cursor: 'bl_2',
      }
    }
    if (api === 'get_group_info') return { group_name: '测试群' }
    if (api === 'get_group_mute_state') {
      return {
        group_id: Number(params.group_id),
        mute_all: true,
        mute_mode: 'always',
        global_rule: { mode: 'always', schedule_rules: [], recurring_rules: [] },
        members: [{ user_id: 1, nickname: '张三', mute_expire_at: '2026-08-05T11:23:04+08:00' }],
      }
    }
    throw new Error(`unsupported: ${api}`)
  },
} as never
const groupEvent = {
  post_type: 'message',
  message_type: 'group',
  raw_message: '/禁言 @小明 600',
  message: [
    { type: 'text', data: { text: '/禁言 ' } },
    { type: 'at', data: { qq: '10001' } },
    { type: 'text', data: { text: ' 600' } },
  ],
  user_id: 20002,
  group_id: 30003,
  self_id: 40004,
  message_id: 55,
  sub_type: 'normal',
} as never

describe('get_context：纯事件字段', () => {
  it('user_id / group_id / self_id / message_id', async () => {
    expect((await getContext(bot, groupEvent, { mode: 'user_id' })).result).toBe(20002)
    expect((await getContext(bot, groupEvent, { mode: 'group_id' })).result).toBe(30003)
    expect((await getContext(bot, groupEvent, { mode: 'self_id' })).result).toBe(40004)
    expect((await getContext(bot, groupEvent, { mode: 'message_id' })).result).toBe(55)
  })

  it('raw_message / message_text（消息段拼接）', async () => {
    expect((await getContext(bot, groupEvent, { mode: 'raw_message' })).result).toBe('/禁言 @小明 600')
    expect((await getContext(bot, groupEvent, { mode: 'message_text' })).result).toBe('/禁言 @10001 600')
  })

  it('operator_id 回退到触发者；sub_type 原样返回', async () => {
    expect((await getContext(bot, groupEvent, { mode: 'operator_id' })).result).toBe(20002)
    expect((await getContext(bot, groupEvent, { mode: 'sub_type' })).result).toBe('normal')
  })
})

describe('get_context：指令参数（模板「取时长参数」用的就是它）', () => {
  it('command_args 按索引取参数，并输出全部参数列表', async () => {
    const first = await getContext(bot, groupEvent, { mode: 'command_args', index: 0 })
    expect(first.result).toBe('@小明')
    expect(first.args_list).toEqual(['@小明', '600'])

    const second = await getContext(bot, groupEvent, { mode: 'command_args', index: 1 })
    expect(second.result).toBe('600')
  })

  it('index 支持负数（-1 = 最后一个）且越界返回空串', async () => {
    expect((await getContext(bot, groupEvent, { mode: 'command_args', index: -1 })).result).toBe('600')
    expect((await getContext(bot, groupEvent, { mode: 'command_args', index: 99 })).result).toBe('')
  })

  it('没有参数时返回空串而不是报错', async () => {
    const bare = { ...(groupEvent as Record<string, unknown>), raw_message: '/签到' } as never
    const res = await getContext(bot, bare, { mode: 'command_args', index: 0 })
    expect(res.success).toBe(true)
    expect(res.result).toBe('')
    expect(res.args_list).toEqual([])
  })
})

describe('get_context：消息片段（模板「取@对象」用的就是它）', () => {
  it('message_part + part_mode=at 直接返回 QQ 号，并给出片段列表', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'message_part', part_mode: 'at' })
    expect(res.result).toBe('10001')
    expect(res.part_list).toEqual([{ qq: '10001' }])
  })

  it('非 at 片段返回段数据；没有该类型片段时为 null', async () => {
    const img = {
      ...(groupEvent as Record<string, unknown>),
      message: [{ type: 'image', data: { url: 'https://example.com/a.png' } }],
    } as never
    expect((await getContext(bot, img, { mode: 'message_part', part_mode: 'image' })).result).toEqual({
      url: 'https://example.com/a.png',
    })
    expect((await getContext(bot, groupEvent, { mode: 'message_part', part_mode: 'image' })).result).toBe(null)
  })
})

describe('get_context：message_part 六种类型（BUG3 回归）', () => {
  // 回归：message_part 以前只读 `event.message`，而官方接入的事件里消息段只有
  // text / at（附件在翻译层就被丢弃），引用与结构化卡片零解析 →
  // image / file / reply / record / video / json 六种 part_mode **永远返回 null**。
  it('附件段（image / record / video / file）现在能取到', async () => {
    const ev = {
      ...(groupEvent as Record<string, unknown>),
      message: [
        { type: 'text', data: { text: '看这个' } },
        { type: 'image', data: { url: 'https://example.com/a.png' } },
        { type: 'record', data: { url: 'https://example.com/b.silk' } },
        { type: 'video', data: { url: 'https://example.com/c.mp4' } },
        { type: 'file', data: { url: 'https://example.com/d.pdf', name: 'd.pdf' } },
      ],
    } as never
    expect((await getContext(bot, ev, { mode: 'message_part', part_mode: 'image' })).result).toEqual({
      url: 'https://example.com/a.png',
    })
    expect((await getContext(bot, ev, { mode: 'message_part', part_mode: 'record' })).result).toEqual({
      url: 'https://example.com/b.silk',
    })
    expect((await getContext(bot, ev, { mode: 'message_part', part_mode: 'video' })).result).toEqual({
      url: 'https://example.com/c.mp4',
    })
    expect((await getContext(bot, ev, { mode: 'message_part', part_mode: 'file' })).result).toEqual({
      url: 'https://example.com/d.pdf',
      name: 'd.pdf',
    })
  })

  it('引用回复由 _ref_idx（message_scene 的 msg_idx）合成 reply 段', async () => {
    const ev = { ...(groupEvent as Record<string, unknown>), _ref_idx: 'REFIDX_x' } as never
    const res = await getContext(bot, ev, { mode: 'message_part', part_mode: 'reply' })
    expect(res.result).toEqual({ id: 'REFIDX_x' })
    expect(res.part_list).toEqual([{ id: 'REFIDX_x' }])
  })

  it('结构化卡片由 ark_data 合成 json 段', async () => {
    const ev = { ...(groupEvent as Record<string, unknown>), ark_data: { arkName: '卡片' } } as never
    const res = await getContext(bot, ev, { mode: 'message_part', part_mode: 'json' })
    expect(res.result).toEqual({ arkName: '卡片' })
  })

  it('没有该类型片段时仍返回 null（不是报错）', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'message_part', part_mode: 'reply' })
    expect(res.success).toBe(true)
    expect(res.result).toBe(null)
  })
})

describe('get_context：message_ref（引用回复要用的标识）', () => {
  it('有 _ref_idx 时返回官方 REFIDX（可直接填进「引用回复」端口）', async () => {
    const ev = { ...(groupEvent as Record<string, unknown>), _ref_idx: 'REFIDX_x' } as never
    expect((await getContext(bot, ev, { mode: 'message_ref' })).result).toBe('REFIDX_x')
  })

  it('没有 _ref_idx 时回退到 message_id（适配器拿它查 REFIDX 表）', async () => {
    expect((await getContext(bot, groupEvent, { mode: 'message_ref' })).result).toBe('55')
  })

  it('两者都没有时返回空串（不报错）', async () => {
    const bare = { ...(groupEvent as Record<string, unknown>), message_id: undefined } as never
    expect((await getContext(bot, bare, { mode: 'message_ref' })).result).toBe('')
  })
})

describe('get_context：需要调用 QQ 接口的模式', () => {
  it('group_members 返回成员列表', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'group_members' })
    expect(res.success).toBe(true)
    expect(res.members).toEqual([{ user_id: 1 }, { user_id: 2 }])
  })

  it('user_name / group_name 取名称', async () => {
    expect((await getContext(bot, groupEvent, { mode: 'user_name' })).result).toBe('张三')
    expect((await getContext(bot, groupEvent, { mode: 'group_name' })).result).toBe('测试群')
  })

  it('接口不可用时返回明确错误（不再静默 null）', async () => {
    const dumbBot = {
      callApi: async () => {
        throw new Error('not supported')
      },
    } as never
    const res = await getContext(dumbBot, groupEvent, { mode: 'group_name' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('获取群名称失败')
  })

  it('缺少必要上下文时给出可读错误', async () => {
    const privateEvent = { ...(groupEvent as Record<string, unknown>), group_id: undefined } as never
    const res = await getContext(bot, privateEvent, { mode: 'group_members' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('需要群号')
  })

  it('未知 mode 明确报错', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'not_a_mode' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('未知 mode')
  })
})

describe('get_context：目录声明了但 handler 从未返回的出口（回归）', () => {
  // 目录里 `outputs` 是给用户连线用的承诺。此前 part_count / card / nickname 三个出口
  // 只在目录里存在，handler 一律不返回 —— 用户把变量绑到这些出口上，恒为空且不报错。
  it('message_part 返回 part_count（此前恒缺失）', async () => {
    const ev = {
      ...(groupEvent as Record<string, unknown>),
      message: [
        { type: 'at', data: { qq: '1' } },
        { type: 'at', data: { qq: '2' } },
        { type: 'text', data: { text: 'x' } },
      ],
    } as never
    const res = await getContext(bot, ev, { mode: 'message_part', part_mode: 'at' })
    expect(res.part_count).toBe(2)
    expect(res.part_list).toHaveLength(2)
  })

  it('user_name 返回 card 与 nickname（此前只给 result）', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'user_name' })
    expect(res.result).toBe('张三')
    expect(res.card).toBe('')
    expect(res.nickname).toBe('张三')
  })

  it('群名片优先于昵称作为 result', async () => {
    const cardBot = {
      callApi: async () => ({ card: '群名片', nickname: '张三' }),
    } as never
    const res = await getContext(cardBot, groupEvent, { mode: 'user_name' })
    expect(res.result).toBe('群名片')
  })
})

describe('get_context：group_mute_state（QQ 官方专属，需机器人是群管理员）', () => {
  it('返回是否正在全员禁言，以及模式 / 原始规则 / 被禁言成员', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'group_mute_state' })
    expect(res.success).toBe(true)
    expect(res.result).toBe(true)
    expect(res.mute_mode).toBe('always')
    expect(res.mute_rules).toEqual({ mode: 'always', schedule_rules: [], recurring_rules: [] })
    expect(res.muted_members).toHaveLength(1)
  })

  it('非群聊场景（没有群号）给出可读错误', async () => {
    const privateEvent = { ...(groupEvent as Record<string, unknown>), group_id: undefined } as never
    const res = await getContext(bot, privateEvent, { mode: 'group_mute_state' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('需要群号')
  })

  it('接口不可用时提示需要群管理员（而不是笼统的失败）', async () => {
    const noPermBot = {
      callApi: async () => {
        throw new Error('群管理接口失败：机器人不是群管理员')
      },
    } as never
    const res = await getContext(noPermBot, groupEvent, { mode: 'group_mute_state' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('需机器人是群管理员')
  })

  it('未返回 mute_all 时 result 为 false（不臆造"正在禁言"）', async () => {
    const emptyBot = { callApi: async () => ({}) } as never
    const res = await getContext(emptyBot, groupEvent, { mode: 'group_mute_state' })
    expect(res.success).toBe(true)
    expect(res.result).toBe(false)
    expect(res.mute_mode).toBe('none')
  })
})

describe('get_context：成员信息 / 机器人群内状态 / 群黑名单（非频道新增）', () => {
  it('member_info 给出完整结构，result 是对象而不是单个昵称', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'member_info' })
    expect(res.success).toBe(true)
    expect(res.result).toMatchObject({ nickname: '张三', role: 'admin' })
    expect(res.role).toBe('admin')
    // 角色字符串的比较交给节点，流程里直接用布尔
    expect((res.result as { is_admin: boolean }).is_admin).toBe(true)
  })

  it('member_info 缺少 QQ 号时给出可读错误', async () => {
    const bare = { ...(groupEvent as Record<string, unknown>), user_id: undefined } as never
    const res = await getContext(bot, bare, { mode: 'member_info' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('需要 QQ 号')
  })

  it('member_info 接口不可用时提示"内邀接入中"（而不是笼统失败）', async () => {
    const noPermBot = {
      callApi: async () => {
        throw new Error('群管理接口失败：11253 应用无接口访问权限')
      },
    } as never
    const res = await getContext(noPermBot, groupEvent, { mode: 'member_info' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('内邀接入中')
  })

  it('bot_state：result 是"是否管理员"，另出角色与收消息模式', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'bot_state' })
    expect(res.success).toBe(true)
    expect(res.result).toBe(true)
    expect(res.is_admin).toBe(true)
    expect(res.role).toBe('admin')
    expect(res.recv_msg_setting).toBe('only_mention')
  })

  it('blacklist_list：result 是用户列表，并透出下一页游标', async () => {
    const res = await getContext(bot, groupEvent, { mode: 'blacklist_list' })
    expect(res.success).toBe(true)
    expect(Array.isArray(res.result)).toBe(true)
    expect(res.members).toHaveLength(1)
    expect(res.next_cursor).toBe('bl_2')
  })

  it('join_requests：把入群申请列表真正交到流程手里（以前插在 group_op 里、数据被丢掉）', async () => {
    const jrBot = {
      callApi: async (api: string, params: Record<string, unknown>) => {
        if (api !== 'get_group_join_requests') throw new Error(`unsupported: ${api}`)
        return {
          requests: [
            { user_id: 10000, flag: 'jr_1', nickname: '申请人甲', verify_message: '我是群友', apply_at: '' },
          ],
          next_cursor: 'jr_page2',
        }
      },
    } as never
    const res = await getContext(jrBot, groupEvent, { mode: 'join_requests' })
    expect(res.success).toBe(true)
    expect(Array.isArray(res.result)).toBe(true)
    expect(res.members).toHaveLength(1)
    expect(res.next_cursor).toBe('jr_page2')
  })

  it('join_requests 需要群号 / 需群管理员时给出可读错误', async () => {
    const bare = { ...(groupEvent as Record<string, unknown>), group_id: undefined } as never
    expect((await getContext(bot, bare, { mode: 'join_requests' })).error).toContain('需要群号')

    const noPermBot = {
      callApi: async () => {
        throw new Error('群管理接口失败：机器人不是群管理员')
      },
    } as never
    const res = await getContext(noPermBot, groupEvent, { mode: 'join_requests' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('需机器人是群管理员')
  })

  it('group_members：把游标传下去并带回下一页游标（否则大群永远只看得到第一页）', async () => {
    const calls: Array<Record<string, unknown>> = []
    const cursorBot = {
      callApi: async (api: string, params: Record<string, unknown>) => {
        calls.push({ api, ...params })
        return { members: [{ user_id: 1 }], next_cursor: 'page2' }
      },
    } as never
    const res = await getContext(cursorBot, groupEvent, { mode: 'group_members', cursor: 'page1' })
    expect(calls[0]).toMatchObject({ api: 'get_group_member_list', cursor: 'page1' })
    expect(res.members).toHaveLength(1)
    expect(res.next_cursor).toBe('page2')
  })
})
