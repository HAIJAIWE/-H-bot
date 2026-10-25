// tests/renderer/components/ai/PresetUndoDialog.test.tsx
//
// 第 54 批：撤销上次导入的确认框。
// 钉住：对话框把撤销点（时间/来源/计数/恢复目标）说清楚；确认才调
// undoPresetImport；撤销被拒时红字留在框内且可重试，不静默关掉假装成功。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PresetUndoDialog } from '@renderer/components/ai/PresetUndoDialog'
import { t } from '@renderer/i18n'
import type { PresetUndoResult, PresetUndoState } from '@shared/ai/presetUndo'

let undoPresetImport: ReturnType<typeof vi.fn>
let onClose: Mock<() => void>
let onUndone: Mock<(result: PresetUndoResult) => void>

const CREATED_AT = '2026-10-26T02:30:00.000Z'

const UNDO: PresetUndoState = {
  available: true,
  createdAt: CREATED_AT,
  sourceName: 'share.json',
  added: 2,
  replaced: 1,
  total: 6,
  previousExisted: true,
}

const RESULT: PresetUndoResult = {
  restored: true,
  removed: false,
  createdAt: CREATED_AT,
  added: 2,
  replaced: 1,
  total: 6,
}

beforeEach(() => {
  undoPresetImport = vi.fn().mockResolvedValue({ ok: true, data: RESULT })
  onClose = vi.fn<() => void>()
  onUndone = vi.fn<(result: PresetUndoResult) => void>()
  window.qqbat = { ai: { undoPresetImport } } as never
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as never as { qqbat?: unknown }).qqbat
})

function setup(undo: PresetUndoState = UNDO): void {
  render(
    <PresetUndoDialog
      open
      projectPath="/p"
      undo={undo}
      onClose={() => onClose()}
      onUndone={result => onUndone(result)}
    />,
  )
}

describe('撤销上次导入', () => {
  it('把撤销点说清楚：导入时间、来源文件、这次导入的计数、恢复到导入前', () => {
    setup()
    expect(screen.getByText(t('ai.preset.undoDialogTitle'))).toBeInTheDocument()
    expect(screen.getByText(new Date(CREATED_AT).toLocaleString())).toBeInTheDocument()
    expect(screen.getByText('share.json')).toBeInTheDocument()
    expect(
      screen.getByText(t('ai.preset.undoCounts', { added: '2', replaced: '1', total: '6' })),
    ).toBeInTheDocument()
    expect(screen.getByText(t('ai.preset.undoRestoreFile'))).toBeInTheDocument()
    expect(screen.getByText(t('ai.preset.undoHint'))).toBeInTheDocument()
  })

  it('★ 确认才调 undoPresetImport，成功后把结果交给调用方', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: t('ai.preset.undoConfirm') }))
    await waitFor(() => expect(undoPresetImport).toHaveBeenCalledWith('/p'))
    await waitFor(() => expect(onUndone).toHaveBeenCalledWith(RESULT))
  })

  it('撤销被拒（导入后手改过预设）→ 红字留在框内，可重试', async () => {
    const reason = '导入之后预设文件又被改过（sha256 不一致），这次撤销没有动文件'
    undoPresetImport
      .mockResolvedValueOnce({ ok: false, error: reason })
      .mockResolvedValueOnce({ ok: true, data: RESULT })
    setup()
    fireEvent.click(screen.getByRole('button', { name: t('ai.preset.undoConfirm') }))
    expect(await screen.findByText(reason)).toBeInTheDocument()
    expect(onUndone).not.toHaveBeenCalled()
    const retry = screen.getByRole('button', { name: t('ai.preset.undoConfirm') })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => expect(undoPresetImport).toHaveBeenCalledTimes(2))
  })

  it('导入前没有预设文件：恢复目标说明是删掉这次写出的那份，来源显示未记录', () => {
    setup({ ...UNDO, previousExisted: false, sourceName: undefined })
    expect(screen.getByText(t('ai.preset.undoRestoreRemove'))).toBeInTheDocument()
    expect(screen.getByText(t('ai.preset.undoSourceUnknown'))).toBeInTheDocument()
  })
})
