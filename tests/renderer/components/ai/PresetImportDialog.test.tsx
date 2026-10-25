// tests/renderer/components/ai/PresetImportDialog.test.tsx
//
// 第 53 批：导入会话预设的两段式界面。
// 钉住：选文件只出预览；有同名项时必须先勾覆盖；确认才调用 importPresets；
// 用户取消不报错。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PresetImportDialog } from '@renderer/components/ai/PresetImportDialog'
import { t } from '@renderer/i18n'
import type { PresetSharePick } from '@shared/ai/presetShare'

let pickPresetShare: ReturnType<typeof vi.fn>
let importPresets: ReturnType<typeof vi.fn>
let onClose: Mock<() => void>
let onImported: Mock<(result: unknown) => void>

const PICK: PresetSharePick = {
  filePath: '/in/share.json',
  fileName: 'share.json',
  text: '{"type":"qqbat-agent-presets","version":1,"presets":[{"name":"甲"}]}',
  preview: {
    exportedAt: '2026-10-26T00:00:00.000Z',
    presets: [
      { name: '甲', role: 'coder', permissionMode: 'full', allowedTools: ['read_file'] },
      { name: '乙' },
    ],
    conflicts: ['甲'],
    existingCount: 2,
  },
}

beforeEach(() => {
  pickPresetShare = vi.fn().mockResolvedValue({ ok: true, data: PICK })
  importPresets = vi.fn().mockResolvedValue({ ok: true, data: { added: 1, replaced: 1, total: 3 } })
  onClose = vi.fn<() => void>()
  onImported = vi.fn<(result: unknown) => void>()
  window.qqbat = { ai: { pickPresetShare, importPresets } } as never
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as never as { qqbat?: unknown }).qqbat
})

function setup() {
  render(
    <PresetImportDialog
      open
      projectPath="/p"
      onClose={() => onClose()}
      onImported={result => onImported(result)}
    />,
  )
}

describe('导入会话预设', () => {
  it('打开即选文件：显示文件名/条数/现有条数/同名冲突，确认被禁用', async () => {
    setup()
    expect(pickPresetShare).toHaveBeenCalledWith('/p')
    expect(await screen.findByText('share.json')).toBeInTheDocument()
    expect(screen.getByText(/2 条预设/)).toBeInTheDocument()
    expect(screen.getByText(/项目现有 2 条自定义预设/)).toBeInTheDocument()
    expect(
      screen.getByText(t('ai.preset.importConflicts', { n: '1', names: '甲' })),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('ai.preset.importConfirm') })).toBeDisabled()
    expect(screen.getByText('甲')).toBeInTheDocument()
    expect(screen.getByText(/审批：完全放行/)).toBeInTheDocument()
  })

  it('★ 勾覆盖 → 确认才调 importPresets，成功后回调结果并关闭', async () => {
    setup()
    fireEvent.click(await screen.findByRole('checkbox'))
    const confirm = screen.getByRole('button', { name: t('ai.preset.importConfirm') })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(importPresets).toHaveBeenCalledWith('/p', PICK.text, true, PICK.fileName)
    })
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({ added: 1, replaced: 1, total: 3 })
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('用户取消选择 → 直接关，不显示错误', async () => {
    pickPresetShare.mockResolvedValue({ ok: false, error: '用户取消' })
    setup()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByText('用户取消')).not.toBeInTheDocument()
  })

  it('选文件出错 → 显示原因，可重新选择', async () => {
    pickPresetShare
      .mockResolvedValueOnce({ ok: false, error: '分享文件版本不认识：2' })
      .mockResolvedValueOnce({ ok: true, data: PICK })
    setup()
    expect(await screen.findByText(/分享文件版本不认识/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('ai.preset.importRetry') }))
    await waitFor(() => expect(pickPresetShare).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('share.json')).toBeInTheDocument()
  })

  it('没有冲突时确认直接可用，overwrite 传 false', async () => {
    pickPresetShare.mockResolvedValue({
      ok: true,
      data: { ...PICK, preview: { ...PICK.preview, conflicts: [] } },
    })
    setup()
    await screen.findByText('share.json')
    const confirm = screen.getByRole('button', { name: t('ai.preset.importConfirm') })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(importPresets).toHaveBeenCalledWith('/p', PICK.text, false, PICK.fileName),
    )
  })
})
