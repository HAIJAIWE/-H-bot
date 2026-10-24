// tests/renderer/components/launch/ConfigPanel.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ConfigPanel } from '@renderer/components/launch/ConfigPanel'
import { useProjectStore } from '@renderer/stores/projectStore'
import type { ConfigCategory } from '@shared/types/launch'
import type { ProjectMeta } from '@shared/types/project'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// ── Mock 子组件（简化渲染，仅标记是否打开） ──
vi.mock('@renderer/components/launch/CreateTableWizard', () => ({
  CreateTableWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-table-wizard" /> : null,
}))
vi.mock('@renderer/components/launch/TableEditorPopup', () => ({
  TableEditorPopup: ({ category }: { category: ConfigCategory }) =>
    <div data-testid="table-editor-popup" data-category={category.name} />,
}))
vi.mock('@renderer/components/project/NewProjectDialog', () => ({
  NewProjectDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="new-project-dialog" /> : null,
}))

// ── Mock 数据 ──
const mockProject: ProjectMeta = {
  id: 'p1',
  name: '测试项目',
  path: '/tmp/test-project',
  qq: '10086',
  adapter: 'official',
  botType: 'game',
  createdAt: '',
  updatedAt: '',
}

const mockCategories: ConfigCategory[] = [
  {
    name: 'classes',
    file: 'classes.db',
    tableCount: 1,
    displayName: '职业列表',
    description: '所有可选职业的模板',
  },
  {
    name: 'monsters',
    file: 'monsters.db',
    tableCount: 2,
    displayName: '怪物列表',
    description: '怪物属性与掉落',
  },
  {
    name: 'shop_items',
    file: 'shop_items.db',
    tableCount: 1,
    displayName: '商店物品',
  },
]

// ── Mock window.qqbat IPC ──
type MockRes<T> = { ok: boolean; data?: T; error?: string }

function setupIpc(opts: {
  categories?: MockRes<ConfigCategory[]>
  throwError?: boolean
} = {}) {
  const catRes = opts.categories ?? { ok: true, data: mockCategories }

  const listCategories = vi.fn()
  if (opts.throwError) {
    listCategories.mockRejectedValue(new Error('IPC 桥接失败'))
  } else {
    listCategories.mockResolvedValue(catRes)
  }

  window.qqbat = {
    launchConfig: {
      listCategories,
      getTable: vi.fn().mockResolvedValue({ ok: true, data: { rows: [], total: 0 } }),
      getSchema: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      updateRecord: vi.fn().mockResolvedValue({ ok: true }),
      insertRecord: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
      deleteRecord: vi.fn().mockResolvedValue({ ok: true }),
      createTable: vi.fn().mockResolvedValue({ ok: true, data: { tableName: 'new_table', filePath: '/tmp/new_table.db' } }),
      dropTable: vi.fn().mockResolvedValue({ ok: true }),
      renameTable: vi.fn().mockResolvedValue({ ok: true, data: { oldName: 'a', newName: 'b' } }),
      alterTable: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      // ConfigPanel 启动时加载所有层的模板摘要，建立 tableName → layer 映射
      listLayerTemplates: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
  } as any
}

beforeEach(() => {
  useProjectStore.getState().reset()
  setupIpc()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).qqbat
})

describe('ConfigPanel - 无项目状态', () => {
  it('无项目时显示空状态提示', () => {
    render(<ConfigPanel />)
    expect(screen.getByText('请先选择一个项目')).toBeInTheDocument()
  })

  it('无项目时显示新建项目按钮', () => {
    render(<ConfigPanel />)
    expect(screen.getByText('新建项目')).toBeInTheDocument()
  })

  it('点击新建项目按钮打开对话框', () => {
    render(<ConfigPanel />)
    fireEvent.click(screen.getByText('新建项目'))
    expect(screen.getByTestId('new-project-dialog')).toBeInTheDocument()
  })
})

describe('ConfigPanel - 数据加载', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('mount 时调用 listCategories 加载分类列表', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(window.qqbat.launchConfig.listCategories).toHaveBeenCalledWith('/tmp/test-project')
    })
  })

  it('加载成功后显示配置表卡片', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      // displayName 同时作为卡片名和模块指示器标签出现，因此用 getAllByText
      expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('怪物列表').length).toBeGreaterThan(0)
    expect(screen.getAllByText('商店物品').length).toBeGreaterThan(0)
  })

  it('加载成功后显示配置表中文名', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
    })
  })

  it('加载成功后显示表数量徽章', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      // monsters 卡片显示 "2 表"
      expect(screen.getByText('2 表')).toBeInTheDocument()
    })
  })

  it('加载成功后显示表名（小字 font-mono）', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('classes')).toBeInTheDocument()
    })
    expect(screen.getByText('monsters')).toBeInTheDocument()
  })

  it('显示描述信息（如存在）', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('所有可选职业的模板')).toBeInTheDocument()
    })
  })

  it('listCategories 失败时显示错误提示', async () => {
    setupIpc({ categories: { ok: false, error: '数据库连接失败测试' } })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('配置列表加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('数据库连接失败测试')).toBeInTheDocument()
  })

  it('listCategories 失败时显示重试按钮', async () => {
    setupIpc({ categories: { ok: false, error: '加载失败' } })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })
  })

  it('点击重试按钮重新调用 listCategories', async () => {
    setupIpc({ categories: { ok: false, error: '加载失败' } })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })
    const initialCallCount = vi.mocked(window.qqbat.launchConfig.listCategories).mock.calls.length
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => {
      expect(vi.mocked(window.qqbat.launchConfig.listCategories).mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  it('IPC 抛出异常时显示友好错误提示', async () => {
    setupIpc({ throwError: true })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('配置列表加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('IPC 桥接失败')).toBeInTheDocument()
  })
})

describe('ConfigPanel - 空数据状态', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('配置列表为空时显示"暂无配置数据"', async () => {
    setupIpc({ categories: { ok: true, data: [] } })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('暂无配置数据')).toBeInTheDocument()
    })
  })

  it('配置列表为空时显示配置编辑说明', async () => {
    setupIpc({ categories: { ok: true, data: [] } })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('配置编辑说明：')).toBeInTheDocument()
    })
  })

  it('配置列表为空时显示新建表指引', async () => {
    setupIpc({ categories: { ok: true, data: [] } })
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText(/点击右上角「\+ 新建表」从零创建/)).toBeInTheDocument()
    })
  })
})

describe('ConfigPanel - 工具栏', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('显示"全局配置编辑"标题', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('全局配置编辑')).toBeInTheDocument()
    })
  })

  it('显示当前机器人类型', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('游戏机器人')).toBeInTheDocument()
    })
  })

  it('显示"新建表"按钮', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('新建表')).toBeInTheDocument()
    })
  })

  it('点击"新建表"按钮打开 CreateTableWizard', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByText('新建表')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('新建表'))
    expect(screen.getByTestId('create-table-wizard')).toBeInTheDocument()
  })
})

describe('ConfigPanel - 卡片交互', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('点击配置表卡片打开 TableEditorPopup', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      // 用描述文本（卡片独有）定位 classes 卡片
      expect(screen.getByText('所有可选职业的模板')).toBeInTheDocument()
    })
    // 点击卡片内的描述文本，事件冒泡到卡片的 onClick
    fireEvent.click(screen.getByText('所有可选职业的模板'))
    expect(screen.getByTestId('table-editor-popup')).toBeInTheDocument()
    expect(screen.getByTestId('table-editor-popup').getAttribute('data-category')).toBe('classes')
  })
})

describe('ConfigPanel - 搜索过滤', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('有配置表时显示搜索输入框', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索配置表（中文名 / 表名）...')).toBeInTheDocument()
    })
  })

  it('输入搜索关键词后过滤配置表（防抖后）', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
    })
    const input = screen.getByPlaceholderText('搜索配置表（中文名 / 表名）...')
    fireEvent.change(input, { target: { value: '怪物' } })
    await waitFor(() => {
      // 过滤后：怪物列表卡片仍在（卡片+指示器=2），职业列表卡片被过滤（仅指示器=1）
      expect(screen.getAllByText('职业列表').length).toBe(1)
    }, { timeout: 2000 })
    // 怪物列表至少仍有 1 处（卡片或指示器）
    expect(screen.getAllByText('怪物列表').length).toBeGreaterThan(0)
  })

  it('搜索关键词显示匹配数量', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
    })
    const input = screen.getByPlaceholderText('搜索配置表（中文名 / 表名）...')
    fireEvent.change(input, { target: { value: '怪' } })
    await waitFor(() => {
      // 用精确字符串匹配（避免父元素 textContent 也匹配到 regex）
      expect(screen.getByText('匹配 1 / 3 张表')).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('搜索无匹配时显示提示', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
    })
    const input = screen.getByPlaceholderText('搜索配置表（中文名 / 表名）...')
    fireEvent.change(input, { target: { value: '不存在的表名' } })
    await waitFor(() => {
      expect(screen.getByText('没有匹配「不存在的表名」的配置表')).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('点击"清除"按钮清空搜索关键词', async () => {
    render(<ConfigPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
    })
    const input = screen.getByPlaceholderText('搜索配置表（中文名 / 表名）...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '怪物' } })
    await waitFor(() => {
      expect(screen.getByText('清除')).toBeInTheDocument()
    }, { timeout: 2000 })
    fireEvent.click(screen.getByText('清除'))
    await waitFor(() => {
      expect(input.value).toBe('')
    })
    // 清空后所有卡片恢复显示：职业列表至少有 1 处
    expect(screen.getAllByText('职业列表').length).toBeGreaterThan(0)
  })
})
