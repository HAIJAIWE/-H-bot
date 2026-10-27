// src/main/services/agent-core/sessionSearchTool.ts
//
// `search_sessions`：让模型自己翻**这个项目的历史会话**（第 59 批）。
//
// ## 为什么值得给模型这个工具
//
// 已有的事实：每轮对话都落盘到 `.qqbat/ai-history-<线程>.jsonl`（memoryFile），
// 而模型**只看得见当前线程**的历史。于是"上次我们怎么解决的那个 bug"这类问题，
// 它只能猜或者让用户重述 —— 而答案其实就在隔壁线程的文件里。
//
// 上游 DSH 的对应物是 `dsh-tool-session-query`（`session_query`），
// 这里搬的是它的**两条行为契约**，其余按我方已有的实现（threadSearch.ts）；
// 那两条契约是"模型最容易踩的坑"：
//
// 1. **达上限要让模型知道**：结果被截断却不说，模型会以为"就这些"，然后基于残缺证据下结论。
// 2. **排除调用方自己那条线程**：不排除的话，模型会把"正在聊的这段"当成历史证据引用，
//    越搜越绕（而且它本来就已经看得见这段）。
//
// ## 为什么不放进 CORE_TOOLS
//
// `builtinHostPlugins.ts` 会校验「所有 CORE_TOOLS 都被某个领域插件认领」，
// 不认领就启动抛错。这个工具不归任何插件（像 `todo_write` 一样），
// 于是单独在 core.ts 里 `registerTool` —— 好处是预设的 plugins 白名单删不掉它。
import type { Tool } from './core'
import { searchProjectThreads } from '../ai/threadSearch'
import { formatThreadSearchSnippet, THREAD_SEARCH_MAX_RESULTS } from '@shared/ai/threadSearch'

/** 单次最多交回几条线程（与界面搜索同一个上限，理由见 shared/ai/threadSearch.ts） */
const MAX_RESULTS = THREAD_SEARCH_MAX_RESULTS
/** 交回的正文条目最多多少字符：命中片段本身很短，这条是给"标题 + 片段"整体兜底的 */
const MAX_TEXT_CHARS = 6000

/**
 * 把搜索结果排成模型能读的文本。
 *
 * 故意不用 JSON：模型读"按线程分组的几行字"比读一层嵌套 JSON 更不容易漏字段，
 * 而且省 token（键名重复 N 遍也是一笔钱）。
 */
function formatResult(
  payload: Awaited<ReturnType<typeof searchProjectThreads>>,
  excludedThreadId: string | undefined,
): string {
  const { query, results } = payload
  if (!query) return '查询为空：请给出至少一个字的关键词。'
  const visible = excludedThreadId ? results.filter(r => r.id !== excludedThreadId) : results
  if (visible.length === 0) {
    return `没有找到包含「${query}」的历史会话。换个说法再试（这个词可能是用户的口语，试试更具体的名词）。`
  }
  const lines: string[] = [`「${query}」命中 ${visible.length} 条历史会话（不含当前这段）：`]
  for (const hit of visible) {
    const when = new Date(hit.updatedAt).toISOString().slice(0, 16).replace('T', ' ')
    lines.push('')
    lines.push(`## ${hit.title}`)
    lines.push(`- 会话 ${hit.id} · 最后活动 ${when} · ${hit.messageCount} 条消息`)
    for (const h of hit.hits) {
      const who = h.role === 'user' ? '用户' : '助手'
      lines.push(`- ${who}：${formatThreadSearchSnippet(h)}`)
    }
  }
  /**
   * 达上限必须说出来：模型看不见"还有多少被截掉了"，
   * 不说它就会把这一页当成全集，然后基于残缺证据下结论。
   */
  if (visible.length >= MAX_RESULTS) {
    lines.push('')
    lines.push(
      `（已达上限 ${MAX_RESULTS} 条，可能还有更多：把查询写得更具体，或分开搜几个不同的词。）`,
    )
  }
  const text = lines.join('\n')
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) + '\n…（结果过长，已截断）' : text
}

/**
 * `search_sessions` 工具定义。
 *
 * ⚠️ 与 `todo_write` 同一个理由**不**进 `CORE_TOOLS`（见文件头），
 * 由 `core.ts` 单独 `registerTool`。
 */
export const SESSION_SEARCH_TOOL: Tool = {
  name: 'search_sessions',
  description:
    '在这个项目的**历史会话**里搜正文（子串、不区分大小写）。用来回答"我们之前是不是聊过/做过X"——' +
    '当前这段对话之外的线程都能搜到，当前线程自己会被排除（那部分你已经看得见）。' +
    '只返回命中的片段与出处，不会把整段对话塞给你；需要完整上下文时再用会话 id 让用户确认。',
  readOnly: true,
  category: 'query',
  executionMode: 'parallel',
  timeoutMs: 30_000,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '关键词或一句话片段（子串匹配，不区分大小写）。越长越准，别只给一个字。',
      },
      limit: {
        type: 'number',
        description: `最多返回几条线程（默认也是上限 ${MAX_RESULTS}）。`,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return '查询为空：请给出至少一个字的关键词。'
    const rawLimit = typeof args.limit === 'number' ? args.limit : MAX_RESULTS
    try {
      const payload = await searchProjectThreads(ctx.workspace, query, rawLimit)
      return formatResult(payload, ctx.threadId)
    } catch (e) {
      // 搜索失败不该让整轮崩：告诉模型"没搜成"，它可以改用 list_dir/read_file 直接找文件
      return `搜索历史会话时出错：${e instanceof Error ? e.message : String(e)}`
    }
  },
}
