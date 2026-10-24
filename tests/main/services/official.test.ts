import { describe, it, expect } from 'vitest'
import {
  wrapKeyboardForApi,
  buildMessageBody,
  clampInputSeconds,
} from '../../../src/main/services/official/messages'
import { mediaFileTypeOf } from '../../../src/main/services/official/media'
import { parseMessageSceneExt } from '../../../src/main/services/official/scene'
import { parseOfficialEvent } from '../../../src/main/services/official/ws'

describe('wrapKeyboardForApi', () => {
  it('模板格式（含 id 字段）原样返回', () => {
    const keyboard = { id: '123' }
    const result = wrapKeyboardForApi(keyboard, '102345678')
    expect(result).toEqual({ id: '123' })
  })

  it('已经是自定义格式（含 content 字段）原样返回', () => {
    const keyboard = {
      content: {
        rows: [{ buttons: [] }],
        bot_appid: 102345678
      }
    }
    const result = wrapKeyboardForApi(keyboard, '102345678')
    expect(result).toEqual(keyboard)
  })

  it('简化格式（含 rows 字段）包装为 { content: { rows, bot_appid } }', () => {
    const keyboard = {
      rows: [
        {
          buttons: [
            {
              id: 'btn1',
              render_data: { label: '按钮1', style: 1 },
              action: { type: 2, permission: { type: 2 }, data: '/cmd' }
            }
          ]
        }
      ]
    }
    const result = wrapKeyboardForApi(keyboard, '102345678') as {
      content: { rows: unknown[]; bot_appid: number }
    }
    expect(result.content).toBeDefined()
    expect(result.content.rows).toEqual(keyboard.rows)
    expect(result.content.bot_appid).toBe(102345678)
  })

  it('无效 appId 时 bot_appid 为 0', () => {
    const keyboard = { rows: [] }
    const result = wrapKeyboardForApi(keyboard, 'not-a-number') as {
      content: { rows: unknown[]; bot_appid: number }
    }
    expect(result.content.bot_appid).toBe(0)
  })

  it('空字符串 appId 时 bot_appid 为 0', () => {
    const keyboard = { rows: [] }
    const result = wrapKeyboardForApi(keyboard, '') as {
      content: { rows: unknown[]; bot_appid: number }
    }
    expect(result.content.bot_appid).toBe(0)
  })

  it('其他格式原样返回（让 QQ API 报错便于排查）', () => {
    const keyboard = { unknown_field: 'xxx' }
    const result = wrapKeyboardForApi(keyboard, '102345678')
    expect(result).toEqual({ unknown_field: 'xxx' })
  })

  it('空 rows 数组也会被包装', () => {
    const keyboard = { rows: [] }
    const result = wrapKeyboardForApi(keyboard, '102345678') as {
      content: { rows: unknown[]; bot_appid: number }
    }
    expect(result.content).toBeDefined()
    expect(Array.isArray(result.content.rows)).toBe(true)
    expect(result.content.rows.length).toBe(0)
    expect(result.content.bot_appid).toBe(102345678)
  })
})

describe('buildMessageBody', () => {
  /**
   * 官方发消息的载荷契约是 `{ body, error }`（与 sendOfficialMessage 同一约定）：
   * 成功时 body 非空、error 为空串；本地就不该发的组合（例如输入中状态给群聊）
   * 返回 `{ body: null, error: 原因 }`。测试只走成功路径，失败路径单独钉。
   */
  function bodyOf(
    chatType: string,
    content: string,
    options: Record<string, unknown>,
    appId = '102345678',
  ) {
    const built = buildMessageBody(chatType, content, options, appId)
    expect(built.error).toBe('')
    expect(built.body).not.toBeNull()
    return built.body!
  }

  it('默认 msg_type=0，内容进 content', () => {
    expect(bodyOf('c2c', '你好', {})).toEqual({ msg_type: 0, content: '你好' })
  })

  it('msg_type=2 + markdown 时进 markdown 字段，且不带 content', () => {
    const body = bodyOf('c2c', 'ignored', { msgType: 2, markdown: { content: '# 标题' } })
    expect(body).toEqual({ msg_type: 2, markdown: { content: '# 标题' } })
    expect(body.content).toBeUndefined()
  })

  it('msg_type=2 + markdown + keyboard 时 keyboard 被包装进 content 字段', () => {
    const body = bodyOf('c2c', '', {
      msgType: 2,
      markdown: { content: 'x' },
      keyboard: { rows: [] },
    })
    expect(body.keyboard).toEqual({ content: { rows: [], bot_appid: 102345678 } })
  })

  it('msg_type=7 + media 时进 media.file_info（keyboard 不带）', () => {
    const body = bodyOf('c2c', '', {
      msgType: 7,
      media: { fileInfo: 'FILE_INFO_X' },
      keyboard: { rows: [] },
    })
    expect(body.media).toEqual({ file_info: 'FILE_INFO_X' })
    expect(body.keyboard).toBeUndefined()
    expect(body.content).toBeUndefined()
  })

  it('is_wakeup 与 msg_id/event_id 互斥：为 true 时后两者都不带', () => {
    const body = bodyOf('c2c', '召回', { isWakeup: true, eventId: 'E1', msgId: 'M1' })
    expect(body.is_wakeup).toBe(true)
    expect(body.event_id).toBeUndefined()
    expect(body.msg_id).toBeUndefined()
  })

  it('is_wakeup 为 false/缺省时正常带 event_id 与 msg_id', () => {
    const body = bodyOf('c2c', '回复', { eventId: 'E1', msgId: 'M1' })
    expect(body.event_id).toBe('E1')
    expect(body.msg_id).toBe('M1')
    expect(body.is_wakeup).toBeUndefined()
  })

  it('message_reference 与 msg_type=2 组合仍生效（引用不能单独发）', () => {
    const body = bodyOf('c2c', '', {
      msgType: 2,
      markdown: { content: '# x' },
      messageReference: { message_id: 'REFIDX_abc' },
      msgId: 'M1',
    })
    expect(body.message_reference).toEqual({ message_id: 'REFIDX_abc' })
    expect(body.msg_id).toBe('M1')
  })

  it('msg_seq 透传（0 也要带上，否则被官方去重）', () => {
    expect(bodyOf('c2c', 'x', { msgSeq: 0 }).msg_seq).toBe(0)
    expect(bodyOf('c2c', 'x', { msgSeq: 3 }).msg_seq).toBe(3)
    expect(bodyOf('c2c', 'x', {}).msg_seq).toBeUndefined()
  })

  it('msg_type=6 输入中状态：只带 input_notify，**不带 content**', () => {
    // 官方契约：msg_type=6 的内容字段是 input_notify；同时带 content 会被判
    // 22006「消息类型与内容不匹配」。默认 30 秒、上限 60 秒。
    const body = bodyOf('c2c', '这行不该出现', { msgType: 6 })
    expect(body.msg_type).toBe(6)
    expect(body.input_notify).toEqual({ input_type: 1, input_second: 30 })
    expect(body.content).toBeUndefined()
    expect(body.markdown).toBeUndefined()
  })

  it('msg_type=6 的时长被夹到 1~60（非法值回落默认 30）', () => {
    expect(bodyOf('c2c', '', { msgType: 6, inputNotifySeconds: 5 }).input_notify?.input_second).toBe(5)
    expect(bodyOf('c2c', '', { msgType: 6, inputNotifySeconds: 999 }).input_notify?.input_second).toBe(60)
    expect(bodyOf('c2c', '', { msgType: 6, inputNotifySeconds: 0 }).input_notify?.input_second).toBe(30)
    expect(bodyOf('c2c', '', { msgType: 6, inputNotifySeconds: -3 }).input_notify?.input_second).toBe(30)
  })

  it('输入中状态发给群聊时本地拒绝（官方只有单聊端点有这个字段）', () => {
    const built = buildMessageBody('group', '', { msgType: 6 }, '')
    expect(built.body).toBeNull()
    expect(built.error).toContain('输入中状态')
  })

  it('单聊/群聊带 ark 时本地拒绝（只有频道发送接口有 ark/embed）', () => {
    const built = buildMessageBody('c2c', 'x', { ark: { ark_type: 'x' } }, '')
    expect(built.body).toBeNull()
    expect(built.error).toContain('ARK')
  })

  it('clampInputSeconds 直接验证边界', () => {
    expect(clampInputSeconds(1)).toBe(1)
    expect(clampInputSeconds(60)).toBe(60)
    expect(clampInputSeconds(61)).toBe(60)
    expect(clampInputSeconds('45')).toBe(45)
    expect(clampInputSeconds(undefined)).toBe(30)
    expect(clampInputSeconds(NaN)).toBe(30)
  })
})

describe('mediaFileTypeOf', () => {
  it('四种媒体类型映射到官方 file_type', () => {
    expect(mediaFileTypeOf('image')).toBe(1)
    expect(mediaFileTypeOf('video')).toBe(2)
    expect(mediaFileTypeOf('record')).toBe(3)
    expect(mediaFileTypeOf('file')).toBe(4)
  })

  it('voice 是 record 的别名', () => {
    expect(mediaFileTypeOf('voice')).toBe(3)
  })

  it('大小写敏感：大写视为未知（OneBot 段类型与节点下拉本身就是小写）', () => {
    // 与 10/18 产物一致：这里不做 toLowerCase。调用方是段翻译器（段类型固定小写）
    // 与节点参数下拉（image/video/record/file），不需要兜底；真传了大写应当报错，
    // 而不是被悄悄当成图片发出去。
    expect(mediaFileTypeOf('IMAGE')).toBeNull()
  })

  it('未知类型返回 null（调用方必须明确报错，不能兜底成图片）', () => {
    expect(mediaFileTypeOf('sticker')).toBeNull()
    expect(mediaFileTypeOf('')).toBeNull()
  })
})

describe('parseMessageSceneExt', () => {
  it('解析 k=v 列表（官方形态）', () => {
    expect(parseMessageSceneExt(['msg_idx=REFIDX_a', 'auth_token=T1'])).toEqual({
      msg_idx: 'REFIDX_a',
      auth_token: 'T1',
    })
  })

  it('值里含 = 时只按第一个等号切', () => {
    expect(parseMessageSceneExt(['auth_token=abc=def'])).toEqual({ auth_token: 'abc=def' })
  })

  it('JSON 字符串条目也能解析', () => {
    expect(parseMessageSceneExt(['{"msg_idx":"REFIDX_b"}'])).toEqual({ msg_idx: 'REFIDX_b' })
  })

  it('非法输入返回空对象且不抛', () => {
    expect(parseMessageSceneExt(null)).toEqual({})
    expect(parseMessageSceneExt('not-array')).toEqual({})
    expect(parseMessageSceneExt(['no-equals-sign'])).toEqual({})
    expect(parseMessageSceneExt([123, null])).toEqual({})
    expect(parseMessageSceneExt(['=novalue'])).toEqual({})
  })
})

describe('parseOfficialEvent', () => {
  it('解析 attachments（图片带宽高）', () => {
    const ev = parseOfficialEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'm1',
      content: 'hi',
      author: { member_openid: 'u1' },
      attachments: [
        {
          content_type: 'image/png',
          filename: 'a.png',
          url: 'https://x/a.png',
          width: 100,
          height: 200,
          size: 1024,
        },
      ],
    })
    expect(ev.attachments).toHaveLength(1)
    expect(ev.attachments?.[0]).toMatchObject({
      contentType: 'image/png',
      filename: 'a.png',
      url: 'https://x/a.png',
      width: 100,
      height: 200,
      size: 1024,
    })
  })

  it('解析 ark_data（结构化卡片，只能收）', () => {
    const ev = parseOfficialEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'm2',
      ark_data: {
        ark_type: 'miniapp',
        ark_name: '小程序',
        prompt: '[小程序]',
        fields: { title: '标题', jump_url: 'https://x' },
      },
    })
    expect(ev.arkData).toMatchObject({
      arkType: 'miniapp',
      arkName: '小程序',
      fields: { title: '标题' },
    })
  })

  it('ark_data 是 JSON 字符串时也能解析', () => {
    const ev = parseOfficialEvent('X', { ark_data: '{"ark_type":"feed","fields":{"a":"b"}}' })
    expect(ev.arkData?.arkType).toBe('feed')
    expect(ev.arkData?.fields).toEqual({ a: 'b' })
  })

  it('解析 msg_elements（引用消息 103）', () => {
    const ev = parseOfficialEvent('X', {
      msg_elements: [{ message_type: 103, content: '被引用的原文' }],
    })
    expect(ev.msgElements).toHaveLength(1)
  })

  it('从 message_scene.ext 里取出 REFIDX', () => {
    const ev = parseOfficialEvent('X', {
      message_scene: { source: 'default', ext: ['msg_idx=REFIDX_xyz', 'auth_token=t'] },
    })
    expect(ev.messageScene?.refIdx).toBe('REFIDX_xyz')
    expect(ev.messageScene?.source).toBe('default')
  })

  it('缺字段时不崩、不产生多余属性', () => {
    const ev = parseOfficialEvent('X', { id: 'm3' })
    expect(ev.attachments).toBeUndefined()
    expect(ev.arkData).toBeUndefined()
    expect(ev.msgElements).toBeUndefined()
    expect(ev.messageScene).toBeUndefined()
  })
})
