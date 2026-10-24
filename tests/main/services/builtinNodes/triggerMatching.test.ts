// tests/main/services/builtinNodes/triggerMatching.test.ts
//
// 触发器匹配：命令 / 关键词 / 正则 / @我。
//
// 为什么补这个文件：这套逻辑迁移前由 pytest 的 test_on_command / test_at /
// test_on_message / test_get_command_args 覆盖；Python 栈删除后，TS 侧按 kind 统计
// message_received 只出现在"目录里有这个节点""配置能存下来"这类断言里 ——
// 真正决定机器人"听不听得懂指令"的匹配函数零测试。
//
// 覆盖的是 10/18 客户端语义（triggerNodes.ts 由该产物还原），不是旧 pytest 的字面断言：
//   · 参数用 shlex（引号内空格算一个参数）—— 旧实现用 str.split()，行为不同；
//   · 指令可以带前缀也可以不带（'/测试 x' 与 '测试 x' 都算命中）；
//   · 正则与关键词都有长度上限（ReDoS 防护），超限直接不匹配。
import { describe, it, expect } from 'vitest'
import {
  messageReceived,
  splitArgs,
  shlexSplit,
  checkMessageType,
  matchAtMe,
  matchCommand,
  matchKeyword,
  matchRegex,
} from '@main/services/builtinNodes/triggerNodes'

/** 造一个最小事件：只有 get_message 是真实现，其余字段按需覆盖 */
function ev(text: string, over: Record<string, unknown> = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    user_id: 12345,
    group_id: 67890,
    get_message: () => text,
    ...over,
  }
}

describe('参数切分：shlex 语义', () => {
  it('引号里的空格算一个参数（不是旧的 str.split 行为）', () => {
    expect(shlexSplit('买 "新手 剑" 2')).toEqual(['买', '新手 剑', '2'])
  })

  it('引号里的转义引号进值、不留在参数里', () => {
    expect(shlexSplit('echo "a\\"b"')).toEqual(['echo', 'a"b'])
  })

  it('空串 / 纯空白 → 空数组', () => {
    expect(shlexSplit('')).toEqual([])
    expect(splitArgs('   ')).toEqual([])
  })

  it('splitArgs 与 shlexSplit 同语义（同一份实现的两个入口）', () => {
    expect(splitArgs('a "b c"')).toEqual(shlexSplit('a "b c"'))
  })
})

describe('消息类型过滤', () => {
  it('any / both / 空 → 不过滤', () => {
    const e = ev('/测试')
    for (const t of ['any', 'both', '']) expect(checkMessageType(e, t)).toBe(true)
  })

  it('group 只收群消息，private 只收私聊', () => {
    expect(checkMessageType(ev('x', { message_type: 'group' }), 'group')).toBe(true)
    expect(checkMessageType(ev('x', { message_type: 'group' }), 'private')).toBe(false)
    expect(checkMessageType(ev('x', { message_type: 'private' }), 'private')).toBe(true)
  })

  it('事件没有 message_type 时按「不匹配」处理', () => {
    expect(checkMessageType({}, 'group')).toBe(false)
  })
})

describe('@我', () => {
  it('事件提供 is_tome() 时以它为准', () => {
    expect(matchAtMe({ is_tome: () => true })).toBe(true)
    expect(matchAtMe({ is_tome: () => false })).toBe(false)
  })

  it('没有 is_tome() 时看消息里有没有 CQ:at 段', () => {
    expect(matchAtMe(ev('[CQ:at,qq=10000] 你好'))).toBe(true)
    expect(matchAtMe(ev('你好'))).toBe(false)
  })

  it('get_message 抛异常 → 不算 @', () => {
    const bad = {
      get_message: () => {
        throw new Error('boom')
      },
    }
    expect(matchAtMe(bad)).toBe(false)
  })
})

describe('指令匹配：前缀 + 参数', () => {
  it('带前缀命中，参数切出来', () => {
    expect(matchCommand('/测试 a b', '测试', '/')).toEqual(['a', 'b'])
  })

  it('不带前缀也命中（历史行为：指令名裸写也算）', () => {
    expect(matchCommand('测试 x', '测试', '/')).toEqual(['x'])
  })

  it('只有指令本身 → 空参数数组，不是 null', () => {
    expect(matchCommand('/测试', '测试', '/')).toEqual([])
    expect(matchCommand('  测试  ', '测试', '/')).toEqual([])
  })

  it('Tab 分隔也算命中（面板里复制粘贴常见）', () => {
    expect(matchCommand('/测试\targ', '测试', '/')).toEqual(['arg'])
  })

  it('前缀不对 / 指令名只是别的前缀的一部分 → 不命中', () => {
    expect(matchCommand('!测试 a', '测试', '/')).toBeNull()
    expect(matchCommand('/测试2 a', '测试', '/')).toBeNull()
  })

  it('没填指令名 → 永不命中（避免空指令把整条消息吃成参数）', () => {
    expect(matchCommand('/随便', '', '/')).toBeNull()
  })

  it('参数里带引号 → shlex 拼回一个词', () => {
    expect(matchCommand('/测试 "多 词" b', '测试', '/')).toEqual(['多 词', 'b'])
  })
})

describe('关键词匹配', () => {
  it('JSON 数组字符串（面板里的存法）', () => {
    expect(matchKeyword('帮我签到一下', '["签到","打卡"]')).toBe(true)
    expect(matchKeyword('随便聊聊', '["签到","打卡"]')).toBe(false)
  })

  it('数组本身也认（节点间连线传的是数组）', () => {
    expect(matchKeyword('hello world', ['hello'])).toBe(true)
  })

  it('不是 JSON 的字符串按单个关键词处理（不静默失效）', () => {
    expect(matchKeyword('系统维护中', '维护')).toBe(true)
  })

  it('没有配置关键词 → 永不命中', () => {
    expect(matchKeyword('任意文本', null)).toBe(false)
    expect(matchKeyword('任意文本', '')).toBe(false)
  })
})

describe('正则匹配', () => {
  it('命中并带回捕获组', async () => {
    const r = await matchRegex('伤害 42 点', '伤害 (\\d+) 点', '')
    expect(r?.matched).toBe('伤害 42 点')
    expect(r?.groups).toEqual(['42'])
  })

  it('没命中 → null', async () => {
    expect(await matchRegex('无事发生', '伤害 (\\d+) 点', '')).toBeNull()
  })

  it('没有 pattern → null（不算错误，只是不匹配）', async () => {
    expect(await matchRegex('任意', '', '')).toBeNull()
  })

  it('超长文本直接不匹配（ReDoS 防护的入口检查）', async () => {
    expect(await matchRegex('x'.repeat(100_001), 'x', '')).toBeNull()
  })
})

describe('message_received：把匹配接到节点出口', () => {
  it('any：任何消息都过，raw_message 是原文', async () => {
    const r = await messageReceived({} as never, ev('/测试') as never, 'any')
    expect(r).toMatchObject({ raw_message: '/测试', args: [], matched: '', groups: [] })
  })

  it('command：命中时带参数，不命中时返回 null', async () => {
    const hit = await messageReceived({} as never, ev('/测试 a b') as never, 'command', 'any', '测试', '/')
    expect(hit?.args).toEqual(['a', 'b'])
    const miss = await messageReceived({} as never, ev('/别的 a') as never, 'command', 'any', '测试', '/')
    expect(miss).toBeNull()
  })

  it('at_me：只看是不是 @，不解析参数', async () => {
    const hit = await messageReceived(
      {} as never,
      ev('hello', { is_tome: () => true }) as never,
      'at_me',
    )
    expect(hit?.raw_message).toBe('hello')
    expect(hit?.args).toEqual([])
    const miss = await messageReceived({} as never, ev('hello') as never, 'at_me')
    expect(miss).toBeNull()
  })

  it('keyword / regex 各自命中', async () => {
    const kw = await messageReceived({} as never, ev('签到一下') as never, 'keyword', 'any', '', '/', '["签到"]')
    expect(kw).not.toBeNull()
    const re = await messageReceived({} as never, ev('伤害 7 点') as never, 'regex', 'any', '', '/', null, '伤害 (\\d+) 点')
    expect(re?.groups).toEqual(['7'])
  })

  it('message_type 过滤先于匹配：私聊发指令不会命中群过滤器', async () => {
    const r = await messageReceived(
      {} as never,
      ev('/测试', { message_type: 'private' }) as never,
      'command',
      'group',
      '测试',
      '/',
    )
    expect(r).toBeNull()
  })

  it('未知 match 模式 → null（明确拒绝，不默认全放行）', async () => {
    expect(await messageReceived({} as never, ev('x') as never, 'whatever')).toBeNull()
  })

  it('取文本时抛异常 → null，不把异常抛进流程链', async () => {
    const bad = {
      message_type: 'group',
      get_message: () => {
        throw new Error('boom')
      },
    }
    expect(await messageReceived({} as never, bad as never, 'any')).toBeNull()
  })
})
