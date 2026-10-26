/**
 * 线程**正文搜索**的纯函数（第 57 批）。
 *
 * 上游语义来自 DSH 的 `dsh-session-query`（按查询读会话、有长度上限与命中窗口），
 * 但这里刻意只保留"人能理解"的三件事：子串、不区分大小写、每处命中给出前后文。
 * 正则不做（用户输入里的 `.` `*` 会变成语法，回溯还是可控性问题），
 * 模糊评分也不做（"看起来像"的排序无法解释给用户听）。
 *
 * 独立的理由：主进程（扫盘）与控制台之外的调用方都要同一套口径 ——
 * 口径分两处写，早晚会出现"界面命中、主进程不命中"这种无法排查的分歧。
 */

/** 查询串的码点上限：再长就不是"找一句话"，而是贴了一整段进去 */
export const THREAD_SEARCH_QUERY_MAX_CHARS = 120
/** 每条线程最多交回几处命中 —— 浮层只有 208px 宽，多了就是噪音 */
export const THREAD_SEARCH_HITS_PER_THREAD = 3
/** 一次最多交回几条线程（剩下的交给用户把查询写具体） */
export const THREAD_SEARCH_MAX_RESULTS = 12
/** 命中片段前后各留多少码点（界面自己决定要不要加省略号） */
export const THREAD_SEARCH_SNIPPET_RADIUS = 24

/** 只搜这两种角色：`attempt` 是诊断行，不是会话内容 */
export type ThreadSearchRole = 'user' | 'assistant'

export interface ThreadSearchEntryLike {
  role?: string
  content?: string
}

export interface ThreadSearchHit {
  /** 命中条目在条目数组里的下标（界面用来做"跳到那一轮"） */
  index: number
  role: ThreadSearchRole
  /** 命中词**之前**的原文（最多 RADIUS 个码点） */
  before: string
  /** 命中词原文（大小写与原文一致） */
  match: string
  /** 命中词**之后**的原文（最多 RADIUS 个码点） */
  after: string
  /** `before` 之前还有没显示的原文（界面据此加前省略号） */
  moreBefore: boolean
  /** `after` 之后还有没显示的原文（界面据此加后省略号） */
  moreAfter: boolean
}

/**
 * 查询归一：trim → 连续空白折叠成一个空格 → 转小写 → 截到码点上限。
 *
 * 为什么要折叠空白：用户从聊天记录里复制一段话，常带上换行与全角空格，
 * 而正文里那一句可能是一行 —— 不折叠就搜不到"自己刚贴过的那句话"。
 * 为什么要按**码点**截断：`slice` 会切碎 emoji 的代理对，显示成两个问号。
 */
export function normalizeThreadSearchQuery(raw: string): string {
  const folded = String(raw ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
  const chars = Array.from(folded)
  if (chars.length <= THREAD_SEARCH_QUERY_MAX_CHARS) return folded
  return chars.slice(0, THREAD_SEARCH_QUERY_MAX_CHARS).join('')
}

/**
 * 单字符折叠。
 *
 * `İ`（U+0130）这类字符小写后会**变成两个码点**，直接对整串 `toLowerCase()`
 * 再按 indexOf 取下标，下标就和原文对不上了（切出来的片段会错位）。
 * 所以逐个码点折叠、取小写结果的首个码点 —— 对 ASCII 完全等价，
 * 对极少数展开字符退化成"首码点相同即算命中"，这对搜索结果来说足够。
 */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase()
  return lower.length === 0 ? ch : Array.from(lower)[0]
}

/**
 * 在一条线程的条目里找命中。
 *
 * 口径：**一处命中 = 一个条目的第一处出现**。同一个条目里出现十次也只算一处 ——
 * 用户要的是"这话在哪一轮"，不是"这个词出现几次"。
 *
 * @param entries 线程条目（`role` / `content`；其它字段忽略）
 * @param query 用户原始查询（本函数内部会归一，调用方不必先归一）
 * @param hitsPerThread 上限，默认 {@link THREAD_SEARCH_HITS_PER_THREAD}
 */
export function matchThreadEntries(
  entries: readonly ThreadSearchEntryLike[],
  query: string,
  hitsPerThread: number = THREAD_SEARCH_HITS_PER_THREAD,
): ThreadSearchHit[] {
  const normalized = normalizeThreadSearchQuery(query)
  if (!normalized || hitsPerThread <= 0) return []
  const needle = Array.from(normalized)
  const hits: ThreadSearchHit[] = []
  for (let index = 0; index < entries.length; index += 1) {
    if (hits.length >= hitsPerThread) break
    const entry = entries[index]
    const role = entry?.role
    if (role !== 'user' && role !== 'assistant') continue
    const content = typeof entry?.content === 'string' ? entry.content : ''
    if (!content) continue
    const chars = Array.from(content)
    if (chars.length < needle.length) continue
    const folded = chars.map(foldChar)
    let start = -1
    for (let i = 0; i + needle.length <= folded.length; i += 1) {
      let matched = true
      for (let k = 0; k < needle.length; k += 1) {
        if (folded[i + k] !== needle[k]) {
          matched = false
          break
        }
      }
      if (matched) {
        start = i
        break
      }
    }
    if (start < 0) continue
    const from = Math.max(0, start - THREAD_SEARCH_SNIPPET_RADIUS)
    const to = Math.min(chars.length, start + needle.length + THREAD_SEARCH_SNIPPET_RADIUS)
    hits.push({
      index,
      role,
      before: chars.slice(from, start).join(''),
      match: chars.slice(start, start + needle.length).join(''),
      after: chars.slice(start + needle.length, to).join(''),
      moreBefore: from > 0,
      moreAfter: to < chars.length,
    })
  }
  return hits
}

/**
 * 命中片段拼成人读的一行（界面与导出共用）。
 *
 * 为什么放在 shared 而不是渲染层：真机探针要断言"界面显示的那行字"，
 * 得有一个不依赖 React 的同一份口径；否则探针只能靠正则猜 DOM。
 */
export function formatThreadSearchSnippet(hit: ThreadSearchHit): string {
  const prefix = hit.moreBefore ? '…' : ''
  const suffix = hit.moreAfter ? '…' : ''
  return `${prefix}${hit.before}${hit.match}${hit.after}${suffix}`
}
