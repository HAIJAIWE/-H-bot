// tests/renderer/components/launch/DataBrowserPanel.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DataBrowserPanel } from '@renderer/components/launch/DataBrowserPanel'
import { useProjectStore } from '@renderer/stores/projectStore'
import type { ProjectMeta } from '@shared/types/project'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// ── Mock clipboard ──
Object.assign(navigator, {
  clipboard: { writeText: vi.fn() },
})

// ── Mock useToast（必须返回稳定引用，否则依赖 toast 的 useCallback 每次渲染重建，引发无限循环） ──
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

// ── Mock 子组件（简化渲染） ──
vi.mock('@renderer/components/launch/CharacterProfileCard', () => ({
  CharacterProfileCard: () => <div data-testid="character-profile-card" />,
}))
vi.mock('@renderer/components/launch/PersistentGroupEditor', () => ({
  PersistentGroupEditor: () => <div data-testid="persistent-group-editor" />,
}))
vi.mock('@renderer/components/launch/RecordEditModal', () => ({
  RecordEditModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="record-edit-modal" /> : null,
}))
vi.mock('@renderer/components/launch/UidEditDialog', () => ({
  UidEditDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="uid-edit-dialog" /> : null,
}))
vi.mock('@renderer/components/launch/PersistentEditDialog', () => ({
  PersistentEditDialog: ({ persistentEdit }: { persistentEdit: { open: boolean } }) =>
    persistentEdit?.open ? <div data-testid="persistent-edit-dialog" /> : null,
}))

// ── Mock 数据 ──
const mockProject: ProjectMeta = {
  id: 'p1',
  name: '测试项目',
  path: '/tmp/test-project',
  qq: '10086',
  adapter: 'napcat',
  botType: 'game',
  createdAt: '',
  updatedAt: '',
}

const mockPlayers = [
  {
    uid: '1001',
    openid: 'openid-abc12345',
    nickname: '玩家A',
    recordCount: 3,
    sources: ['1001.json'],
  },
  {
    uid: '1002',
    openid: null,
    nickname: '玩家B',
    recordCount: 1,
    sources: ['1002.json'],
  },
]

const mockPlayerTables = [
  {
    table: 'players',
    fields: [
      { name: 'nickname', type: 'text' },
      { name: 'level', type: 'integer' },
    ],
    rows: [{ rowid: 1, nickname: '玩家A', level: 10 }],
  },
  {
    table: 'inventory',
    fields: [
      { name: 'item_name', type: 'text' },
      { name: 'count', type: 'integer' },
    ],
    rows: [
      { rowid: 1, item_name: '铁剑', count: 1 },
      { rowid: 2, item_name: '木盾', count: 2 },
    ],
  },
]

// ── IPC Mock 设置 ──
function setupIpc(opts: {
  players?: { ok: boolean; data?: typeof mockPlayers; error?: string }
  playerTables?: typeof mockPlayerTables
  searchResults?: Array<{ source: string; table: string; rowid: number; row: Record<string, unknown> }>
  throwError?: boolean
  templateNull?: boolean
} = {}) {
  const playersRes = opts.players ?? { ok: true, data: mockPlayers }
  const tablesRes = { ok: true, data: opts.playerTables ?? mockPlayerTables }
  const searchRes = { ok: true, data: opts.searchResults ?? [] }

  const getPlayersWithUid = vi.fn()
  if (opts.throwError) {
    getPlayersWithUid.mockRejectedValue(new Error('IPC 桥接失败'))
  } else {
    getPlayersWithUid.mockResolvedValue(playersRes)
  }

  window.qqbat = {
    launchData: {
      getPlayersWithUid,
      getDataTemplate: vi.fn().mockResolvedValue(
        opts.templateNull ? { ok: false } : { ok: true, data: { version: 1, groups: [] } }
      ),
      getSchema: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      queryPlayerTables: vi.fn().mockResolvedValue(tablesRes),
      searchPlayer: vi.fn().mockResolvedValue(searchRes),
      updateRecord: vi.fn().mockResolvedValue({ ok: true }),
      insertRecord: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
      deleteRecord: vi.fn().mockResolvedValue({ ok: true }),
      updatePlayerUid: vi.fn().mockResolvedValue({ ok: true, data: { oldUid: 1001, success: true } }),
      listPlayers: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      listDataSources: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      queryTable: vi.fn().mockResolvedValue({ ok: true, data: { rows: [], total: 0 } }),
      saveSchema: vi.fn().mockResolvedValue({ ok: true, data: '' }),
      getUidMapping: vi.fn().mockResolvedValue({ ok: true, data: { nextUid: 1, mapping: {} } }),
      saveDataTemplate: vi.fn().mockResolvedValue({ ok: true, data: true }),
    },
  } as any
}

beforeEach(() => {
  useProjectStore.getState().reset()
  setupIpc()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).qqbat
})

describe('DataBrowserPanel - 无项目状态', () => {
  it('无项目时显示提示信息', () => {
    render(<DataBrowserPanel />)
    expect(screen.getByText('请先选择一个项目')).toBeInTheDocument()
    expect(screen.getByText('在左侧选择已有项目后，可查看玩家数据与配置表')).toBeInTheDocument()
  })
})

describe('DataBrowserPanel - 玩家列表加载', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('mount 时调用 getPlayersWithUid 加载玩家列表', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(window.qqbat.launchData.getPlayersWithUid).toHaveBeenCalledWith('/tmp/test-project')
    })
  })

  it('加载成功后显示玩家列表', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    expect(screen.getByText('玩家B')).toBeInTheDocument()
  })

  it('显示玩家 UID', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText(/UID: 1001/)).toBeInTheDocument()
    })
  })

  it('显示玩家记录数', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText(/3\s*条/)).toBeInTheDocument()
    })
  })

  it('显示改UID按钮', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('改UID').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('玩家列表为空时显示空状态', async () => {
    setupIpc({ players: { ok: true, data: [] } })
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('暂无玩家数据')).toBeInTheDocument()
    })
  })

  it('玩家列表加载失败时显示错误提示', async () => {
    setupIpc({ players: { ok: false, error: '数据库连接失败' } })
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家列表加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('数据库连接失败')).toBeInTheDocument()
  })

  it('加载失败时显示重试按钮', async () => {
    setupIpc({ players: { ok: false, error: '数据库连接失败' } })
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })
  })

  it('点击重试按钮重新加载玩家列表', async () => {
    setupIpc({ players: { ok: false, error: '数据库连接失败' } })
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })
    const initialCallCount = vi.mocked(window.qqbat.launchData.getPlayersWithUid).mock.calls.length
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => {
      expect(vi.mocked(window.qqbat.launchData.getPlayersWithUid).mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  it('IPC 抛出异常时显示错误提示', async () => {
    setupIpc({ throwError: true })
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家列表加载失败')).toBeInTheDocument()
    })
  })
})

describe('DataBrowserPanel - 玩家选择', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('点击玩家加载对应数据表', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(window.qqbat.launchData.queryPlayerTables).toHaveBeenCalled()
    })
  })

  it('选中玩家后显示当前玩家 UID', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText(/当前: 1001/)).toBeInTheDocument()
    })
  })

  it('选中玩家后显示数据表分区', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      // players 表已由 CharacterProfileCard 展示，playerTables.map 中只显示 inventory 等其他表
      expect(screen.getByText('背包物品')).toBeInTheDocument()
    })
    // CharacterProfileCard 应被渲染（mock 为 data-testid）
    expect(screen.getByTestId('character-profile-card')).toBeInTheDocument()
  })

  it('未选中玩家时显示选择提示', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('选择玩家查看数据')).toBeInTheDocument()
    })
  })

  it('点击玩家调用 getSchema 获取表结构', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(window.qqbat.launchData.getSchema).toHaveBeenCalled()
    })
  })
})

describe('DataBrowserPanel - 搜索功能', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('显示搜索输入框', async () => {
    render(<DataBrowserPanel />)
    expect(screen.getByPlaceholderText('输入 UID / 昵称...')).toBeInTheDocument()
  })

  it('输入搜索关键词后触发 searchPlayer（防抖后）', async () => {
    setupIpc({
      searchResults: [{
        source: '1001.json',
        table: 'players',
        rowid: 1,
        row: { qq: '1001', nickname: '玩家A' },
      }],
    })
    render(<DataBrowserPanel />)
    const input = screen.getByPlaceholderText('输入 UID / 昵称...')
    fireEvent.change(input, { target: { value: '1001' } })
    await waitFor(() => {
      expect(window.qqbat.launchData.searchPlayer).toHaveBeenCalledWith('/tmp/test-project', '1001')
    }, { timeout: 2000 })
  })

  it('搜索结果为空时清除当前选中玩家', async () => {
    setupIpc({ searchResults: [] })
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    // 先选中一个玩家
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText(/当前: 1001/)).toBeInTheDocument()
    })
    // 搜索无结果
    const input = screen.getByPlaceholderText('输入 UID / 昵称...')
    fireEvent.change(input, { target: { value: 'nonexistent' } })
    await waitFor(() => {
      expect(window.qqbat.launchData.searchPlayer).toHaveBeenCalledWith('/tmp/test-project', 'nonexistent')
    }, { timeout: 2000 })
  })

  it('按 Enter 键触发搜索', async () => {
    setupIpc({
      searchResults: [{
        source: '1001.json',
        table: 'players',
        rowid: 1,
        row: { qq: '1001', nickname: '玩家A' },
      }],
    })
    render(<DataBrowserPanel />)
    const input = screen.getByPlaceholderText('输入 UID / 昵称...')
    fireEvent.change(input, { target: { value: '1001' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(window.qqbat.launchData.searchPlayer).toHaveBeenCalledWith('/tmp/test-project', '1001')
    })
  })
})

describe('DataBrowserPanel - CRUD 操作', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('点击新增按钮打开记录编辑弹窗', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText('背包物品')).toBeInTheDocument()
    })
    // inventory 分区默认折叠，先点击标题展开
    fireEvent.click(screen.getByText('背包物品'))
    await waitFor(() => {
      // 展开后才出现 + 新增 按钮
      expect(screen.getByText('+ 新增')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ 新增'))
    expect(screen.getByTestId('record-edit-modal')).toBeInTheDocument()
  })

  it('点击编辑按钮打开记录编辑弹窗', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText('背包物品')).toBeInTheDocument()
    })
    // inventory 分区默认折叠，点击标题展开
    fireEvent.click(screen.getByText('背包物品'))
    await waitFor(() => {
      expect(screen.getByText('铁剑')).toBeInTheDocument()
    })
    // 点击 inventory 行的编辑按钮
    const editButtons = screen.getAllByText('编辑')
    fireEvent.click(editButtons[0])
    expect(screen.getByTestId('record-edit-modal')).toBeInTheDocument()
  })

  it('点击删除按钮打开确认弹窗', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText('背包物品')).toBeInTheDocument()
    })
    // inventory 分区默认折叠，点击标题展开
    fireEvent.click(screen.getByText('背包物品'))
    await waitFor(() => {
      expect(screen.getByText('铁剑')).toBeInTheDocument()
    })
    // 点击 inventory 行的删除按钮
    const deleteButtons = screen.getAllByText('删除')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText('确定要删除这条记录吗？此操作不可撤销。')).toBeInTheDocument()
  })

  it('确认删除时调用 deleteRecord IPC', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText('背包物品')).toBeInTheDocument()
    })
    // inventory 分区默认折叠，点击标题展开
    fireEvent.click(screen.getByText('背包物品'))
    await waitFor(() => {
      expect(screen.getByText('铁剑')).toBeInTheDocument()
    })
    // 点击删除按钮
    fireEvent.click(screen.getAllByText('删除')[0])
    expect(screen.getByText('确定要删除这条记录吗？此操作不可撤销。')).toBeInTheDocument()
    // 点击确认删除按钮（getByRole 精确定位按钮，避免匹配到 Modal 标题）
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => {
      expect(window.qqbat.launchData.deleteRecord).toHaveBeenCalled()
    })
  })

  it('取消删除时不调用 deleteRecord', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      expect(screen.getByText('背包物品')).toBeInTheDocument()
    })
    // inventory 分区默认折叠，点击标题展开
    fireEvent.click(screen.getByText('背包物品'))
    await waitFor(() => {
      expect(screen.getByText('铁剑')).toBeInTheDocument()
    })
    // 点击删除按钮
    fireEvent.click(screen.getAllByText('删除')[0])
    expect(screen.getByText('确定要删除这条记录吗？此操作不可撤销。')).toBeInTheDocument()
    // 点击取消
    fireEvent.click(screen.getByText('取消'))
    expect(window.qqbat.launchData.deleteRecord).not.toHaveBeenCalled()
  })
})

describe('DataBrowserPanel - UID 编辑', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('点击改UID按钮打开 UID 编辑弹窗', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    const editUidButtons = screen.getAllByText('改UID')
    fireEvent.click(editUidButtons[0])
    expect(screen.getByTestId('uid-edit-dialog')).toBeInTheDocument()
  })
})

describe('DataBrowserPanel - 数据展示', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('显示玩家列表标题和数量', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText(/玩家列表/)).toBeInTheDocument()
    })
  })

  it('显示搜索玩家标题', async () => {
    render(<DataBrowserPanel />)
    expect(screen.getByText('搜索玩家')).toBeInTheDocument()
  })

  it('选中玩家后显示记录数和表数统计', async () => {
    render(<DataBrowserPanel />)
    await waitFor(() => {
      expect(screen.getByText('玩家A')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('玩家A'))
    await waitFor(() => {
      // mockPlayerTables 有 2 张表，共 3 条记录
      expect(screen.getByText(/3\s*条记录\s*\/\s*2\s*张表/)).toBeInTheDocument()
    })
  })
})
