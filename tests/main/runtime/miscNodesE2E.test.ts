// tests/main/runtime/miscNodesE2E.test.ts
//
// 剩余可离线节点的真行为：delay / get_context / file_operate / group_op / branch_switch。
// （parallel_exec / retry_exec / timer / scheduled 需要更复杂的图结构，query / database_write /
//   variable_persist 依赖 sqlite，留给下一批。）
import { describe, it, expect } from 'vitest'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { getHandler } from '@main/runtime/handlerRegistry'
import { runFlowGraph } from '../../helpers/runFlowGraph'

const specOf = (kind: string) => NODE_CATALOG_V2.find((s) => s.kind === kind)!
const node = (id: string, kind: string, config: Record<string, unknown>) => {
  const spec = specOf(kind)
  return {
    id,
    type: spec.type,
    position: { x: 0, y: 0 },
    data: { label: spec.label, nodeKind: kind, config, inputs: spec.inputs, outputs: spec.outputs },
  }
}
const edge = (id: string, s: string, sp: string, t: string, tp: string) => ({
  id,
  source: s,
  sourcePort: sp,
  target: t,
  targetPort: tp,
})
const TRIG = { match: 'command', command: '测试', prefix: '/', message_type: 'any' }
const messages = (r: { actions: Array<{ params: Record<string, unknown> }> }) =>
  r.actions.map((a) => String(a.params.message ?? ''))

describe('delay：等待后继续', () => {
  it('0 秒延迟也能串起来', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('d', 'delay', { seconds: 0 }),
        node('s', 'message_send', { mode: 'text', text: '等完了' }),
      ],
      edges: [edge('e1', 't', 'next', 'd', 'in'), edge('e2', 'd', 'out', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(messages(r)).toEqual(['等完了'])
  })
})

describe('get_context：从事件里取上下文', () => {
  it('user_id / message_text 都能取到（事件里的真实值）', async () => {
    for (const [mode, expected] of [
      ['user_id', '12345'],
      ['group_id', '67890'],
      ['message_text', '/测试'],
    ] as const) {
      const graph = {
        nodes: [
          node('t', 'message_received', TRIG),
          node('g', 'get_context', { mode }),
          node('f', 'format_text', { template: 'V={var1}' }),
          node('s', 'message_send', { mode: 'text', text: '' }),
        ],
        edges: [
          edge('e1', 't', 'next', 'g', 'in'),
          edge('e2', 'g', 'out', 'f', 'in'),
          edge('e3', 'g', 'result', 'f', 'var1'),
          edge('e4', 'f', 'out', 's', 'in'),
          edge('e5', 'f', 'result', 's', 'text'),
        ],
      }
      const r = await runFlowGraph(graph)
      expect(messages(r), `mode=${mode}`).toEqual([`V=${expected}`])
    }
  })
})

describe('file_operate：写文件再读回来', () => {
  it('写入内容能被读回（相对路径落在项目目录里）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('w', 'file_operate', { mode: 'write', file_path: 'data/note.txt', content: '你好文件', write_mode: 'text' }),
        node('r', 'file_operate', { mode: 'read', file_path: 'data/note.txt', encoding: 'utf-8' }),
        node('f', 'format_text', { template: 'F={var1}' }),
        node('s', 'message_send', { mode: 'text', text: '' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'w', 'in'),
        edge('e2', 'w', 'out', 'r', 'in'),
        edge('e3', 'r', 'out', 'f', 'in'),
        edge('e4', 'r', 'result', 'f', 'var1'),
        edge('e5', 'f', 'out', 's', 'in'),
        edge('e6', 'f', 'result', 's', 'text'),
      ],
    }
    const r = await runFlowGraph(graph)
    expect(messages(r)).toEqual(['F=你好文件'])
  })
})

describe('group_op：群操作会调用适配器', () => {
  it('禁言发出了一次群管理调用', async () => {
    // 用 ban：全员禁言（mute_all）是官方没有的遗留模式，现在会被明确拒绝，
    // 见 tests/main/services/groupOpBatch.test.ts 的遗留模式用例。
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('g', 'group_op', { mode: 'ban', group_id: '67890', user_id: '12345', duration: 600 }),
      ],
      edges: [edge('e1', 't', 'next', 'g', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions.some((a) => a.api === 'set_group_ban')).toBe(true)
  })
})

describe('branch_switch：按值选出口', () => {
  it('命中 case 时返回对应出口（handler 层）', async () => {
    const handler = getHandler('branch_switch')!
    const r = await handler({} as never, null, { value: 'a', cases: { a: '输出A' } } as never, {} as never)
    expect(JSON.stringify(r)).toContain('输出A')
  })
})

describe('message_send 回复当前会话：必须带上目标（回归：QQ 400「用户/群已注销」）', () => {
  // 事故（真机实测）：`send_message` 只带 message 时，翻译器既没有 user_id 也没有 group_id，
  // 反查 openid 只能拿到 '0' → 官方 API 回 400「请求的资源不存在(用户/群已注销)」，
  // 于是**所有回复都发不出去**（日志里 `准备发送: UID=0, openid=0`）。
  const graph = {
    nodes: [
      node('t', 'message_received', TRIG),
      node('s', 'message_send', { mode: 'text', text: '你好' }),
    ],
    edges: [edge('e1', 't', 'next', 's', 'in')],
  }
  const sendParams = (r: { actions: Array<{ api: string; params: Record<string, unknown> }> }) =>
    r.actions.find((a) => a.api === 'send_message')?.params ?? {}

  it('群消息：带 message_type=group + group_id', async () => {
    const r = await runFlowGraph(graph)
    expect(sendParams(r)).toMatchObject({
      message: '你好',
      message_type: 'group',
      group_id: '67890',
    })
  })

  it('私聊消息：带 message_type=private + user_id（不能是 0 / 空）', async () => {
    const r = await runFlowGraph(graph, {
      event: { message_type: 'private', group_id: undefined, user_id: 10000 },
    })
    expect(sendParams(r)).toMatchObject({
      message: '你好',
      message_type: 'private',
      user_id: '10000',
    })
  })

  it('显式指定目标（target_type=user）时按指定目标发，不受当前会话影响', async () => {
    const pushGraph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'text',
          text: '推送',
          target_type: 'user',
          target_id: '999',
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(pushGraph)
    expect(r.actions.find((a) => a.api === 'send_private_message')?.params).toMatchObject({
      user_id: '999',
      message: '推送',
    })
  })
})

describe('message_send 回复即模板（{var1} 占位符，省掉「文本模板」节点）', () => {
  it('上游结果直连发送节点的 var1：文案按模板渲染', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('g', 'get_context', { mode: 'user_id' }),
        node('s', 'message_send', { mode: 'text', text: '🆔 你的 QQ：{var1}' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'g', 'in'),
        edge('e2', 'g', 'out', 's', 'in'),
        edge('e3', 'g', 'result', 's', 'var1'),
      ],
    }
    const r = await runFlowGraph(graph)
    expect(messages(r)).toEqual(['🆔 你的 QQ：12345'])
  })

  it('多个占位符各自取对应端口', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('u', 'get_context', { mode: 'user_id' }),
        node('g', 'get_context', { mode: 'group_id' }),
        node('s', 'message_send', { mode: 'text', text: '用户={var1} 群={var2}' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'u', 'in'),
        edge('e2', 'u', 'out', 'g', 'in'),
        edge('e3', 'g', 'out', 's', 'in'),
        edge('e4', 'u', 'result', 's', 'var1'),
        edge('e5', 'g', 'result', 's', 'var2'),
      ],
    }
    const r = await runFlowGraph(graph)
    expect(messages(r)).toEqual(['用户=12345 群=67890'])
  })

  it('没连变量时原样发送（文案里普通的花括号不会被吃掉）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', { mode: 'text', text: '配置示例：{mode}（照原样发）' }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(messages(r)).toEqual(['配置示例：{mode}（照原样发）'])
  })
})

describe('message_send 富媒体模式（官方 msg_type=7）', () => {
  it('发 send_media：url / media_type 按配置，目标跟随当前会话', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'media',
          media_url: 'https://example.com/a.png',
          media_type: 'image',
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions).toEqual([
      {
        api: 'send_media',
        params: {
          url: 'https://example.com/a.png',
          media_type: 'image',
          message_type: 'group',
          group_id: '67890',
        },
      },
    ])
  })

  it('file_name 只在填了的时候带上（语音/文件才有意义）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'media',
          media_url: 'https://example.com/a.zip',
          media_type: 'file',
          file_name: '存档.zip',
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.params).toMatchObject({
      media_type: 'file',
      file_name: '存档.zip',
    })
  })

  it('本地路径直接拒绝（官方由服务端拉 url，本地文件发不出去）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', { mode: 'media', media_url: 'C:\\tmp\\a.png' }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions).toEqual([])
  })

  it('media_url 为空时不发请求', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', { mode: 'media', media_url: '' }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions).toEqual([])
  })
})

describe('message_send 引用回复（reply_to）', () => {
  it('text 模式带 reply_to：原样透传，由适配器换算 REFIDX', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', { mode: 'text', text: '好的', reply_to: 'REFIDX_x' }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.api).toBe('send_message')
    expect(r.actions[0]?.params).toMatchObject({ message: '好的', reply_to: 'REFIDX_x' })
  })

  it('「取上下文 → 引用标识」连到 reply_to：当前会话的消息 id 被带上', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('g', 'get_context', { mode: 'message_ref' }),
        node('s', 'message_send', { mode: 'text', text: '收到：{var1}' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'g', 'in'),
        edge('e2', 'g', 'out', 's', 'in'),
        edge('e3', 'g', 'result', 's', 'var1'),
        edge('e4', 'g', 'result', 's', 'reply_to'),
      ],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.params).toMatchObject({ message: '收到：1', reply_to: '1' })
  })

  it('media 模式也支持 reply_to', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'media',
          media_url: 'https://example.com/a.png',
          reply_to: 'REFIDX_y',
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.params).toMatchObject({ reply_to: 'REFIDX_y' })
  })

  it('不填 reply_to 时不带该参数（避免官方把空串当引用）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', { mode: 'text', text: '好的', reply_to: '' }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.params).not.toHaveProperty('reply_to')
  })
})

describe('message_send 互动召回（is_wakeup，仅单聊主动推送）', () => {
  it('私聊推送 + is_wakeup=true：带 is_wakeup 发出去', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'text',
          text: '好久不见',
          target_type: 'user',
          target_id: '10001',
          is_wakeup: true,
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.api).toBe('send_private_message')
    expect(r.actions[0]?.params).toMatchObject({ user_id: '10001', is_wakeup: true })
  })

  it('默认 false 时不带参数（不做无谓的召回声明）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'text',
          text: '普通推送',
          target_type: 'user',
          target_id: '10001',
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.params).not.toHaveProperty('is_wakeup')
  })

  it('Markdown 模式同样透传（按钮/Markdown 不再静默丢失召回）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'markdown',
          markdown: '# 召回',
          keyboard: { rows: [] },
          target_type: 'user',
          target_id: '10001',
          is_wakeup: true,
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.api).toBe('send_keyboard_message')
    expect(r.actions[0]?.params).toMatchObject({ is_wakeup: true })
  })

  it('富媒体模式同样透传', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'media',
          media_url: 'https://example.com/a.png',
          target_type: 'user',
          target_id: '10001',
          is_wakeup: true,
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.api).toBe('send_media')
    expect(r.actions[0]?.params).toMatchObject({ is_wakeup: true })
  })

  it('群聊推送不带 is_wakeup（官方群聊接口没有该字段）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('s', 'message_send', {
          mode: 'text',
          text: '群里不召回',
          target_type: 'group',
          target_id: '67890',
          is_wakeup: true,
        }),
      ],
      edges: [edge('e1', 't', 'next', 's', 'in')],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.api).toBe('send_group_message')
    expect(r.actions[0]?.params).not.toHaveProperty('is_wakeup')
  })
})

describe('message_send 流式消息（仅单聊，节点内自动切片）', () => {
  /** 流式只用 text 端口当正文；间隔设 0 让测试不等 300ms */
  const streamGraph = (config: Record<string, unknown>) => ({
    nodes: [
      node('t', 'message_received', TRIG),
      node('s', 'message_send', {
        mode: 'stream',
        target_type: 'user',
        target_id: '10001',
        stream_interval_ms: 0,
        ...config,
      }),
    ],
    edges: [edge('e1', 't', 'next', 's', 'in')],
  })

  it('按「每片字数」切片逐片下发，末片 input_state=10', async () => {
    const r = await runFlowGraph(streamGraph({ text: 'abcdefghij', stream_chunk_size: 4 }))
    expect(r.actions.map((a) => a.api)).toEqual([
      'send_stream_message',
      'send_stream_message',
      'send_stream_message',
    ])
    expect(r.actions.map((a) => a.params.content_raw)).toEqual(['abcd', 'efgh', 'ij'])
    expect(r.actions.map((a) => a.params.index)).toEqual([0, 1, 2])
    expect(r.actions.map((a) => a.params.input_state)).toEqual([1, 1, 10])
    expect(r.actions[0]?.params).toMatchObject({ user_id: '10001', content_type: 'text' })
  })

  it('首片不带 stream_msg_id，后续片带上服务端返回的 id', async () => {
    const r = await runFlowGraph(
      streamGraph({ text: 'abcdefgh', stream_chunk_size: 4 }),
    )
    expect(r.actions[0]?.params).not.toHaveProperty('stream_msg_id')
    expect(r.actions[1]?.params).toMatchObject({ stream_msg_id: 'test-msg-1' })
  })

  it('content_type 可切 markdown（官方流式接口支持 md 排版）', async () => {
    const r = await runFlowGraph(
      streamGraph({ text: '# 标题', stream_content_type: 'markdown' }),
    )
    expect(r.actions[0]?.params).toMatchObject({ content_type: 'markdown', input_state: 10 })
  })

  it('正文里 {var1} 同样会插值（与纯文本模式同一套模板规则）', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', TRIG),
        node('g', 'get_context', { mode: 'user_id' }),
        node('s', 'message_send', {
          mode: 'stream',
          text: '你好 {var1}',
          target_type: 'user',
          target_id: '10001',
          stream_interval_ms: 0,
        }),
      ],
      edges: [
        edge('e1', 't', 'next', 'g', 'in'),
        edge('e2', 'g', 'out', 's', 'in'),
        edge('e3', 'g', 'result', 's', 'var1'),
      ],
    }
    const r = await runFlowGraph(graph)
    expect(r.actions[0]?.params).toMatchObject({ content_raw: '你好 12345' })
  })

  it('群聊推送直接拒绝：官方只有单聊流式端点', async () => {
    const r = await runFlowGraph(
      streamGraph({ text: '你好', target_type: 'group', target_id: '67890' }),
    )
    expect(r.actions).toEqual([])
  })

  it('正文为空时不发请求', async () => {
    const r = await runFlowGraph(streamGraph({ text: '' }))
    expect(r.actions).toEqual([])
  })

  it('中间某片失败：补一片结束态，避免对方界面停在「生成中」', async () => {
    let calls = 0
    const r = await runFlowGraph(
      streamGraph({ text: 'abcdefghijkl', stream_chunk_size: 4 }),
      {
        callApi: (api) => {
          if (api !== 'send_stream_message') return { status: 'ok' }
          calls += 1
          if (calls === 2) throw new Error('50002 频率限制')
          return { message_id: 'test-msg-1' }
        },
      },
    )
    // 第 1 片成功 → 第 2 片失败 → best-effort 补一片结束态
    expect(r.actions.map((a) => a.params.input_state)).toEqual([1, 1, 10])
    expect(r.actions[2]?.params).toMatchObject({
      content_raw: '',
      stream_msg_id: 'test-msg-1',
    })
  })

  it('首片就失败：不补结束态（还没开出这个流）', async () => {
    const r = await runFlowGraph(
      streamGraph({ text: 'abcdefgh', stream_chunk_size: 4 }),
      {
        callApi: (api) => {
          if (api !== 'send_stream_message') return { status: 'ok' }
          throw new Error('网络中断')
        },
      },
    )
    expect(r.actions).toHaveLength(1)
  })
})
