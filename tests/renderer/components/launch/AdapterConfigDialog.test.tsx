// tests/renderer/components/launch/AdapterConfigDialog.test.tsx
//
// 适配器配置：NapCat 退役后只剩三条协议端 —— QQ 官方 API / 飞书长连接 / 钉钉 Stream。
// 这里钉的是「平台选择 → 分段表单 → 保存只写选中平台那一段」这条链路，
// 因为历史上保存时把 adapter 写死成 'official'，换平台根本做不到。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { AdapterConfigDialog } from '@renderer/components/launch/AdapterConfigDialog'

const BASE_CONFIG = {
  name: '测试项目',
  adapter: 'official',
  official: { appId: 'app-1', appSecret: 'sec-1', sandbox: true, wsUrl: '' },
  ai: { provider: 'glm', model: 'glm-4' },
  portBlock: { start: 1001 },
}

interface ApiOverrides {
  config?: Record<string, unknown>
  getConfig?: (projectPath: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  saveConfig?: (payload: unknown, projectPath: string) => Promise<{ ok: boolean; error?: string }>
  status?: string
  testConnected?: boolean
}

function installApi(over: ApiOverrides = {}) {
  const getConfig = vi.fn(
    over.getConfig ?? (async () => ({ ok: true, data: over.config ?? BASE_CONFIG })),
  )
  const saveConfig = vi.fn(over.saveConfig ?? (async () => ({ ok: true })))
  const onStatusChange = vi.fn(() => () => {})
  const onMessage = vi.fn((_cb: (d: unknown) => void) => () => {})
  const unsubStatus = vi.fn()
  const unsubMessage = vi.fn()
  onStatusChange.mockImplementation(() => unsubStatus)
  onMessage.mockImplementation((_cb: (d: unknown) => void) => unsubMessage)
  const official = {
    status: vi.fn(async () => ({
      ok: true,
      data: { status: over.status ?? 'disconnected' },
    })),
    onStatusChange,
    onMessage,
    testConnection: vi.fn(async () => ({
      ok: true,
      data: { connected: over.testConnected ?? true },
    })),
    saveConfig: vi.fn(async () => ({ ok: true })),
    start: vi.fn(async () => ({ ok: true })),
  }
  ;(window as unknown as { qqbat: unknown }).qqbat = {
    project: { getConfig, saveConfig },
    official,
  }
  return { getConfig, saveConfig, official, unsubStatus, unsubMessage }
}

function renderDialog(over: Record<string, unknown> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const view = render(
    <AdapterConfigDialog
      open
      projectPath="/p"
      onClose={onClose}
      onSaved={onSaved}
      {...over}
    />,
  )
  return { ...view, onClose, onSaved }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as { qqbat?: unknown }).qqbat
})

describe('AdapterConfigDialog - 加载与平台选择', () => {
  it('open=false 时不渲染', () => {
    installApi()
    renderDialog({ open: false })
    expect(screen.queryByText('协议端')).not.toBeInTheDocument()
  })

  it('标题带上项目名，默认停在 QQ 官方 API 并回填已存配置', async () => {
    const api = installApi()
    renderDialog()

    expect(await screen.findByText('适配器配置 · 测试项目')).toBeInTheDocument()
    expect(api.getConfig).toHaveBeenCalledWith('/p')

    const officialBtn = screen.getByRole('button', { name: /QQ 官方 API/ })
    expect(officialBtn).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('QQ 官方 API AppID') as HTMLInputElement).value).toBe('app-1')
    expect((screen.getByLabelText('QQ 官方 API AppSecret') as HTMLInputElement).value).toBe(
      'sec-1',
    )
    expect(screen.getByRole('switch', { name: /沙箱环境/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('切到飞书后只显示飞书段（含事件接收方式与「此处不支持连接」提示）', async () => {
    installApi()
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: /飞书/ }))

    expect(screen.getByRole('button', { name: /飞书/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('飞书 App ID')).toBeInTheDocument()
    expect(screen.getByLabelText('事件接收方式')).toHaveValue('long-connection')
    expect(screen.getByText(/开通 im:message/)).toBeInTheDocument()
    expect(screen.getByText(/飞书暂不支持在此处直接连接/)).toBeInTheDocument()
    expect(screen.queryByLabelText('QQ 官方 API AppID')).not.toBeInTheDocument()
  })

  it('切到钉钉显示 AppKey/AppSecret 与配置步骤说明', async () => {
    installApi()
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: /钉钉/ }))

    expect(screen.getByLabelText('钉钉 AppKey')).toBeInTheDocument()
    expect(screen.getByLabelText('钉钉 AppSecret')).toBeInTheDocument()
    expect(screen.getByText(/REGISTERED/)).toBeInTheDocument()
  })

  it('读取配置失败时显示原因，保存按钮禁用', async () => {
    installApi({ getConfig: async () => ({ ok: false, error: '读不到配置' }) })
    renderDialog()

    expect(await screen.findByText('读不到配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
})

describe('AdapterConfigDialog - 保存只写选中平台那一段', () => {
  it('QQ 官方：保存回填后的 AppID/沙箱/wsUrl，其它字段原样保留', async () => {
    const api = installApi()
    const { onSaved } = renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.change(screen.getByLabelText('QQ 官方 API AppID'), {
      target: { value: 'app-2' },
    })
    fireEvent.click(screen.getByRole('switch', { name: /沙箱环境/ }))
    fireEvent.change(screen.getByLabelText('WebSocket 地址'), {
      target: { value: 'wss://example/ws' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1))
    const [payload, projectPath] = api.saveConfig.mock.calls[0]
    expect(projectPath).toBe('/p')
    expect(payload).toMatchObject({
      adapter: 'official',
      name: '测试项目',
      ai: { provider: 'glm', model: 'glm-4' },
      official: { appId: 'app-2', appSecret: 'sec-1', sandbox: false, wsUrl: 'wss://example/ws' },
    })
    expect(typeof (payload as { updatedAt?: unknown }).updatedAt).toBe('string')
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('保存成功')).toBeInTheDocument()
  })

  it('飞书：保存只写 lark 段，adapter 记成 lark', async () => {
    const api = installApi()
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: /飞书/ }))
    fireEvent.change(screen.getByLabelText('飞书 App ID'), { target: { value: 'cli_abc' } })
    fireEvent.change(screen.getByLabelText('飞书 App Secret'), { target: { value: 'lark-sec' } })
    fireEvent.change(screen.getByLabelText('事件接收方式'), { target: { value: 'webhook' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1))
    const [payload] = api.saveConfig.mock.calls[0]
    expect(payload).toMatchObject({
      adapter: 'lark',
      lark: { appId: 'cli_abc', appSecret: 'lark-sec', eventMode: 'webhook' },
      official: { appId: 'app-1' },
    })
  })

  it('钉钉：保存只写 dingtalk 段（AppKey/AppSecret → clientId/clientSecret）', async () => {
    const api = installApi()
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: /钉钉/ }))
    fireEvent.change(screen.getByLabelText('钉钉 AppKey'), { target: { value: 'ding-1' } })
    fireEvent.change(screen.getByLabelText('钉钉 AppSecret'), { target: { value: 'ding-sec' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1))
    const [payload] = api.saveConfig.mock.calls[0]
    expect(payload).toMatchObject({
      adapter: 'dingtalk',
      dingtalk: { clientId: 'ding-1', clientSecret: 'ding-sec' },
    })
  })

  it('保存失败显示主进程给的原因，不调 onSaved', async () => {
    installApi({ saveConfig: async () => ({ ok: false, error: '磁盘满了' }) })
    const { onSaved } = renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('磁盘满了')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('取消不保存', async () => {
    const api = installApi()
    const { onClose } = renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.saveConfig).not.toHaveBeenCalled()
  })
})

describe('AdapterConfigDialog - 连接与实时事件', () => {
  it('验证凭据成功 → 凭据有效', async () => {
    const api = installApi()
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: '验证凭据' }))

    await waitFor(() => expect(api.official.testConnection).toHaveBeenCalledWith('app-1', 'sec-1'))
    expect(await screen.findByText('凭据有效，可以连接 QQ Bot API')).toBeInTheDocument()
  })

  it('验证凭据失败 → 凭据无效', async () => {
    installApi({ testConnected: false })
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: '验证凭据' }))

    expect(await screen.findByText('凭据无效，请检查 AppID 和 AppSecret')).toBeInTheDocument()
  })

  it('启动连接先存凭据再启动', async () => {
    const api = installApi()
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    fireEvent.click(screen.getByRole('button', { name: '启动连接' }))

    await waitFor(() => expect(api.official.saveConfig).toHaveBeenCalledWith('/p', 'app-1', 'sec-1', true))
    await waitFor(() => expect(api.official.start).toHaveBeenCalledWith('/p'))
  })

  it('实时事件按「类型: 数据」列出（只收本项目的）', async () => {
    const api = installApi()
    let push: ((d: unknown) => void) | undefined
    api.official.onMessage.mockImplementation((cb: (d: unknown) => void) => {
      push = cb
      return () => {}
    })
    renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    act(() => {
      push?.({ projectPath: '/other', message: { type: 'ignored' } })
    })
    expect(screen.queryByText('实时事件')).not.toBeInTheDocument()

    act(() => {
      push?.({ projectPath: '/p', message: { type: 'message', data: { text: 'hi' } } })
    })
    expect(await screen.findByText('实时事件')).toBeInTheDocument()
    expect(screen.getByText('message: {"text":"hi"}')).toBeInTheDocument()
  })

  it('卸载时退订状态与消息、停掉轮询', async () => {
    const api = installApi()
    const { unmount } = renderDialog()
    await screen.findByText('适配器配置 · 测试项目')

    unmount()
    expect(api.unsubStatus).toHaveBeenCalledTimes(1)
    expect(api.unsubMessage).toHaveBeenCalledTimes(1)
  })
})
