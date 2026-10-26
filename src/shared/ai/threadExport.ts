/**
 * 线程 → **Markdown** 的纯函数（第 57 批）。
 *
 * 为什么导出 Markdown 而不是上游那样的"会话日志原始格式"：
 * DSH 导出的是**可再导入**的日志，本仓没有"导入会话"的需求；用户要的是能贴进
 * 文档 / 工单 / 日报的**人读**文本。所以这里只做一件事：把记忆条目渲染成人能读的东西，
 * 并在头信息带上**会话标识**（对账时能说清"是哪个线程"）。
 *
 * 明确不导出（见设计文档 §57.2）：`reasoning`（内部推理，长且不属于会话内容）、
 * 工具参数与结果原文（体积与隐私）。它们不是"忘了"——导出=把记忆文件原样倒出来，
 * 就等于把内部过程也一起交出去了。
 */

/** 单条正文的导出上限：与记忆写入侧 `historyStore.MAX_ENTRY_CHARS` 同源 */
export const THREAD_EXPORT_MAX_ENTRY_CHARS = 4000
/** 单次导出的条目上限：导出的东西比记忆文件本身还大没有意义 */
export const THREAD_EXPORT_MAX_ENTRIES = 2000
/** 文件名里标题部分的上限（码点）：Windows 的路径长度是有限的 */
const FILE_TITLE_MAX_CHARS = 40

export interface ThreadExportTraceLike {
  name?: string
  status?: string
}

export interface ThreadExportEntryLike {
  role?: string
  content?: string
  ts?: string
  /** 界面回看用的过程痕迹（只有 name/status 会被导出） */
  trace?: readonly ThreadExportTraceLike[]
  /** 这一轮的墙钟耗时（毫秒） */
  turnMs?: number
  /** `attempt` 行的失败原因 */
  reason?: string
}

export interface ThreadExportInput {
  title: string
  threadId: string
  projectName: string
  /** 已经格式化好的"导出时间"文案 —— 纯函数不碰时区与 locale */
  exportedAtLabel: string
  entries: readonly ThreadExportEntryLike[]
}

/** 把标题里 Windows 文件名非法字符换掉（不换就等于"保存"必然失败） */
function safeFileTitle(title: string): string {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    // Windows 不允许文件名以点或空格结尾
    .replace(/[. ]+$/u, '')
  if (!cleaned) return '对话'
  const chars = Array.from(cleaned)
  return chars.length > FILE_TITLE_MAX_CHARS
    ? chars.slice(0, FILE_TITLE_MAX_CHARS).join('')
    : cleaned
}

/**
 * 导出的默认文件名：`<标题>-<线程 id 前 6>-对话记录.md`。
 *
 * 为什么带线程 id：同一条对话被导出两次是常事，文件名一样就只能靠"（1）（2）"区分，
 * 而带 id 至少能对上"这是列表里哪一条"。
 */
export function exportThreadFileName(title: string, threadId: string): string {
  const shortId =
    String(threadId ?? '')
      .replace(/[^A-Za-z0-9_-]/gu, '')
      .slice(0, 6) || 'default'
  return `${safeFileTitle(title)}-${shortId}对话记录.md`
}

/** 正文截断：按码点切（`slice` 会切碎代理对），并明确标出"已截断" */
function clampContent(content: string): string {
  const chars = Array.from(content)
  if (chars.length <= THREAD_EXPORT_MAX_ENTRY_CHARS) return content
  return `${chars.slice(0, THREAD_EXPORT_MAX_ENTRY_CHARS).join('')}…（已截断）`
}

/** 正文渲染成引用块：空行也要带 `>`，否则 markdown 会把它当成两段、把引用切断 */
function quote(content: string): string {
  const text = content.length > 0 ? content : '（空）'
  return text
    .split('\n')
    .map(line => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
}

/** 工具行：只写名称与状态，不写参数/结果 */
function traceLine(trace: readonly ThreadExportTraceLike[]): string {
  const parts = trace
    .filter(t => typeof t?.name === 'string' && t.name.length > 0)
    .map(t => `${t.name}${t.status === 'error' ? ' ✗' : ' ✓'}`)
  if (parts.length === 0) return ''
  return `- 工具：${parts.join(' · ')}`
}

/**
 * 渲染整条线程为 Markdown。
 *
 * 结构固定（有测试钉着）：头信息 → 每轮的「用户 / 助手 / 工具」→ 未跑完的警告。
 * 为什么用 blockquote 装正文：正文里可能自带 `##`、`-`、表格 —— 直接铺平会被当成
 * 文档结构；引用块是最不容易被内容破坏的容器。
 */
export function renderThreadMarkdown(input: ThreadExportInput): string {
  const entries = Array.isArray(input.entries) ? input.entries : []
  const exported = entries.slice(0, THREAD_EXPORT_MAX_ENTRIES)
  const turns = exported.filter(e => e.role === 'user').length
  const lines: string[] = [
    `# ${input.title || '对话'}`,
    '',
    `- 会话：\`${input.threadId}\``,
    `- 项目：${input.projectName || '（未知）'}`,
    `- 导出时间：${input.exportedAtLabel}`,
    `- 规模：${turns} 轮 · ${exported.length} 条消息`,
    '',
    '---',
    '',
  ]
  let turn = 0
  for (const entry of exported) {
    const role = entry?.role
    const content = typeof entry?.content === 'string' ? clampContent(entry.content) : ''
    if (role === 'user') {
      turn += 1
      lines.push(`## 第 ${turn} 轮`, '', '**你**', '', quote(content), '')
      continue
    }
    if (role === 'assistant') {
      const took =
        typeof entry.turnMs === 'number' && entry.turnMs > 0
          ? `（用时 ${(entry.turnMs / 1000).toFixed(1)} 秒）`
          : ''
      lines.push(`**助手**${took}`, '', quote(content), '')
      if (Array.isArray(entry.trace)) {
        const tools = traceLine(entry.trace)
        if (tools) lines.push(tools, '')
      }
      continue
    }
    if (role === 'attempt') {
      const reason =
        typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : '未说明原因'
      lines.push(`> ⚠️ 这一轮没有跑完：${reason}`, '')
    }
  }
  if (entries.length > THREAD_EXPORT_MAX_ENTRIES) {
    lines.push(
      '---',
      '',
      `> 还有 ${entries.length - THREAD_EXPORT_MAX_ENTRIES} 条没有导出（单次上限 ${THREAD_EXPORT_MAX_ENTRIES} 条）。`,
      '',
    )
  }
  if (turn === 0 && exported.length === 0) lines.push('> 这条会话还没有任何消息。', '')
  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`
}
