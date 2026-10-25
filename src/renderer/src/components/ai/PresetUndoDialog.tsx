// src/renderer/src/components/ai/PresetUndoDialog.tsx
//
// **撤销上次导入**（2026-10-26，第 54 批）。
//
// 每次有变化的导入都会在主进程留一个撤销点（导入前的原始字节 + 导入完成时的
// sha256）；这里只负责把它说清楚再让用户按确认。撤销动的是磁盘上的整张预设表，
// 不是这一轮的权限组合，所以单独一个对话框。
//
// 失败（导入后手改过预设、文件已被删改…）必须留在框内显示原因：关掉只会让用户
// 以为撤销成功了。成功才由调用方关闭并刷新菜单。
import { useEffect, useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import type { PresetUndoResult, PresetUndoState } from '@shared/ai/presetUndo'

export interface PresetUndoDialogProps {
  open: boolean
  projectPath: string | undefined
  undo: PresetUndoState | null
  onClose: () => void
  onUndone: (result: PresetUndoResult) => void
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function PresetUndoDialog({
  open,
  projectPath,
  undo,
  onClose,
  onUndone,
}: PresetUndoDialogProps): React.ReactNode {
  useLocaleSubscription()
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 关掉即复位：上次失败的红字不该在下次打开时还挂着 */
  useEffect(() => {
    if (!open) {
      setUndoing(false)
      setError(null)
    }
  }, [open])

  const confirm = async (): Promise<void> => {
    if (!projectPath || !undo?.available || undoing) return
    setUndoing(true)
    setError(null)
    try {
      const res = await window.qqbat.ai.undoPresetImport(projectPath)
      if (res.ok) onUndone(res.data)
      else setError(res.error)
    } catch (e) {
      setError(errText(e))
    } finally {
      setUndoing(false)
    }
  }

  return (
    <Modal
      open={open && undo !== null}
      onClose={onClose}
      title={t('ai.preset.undoDialogTitle')}
      width="520px"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={() => void confirm()}
          confirmText={undoing ? t('ai.preset.undoing') : t('ai.preset.undoConfirm')}
          confirmDisabled={undoing || !undo?.available}
          confirmVariant="danger"
        />
      }
    >
      {undo ? (
        <div className="space-y-3 text-xs text-zinc-300">
          <div className="space-y-1.5 rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2">
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-zinc-500">{t('ai.preset.undoTime')}</span>
              <span className="min-w-0 flex-1 text-zinc-200">
                {undo.createdAt ? new Date(undo.createdAt).toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-zinc-500">{t('ai.preset.undoSource')}</span>
              <span className="min-w-0 flex-1 break-all text-zinc-200">
                {undo.sourceName ?? t('ai.preset.undoSourceUnknown')}
              </span>
            </div>
            <div className="text-zinc-200">
              {t('ai.preset.undoCounts', {
                added: String(undo.added ?? 0),
                replaced: String(undo.replaced ?? 0),
                total: String(undo.total ?? 0),
              })}
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 text-zinc-500">{t('ai.preset.undoRestoreTo')}</span>
              <span className="min-w-0 flex-1 text-zinc-200">
                {undo.previousExisted
                  ? t('ai.preset.undoRestoreFile')
                  : t('ai.preset.undoRestoreRemove')}
              </span>
            </div>
          </div>
          <div className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 leading-5 text-amber-300">
            {t('ai.preset.undoHint')}
          </div>
          {error ? (
            <div className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 leading-5 text-red-300">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
