// tests/renderer/components/ai/ExternalWindowManager.test.tsx
//
// 第 75 批：外部窗口包管理面板。
//
// 只钉**面板与主进程之间的契约**（不是像素）：
//   · 列表照抄 `plugin:listWindows` 的回答（名字/版本/禁用状态都是主进程说的，不本地猜）；
//   · 状态按钮按当前状态给「启用/禁用」，点了就走对应通道，**成功后再扫一次盘**；
//   · 卸载是**行内两步**：第一下只把按钮换成确认/取消，第二下才真删 —— 不可撤销的
//     动作不该一步完成，也不该用 `window.confirm`（本仓渲染层零处使用）；
//   · 坏包（issues）不在列表里，单独把文件绝对路径与原因摆出来；
//   · 主进程的 error 原样显示在面板里（不吞、不 alert）。
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WindowPackageScanResult } from '@shared/plugins/windowPackage'
import { t } from '@renderer/i18n'
import { ExternalWindowManager } from '@renderer/components/ai/ExternalWindowManager'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const pkg = (
  overrides: Partial<WindowPackageScanResult['packages'][number]> = {},
): WindowPackageScanResult['packages'][number] => ({
  schemaVersion: 1,
  id: 'demo.pkg',
  name: '演示窗口',
  version: '1.2.3',
  layout: 'compact',
  dir: 'C:/userData/plugins/windows/demo.pkg',
  ...overrides,
})

interface BridgeSpies {
  listWindows: ReturnType<typeof vi.fn>
  windowPackageDisable: ReturnType<typeof vi.fn>
  windowPackageEnable: ReturnType<typeof vi.fn>
  windowPackageUninstall: ReturnType<typeof vi.fn>
}

/** 装一个假的 preload 桥，返回各通道的 spy（默认全部成功） */
function installBridge(
  scan: WindowPackageScanResult,
  opts: { actionResult?: { ok: boolean; error?: string } } = {},
): BridgeSpies {
  const spies: BridgeSpies = {
    listWindows: vi.fn(async () => ({ ok: true, data: scan })),
    windowPackageDisable: vi.fn(async () => opts.actionResult ?? { ok: true }),
    windowPackageEnable: vi.fn(async () => opts.actionResult ?? { ok: true }),
    windowPackageUninstall: vi.fn(async () => opts.actionResult ?? { ok: true }),
  }
  ;(globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = { plugin: spies }
  return spies
}

describe('ExternalWindowManager（第 75 批）', () => {
  it('列表照抄主进程的扫描结果：名字 / id / 版本 / 启用状态', async () => {
    installBridge({
      packages: [
        pkg(),
        pkg({ id: 'demo.off', name: '停掉的窗口', version: '0.9.0', disabled: true }),
      ],
      issues: [],
    })
    render(<ExternalWindowManager />)

    expect(await screen.findByText('演示窗口')).toBeInTheDocument()
    expect(screen.getByText('demo.pkg')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByText(t('externalWindowManager.enabled'))).toBeInTheDocument()
    expect(screen.getByText('停掉的窗口')).toBeInTheDocument()
    expect(screen.getByText('v0.9.0')).toBeInTheDocument()
    expect(screen.getByText(t('externalWindowManager.disabled'))).toBeInTheDocument()
  })

  it('已禁用的包给「启用」，点它走 enable 通道，并在之后重新扫盘', async () => {
    const spies = installBridge({
      packages: [pkg({ id: 'demo.off', name: '停掉的窗口', disabled: true })],
      issues: [],
    })
    render(<ExternalWindowManager />)

    const btn = await screen.findByRole('button', { name: t('externalWindowManager.enable') })
    fireEvent.click(btn)

    await waitFor(() => expect(spies.windowPackageEnable).toHaveBeenCalledWith('demo.off'))
    expect(spies.windowPackageDisable).not.toHaveBeenCalled()
    // 写完之后界面状态必须重新从主进程取，而不是本地猜测着改
    await waitFor(() => expect(spies.listWindows.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('卸载是行内两步：第一下只换按钮，第二下才真删', async () => {
    const spies = installBridge({ packages: [pkg()], issues: [] })
    render(<ExternalWindowManager />)

    fireEvent.click(
      await screen.findByRole('button', { name: t('externalWindowManager.uninstall') }),
    )
    // 第一下：按钮换成确认/取消，通道还没被调用
    expect(spies.windowPackageUninstall).not.toHaveBeenCalled()
    expect(
      screen.getByText(t('externalWindowManager.uninstallConfirm', { name: '演示窗口' })),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('actions.confirm') }))
    await waitFor(() => expect(spies.windowPackageUninstall).toHaveBeenCalledWith('demo.pkg'))
  })

  it('取消卸载不调通道', async () => {
    const spies = installBridge({ packages: [pkg()], issues: [] })
    render(<ExternalWindowManager />)

    fireEvent.click(
      await screen.findByRole('button', { name: t('externalWindowManager.uninstall') }),
    )
    fireEvent.click(screen.getByRole('button', { name: t('actions.cancel') }))

    expect(spies.windowPackageUninstall).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: t('externalWindowManager.uninstall') }),
    ).toBeInTheDocument()
  })

  it('坏包不在列表里，只把绝对路径与原因列在「问题」下', async () => {
    installBridge({
      packages: [],
      issues: [
        { file: 'C:/userData/plugins/windows/broken/manifest.json', message: 'JSON 解析失败：x' },
      ],
    })
    render(<ExternalWindowManager />)

    expect(
      await screen.findByText('C:/userData/plugins/windows/broken/manifest.json'),
    ).toBeInTheDocument()
    expect(screen.getByText(/JSON 解析失败/)).toBeInTheDocument()
    // 没有可管理的行 = 没有表格、也没有操作按钮
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(t('externalWindowManager.noPackages'))).toBeInTheDocument()
  })

  it('管理动作失败时把主进程的 error 原样显示在面板里', async () => {
    installBridge(
      { packages: [pkg()], issues: [] },
      { actionResult: { ok: false, error: '目录只读' } },
    )
    render(<ExternalWindowManager />)

    fireEvent.click(await screen.findByRole('button', { name: t('externalWindowManager.disable') }))
    expect(await screen.findByText('目录只读')).toBeInTheDocument()
  })
})
