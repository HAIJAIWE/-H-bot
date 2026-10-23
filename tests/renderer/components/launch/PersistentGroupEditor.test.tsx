// tests/renderer/components/launch/PersistentGroupEditor.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { PersistentGroupEditor } from '@renderer/components/launch/PersistentGroupEditor'
import type { FieldSchema } from '@shared/types/launch'
import type { DataTemplate } from '@renderer/types/ipc'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── Mock 数据 ──
const TABLE = '_persistent'
const FILE_PATH = '/tmp/test/data.json'

const FIELDS: FieldSchema[] = [
  { name: 'key', type: 'text' },
  { name: 'value', type: 'text' },
  { name: 'scope', type: 'text' },
  { name: 'updated_at', type: 'text' },
]

function makeTemplate(): DataTemplate {
  return {
    version: 1,
    groups: [
      {
        id: 'signin',
        label: '签到系统',
        icon: 'Calendar',
        fields: [
          { key: 'signin_count', label: '签到次数', type: 'number', default: 0 },
        ],
      },
    ],
  }
}

function makeGroups() {
  return [
    { id: 'basic', label: '基础信息', icon: 'User', fields: ['nickname', 'level'] },
    { id: 'signin', label: '签到系统', icon: 'Calendar', fields: ['signin_count'] },
  ]
}

function makeFieldTypes(): Record<string, any> {
  return {
    nickname: 'text',
    level: 'number',
    signin_count: 'number',
  }
}

// 简单的 getKeyLabel 实现：去前缀后返回 rawKey
function getKeyLabel(key: string): string {
  const parts = key.split(':')
  const rawKey = parts.length > 1 ? parts.slice(1).join(':') : parts[0]
  const labels: Record<string, string> = {
    nickname: '昵称',
    level: '等级',
    signin_count: '签到次数',
    site_name: '站点名',
  }
  return labels[rawKey] || rawKey
}

function makeProps(overrides: Record<string, any> = {}) {
  return {
    rows: [],
    fields: FIELDS,
    sectionLabel: '玩家数据',
    dynamicGroups: makeGroups(),
    dynamicFieldTypes: makeFieldTypes(),
    getKeyLabel,
    template: makeTemplate(),
    collapsedGroups: new Set<string>(),
    toggleGroup: vi.fn(),
    foundSourcePath: FILE_PATH,
    table: TABLE,
    setContextMenu: vi.fn(),
    setPersistentEdit: vi.fn(),
    setEditModal: vi.fn(),
    requestDelete: vi.fn(),
    ...overrides,
  }
}

describe('PersistentGroupEditor - 空状态', () => {
  it('rows 为空时显示"暂无数据"', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: [] })} />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('点击下方按钮新增记录')).toBeInTheDocument()
  })

  it('空状态点击"+ 新增"触发 setEditModal（create 模式）', () => {
    const setEditModal = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: [], setEditModal })} />)
    fireEvent.click(screen.getByText('+ 新增'))
    expect(setEditModal).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        mode: 'create',
        filePath: FILE_PATH,
        tableName: TABLE,
      })
    )
  })
})

describe('PersistentGroupEditor - 分组渲染', () => {
  const playerRows = [
    { rowid: 1, key: 'user_1001:nickname', value: '张三', scope: '' },
    { rowid: 2, key: 'user_1001:level', value: 10, scope: '' },
  ]

  it('显示"玩家数据"分组标题', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    expect(screen.getByText('玩家数据')).toBeInTheDocument()
  })

  it('显示分组标签和数量', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    // "基础信息" 分组卡片
    expect(screen.getByText('基础信息')).toBeInTheDocument()
    // 该分组有 2 个字段（nickname + level）
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('显示玩家行的中文标签', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    expect(screen.getByText('昵称')).toBeInTheDocument()
    expect(screen.getByText('等级')).toBeInTheDocument()
  })

  it('显示玩家行的 key 文本（title 属性）', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    expect(screen.getByTitle('user_1001:nickname')).toBeInTheDocument()
  })

  it('点击分组卡片头部触发 toggleGroup', () => {
    const toggleGroup = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows, toggleGroup })} />)
    fireEvent.click(screen.getByText('基础信息'))
    expect(toggleGroup).toHaveBeenCalledWith('basic')
  })

  it('collapsedGroups 包含某分组时该分组行不显示', () => {
    render(
      <PersistentGroupEditor
        {...makeProps({ rows: playerRows, collapsedGroups: new Set(['basic']) })}
      />
    )
    // 折叠后 nickname 行不显示
    expect(screen.queryByText('昵称')).not.toBeInTheDocument()
  })

  it('未匹配分组的数据归入"其他字段"', () => {
    const rows = [
      { rowid: 1, key: 'user_1001:nickname', value: '张三', scope: '' },
      { rowid: 2, key: 'user_1001:custom_field', value: '自定义', scope: '' },
    ]
    render(<PersistentGroupEditor {...makeProps({ rows })} />)
    expect(screen.getByText('其他字段')).toBeInTheDocument()
  })
})

describe('PersistentGroupEditor - 全局配置', () => {
  const globalRows = [
    {
      rowid: 10,
      key: 'config:site_name',
      value: 'MyBot',
      scope: 'global',
      updated_at: '2024-01-01T10:00:00',
    },
  ]

  it('显示"全局配置"标题', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: globalRows })} />)
    expect(screen.getByText('全局配置')).toBeInTheDocument()
  })

  it('显示全局行的值', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: globalRows })} />)
    expect(screen.getByText('MyBot')).toBeInTheDocument()
  })

  it('全局行"编辑"按钮触发 setEditModal（edit 模式）', () => {
    const setEditModal = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: globalRows, setEditModal })} />)
    // 找到 site_name 行的"编辑"按钮
    const row = screen.getByTitle('config:site_name').closest('.group') as HTMLElement
    fireEvent.click(within(row).getByText('编辑'))
    expect(setEditModal).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        mode: 'edit',
        filePath: FILE_PATH,
        tableName: TABLE,
        rowid: 10,
      })
    )
  })

  it('全局行"删除"按钮触发 requestDelete', () => {
    const requestDelete = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: globalRows, requestDelete })} />)
    const row = screen.getByTitle('config:site_name').closest('.group') as HTMLElement
    fireEvent.click(within(row).getByText('删除'))
    expect(requestDelete).toHaveBeenCalledWith(FILE_PATH, TABLE, 10)
  })
})

describe('PersistentGroupEditor - 玩家行交互', () => {
  const playerRows = [
    { rowid: 1, key: 'user_1001:nickname', value: '张三', scope: '' },
    { rowid: 2, key: 'user_1001:level', value: 10, scope: '' },
  ]

  it('玩家行"编辑"按钮触发 setPersistentEdit', () => {
    const setPersistentEdit = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows, setPersistentEdit })} />)
    const row = screen.getByTitle('user_1001:nickname').closest('.group') as HTMLElement
    fireEvent.click(within(row).getByText('编辑'))
    expect(setPersistentEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        key: 'user_1001:nickname',
        label: '昵称',
        type: 'text',
        value: '张三',
        rowid: 1,
        filePath: FILE_PATH,
        tableName: TABLE,
      })
    )
  })

  it('玩家行"删除"按钮触发 requestDelete', () => {
    const requestDelete = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows, requestDelete })} />)
    const row = screen.getByTitle('user_1001:level').closest('.group') as HTMLElement
    fireEvent.click(within(row).getByText('删除'))
    expect(requestDelete).toHaveBeenCalledWith(FILE_PATH, TABLE, 2)
  })

  it('右键玩家行触发 setContextMenu', () => {
    const setContextMenu = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows, setContextMenu })} />)
    const row = screen.getByTitle('user_1001:nickname').closest('.group') as HTMLElement
    fireEvent.contextMenu(row, { clientX: 100, clientY: 200 })
    expect(setContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 100,
        y: 200,
        filePath: FILE_PATH,
        tableName: TABLE,
      })
    )
  })
})

describe('PersistentGroupEditor - 虚拟行', () => {
  // 仅 basic 分组有数据，signin_count 来自 template（虚拟行）
  const playerRows = [
    { rowid: 1, key: 'user_1001:nickname', value: '张三', scope: '' },
  ]

  it('模板字段未在 rows 中时显示虚拟行（"(未初始化)"标记）', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    expect(screen.getByText('签到次数')).toBeInTheDocument()
    expect(screen.getByText('(未初始化)')).toBeInTheDocument()
  })

  it('虚拟行的 key 由 playerPrefix + fieldKey 组成', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    // playerPrefix = 'user_1001:'，fieldKey = 'signin_count'
    expect(screen.getByTitle('user_1001:signin_count')).toBeInTheDocument()
  })

  it('虚拟行不显示"删除"按钮', () => {
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows })} />)
    const row = screen.getByTitle('user_1001:signin_count').closest('.group') as HTMLElement
    // 虚拟行只有"编辑"按钮，没有"删除"按钮
    expect(within(row).getByText('编辑')).toBeInTheDocument()
    expect(within(row).queryByText('删除')).not.toBeInTheDocument()
  })

  it('虚拟行右键不触发 setContextMenu', () => {
    const setContextMenu = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows, setContextMenu })} />)
    const row = screen.getByTitle('user_1001:signin_count').closest('.group') as HTMLElement
    fireEvent.contextMenu(row, { clientX: 50, clientY: 50 })
    expect(setContextMenu).not.toHaveBeenCalled()
  })

  it('虚拟行"编辑"按钮触发 setPersistentEdit（rowid=null）', () => {
    const setPersistentEdit = vi.fn()
    render(<PersistentGroupEditor {...makeProps({ rows: playerRows, setPersistentEdit })} />)
    const row = screen.getByTitle('user_1001:signin_count').closest('.group') as HTMLElement
    fireEvent.click(within(row).getByText('编辑'))
    expect(setPersistentEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowid: null,
        key: 'user_1001:signin_count',
      })
    )
  })
})
