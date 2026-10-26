// src/shared/ai/threadTitle.ts
//
// 会话标题的**归一与截断**（第 56 批，对照 DSH `packages/session/session-title/src/normalize.ts`）。
//
// 为什么单独放 shared、而不是写进主进程：
//   · "什么叫可见字符"必须是**一份**口径 —— 用户输入、模型生成、落盘读取都走同一套；
//   · 渲染层将来要在输入框里做即时校验/预览，也能直接 import 这份纯函数。
//
// 上游的三条硬规则，这里逐条照抄：
//   1. 先剥控制序列（ANSI/C0/C1/方向性字符），再折叠空白 —— 标题里出现 `ESC[31m` 是 bug 不是个性；
//   2. 截断按**码点**累加字节，绝不切出半个 UTF-8 字符（否则落盘/日志里会出现 replacement char）；
//   3. fallback 是"前 N 个词 + 字节上限"，不是"前 N 个字符"（词边界对中文以外的标题更自然）。
export type { ThreadTitleRecord, ThreadTitleSource } from './threadTitleTypes'

/** 标题硬上限：64 字节 ≈ 21 个汉字 / 64 个 ASCII 字符（上游默认 64 同值） */
export const THREAD_TITLE_MAX_BYTES = 64

/** fallback 标题取首条需求的**前几个词** */
export const THREAD_TITLE_FALLBACK_MAX_WORDS = 8

/** fallback 标题的字节上限（比硬上限更短，给列表留呼吸空间） */
export const THREAD_TITLE_FALLBACK_MAX_BYTES = 48

/** OSC 控制序列：ESC ] ... (BEL | ESC \) */
const OSC_SEQUENCE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
/** CSI 控制序列：ESC [ 参数 终止符 */
const CSI_SEQUENCE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g
/** 其余双字符 ESC 序列 */
const ESC_SEQUENCE = /\u001B[@-_]/g
/** C0/C1 控制字符（保留不了任何可见信息，全删） */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
/** 方向性/零宽控制字符（从右到左覆盖、零宽连接之类，用在标题里只会捣乱） */
const DIRECTIONAL_CONTROL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

const encoder = new TextEncoder()

/** 纯文本可见化：剥控制序列 + 折叠空白 + 去首尾空白 */
export function cleanTitleText(input: string): string {
  return String(input ?? '')
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 按 UTF-8 字节预算截断。
 *
 * 用 `for...of` 走码点（不是 `slice` 的 UTF-16 码元），再用 TextEncoder 算每个码点的字节数；
 * 放不下就停 —— 结果的前缀永远是可解码的完整字符串。
 */
export function truncateTitleUtf8(input: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return ''
  let out = ''
  let used = 0
  for (const codePoint of input) {
    const bytes = encoder.encode(codePoint).length
    if (used + bytes > maxBytes) break
    used += bytes
    out += codePoint
  }
  return out
}

/** 标题归一：清洗 + 64 字节截断 + 去尾部空白。空串 = 非法标题（调用方据此报错） */
export function normalizeThreadTitle(input: string): string {
  return truncateTitleUtf8(cleanTitleText(input), THREAD_TITLE_MAX_BYTES).trimEnd()
}

/** fallback：首条需求的前 N 个词，再按 fallback 字节上限截断 */
export function fallbackThreadTitle(firstUserText: string): string {
  const cleaned = cleanTitleText(firstUserText)
  if (!cleaned) return ''
  const words = cleaned.split(' ').filter(Boolean).slice(0, THREAD_TITLE_FALLBACK_MAX_WORDS)
  return truncateTitleUtf8(words.join(' '), THREAD_TITLE_FALLBACK_MAX_BYTES).trimEnd()
}
