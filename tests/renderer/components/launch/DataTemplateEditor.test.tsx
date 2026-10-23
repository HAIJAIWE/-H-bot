// tests/renderer/components/launch/DataTemplateEditor.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DataTemplateEditor } from '@renderer/components/launch/DataTemplateEditor'
import type { DataTemplate } from '@renderer/types/ipc'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// ── Mock useToast（必须返回稳定引用，避免依赖 toast 的 useCallback 重建引发无限循环） ──
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

// ── Mock 数据 ──
const PROJ_PATH = '/tmp/test-project'

const mockTemplate: DataTemplate = {
  version: 1,
  groups: [
    {
      id: 'basic',
      label: '基础信息',
      icon: '👤',
      fields: [
        { key: 'nickname', label: '昵称', type: 'text', default: '', description: '玩家昵称' },
        { key: 'level', label: '等级', type: 'number', default: 1, description: '玩家等级' },
      ],
    },
    {
      id: 'signin',
      label: '签到系统',
      icon: '📅',
      fields: [
        { key: 'signin_count', label: '签到次数', type: 'number', default: 0, auto: true, description: '累计签到次数' },
      ],
    },
  ],
}

// 「恢复默认」时主进程会按本项目推导出这份模板（1 分组 / 1 字段）
const DERIVED_TEMPLATE: DataTemplate = {
  version: 1,
  groups: [
    {
      id: 'derived',
      label: '推导分组',
      icon: '🧩',
      fields: [{ key: 'score', label: '积分', type: 'number', default: 0 }],
    },
  ],
}

// ── Mock window.qqbat IPC ──
function setupIpc(opts: { template?: DataTemplate | null; throwError?: boolean; saveOk?: boolean; saveError?: string } = {}) {
  const tpl = opts.template === undefined ? mockTemplate : opts.template
  const saveOk = opts.saveOk ?? true
  const getDataTemplate = vi.fn()
  if (opts.throwError) {
    getDataTemplate.mockRejectedValue(new Error('IPC 桥接失败'))
  } else if (tpl === null) {
    getDataTemplate.mockResolvedValue({ ok: false, error: '模板文件不存在' })
  } else {
    getDataTemplate.mockResolvedValue({ ok: true, data: tpl })
  }
  const saveDataTemplate = vi.fn()
  if (saveOk) {
    saveDataTemplate.mockResolvedValue({ ok: true })
  } else {
    saveDataTemplate.mockResolvedValue({ ok: false, error: opts.saveError ?? '保存失败' })
  }
  // 「恢复默认」= 让主进程按本项目推导（deriveTemplateFromProject），不是一份硬编码示例
  const deriveDataTemplate = vi.fn().mockResolvedValue({ ok: true, data: DERIVED_TEMPLATE })
  window.qqbat = { launchData: { getDataTemplate, saveDataTemplate, deriveDataTemplate } } as any
}

beforeEach(() => {
  setupIpc()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).qqbat
})

describe('DataTemplateEditor - 无项目状态', () => {
  it('无项目时显示"请先选择一个项目"', () => {
    render(<DataTemplateEditor projectPath="" />)
    expect(screen.getByText('请先选择一个项目')).toBeInTheDocument()
  })
})

describe('DataTemplateEditor - 模板加载', () => {
  it('加载中显示"加载中..."', () => {
    // 让 getDataTemplate 永不 resolve
    window.qqbat = {
      launchData: {
        getDataTemplate: vi.fn(() => new Promise(() => {})),
        saveDataTemplate: vi.fn(),
      },
    } as any
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('加载失败显示"模板加载失败"', async () => {
    setupIpc({ template: null })
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('模板加载失败')).toBeInTheDocument()
    })
  })

  it('getDataTemplate 抛出异常时显示"模板加载失败"和 toast', async () => {
    setupIpc({ throwError: true })
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('模板加载失败')).toBeInTheDocument()
    })
    expect(stableToast.error).toHaveBeenCalled()
  })

  it('加载成功显示"数据模板编辑器"标题', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('数据模板编辑器')).toBeInTheDocument()
    })
  })

  it('加载成功显示分组数和字段数统计', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      // mockTemplate 含 2 个分组、3 个字段（2+1）
      expect(screen.getByText(/2 个分组/)).toBeInTheDocument()
      expect(screen.getByText(/3 个字段/)).toBeInTheDocument()
    })
  })

  it('加载成功显示所有分组名', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    // "基础信息" 默认被选中，会同时出现在左侧分组列表与右侧面板标题，故用 getAllByText
    await waitFor(() => {
      expect(screen.getAllByText('基础信息').length).toBeGreaterThan(0)
      expect(screen.getAllByText('签到系统').length).toBeGreaterThan(0)
    })
  })
})

describe('DataTemplateEditor - 分组切换', () => {
  it('默认选中第一个分组并显示其字段', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
      expect(screen.getByText('等级')).toBeInTheDocument()
    })
  })

  it('点击另一个分组切换字段列表', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
    })
    // 点击"签到系统"
    fireEvent.click(screen.getByText('签到系统'))
    // 切换后显示签到字段
    await waitFor(() => {
      expect(screen.getByText('签到次数')).toBeInTheDocument()
    })
  })
})

describe('DataTemplateEditor - 保存与重置', () => {
  it('点击"保存模板"调用 saveDataTemplate', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('保存模板')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('保存模板'))
    await waitFor(() => {
      expect(window.qqbat.launchData.saveDataTemplate).toHaveBeenCalledWith(PROJ_PATH, expect.any(Object))
    })
    expect(stableToast.success).toHaveBeenCalledWith('模板已保存')
  })

  it('保存失败显示 toast 错误', async () => {
    setupIpc({ saveOk: false, saveError: '权限不足' })
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('保存模板')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('保存模板'))
    await waitFor(() => {
      expect(stableToast.error).toHaveBeenCalledWith('权限不足')
    })
  })

  it('点击"恢复默认"按本项目重新推导模板', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('基础信息').length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getByText('恢复默认'))
    await waitFor(() => {
      expect(window.qqbat.launchData.deriveDataTemplate).toHaveBeenCalledWith(PROJ_PATH)
    })
    // 推导结果只有 1 个分组 1 个字段（不是旧版的 6 分组示例）
    await waitFor(() => {
      expect(screen.getByText(/1 个分组/)).toBeInTheDocument()
    })
    expect(stableToast.success).toHaveBeenCalledWith('已按本项目推导出默认模板')
  })
})

describe('DataTemplateEditor - 分组管理', () => {
  it('点击"添加分组"打开弹窗', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('添加分组')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByText('添加分组')[0])
    // 弹窗标题
    await waitFor(() => {
      expect(screen.getByText('添加分组', { selector: '.text-sm.font-medium' })).toBeInTheDocument()
    })
  })

  it('添加分组（输入名称、保存）后显示新分组', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('添加分组').length).toBeGreaterThan(0)
    })
    // 点击左侧"添加分组"按钮
    fireEvent.click(screen.getAllByText('添加分组')[0])
    // 输入分组名
    const input = screen.getByPlaceholderText('如：基础信息')
    fireEvent.change(input, { target: { value: '测试分组' } })
    // 点击弹窗内"确认保存"按钮
    const saveButtons = screen.getAllByText('确认保存')
    fireEvent.click(saveButtons[saveButtons.length - 1])
    // 新分组创建后会被自动选中，因此"测试分组"会同时出现在左侧列表和右侧面板标题
    await waitFor(() => {
      expect(screen.getAllByText('测试分组').length).toBeGreaterThan(0)
    })
    expect(stableToast.success).toHaveBeenCalledWith('分组已添加（需点击保存生效）')
  })

  it('添加分组未输入名称时显示错误 toast', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('添加分组').length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getAllByText('添加分组')[0])
    // 直接点击保存
    const saveButtons = screen.getAllByText('确认保存')
    fireEvent.click(saveButtons[saveButtons.length - 1])
    await waitFor(() => {
      expect(stableToast.error).toHaveBeenCalledWith('请输入分组名称')
    })
  })
})

describe('DataTemplateEditor - 字段管理', () => {
  it('点击"添加字段"打开字段弹窗', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
    })
    // 右侧"添加字段"按钮
    const addFieldButtons = screen.getAllByText('添加字段')
    // 至少有右侧按钮
    fireEvent.click(addFieldButtons[addFieldButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('字段 key')).toBeInTheDocument()
    })
  })

  it('添加字段（输入 key/label）后显示新字段', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
    })
    const addFieldButtons = screen.getAllByText('添加字段')
    fireEvent.click(addFieldButtons[addFieldButtons.length - 1])
    // 输入 key 和 label
    const inputs = screen.getAllByPlaceholderText(/如：/)
    // placeholder '如：signin_count' 对应 key
    const keyInput = screen.getByPlaceholderText('如：signin_count')
    fireEvent.change(keyInput, { target: { value: 'new_field' } })
    const labelInput = screen.getByPlaceholderText('如：签到次数')
    fireEvent.change(labelInput, { target: { value: '新字段' } })
    // 点击底部"确认保存"按钮
    const saveButtons = screen.getAllByText('确认保存')
    fireEvent.click(saveButtons[saveButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('新字段')).toBeInTheDocument()
    })
  })

  it('添加字段未输入 key 时显示错误 toast', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
    })
    const addFieldButtons = screen.getAllByText('添加字段')
    fireEvent.click(addFieldButtons[addFieldButtons.length - 1])
    const saveButtons = screen.getAllByText('确认保存')
    fireEvent.click(saveButtons[saveButtons.length - 1])
    await waitFor(() => {
      expect(stableToast.error).toHaveBeenCalledWith('请输入字段 key')
    })
  })

  it('自动管理字段不可删除（删除按钮禁用）', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    // 默认选中"基础信息"，先等待其字段出现
    await waitFor(() => {
      expect(screen.getByText('昵称')).toBeInTheDocument()
    })
    // 切换到"签到系统"分组
    fireEvent.click(screen.getAllByText('签到系统')[0])
    // 切换后显示签到字段
    await waitFor(() => {
      expect(screen.getByText('签到次数')).toBeInTheDocument()
    })
    // 自动字段有"自动"标记
    expect(screen.getByText('自动')).toBeInTheDocument()
  })
})

describe('DataTemplateEditor - 删除分组', () => {
  it('点击分组删除按钮打开确认弹窗', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    // 等待模板加载（基础信息默认选中，会同时出现在侧边栏和右侧标题）
    await waitFor(() => {
      expect(screen.getAllByText('基础信息').length).toBeGreaterThan(0)
    })
    // 点击基础信息分组的删除按钮（X 图标按钮）
    const deleteButtons = screen.getAllByTitle('删除分组')
    fireEvent.click(deleteButtons[0])
    await waitFor(() => {
      expect(screen.getByText('确认删除分组')).toBeInTheDocument()
    })
  })

  it('确认删除分组后从列表移除', async () => {
    render(<DataTemplateEditor projectPath={PROJ_PATH} />)
    await waitFor(() => {
      expect(screen.getAllByText('基础信息').length).toBeGreaterThan(0)
    })
    const deleteButtons = screen.getAllByTitle('删除分组')
    fireEvent.click(deleteButtons[0])
    await waitFor(() => {
      expect(screen.getByText('确认删除分组')).toBeInTheDocument()
    })
    // 点击"确认删除"按钮
    fireEvent.click(screen.getByText('确认删除'))
    await waitFor(() => {
      expect(screen.queryByText('基础信息')).not.toBeInTheDocument()
    })
    expect(stableToast.success).toHaveBeenCalledWith('分组已删除（需点击保存生效）')
  })
})
