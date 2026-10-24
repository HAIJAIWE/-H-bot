// src/main/services/segmentTranslator.ts
//
// 消息段 → **官方 API 可发送形态** 的纯函数翻译层。
//
// ## 为什么要有这个文件
//
// 在它之前，`message_send(mode='segment')` 的消息段只经过翻译器的 `extractText`，
// 而那个函数**只认 `type === 'text'` 的段** —— 于是 `message_op` 产出的
// image / record / face / share / music / poke / reply 段全部被丢掉，
// 最后发出一条 `content: ''` 的空消息：不报错、不告警、内容是错的。
//
// 这里把「段 → 能发给官方的东西」收成**不依赖 WS / electron 的纯函数**，
// 于是它是唯一可单测的入口，也是 `segment` 模式与 `media` 模式的共同底座。
//
// ## 官方只有三种消息类型（msg_type 0/2/7）
//
// 所以一条消息里**不可能同时有文本和图片**：文本走 0，媒体走 7。
// 调用方按「先文本、后媒体」的顺序发多条（每次递增 msg_seq，否则被官方去重）。
//
// ## 媒体来源：直链或本地文件
//
// http(s) 直链由官方**服务端去拉**再转存（要求公网可访问）；
// 本地文件（`C:\...`、`/tmp/x.png`）走官方**分片上传**，无需公网暴露。
// 两者都不是的输入进 `unsupported` 并给出可读原因，**绝不静默丢弃**。
import { mediaFileTypeOf, isLocalFileSource } from './official'

export interface MediaPart {
  /** 官方 file_type：1 图片 / 2 视频 / 3 语音 / 4 文件 */
  fileType: 1 | 2 | 3 | 4
  url: string
  fileName?: string
}

export interface TranslatedSegments {
  /** 文本段拼装结果（`at` 段按能否映射到 openid 决定是 `<@openid>` 还是 `@QQ号`） */
  text: string
  /** 需要「先上传拿 file_info、再用 msg_type=7 发送」的部分 */
  media: MediaPart[]
  /** `reply` 段解析出的引用标识（REFIDX）；空串表示没有引用 */
  reference: string
  /** 无法映射到官方能力的段类型（含本地路径），调用方必须**报出来** */
  unsupported: string[]
  /** 能发但降级了的情况（如 at 映射不到 openid） */
  warnings: string[]
}

export interface TranslateOptions {
  /** QQ 号 → 官方 openid；返回 undefined 表示映射不到 */
  resolveOpenid: (uid: string) => string | undefined
  /** 消息 id / REFIDX → REFIDX；返回空串表示解析失败 */
  resolveRefIdx: (v: string) => string
}

/** 这些段类型能走官方富媒体（msg_type=7），值是官方的媒体类型名 */
const MEDIA_SEGMENT_TYPES: Record<string, string> = {
  image: 'image',
  record: 'record',
  voice: 'record',
  video: 'video',
  file: 'file',
}

/** 官方要服务端可拉取的 URL；本地文件则走分片上传，两者都算合法来源 */
function isSendableSource(v: string): boolean {
  return /^https?:\/\//i.test(v) || isLocalFileSource(v)
}

/**
 * 把各种输入形态归一化成「段数组」。
 *
 * 三种形态都要认（都是用户在画布上会实际接出来的形状）：
 *   · 数组 —— 标准形态；
 *   · 单个对象 —— `message_op` 输出的就是一个段（`{type:'image',data:{…}}`）；
 *   · JSON 字符串 —— `segments` 端口是 `dataType: 'json'`，用户常直接贴 JSON；
 *   · 普通字符串 —— 当纯文本发（比报「格式错误」更符合直觉）。
 */
export function normalizeSegments(input: unknown, warnings: string[]): unknown[] {
  if (input === null || input === undefined) return []
  if (Array.isArray(input)) return input
  if (typeof input === 'object') return [input]
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch (e) {
        // 看着像 JSON 但解析失败：必须说出来，否则用户只会看到"没有可发送的内容"
        warnings.push(`消息段 JSON 解析失败，已按纯文本发送: ${e instanceof Error ? e.message : String(e)}`)
        return [{ type: 'text', data: { text: input } }]
      }
    }
    return [{ type: 'text', data: { text: input } }]
  }
  return [{ type: 'text', data: { text: String(input) } }]
}

/**
 * 官方附件（用户发来的图片/语音/视频/文件）→ 消息段。
 *
 * 接收侧用：翻译器构造运行时事件时把附件挂进 `message`，
 * 这样 `get_context` 的 `message_part` 与表达式才看得到。
 * `content_type` 是 MIME（`image/png`）或官方自定义值（`voice`/`file`）。
 */
export function attachmentsToSegments(
  attachments: unknown,
): Array<{ type: string; data: Record<string, unknown> }> {
  if (!Array.isArray(attachments)) return []
  const out: Array<{ type: string; data: Record<string, unknown> }> = []
  for (const item of attachments) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const contentType = String(a.contentType ?? a.content_type ?? '')
    const url = String(a.url ?? '')
    if (!url) continue
    const filename = String(a.filename ?? '')
    const size = a.size
    const width = a.width
    const height = a.height
    const base = { file: url, url, filename, size, width, height, content_type: contentType }
    const lower = contentType.toLowerCase()
    if (lower.startsWith('image/')) out.push({ type: 'image', data: base })
    else if (lower.startsWith('video/')) out.push({ type: 'video', data: base })
    else if (lower.startsWith('audio/') || lower === 'voice') out.push({ type: 'record', data: base })
    else out.push({ type: 'file', data: { ...base, name: filename } })
  }
  return out
}

/**
 * 翻译消息段。**纯函数**，不发送、不碰网络。
 *
 * 调用方拿到结果后：先发 `text`（若有），再逐个上传+发送 `media`；
 * `unsupported` 非空时必须让用户看见（否则就是本文开头描述的那种静默失效）。
 */
export function translateSegments(segments: unknown, opts: TranslateOptions): TranslatedSegments {
  const warnings: string[] = []
  const unsupported: string[] = []
  const media: MediaPart[] = []
  const textParts: string[] = []
  let reference = ''

  for (const raw of normalizeSegments(segments, warnings)) {
    if (!raw || typeof raw !== 'object') {
      unsupported.push(`无法识别的段: ${JSON.stringify(raw)}`)
      continue
    }
    const seg = raw as Record<string, unknown>
    const type = String(seg.type ?? '')
    const data = (seg.data && typeof seg.data === 'object' ? seg.data : {}) as Record<string, unknown>

    // 媒体段：能走 msg_type=7
    const mediaType = MEDIA_SEGMENT_TYPES[type]
    if (mediaType) {
      const url = String(data.file ?? data.url ?? '')
      if (!url) {
        unsupported.push(`${type} 段缺少 file/url`)
        continue
      }
      if (!isSendableSource(url)) {
        // 既不是直链又不是本地存在的文件 —— 必须说出来，绝不静默丢弃。
        // （http(s) 直链由官方服务端拉取；本地文件走分片上传，无需公网暴露）
        unsupported.push(
          `${type} 段既不是 http(s) 直链，也不是本机存在的文件（${url}）：直链需公网可访问，本地文件需填绝对路径`,
        )
        continue
      }
      const fileType = mediaFileTypeOf(mediaType)
      if (fileType === null) {
        unsupported.push(`${type} 段无法映射到官方媒体类型`)
        continue
      }
      const fileName = String(data.name ?? data.filename ?? '')
      media.push(fileName ? { fileType, url, fileName } : { fileType, url })
      continue
    }

    switch (type) {
      case 'text':
        textParts.push(String(data.text ?? ''))
        break

      case 'at': {
        const qq = String(data.qq ?? '')
        if (!qq) {
          unsupported.push('at 段缺少 qq')
          break
        }
        const openid = opts.resolveOpenid(qq)
        if (openid) {
          textParts.push(`<@${openid}>`)
        } else {
          // 映射不到 openid 就退成纯文本 @QQ号，并说明原因（不能悄悄变成空）
          textParts.push(`@${qq}`)
          warnings.push(`at 段（QQ ${qq}）未映射到 openid，已降级为纯文本「@${qq}」`)
        }
        break
      }

      case 'reply': {
        const id = String(data.id ?? '')
        if (!id) {
          unsupported.push('reply 段缺少 id')
          break
        }
        const ref = opts.resolveRefIdx(id)
        if (!ref) {
          unsupported.push(
            `reply 段引用的消息（${id}）找不到 REFIDX：QQ 官方只支持引用「本会话内收到或发出过的消息」`,
          )
          break
        }
        reference = ref
        break
      }

      case 'share': {
        // 官方没有链接分享卡片（那是 ark，只能收不能发）→ 降级为文本链接
        const url = String(data.url ?? '')
        if (!url) {
          unsupported.push('share 段缺少 url')
          break
        }
        const title = String(data.title ?? '')
        textParts.push(title ? `${title} ${url}` : url)
        warnings.push('share 段的链接卡片官方不支持发送，已降级为文本链接')
        break
      }

      default:
        // face / poke / music / forward 等：官方发送侧没有对应能力
        unsupported.push(type || '(缺少 type 的段)')
        break
    }
  }

  return { text: textParts.join(''), media, reference, unsupported, warnings }
}
