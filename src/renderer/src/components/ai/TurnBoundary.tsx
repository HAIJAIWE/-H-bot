// src/renderer/src/components/ai/TurnBoundary.tsx
//
// 「本轮边界」一行：这一轮的权限口径 —— 工具收窄、插件限定、审批、先计划。
//
// 为什么需要它：主进程的边界由三处拼出来（页面推的角色、预设的 role/allowedTools/plugins/
// permissionMode、本轮菜单的先计划/完全权限），但界面上只有选择器会说"选了哪份预设"，
// **工具被收窄到几个、审批是不是不问了**完全没有痕迹。用户看到的是"我什么都没改"，
// 模型那边却拿着另一套权限 —— 与 §26「传了没读」同一族：主进程做了、界面没说。
//
// 2026-10-25 去掉角色那一项：角色/预设合并成一个选择器后，选择器自己就写着"现在是谁"，
// 这里再写一遍就是同一件事说两遍（用户截图原话）。
//
// 只在"这一轮跟默认不一样"时出现（默认 = 全部工具 + 不限插件 + 逐次问 + 不是先计划），
// 常态下不留噪音；非默认时把**差异**逐条列出来。
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

/** 审批口径：逐次问 / 本次完全放行 / 预设授予完全放行 */
export type TurnApproval = 'ask' | 'full' | 'full-preset'

export interface TurnBoundaryProps {
  /** 预设收窄后的工具数；null/undefined = 不限制 */
  toolCount?: number | null
  /** 预设限定的插件（运行时插件）数；null/undefined = 不限定 */
  pluginCount?: number | null
  approval: TurnApproval
  planFirst?: boolean
}

export function TurnBoundary({
  toolCount,
  pluginCount,
  approval,
  planFirst,
}: TurnBoundaryProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const scoped = toolCount != null && toolCount > 0
  const pluginsLimited = pluginCount != null && pluginCount > 0
  // 默认态什么都不说（全部工具 + 不限插件 + 逐次问 + 不是先计划）
  if (approval === 'ask' && !scoped && !pluginsLimited && !planFirst) {
    return null
  }
  const parts: string[] = []
  if (scoped) parts.push(t('ai.boundary.tools', { n: toolCount }))
  if (pluginsLimited) parts.push(t('ai.boundary.plugins', { n: pluginCount }))
  parts.push(
    approval === 'full-preset'
      ? t('ai.boundary.approvalFullPreset')
      : approval === 'full'
        ? t('ai.boundary.approvalFull')
        : t('ai.boundary.approvalAsk'),
  )
  if (planFirst) parts.push(t('ai.boundary.plan'))
  // 一段连续文字而不是 flex 块：右栏只有 180px，预设名一长，单项自己就超过一栏宽；
  // 逐项 nowrap 会撑出横向滚动条（压缩提示踩过同一个坑）。
  // 让它在项内折行、项间只用 · 分隔，窄栏下就只是多占一行。
  return (
    <div
      className="mb-2 text-[11px] leading-relaxed break-words text-zinc-500"
      role="status"
      aria-live="polite"
    >
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="px-1 text-zinc-700">·</span>}
          {p}
        </span>
      ))}
    </div>
  )
}
