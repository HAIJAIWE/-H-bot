// src/renderer/src/components/ai/ExternalWindowManager.tsx
//
// **已安装外部窗口包的管理面板**（第 75 批，P4b-2）。
//
// 解决的是"坏包粘在盘上"：窗口包是用户自己拷进 `<userData>/plugins/windows/` 的目录，
// 装错了之后以前只能自己去文件管理器里翻 —— 现在设置页里能看见、能禁用、能卸载。
//
// 三条设计约束（都是本仓既有纪律，不是这里新造的）：
//   · **不改动第三方代码的语义**：禁用 = 写 `.disabled` 标记、卸载 = 删目录，
//     渲染层不 eval、不 require、不"顺手修一下"包里的文件；
//   · **不用 `alert` / `window.confirm`**：本仓渲染层零处使用（原生弹窗不在主题里、
//     也没法做 i18n 的确认按钮），确认走行内两步；
//   · **列表面板自己管状态**：主进程只回答"盘上现在有什么"，不记住 UI 状态。
import { Fragment, useCallback, useEffect, useState } from 'react'
import type { WindowPackageScanResult } from '@shared/plugins/windowPackage'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

/** 一次管理的"进行中"动作：禁用/启用/卸载共用一把锁，避免连点造成状态错乱 */
type BusyAction = 'disable' | 'enable' | 'uninstall'

export function ExternalWindowManager(): React.ReactNode {
  useLocaleSubscription()
  const [packages, setPackages] = useState<WindowPackageScanResult['packages']>([])
  const [issues, setIssues] = useState<WindowPackageScanResult['issues']>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<{ id: string; action: BusyAction } | null>(null)
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null)
  const [error, setError] = useState('')

  /** 重新扫盘：所有写操作之后都走这里，界面状态永远来自主进程的真话 */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.qqbat.plugin.listWindows()
      if (res.ok && res.data) {
        setPackages(res.data.packages)
        setIssues(res.data.issues)
        setError('')
      } else {
        setPackages([])
        setIssues([])
        setError(res.ok ? t('externalWindowManager.noPackages') : String(res.error ?? ''))
      }
    } catch (e) {
      setPackages([])
      setIssues([])
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * 跑一个管理动作。失败时把主进程的 error 原样显示在面板里 ——
   * 这一步失败的原因通常很具体（包已经不在盘上、目录只读），吞掉就没法排查。
   *
   * 顺序有讲究：**先扫盘、后落错误**。`refresh()` 成功时会把 `error` 清空（一次
   * 正常的重扫应该把上次的旧错误带走），所以动作的错误必须在它之后写 ——
   * 否则"禁用失败了"会被紧随其后的"扫盘成功"当场抹掉，界面上什么都不剩。
   */
  const runAction = async (id: string, action: BusyAction) => {
    setBusy({ id, action })
    setError('')
    let actionError = ''
    try {
      const api = window.qqbat.plugin
      const res =
        action === 'disable'
          ? await api.windowPackageDisable(id)
          : action === 'enable'
            ? await api.windowPackageEnable(id)
            : await api.windowPackageUninstall(id)
      if (!res.ok) actionError = String(res.error ?? '')
    } catch (e) {
      actionError = String(e)
    }
    setBusy(null)
    setConfirmUninstallId(null)
    await refresh()
    if (actionError) setError(actionError)
  }

  const busyFor = (id: string): string =>
    busy && busy.id === id ? t('externalWindowManager.working') : ''

  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400">{t('externalWindowManager.label')}</span>
        <button
          type="button"
          className="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {t('externalWindowManager.refresh')}
        </button>
      </div>

      {error !== '' && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {loading && packages.length === 0 && (
        <p className="mt-1 text-xs text-zinc-500">{t('externalWindow.loading')}</p>
      )}
      {!loading && packages.length === 0 && (
        <p className="mt-1 text-xs text-zinc-500">{t('externalWindowManager.noPackages')}</p>
      )}

      {packages.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-700 text-left text-zinc-500">
              <th className="py-1 font-normal">{t('externalWindowManager.name')}</th>
              <th className="py-1 font-normal">{t('externalWindowManager.version')}</th>
              <th className="py-1 font-normal">{t('externalWindowManager.status')}</th>
              <th className="py-1 font-normal">{t('externalWindowManager.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {packages.map(pkg => {
              const rowBusy = busy?.id === pkg.id
              const confirming = !rowBusy && confirmUninstallId === pkg.id
              return (
                /**
                 * 卸载不可撤销，所以是**行内两步**而不是浏览器 confirm：先点"卸载"把按钮
                 * 换成"确认/取消"，第二次点击才真删。
                 *
                 * 确认条**另起一行**（colSpan 撑满）而不是塞在「操作」格里：一行同时装
                 * 名字+版本+状态+一整句「确定要卸载「xxx」吗？此操作不可撤销。」的话，
                 * 表格会自动挤压列宽，把状态挤成两行、版本号挤断 —— 真机上量到过这个
                 * 塌行（`_recovery/ui-batch75-uninstall-confirm.png` 的第一版）。
                 */
                <Fragment key={pkg.id}>
                  <tr className="border-b border-zinc-800 align-top">
                    <td className="py-1 text-zinc-200">
                      {pkg.name}
                      <span className="ml-1 text-zinc-600">{pkg.id}</span>
                    </td>
                    <td className="py-1 whitespace-nowrap text-zinc-500">v{pkg.version}</td>
                    <td className="py-1 whitespace-nowrap">
                      {pkg.disabled ? (
                        <span className="text-amber-400">
                          {t('externalWindowManager.disabled')}
                        </span>
                      ) : (
                        <span className="text-green-400">{t('externalWindowManager.enabled')}</span>
                      )}
                    </td>
                    <td className="py-1 whitespace-nowrap">
                      {rowBusy && <span className="mr-1 text-zinc-500">{busyFor(pkg.id)}</span>}
                      {!rowBusy && !confirming && (
                        <>
                          <button
                            type="button"
                            className="mr-1 rounded border border-zinc-600 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800"
                            onClick={() =>
                              void runAction(pkg.id, pkg.disabled ? 'enable' : 'disable')
                            }
                          >
                            {pkg.disabled
                              ? t('externalWindowManager.enable')
                              : t('externalWindowManager.disable')}
                          </button>
                          <button
                            type="button"
                            className="rounded border border-red-700 px-1.5 py-0.5 text-red-400 hover:bg-red-900/30"
                            onClick={() => setConfirmUninstallId(pkg.id)}
                          >
                            {t('externalWindowManager.uninstall')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {confirming && (
                    <tr className="border-b border-zinc-800">
                      <td colSpan={4} className="py-1.5 text-amber-400">
                        <span className="mr-2">
                          {t('externalWindowManager.uninstallConfirm', { name: pkg.name })}
                        </span>
                        <button
                          type="button"
                          className="mr-1 rounded border border-red-600 px-1.5 py-0.5 text-red-400 hover:bg-red-900/40"
                          onClick={() => void runAction(pkg.id, 'uninstall')}
                        >
                          {t('actions.confirm')}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-600 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800"
                          onClick={() => setConfirmUninstallId(null)}
                        >
                          {t('actions.cancel')}
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      {/**
       * 坏包的原文（清单解析失败 / 字段不合法 / id 重复的那几个）。
       *
       * 它们**不在上面的列表里**：扫盘给它们的身份是一行问题，不是一个能管理的包
       * （没有 id、也不知道声明是否合法，拿什么去禁用？）。所以这里只能把
       * 「哪个文件、错在哪」原样摆出来 —— 用户按绝对路径改清单或删目录。
       * 这一栏放在表格**下面**而不是当成"问题数列"，是因为坏包与列表里的包是
       * 两组互不重叠的集合：一个包要么进了列表（没问题），要么在这里。
       */}
      {issues.length > 0 && (
        <>
          <p className="mt-2 text-xs text-zinc-500">{t('externalWindowManager.issues')}</p>
          <ul className="mt-0.5 space-y-0.5">
            {issues.map(issue => (
              <li key={issue.file + issue.message} className="text-xs text-amber-400/80">
                <span className="text-zinc-500">{issue.file}</span> — {issue.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
