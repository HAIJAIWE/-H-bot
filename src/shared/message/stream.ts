// src/shared/message/stream.ts
//
// 「流式消息」的分片计划 —— **纯函数**，与 compose.ts 同构（不发送任何东西，只算切片）。
//
// ## 官方协议（https://bot.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_stream_messages.post.html）
//
// · 端点固定 `POST /v2/users/{openid}/stream_messages` —— **只有单聊**，群聊没有这个接口；
// · 每个分片带同一个 `stream_msg_id`（**首片不带**，由服务端生成并在响应里返回），`index` 从 0 递增；
// · `input_state`：`1` = 生成中，`10` = 生成结束 —— 末片必须是 10，否则对方界面永远停在「生成中」；
// · `input_mode`：`append`（默认，`content_raw` 是**增量**） / `replace`（`content_raw` 是**全量正文**，
//   且必须以上一次已下发的内容为前缀，否则报 40007「已下发内容前缀不可修改」）。
//
// 本模块产出的是 **append 模式的增量片**：每片只带这一片的新增文本，
// 天然满足"前缀不可修改"，也不需要把全文反复传上去。
//
// ## 切片规则（为什么不能直接 slice）
//
// 1. 按**码点**切（`Array.from`）：`'😀'.length === 2`，用 `slice` 会把代理对劈成两半，
//    切出来的半截 emoji 在客户端是乱码方块；
// 2. 在窗口**后半段**优先找标点/换行断开：句子读到一半突然截断的观感很差，
//    后半段有断点就提前断，没有就按窗口硬切（长句也不会卡住）；
// 3. `chunkSize <= 0` / 非数字 → 回退默认值，不能因为一个 0 让整条消息发不出去；
// 4. 空文本 → `[]`（调用方据此报错，而不是发一条空消息）。

/** 单片默认长度（码点数）。够短才有"逐字出现"的流式观感，又不至于把接口刷爆 */
export const STREAM_DEFAULT_CHUNK_SIZE = 50

/**
 * 分片数上限保护。
 *
 * 官方限频 50 QPS，`intervalMs` 默认 300ms —— 200 片已经是 60 秒的推送，
 * 再长就不该用流式而该用普通消息了。超限时余下的文本并进最后一片，不丢内容。
 */
export const STREAM_MAX_CHUNKS = 200

/** 优先断句的字符：句末标点 + 换行 + 逗号顿号（后半段窗口里命中就提前断） */
const BREAK_CHARS = new Set([
  '\n',
  '。',
  '！',
  '？',
  '；',
  '…',
  '.',
  '!',
  '?',
  ';',
  '，',
  ',',
  '、',
  '：',
  ':',
])

/** 一个分片：`contentRaw` 是这一片的**增量**文本（append 模式） */
export interface StreamChunk {
  /** 分片序号，从 0 递增 */
  index: number
  /** 1 = 生成中，10 = 生成结束（末片） */
  inputState: 1 | 10
  /** 本片文本（增量） */
  contentRaw: string
}

export interface StreamChunkOptions {
  /** 单片长度（码点数）。`<=0` 或非数字 → 用默认值 */
  chunkSize?: number
}

/**
 * 把完整文本切成 `append` 模式的增量分片序列。
 *
 * 返回的最后一个分片的 `inputState` 一定是 `10`；前面都是 `1`。
 * 文本为空时返回 `[]`。
 */
export function buildStreamChunkPlan(
  text: string,
  opts: StreamChunkOptions = {},
): StreamChunk[] {
  const chars = Array.from(String(text ?? ''))
  if (chars.length === 0) return []

  const raw = Number(opts.chunkSize)
  const size = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : STREAM_DEFAULT_CHUNK_SIZE

  const pieces: string[] = []
  let cursor = 0
  while (cursor < chars.length) {
    let end = Math.min(cursor + size, chars.length)
    if (end < chars.length) {
      // 只在窗口后半段找断点：前半段就断会让每片过短，失去"一次显示一段"的效果
      const earliest = cursor + Math.floor(size / 2)
      for (let i = end; i > earliest; i--) {
        if (BREAK_CHARS.has(chars[i - 1])) {
          end = i
          break
        }
      }
    }
    pieces.push(chars.slice(cursor, end).join(''))
    cursor = end
  }

  // 分片数超限：把多出来的并进最后一片（宁可末片长一点，也不丢内容）
  if (pieces.length > STREAM_MAX_CHUNKS) {
    const merged = pieces.slice(0, STREAM_MAX_CHUNKS - 1)
    merged.push(pieces.slice(STREAM_MAX_CHUNKS - 1).join(''))
    pieces.length = 0
    pieces.push(...merged)
  }

  const last = pieces.length - 1
  return pieces.map((contentRaw, index) => ({
    index,
    inputState: (index === last ? 10 : 1) as 1 | 10,
    contentRaw,
  }))
}
