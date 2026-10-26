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

// 第 57 批：导出 / 删除入口（hover 出现，删除要行内二次确认，失败不静默）
describe('线程行：导出与删除', () => {
  it('导出 / 删除图标：给了回调才有，aria-label 走 i18n，默认 opacity-0（hover 才现身）', () => {
    render(<ThreadRow {...base} onExport={vi.fn()} onDelete={vi.fn()} />)
    const exportBtn = screen.getByLabelText(t('ai.sidebar.exportAria'))
    const deleteBtn = screen.getByLabelText(t('ai.sidebar.deleteAria'))
    expect(exportBtn.className).toContain('opacity-0')
    expect(deleteBtn.className).toContain('opacity-0')
    // 没给回调（占位行）时两个入口都不存在
    cleanup()
    render(<ThreadRow {...base} />)
    expect(screen.queryByLabelText(t('ai.sidebar.exportAria'))).toBeNull()
    expect(screen.queryByLabelText(t('ai.sidebar.deleteAria'))).toBeNull()
  })

  it('导出成功：行下提示**文件名**（不是整条路径）', async () => {
    const onExport = vi.fn().mockResolvedValue({
      ok: true,
      filePath: 'E:\\临时\\导出 的对话.md',
    })
    render(<ThreadRow {...base} onExport={onExport} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.exportAria')))
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('ai.sidebar.exported', { file: '导出 的对话.md' }),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('导出被用户取消：静默（主动行为，不是故障，弹红字像出事了）', async () => {
    const onExport = vi.fn().mockResolvedValue({ ok: false, error: '用户取消' })
    render(<ThreadRow {...base} onExport={onExport} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.exportAria')))
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('导出失败：行下 role="alert" 显示原因', async () => {
    const onExport = vi.fn().mockResolvedValue({ ok: false, error: 'disk full' })
    render(<ThreadRow {...base} onExport={onExport} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.exportAria')))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('ai.sidebar.exportFailed', { message: 'disk full' }),
    )
  })

  it('删除要先二次确认：点垃圾桶不删，确认后才调 onDelete', async () => {
    const onDelete = vi.fn().mockResolvedValue({ ok: true })
    render(<ThreadRow {...base} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteAria')))
    expect(onDelete).not.toHaveBeenCalled()
    // 整行换成确认态（标题暂时让位）
    expect(screen.getByText(t('ai.sidebar.deleteConfirm'))).toBeInTheDocument()
    expect(screen.queryByText(base.title)).toBeNull()
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteConfirmAria')))
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    // 成功之后不留确认态
    await waitFor(() => expect(screen.queryByText(t('ai.sidebar.deleteConfirm'))).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('取消删除：回到展示态，不调 onDelete', () => {
    const onDelete = vi.fn()
    render(<ThreadRow {...base} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteAria')))
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteCancelAria')))
    expect(onDelete).not.toHaveBeenCalled()
    expect(rowButton()).toBeInTheDocument()
  })

  it('Esc 也能撤销删除确认（与重命名输入框同一个手势）', () => {
    const onDelete = vi.fn()
    render(<ThreadRow {...base} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteAria')))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText(t('ai.sidebar.deleteConfirm'))).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('删除失败：行下 role="alert" 显示原因，且确认态保留（可以重试）', async () => {
    const onDelete = vi.fn().mockResolvedValue({ ok: false, error: 'boom' })
    render(<ThreadRow {...base} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteAria')))
    fireEvent.click(screen.getByLabelText(t('ai.sidebar.deleteConfirmAria')))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('ai.sidebar.deleteFailed', { message: 'boom' }),
    )
    expect(screen.getByLabelText(t('ai.sidebar.deleteConfirmAria'))).toBeInTheDocument()
  })

  it('流式输出中（disabled）：导出 / 删除图标与重命名一起隐藏', () => {
    render(
      <ThreadRow {...base} disabled onRename={vi.fn()} onExport={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.queryByLabelText(t('ai.sidebar.renameAria'))).toBeNull()
    expect(screen.queryByLabelText(t('ai.sidebar.exportAria'))).toBeNull()
    expect(screen.queryByLabelText(t('ai.sidebar.deleteAria'))).toBeNull()
  })
})
