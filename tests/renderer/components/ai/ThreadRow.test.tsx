// tests/renderer/components/ai/ThreadRow.test.tsx
//
// 第 56 批：线程行除了"标题 + 条数"，还加了 hover 规模提示与重命名入口。
// 钉住四件事：
//   · hover 提示里既有条数也有「N 轮 · 约 X tokens」（千分位来自渲染层，不改口径）；
//   · 改名成功 → 退出编辑态（乐观更新由 store 做，行不需要刷新）；
//   · 空标题**本地就挡住**（不白跑一趟 IPC），并给出人话；
//   · 主进程失败原因显示在行下 —— 静默失败会让用户以为改成功了。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { ThreadInfo } from '@renderer/stores/aiStore'

// ThreadRow 住在 AiSidebar.tsx 里（同一文件的列表容器用），而 AiSidebar 经 aiStore 连带
// flowStore（@xyflow/react 需要真实画布尺寸）。这些用例只测这一行，把画布挡掉。
vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: {
    getState: () => ({
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNodeConfig: vi.fn(),
      removeNode: vi.fn(),
      autoLayout: vi.fn(),
      snapshot: vi.fn(() => ({ nodes: [], edges: [] })),
      rollback: vi.fn(),
      generateCode: vi.fn().mockResolvedValue(true),
    }),
  },
}))
vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: (selector: (s: { currentProject: null }) => unknown) =>
    selector({ currentProject: null }),
}))

import { t } from '@renderer/i18n'
import { ThreadRow } from '@renderer/components/ai/AiSidebar'

afterEach(cleanup)

const stats: ThreadInfo['stats'] = {
  turns: 3,
  messages: 6,
  assistantMessages: 3,
  chars: 4936,
  estimatedTokens: 1234,
  durationMs: 60_000,
}

const base = {
  title: '旧的对话标题',
  count: 6,
  active: false,
  disabled: false,
  onClick: () => {},
}

/** 行本体是按钮（重命名铅笔是它的兄弟节点，不是嵌套按钮） */
const rowButton = (): HTMLButtonElement =>
  screen.getByText('旧的对话标题').closest('button') as HTMLButtonElement

const openEditor = () => {
  fireEvent.click(screen.getByLabelText(t('ai.sidebar.renameAria')))
  return screen.getByRole('textbox', { name: t('ai.sidebar.renameAria') }) as HTMLInputElement
}

describe('线程行：规模提示与重命名', () => {
  it('hover 提示：条数之外再带「N 轮 · 约 X tokens」，token 带千分位', () => {
    render(
      <ThreadRow
        {...base}
        tooltip={t('ai.chat.threadOption', { title: base.title, count: base.count })}
        stats={stats}
      />,
    )
    const title = rowButton().title
    expect(title).toContain(t('ai.chat.threadOption', { title: base.title, count: 6 }))
    expect(title).toContain(t('ai.sidebar.stats', { turns: 3, tokens: '1,234' }))
  })

  it('没有 stats 时不硬凑统计（占位行「当前对话」就没有）', () => {
    render(<ThreadRow {...base} />)
    expect(rowButton().title).toBe(base.title)
  })

  it('改名成功：调 onRename(新标题) 并退出编辑态', async () => {
    const onRename = vi.fn().mockResolvedValue({ ok: true })
    render(<ThreadRow {...base} onRename={onRename} />)
    const input = openEditor()
    expect(input.value).toBe('旧的对话标题')
    fireEvent.change(input, { target: { value: '新的对话标题' } })
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.renameSave')))
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('新的对话标题'))
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: t('ai.sidebar.renameAria') })).toBeNull(),
    )
  })

  it('空标题：本地挡住、不打 IPC，并显示人话', async () => {
    const onRename = vi.fn().mockResolvedValue({ ok: true })
    render(<ThreadRow {...base} onRename={onRename} />)
    const input = openEditor()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.renameSave')))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('ai.sidebar.renameEmpty'))
    expect(onRename).not.toHaveBeenCalled()
    // 还在编辑态：用户改一下就能重试，不用重新点铅笔
    expect(screen.getByRole('textbox', { name: t('ai.sidebar.renameAria') })).toBeInTheDocument()
  })

  it('主进程拒绝：把失败原因显示出来（ipc-missing 说成"重启应用"而不是原样抛）', async () => {
    const onRename = vi.fn().mockResolvedValue({ ok: false, error: 'boom' })
    render(<ThreadRow {...base} onRename={onRename} />)
    const input = openEditor()
    fireEvent.change(input, { target: { value: '新标题' } })
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.renameSave')))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('ai.sidebar.renameFailed', { message: 'boom' }),
    )
  })

  it('ipc-missing 翻成"界面与主进程版本不一致，请重启"', async () => {
    const onRename = vi.fn().mockResolvedValue({ ok: false, error: 'ipc-missing' })
    render(<ThreadRow {...base} onRename={onRename} />)
    const input = openEditor()
    fireEvent.change(input, { target: { value: '新标题' } })
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.renameSave')))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('ai.sidebar.threadsIpcMissing'))
  })

  it('Esc 取消编辑，标题恢复原样', () => {
    render(<ThreadRow {...base} onRename={vi.fn()} />)
    const input = openEditor()
    fireEvent.change(input, { target: { value: '打到一半不要了' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: t('ai.sidebar.renameAria') })).toBeNull()
    expect(rowButton()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('双击标题也能进编辑态（铅笔是 hover 才出现的，快捷路径不能只有鼠标悬停）', () => {
    render(<ThreadRow {...base} onRename={vi.fn()} />)
    fireEvent.doubleClick(rowButton())
    expect(screen.getByRole('textbox', { name: t('ai.sidebar.renameAria') })).toBeInTheDocument()
  })

  it('流式输出中（disabled）不提供重命名入口', () => {
    render(<ThreadRow {...base} disabled onRename={vi.fn()} />)
    expect(screen.queryByLabelText(t('ai.sidebar.renameAria'))).toBeNull()
  })

  it('没给 onRename（占位行）时也没有入口', () => {
    render(<ThreadRow {...base} />)
    expect(screen.queryByLabelText(t('ai.sidebar.renameAria'))).toBeNull()
  })
})
