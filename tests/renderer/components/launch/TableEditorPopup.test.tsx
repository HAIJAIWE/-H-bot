// tests/renderer/components/launch/TableEditorPopup.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TableEditorPopup } from '@renderer/components/launch/TableEditorPopup'
import type { ConfigCategory, TableSchema, QueryResult } from '@shared/types/launch'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// ── Mock useToast（稳定引用） ──
const { stableToast } = vi.hoisted(() => ({
  stableToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))
vi.mock('@renderer/components/ui/Toast', () => ({
  useToast: () => stableToast,
  toast: stableToast,
}))

// ── Mock 子组件（简化渲染，避免依赖复杂的 TypeEditor 等） ──
vi.mock('@renderer/components/launch/RecordEditModal', () => ({
  RecordEditModal: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="record-edit-modal" data-title={title} /> : null,
}))
vi.mock('@renderer/components/launch/TableDesignModal', () => ({
  TableDesignModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="table-design-modal" /> : null,
}))

// ── Mock 数据 ──
const PROJ_PATH = '/tmp/test-project'

const mockCategory: ConfigCategory = {
  name: 'players',
  file: 'players.db',
  tableCount: 1,
  displayName: '玩家列表',
  description: '所有玩家数据',
}

const mockSchema: TableSchema[] = [
  {
    name: 'players',
    fields: [
      { name: 'id', type: 'integer' },
      { name: 'nickname', type: 'text', label: '昵称' },
      { name: 'level', type: 'integer', label: '等级' },
    ],
  },
]

const mockQueryResult: QueryResult = {
  rows: [
    { rowid: 1, id: 1, nickname: '战士', level: 10 },
    { rowid: 2, id: 2, nickname: '法师', level: 20 },
  ],
  total: 2,
}

// ── Mock window.qqbat IPC ──
function setupIpc(opts: {
  tableRes?: { ok: boolean; data?: QueryResult; error?: string }
  schemaRes?: { ok: boolean; data?: TableSchema[]; error?: string }
  updateRecord?: { ok: boolean; error?: string }
  insertRecord?: { ok: boolean; data?: number; error?: string }
  deleteRecord?: { ok: boolean; error?: string }
  throwTable?: boolean
} = {}) {
  const tableRes = opts.tableRes ?? { ok: true, data: mockQueryResult }
  const schemaRes = opts.schemaRes ?? { ok: true, data: mockSchema }
  const updateRes = opts.updateRecord ?? { ok: true }
  const insertRes = opts.insertRecord ?? { ok: true, data: 1 }
  const deleteRes = opts.deleteRecord ?? { ok: true }

  const getTable = vi.fn()
  if (opts.throwTable) {
    getTable.mockRejectedValue(new Error('IPC 失败'))
  } else {
    getTable.mockResolvedValue(tableRes)
  }
  const getSchema = vi.fn().mockResolvedValue(schemaRes)
  const updateRecord = vi.fn().mockResolvedValue(updateRes)
  const insertRecord = vi.fn().mockResolvedValue(insertRes)
  const deleteRecord = vi.fn().mockResolvedValue(deleteRes)

  window.qqbat = {
    launchConfig: { getTable, getSchema, updateRecord, insertRecord, deleteRecord },
  } as any
}

beforeEach(() => {
  setupIpc()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).qqbat
})

describe('TableEditorPopup - 渲染', () => {
  it('显示 category.displayName', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('玩家列表')).toBeInTheDocument()
    })
  })

  it('显示总数（共 N 条）', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/共 2 条/)).toBeInTheDocument()
    })
  })

  it('显示 category.description', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/所有玩家数据/)).toBeInTheDocument()
    })
  })

  it('显示搜索输入框', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索过滤...')).toBeInTheDocument()
    })
  })

  it('显示"+ 新增"按钮', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('+ 新增')).toBeInTheDocument()
    })
  })

  it('显示"设计表结构"按钮', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('设计表结构')).toBeInTheDocument()
    })
  })

  it('加载完成显示数据行', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
      expect(screen.getByText('法师')).toBeInTheDocument()
    })
  })

  it('显示表头字段标签', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
      expect(screen.getByText('等级')).toBeInTheDocument()
    })
  })
})

describe('TableEditorPopup - 关闭', () => {
  it('点击 × 按钮调用 onClose', async () => {
    const onClose = vi.fn()
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={onClose} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('玩家列表')).toBeInTheDocument()
    })
    // 关闭按钮（× 文本）
    const closeBtn = screen.getByText('×')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TableEditorPopup - 新增与编辑', () => {
  it('点击"+ 新增"打开 RecordEditModal', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('+ 新增')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ 新增'))
    await waitFor(() => {
      expect(screen.getByTestId('record-edit-modal')).toBeInTheDocument()
    })
    // 标题为 "新增玩家列表"
    expect(screen.getByTestId('record-edit-modal').getAttribute('data-title')).toBe('新增玩家列表')
  })

  it('点击行内"编辑"打开 RecordEditModal', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    // 点击第一行的"编辑"按钮
    const editButtons = screen.getAllByText('编辑')
    fireEvent.click(editButtons[0])
    await waitFor(() => {
      expect(screen.getByTestId('record-edit-modal')).toBeInTheDocument()
    })
    expect(screen.getByTestId('record-edit-modal').getAttribute('data-title')).toBe('编辑玩家列表')
  })
})

describe('TableEditorPopup - 删除', () => {
  it('点击行内"删除"打开确认弹窗', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    // 点击第一行的"删除"按钮
    const deleteButtons = screen.getAllByText('删除')
    fireEvent.click(deleteButtons[0])
    // 单行删除确认弹窗（标题为"确认删除"）
    await waitFor(() => {
      expect(screen.getByText('确定要删除这条记录吗？此操作不可撤销。')).toBeInTheDocument()
    })
  })

  it('点击"确认删除"调用 deleteRecord', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    const deleteButtons = screen.getAllByText('删除')
    fireEvent.click(deleteButtons[0])
    await waitFor(() => {
      expect(screen.getByText('确定要删除这条记录吗？此操作不可撤销。')).toBeInTheDocument()
    })
    // 点击弹窗内"确认删除"按钮（注意避免匹配标题）
    // 弹窗内有两个按钮：取消、确认删除
    const confirmButtons = screen.getAllByRole('button', { name: '确认删除' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => {
      expect(window.qqbat.launchConfig.deleteRecord).toHaveBeenCalled()
    })
  })
})

describe('TableEditorPopup - 批量删除', () => {
  it('选中行后显示"删除选中"按钮', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    // 点击第一行的复选框
    const checkboxes = screen.getAllByRole('checkbox')
    // 第一个 checkbox 是表头"全选"，从第二个开始是行内 checkbox
    fireEvent.click(checkboxes[1])
    expect(screen.getByText(/删除选中/)).toBeInTheDocument()
  })

  it('点击"删除选中"打开批量删除确认弹窗', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByText(/删除选中/))
    await waitFor(() => {
      expect(screen.getByText('确认批量删除')).toBeInTheDocument()
    })
    expect(screen.getByText(/确定要删除选中的 1 条记录吗/)).toBeInTheDocument()
  })

  it('确认批量删除调用 deleteRecord', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByText(/删除选中/))
    await waitFor(() => {
      expect(screen.getByText('确认批量删除')).toBeInTheDocument()
    })
    // 点击弹窗内"确认删除"
    const confirmButtons = screen.getAllByRole('button', { name: '确认删除' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => {
      expect(window.qqbat.launchConfig.deleteRecord).toHaveBeenCalledTimes(1)
    })
  })
})

describe('TableEditorPopup - 表结构设计', () => {
  it('点击"设计表结构"打开 TableDesignModal', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('设计表结构')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('设计表结构'))
    await waitFor(() => {
      expect(screen.getByTestId('table-design-modal')).toBeInTheDocument()
    })
  })
})

describe('TableEditorPopup - 空数据', () => {
  it('空数据显示"暂无数据"提示', async () => {
    setupIpc({ tableRes: { ok: true, data: { rows: [], total: 0 } } })
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('暂无数据')).toBeInTheDocument()
    })
  })

  it('搜索无匹配显示"无匹配记录"提示', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('战士')).toBeInTheDocument()
    })
    // 输入搜索词（不匹配任何行）
    const searchInput = screen.getByPlaceholderText('搜索过滤...')
    fireEvent.change(searchInput, { target: { value: '不存在的玩家' } })
    // 等待防抖（300ms）
    await waitFor(() => {
      expect(screen.getByText('无匹配记录')).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('空数据显示"+ 新增"按钮（EmptyState 内）', async () => {
    setupIpc({ tableRes: { ok: true, data: { rows: [], total: 0 } } })
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('暂无数据')).toBeInTheDocument()
    })
    // EmptyState action 内含"+ 新增"按钮
    expect(screen.getAllByText('+ 新增').length).toBeGreaterThan(0)
  })
})

describe('TableEditorPopup - 翻页', () => {
  it('显示当前页与总页数', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      // total=2, pageSize=50, totalPages=1，显示 "1/1"
      expect(screen.getByText('1/1')).toBeInTheDocument()
    })
  })

  it('第一页时"上一页"按钮禁用', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('上一页')).toBeDisabled()
    })
  })

  it('最后一页时"下一页"按钮禁用', async () => {
    render(<TableEditorPopup category={mockCategory} projectPath={PROJ_PATH} onClose={vi.fn()} onTableChanged={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('下一页')).toBeDisabled()
    })
  })
})
