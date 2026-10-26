// tests/renderer/components/ai/ThreadSearchResults.test.tsx
//
// 第 57 批：对话**正文**搜索的结果区（标题搜索之外的另一条路）。
// 钉住五件事：
//   · 有命中：标题 + 最多 3 条片段，命中词在 <mark> 里，小标题带条数；
//   · 每行 title 用共享函数的整段口径（hover 看完整上下文，省略号不自己拼）；
//   · 无命中 / 出错都要有话说（静默 = 用户以为"没聊过"）；
//   · 短查询（<2 字）**不发请求**，也不渲染这块；
//   · 250ms 防抖：连打两次只发最后那一下。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { formatThreadSearchSnippet } from '@shared/ai/threadSearch'
import type { ThreadSearchHit, ThreadSearchMatch } from '@renderer/stores/aiStore'
import { t } from '@renderer/i18n'
import { ThreadSearchResults } from '@renderer/components/ai/ThreadSearchResults'

afterEach(cleanup)

const PROJECT = 'E:/proj-a'

const hit = (over: Partial<ThreadSearchHit> = {}): ThreadSearchHit => ({
  index: 0,
  role: 'user',
  before: '前文',
  match: '关键词',
  after: '后文',
  moreBefore: false,
  moreAfter: false,
  ...over,
})

const thread = (
  id: string,
  title: string,
  hits: ThreadSearchHit[] = [hit()],
): ThreadSearchMatch => ({
  id,
  title,
  titleSource: 'fallback',
  updatedAt: 1,
  messageCount: hits.length * 2,
  stats: {
    turns: 1,
    messages: 2,
    assistantMessages: 1,
    chars: 40,
    estimatedTokens: 10,
    durationMs: 1000,
  },
  hits,
})

const searchOk = (results: ThreadSearchMatch[]) => vi.fn().mockResolvedValue({ ok: true, results })
const searchFail = (error: string) => vi.fn().mockResolvedValue({ ok: false, error })

describe('正文搜索结果区', () => {
  it('有命中：标题 + 最多 3 条片段，命中词用 <mark> 高亮，小标题带条数', async () => {
    // 给 5 条命中：主进程默认每线程最多 3 条，界面再兜一次（旧 store 数据也不会撑破行高）
    const many = [hit(), hit({ index: 1 }), hit({ index: 2 }), hit({ index: 3 }), hit({ index: 4 })]
    const searchThreads = searchOk([thread('t1', '上一次的导出改造', many)])
    const onOpen = vi.fn()
    render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关键词"
        searchThreads={searchThreads}
        onOpen={onOpen}
      />,
    )
    expect(await screen.findByText('上一次的导出改造')).toBeInTheDocument()
    expect(screen.getByText(t('ai.sidebar.bodySearchTitle', { count: 1 }))).toBeInTheDocument()
    const marks = screen.getAllByText('关键词')
    expect(marks).toHaveLength(3)
    expect(marks[0].tagName).toBe('MARK')
    // 点击整条 → 打开那条线程（父组件负责切 + 收起浮层）
    fireEvent.click(screen.getByText('上一次的导出改造'))
    expect(onOpen).toHaveBeenCalledWith(PROJECT, 't1')
  })

  it('每行 title = 共享函数的整段口径（hover 看完整上下文，省略号不自己拼）', async () => {
    const h = hit({ before: '前文', after: '后文', moreBefore: true, moreAfter: true })
    render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关键词"
        searchThreads={searchOk([thread('t1', '带省略号的一条', [h])])}
        onOpen={vi.fn()}
      />,
    )
    const line = await screen.findByTitle(formatThreadSearchSnippet(h))
    expect(line).toBeInTheDocument()
    // 省略号在行内也画出来（口径与共享函数一致：前面有截断才补 …）
    expect(line).toHaveTextContent(`…前文关键词后文…`)
  })

  it('无命中：明确说「正文里没有命中」，而不是空白', async () => {
    render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关键词"
        searchThreads={searchOk([])}
        onOpen={vi.fn()}
      />,
    )
    expect(await screen.findByText(t('ai.sidebar.bodySearchEmpty'))).toBeInTheDocument()
    expect(screen.getByText(t('ai.sidebar.bodySearchTitle', { count: 0 }))).toBeInTheDocument()
  })

  it('短查询（<2 字）不发请求，也不渲染这块', async () => {
    const searchThreads = searchOk([thread('t1', '不该出现')])
    const { rerender } = render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关"
        searchThreads={searchThreads}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('thread-search-results')).toBeNull()
    // 等过防抖窗口：一个字也不该发 IPC（会命中几乎所有消息）
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(searchThreads).not.toHaveBeenCalled()
    // 空查询同理
    rerender(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="   "
        searchThreads={searchThreads}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('thread-search-results')).toBeNull()
  })

  it('搜索中：防抖结束后显示「搜索中」', async () => {
    const pending = new Promise<never>(() => {})
    const searchThreads = vi.fn().mockReturnValue(pending)
    render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关键词"
        searchThreads={searchThreads}
        onOpen={vi.fn()}
      />,
    )
    expect(await screen.findByText(t('ai.sidebar.bodySearching'))).toBeInTheDocument()
  })

  it('失败：错误原文显示在行下（role="alert"）', async () => {
    render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关键词"
        searchThreads={searchFail('boom')}
        onOpen={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('ai.sidebar.bodySearchFailed', { message: 'boom' }),
    )
  })

  it('ipc-missing 翻成「重启应用」，不原样抛', async () => {
    render(
      <ThreadSearchResults
        projectPath={PROJECT}
        query="关键词"
        searchThreads={searchFail('ipc-missing')}
        onOpen={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(t('ai.sidebar.threadsIpcMissing'))
  })

  it('250ms 防抖：连打两次只发最后那一下', async () => {
    const searchThreads = searchOk([thread('t1', '结果')])
    const props = {
      projectPath: PROJECT,
      searchThreads,
      onOpen: vi.fn(),
    }
    const { rerender } = render(<ThreadSearchResults {...props} query="关键" />)
    // 防抖窗口内改主意：第一次的计时器应被清掉，绝不发出
    rerender(<ThreadSearchResults {...props} query="关键词" />)
    await waitFor(() => expect(searchThreads).toHaveBeenCalledTimes(1))
    expect(searchThreads).toHaveBeenCalledWith(PROJECT, '关键词')
  })
})
