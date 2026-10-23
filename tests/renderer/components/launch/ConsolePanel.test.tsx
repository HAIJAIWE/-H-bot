// tests/renderer/components/launch/ConsolePanel.test.tsx
//
// ConsolePanel = 官方 API 的「消息调试器」：把一条测试消息注入机器人，
// 验证流程能收到（10/18 起终端/ NapCat 指令行已退役，这里只测注入链路）。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ project: { currentProject: null as { path: string } | null } }))

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: (selector: (s: typeof mocks.project) => unknown) => selector(mocks.project),
}))

import { ConsolePanel } from '@renderer/components/launch/ConsolePanel'

const PROJECT = 'D:/projects/demo'

function setupRuntime() {
  const injectTestMessage = vi.fn().mockResolvedValue({ ok: true })
  const restart = vi.fn().mockResolvedValue({ ok: true })
  // 重启走 botManager（runtime:* 已收窄为只观测：注入 + 节点执行 + 批量日志）
  ;(window as unknown as { qqbat: unknown }).qqbat = {
    runtime: { injectTestMessage },
    botManager: { restart }
  }
  return { injectTestMessage, restart }
}

beforeEach(() => {
  mocks.project.currentProject = { path: PROJECT }
  setupRuntime()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as { qqbat?: unknown }).qqbat
})

describe('ConsolePanel - 无项目状态', () => {
  it('无项目时显示引导', () => {
    mocks.project.currentProject = null
    render(<ConsolePanel />)
    expect(screen.getByText('请先选择一个项目')).toBeInTheDocument()
    expect(screen.getByText('在左侧选择已有项目，控制台将显示调试工具')).toBeInTheDocument()
  })
})

describe('ConsolePanel - 官方 API 消息调试器', () => {
  it('显示标题与输入提示', () => {
    render(<ConsolePanel />)
    expect(screen.getByText('消息调试器 (官方API)')).toBeInTheDocument()
    expect(screen.getByText('输入消息内容并回车，模拟从 QQ 收到消息')).toBeInTheDocument()
  })

  it('输入前发送按钮不可用，输入后可用', () => {
    render(<ConsolePanel />)
    const send = screen.getByRole('button', { name: '发送' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('测试消息输入框'), { target: { value: '你好' } })
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('默认按私聊注入，并把回显写进控制台', async () => {
    const { injectTestMessage } = setupRuntime()
    render(<ConsolePanel />)
    fireEvent.change(screen.getByLabelText('测试消息输入框'), { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(injectTestMessage).toHaveBeenCalledWith(PROJECT, '你好', 'c2c'))
    expect(screen.getByText('> [私聊] 你好')).toBeInTheDocument()
    expect(screen.getByText('消息已注入机器人')).toBeInTheDocument()
    expect((screen.getByLabelText('测试消息输入框') as HTMLInputElement).value).toBe('')
  })

  it('切到群聊后按群聊注入', async () => {
    const { injectTestMessage } = setupRuntime()
    render(<ConsolePanel />)
    fireEvent.click(screen.getByRole('combobox', { name: '消息类型' }))
    fireEvent.click(screen.getByText('群聊'))
    fireEvent.change(screen.getByLabelText('测试消息输入框'), { target: { value: '大家好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(injectTestMessage).toHaveBeenCalledWith(PROJECT, '大家好', 'group'))
    expect(screen.getByText('> [群聊] 大家好')).toBeInTheDocument()
  })

  it('注入失败（ok=false）时显示后端原因', async () => {
    const { injectTestMessage } = setupRuntime()
    injectTestMessage.mockResolvedValue({ ok: false, error: '机器人没在运行' })
    render(<ConsolePanel />)
    fireEvent.change(screen.getByLabelText('测试消息输入框'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByText('机器人没在运行')).toBeInTheDocument())
  })

  it('IPC 抛异常时显示错误前缀', async () => {
    const { injectTestMessage } = setupRuntime()
    injectTestMessage.mockRejectedValue(new Error('boom'))
    render(<ConsolePanel />)
    fireEvent.change(screen.getByLabelText('测试消息输入框'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByText('错误: Error: boom')).toBeInTheDocument())
  })

  it('Enter 发送、Shift+Enter 不发送', async () => {
    const { injectTestMessage } = setupRuntime()
    render(<ConsolePanel />)
    const input = screen.getByLabelText('测试消息输入框')
    fireEvent.change(input, { target: { value: '回车发送' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(injectTestMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(injectTestMessage).toHaveBeenCalledTimes(1))
  })

  it('清屏清空回显', async () => {
    setupRuntime()
    render(<ConsolePanel />)
    fireEvent.change(screen.getByLabelText('测试消息输入框'), { target: { value: '有内容' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('> [私聊] 有内容')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '清屏' }))
    expect(screen.queryByText('> [私聊] 有内容')).not.toBeInTheDocument()
    expect(screen.getByText('输入消息内容并回车，模拟从 QQ 收到消息')).toBeInTheDocument()
  })

  it('重启按钮调用 botManager.restart 并回显', async () => {
    const { restart } = setupRuntime()
    render(<ConsolePanel />)
    fireEvent.click(screen.getByRole('button', { name: '重启机器人' }))

    await waitFor(() => expect(restart).toHaveBeenCalledWith(PROJECT))
    expect(screen.getByText('重启命令已发送')).toBeInTheDocument()
  })
})
