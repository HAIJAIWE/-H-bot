// src/renderer/src/components/settings/PluginMarket.tsx
//
// 插件市场：官方离线源 + 用户添加的来源 → 安装/更新/卸载 AI 插件。
// 安装动作在**主进程**完成（写 userData/market、校验哈希、装进沙箱），
// 这里只负责展示与发起调用；不信任任何来自索引的字段做本地决策。
import { useCallback, useEffect, useState } from 'react'
import type { MarketInstallPlan, MarketItem, MarketListResult } from '@shared/plugins/market'
import { Button } from '../ui/Button'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

interface Props {
  open: boolean
}

const EMPTY: MarketListResult = { plugins: [], sources: [] }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export function PluginMarket({ open }: Props) {
  useLocaleSubscription()
  const [data, setData] = useState<MarketListResult>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [draftSource, setDraftSource] = useState('')
  const [confirmId, setConfirmId] = useState('')
  const [plan, setPlan] = useState<MarketInstallPlan | null>(null)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const res = await window.qqbat.plugin.marketList()
      if (res.ok && res.data) setData(res.data)
      else setError(res.error || t('settings.plugins.market.loadFailed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.market.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const addSource = async (): Promise<void> => {
    const source = draftSource.trim()
    if (!source) return
    setAdding(true)
    setError('')
    setNotice('')
    try {
      const res = await window.qqbat.plugin.marketAddSource(source)
      if (!res.ok) {
        setError(res.error || t('settings.plugins.market.opFailed'))
        return
      }
      setDraftSource('')
      await refresh()
    } finally {
      setAdding(false)
    }
  }

  const removeSource = async (source: string): Promise<void> => {
    setError('')
    const res = await window.qqbat.plugin.marketRemoveSource(source)
    if (!res.ok) {
      setError(res.error || t('settings.plugins.market.opFailed'))
      return
    }
    await refresh()
  }

  /** 第一步：只读检查，把版本/来源/文件/摘要摊给用户看 */
  const inspect = async (item: MarketItem): Promise<void> => {
    setBusyId(item.id)
    setError('')
    setNotice('')
    setPlan(null)
    try {
      const res = await window.qqbat.plugin.marketInspect(item.id)
      if (!res.ok || !res.data) {
        setError(res.error || t('settings.plugins.market.inspectFailed'))
        return
      }
      setPlan(res.data)
    } finally {
      setBusyId('')
    }
  }

  /** 第二步：带着用户确认时看到的摘要去装；索引变了主进程会拒绝 */
  const install = async (item: MarketItem): Promise<void> => {
    if (!plan || plan.id !== item.id) return
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const res = await window.qqbat.plugin.marketInstall(item.id, plan.digest)
      if (!res.ok) {
        setError(res.error || t('settings.plugins.market.opFailed'))
        return
      }
      setPlan(null)
      setNotice(
        t('settings.plugins.market.installedMsg', {
          name: res.data?.name ?? item.name,
          version: res.data?.version ?? '',
        }),
      )
      await refresh()
    } finally {
      setBusyId('')
    }
  }

  const uninstall = async (item: MarketItem): Promise<void> => {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const res = await window.qqbat.plugin.marketUninstall(item.id)
      if (!res.ok) {
        setError(res.error || t('settings.plugins.market.opFailed'))
        return
      }
      setNotice(t('settings.plugins.market.uninstalledMsg', { name: item.name }))
      setConfirmId('')
      await refresh()
    } finally {
      setBusyId('')
    }
  }

  const official = (source: string): boolean => source === 'bundled://official'
  const sourceLabel = (source: string): string =>
    official(source) ? t('settings.plugins.market.official') : source
  const permissionLabel = (permission: string): string =>
    permission === 'tool'
      ? t('settings.plugins.market.permTool')
      : permission === 'prompt'
        ? t('settings.plugins.market.permPrompt')
        : permission

  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-xs text-zinc-400">{t('settings.plugins.market.title')}</p>
        <span className="text-[10px] text-zinc-600">{t('settings.plugins.market.subtitle')}</span>
      </div>

      {/* 来源 */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <span className="text-[10px] text-zinc-600">
          {t('settings.plugins.market.sourcesTitle')}
        </span>
        {data.sources.map(s => (
          <span
            key={s.source}
            className={
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ' +
              (s.error ? 'border-red-800/50 text-red-400' : 'border-zinc-700/60 text-zinc-400')
            }
            title={
              s.error ? t('settings.plugins.market.sourceError', { error: s.error }) : s.source
            }
          >
            <span className="max-w-[220px] truncate">{sourceLabel(s.source)}</span>
            {!official(s.source) && (
              <button
                type="button"
                aria-label={t('settings.plugins.market.removeSourceAria', { source: s.source })}
                className="text-zinc-500 hover:text-red-400"
                onClick={() => void removeSource(s.source)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-1 mb-2">
        <input
          value={draftSource}
          onChange={e => setDraftSource(e.target.value)}
          placeholder={t('settings.plugins.market.addSourcePlaceholder')}
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none"
          onKeyDown={e => {
            if (e.key === 'Enter') void addSource()
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={adding || !draftSource.trim()}
          onClick={() => void addSource()}
        >
          {adding ? t('settings.plugins.market.working') : t('settings.plugins.market.addSource')}
        </Button>
      </div>

      {error && (
        <div className="mb-2 px-2 py-1 rounded bg-red-900/20 border border-red-800/40 text-xs text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-2 px-2 py-1 rounded bg-green-900/20 border border-green-800/40 text-xs text-green-400">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="py-4 text-center text-xs text-zinc-500">
          {t('settings.plugins.market.loading')}
        </div>
      ) : data.plugins.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-500">
          {t('settings.plugins.market.empty')}
        </div>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-auto pr-1">
          {data.plugins.map(item => {
            const installed = item.installed
            const canUpdate =
              !!installed &&
              !installed.missing &&
              !!item.latestVersion &&
              installed.version !== item.latestVersion
            const thirdParty = !official(item.source)
            return (
              <li key={item.id} className="rounded border border-zinc-700/60 px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-200">{item.title ?? item.name}</span>
                  <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">
                    v{item.latestVersion ?? '-'}
                  </span>
                  {thirdParty && (
                    <span
                      className="rounded bg-amber-900/30 px-1 text-[10px] text-amber-300"
                      title={t('settings.plugins.market.thirdPartyHint')}
                    >
                      {t('settings.plugins.market.thirdParty')}
                    </span>
                  )}
                  {installed && (
                    <span className="text-[10px] text-zinc-500">
                      {installed.missing
                        ? t('settings.plugins.market.missing')
                        : installed.modified
                          ? t('settings.plugins.market.modified')
                          : t('settings.plugins.market.installedLabel', {
                              version: installed.version,
                            })}
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 gap-1">
                    {confirmId === item.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId === item.id}
                          onClick={() => void uninstall(item)}
                        >
                          {t('settings.plugins.market.uninstallConfirm')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmId('')}>
                          {t('editor.action.cancel')}
                        </Button>
                      </>
                    ) : (
                      <>
                        {canUpdate && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busyId === item.id}
                            onClick={() => void inspect(item)}
                          >
                            {busyId === item.id
                              ? t('settings.plugins.market.working')
                              : t('settings.plugins.market.update')}
                          </Button>
                        )}
                        {!installed && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busyId === item.id || !item.latestVersion}
                            onClick={() => void inspect(item)}
                          >
                            {busyId === item.id
                              ? t('settings.plugins.market.working')
                              : t('settings.plugins.market.install')}
                          </Button>
                        )}
                        {installed && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setConfirmId(item.id)}
                          >
                            {t('settings.plugins.market.uninstall')}
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {item.description}
                  {item.requires && (
                    <span className="ml-1 text-zinc-600">
                      {t('settings.plugins.market.requires', { range: item.requires })}
                    </span>
                  )}
                </p>

                {plan?.id === item.id && (
                  <div className="mt-1.5 space-y-1 rounded border border-zinc-700 bg-zinc-950/60 p-2 text-[11px] text-zinc-400">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-zinc-200">
                        {t('settings.plugins.market.inspectTitle')}
                      </span>
                      <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">
                        {plan.version
                          ? 'v' + plan.version
                          : t('settings.plugins.market.noCompatible')}
                      </span>
                      <span
                        className={
                          'rounded px-1 text-[10px] ' +
                          (plan.trust === 'official'
                            ? 'bg-blue-900/30 text-blue-300'
                            : 'bg-amber-900/30 text-amber-300')
                        }
                      >
                        {plan.trust === 'official'
                          ? t('settings.plugins.market.official')
                          : t('settings.plugins.market.community')}
                      </span>
                      {plan.update && (
                        <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">
                          {t('settings.plugins.market.updateLine', {
                            from: plan.update.fromVersion,
                            to: plan.version ?? '?',
                          })}
                        </span>
                      )}
                    </div>
                    <p className="break-all">
                      {t('settings.plugins.market.sourceLine', { source: plan.source })}
                    </p>
                    {plan.author && (
                      <p>{t('settings.plugins.market.authorLine', { author: plan.author })}</p>
                    )}
                    <p>
                      {t('settings.plugins.market.filesLine', {
                        count: plan.files.length,
                        size: formatBytes(plan.totalBytes),
                      })}
                    </p>
                    {plan.manifest && (
                      <p>
                        {t('settings.plugins.market.permissionsLine', {
                          list:
                            plan.manifest.permissions.length > 0
                              ? plan.manifest.permissions.map(permissionLabel).join('、')
                              : t('settings.plugins.market.permNone'),
                        })}
                        {' · '}
                        {t('settings.plugins.market.settingsLine', {
                          count: plan.manifest.settingCount,
                        })}
                      </p>
                    )}
                    <p className="break-all font-mono text-[10px] text-zinc-500">
                      {t('settings.plugins.market.digestLine', { digest: plan.digest })}
                    </p>
                    {plan.update && !plan.update.sameSource && (
                      <p className="break-all text-amber-400">
                        {t('settings.plugins.market.sourceChanged', {
                          from: plan.update.fromSource,
                          to: plan.source,
                        })}
                      </p>
                    )}
                    <p className={plan.blocked ? 'text-red-400' : 'text-amber-400/80'}>
                      {plan.blocked
                        ? t('settings.plugins.market.blockedLine', { reason: plan.blocked })
                        : t('settings.plugins.market.unsigned')}
                    </p>
                    <div className="flex gap-1 pt-0.5">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!!plan.blocked || busyId === item.id}
                        onClick={() => void install(item)}
                      >
                        {busyId === item.id
                          ? t('settings.plugins.market.working')
                          : t('settings.plugins.market.confirmInstall')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPlan(null)}>
                        {t('editor.action.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
