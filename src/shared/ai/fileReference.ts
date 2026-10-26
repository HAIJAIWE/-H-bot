// src/shared/ai/fileReference.ts
//
// `@` 文件引用的**纯文本**口径（第 58 批，对照 DSH `dsh-file-reference`）。
//
// 三件事，全部是纯函数，渲染层与测试共用：
//   1. 认"光标正处在一个 @token 里"（两条正则：带引号的允许空格、裸的遇到空白就断）；
//   2. 选中一条候选后**只插路径文本**（`@src/foo.ts`），绝不塞文件内容 ——
//      模型要看内容必须自己调 read_file，这条是上游的硬设计（原因见设计文档 §58.2）；
//   3. 给模型的那段说明。没有 read_file 工具时它必须是空串，否则等于骗模型"你能去看"。
//
// 路径里的 `"` 或控制字符**不产出 mention**（返回 null）—— 不转义、不猜测，
// 因为提示词里 `@"..."` 的语义是"引号里就是路径"，转义反而会和真实文件名打架。

/** 一次检索的结果（主进程）与一条候选（渲染层）共用的最小形状 */
export type FileReferenceKind = 'file' | 'directory'

export interface FileReference {
  /** 工作区相对路径（目录不带尾斜杠，插入时再加） */
  path: string
  kind: FileReferenceKind
}

/** 一次最多给几条（上游 `DEFAULT_FILE_SEARCH_MAX_RESULTS`） */
export const FILE_REFERENCE_MAX_RESULTS = 20

/** 光标处正在输入的查询；`start` 是那个 `@` 的下标（替换从这里开始） */
export interface ActiveFileReferenceQuery {
  /** `@` 之后到光标为止的文本（**不**含 `@` 与引号） */
  query: string
  /** 被替换区间的起点：`@` 的位置 */
  start: number
  /** 用户自己打了开引号（影响插入时是否补引号） */
  quoted: boolean
}

/** 带引号的形态：`@"a b`（允许空格，未闭合也算合法 —— 还在输入中） */
const QUOTED_TAIL = /(?:^|\s)@"([^"]*)$/u
/** 裸形态：`@a/b`（不含空白）；`@` 必须在行首或空白之后，否则 `me@example.com` 会误触发 */
const BARE_TAIL = /(?:^|\s)@([^\s]*)$/u

/**
 * 光标前正在输入的 `@` 查询。
 *
 * 只在**光标正好落在 token 末尾**时成立：中间点一下光标（`@src/fo|o/bar.ts`）不该弹菜单，
 * 那会把"用户只是想改中间一个字"变成"整段被候选替换掉"。
 */
export function findActiveFileReferenceQuery(
  text: string,
  caret: number,
): ActiveFileReferenceQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null
  const before = text.slice(0, caret)
  const next = text.slice(caret, caret + 1)
  const quoted = QUOTED_TAIL.exec(before)
  if (quoted) {
    // 光标后面还有内容、且不是收尾（空白或收引号）→ 光标在 token 中间，不弹
    if (next && !/[\s"]/u.test(next)) return null
    const query = quoted[1] ?? ''
    return { query, start: caret - query.length - 2, quoted: true }
  }
  const bare = BARE_TAIL.exec(before)
  if (bare) {
    // 同上：`@src/fo|o/bar.ts` 这种中间落点不弹，否则候选会把后面半截路径盖掉
    if (next && !/\s/u.test(next)) return null
    const query = bare[1] ?? ''
    return { query, start: caret - query.length - 1, quoted: false }
  }
  return null
}

/** 路径里出现这些字符就不给 mention（上游同口径：不转义、直接放弃） */
const UNREPRESENTABLE = /[\u0000-\u001f\u007f-\u009f"]/u

/**
 * 一条候选 → 插进输入框的文本。
 *
 * - 文件：无空格 → `@a/b.ts`；有空格 → `@"a b.ts"`（**成对**闭合，因为选完就落定了）。
 * - 目录：无空格 → `@a/b/`；有空格 → `@"a b/`（**故意不闭合**：选完还要继续下钻，
 *   闭合的引号会让下钻后的路径变成 `@"a b/"c.ts`，用户得手工删引号）。
 * - `preserveQuote`：用户本来就是用引号开始输入的，保持引号形态（否则他打的 `@"` 会消失）。
 */
export function formatFileReferenceMention(
  reference: FileReference,
  preserveQuote = false,
): string | null {
  const base = reference.kind === 'directory' ? `${reference.path}/` : reference.path
  if (!base || UNREPRESENTABLE.test(base)) return null
  if (!(preserveQuote || /\s/u.test(base))) return `@${base}`
  if (reference.kind === 'directory') return `@"${base}`
  return `@"${base}"`
}

/** 选中后的结果：新文本、新光标、菜单是否继续开着（下钻目录时为 true） */
export interface FileReferencePickResult {
  text: string
  caret: number
  /** true = 插进去的是可编辑文本、菜单继续列这个目录（上游 `drill`） */
  drill: boolean
}

/**
 * 把一条候选写进输入框。
 *
 * `action`：
 * - `settle`（点击 / Enter）：整个目录或文件落定。文件后面补一个空格（否则接着打字会
 *   粘在路径上变成 `@a.ts然后`）；目录后面**不补空格**，因为落定目录后通常直接发消息。
 * - `drill`（Tab）：只用于目录，插入 `@dir/` 且不补空格，菜单继续列这个目录。
 *
 * 返回 `null` = 这条候选无法安全表达（路径含引号/控制字符），调用层保持原样即可。
 */
export function applyFileReferencePick(
  text: string,
  active: ActiveFileReferenceQuery,
  reference: FileReference,
  action: 'settle' | 'drill' = 'settle',
): FileReferencePickResult | null {
  const drill = action === 'drill' && reference.kind === 'directory'
  const mention = formatFileReferenceMention(reference, active.quoted)
  if (mention === null) return null
  const tailEnd = active.start + 1 + (active.quoted ? 1 : 0) + active.query.length
  // 文件后面补一个空格（否则接着打字会粘在路径上）；原来 token 后面已经跟着空白就不再补
  const followedBySpace = /\s/u.test(text.slice(tailEnd, tailEnd + 1))
  const suffix = drill || reference.kind === 'directory' || followedBySpace ? '' : ' '
  const next = `${text.slice(0, active.start)}${mention}${suffix}${text.slice(tailEnd)}`
  // 光标落在 token 之后、那个已有空白之**后**（否则接着打字会插在路径与空格之间）
  const advance = suffix.length || (followedBySpace ? 1 : 0)
  return { text: next, caret: active.start + mention.length + advance, drill }
}

/**
 * 给模型的说明（上游原文逐字搬，只改工具名 `read` → `read_file`）。
 *
 * **条件注入**：调用方在"没有 read_file 工具"时必须传空串 —— 上游注释的理由是
 * "让模型自己去看"这条路不存在时，这段提示词就是骗它去调一个不存在的工具。
 */
export const FILE_REFERENCE_PROMPT =
  'Tokens prefixed with @ are paths the user explicitly referenced. ' +
  'Relative paths resolve from the workspace root; absolute paths identify files or ' +
  'directories on the host. A trailing slash marks a directory: list it when its contents ' +
  'matter. Anything else is a file: use the read_file tool when its contents are needed, ' +
  'and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'

/** 已插入的 mention 再解析回路径（渲染层做 chip 高亮/测试用）：尾斜杠决定目录还是文件 */
const MENTION_TOKEN = /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？]+$/u
/** 裸 token 里出现中文标点就截断：那基本是句读，不是文件名（引号形态不受影响） */
const CJK_PUNCTUATION = /[，。；：！？、]/u

export function parseFileReferenceMentions(text: string): FileReference[] {
  const out: FileReference[] = []
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const token = match[1] ?? ''
    const bare = token.startsWith('@"') ? token : (token.split(CJK_PUNCTUATION)[0] ?? token)
    const trimmed = bare.startsWith('@"') ? bare : bare.replace(TRAILING_PUNCTUATION, '')
    const path = trimmed.slice(1).replace(/^"|"$/gu, '')
    if (!path) continue
    out.push({ path: path.replace(/\/$/u, ''), kind: path.endsWith('/') ? 'directory' : 'file' })
  }
  return out
}
