// tests/renderer/components/launch/HomePanel.test.tsx
// 主页面行为：最近项目列表、打开/移除项目、当前项目卡、快捷入口切页签。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type React from 'react'
import { HomePanel } from '@renderer/components/launch/HomePanel'
import { ToastProvider } from '@renderer/components/ui/Toast'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useUiStore } from '@renderer/stores/uiStore'
import type { ProjectMeta, RecentProject } from '@shared/types/project'

vi.mock('@renderer/components/project/NewProjectDialog', () => ({
  NewProjectDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="new-project-dialog" /> : null,
}))

type MockRes<T> = { ok: boolean; data?: T; error?: string }

const projectA: RecentProject = {
  id: 'a',
  name: 'RPG测试项目',
  path: '/tmp/proj-a',
  lastOpenedAt: '2026-10-23T13:38:22.035Z',
}
const projectB: RecentProject = {
  id: 'b',
  name: '代码编辑测试',
  path: '/tmp/proj-b',
  lastOpenedAt: '2026-10-22T08:00:00.000Z',
}
const metaA: ProjectMeta = {
  id: 'a',
  name: 'RPG测试项目',
  path: '/tmp/proj-a',
  adapter: 'official',
  botType: 'qq',
  createdAt: '',
  updatedAt: '',
}

interface IpcOptions {
  recents?: MockRes<RecentProject[]>
  open?: MockRes<unknown>
  meta?: MockRes<ProjectMeta>
  pick?: MockRes<string>
  remove?: MockRes<unknown>
  folder?: MockRes<unknown>
}

function setupIpc(opts: IpcOptions = {}) {
  const listRecent = vi.fn().mockResolvedValue(opts.recents ?? { ok: true, data: [projectA, projectB] })
  const open = vi.fn().mockResolvedValue(opts.open ?? { ok: true, data: { path: '/tmp/proj-a' } })
  const getMeta = vi.fn().mockResolvedValue(opts.meta ?? { ok: true, data: metaA })
  const pickDirectory = vi.fn().mockResolvedValue(opts.pick ?? { ok: true, data: '/tmp/proj-a' })
  const removeRecent = vi.fn().mockResolvedValue(opts.remove ?? { ok: true })
  const openFolder = vi.fn().mockResolvedValue(opts.folder ?? { ok: true })
  const register = vi.fn().mockResolvedValue({ ok: true })

  window.qqbat = {
    project: { listRecent, open, getMeta, pickDirectory, removeRecent, openFolder },
    botManager: { register },
  } as any

  return { listRecent, open, getMeta, pickDirectory, removeRecent, openFolder, register }
}

function renderPanel() {
  return render(
    <ToastProvider>
      <HomePanel />
    </ToastProvider>,
  )
}

beforeEach(() => {
  useProjectStore.getState().reset()
  useUiStore.setState({ mode: 'launch', launchTab: 'home', centerTab: 'blocks' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).qqbat
})

describe('HomePanel - 最近项目列表', () => {
  it('挂载时读 listRecent 并把项目名与路径渲染出来', async () => {
    const ipc = setupIpc()
    renderPanel()

    expect(await screen.findByText('RPG测试项目')).toBeInTheDocument()
    expect(ipc.listRecent).toHaveBeenCalledTimes(1)
    expect(screen.getByText('代码编辑测试')).toBeInTheDocument()
    expect(screen.getByText('/tmp/proj-b', { exact: false })).toBeInTheDocument()
  })

  it('最近列表为空时显示空态文案', async () => {
    setupIpc({ recents: { ok: true, data: [] } })
    renderPanel()

    expect(await screen.findByText('还没有最近打开的项目')).toBeInTheDocument()
  })

  it('读取失败时把错误显示出来，而不是假装列表为空', async () => {
    setupIpc({ recents: { ok: false, error: '最近列表读不出来' } })
    renderPanel()

    expect(await screen.findByText('最近列表读不出来')).toBeInTheDocument()
  })

  it('点刷新会重新读一次列表', async () => {
    const ipc = setupIpc()
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(ipc.listRecent).toHaveBeenCalledTimes(2))
  })
})

describe('HomePanel - 打开与移除', () => {
  it('点打开：open → getMeta → 注册到 botManager → 设为当前项目并切到仪表盘', async () => {
    const ipc = setupIpc()
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getAllByText('打开')[0])

    await waitFor(() => expect(ipc.open).toHaveBeenCalledWith('/tmp/proj-a'))
    expect(ipc.getMeta).toHaveBeenCalledWith('/tmp/proj-a')
    expect(ipc.register).toHaveBeenCalledWith('/tmp/proj-a')
    await waitFor(() => expect(useProjectStore.getState().currentProject?.path).toBe('/tmp/proj-a'))
    expect(useUiStore.getState().mode).toBe('launch')
    expect(useUiStore.getState().launchTab).toBe('dashboard')
  })

  it('打开失败时不改当前项目，也不切页签', async () => {
    const ipc = setupIpc({ open: { ok: false, error: '项目已被删除' } })
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getAllByText('打开')[0])

    await waitFor(() => expect(ipc.open).toHaveBeenCalled())
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useUiStore.getState().launchTab).toBe('home')
  })

  it('点打开文件夹调用 openFolder', async () => {
    const ipc = setupIpc()
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getAllByLabelText('打开文件夹')[1])

    await waitFor(() => expect(ipc.openFolder).toHaveBeenCalledWith('/tmp/proj-b'))
  })

  it('点移除调用 removeRecent 并重新读列表', async () => {
    const ipc = setupIpc()
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getAllByLabelText('从最近项目移除')[0])

    await waitFor(() => expect(ipc.removeRecent).toHaveBeenCalledWith('/tmp/proj-a'))
    await waitFor(() => expect(ipc.listRecent).toHaveBeenCalledTimes(2))
  })
})

describe('HomePanel - 当前项目与快捷入口', () => {
  it('没有当前项目时给出提示，点打开已有项目会走 pickDirectory', async () => {
    const ipc = setupIpc()
    renderPanel()
    await screen.findByText('RPG测试项目')

    expect(screen.getByText('还没有选中项目')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('打开已有项目')[0])

    await waitFor(() => expect(ipc.pickDirectory).toHaveBeenCalled())
    await waitFor(() => expect(ipc.open).toHaveBeenCalledWith('/tmp/proj-a'))
  })

  it('快捷入口「低代码」切到开发模式并选中中心页签', async () => {
    setupIpc()
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getByText('低代码'))

    expect(useUiStore.getState().mode).toBe('dev')
    expect(useUiStore.getState().centerTab).toBe('blocks')
  })

  it('快捷入口「仪表盘」切回启动模式并选中仪表盘页签', async () => {
    setupIpc()
    useUiStore.setState({ mode: 'dev' })
    renderPanel()
    await screen.findByText('RPG测试项目')

    fireEvent.click(screen.getByText('仪表盘'))

    expect(useUiStore.getState().mode).toBe('launch')
    expect(useUiStore.getState().launchTab).toBe('dashboard')
  })

  it('有当前项目时显示项目卡与打开文件夹按钮', async () => {
    setupIpc()
    useProjectStore.getState().setCurrentProject(metaA)
    renderPanel()

    expect(await screen.findByText('/tmp/proj-a', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('QQ 机器人框架')).toBeInTheDocument()
  })
})
