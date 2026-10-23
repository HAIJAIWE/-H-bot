// tests/renderer/components/launch/TableDesignModal.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TableDesignModal } from '@renderer/components/launch/TableDesignModal'
import type { TableSchema } from '@shared/types/launch'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// 注：删字段确认已从 window.confirm 改为自定义弹窗（confirmDropFields 状态），
// 因此不再需要 mock window.confirm。删表确认同样使用自定义弹窗（confirmDropTable 状态）。

// ── Mock 数据 ──
const PROJ_PATH = '/tmp/test-project'
const CATEGORY = 'players'

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

// ── Mock window.qqbat IPC ──
function setupIpc(opts: {
  alterTable?: { ok: boolean; data?: any; error?: string }
  renameTable?: { ok: boolean; data?: any; error?: string }
  dropTable?: { ok: boolean; data?: any; error?: string }
  alterThrow?: boolean
  renameThrow?: boolean
  dropThrow?: boolean
} = {}) {
  const alterRes = opts.alterTable ?? { ok: true, data: { addedFields: [], droppedFields: [], migratedRows: 0, rebuilt: false } }
  const renameRes = opts.renameTable ?? { ok: true, data: { oldName: 'a', newName: 'b' } }
  const dropRes = opts.dropTable ?? { ok: true }

  const alterTable = vi.fn()
  if (opts.alterThrow) alterTable.mockRejectedValue(new Error('IPC alter 失败'))
  else alterTable.mockResolvedValue(alterRes)

  const renameTable = vi.fn()
  if (opts.renameThrow) renameTable.mockRejectedValue(new Error('IPC rename 失败'))
  else renameTable.mockResolvedValue(renameRes)

  const dropTable = vi.fn()
  if (opts.dropThrow) dropTable.mockRejectedValue(new Error('IPC drop 失败'))
  else dropTable.mockResolvedValue(dropRes)

  window.qqbat = { launchConfig: { alterTable, renameTable, dropTable } } as any
}

beforeEach(() => {
  setupIpc()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).qqbat
})

describe('TableDesignModal - 渲染', () => {
  it('open=false 时不渲染', () => {
    render(
      <TableDesignModal
        open={false}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.queryByText('设计表结构')).not.toBeInTheDocument()
  })

  it('open=true 显示"设计表结构"标题', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText('设计表结构')).toBeInTheDocument()
  })

  it('显示 category.db（数据库文件名）', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText('players.db')).toBeInTheDocument()
  })

  it('显示现有字段列表', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('nickname')).toBeInTheDocument()
    expect(screen.getByText('level')).toBeInTheDocument()
  })

  it('显示字段统计', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText(/3 个/)).toBeInTheDocument()
  })
})

describe('TableDesignModal - 字段操作', () => {
  it('id 字段无删除按钮（主键不可删除）', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    // id 字段所在行不应有删除按钮 title="删除字段"
    // 整体页面只有 2 个删除字段按钮（nickname 和 level），id 没有
    const deleteButtons = screen.getAllByTitle('删除字段')
    expect(deleteButtons).toHaveLength(2)
  })

  it('点击字段"×"按钮标记为待删除', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    // 删除 nickname 字段
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText('待删除')).toBeInTheDocument()
    expect(screen.getByText('撤销')).toBeInTheDocument()
  })

  it('点击"撤销"恢复被标记删除的字段', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText('待删除')).toBeInTheDocument()
    fireEvent.click(screen.getByText('撤销'))
    expect(screen.queryByText('待删除')).not.toBeInTheDocument()
  })

  it('点击"+ 添加新字段"展开添加表单', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ 添加新字段'))
    expect(screen.getByText('新增字段（保存后生效）')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('字段名 (英文)')).toBeInTheDocument()
  })

  it('添加合法字段后显示在"待添加字段"列表', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ 添加新字段'))
    fireEvent.change(screen.getByPlaceholderText('字段名 (英文)'), { target: { value: 'hp' } })
    fireEvent.change(screen.getByPlaceholderText('中文标签'), { target: { value: '生命值' } })
    fireEvent.click(screen.getByText('加入'))
    expect(screen.getByText('待添加字段（保存后生效）')).toBeInTheDocument()
    expect(screen.getByText('hp')).toBeInTheDocument()
  })

  it('添加字段名为 id 时显示错误', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ 添加新字段'))
    fireEvent.change(screen.getByPlaceholderText('字段名 (英文)'), { target: { value: 'id' } })
    fireEvent.change(screen.getByPlaceholderText('中文标签'), { target: { value: '主键' } })
    fireEvent.click(screen.getByText('加入'))
    expect(screen.getByText('字段名 id 是系统主键，不能用')).toBeInTheDocument()
  })

  it('添加字段名非法（数字开头）显示错误', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ 添加新字段'))
    fireEvent.change(screen.getByPlaceholderText('字段名 (英文)'), { target: { value: '1bad' } })
    fireEvent.change(screen.getByPlaceholderText('中文标签'), { target: { value: '坏字段' } })
    fireEvent.click(screen.getByText('加入'))
    expect(screen.getByText(/字段名非法/)).toBeInTheDocument()
  })

  it('添加字段与已有字段重名显示错误', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ 添加新字段'))
    fireEvent.change(screen.getByPlaceholderText('字段名 (英文)'), { target: { value: 'level' } })
    fireEvent.change(screen.getByPlaceholderText('中文标签'), { target: { value: '等级2' } })
    fireEvent.click(screen.getByText('加入'))
    expect(screen.getByText(/字段名已存在: level/)).toBeInTheDocument()
  })

  it('撤销添加字段', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ 添加新字段'))
    fireEvent.change(screen.getByPlaceholderText('字段名 (英文)'), { target: { value: 'hp' } })
    fireEvent.change(screen.getByPlaceholderText('中文标签'), { target: { value: '生命值' } })
    fireEvent.click(screen.getByText('加入'))
    expect(screen.getByText('hp')).toBeInTheDocument()
    // 点击撤销添加（title="撤销添加"）
    fireEvent.click(screen.getByTitle('撤销添加'))
    expect(screen.queryByText('待添加字段（保存后生效）')).not.toBeInTheDocument()
  })
})

describe('TableDesignModal - 保存结构变更', () => {
  it('无变更时保存按钮禁用', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText('保存结构变更')).toBeDisabled()
  })

  it('有变更后保存按钮启用', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    // 删除一个字段产生变更
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText('保存结构变更')).not.toBeDisabled()
  })

  it('点击保存调用 alterTable', async () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    // 删除一个字段
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByText('保存结构变更'))
    // 删字段确认已改为自定义弹窗：需点击"确认删除字段"按钮才触发 alterTable
    await waitFor(() => {
      expect(screen.getByText('确认删除字段')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('确认删除字段'))
    await waitFor(() => {
      expect(window.qqbat.launchConfig.alterTable).toHaveBeenCalled()
    })
  })

  it('删除字段时显示自定义确认弹窗（替代 window.confirm）', async () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByText('保存结构变更'))
    // 应显示自定义确认弹窗（不再使用 window.confirm）
    await waitFor(() => {
      expect(screen.getByText('危险操作：删除字段并重建表')).toBeInTheDocument()
      expect(screen.getByText('确认删除字段')).toBeInTheDocument()
      expect(screen.getByText('取消')).toBeInTheDocument()
    })
    // 点击取消不应调用 alterTable
    fireEvent.click(screen.getByText('取消'))
    expect(window.qqbat.launchConfig.alterTable).not.toHaveBeenCalled()
  })

  it('alterTable 失败显示错误信息', async () => {
    setupIpc({ alterTable: { ok: false, error: '字段正在使用中' } })
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByText('保存结构变更'))
    // 需点击"确认删除字段"才触发 alterTable
    await waitFor(() => {
      expect(screen.getByText('确认删除字段')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('确认删除字段'))
    await waitFor(() => {
      expect(screen.getByText('字段正在使用中')).toBeInTheDocument()
    })
  })

  it('alterTable 异常时显示错误信息', async () => {
    setupIpc({ alterThrow: true })
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByText('保存结构变更'))
    // 需点击"确认删除字段"才触发 alterTable
    await waitFor(() => {
      expect(screen.getByText('确认删除字段')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('确认删除字段'))
    await waitFor(() => {
      expect(screen.getByText('IPC alter 失败')).toBeInTheDocument()
    })
  })

  it('保存成功后调用 onChanged', async () => {
    const onChanged = vi.fn()
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={onChanged}
      />
    )
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByText('保存结构变更'))
    // 需点击"确认删除字段"才触发 alterTable
    await waitFor(() => {
      expect(screen.getByText('确认删除字段')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('确认删除字段'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
    })
  })
})

describe('TableDesignModal - 重命名表', () => {
  it('修改表名后点击"重命名表"调用 renameTable', async () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    // 编辑表名
    const nameInput = screen.getByDisplayValue('玩家表') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '玩家信息表' } })
    fireEvent.click(screen.getByText('重命名表'))
    await waitFor(() => {
      expect(window.qqbat.launchConfig.renameTable).toHaveBeenCalledWith(PROJ_PATH, CATEGORY, '玩家信息表')
    })
  })

  it('表名未修改时"重命名表"按钮禁用', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText('重命名表')).toBeDisabled()
  })

  it('重命名失败显示错误信息', async () => {
    setupIpc({ renameTable: { ok: false, error: '名称已存在' } })
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    const nameInput = screen.getByDisplayValue('玩家表') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '新名称' } })
    fireEvent.click(screen.getByText('重命名表'))
    await waitFor(() => {
      expect(screen.getByText('名称已存在')).toBeInTheDocument()
    })
  })

  it('重命名成功后调用 onChanged 与 onClose', async () => {
    const onChanged = vi.fn()
    const onClose = vi.fn()
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={onClose}
        onChanged={onChanged}
      />
    )
    const nameInput = screen.getByDisplayValue('玩家表') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '新名称' } })
    fireEvent.click(screen.getByText('重命名表'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})

describe('TableDesignModal - 删除整表', () => {
  it('点击"删除整表"显示确认框', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('删除整表'))
    expect(screen.getByText('危险操作：删除整张表')).toBeInTheDocument()
  })

  it('点击"取消"关闭确认框', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('删除整表'))
    expect(screen.getByText('危险操作：删除整张表')).toBeInTheDocument()
    // 在确认框内点击"取消"
    const cancelButtons = screen.getAllByText('取消')
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    expect(screen.queryByText('危险操作：删除整张表')).not.toBeInTheDocument()
  })

  it('确认删除调用 dropTable', async () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('删除整表'))
    // 确认框内"确认删除"按钮
    const confirmButtons = screen.getAllByText('确认删除')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => {
      expect(window.qqbat.launchConfig.dropTable).toHaveBeenCalledWith(PROJ_PATH, CATEGORY)
    })
  })

  it('dropTable 失败显示错误信息', async () => {
    setupIpc({ dropTable: { ok: false, error: '权限不足' } })
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('删除整表'))
    const confirmButtons = screen.getAllByText('确认删除')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('权限不足')).toBeInTheDocument()
    })
  })

  it('dropTable 成功调用 onChanged 与 onClose', async () => {
    const onChanged = vi.fn()
    const onClose = vi.fn()
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={onClose}
        onChanged={onChanged}
      />
    )
    fireEvent.click(screen.getByText('删除整表'))
    const confirmButtons = screen.getAllByText('确认删除')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})

describe('TableDesignModal - 关闭', () => {
  it('点击右上角 × 调用 onClose', () => {
    const onClose = vi.fn()
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={onClose}
        onChanged={vi.fn()}
      />
    )
    // 头部 × 按钮：Modal 只给了 aria-label（没有 title）
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击底部"关闭"按钮调用 onClose', () => {
    const onClose = vi.fn()
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={onClose}
        onChanged={vi.fn()}
      />
    )
    // 底部"关闭"按钮
    const closeButtons = screen.getAllByText('关闭')
    fireEvent.click(closeButtons[closeButtons.length - 1])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('显示"无未保存变更"状态', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText('无未保存变更')).toBeInTheDocument()
  })

  it('有变更时显示待保存统计', () => {
    render(
      <TableDesignModal
        open={true}
        projectPath={PROJ_PATH}
        category={CATEGORY}
        displayName="玩家表"
        schema={mockSchema}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )
    const deleteButtons = screen.getAllByTitle('删除字段')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText(/待保存：/)).toBeInTheDocument()
    expect(screen.getByText(/-1 删除/)).toBeInTheDocument()
  })
})
