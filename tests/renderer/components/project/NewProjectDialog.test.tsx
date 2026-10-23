// tests/renderer/components/project/NewProjectDialog.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { NewProjectDialog } from '@renderer/components/project/NewProjectDialog'
import type { ProjectMeta } from '@shared/types/project'

// ── Mock ResizeObserver（jsdom 不提供） ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any

// ── Mock 数据 ──
const mockCreatedProject: ProjectMeta = {
  id: 'p1',
  name: 'my-bot',
  path: '/tmp/my-bot',
  adapter: 'official',
  botType: 'qq',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

// ── Mock window.qqbat IPC ──
type MockRes<T> = { ok: boolean; data?: T; error?: string }

function setupIpc(opts: {
  createRes?: MockRes<ProjectMeta>
  throwError?: boolean
} = {}) {
  const res = opts.createRes ?? { ok: true, data: mockCreatedProject }
  const create = vi.fn()
  if (opts.throwError) {
    create.mockRejectedValue(new Error('IPC 桥接失败'))
  } else {
    create.mockResolvedValue(res)
  }
  window.qqbat = {
    project: { create },
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

describe('NewProjectDialog - 渲染', () => {
  it('open=false 时不渲染任何内容', () => {
    render(<NewProjectDialog open={false} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.queryByText('新建 Bot 项目')).not.toBeInTheDocument()
  })

  it('open=true 时显示"新建 Bot 项目"标题', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText('新建 Bot 项目')).toBeInTheDocument()
  })

  it('显示项目名称输入框（placeholder 为 例如：我的机器人）', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByPlaceholderText('例如：我的机器人')).toBeInTheDocument()
  })

  it('名称为空时创建按钮禁用', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText('创建项目')).toBeDisabled()
  })
})

describe('NewProjectDialog - 机器人类型展示', () => {
  it('默认显示 qq 类型的描述（只讲它真正影响什么）', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    // 默认是 QQ 官方框架；描述来自 launch.botType.qqDesc（不再承诺"签到/积分/RPG"这类画布不会有的东西）
    expect(
      screen.getByText(/节点库只显示与 QQ 平台相关的节点/),
    ).toBeInTheDocument()
  })

  it('默认显示"机器人类型"标签', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText('机器人类型')).toBeInTheDocument()
  })
})

describe('NewProjectDialog - 机器人类型切换', () => {
  it('点击下拉展开后显示所有类型选项', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    // Dropdown 的可交互元素是 role=combobox（a11y 正解），不是 button
    fireEvent.click(screen.getByRole('combobox', { name: '机器人类型' }))
    expect(screen.getAllByText('QQ 机器人框架').length).toBeGreaterThan(0)
    expect(screen.getByText('通用机器人')).toBeInTheDocument()
    expect(screen.getByText('游戏机器人')).toBeInTheDocument()
  })

  it('切换到"游戏机器人"后显示对应描述', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox', { name: '机器人类型' }))
    fireEvent.click(screen.getByText('游戏机器人'))
    expect(screen.getByText(/按角色属性\/战斗分组/)).toBeInTheDocument()
  })
})

describe('NewProjectDialog - 表单交互与验证', () => {
  it('输入合法名称后创建按钮启用', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    const input = screen.getByPlaceholderText('例如：我的机器人')
    fireEvent.change(input, { target: { value: 'my-bot' } })
    expect(screen.getByText('创建项目')).not.toBeDisabled()
  })

  it('输入非法字符实时显示错误提示', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    const input = screen.getByPlaceholderText('例如：我的机器人')
    fireEvent.change(input, { target: { value: 'a/b' } })
    expect(screen.getByText(/项目名称不能包含以下字符/)).toBeInTheDocument()
  })

  it('含非法字符时创建按钮禁用', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    const input = screen.getByPlaceholderText('例如：我的机器人')
    fireEvent.change(input, { target: { value: 'a:b' } })
    expect(screen.getByText('创建项目')).toBeDisabled()
  })

  it('清空名称后创建按钮重新禁用', () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    const input = screen.getByPlaceholderText('例如：我的机器人')
    fireEvent.change(input, { target: { value: 'my-bot' } })
    expect(screen.getByText('创建项目')).not.toBeDisabled()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('创建项目')).toBeDisabled()
  })
})

describe('NewProjectDialog - 关闭与创建回调', () => {
  it('点击关闭按钮（×）调用 onClose', () => {
    const onClose = vi.fn()
    render(<NewProjectDialog open={true} onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('×'))
    expect(onClose).toHaveBeenCalled()
  })

  it('创建成功调用 IPC project.create 并传入正确参数', async () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: 'my-bot' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(window.qqbat.project.create).toHaveBeenCalledWith({
        name: 'my-bot',
        adapter: 'official',
        botType: 'qq',
      })
    })
  })

  it('创建成功调用 onCreated 回调并传入 ProjectMeta', async () => {
    const onCreated = vi.fn()
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: 'my-bot' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(mockCreatedProject)
    })
  })

  it('名称带前后空格时自动 trim 后提交', async () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: '  my-bot  ' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(window.qqbat.project.create).toHaveBeenCalledWith({
        name: 'my-bot',
        adapter: 'official',
        botType: 'qq',
      })
    })
  })
})

describe('NewProjectDialog - 错误处理', () => {
  it('IPC 返回 ok=false 时显示错误信息', async () => {
    setupIpc({ createRes: { ok: false, error: '项目已存在' } })
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: 'my-bot' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(screen.getByText('项目已存在')).toBeInTheDocument()
    })
  })

  it('IPC 抛出异常时显示错误信息', async () => {
    setupIpc({ throwError: true })
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: 'my-bot' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(screen.getByText('IPC 桥接失败')).toBeInTheDocument()
    })
  })

  it('window.qqbat.project 不存在时显示"系统未就绪，请稍后重试"', async () => {
    delete (window as any).qqbat
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: 'my-bot' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(screen.getByText('系统未就绪，请稍后重试')).toBeInTheDocument()
    })
  })

  it('创建过程中按钮显示"创建中..."', async () => {
    // 使用受控 promise 让创建过程挂起，以便观察加载态
    let resolveCreate: (val: any) => void = () => {}
    const pendingPromise = new Promise(resolve => { resolveCreate = resolve })
    window.qqbat = {
      project: { create: vi.fn().mockReturnValue(pendingPromise) },
    } as any

    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('例如：我的机器人'), { target: { value: 'my-bot' } })
    fireEvent.click(screen.getByText('创建项目'))
    await waitFor(() => {
      expect(screen.getByText('创建中...')).toBeInTheDocument()
    })
    // 释放 promise 避免悬挂
    resolveCreate({ ok: true, data: mockCreatedProject })
  })
})
