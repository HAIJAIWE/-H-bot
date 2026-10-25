// src/renderer/src/components/ai/PresetImportDialog.tsx
//
// **导入会话预设**（2026-10-26，第 53 批）。
//
// 流程刻意分成两段：选文件只拿到"预览"，点确认才写盘。预设是权限边界，
// 不该因为顺手选了个文件就把项目里的预设表换掉。同名项默认不覆盖，
// 必须由用户勾选；内置预设永远不覆盖（主进程也会再拒绝一次）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Modal, ModalFooter } from '../ui/Modal'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { AI_MODE_BUTTONS } from './agentModes'
import { MODE_OF_ROLE } from '@shared/ai/roleDomains'
import type { PresetImportResult, PresetSharePick } from '@shared/ai/presetShare'

export interface PresetImportDialogProps {
  open: boolean
  projectPath: string | undefined
  onClose: () => void
  onImported: (result: PresetImportResult) => void
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function PresetImportDialog({
  open,
  projectPath,
  onClose,
  onImported,
}: PresetImportDialogProps): React.ReactNode {
  useLocaleSubscription()
  const [picking, setPicking] = useState(false)
  const [pick, setPick] = useState<PresetSharePick | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [importing, setImporting] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const choose = useCallback(async (): Promise<void> => {
    if (!projectPath) return
    setPicking(true)
    setPick(null)
    setError(null)
    setOverwrite(false)
    try {
      const res = await window.qqbat.ai.pickPresetShare(projectPath)
      if (res.ok) setPick(res.data)
      else if (res.error === '用户取消') onCloseRef.current()
      else setError(res.error)
    } catch (e) {
      setError(errText(e))
    } finally {
      setPicking(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (!open) {
      setPicking(false)
      setPick(null)
      setError(null)
      setOverwrite(false)
      setImporting(false)
      return
    }
    void choose()
  }, [open, choose])

  const conflicts = pick?.preview.conflicts ?? []
  const blockedByConflict = conflicts.length > 0 && !overwrite

  const confirm = async (): Promise<void> => {
    if (!projectPath || !pick || importing || blockedByConflict) return
    setImporting(true)
    setError(null)
    try {
      const res = await window.qqbat.ai.importPresets(
        projectPath,
        pick.text,
        overwrite,
        pick.fileName,
      )
      if (res.ok) {
        onImported(res.data)
        onCloseRef.current()
      } else {
        setError(res.error)
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setImporting(false)
    }
  }

  const roleTextOf = (role: string | undefined): string => {
    if (!role) return t('ai.preset.importPreviewRoleFollow')
    const mode = MODE_OF_ROLE[role as keyof typeof MODE_OF_ROLE]
    const key = AI_MODE_BUTTONS.find(button => button.mode === mode)?.labelKey
    return key ? t(key) : role
  }

  return (
    <Modal
      open={open}
      onClose={() => onCloseRef.current()}
      title={t('ai.preset.importTitle')}
      width="560px"
      footer={
        <ModalFooter
          onCancel={() => onCloseRef.current()}
          onConfirm={() => void confirm()}
          confirmText={t('ai.preset.importConfirm')}
          confirmDisabled={!pick || picking || importing || blockedByConflict}
          confirmTitle={
            blockedByConflict ? t('ai.preset.importOverwriteHint') : t('ai.preset.importHint')
          }
        />
      }
    >
      <div className="space-y-3 text-xs text-zinc-300">
        <p className="text-zinc-400">{t('ai.preset.importHint')}</p>

        {picking ? (
          <div className="rounded border border-zinc-700 bg-zinc-950/60 px-3 py-4 text-center text-zinc-400">
            {t('ai.preset.importPicking')}
          </div>
        ) : null}

        {error ? (
          <div className="space-y-2">
            <div className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 leading-5 text-red-300">
              {error}
            </div>
            <Button variant="secondary" size="sm" onClick={() => void choose()}>
              {t('ai.preset.importRetry')}
            </Button>
          </div>
        ) : null}

        {pick ? (
          <>
            <div className="rounded border border-zinc-700 bg-zinc-950/40 px-3 py-2 leading-5">
              <div className="flex gap-2">
                <span className="shrink-0 text-zinc-500">{t('ai.preset.importFile')}</span>
                <span className="min-w-0 break-all text-zinc-200">{pick.fileName}</span>
              </div>
              {pick.preview.exportedAt ? (
                <div className="flex gap-2">
                  <span className="shrink-0 text-zinc-500">{t('ai.preset.importExportedAt')}</span>
                  <span className="text-zinc-300">
                    {new Date(pick.preview.exportedAt).toLocaleString()}
                  </span>
                </div>
              ) : null}
              <div className="text-zinc-400">
                {t('ai.preset.importCount', { n: String(pick.preview.presets.length) })} ·{' '}
                {t('ai.preset.importExisting', { n: String(pick.preview.existingCount) })}
              </div>
            </div>

            {conflicts.length > 0 ? (
              <div className="space-y-2 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-amber-300">
                <div className="leading-5">
                  {t('ai.preset.importConflicts', {
                    n: String(conflicts.length),
                    names: conflicts.join('、'),
                  })}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-amber-200">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={e => setOverwrite(e.target.checked)}
                  />
                  <span>{t('ai.preset.importOverwrite')}</span>
                </label>
              </div>
            ) : null}

            <div className="max-h-60 space-y-1 overflow-y-auto rounded border border-zinc-700 bg-zinc-950/40 p-2">
              {pick.preview.presets.map(preset => (
                <div
                  key={preset.name}
                  className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                >
                  <div className="truncate font-medium text-zinc-200">{preset.name}</div>
                  {preset.description ? (
                    <div className="truncate text-[11px] text-zinc-500">{preset.description}</div>
                  ) : null}
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                    <span>
                      {t('ai.preset.importPreviewRole', { role: roleTextOf(preset.role) })}
                    </span>
                    <span>
                      {t('ai.preset.importPreviewApproval', {
                        mode:
                          preset.permissionMode === 'full'
                            ? t('ai.preset.importApprovalFull')
                            : t('ai.preset.importApprovalAsk'),
                      })}
                    </span>
                    <span>
                      {preset.allowedTools && preset.allowedTools.length > 0
                        ? t('ai.preset.importPreviewTools', {
                            n: String(preset.allowedTools.length),
                          })
                        : t('ai.preset.importPreviewNoTools')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {importing ? <div className="text-zinc-400">{t('ai.preset.importing')}</div> : null}
      </div>
    </Modal>
  )
}
