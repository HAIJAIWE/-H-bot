// tests/main/services/onebot-translator.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 每个测试文件独立临时基目录，避免与其他测试/历史运行共享 /test/* 硬编码路径导致文件锁竞争
const TEST_BASE = mkdtempSync(join(tmpdir(), 'qqbat-onebot-'))

// 使用 vi.hoisted 提升共享状态，确保 mock 工厂和测试代码都能访问
const { wssInstances } = vi.hoisted(() => ({
  // 跟踪所有创建的 WebSocketServer 实例（按端口索引），用于断言多实例隔离
  wssInstances: new Map<
    number,
    {
      port: number
      on: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      /** 触发已注册的事件处理器（模拟真实 WebSocketServer 的事件） */
      emit: (event: string, ...args: unknown[]) => void
    }
  >()
}))

// mock ws 模块，避免实际启动 WebSocket 服务器
// 注意：vitest 4.x 要求 new 调用的 mock 实现必须使用 function 或 class 声明
vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(function (opts: { port: number }) {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    const instance = {
      port: opts.port,
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? []
        list.push(cb)
        handlers.set(event, list)
      }),
      close: vi.fn(),
      emit: (event: string, ...args: unknown[]) => {
        for (const cb of handlers.get(event) ?? []) cb(...args)
      }
    }
    wssInstances.set(opts.port, instance)
    // 模拟真实 WebSocketServer：绑定成功后异步发出 'listening'。
    // 生产代码会 await 该事件来确认端口真的绑定成功（EADDRINUSE 是异步错误）。
    setImmediate(() => instance.emit('listening'))
    return instance
  }),
  WebSocket: { OPEN: 1, CLOSED: 3, CLOSING: 2, CONNECTING: 0 }
}))

// mock net 模块：返回会正确回调 listen/close 的假 server，
// 让 portFinder.isPortFree 能正常判定（测试里不需要真实绑定端口）
vi.mock('net', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('net')
  return {
    ...actual,
    createServer: vi.fn(() => {
      const server = {
        on: () => server,
        once: () => server,
        listen: (_port?: number, hostOrCb?: unknown, cb?: () => void) => {
          const done = typeof hostOrCb === 'function' ? (hostOrCb as () => void) : cb
          if (done) setImmediate(done)
          return server
        },
        close: (cb?: () => void) => {
          if (cb) setImmediate(cb)
          return server
        }
      }
      return server
    })
  }
})

// mock 文件系统操作，避免读写真实文件（保留原始模块其余导出）
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('fs')
  return {
    ...actual,
    readFileSync: vi.fn(() => JSON.stringify({ nextUid: 10000, mapping: {} })),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    copyFileSync: vi.fn(),
    statSync: vi.fn(() => ({ isFile: () => false }) as unknown as ReturnType<typeof import('fs').statSync>)
  }
})

// mock fs/promises 异步写入（writeWithRetry 走 fs/promises），避免真实异步 IO 造成文件锁竞争
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('fs/promises')
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(JSON.stringify({ nextUid: 10000, mapping: {} })),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined)
  }
})

// mock official 模块：只替换「会连网络/订阅」的函数，纯函数（parseOfficialEvent /
// mediaFileTypeOf 等）保留真实实现 —— 否则测试测的是 mock，不是真解析。
vi.mock('@main/services/official', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@main/services/official')
  return {
    ...actual,
    onOfficialMessage: vi.fn(() => vi.fn()),
    onOfficialStatusChange: vi.fn(() => vi.fn()),
    sendOfficialMessage: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'test' } })),
    // 富媒体发送：segmentTranslator 会先按类型翻译再走这里
    sendOfficialMedia: vi.fn(() =>
      Promise.resolve({ ok: true, data: { id: 'media_test', timestamp: 1, refIdx: 'REFIDX_media' } })
    ),
    // 流式消息：仅单聊的独立端点，逐片调用
    sendOfficialStreamMessage: vi.fn(() =>
      Promise.resolve({ ok: true, data: { id: 'stream_test', timestamp: 1, refIdx: '' } })
    ),
    recallOfficialMessage: vi.fn(() => Promise.resolve(true)),
    // 互动回执：真实实现会发 HTTPS 请求，测试里必须替换
    answerInteraction: vi.fn(() => Promise.resolve({ ok: true })),
    // QQ 群管理：同样会发 HTTPS 请求
    setGroupMemberMute: vi.fn(() => Promise.resolve({ ok: true })),
    removeGroupMembers: vi.fn(() => Promise.resolve({ ok: true })),
    getGroupInfo: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          group_name: '读书分享会',
          group_finger_memo: '每周共读一本好书',
          group_member_num: 256,
        },
      })
    ),
    getGroupMembers: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          members: [
            { member_openid: 'mem_a', username: '甲', member_role: 'member', bot: false },
            { member_openid: 'mem_b', username: '乙', member_role: 'admin', bot: false },
          ],
          next_cursor: 'cursor_2',
        },
      })
    ),
    approveGroupJoinRequest: vi.fn(() => Promise.resolve({ ok: true })),
    // 非频道：群成员信息 / 群内状态 / 黑名单 / 自动审批策略 / 分享链接 / 机器人自身
    getGroupMemberInfo: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          member_openid: 'mem_a',
          username: '小明',
          member_role: 'admin',
          bot: false,
          joined_at: '2025-08-20T09:15:00+08:00',
          union_openid: 'U1',
        },
      })
    ),
    getGroupBotState: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          member_openid: 'bot_openid',
          joined_at: '2025-06-15T14:30:00+08:00',
          allow_proactive_msg: false,
          recv_msg_setting: 'only_mention',
          member_role: 'admin',
        },
      })
    ),
    listGroupBlacklist: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          users: [
            {
              member_openid: 'bl_a',
              username: '捣乱的',
              banned_at: '2025-07-01T10:30:00+08:00',
              bot: false,
              union_openid: 'UB1',
            },
          ],
          next_cursor: 'bl_cursor_2',
        },
      })
    ),
    updateGroupBlacklist: vi.fn(() => Promise.resolve({ ok: true, data: { fail_openids: [] } })),
    listJoinApprovalStrategies: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          strategies: [
            {
              strategy_id: 'st_d83eca11e9',
              group_ids: [10001],
              whitelist_user_count: 2,
              is_enable: 'on',
              expire_at: '2027-08-05T15:30:16+08:00',
            },
          ],
          next_cursor: '',
        },
      })
    ),
    createJoinApprovalStrategy: vi.fn(() =>
      Promise.resolve({ ok: true, data: { strategy_id: 'st_new', is_enable: 'on' } })
    ),
    updateJoinApprovalStrategy: vi.fn(() =>
      Promise.resolve({ ok: true, data: { is_enable: 'off', expire_at: '' } })
    ),
    deleteJoinApprovalStrategy: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    executeJoinApprovalStrategy: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    updateStrategyWhitelist: vi.fn(() =>
      Promise.resolve({ ok: true, data: { strategy_id: 'st_new', whitelist_user_count: 2 } })
    ),
    generateUrlLink: vi.fn(() =>
      Promise.resolve({ ok: true, data: { data: { url: 'https://qun.qq.com/qunpro/robot/x' } } })
    ),
    getBotSelf: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: { id: '123', username: '游戏机器人', avatar: 'https://a.png', share_url: 'https://s' },
      })
    ),
    // 入群申请列表：官方**真实字段名是 `list`**（不是 join_requests）。
    // 这里刻意按真实响应形状给数据，用来锁住那条"字段名写错 → 恒为空数组"的回归。
    listGroupJoinRequests: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          list: [
            {
              join_request_id: 'jr_1',
              member_openid: 'mem_a',
              username: '申请人甲',
              apply_at: '2026-07-22T10:00:00+08:00',
              apply_source: 'search',
              verify_info: { verify_message: '我是群友' },
            },
          ],
          next_cursor: 'cursor_jr_2',
        },
      })
    ),
    getGroupMuteState: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          global_rule: { mode: 'always', schedule_rules: [], recurring_rules: [] },
          members: [
            { member_openid: 'mem_a', username: '甲', mute_expire_at: '2026-08-05T11:23:04+08:00' },
          ],
        },
      })
    ),
    // 纯函数：真实实现对规则求值（有专门的 officialMuteState.test.ts 覆盖）。
    // 这里只保留最小忠实替身，用来验证翻译器确实把 global_rule 交给了它。
    isGroupMutedNow: vi.fn((rule: { mode?: string } | null) => rule?.mode === 'always'),
    // 自定义菜单 / 指令面板
    getMenu: vi.fn(() => Promise.resolve({ ok: true, data: { version: 7 } })),
    setMenu: vi.fn(() => Promise.resolve({ ok: true, data: { version: 8 } })),
    listPanels: vi.fn(() => Promise.resolve({ ok: true, data: { panels: [] } })),
    createPanel: vi.fn(() => Promise.resolve({ ok: true, data: { panel_id: 'p_new' } })),
    getPanel: vi.fn(() => Promise.resolve({ ok: true, data: { panel_id: 'p_1' } })),
    updatePanel: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    deletePanel: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    setPanelTarget: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    // QQ 频道专属能力
    listGuildChannels: vi.fn(() => Promise.resolve({ ok: true, data: [{ id: 'C1' }] })),
    createGuildChannel: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'C_NEW' } })),
    getGuildChannel: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'C1' } })),
    updateGuildChannel: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    deleteGuildChannel: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    createChannelAnnounce: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    deleteChannelAnnounce: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    addChannelPin: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    listChannelPins: vi.fn(() => Promise.resolve({ ok: true, data: { message_ids: [] } })),
    removeChannelPin: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    addChannelReaction: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    removeChannelReaction: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    listChannelReactionUsers: vi.fn(() => Promise.resolve({ ok: true, data: { users: [] } }))
  }
})

// mock runtimeEvents 模块，避免 emitSystemLog 依赖 electron 环境
vi.mock('@main/services/runtimeEvents', () => ({
  emitSystemLog: vi.fn()
}))

// 在所有 mock 之后导入被测模块
import {
  findFreePort,
  resolveTranslatorPort,
  resolveUsableTranslatorPort,
  TRANSLATOR_PORT_BASE,
  startTranslator,
  stopTranslator,
  getTranslatorStatus,
  UNSUPPORTED_ACTIONS
} from '@main/services/onebot-translator'
import {
  sendOfficialMessage,
  sendOfficialMedia,
  sendOfficialStreamMessage,
  recallOfficialMessage,
  answerInteraction,
  setGroupMemberMute,
  removeGroupMembers,
  getGroupInfo,
  getGroupMembers,
  approveGroupJoinRequest,
  getGroupMuteState,
  listGroupJoinRequests,
  getGroupMemberInfo,
  getGroupBotState,
  listGroupBlacklist,
  updateGroupBlacklist,
  listJoinApprovalStrategies,
  createJoinApprovalStrategy,
  updateStrategyWhitelist,
  generateUrlLink,
  getMenu,
  setMenu,
  listPanels,
  createPanel,
  updatePanel,
  deletePanel,
  setPanelTarget,
  createGuildChannel,
  addChannelReaction,
  removeChannelPin,
  createChannelAnnounce,
  listGuildChannels,
  onOfficialMessage
} from '@main/services/official'

/** 把官方事件回调（onOfficialMessage 注册的那个）取出来，用于模拟官方推送事件 */
function latestOfficialMessageCb(): (
  path: string,
  message: { type: string; data: Record<string, unknown> }
) => void {
  const calls = vi.mocked(onOfficialMessage).mock.calls
  return calls[calls.length - 1][0] as (
    path: string,
    message: { type: string; data: Record<string, unknown> }
  ) => void
}

/**
 * 先造一条群消息事件，建立 `group_openid_xyz` / `member_openid_1` 的 UID 映射，
 * 再连上 mock 客户端。所有需要 group_id/user_id 的群接口测试都靠它。
 *
 * 放在模块作用域（而不是某个 describe 内）是因为它被多个 describe 复用 ——
 * 放在 describe 里就变成私有函数，别的 describe 用不了（踩过：新加的用例直接 ReferenceError）。
 */
async function seedGroupMapping(project: string, port: number) {
  latestOfficialMessageCb()(project, {
    type: 'GROUP_AT_MESSAGE_CREATE',
    data: {
      id: 'event_seed',
      group_openid: 'group_openid_xyz',
      author: { member_openid: 'member_openid_1' },
      content: 'hi',
      msg_seq: 1,
    },
  })
  return connectMockClient(port)
}

beforeEach(() => {
  vi.clearAllMocks()
  wssInstances.clear()
})

afterEach(() => {
  // 清理所有翻译器实例，避免模块级 Map 状态泄漏到下一个测试
  stopTranslator()
})

afterAll(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
})

describe('resolveTranslatorPort（项目端口分配规则）', () => {
  // 回归：端口缺失时旧实现回退 findFreePort(8080)，而 8080 常被第三方软件
  // 占用（实测 Steam web helper）→ 运行时连到别人的服务并反复 404
  it('优先使用已保存的 translatorPort', () => {
    expect(resolveTranslatorPort({ translatorPort: 2001, portBlock: 1 })).toBe(2001)
  })

  it('无 translatorPort 时由 portBlock 推导（1000 + block）', () => {
    expect(resolveTranslatorPort({ portBlock: 3 })).toBe(1003)
  })

  it('两者都缺失时返回默认基准端口（而不是 8080）', () => {
    expect(resolveTranslatorPort({})).toBe(TRANSLATOR_PORT_BASE)
    expect(resolveTranslatorPort(null)).toBe(TRANSLATOR_PORT_BASE)
    expect(resolveTranslatorPort(undefined)).not.toBe(8080)
  })

  it('忽略非法值（0 / 负数 / 非整数）', () => {
    expect(resolveTranslatorPort({ translatorPort: 0, portBlock: 2 })).toBe(1002)
    expect(resolveTranslatorPort({ translatorPort: -1 })).toBe(TRANSLATOR_PORT_BASE)
    expect(resolveTranslatorPort({ portBlock: 1.5 })).toBe(TRANSLATOR_PORT_BASE)
  })
})

describe('resolveUsableTranslatorPort（端口复用）', () => {
  it('该项目已有翻译器时复用其端口，不另起实例', async () => {
    await startTranslator(`${TEST_BASE}/reuseA`, 8090, 0)

    // 即便配置里写的是别的端口，也应复用已运行实例的端口
    const port = await resolveUsableTranslatorPort({ translatorPort: 8091 }, `${TEST_BASE}/reuseA`)
    expect(port).toBe(8090)
    expect(wssInstances.size).toBe(1)
  })

  it('没有已运行实例时按配置解析端口', async () => {
    const port = await resolveUsableTranslatorPort({ translatorPort: 8092 }, `${TEST_BASE}/reuseB`)
    expect(port).toBe(8092)
  })
})

describe('findFreePort', () => {
  it('返回的端口在 8080-8180 范围内', async () => {
    const port = await findFreePort(8080)
    expect(port).toBeGreaterThanOrEqual(8080)
    expect(port).toBeLessThan(8180)
  })

  it('不返回已被翻译器占用的端口', async () => {
    // 先在 8080 端口启动翻译器，占用该端口
    await startTranslator(`${TEST_BASE}/projA`, 8080, 0)
    expect(wssInstances.has(8080)).toBe(true)

    // findFreePort 应跳过 8080，返回其他端口
    const port = await findFreePort(8080)
    expect(port).not.toBe(8080)
    expect(port).toBeGreaterThanOrEqual(8080)
    expect(port).toBeLessThan(8180)
  })
})

describe('getTranslatorStatus', () => {
  it('无翻译器时返回 { running: false, clients: 0, port: 0 }', () => {
    const status = getTranslatorStatus()
    expect(status).toMatchObject({ running: false, clients: 0, port: 0 })
  })

  it('指定端口查询不存在时返回正确状态', () => {
    const status = getTranslatorStatus(9999)
    expect(status).toMatchObject({ running: false, clients: 0, port: 9999 })
  })
})

describe('多实例隔离', () => {
  it('两个不同端口的翻译器可以独立存在', async () => {
    // 启动两个不同端口的翻译器
    await startTranslator(`${TEST_BASE}/projA`, 8080, 0)
    await startTranslator(`${TEST_BASE}/projB`, 8081, 0)

    // 两个翻译器都应处于运行状态，且端口独立
    const statusA = getTranslatorStatus(8080)
    const statusB = getTranslatorStatus(8081)

    expect(statusA).toMatchObject({ running: true, clients: 0, port: 8080 })
    expect(statusB).toMatchObject({ running: true, clients: 0, port: 8081 })

    // 验证两个 WebSocketServer 实例分别创建于不同端口
    expect(wssInstances.has(8080)).toBe(true)
    expect(wssInstances.has(8081)).toBe(true)
    expect(wssInstances.size).toBe(2)
  })
})

describe('stopTranslator', () => {
  it('不传参数时停止所有翻译器', async () => {
    await startTranslator(`${TEST_BASE}/projA`, 8080, 0)
    await startTranslator(`${TEST_BASE}/projB`, 8081, 0)

    // 确认两个翻译器都在运行
    expect(getTranslatorStatus(8080).running).toBe(true)
    expect(getTranslatorStatus(8081).running).toBe(true)

    // 不传参数，停止所有
    stopTranslator()

    expect(getTranslatorStatus(8080).running).toBe(false)
    expect(getTranslatorStatus(8081).running).toBe(false)
    expect(getTranslatorStatus().running).toBe(false)
  })

  it('传 projectPath 时只停止对应项目的翻译器', async () => {
    await startTranslator(`${TEST_BASE}/projA`, 8080, 0)
    await startTranslator(`${TEST_BASE}/projB`, 8081, 0)

    // 只停止 projA 的翻译器
    stopTranslator(`${TEST_BASE}/projA`)

    // projA 已停止
    expect(getTranslatorStatus(8080).running).toBe(false)
    // projB 仍在运行
    expect(getTranslatorStatus(8081).running).toBe(true)
    expect(getTranslatorStatus(8081)).toMatchObject({ running: true, clients: 0, port: 8081 })
  })
})

// ── send_keyboard_msg action 测试 ──
// 由于 OneBotTranslator 类未导出且 handleAction 为 private，
// 通过模拟 WebSocket 连接流程触发 handleAction 来测试

/** 创建并连接一个 mock WebSocket 客户端，返回 ws 及触发消息的辅助函数 */
function connectMockClient(port: number): {
  ws: {
    readyState: number
    on: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    removeAllListeners: ReturnType<typeof vi.fn>
    bufferedAmount: number
  }
  triggerMessage: (msg: Record<string, unknown>) => Promise<void>
} {
  const wss = wssInstances.get(port)!
  // 获取 'connection' 事件回调
  const connCb = wss.on.mock.calls.find((c: unknown[]) => c[0] === 'connection')![1] as (ws: unknown) => void
  const ws = {
    readyState: 1, // WebSocket.OPEN
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(),
    bufferedAmount: 0
  }
  connCb(ws)
  return {
    ws,
    triggerMessage: async (msg: Record<string, unknown>) => {
      // 获取 'message' 事件回调
      const msgCb = ws.on.mock.calls.find((c: unknown[]) => c[0] === 'message')![1] as (raw: { toString: () => string }) => void
      msgCb({ toString: () => JSON.stringify(msg) })
      // 等待 async handleAction 完成（sendOfficialMessage 是异步调用）
      await new Promise(r => setTimeout(r, 10))
    }
  }
}

describe('send_keyboard_msg action', () => {
  it('群消息传入 msgType=2 + markdown + keyboard', async () => {
    const PROJECT = `${TEST_BASE}/keyboard1`
    await startTranslator(PROJECT, 8090, 0)

    const { ws, triggerMessage } = connectMockClient(8090)

    await triggerMessage({
      action: 'send_keyboard_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        markdown: '## 标题',
        keyboard: { rows: [{ buttons: [{ id: 'btn1', label: '按钮' }] }] },
        msg_id: 'm1'
      },
      echo: 'echo1'
    })

    // 断言 sendOfficialMessage 被调用，参数包含 msgType=2, markdown, keyboard, msgId
    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'group',
      '100', // getOpenidByUid(100) 返回 undefined，回退为 String(100)
      '',
      expect.objectContaining({
        msgType: 2,
        markdown: { content: '## 标题' },
        keyboard: { rows: [{ buttons: [{ id: 'btn1', label: '按钮' }] }] },
        msgId: 'm1'
      })
    )

    // 断言 sendResponse 被调用（ws.send 最后一次是响应）
    const lastSendCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string
    const response = JSON.parse(lastSendCall)
    expect(response).toMatchObject({
      status: 'ok',
      retcode: 0,
      data: { message_id: 'test' },
      echo: 'echo1'
    })
  })

  it('私聊消息传入 chatType=c2c', async () => {
    const PROJECT = `${TEST_BASE}/keyboard2`
    await startTranslator(PROJECT, 8091, 0)

    const { triggerMessage } = connectMockClient(8091)

    await triggerMessage({
      action: 'send_keyboard_msg',
      params: {
        message_type: 'private',
        user_id: 200,
        markdown: '私聊内容',
        keyboard: { rows: [] }
      },
      echo: 'echo2'
    })
    // 断言 chatType='c2c'
    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'c2c',
      '200', // String(200)
      '',
      expect.objectContaining({
        msgType: 2,
        markdown: { content: '私聊内容' },
        keyboard: { rows: [] }
      })
    )
  })

  it('从 ctx 获取 eventId 和 msgSeq', async () => {
    const PROJECT = `${TEST_BASE}/keyboard3`
    await startTranslator(PROJECT, 8092, 0)

    // 通过 onOfficialMessage 回调模拟收到群@消息，建立 ctx
    // 此时无客户端连接，broadcast 为空操作
    const onMsgCb = vi.mocked(onOfficialMessage).mock.calls[0][0] as (
      path: string,
      message: { type: string; data: Record<string, unknown> }
    ) => void
    onMsgCb(PROJECT, {
      type: 'GROUP_AT_MESSAGE_CREATE',
      data: {
        id: 'event_abc',
        group_openid: 'group_openid_xyz',
        author: { member_openid: 'member_openid_1' },
        content: 'hello',
        msg_seq: 5
      }
    })

    // 处理 GROUP_AT_MESSAGE_CREATE 时会创建两个 uid：
    //   member_openid_1 → 10000, group_openid_xyz → 10001
    // ctx 以 group_openid 为 key：ctx.set('group_openid_xyz', { eventId, msgSeq: 5, ... })

    const { triggerMessage } = connectMockClient(8092)

    await triggerMessage({
      action: 'send_keyboard_msg',
      params: {
        message_type: 'group',
        group_id: 10001, // 对应 group_openid_xyz
        markdown: '回复',
        keyboard: { rows: [] }
        // 不传 msg_id，测试从 ctx 获取
      },
      echo: 'echo3'
    })

    // 断言从 ctx 获取了 eventId、msgId、msgSeq
    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'group',
      'group_openid_xyz',
      '',
      expect.objectContaining({
        msgType: 2,
        markdown: { content: '回复' },
        keyboard: { rows: [] },
        eventId: 'event_abc',
        msgId: 'event_abc', // 从 ctx 获取（未传 msg_id）
        msgSeq: 5
      })
    )
  })

  // 「Markdown 文本」模式（message_send mode='markdown'）不带按钮时的发送路径
  it('不带 keyboard 时只发 markdown（msgType=2 且不传 keyboard 字段）', async () => {
    const PROJECT = `${TEST_BASE}/keyboard4`
    await startTranslator(PROJECT, 8093, 0)

    const { triggerMessage } = connectMockClient(8093)

    await triggerMessage({
      action: 'send_keyboard_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        markdown: '# 只有排版，没有按钮'
        // 不传 keyboard
      },
      echo: 'echo4'
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts).toMatchObject({
      msgType: 2,
      markdown: { content: '# 只有排版，没有按钮' }
    })
    // 关键：空 keyboard 会让官方 API 渲染不出按钮，必须整个字段都不带
    expect(opts.keyboard).toBeUndefined()
  })
})

// ── delete_msg action 测试 ──
// 验证 delete_msg 桥接到 recallOfficialMessage，并依赖 messageIdToContext 映射

describe('delete_msg action', () => {
  it('先发送消息后撤回：recallOfficialMessage 被调用，参数正确', async () => {
    const PROJECT = `${TEST_BASE}/delete1`
    await startTranslator(PROJECT, 8100, 0)
    const { ws, triggerMessage } = connectMockClient(8100)

    // 1. 先发送一条群消息，触发 messageIdToContext.set('test', { group, openid })
    await triggerMessage({
      action: 'send_group_msg',
      params: {
        group_id: 300,
        message: '待撤回的消息'
      },
      echo: 'send-echo'
    })

    // sendOfficialMessage mock 返回 { id: 'test' }，应已写入映射
    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalled()

    // 2. 调用 delete_msg 撤回该消息
    await triggerMessage({
      action: 'delete_msg',
      params: {
        message_id: 'test'
      },
      echo: 'delete-echo'
    })

    // 断言 recallOfficialMessage 被调用，参数为 (PROJECT, 'group', '300', 'test')
    // 注意：send_group_msg 用 openid=String(params.group_id||'')='300'
    expect(vi.mocked(recallOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'group',
      '300',
      'test'
    )

    // 断言响应成功
    const lastSendCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string
    const response = JSON.parse(lastSendCall)
    expect(response).toMatchObject({
      status: 'ok',
      retcode: 0,
      data: {},
      echo: 'delete-echo'
    })
  })

  it('撤回不存在的 message_id 返回错误', async () => {
    const PROJECT = `${TEST_BASE}/delete2`
    await startTranslator(PROJECT, 8101, 0)
    const { ws, triggerMessage } = connectMockClient(8101)

    await triggerMessage({
      action: 'delete_msg',
      params: {
        message_id: 'non-existent-id'
      },
      echo: 'delete-echo-2'
    })

    // 不应调用 recallOfficialMessage
    expect(vi.mocked(recallOfficialMessage)).not.toHaveBeenCalled()

    // 应返回错误响应
    const lastSendCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string
    const response = JSON.parse(lastSendCall)
    expect(response.status).toBe('failed')
    expect(response.retcode).toBe(100)
    expect(response.echo).toBe('delete-echo-2')
  })

  it('撤回缺少 message_id 参数返回错误', async () => {
    const PROJECT = `${TEST_BASE}/delete3`
    await startTranslator(PROJECT, 8102, 0)
    const { ws, triggerMessage } = connectMockClient(8102)

    await triggerMessage({
      action: 'delete_msg',
      params: {},
      echo: 'delete-echo-3'
    })

    expect(vi.mocked(recallOfficialMessage)).not.toHaveBeenCalled()

    const lastSendCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string
    const response = JSON.parse(lastSendCall)
    expect(response.status).toBe('failed')
    expect(response.echo).toBe('delete-echo-3')
  })
})

// ── default 分支测试 ──
// 验证未知 action 不再静默成功，而是返回错误

describe('default 分支（未知 action）', () => {
  it('未知 action 返回 failed 状态而非空对象', async () => {
    const PROJECT = `${TEST_BASE}/default1`
    await startTranslator(PROJECT, 8110, 0)
    const { ws, triggerMessage } = connectMockClient(8110)

    await triggerMessage({
      action: 'set_group_card',  // 官方 API 没有「设置群名片」能力
      params: { group_id: 100, user_id: 200, card: 'x' },
      echo: 'unknown-echo'
    })

    const lastSendCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string
    const response = JSON.parse(lastSendCall)
    expect(response.status).toBe('failed')
    expect(response.retcode).toBe(100)
    expect(response.echo).toBe('unknown-echo')
    // 错误消息应包含不支持的 action 名称
    expect(String(response.msg || response.message || '')).toContain('set_group_card')
  })

  it('曾经「尚未接入」的能力已全部实现：拒绝表里不该再留「尚未接入」条目', async () => {
    // 这条测试是**类别闸门**：`UNSUPPORTED_ACTIONS` 只应装「官方根本没有」的能力。
    // 一旦有人把"官方有、只是我们没接"写进去，说明有活儿没干完 —— 直接红。
    const pending = Object.entries(UNSUPPORTED_ACTIONS).filter(([, reason]) =>
      String(reason).includes('尚未接入'),
    );
    expect(pending.map(([a]) => a)).toEqual([]);

    // 曾经挂在这一类里的 get_group_member_info，现在真的进了实现分支：
    // 没有 openid 映射时应该是「找不到群」，而不是「不支持的 action」。
    const PROJECT = `${TEST_BASE}/default2`
    await startTranslator(PROJECT, 8111, 0)
    const { ws, triggerMessage } = connectMockClient(8111)

    await triggerMessage({
      action: 'get_group_member_info',
      params: { group_id: 100, user_id: 200 },
      echo: 'now-implemented',
    })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    const msg = String(response.msg || response.message || '')
    expect(msg).not.toContain('不支持的 action')
    expect(msg).toContain('找不到群')
  })

  it('官方根本没有的能力：明说没有，不引导用户继续排查', async () => {
    const PROJECT = `${TEST_BASE}/default3`
    await startTranslator(PROJECT, 8112, 0)
    const { ws, triggerMessage } = connectMockClient(8112)

    await triggerMessage({
      action: 'set_group_card',
      params: { group_id: 100, user_id: 200, card: 'x' },
      echo: 'no-such-api',
    })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    const msg = String(response.msg || response.message || '')
    expect(msg).toContain('没有')
    // 不能提示「尚未接入」，否则用户会一直等这个能力
    expect(msg).not.toContain('尚未接入')
  })

  it('完全未知的 action：列出当前可用集合', async () => {
    const PROJECT = `${TEST_BASE}/default4`
    await startTranslator(PROJECT, 8113, 0)
    const { ws, triggerMessage } = connectMockClient(8113)

    await triggerMessage({ action: 'totally_made_up', params: {}, echo: 'bogus' })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    const msg = String(response.msg || response.message || '')
    expect(msg).toContain('totally_made_up')
    expect(msg).toContain('answer_interaction')
  })
})

// ── 按钮消息的降级路径：send_msg + markdown/keyboard 消息段 ──
//
// 回归（实测静默失败）：生产端曾把 keyboard 用 JSON.stringify 塞进消息段，
// 消费端却当对象用，最终 `'id' in keyboard` 抛 TypeError，导致路径 2 整条失效、
// 节点静默退回纯文本。这里同时覆盖「对象」与「JSON 字符串」两种来源。
describe('send_msg + markdown/keyboard 消息段（按钮降级路径）', () => {
  const keyboardObject = { rows: [{ buttons: [{ id: 'attack', label: '攻击' }] }] }

  it('消息段携带对象时，路由到 keyboard API 并原样传递', async () => {
    const PROJECT = `${TEST_BASE}/kbdseg1`
    await startTranslator(PROJECT, 8111, 0)
    const { triggerMessage } = connectMockClient(8111)

    await triggerMessage({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        message: [
          { type: 'markdown', data: { content: '## 战斗' } },
          { type: 'keyboard', data: { content: keyboardObject } },
        ],
      },
      echo: 'kbd-object',
    })

    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'group',
      '100',
      '',
      expect.objectContaining({
        msgType: 2,
        markdown: { content: '## 战斗' },
        keyboard: keyboardObject,
      })
    )
  })

  it('消息段携带 JSON 字符串时也能解析为对象（不再抛 TypeError）', async () => {
    const PROJECT = `${TEST_BASE}/kbdseg2`
    await startTranslator(PROJECT, 8112, 0)
    const { triggerMessage } = connectMockClient(8112)

    await triggerMessage({
      action: 'send_msg',
      params: {
        message_type: 'private',
        user_id: 300,
        message: [
          { type: 'markdown', data: { content: '## 战斗' } },
          { type: 'keyboard', data: { content: JSON.stringify(keyboardObject) } },
        ],
      },
      echo: 'kbd-string',
    })

    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'c2c',
      '300',
      '',
      expect.objectContaining({
        msgType: 2,
        keyboard: keyboardObject,
      })
    )
  })

  // 「Markdown 文本」模式的降级路径：只有 markdown 段，没有 keyboard 段
  it('只有 markdown 段（无 keyboard）时也路由到 markdown API，且不传 keyboard', async () => {
    const PROJECT = `${TEST_BASE}/kbdseg3`
    await startTranslator(PROJECT, 8113, 0)
    const { triggerMessage } = connectMockClient(8113)

    await triggerMessage({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        message: [{ type: 'markdown', data: { content: '# 只有排版' } }],
      },
      echo: 'md-only',
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts).toMatchObject({
      msgType: 2,
      markdown: { content: '# 只有排版' },
    })
    expect(opts.keyboard).toBeUndefined()
  })
})

// ── send_msg 的目标解析 ─
// 回归（真机实测）：运行时的「回复当前会话」以前只发 `send_msg {message}`，不带目标 →
// 这里 uid=0 → openid 回退成 '0' → 官方 API 400「请求的资源不存在(用户/群已注销)」，
// 把所有"用户不存在"的锅甩给账号，实际是自己没带目标。
describe('send_msg action 的目标解析', () => {
  it('带 user_id 时用 UID→openid 映射回查真实 openid', async () => {
    const PROJECT = `${TEST_BASE}/sendmsg1`
    await startTranslator(PROJECT, 8120, 0)

    // 建映射：收到一条 C2C 消息 → user_openid 对应 UID 10000（第一个分配的 uid）
    const onMsgCb = vi.mocked(onOfficialMessage).mock.calls[0][0] as (
      path: string,
      message: { type: string; data: Record<string, unknown> }
    ) => void
    onMsgCb(PROJECT, {
      type: 'C2C_MESSAGE_CREATE',
      data: {
        id: 'event_c2c_1',
        author: { user_openid: 'user_openid_abc' },
        content: '/签到',
      },
    })

    const { ws, triggerMessage } = connectMockClient(8120)
    await triggerMessage({
      action: 'send_msg',
      params: { message_type: 'private', user_id: 10000, message: '✅ 签到成功！' },
      echo: 'send-c2c',
    })

    // openid 必须是映射回来的真实 openid，而不是 UID 本身（更不是 0）
    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'c2c',
      'user_openid_abc',
      '✅ 签到成功！',
      expect.objectContaining({ eventId: 'event_c2c_1', msgId: 'event_c2c_1', msgSeq: 1 })
    )
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response).toMatchObject({ status: 'ok', retcode: 0, echo: 'send-c2c' })
  })

  it('不带目标时明确报错，不再拿 openid=0 去发', async () => {
    const PROJECT = `${TEST_BASE}/sendmsg2`
    await startTranslator(PROJECT, 8121, 0)
    const { ws, triggerMessage } = connectMockClient(8121)

    await triggerMessage({
      action: 'send_msg',
      params: { message: '没有目标的回复' },
      echo: 'send-untargeted',
    })

    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('缺少目标')
  })
})

// ── 消息段翻译路径（BUG1 回归）──
//
// 回归（静默失效）：三条 send action 以前各自走 `extractText`，而它**只认 text 段**，
// 于是 image / record / face 等段被静默丢弃，最后发出 `content: ''` 的空消息：
// 不报错、不告警、内容是错的。现在必须「能发就发、发不了就明确报错」。
describe('消息段翻译路径（BUG1 回归：非文本段不再静默丢弃）', () => {
  it('image 段走媒体上传（msg_type=7），不再发空消息', async () => {
    const PROJECT = `${TEST_BASE}/seg-img1`
    await startTranslator(PROJECT, 8130, 0)
    const { ws, triggerMessage } = connectMockClient(8130)

    await triggerMessage({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        message: [{ type: 'image', data: { file: 'https://example.com/a.png' } }],
      },
      echo: 'seg-image',
    })

    // 纯图片：没有文本可发，因此不应调用文本发送接口
    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
    expect(vi.mocked(sendOfficialMedia)).toHaveBeenCalledWith(
      PROJECT,
      'group',
      '100',
      'https://example.com/a.png',
      1,
      undefined,
      expect.any(Object)
    )

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response).toMatchObject({ status: 'ok', retcode: 0, echo: 'seg-image' })
    expect(response.data.message_id).toBe('media_test')
  })

  it('文本 + 图片：先发文本（msg_type=0）再上传图片', async () => {
    const PROJECT = `${TEST_BASE}/seg-img2`
    await startTranslator(PROJECT, 8131, 0)
    const { triggerMessage } = connectMockClient(8131)

    await triggerMessage({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        message: [
          { type: 'text', data: { text: '看图' } },
          { type: 'image', data: { file: 'https://example.com/b.png' } },
        ],
      },
      echo: 'seg-text-image',
    })

    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'group',
      '100',
      '看图',
      expect.any(Object)
    )
    expect(vi.mocked(sendOfficialMedia)).toHaveBeenCalledTimes(1)
  })

  it('只有 face 段时明确报错并列出段名（BUG1 回归核心）', async () => {
    const PROJECT = `${TEST_BASE}/seg-face`
    await startTranslator(PROJECT, 8132, 0)
    const { ws, triggerMessage } = connectMockClient(8132)

    await triggerMessage({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: 100,
        message: [{ type: 'face', data: { id: '1' } }],
      },
      echo: 'seg-face',
    })

    // 关键：不再发一条空消息，而是明确失败
    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
    expect(vi.mocked(sendOfficialMedia)).not.toHaveBeenCalled()

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(response.echo).toBe('seg-face')
    expect(JSON.stringify(response)).toContain('face')
  })

  it('不存在的本地路径的 image 段仍明确报错（两类合法来源都不满足）', async () => {
    const PROJECT = `${TEST_BASE}/seg-local`
    await startTranslator(PROJECT, 8133, 0)
    const { ws, triggerMessage } = connectMockClient(8133)

    await triggerMessage({
      action: 'send_private_msg',
      params: {
        user_id: 200,
        // 故意用一个不存在的路径：既不是 http(s) 直链，也不是本机文件
        message: [{ type: 'image', data: { file: 'D:/pics/definitely-missing.png' } }],
      },
      echo: 'seg-local',
    })

    expect(vi.mocked(sendOfficialMedia)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('http(s)')
  })
})

// ── send_media action ──
describe('send_media action', () => {
  it('缺少目标时明确报错', async () => {
    const PROJECT = `${TEST_BASE}/media1`
    await startTranslator(PROJECT, 8140, 0)
    const { ws, triggerMessage } = connectMockClient(8140)

    await triggerMessage({
      action: 'send_media',
      params: { url: 'https://example.com/a.png' },
      echo: 'media-no-target',
    })

    expect(vi.mocked(sendOfficialMedia)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('缺少目标')
  })

  it('本地路径的 url 明确报错', async () => {
    const PROJECT = `${TEST_BASE}/media2`
    await startTranslator(PROJECT, 8141, 0)
    const { ws, triggerMessage } = connectMockClient(8141)

    await triggerMessage({
      action: 'send_media',
      params: { message_type: 'group', group_id: 100, url: 'C:/tmp/a.png' },
      echo: 'media-local',
    })

    expect(vi.mocked(sendOfficialMedia)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('http(s)')
  })

  it('按 media_type 名映射 file_type 并发送成功', async () => {
    const PROJECT = `${TEST_BASE}/media3`
    await startTranslator(PROJECT, 8142, 0)
    const { ws, triggerMessage } = connectMockClient(8142)

    await triggerMessage({
      action: 'send_media',
      params: {
        message_type: 'private',
        user_id: 200,
        url: 'https://example.com/c.mp4',
        media_type: 'video',
      },
      echo: 'media-video',
    })

    expect(vi.mocked(sendOfficialMedia)).toHaveBeenCalledWith(
      PROJECT,
      'c2c',
      '200',
      'https://example.com/c.mp4',
      2,
      '',
      expect.any(Object)
    )
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response).toMatchObject({ status: 'ok', retcode: 0, echo: 'media-video' })
    expect(response.data.message_id).toBe('media_test')
  })
})

// ── 合并转发（BUG2 回归）──
//
// 回归：官方发送侧只有 msg_type 0/2/7，**没有合并转发能力**。
// 以前这两个 action 落进 default 报「不支持的 OneBot action」，
// 用户分不清是自己图配错了还是平台不支持。
describe('合并转发 action（BUG2 回归）', () => {
  it('send_group_forward_msg 明确说明官方不支持，而不是「未知 action」', async () => {
    const PROJECT = `${TEST_BASE}/forward1`
    await startTranslator(PROJECT, 8150, 0)
    const { ws, triggerMessage } = connectMockClient(8150)

    await triggerMessage({
      action: 'send_group_forward_msg',
      params: { group_id: 100, messages: [] },
      echo: 'forward-group',
    })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('合并转发')
  })

  it('send_forward_msg 同样明确说明', async () => {
    const PROJECT = `${TEST_BASE}/forward2`
    await startTranslator(PROJECT, 8151, 0)
    const { ws, triggerMessage } = connectMockClient(8151)

    await triggerMessage({
      action: 'send_forward_msg',
      params: { user_id: 200, messages: [] },
      echo: 'forward-private',
    })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('合并转发')
  })
})

// ── 互动召回（is_wakeup）──
describe('is_wakeup（互动召回）', () => {
  it('is_wakeup=true 时不再带 event_id / msg_id（官方规定互斥）', async () => {
    const PROJECT = `${TEST_BASE}/wakeup1`
    await startTranslator(PROJECT, 8160, 0)

    // 先造一个会话上下文（否则测不出「该带却没带」）
    const onMsgCb = vi.mocked(onOfficialMessage).mock.calls[0][0] as (
      path: string,
      message: { type: string; data: Record<string, unknown> }
    ) => void
    onMsgCb(PROJECT, {
      type: 'C2C_MESSAGE_CREATE',
      data: {
        id: 'event_wakeup',
        author: { user_openid: 'user_openid_w' },
        content: 'hello',
      },
    })

    const { triggerMessage } = connectMockClient(8160)
    await triggerMessage({
      action: 'send_msg',
      params: { message_type: 'private', user_id: 10000, message: '召回', is_wakeup: true },
      echo: 'wakeup',
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.isWakeup).toBe(true)
    expect(opts.eventId).toBeUndefined()
    expect(opts.msgId).toBeUndefined()
  })

  it('群聊忽略 is_wakeup（官方群聊接口没有该字段）', async () => {
    const PROJECT = `${TEST_BASE}/wakeup2`
    await startTranslator(PROJECT, 8161, 0)
    const { triggerMessage } = connectMockClient(8161)

    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 100, message: '群里不召回', is_wakeup: true },
      echo: 'wakeup-group',
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.isWakeup).toBeUndefined()
  })
})

// ── 流式消息（send_stream_msg）──
//
// 官方流式端点只有单聊：`POST /v2/users/{openid}/stream_messages`。
// 节点把整段正文切成多片，每一片都是**一次独立的 action** —— 翻译器只负责
// 「一片 → 一次 API 调用」的翻译，切片策略在节点侧（见 @shared/message/stream）。
describe('send_stream_msg action（流式消息，仅单聊）', () => {
  it('三片依次下发：index / input_state / stream_msg_id 原样交给官方层', async () => {
    const PROJECT = `${TEST_BASE}/stream1`
    await startTranslator(PROJECT, 8170, 0)
    const { ws, triggerMessage } = connectMockClient(8170)

    await triggerMessage({
      action: 'send_stream_msg',
      params: { user_id: 300, content_raw: 'abcd', content_type: 'text', input_state: 1, index: 0 },
      echo: 'stream-0'
    })
    await triggerMessage({
      action: 'send_stream_msg',
      params: {
        user_id: 300,
        content_raw: 'efgh',
        content_type: 'text',
        input_state: 1,
        index: 1,
        stream_msg_id: 'stream_test'
      },
      echo: 'stream-1'
    })
    await triggerMessage({
      action: 'send_stream_msg',
      params: {
        user_id: 300,
        content_raw: '',
        content_type: 'markdown',
        input_state: 10,
        index: 2,
        stream_msg_id: 'stream_test'
      },
      echo: 'stream-2'
    })

    const calls = vi.mocked(sendOfficialStreamMessage).mock.calls
    expect(calls).toHaveLength(3)
    // openid：没有映射时用 uid 兜底（与 send_media 同一规则）
    expect(calls.map((c) => c[1])).toEqual(['300', '300', '300'])
    expect(calls.map((c) => c[2])).toEqual(['abcd', 'efgh', ''])
    expect(calls[0][3]).toMatchObject({ index: 0, inputState: 1, contentType: 'text' })
    // 首片必须不带 stream_msg_id（由服务端生成），后续片带上
    expect(calls[0][3]).not.toHaveProperty('streamMsgId')
    expect(calls[1][3]).toMatchObject({ index: 1, streamMsgId: 'stream_test' })
    expect(calls[2][3]).toMatchObject({ index: 2, inputState: 10, contentType: 'markdown' })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response).toMatchObject({ status: 'ok', retcode: 0, echo: 'stream-2' })
    expect(response.data.message_id).toBe('stream_test')
  })

  it('群聊目标明确报错（官方没有群聊流式端点）', async () => {
    const PROJECT = `${TEST_BASE}/stream2`
    await startTranslator(PROJECT, 8171, 0)
    const { ws, triggerMessage } = connectMockClient(8171)

    await triggerMessage({
      action: 'send_stream_msg',
      params: { message_type: 'group', group_id: 100, content_raw: '你好', index: 0, input_state: 10 },
      echo: 'stream-group'
    })

    expect(vi.mocked(sendOfficialStreamMessage)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('仅支持单聊')
  })

  it('缺 user_id 时明确报错', async () => {
    const PROJECT = `${TEST_BASE}/stream3`
    await startTranslator(PROJECT, 8172, 0)
    const { ws, triggerMessage } = connectMockClient(8172)

    await triggerMessage({
      action: 'send_stream_msg',
      params: { content_raw: '你好', index: 0, input_state: 10 },
      echo: 'stream-no-target'
    })

    expect(vi.mocked(sendOfficialStreamMessage)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('缺少目标')
  })
})

// ── 输入中状态（send_input_notify，官方 msg_type=6）──
//
// 官方契约：`msg_type=6` + `input_notify: {input_type:1, input_second:N}`，
// **仅单聊**（群聊/频道接口没有这个字段），且该消息类型没有内容字段。
describe('send_input_notify action（输入中状态，仅单聊）', () => {
  it('单聊：以 msg_type=6 下发，并把秒数夹到 1~60', async () => {
    const PROJECT = `${TEST_BASE}/input_notify`
    await startTranslator(PROJECT, 8174, 0)
    const { ws, triggerMessage } = connectMockClient(8174)

    await triggerMessage({
      action: 'send_input_notify',
      // 显式给 openid：单聊目标未必有 UID 映射（用户可能还没说过话）
      params: { user_openid: 'u_openid', input_second: 999 },
      echo: 'input-1',
    })

    const call = vi.mocked(sendOfficialMessage).mock.calls.at(-1)
    expect(call?.[1]).toBe('c2c')
    expect(call?.[2]).toBe('u_openid')
    // 第 4 个参数是 content —— 输入中状态**不能带内容**
    expect(call?.[3]).toBe('')
    expect(call?.[4]).toMatchObject({
      msgType: 6,
      inputNotify: { inputSecond: 60 },
    })

    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('ok')
  })

  it('群聊目标明确报错（官方 msg_type=6 只有 C2C）', async () => {
    const PROJECT = `${TEST_BASE}/input_notify_group`
    await startTranslator(PROJECT, 8175, 0)
    const { ws, triggerMessage } = connectMockClient(8175)

    await triggerMessage({
      action: 'send_input_notify',
      params: { message_type: 'group', group_id: 10001, input_second: 10 },
      echo: 'input-group',
    })

    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('只有单聊支持')
  })

  it('没有 openid 映射时明确报错（不把数字当 openid 发出去）', async () => {
    const PROJECT = `${TEST_BASE}/input_notify_noname`
    await startTranslator(PROJECT, 8176, 0)
    const { ws, triggerMessage } = connectMockClient(8176)

    await triggerMessage({
      action: 'send_input_notify',
      params: { user_id: 99999, input_second: 10 },
      echo: 'input-noname',
    })

    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('找不到用户')
  })
})

// ── 接收侧解析（附件 / 卡片 / 引用）──
//
// 回归：`attachments` 解析后被挂在没人消费的 `parsed` 字段上，`ark_data` /
// `msg_elements` / `message_scene` 全仓库零解析 → 用户发来的图片、结构化卡片、
// 引用内容在流程里完全看不到（附件信息在翻译层就被丢了）。
describe('接收侧解析：附件 / 卡片 / 引用', () => {
  /** 取 startTranslator 注册过的官方事件回调 */
  const officialEventCb = () =>
    vi.mocked(onOfficialMessage).mock.calls[0][0] as (
      path: string,
      message: { type: string; data: Record<string, unknown> },
    ) => void

  /** 取最后一次广播出去的事件 JSON */
  const lastEvent = (ws: { send: ReturnType<typeof vi.fn> }): Record<string, unknown> =>
    JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string) as Record<
      string,
      unknown
    >

  it('图片附件合成 image 段，raw_message 保持既有契约', async () => {
    const PROJECT = `${TEST_BASE}/recv1`
    await startTranslator(PROJECT, 8180, 0)
    const { ws } = connectMockClient(8180)

    officialEventCb()(PROJECT, {
      type: 'C2C_MESSAGE_CREATE',
      data: {
        id: 'event_recv1',
        author: { user_openid: 'user_openid_r' },
        content: '看这张图',
        attachments: [
          { content_type: 'image/png', url: 'https://example.com/x.png', filename: 'x.png' },
        ],
      },
    })

    const event = lastEvent(ws)
    expect(event.message).toEqual([
      { type: 'text', data: { text: '看这张图' } },
      expect.objectContaining({ type: 'image', data: expect.objectContaining({ url: 'https://example.com/x.png' }) }),
    ])
    // 附件信息本身也要能看到
    expect(event.attachments).toHaveLength(1)
    // 既有契约：raw_message 仍是去 @ 后的纯文本
    expect(event.raw_message).toBe('看这张图')
    expect(event._ref_idx).toBeUndefined()
  })

  it('语音 / 视频 / 文件按 content_type 映射成对应段类型', async () => {
    const PROJECT = `${TEST_BASE}/recv2`
    await startTranslator(PROJECT, 8181, 0)
    const { ws } = connectMockClient(8181)

    officialEventCb()(PROJECT, {
      type: 'C2C_MESSAGE_CREATE',
      data: {
        id: 'event_recv2',
        author: { user_openid: 'user_openid_r2' },
        content: '',
        attachments: [
          { content_type: 'voice', url: 'https://example.com/a.silk' },
          { content_type: 'video/mp4', url: 'https://example.com/b.mp4' },
          { content_type: 'application/pdf', url: 'https://example.com/c.pdf', filename: 'c.pdf' },
        ],
      },
    })

    const event = lastEvent(ws)
    const types = (event.message as Array<{ type: string }>).map((s) => s.type)
    expect(types).toEqual(['text', 'record', 'video', 'file'])
  })

  it('message_scene 的 msg_idx 变成 _ref_idx（reply_to 可直接引用）', async () => {
    const PROJECT = `${TEST_BASE}/recv3`
    await startTranslator(PROJECT, 8182, 0)
    const { triggerMessage, ws } = connectMockClient(8182)

    officialEventCb()(PROJECT, {
      type: 'GROUP_MESSAGE_CREATE',
      data: {
        id: 'event_recv3',
        group_openid: 'group_recv3',
        author: { member_openid: 'member_recv3' },
        content: '/帮助',
        message_scene: { source: 'msg_idx', ext: ['msg_idx=REFIDX_scene1', 'auth_token=t'] },
      },
    })

    const event = lastEvent(ws)
    expect(event._ref_idx).toBe('REFIDX_scene1')
    expect(event.message_scene).toMatchObject({ refIdx: 'REFIDX_scene1' })

    // 端到端：直接拿 _ref_idx 当 reply_to 用，官方请求里应带上 message_reference
    // （group_openid 是事件里第一个分配 UID 的标识 → 10000）
    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 10000, message: '引用你', reply_to: 'REFIDX_scene1' },
      echo: 'recv-reply',
    })
    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.messageReference).toEqual({ message_id: 'REFIDX_scene1' })
  })

  it('收到的消息的 message_id 也会登记（用户直接填消息 id 也能引用）', async () => {
    const PROJECT = `${TEST_BASE}/recv5`
    await startTranslator(PROJECT, 8184, 0)
    const { triggerMessage, ws } = connectMockClient(8184)

    officialEventCb()(PROJECT, {
      type: 'GROUP_MESSAGE_CREATE',
      data: {
        id: 'event_recv5',
        group_openid: 'group_recv5',
        author: { member_openid: 'member_recv5' },
        content: '/帮助',
        message_scene: { source: 'msg_idx', ext: ['msg_idx=REFIDX_scene5'] },
      },
    })
    // 事件里给出的 OneBot message_id（＝eventId 哈希后的整数），不是 REFIDX
    const mid = String(lastEvent(ws).message_id)
    expect(mid).not.toBe('REFIDX_scene5')

    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 10000, message: '引用你', reply_to: mid },
      echo: 'recv-reply5',
    })
    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.messageReference).toEqual({ message_id: 'REFIDX_scene5' })
  })

  it('ark_data 与 msg_elements 原样挂在事件上', async () => {
    const PROJECT = `${TEST_BASE}/recv4`
    await startTranslator(PROJECT, 8183, 0)
    const { ws } = connectMockClient(8183)

    officialEventCb()(PROJECT, {
      type: 'C2C_MESSAGE_CREATE',
      data: {
        id: 'event_recv4',
        author: { user_openid: 'user_openid_r4' },
        content: '',
        ark_data: { ark_type: '1', ark_name: '卡片', prompt: '提示', fields: { a: '1' } },
        msg_elements: [{ msg_idx: 'REFIDX_nested' }],
      },
    })

    const event = lastEvent(ws)
    expect(event.ark_data).toMatchObject({ arkName: '卡片' })
    expect(event.msg_elements).toEqual([{ msg_idx: 'REFIDX_nested' }])
  })
})

// ── 引用回复（reply_to）──
// 官方引用要 REFIDX（`message_reference`），与 OneBot 的 message_id 不是一回事，
// 所以必须经过映射表；映射不到时**明确报错**，不能悄悄丢掉引用只发正文。
describe('reply_to 引用回复', () => {
  it('直接传 REFIDX_ 开头的标识时原样透传', async () => {
    const PROJECT = `${TEST_BASE}/reply1`
    await startTranslator(PROJECT, 8170, 0)
    const { triggerMessage } = connectMockClient(8170)

    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 100, message: '引用回复', reply_to: 'REFIDX_direct' },
      echo: 'reply-direct',
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.messageReference).toEqual({ message_id: 'REFIDX_direct' })
  })

  it('传自己发过的 message_id 时查表得到 REFIDX', async () => {
    const PROJECT = `${TEST_BASE}/reply2`
    await startTranslator(PROJECT, 8171, 0)
    const { triggerMessage } = connectMockClient(8171)

    // 第一条发送返回带 refIdx 的结果 → 翻译器登记「id → REFIDX」
    vi.mocked(sendOfficialMessage).mockResolvedValueOnce({
      ok: true,
      data: { id: 'sent1', timestamp: 1, refIdx: 'REFIDX_abc' },
    })
    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 100, message: '第一条' },
      echo: 'reply-first',
    })

    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 100, message: '引用它', reply_to: 'sent1' },
      echo: 'reply-second',
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.messageReference).toEqual({ message_id: 'REFIDX_abc' })
  })

  it('查不到 REFIDX 时明确报错，不发送', async () => {
    const PROJECT = `${TEST_BASE}/reply3`
    await startTranslator(PROJECT, 8172, 0)
    const { ws, triggerMessage } = connectMockClient(8172)

    await triggerMessage({
      action: 'send_group_msg',
      params: { group_id: 100, message: '引用未知消息', reply_to: 'unknown-id' },
      echo: 'reply-unknown',
    })

    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
    const response = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(response.status).toBe('failed')
    expect(JSON.stringify(response)).toContain('REFIDX')
  })

  it('reply 消息段里的引用同样生效', async () => {
    const PROJECT = `${TEST_BASE}/reply4`
    await startTranslator(PROJECT, 8173, 0)
    const { triggerMessage } = connectMockClient(8173)

    await triggerMessage({
      action: 'send_group_msg',
      params: {
        group_id: 100,
        message: [
          { type: 'reply', data: { id: 'REFIDX_fromseg' } },
          { type: 'text', data: { text: '段内引用' } },
        ],
      },
      echo: 'reply-seg',
    })

    const calls = vi.mocked(sendOfficialMessage).mock.calls
    const opts = calls[calls.length - 1][4] as Record<string, unknown>
    expect(opts.messageReference).toEqual({ message_id: 'REFIDX_fromseg' })
  })
})

/**
 * 互动回调（INTERACTION_CREATE）。
 *
 * 这是「回调后台」按钮(type=1)的唯一通路：与指令按钮(type=2)不同，它不会产生普通消息，
 * 只能靠互动事件接住；而且官方要求 3 秒内回执，否则客户端一直转圈。
 * 兜底回执的计时逻辑是本项目新增的，风险集中在这里。
 */
describe('INTERACTION_CREATE 互动回调', () => {
  /** 构造一条消息按钮（type=11）互动事件 */
  const buttonInteraction = (overrides: Record<string, unknown> = {}) => ({
    id: 'interaction_abc',
    type: 11,
    chat_type: 1, // 1 = 群聊
    group_openid: 'group_openid_i',
    group_member_openid: 'member_openid_i',
    data: { resolved: { button_id: 'btn1', button_data: 'sign_in' } },
    ...overrides,
  })

  it('广播的事件带顶层 button_* 与 interaction_id，且身份被换算成 UID', async () => {
    const PROJECT = `${TEST_BASE}/interaction_broadcast`
    await startTranslator(PROJECT, 8180, 0)
    const { ws } = connectMockClient(8180)

    latestOfficialMessageCb()(PROJECT, {
      type: 'INTERACTION_CREATE',
      data: buttonInteraction(),
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.notice_type === 'interaction')
    expect(evt).toBeTruthy()
    // button_clicked 触发器直接读这两个顶层字段（主路径，不再依赖消息文本兜底）
    expect(evt!.button_id).toBe('btn1')
    expect(evt!.button_data).toBe('sign_in')
    // 回执要用的 id
    expect(evt!.interaction_id).toBe('interaction_abc')
    // 群聊身份用 member_openid（群内唯一）换算，群用 group_openid
    expect(evt!.user_id).toBe(10000)
    expect(evt!.group_id).toBe(10001)
  })

  it('流程未回执时，兜底回执在窗口后以 code=0 触发', async () => {
    const PROJECT = `${TEST_BASE}/interaction_autoack`
    await startTranslator(PROJECT, 8181, 0)
    connectMockClient(8181)

    latestOfficialMessageCb()(PROJECT, {
      type: 'INTERACTION_CREATE',
      data: buttonInteraction({ id: 'interaction_auto' }),
    })

    // 窗口内不应回执（给流程留出显式回执的机会）
    expect(vi.mocked(answerInteraction)).not.toHaveBeenCalled()

    // 窗口（1.5s）之后兜底触发
    await new Promise((r) => setTimeout(r, 1700))
    expect(vi.mocked(answerInteraction)).toHaveBeenCalledWith(PROJECT, 'interaction_auto', 0)
  }, 10_000)

  it('流程显式回执后，兜底不再重复回执（同一 id 只能回应一次）', async () => {
    const PROJECT = `${TEST_BASE}/interaction_explicit`
    await startTranslator(PROJECT, 8182, 0)
    const { ws, triggerMessage } = connectMockClient(8182)

    latestOfficialMessageCb()(PROJECT, {
      type: 'INTERACTION_CREATE',
      data: buttonInteraction({ id: 'interaction_explicit' }),
    })

    await triggerMessage({
      action: 'answer_interaction',
      params: { interaction_id: 'interaction_explicit', code: 2 },
      echo: 'ack-1',
    })

    expect(vi.mocked(answerInteraction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(answerInteraction)).toHaveBeenCalledWith(PROJECT, 'interaction_explicit', 2)
    // 回执结果应回传给调用方
    const responses = ws.send.mock.calls
      .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .filter((r) => r.echo === 'ack-1')
    expect(responses[0]?.status).toBe('ok')

    // 越过兜底窗口后，不应出现第二次回执
    await new Promise((r) => setTimeout(r, 1700))
    expect(vi.mocked(answerInteraction)).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('不需要回执的互动类型（如消息反馈 type=13）只广播、不回执', async () => {
    const PROJECT = `${TEST_BASE}/interaction_feedback`
    await startTranslator(PROJECT, 8183, 0)
    const { ws } = connectMockClient(8183)

    latestOfficialMessageCb()(PROJECT, {
      type: 'INTERACTION_CREATE',
      data: buttonInteraction({ id: 'interaction_fb', type: 13 }),
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(sent.some((e) => e.notice_type === 'interaction')).toBe(true)

    // type=13 官方不需要回应，因此不该有任何兜底回执
    await new Promise((r) => setTimeout(r, 1700))
    expect(vi.mocked(answerInteraction)).not.toHaveBeenCalled()
  }, 10_000)

  it('answer_interaction 缺少 interaction_id 时返回失败而非静默成功', async () => {
    const PROJECT = `${TEST_BASE}/interaction_missing_id`
    await startTranslator(PROJECT, 8184, 0)
    const { ws, triggerMessage } = connectMockClient(8184)

    await triggerMessage({ action: 'answer_interaction', params: { code: 0 }, echo: 'ack-missing' })

    const responses = ws.send.mock.calls
      .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .filter((r) => r.echo === 'ack-missing')
    expect(responses[0]?.status).toBe('failed')
    expect(vi.mocked(answerInteraction)).not.toHaveBeenCalled()
  })
})

/**
 * QQ 群管理（官方群接口）。
 *
 * 这些 action 以前全部落到「不支持的 OneBot action」—— 节点在 UI 里存在却永远失败。
 * 现在把它们接到官方群接口上，关键点是 **UID → openid 的反查**：
 * 流程侧只认整数 UID（OneBot 习惯），官方要的是字符串 openid。
 */
describe('QQ 群管理 action（官方群接口）', () => {
  it('set_group_ban 把 UID 反查成 openid 并下发给官方禁言接口', async () => {
    const PROJECT = `${TEST_BASE}/group_ban`
    await startTranslator(PROJECT, 8190, 0)
    const { triggerMessage } = await seedGroupMapping(PROJECT, 8190)

    // member_openid_1 → 10000，group_openid_xyz → 10001
    await triggerMessage({
      action: 'set_group_ban',
      params: { group_id: 10001, user_id: 10000, duration: 600 },
      echo: 'ban-1',
    })

    expect(vi.mocked(setGroupMemberMute)).toHaveBeenCalledWith(
      PROJECT,
      'group_openid_xyz',
      'member_openid_1',
      600,
    )
  })

  it('set_group_ban 的 UID 查不到时明确报错，而不是拿数字当 openid 发出去', async () => {
    const PROJECT = `${TEST_BASE}/group_ban_missing`
    await startTranslator(PROJECT, 8191, 0)
    const { ws, triggerMessage } = connectMockClient(8191)

    await triggerMessage({
      action: 'set_group_ban',
      params: { group_id: 999999, user_id: 888888, duration: 60 },
      echo: 'ban-missing',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('failed')
    expect(String(res.msg || res.message || '')).toContain('openid')
    expect(vi.mocked(setGroupMemberMute)).not.toHaveBeenCalled()
  })

  it('set_group_kick 走官方批量移除接口，并透传拉黑开关', async () => {
    const PROJECT = `${TEST_BASE}/group_kick`
    await startTranslator(PROJECT, 8192, 0)
    const { triggerMessage } = await seedGroupMapping(PROJECT, 8192)

    await triggerMessage({
      action: 'set_group_kick',
      params: { group_id: 10001, user_id: 10000, reject_add_request: true },
      echo: 'kick-1',
    })

    expect(vi.mocked(removeGroupMembers)).toHaveBeenCalledWith(
      PROJECT,
      'group_openid_xyz',
      ['member_openid_1'],
      true,
    )
  })

  it('get_group_info 把官方字段映射成 OneBot 习惯的键名', async () => {
    const PROJECT = `${TEST_BASE}/group_info`
    await startTranslator(PROJECT, 8193, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8193)

    await triggerMessage({
      action: 'get_group_info',
      params: { group_id: 10001 },
      echo: 'info-1',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.group_name).toBe('读书分享会')
    expect(res.data.group_memo).toBe('每周共读一本好书')
    expect(res.data.member_count).toBe(256)
  })

  it('get_group_member_list 把 member_openid 映射成 UID 并登记进双向表', async () => {
    const PROJECT = `${TEST_BASE}/group_members`
    await startTranslator(PROJECT, 8194, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8194)

    await triggerMessage({
      action: 'get_group_member_list',
      params: { group_id: 10001 },
      echo: 'members-1',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.next_cursor).toBe('cursor_2')
    expect(res.data.members).toHaveLength(2)
    // 每个成员都拿到了整数 UID，而不是 openid 字符串
    for (const m of res.data.members) {
      expect(typeof m.user_id).toBe('number')
      expect(m.user_id).toBeGreaterThan(0)
    }
    expect(res.data.members[0].nickname).toBe('甲')
    expect(res.data.members[1].role).toBe('admin')
  })

  it('set_group_add_request 支持显式 openid，并把 approve=false 译成 decline', async () => {
    const PROJECT = `${TEST_BASE}/group_join`
    await startTranslator(PROJECT, 8195, 0)
    const { triggerMessage } = connectMockClient(8195)

    await triggerMessage({
      action: 'set_group_add_request',
      params: {
        group_openid: 'g_openid',
        member_openid: 'm_openid',
        approve: false,
        reason: '人满',
      },
      echo: 'join-1',
    })

    expect(vi.mocked(approveGroupJoinRequest)).toHaveBeenCalledWith(
      PROJECT,
      'g_openid',
      'm_openid',
      false,
      expect.objectContaining({ rejectReason: '人满' }),
    )
  })

  it('全员禁言：官方没有设置接口，必须明确说明（而不是含糊的「不支持」）', async () => {
    const PROJECT = `${TEST_BASE}/group_whole_ban`
    await startTranslator(PROJECT, 8196, 0)
    const { ws, triggerMessage } = connectMockClient(8196)

    await triggerMessage({
      action: 'set_group_whole_ban',
      params: { group_id: 10001, enable: true },
      echo: 'whole-ban',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('failed')
    const msg = String(res.msg || res.message || '')
    // 说清「只能查不能设」，并**直接给出该改用的 action**，
    // 否则用户会去反复排查权限/配置，而不是换个能力用
    expect(msg).toContain('没有设置')
    expect(msg).toContain('get_group_mute_state')
  })

  it('get_group_join_requests 读官方真实字段 `list`（回归：曾按 `join_requests` 取值 → 恒为空）', async () => {
    const PROJECT = `${TEST_BASE}/group_join_requests`
    await startTranslator(PROJECT, 8198, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8198)

    await triggerMessage({
      action: 'get_group_join_requests',
      params: { group_id: 10001 },
      echo: 'jr-1',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.requests).toHaveLength(1)
    expect(res.data.next_cursor).toBe('cursor_jr_2')
    const req = res.data.requests[0]
    // flag 就是审批要回传的 join_request_id；user_id 是映射后的整数 UID
    expect(req.flag).toBe('jr_1')
    expect(req.nickname).toBe('申请人甲')
    expect(req.verify_message).toBe('我是群友')
    expect(typeof req.user_id).toBe('number')
    expect(req.user_id).toBeGreaterThan(0)
    // 群号必须被翻译成 group_openid 再下发（下游接口只认 openid）
    expect(vi.mocked(listGroupJoinRequests)).toHaveBeenCalledWith(
      PROJECT,
      'group_openid_xyz',
      '',
      undefined,
    )
  })

  it('get_group_mute_state 暴露禁言模式与按规则算出的 mute_all，并把成员 openid 映射成 UID', async () => {
    const PROJECT = `${TEST_BASE}/group_mute_state`
    await startTranslator(PROJECT, 8197, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8197)

    await triggerMessage({
      action: 'get_group_mute_state',
      params: { group_id: 10001 },
      echo: 'mute-state',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.mute_mode).toBe('always')
    expect(res.data.mute_all).toBe(true)
    // 原始 global_rule 原样透出（定时/周期规则细节不丢）
    expect(res.data.global_rule.schedule_rules).toEqual([])
    expect(res.data.members).toHaveLength(1)
    expect(typeof res.data.members[0].user_id).toBe('number')
    expect(res.data.members[0].mute_expire_at).toBe('2026-08-05T11:23:04+08:00')
    expect(vi.mocked(getGroupMuteState)).toHaveBeenCalledWith(PROJECT, 'group_openid_xyz')
  })
})

// ── 非频道：群成员信息 / 群内状态 / 黑名单 / 自动审批策略 / 分享链接 ──
//
// 这批以前要么完全没接（黑名单、自动审批、分享链接），要么只在"官方没有"的拒绝表里
// （get_group_member_info 曾长期提示"尚未接入"）。
describe('非频道能力：群成员与黑名单', () => {
  it('get_group_member_info 把官方字段映射成 OneBot 习惯的键名', async () => {
    const PROJECT = `${TEST_BASE}/member_info`
    await startTranslator(PROJECT, 8250, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8250)

    await triggerMessage({
      action: 'get_group_member_info',
      params: { group_id: 10001, user_id: 10000 },
      echo: 'mi-1',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.nickname).toBe('小明')
    expect(res.data.role).toBe('admin')
    expect(res.data.bot).toBe(false)
    expect(vi.mocked(getGroupMemberInfo)).toHaveBeenCalledWith(PROJECT, 'group_openid_xyz', expect.any(String))
  })

  it('get_group_bot_state 给出 is_admin（一次判断省掉用户自己比角色字符串）', async () => {
    const PROJECT = `${TEST_BASE}/bot_state`
    await startTranslator(PROJECT, 8251, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8251)

    await triggerMessage({ action: 'get_group_bot_state', params: { group_id: 10001 }, echo: 'bs-1' })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.is_admin).toBe(true)
    expect(res.data.recv_msg_setting).toBe('only_mention')
    expect(vi.mocked(getGroupBotState)).toHaveBeenCalledWith(PROJECT, 'group_openid_xyz')
  })

  it('list_group_blacklist 把 member_openid 映射成 UID 并透出游标', async () => {
    const PROJECT = `${TEST_BASE}/blacklist`
    await startTranslator(PROJECT, 8252, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8252)

    await triggerMessage({ action: 'list_group_blacklist', params: { group_id: 10001 }, echo: 'bl-1' })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.users).toHaveLength(1)
    expect(res.data.users[0].nickname).toBe('捣乱的')
    expect(res.data.next_cursor).toBe('bl_cursor_2')
    expect(listGroupBlacklist).toHaveBeenCalledWith(PROJECT, 'group_openid_xyz', '', undefined)
  })

  it('update_group_blacklist 支持显式 openid，并给出"人还在群里"的提示', async () => {
    const PROJECT = `${TEST_BASE}/blacklist_op`
    await startTranslator(PROJECT, 8253, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8253)

    await triggerMessage({
      action: 'update_group_blacklist',
      params: { group_id: 10001, member_openids: 'a_openid, b_openid', op: 'add' },
      echo: 'bl-2',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.op).toBe('add')
    expect(res.data.count).toBe(2)
    expect(updateGroupBlacklist).toHaveBeenCalledWith(PROJECT, 'group_openid_xyz', ['a_openid', 'b_openid'], 'add')
  })

  it('update_group_blacklist 缺目标时明确报错（不拿空列表去打接口）', async () => {
    const PROJECT = `${TEST_BASE}/blacklist_empty`
    await startTranslator(PROJECT, 8254, 0)
    const { ws, triggerMessage } = await seedGroupMapping(PROJECT, 8254)

    await triggerMessage({
      action: 'update_group_blacklist',
      params: { group_id: 10001, op: 'add' },
      echo: 'bl-3',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('failed')
    expect(String(res.message)).toContain('member_openids')
    expect(vi.mocked(updateGroupBlacklist)).not.toHaveBeenCalled()
  })
})

describe('非频道能力：入群自动审批策略与分享链接', () => {
  it('list_join_approval_strategies 返回策略列表与游标', async () => {
    const PROJECT = `${TEST_BASE}/strategy_list`
    await startTranslator(PROJECT, 8255, 0)
    const { ws, triggerMessage } = connectMockClient(8255)

    await triggerMessage({
      action: 'list_join_approval_strategies',
      params: { limit: 20 },
      echo: 'st-1',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.strategies).toHaveLength(1)
    expect(res.data.strategies[0].strategy_id).toBe('st_d83eca11e9')
    expect(listJoinApprovalStrategies).toHaveBeenCalledWith(PROJECT, '', 20)
  })

  it('create_join_approval_strategy 把一行文本的群号拆成数组后再下发', async () => {
    const PROJECT = `${TEST_BASE}/strategy_create`
    await startTranslator(PROJECT, 8256, 0)
    const { ws, triggerMessage } = connectMockClient(8256)

    await triggerMessage({
      action: 'create_join_approval_strategy',
      params: { group_ids: '10001, 10002', is_enable: 'on', remark: '默认策略' },
      echo: 'st-2',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.strategy_id).toBe('st_new')
    // 翻译器只负责拆行；二选一/上限等校验在 official 层（有专门的纯函数测试）
    const call = vi.mocked(createJoinApprovalStrategy).mock.calls.at(-1)
    expect(call?.[1]).toMatchObject({ groupIds: ['10001', '10002'], isEnable: 'on', remark: '默认策略' })
  })

  it('update_strategy_whitelist 拆分号码文本并透传 op', async () => {
    const PROJECT = `${TEST_BASE}/strategy_wl`
    await startTranslator(PROJECT, 8257, 0)
    const { ws, triggerMessage } = connectMockClient(8257)

    await triggerMessage({
      action: 'update_strategy_whitelist',
      params: { strategy_id: 'st_new', op: 'add', whitelist_users: '1234567、1234568' },
      echo: 'st-3',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(updateStrategyWhitelist).toHaveBeenCalledWith(PROJECT, 'st_new', 'add', ['1234567', '1234568'])
  })

  it('generate_url_link 只把 url 提出来（官方套了一层 data）', async () => {
    const PROJECT = `${TEST_BASE}/url_link`
    await startTranslator(PROJECT, 8258, 0)
    const { ws, triggerMessage } = connectMockClient(8258)

    await triggerMessage({
      action: 'generate_url_link',
      params: { callback_data: 'poster_a' },
      echo: 'ul-1',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.url).toBe('https://qun.qq.com/qunpro/robot/x')
    expect(res.data.callback_data).toBe('poster_a')
    expect(vi.mocked(generateUrlLink)).toHaveBeenCalledWith(PROJECT, 'poster_a')
  })

  it('get_login_info 现在返回官方真实昵称/头像（以前写死 QQBot）', async () => {
    const PROJECT = `${TEST_BASE}/login_info`
    await startTranslator(PROJECT, 8259, 0)
    const { ws, triggerMessage } = connectMockClient(8259)

    await triggerMessage({ action: 'get_login_info', params: {}, echo: 'li-1' })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.nickname).toBe('游戏机器人')
    expect(res.data.avatar).toBe('https://a.png')
  })

  it('get_login_info 额外给出精确的 self_id 字符串（机器人 id 超过 2^53，number 会丢精度）', async () => {
    const PROJECT = `${TEST_BASE}/login_info_precision`
    await startTranslator(PROJECT, 8260, 0)
    const { ws, triggerMessage } = connectMockClient(8260)

    // 先推一条 READY 把精确的 botUserId 灌进去（真实值就是 19 位、超过 2^53）
    latestOfficialMessageCb()(PROJECT, {
      type: 'READY',
      data: { user: { id: '17350883629656119813', username: '游戏机器人' } },
    })

    await triggerMessage({ action: 'get_login_info', params: {}, echo: 'li-2' })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    // 精确值走 self_id（字符串），number 版仅供 OneBot 习惯使用
    expect(res.data.self_id).toBe('17350883629656119813')
    expect(String(res.data.user_id)).not.toBe('17350883629656119813')
  })
})

/**
 * 「订了 intents 却没人消费」的事件。
 *
 * intents 里订了 1<<24（群成员/入群申请）与 1<<27（消息审核），事件确实会到达，
 * 但翻译器此前直接丢弃 —— 表现为触发器挂在画布上永远不触发，
 * 而入群审批因为拿不到 join_request_id 走不通。
 */
describe('群成员 / 入群申请 / 消息审核事件', () => {
  it.each([
    // 官方事件名 → 期望的 notice_type，以及该事件的 id 字段位置
    ['GROUP_ADD_ROBOT', 'group_add_robot', 'group', 'op_member_openid'],
    ['GROUP_DEL_ROBOT', 'group_del_robot', 'group', 'op_member_openid'],
    ['GROUP_MSG_RECEIVE', 'group_msg_receive', 'group', 'op_member_openid'],
    ['GROUP_MSG_REJECT', 'group_msg_reject', 'group', 'op_member_openid'],
    ['FRIEND_ADD', 'friend_add', 'user', 'openid'],
    ['FRIEND_DEL', 'friend_del', 'user', 'openid'],
    ['C2C_MSG_RECEIVE', 'c2c_msg_receive', 'user', 'openid'],
    ['C2C_MSG_REJECT', 'c2c_msg_reject', 'user', 'openid'],
  ])('%s 译成 notice（%s），并把 id 映射成整数 UID', async (officialType, noticeType, scope, idField) => {
    const PROJECT = `${TEST_BASE}/ev_${officialType}`
    // 端口按索引分配，避免与其它用例撞车（8220 起，逐个 +1）
    const port = 8220 + ['GROUP_ADD_ROBOT', 'GROUP_DEL_ROBOT', 'GROUP_MSG_RECEIVE', 'GROUP_MSG_REJECT', 'FRIEND_ADD', 'FRIEND_DEL', 'C2C_MSG_RECEIVE', 'C2C_MSG_REJECT'].indexOf(officialType)
    await startTranslator(PROJECT, port, 0)
    const { ws } = connectMockClient(port)

    latestOfficialMessageCb()(PROJECT, {
      type: officialType,
      data:
        scope === 'group'
          ? { group_openid: 'g_openid_ev', op_member_openid: 'op_openid_ev', timestamp: 1 }
          : { openid: 'u_openid_ev', timestamp: 1 },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.notice_type === noticeType)
    expect(evt, `期望广播 ${noticeType}`).toBeTruthy()
    expect(evt!.post_type).toBe('notice')
    if (scope === 'group') {
      expect(typeof evt!.group_id).toBe('number')
      expect(evt!.group_id as number).toBeGreaterThan(0)
      // 操作者的 openid 也换成 UID 给出去
      expect(typeof evt!.operator_id).toBe('number')
      expect(evt!._group_openid).toBe('g_openid_ev')
    } else {
      expect(typeof evt!.user_id).toBe('number')
      expect(evt!.user_id as number).toBeGreaterThan(0)
      expect(evt!._openid).toBe('u_openid_ev')
    }
    // 原始字段名不该出现在输出里（下游只认统一后的 UID 体系）
    expect(evt![idField]).toBeUndefined()
  })

  it('FRIEND_ADD 额外透出场景值（区分搜索/群/分享链接来源）', async () => {
    const PROJECT = `${TEST_BASE}/ev_friend_scene`
    await startTranslator(PROJECT, 8230, 0)
    const { ws } = connectMockClient(8230)

    latestOfficialMessageCb()(PROJECT, {
      type: 'FRIEND_ADD',
      data: {
        openid: 'u_scene',
        timestamp: 1,
        scene: 2003,
        scene_param: 'poster_a',
        short_code: 'abc',
        author: { union_openid: 'U1' },
      },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.notice_type === 'friend_add')!
    expect(evt.scene).toBe('2003')
    // callback_data 会原样回到这里 —— 渠道统计就靠它
    expect(evt.scene_param).toBe('poster_a')
    expect(evt.short_code).toBe('abc')
  })

  it('SUBSCRIBE_MESSAGE_STATUS 也译成 notice（订阅状态变更不再被丢弃）', async () => {
    const PROJECT = `${TEST_BASE}/ev_subscribe`
    await startTranslator(PROJECT, 8231, 0)
    const { ws } = connectMockClient(8231)

    latestOfficialMessageCb()(PROJECT, {
      type: 'SUBSCRIBE_MESSAGE_STATUS',
      data: { openid: 'u_sub', timestamp: 1 },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(sent.find((e) => e.notice_type === 'subscribe_message_status')).toBeTruthy()
  })

  it('入群申请译成 request 事件，并把 join_request_id 放进 flag', async () => {
    const PROJECT = `${TEST_BASE}/ev_join_req`
    await startTranslator(PROJECT, 8200, 0)
    const { ws } = connectMockClient(8200)

    latestOfficialMessageCb()(PROJECT, {
      type: 'GROUP_JOIN_REQUEST',
      data: {
        group_openid: 'g_openid',
        member_openid: 'm_openid',
        join_request_id: 'REQ_123',
        apply_source: 'self_apply',
        username: '小明',
        verify_info: { method: 'qa', verify_message: '我叫小明' },
      },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.post_type === 'request')
    expect(evt).toBeTruthy()
    expect(evt!.request_type).toBe('group')
    expect(evt!.sub_type).toBe('add')
    // 审批链路的关键：flag 带的是 join_request_id
    expect(evt!.flag).toBe('REQ_123')
    expect(evt!.comment).toBe('我叫小明')
    // 身份同时给出 UID 与显式 openid
    expect(typeof evt!.user_id).toBe('number')
    expect(evt!._group_openid).toBe('g_openid')
    expect(evt!._member_openid).toBe('m_openid')
  })

  it('入群申请的 flag 可以直接回传给 set_group_add_request 完成审批', async () => {
    const PROJECT = `${TEST_BASE}/ev_join_approve`
    await startTranslator(PROJECT, 8201, 0)
    const { ws, triggerMessage } = connectMockClient(8201)

    latestOfficialMessageCb()(PROJECT, {
      type: 'GROUP_JOIN_REQUEST',
      data: {
        group_openid: 'g_openid2',
        member_openid: 'm_openid2',
        join_request_id: 'REQ_456',
      },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.post_type === 'request')!

    // 用事件里的 group_id / user_id + flag 走一遍审批
    await triggerMessage({
      action: 'set_group_add_request',
      params: {
        group_id: evt.group_id,
        user_id: evt.user_id,
        flag: evt.flag,
        approve: true,
      },
      echo: 'approve-1',
    })

    expect(vi.mocked(approveGroupJoinRequest)).toHaveBeenCalledWith(
      PROJECT,
      'g_openid2',
      'm_openid2',
      true,
      expect.objectContaining({ joinRequestId: 'REQ_456' }),
    )
  })

  it('群成员加入 / 退出译成 notice 事件', async () => {
    const PROJECT = `${TEST_BASE}/ev_member`
    await startTranslator(PROJECT, 8202, 0)
    const { ws } = connectMockClient(8202)

    latestOfficialMessageCb()(PROJECT, {
      type: 'GROUP_MEMBER_ADD',
      data: { group_openid: 'g1', member_openid: 'm1', op_member_openid: 'op1' },
    })
    latestOfficialMessageCb()(PROJECT, {
      type: 'GROUP_MEMBER_REMOVE',
      data: { group_openid: 'g1', member_openid: 'm1' },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const add = sent.find((e) => e.notice_type === 'group_member_add')
    const del = sent.find((e) => e.notice_type === 'group_member_remove')
    expect(add?.sub_type).toBe('approve')
    expect(del?.sub_type).toBe('leave')
    // 操作人也要换算成 UID（op_member_openid 有值时）
    expect(typeof add?.operator_id).toBe('number')
  })

  it('消息审核结果译成 notice 事件', async () => {
    const PROJECT = `${TEST_BASE}/ev_audit`
    await startTranslator(PROJECT, 8203, 0)
    const { ws } = connectMockClient(8203)

    latestOfficialMessageCb()(PROJECT, {
      type: 'MESSAGE_AUDIT_PASS',
      data: { audit_id: 'AUD_1', message_id: 'MSG_1', channel_id: 'CH_1' },
    })
    latestOfficialMessageCb()(PROJECT, {
      type: 'MESSAGE_AUDIT_REJECT',
      data: { audit_id: 'AUD_2' },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const pass = sent.find((e) => e.sub_type === 'pass')
    const reject = sent.find((e) => e.sub_type === 'reject')
    expect(pass?.notice_type).toBe('message_audit')
    expect(pass?.message_id).toBe('MSG_1')
    expect(reject?.notice_type).toBe('message_audit')
    expect(reject?.audit_id).toBe('AUD_2')
  })

  it('缺关键字段的入群申请事件被丢弃，不产生半成品事件', async () => {
    const PROJECT = `${TEST_BASE}/ev_join_missing`
    await startTranslator(PROJECT, 8204, 0)
    const { ws } = connectMockClient(8204)

    // 没有 member_openid：无法定位申请人，不应广播
    latestOfficialMessageCb()(PROJECT, {
      type: 'GROUP_JOIN_REQUEST',
      data: { group_openid: 'g_only' },
    })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(sent.some((e) => e.post_type === 'request')).toBe(false)
  })
})

/**
 * 自定义菜单 / 指令面板的动作派发。
 *
 * 节点侧已经单测过参数组装，这里只验**翻译器把 action 接到了对应实现**——
 * 断链（action 名拼错、忘了加 case）会让节点报「不支持的 action」，
 * 而节点单测因为直接调 handler 是发现不了的。
 */
describe('自定义菜单 / 指令面板 action 派发', () => {
  it('get_menu 返回菜单数据', async () => {
    const PROJECT = `${TEST_BASE}/menu_get`
    await startTranslator(PROJECT, 8210, 0)
    const { ws, triggerMessage } = connectMockClient(8210)

    await triggerMessage({ action: 'get_menu', params: {}, echo: 'm1' })

    expect(vi.mocked(getMenu)).toHaveBeenCalledWith(PROJECT)
    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('ok')
    expect(res.data.version).toBe(7)
  })

  it('set_menu 透传菜单结构', async () => {
    const PROJECT = `${TEST_BASE}/menu_set`
    await startTranslator(PROJECT, 8211, 0)
    const { triggerMessage } = connectMockClient(8211)

    const menu = { items: [{ type: 'link', name: '官网', link: 'https://x.com' }] }
    await triggerMessage({ action: 'set_menu', params: { menu }, echo: 'm2' })

    expect(vi.mocked(setMenu)).toHaveBeenCalledWith(PROJECT, menu)
  })

  it('set_menu 缺少 menu 时明确报错', async () => {
    const PROJECT = `${TEST_BASE}/menu_set_missing`
    await startTranslator(PROJECT, 8212, 0)
    const { ws, triggerMessage } = connectMockClient(8212)

    await triggerMessage({ action: 'set_menu', params: {}, echo: 'm3' })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('failed')
    expect(vi.mocked(setMenu)).not.toHaveBeenCalled()
  })

  it('list_panels 默认 scope=c2c，可显式指定', async () => {
    const PROJECT = `${TEST_BASE}/panel_list`
    await startTranslator(PROJECT, 8213, 0)
    const { triggerMessage } = connectMockClient(8213)

    await triggerMessage({ action: 'list_panels', params: {}, echo: 'p1' })
    expect(vi.mocked(listPanels)).toHaveBeenCalledWith(PROJECT, 'c2c', undefined)

    await triggerMessage({ action: 'list_panels', params: { scope: 'group', limit: 5 }, echo: 'p2' })
    expect(vi.mocked(listPanels)).toHaveBeenCalledWith(PROJECT, 'group', 5)
  })

  it('create_panel 原样透传 payload', async () => {
    const PROJECT = `${TEST_BASE}/panel_create`
    await startTranslator(PROJECT, 8214, 0)
    const { triggerMessage } = connectMockClient(8214)

    await triggerMessage({
      action: 'create_panel',
      params: { scope: 'c2c', target_type: 'all', panel: { items: [] } },
      echo: 'p3',
    })

    expect(vi.mocked(createPanel)).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ scope: 'c2c', target_type: 'all' }),
    )
  })

  it('update_panel / delete_panel / set_panel_target 各自派发正确', async () => {
    const PROJECT = `${TEST_BASE}/panel_ops`
    await startTranslator(PROJECT, 8215, 0)
    const { triggerMessage } = connectMockClient(8215)

    await triggerMessage({
      action: 'update_panel',
      params: { panel_id: 'p_1', panel: { items: [] } },
      echo: 'p4',
    })
    expect(vi.mocked(updatePanel)).toHaveBeenCalledWith(PROJECT, 'p_1', { items: [] })

    await triggerMessage({ action: 'delete_panel', params: { panel_id: 'p_2' }, echo: 'p5' })
    expect(vi.mocked(deletePanel)).toHaveBeenCalledWith(PROJECT, 'p_2')

    // 一行文本的 openid 串要被拆开并去重
    await triggerMessage({
      action: 'set_panel_target',
      params: { panel_id: 'p_3', group_openids: 'g1 g1、g2' },
      echo: 'p6',
    })
    expect(vi.mocked(setPanelTarget)).toHaveBeenCalledWith(PROJECT, 'p_3', {
      userOpenids: [],
      groupOpenids: ['g1', 'g2'],
    })
  })
})

/**
 * QQ 频道（Guild）。
 *
 * 频道与群聊/单聊是**同一开放平台的不同场景**：同一个 AppID、同一个网关，
 * 但 ID 体系（guild_id / channel_id，而非 openid）与消息请求体都不同。
 */
describe('QQ 频道：事件与发送', () => {
  /** 造一条频道 @机器人 消息，建立 guild/channel/user 的 UID 映射 */
  const guildEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'CH_MSG_1',
    channel_id: 'channel_abc',
    guild_id: 'guild_xyz',
    content: '你好',
    author: { id: '10001', username: '小明', bot: false },
    ...overrides,
  })

  it('AT_MESSAGE_CREATE 译成 message 事件，带 guild_id / channel_id', async () => {
    const PROJECT = `${TEST_BASE}/guild_msg`
    await startTranslator(PROJECT, 8220, 0)
    const { ws } = connectMockClient(8220)

    latestOfficialMessageCb()(PROJECT, { type: 'AT_MESSAGE_CREATE', data: guildEvent() })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.message_type === 'guild')
    expect(evt).toBeTruthy()
    expect(evt!.to_me).toBe(true)
    expect(evt!.sub_type).toBe('at')
    expect(evt!.raw_message).toBe('你好')
    // 三个标识都换算成整数 UID（流程侧只认 UID）
    expect(typeof evt!.guild_id).toBe('number')
    expect(typeof evt!.channel_id).toBe('number')
    expect(typeof evt!.user_id).toBe('number')
    // 原文 id 保留，发送/撤回时反查用
    expect(evt!._channel_openid).toBe('channel_abc')
    expect(evt!._guild_openid).toBe('guild_xyz')
  })

  it('MESSAGE_CREATE（私域全量）不是 @机器人，to_me 为 false', async () => {
    const PROJECT = `${TEST_BASE}/guild_all`
    await startTranslator(PROJECT, 8221, 0)
    const { ws } = connectMockClient(8221)

    latestOfficialMessageCb()(PROJECT, { type: 'MESSAGE_CREATE', data: guildEvent() })

    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.message_type === 'guild')
    expect(evt!.to_me).toBe(false)
    expect(evt!.sub_type).toBe('channel_all')
  })

  it('send_channel_msg 把 channel UID 反查回 channel_id 并用频道通路发送', async () => {
    const PROJECT = `${TEST_BASE}/guild_send`
    await startTranslator(PROJECT, 8222, 0)
    const { ws, triggerMessage } = connectMockClient(8222)

    latestOfficialMessageCb()(PROJECT, { type: 'AT_MESSAGE_CREATE', data: guildEvent() })
    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const evt = sent.find((e) => e.message_type === 'guild')!

    await triggerMessage({
      action: 'send_channel_msg',
      params: { channel_id: evt.channel_id, message: '回复频道' },
      echo: 'ch1',
    })

    // 关键：chatType 必须是 'channel'（而不是退化成 c2c/group）
    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'channel',
      'channel_abc',
      '回复频道',
      expect.any(Object),
    )
  })

  it('send_msg + message_type=guild 走同一条频道通路', async () => {
    const PROJECT = `${TEST_BASE}/guild_send2`
    await startTranslator(PROJECT, 8223, 0)
    const { ws, triggerMessage } = connectMockClient(8223)

    latestOfficialMessageCb()(PROJECT, { type: 'AT_MESSAGE_CREATE', data: guildEvent() })
    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const channelUid = sent.find((e) => e.message_type === 'guild')!.channel_id

    await triggerMessage({
      action: 'send_msg',
      params: { message_type: 'guild', channel_id: channelUid, message: '频道再回复' },
      echo: 'ch2',
    })

    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'channel',
      'channel_abc',
      '频道再回复',
      expect.any(Object),
    )
  })

  it('发频道消息缺 channel_id 时明确报错，不退化到别的场景', async () => {
    const PROJECT = `${TEST_BASE}/guild_send_missing`
    await startTranslator(PROJECT, 8224, 0)
    const { ws, triggerMessage } = connectMockClient(8224)

    await triggerMessage({
      action: 'send_channel_msg',
      params: { message: '没有目标' },
      echo: 'ch3',
    })

    const res = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string)
    expect(res.status).toBe('failed')
    expect(String(res.msg || res.message || '')).toContain('channel_id')
    expect(vi.mocked(sendOfficialMessage)).not.toHaveBeenCalled()
  })

  it('频道 markdown 段走 markdown 字段', async () => {
    const PROJECT = `${TEST_BASE}/guild_md`
    await startTranslator(PROJECT, 8225, 0)
    const { ws, triggerMessage } = connectMockClient(8225)

    latestOfficialMessageCb()(PROJECT, { type: 'AT_MESSAGE_CREATE', data: guildEvent() })
    const sent = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    const channelUid = sent.find((e) => e.message_type === 'guild')!.channel_id

    await triggerMessage({
      action: 'send_channel_msg',
      params: {
        channel_id: channelUid,
        message: [{ type: 'markdown', data: { content: '# 标题' } }],
      },
      echo: 'ch4',
    })

    expect(vi.mocked(sendOfficialMessage)).toHaveBeenCalledWith(
      PROJECT,
      'channel',
      'channel_abc',
      '',
      expect.objectContaining({ markdown: { content: '# 标题' } }),
    )
  })
})

/**
 * 频道专属操作（子频道 / 公告 / 精华 / 表情表态）。
 *
 * 这些能力**只在频道场景存在**，群聊没有对应概念。
 * 翻译器在这里要做的主要是两件转换：
 *   · UID → 原始 id（流程侧只认整数 UID）
 *   · 界面名 → 官方整数枚举（类型名 text→0、表情类型 unicode→2）
 */
describe('频道专属操作 action', () => {
  const guildEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'CH_MSG_9',
    channel_id: 'channel_abc',
    guild_id: 'guild_xyz',
    content: 'hi',
    author: { id: '10001', username: '小明', bot: false },
    ...overrides,
  })

  /**
   * 先连客户端再造事件，拿到换算好的 guild/channel UID。
   *
   * 顺序不能反：翻译器是**向已连接的客户端广播**的，
   * 事件早于连接到达时广播无人接收（`ws.send` 一次都不会被调用）。
   */
  async function seedGuild(project: string, port: number) {
    const client = connectMockClient(port)
    latestOfficialMessageCb()(project, { type: 'AT_MESSAGE_CREATE', data: guildEvent() })
    const sent = client.ws.send.mock.calls.map(
      (c) => JSON.parse(String(c[0])) as Record<string, unknown>,
    )
    const evt = sent.find((e) => e.message_type === 'guild')!
    return { client, guildUid: evt.guild_id, channelUid: evt.channel_id }
  }

  it('channel_list 把频道 UID 反查回原始 guild_id', async () => {
    const PROJECT = `${TEST_BASE}/ch_list`
    await startTranslator(PROJECT, 8230, 0)
    const { client, guildUid } = await seedGuild(PROJECT, 8230)

    await client.triggerMessage({ action: 'channel_list', params: { guild_id: guildUid }, echo: 'c1' })

    expect(vi.mocked(listGuildChannels)).toHaveBeenCalledWith(PROJECT, 'guild_xyz')
  })

  it('channel_create 把界面类型名翻成官方整数枚举', async () => {
    const PROJECT = `${TEST_BASE}/ch_create`
    await startTranslator(PROJECT, 8231, 0)
    const { client, guildUid } = await seedGuild(PROJECT, 8231)

    await client.triggerMessage({
      action: 'channel_create',
      params: { guild_id: guildUid, name: '公告区', type: 'text', position: '3' },
      echo: 'c2',
    })

    expect(vi.mocked(createGuildChannel)).toHaveBeenCalledWith(PROJECT, 'guild_xyz', {
      name: '公告区',
      type: 0, // text → 0
      position: 3,
    })
  })

  it('reaction_add 把表情类型名翻成官方整数（unicode → 2）', async () => {
    const PROJECT = `${TEST_BASE}/ch_react`
    await startTranslator(PROJECT, 8232, 0)
    const { client, channelUid } = await seedGuild(PROJECT, 8232)

    await client.triggerMessage({
      action: 'reaction_add',
      params: {
        channel_id: channelUid,
        message_id: 'MSG_1',
        emoji_type: 'unicode',
        emoji_id: '128077',
      },
      echo: 'c3',
    })

    expect(vi.mocked(addChannelReaction)).toHaveBeenCalledWith(
      PROJECT,
      'channel_abc',
      'MSG_1',
      2, // unicode → 2
      '128077',
    )
  })

  it('表态缺 emoji_id 时本地拦下，不发必然失败的请求', async () => {
    const PROJECT = `${TEST_BASE}/ch_react_missing`
    await startTranslator(PROJECT, 8233, 0)
    const { client, channelUid } = await seedGuild(PROJECT, 8233)

    await client.triggerMessage({
      action: 'reaction_add',
      params: { channel_id: channelUid, message_id: 'MSG_1' },
      echo: 'c4',
    })

    const res = JSON.parse(
      client.ws.send.mock.calls[client.ws.send.mock.calls.length - 1][0] as string,
    )
    expect(res.status).toBe('failed')
    expect(String(res.msg || res.message || '')).toContain('emoji_id')
    expect(vi.mocked(addChannelReaction)).not.toHaveBeenCalled()
  })

  it('pin_remove 不传消息 ID 时退化为 all（清空精华）', async () => {
    const PROJECT = `${TEST_BASE}/ch_pin_all`
    await startTranslator(PROJECT, 8234, 0)
    const { client, channelUid } = await seedGuild(PROJECT, 8234)

    await client.triggerMessage({ action: 'pin_remove', params: { channel_id: channelUid }, echo: 'c5' })

    expect(vi.mocked(removeChannelPin)).toHaveBeenCalledWith(PROJECT, 'channel_abc', 'all')
  })

  it('announce_create 的消息类型公告会把 channel_id 一并带上', async () => {
    const PROJECT = `${TEST_BASE}/ch_announce_bad`
    await startTranslator(PROJECT, 8235, 0)
    const { client, guildUid, channelUid } = await seedGuild(PROJECT, 8235)

    await client.triggerMessage({
      action: 'announce_create',
      params: { guild_id: guildUid, channel_id: channelUid, message_id: 'MSG_1' },
      echo: 'c6',
    })

    expect(vi.mocked(createChannelAnnounce)).toHaveBeenCalledWith(
      PROJECT,
      'guild_xyz',
      expect.objectContaining({ message_id: 'MSG_1', channel_id: 'channel_abc' }),
    )
  })

  it('announce_create 的推荐子频道支持贴 JSON', async () => {
    const PROJECT = `${TEST_BASE}/ch_announce_rec`
    await startTranslator(PROJECT, 8236, 0)
    const { client, guildUid } = await seedGuild(PROJECT, 8236)

    await client.triggerMessage({
      action: 'announce_create',
      params: {
        guild_id: guildUid,
        announces_type: '1',
        recommend_channels: '[{"channel_id":"C1","introduce":"推荐语"}]',
      },
      echo: 'c7',
    })

    expect(vi.mocked(createChannelAnnounce)).toHaveBeenCalledWith(
      PROJECT,
      'guild_xyz',
      expect.objectContaining({
        announces_type: 1,
        recommend_channels: [{ channel_id: 'C1', introduce: '推荐语' }],
      }),
    )
  })

  it('推荐子频道 JSON 非法时明确报错', async () => {
    const PROJECT = `${TEST_BASE}/ch_announce_badjson`
    await startTranslator(PROJECT, 8237, 0)
    const { client, guildUid } = await seedGuild(PROJECT, 8237)

    await client.triggerMessage({
      action: 'announce_create',
      params: { guild_id: guildUid, recommend_channels: '[坏 JSON' },
      echo: 'c8',
    })

    const res = JSON.parse(
      client.ws.send.mock.calls[client.ws.send.mock.calls.length - 1][0] as string,
    )
    expect(res.status).toBe('failed')
    expect(String(res.msg || res.message || '')).toContain('JSON')
  })
})
