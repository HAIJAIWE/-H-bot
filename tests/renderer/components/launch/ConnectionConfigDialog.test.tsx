// tests/renderer/components/launch/ConnectionConfigDialog.test.tsx
//
// 连接设置（官方 API）：10/18 起只剩翻译器端口一个可编辑项 ——
// 官方 API 走翻译器（本机网关）接入，NapCat 主机/端口/Token 那组表单已随 NapCat 适配器退役。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ConnectionConfigDialog } from '@renderer/components/launch/ConnectionConfigDialog'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(over: Partial<Parameters<typeof ConnectionConfigDialog>[0]> = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  render(
    <ConnectionConfigDialog
      open
      onClose={onClose}
      onSave={onSave}
      adapter="official"
      translatorPort={1001}
      {...over}
    />,
  )
  return { onClose, onSave }
}

describe('ConnectionConfigDialog - 官方 API 连接设置', () => {
  it('open=false 时不显示', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('连接设置（官方 API）')).not.toBeInTheDocument()
  })

  it('显示标题与翻译器端口（带当前值）', () => {
    renderDialog()
    expect(screen.getByText('连接设置（官方 API）')).toBeInTheDocument()
    expect((screen.getByLabelText('翻译器端口') as HTMLInputElement).value).toBe('1001')
  })

  it('端口下方说明讲清用途与重启要求', () => {
    renderDialog()
    expect(screen.getByText(/角色：官方翻译器/)).toBeInTheDocument()
    expect(screen.getByText(/修改后需重启机器人/)).toBeInTheDocument()
  })

  it('改端口后保存传回新值并关闭', () => {
    const { onSave, onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('翻译器端口'), { target: { value: '1002' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith({ translatorPort: 1002 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('非数字输入按 0 处理（不把 NaN 传下去）', () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByLabelText('翻译器端口'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ translatorPort: 0 })
  })

  it('取消不保存', () => {
    const { onSave, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
