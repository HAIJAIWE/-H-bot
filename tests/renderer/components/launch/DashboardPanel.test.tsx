// tests/renderer/components/launch/DashboardPanel.test.tsx
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DashboardPanel } from '@renderer/components/launch/DashboardPanel'
import { ToastProvider } from '@renderer/components/ui/Toast'
import type React from 'react'

function renderWithProvider(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

import { useProjectStore } from '@renderer/stores/projectStore'
import { useBotStore } from '@renderer/stores/botStore'
import type { TimelineItem, DashboardStatus } from '@shared/types/launch'
import type { ProjectMeta } from '@shared/types/project'

// ── Mock 子组件（简化渲染，仅标记是否打开） ──
vi.mock('@renderer/components/launch/ConnectionConfigDialog', () => ({
  ConnectionConfigDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="connection-config-dialog" /> : null,
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
  createdAt: '',
  updatedAt: '',
}

const mockTimeline: TimelineItem[] = [
  { id: 1, time: '12:00', content: '收到消息hello', type: 'message' },
  { id: 2, time: '12:01', content: '发送回复world', type: 'reply' },
  { id: 3, time: '12:02', content: '群事件触发', type: 'event' },
]

const mockStatus: DashboardStatus = {
  running: true,
  onlineTime: 3600,
  messageCount: 42,
  groupCount: 3,
  memberCount: 100,
}

// ── Mock window.qqbat IPC ──
type MockRes<T> = { ok: boolean; data?: T; error?: string }

function setupIpc(opts: {
  timeline?: MockRes<TimelineItem[]>
  status?: MockRes<DashboardStatus>
  projectConfig?: MockRes<{ adapter: string; translatorPort: number }>
  throwError?: boolean
} = {}) {
  const timelineRes = opts.timeline ?? { ok: true, data: mockTimeline }
  const statusRes = opts.status ?? { ok: true, data: mockStatus }
  const projectRes = opts.projectConfig ?? { ok: true, data: { adapter: 'official', translatorPort: 1001 } }

  const getTimeline = vi.fn()
  const getStatus = vi.fn()
  if (opts.throwError) {
    getTimeline.mockRejectedValue(new Error('IPC 桥接失败'))
    getStatus.mockRejectedValue(new Error('IPC 桥接失败'))
  } else {
    getTimeline.mockResolvedValue(timelineRes)
    getStatus.mockResolvedValue(statusRes)
  }

  window.qqbat = {
    launchDashboard: {
      getTimeline,
      getStatus,
      getGroups: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
    project: {
      getConfig: vi.fn().mockResolvedValue(projectRes),
      updateTranslatorPort: vi.fn().mockResolvedValue({ ok: true }),
    },
    // 启动机器人前会先落盘（botStore 里"落盘失败即取消启动"的守卫要求这条通道存在，
    // 否则 startBot 会直接中止，botManager.start 永远不会被调用）
    flow: { save: vi.fn().mockResolvedValue({ ok: true }) },
    botManager: {
      start: vi.fn().mockResolvedValue({ ok: true }),
      stop: vi.fn().mockResolvedValue({ ok: true }),
      list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      restart: vi.fn().mockResolvedValue({ ok: true }),
      register: vi.fn().mockResolvedValue({ ok: true }),
      unregister: vi.fn().mockResolvedValue({ ok: true }),
      onStatusChanged: vi.fn(() => () => {}),
      offStatusChanged: vi.fn(),
    },
  } as any
}

beforeEach(() => {
  useProjectStore.getState().reset()
  useBotStore.setState({ bots: [], selectedBotPath: null, loading: false, error: null })
  setupIpc()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // 清理可能残留的 window.qqbat
  delete (window as any).qqbat
})

describe('DashboardPanel - 无项目状态', () => {
  it('无项目时显示空状态提示', () => {
    renderWithProvider(<DashboardPanel />)
    expect(screen.getByText('请先选择一个项目')).toBeInTheDocument()
  })

  it('无项目时显示新建项目按钮', () => {
    renderWithProvider(<DashboardPanel />)
    expect(screen.getByText('新建项目')).toBeInTheDocument()
  })

  it('点击新建项目按钮打开对话框', () => {
    renderWithProvider(<DashboardPanel />)
    fireEvent.click(screen.getByText('新建项目'))
    expect(screen.getByTestId('new-project-dialog')).toBeInTheDocument()
  })
})

describe('DashboardPanel - 数据加载', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('mount 时调用 getTimeline 和 getStatus IPC', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(window.qqbat.launchDashboard.getTimeline).toHaveBeenCalledWith('/tmp/test-project')
    })
    expect(window.qqbat.launchDashboard.getStatus).toHaveBeenCalledWith('/tmp/test-project')
  })


  it('mount 时调用 project.getConfig 加载项目配置', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(window.qqbat.project.getConfig).toHaveBeenCalledWith('/tmp/test-project')
    })
  })

  it('加载成功后显示时间线内容', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('收到消息hello')).toBeInTheDocument()
    })
    expect(screen.getByText('发送回复world')).toBeInTheDocument()
    expect(screen.getByText('群事件触发')).toBeInTheDocument()
  })

  it('加载成功后显示状态卡片中的消息数', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument()
    })
  })

  it('时间线加载失败时显示错误提示', async () => {
    setupIpc({ timeline: { ok: false, error: '加载失败测试' } })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('加载失败测试')).toBeInTheDocument()
    })
  })

  it('时间线加载失败时显示重试按钮', async () => {
    setupIpc({ timeline: { ok: false, error: '加载失败测试' } })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })
  })

  it('点击重试按钮重新调用 getTimeline', async () => {
    setupIpc({ timeline: { ok: false, error: '加载失败测试' } })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument()
    })
    const initialCallCount = vi.mocked(window.qqbat.launchDashboard.getTimeline).mock.calls.length
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => {
      expect(vi.mocked(window.qqbat.launchDashboard.getTimeline).mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  it('IPC 调用抛出异常时显示友好错误提示', async () => {
    setupIpc({ throwError: true })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('加载仪表盘数据失败，请稍后重试')).toBeInTheDocument()
    })
  })
})

describe('DashboardPanel - 状态卡片', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('bot 未运行时显示"已停止"', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('已停止')).toBeInTheDocument()
    })
  })

  it('bot 运行中时显示"运行中"', async () => {
    useBotStore.setState({
      bots: [{
        projectPath: '/tmp/test-project',
        name: '测试项目',
        qq: '10086',
        adapter: 'official',
        status: 'running',
        pid: 1234,
        uptime: 3600,
        startedAt: new Date().toISOString(),
      }],
    })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('运行中')).toBeInTheDocument()
    })
  })


  it('显示翻译器端口', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('1001')).toBeInTheDocument()
    })
  })

  it('official 适配器显示"官方 API"', async () => {
    setupIpc({ projectConfig: { ok: true, data: { adapter: 'official', translatorPort: 2001 } } })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('官方 API')).toBeInTheDocument()
    })
  })
})

describe('DashboardPanel - 空时间线', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('时间线为空时显示"暂无动态"', async () => {
    setupIpc({ timeline: { ok: true, data: [] } })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('暂无动态')).toBeInTheDocument()
    })
  })

  it('时间线为空时显示刷新按钮', async () => {
    setupIpc({ timeline: { ok: true, data: [] } })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('暂无动态')).toBeInTheDocument()
    })
    // 空状态和标题栏都包含刷新按钮
    expect(screen.getAllByText('刷新').length).toBeGreaterThanOrEqual(1)
  })
})

describe('DashboardPanel - 用户交互', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('点击刷新按钮重新加载数据', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('刷新')).toBeInTheDocument()
    })
    const initialCallCount = vi.mocked(window.qqbat.launchDashboard.getTimeline).mock.calls.length
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => {
      expect(vi.mocked(window.qqbat.launchDashboard.getTimeline).mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  it('停止状态下启动按钮可点击', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('启动')).toBeInTheDocument()
    })
    expect(screen.getByText('启动')).not.toBeDisabled()
  })

  it('停止状态下停止按钮禁用', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('停止')).toBeInTheDocument()
    })
    expect(screen.getByText('停止')).toBeDisabled()
  })

  it('点击启动按钮调用 botManager.start', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('启动')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('启动'))
    await waitFor(() => {
      expect(window.qqbat.botManager.start).toHaveBeenCalledWith('/tmp/test-project')
    })
  })

  it('运行中时启动按钮禁用', async () => {
    useBotStore.setState({
      bots: [{
        projectPath: '/tmp/test-project',
        name: '测试项目',
        qq: '10086',
        adapter: 'official',
        status: 'running',
        pid: 1234,
        uptime: 3600,
        startedAt: new Date().toISOString(),
      }],
    })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('运行中')).toBeInTheDocument()
    })
    expect(screen.getByText('启动')).toBeDisabled()
    expect(screen.getByText('停止')).not.toBeDisabled()
  })

  it('运行中点击停止按钮调用 botManager.stop', async () => {
    useBotStore.setState({
      bots: [{
        projectPath: '/tmp/test-project',
        name: '测试项目',
        qq: '10086',
        adapter: 'official',
        status: 'running',
        pid: 1234,
        uptime: 3600,
        startedAt: new Date().toISOString(),
      }],
    })
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('停止')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByText('停止'))
    await waitFor(() => {
      expect(window.qqbat.botManager.stop).toHaveBeenCalledWith('/tmp/test-project')
    })
  })

  it('点击连接设置打开配置对话框', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('连接设置')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('连接设置'))
    expect(screen.getByTestId('connection-config-dialog')).toBeInTheDocument()
  })

})

describe('DashboardPanel - 时间线类型渲染', () => {
  beforeEach(() => {
    useProjectStore.getState().setCurrentProject(mockProject)
  })

  it('正确渲染消息类型标签', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('收到消息hello')).toBeInTheDocument()
    })
    expect(screen.getByText('消息')).toBeInTheDocument()
  })

  it('正确渲染回复类型标签', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('发送回复world')).toBeInTheDocument()
    })
    expect(screen.getByText('回复')).toBeInTheDocument()
  })

  it('正确渲染事件类型标签', async () => {
    renderWithProvider(<DashboardPanel />)
    await waitFor(() => {
      expect(screen.getByText('群事件触发')).toBeInTheDocument()
    })
    expect(screen.getByText('事件')).toBeInTheDocument()
  })
})
