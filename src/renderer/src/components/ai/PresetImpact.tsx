// src/renderer/src/components/ai/PresetImpact.tsx
//
// **这条预设会放开什么** —— 把主进程真正执行的边界翻译成人话。
//
// 为什么要有：预设三个字段单独看都无害，组合起来没人能一眼算出来 ——
//   · 勾了工具白名单，以为连"写什么"也收窄了（其实只管工具，路径边界在角色上）；
//   · 选"完全放行"，以为能越过角色（其实只跳过问人，角色闸在它之前）。
// 所以这里只做翻译，不做判断：能写什么**直接问 mayRoleWritePath**（与主进程闸门同一个函数），
// 不另写一份规则 —— 两份规则一定会漂。
import { useLocaleSubscription } from '../../stores/i18nStore'
import { t } from '../../i18n'
import { mayRoleWritePath, type AgentRole } from '@shared/ai/roleDomains'
import type { AiToolDefinition } from '@shared/types/ai'

/** 两个样本路径：流程文件落在"界面"域，源码落在"代码"域 —— 拿真闸门回答，别猜 */
const SAMPLE_UI = '.qqbat/flow.json'
const SAMPLE_CODE = 'src/main/services/agent-core/runTurn.ts'

export interface PresetImpactProps {
  /** 固定角色；null = 跟着页签走 */
  role: AgentRole | null
  /** 工具白名单（空 = 不限制） */
  allowedTools: readonly string[]
  /** 工具注册表（用于统计与认不认识的判断；空表时只说"白名单 N 个"） */
  tools: readonly Pick<AiToolDefinition, 'name' | 'category'>[]
  permissionMode: 'ask' | 'full'
  plugins: readonly string[]
}

export function PresetImpact({
  role,
  allowedTools,
  tools,
  permissionMode,
  plugins,
}: PresetImpactProps): React.ReactNode {
  useLocaleSubscription()
  const ui = role ? mayRoleWritePath(role, SAMPLE_UI) : null
  const code = role ? mayRoleWritePath(role, SAMPLE_CODE) : null

  const scoped = allowedTools.length > 0
  const catalog = new Map(tools.map(tool => [tool.name, tool.category]))
  const unknown = allowedTools.filter(name => !catalog.has(name))
  const picked = scoped ? allowedTools.filter(name => catalog.has(name)) : [...catalog.keys()]
  const query = picked.filter(name => catalog.get(name) === 'query').length
  const mutation = picked.length - query

  const rowClass = 'flex items-baseline gap-2 text-[11px] leading-relaxed'
  const labelClass = 'w-10 shrink-0 text-zinc-500'
  const valueClass = 'min-w-0 break-words text-zinc-300'

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span>{t('ai.preset.impact.title')}</span>
        {permissionMode === 'full' && (
          <span className="shrink-0 text-amber-300/80">{t('ai.preset.impact.fullBadge')}</span>
        )}
      </div>
      <div className={rowClass}>
        <span className={labelClass}>{t('ai.preset.impact.write')}</span>
        <span className={valueClass}>
          {ui === null || code === null
            ? t('ai.preset.impact.writeFollow')
            : [
                `${t('ai.preset.impact.domainUi')}：${t(ui ? 'ai.preset.impact.yes' : 'ai.preset.impact.no')}`,
                `${t('ai.preset.impact.domainCode')}：${t(code ? 'ai.preset.impact.yes' : 'ai.preset.impact.no')}`,
              ].join(' · ')}
        </span>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>{t('ai.preset.impact.tools')}</span>
        <span className={valueClass}>
          <span>
            {scoped
              ? t('ai.preset.impact.toolsScoped', { n: allowedTools.length })
              : t('ai.preset.impact.toolsAll', { n: tools.length })}
          </span>
          {picked.length > 0 && (
            <span className="text-zinc-500">
              {' · '}
              {t('ai.preset.impact.toolsBreakdown', { mutation, query })}
            </span>
          )}
          {unknown.length > 0 && (
            <span className="text-amber-300/80">
              {' · '}
              {t('ai.preset.impact.toolsUnknown', { n: unknown.length, list: unknown.join(', ') })}
            </span>
          )}
        </span>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>{t('ai.preset.impact.approval')}</span>
        <span className={valueClass}>
          {permissionMode === 'full'
            ? t('ai.preset.impact.approvalFull')
            : t('ai.preset.impact.approvalAsk')}
        </span>
      </div>
      {plugins.length > 0 && (
        <div className={rowClass}>
          <span className={labelClass}>{t('ai.preset.impact.plugins')}</span>
          <span className={valueClass}>
            {t('ai.preset.impact.pluginsValue', { list: plugins.join(', ') })}
          </span>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-relaxed break-words text-zinc-500">
        {t('ai.preset.impact.note')}
      </p>
    </div>
  )
}
