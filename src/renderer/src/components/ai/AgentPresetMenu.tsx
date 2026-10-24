// src/renderer/src/components/ai/AgentPresetMenu.tsx
//
// **一个选择器，而不是两个**（2026-10-25）。原来是「角色：🧩流程助手 📝代码助手 …
// 跟页面」一排按钮 + 下拉里再列自定义预设 —— 同一件事在两处选，界面上还多一条
// 带下划线的「跟页面」。DSH 的做法（packages/client/ui-agent-preset）是一个菜单：
// 内置与自定义分组、当前项高亮、编辑走另一个入口。这里就按那个形状重写。
//
// 三种取值落到同一件事上（主进程只认「角色 + 预设名」这两样）：
//   · 跟随页面  → 角色不覆盖（按当前页签推） + 不带预设；
//   · 内置角色  → 覆盖角色 + 不带预设；
//   · 我的预设  → 带预设名；角色由预设的 role 决定（没写就跟页面走）。
// 组件自己不做权限判断，也不解析预设内容之外的东西 —— 预设仍在主进程重新读一遍。
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { MODE_OF_ROLE, type AgentMode, type AgentRole } from '@shared/ai/roleDomains'
import { AI_MODE_BUTTONS } from './agentModes'
import {
  PRESETS_FILE,
  parsePresetOptions,
  type PresetMeta,
  type PresetOption,
} from './presetOptions'

export interface AgentPresetMenuProps {
  /** 当前项目路径；没有项目时「我的预设」分组只留编辑入口的禁用态 */
  projectPath: string | undefined
  /** 手动覆盖的角色；null = 跟随页面（用于高亮） */
  override: AgentMode | null
  /** 选中的自定义预设名；null = 没用预设 */
  preset: string | null
  /** 选中预设解析出的元信息（边界行/提示用；主进程仍自己解析，不依赖这里） */
  onResolve?: (meta: PresetMeta | null) => void
  /** 变更计数：编辑保存后 +1，触发重新读盘（文件是唯一真源，不缓存目录） */
  reloadKey?: number
  disabled?: boolean
  onPickPage: () => void
  onPickRole: (mode: AgentMode) => void
  onPickPreset: (name: string) => void
  onEditPresets: () => void
}

/** 收掉 details 菜单（点完一项就关，不靠点第二次） */
function closeMenu(el: HTMLElement): void {
  el.closest('details')?.removeAttribute('open')
}

export function AgentPresetMenu({
  projectPath,
  override,
  preset,
  onResolve,
  reloadKey,
  disabled,
  onPickPage,
  onPickRole,
  onPickPreset,
  onEditPresets,
}: AgentPresetMenuProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const [options, setOptions] = useState<PresetOption[]>([])
  const [metaByName, setMetaByName] = useState<Record<string, PresetMeta>>({})
  useEffect(() => {
    if (!projectPath) {
      setOptions([])
      setMetaByName({})
      return
    }
    void (async () => {
      try {
        const res = await window.qqbat.file.read(projectPath, PRESETS_FILE)
        if (!res.ok || typeof res.data !== 'string') {
          setOptions([])
          return
        }
        const parsed = parsePresetOptions(JSON.parse(res.data))
        setOptions(parsed.options)
        setMetaByName(parsed.meta)
      } catch {
        setOptions([])
      }
    })()
  }, [projectPath, reloadKey])
  // 把"选中项的元信息"报给调用方（界面显示用；主进程仍会自己解析）
  useEffect(() => {
    onResolve?.(preset ? (metaByName[preset] ?? null) : null)
  }, [preset, metaByName, onResolve])
  /** 触发器上显示的那个名字：预设名 > 角色名 > 跟随页面 */
  const currentLabel = preset
    ? preset
    : override
      ? t(AI_MODE_BUTTONS.find(b => b.mode === override)?.labelKey ?? 'ai.mode.builder')
      : t('ai.mode.followPage')
  const rowClass =
    'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-zinc-800 disabled:opacity-40'
  const mark = <span className="w-3 shrink-0 text-center text-blue-300">✓</span>
  return (
    <details className="relative min-w-0">
      <summary
        className="flex min-w-0 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 [&::-webkit-details-marker]:hidden"
        title={t('ai.preset.title')}
      >
        <span className="shrink-0 text-zinc-500">{t('ai.preset.trigger')}</span>
        <span className="min-w-0 truncate text-zinc-300">{currentLabel}</span>
        <span className="shrink-0 text-zinc-600">▾</span>
      </summary>
      <div className="absolute bottom-full left-0 z-20 mb-1 w-64 space-y-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs shadow-xl">
        {/* 跟随页面：相当于"没有预设、角色跟着页签走" */}
        <button
          type="button"
          className={rowClass}
          aria-pressed={!override && !preset}
          disabled={disabled}
          title={t('ai.preset.followPageHint')}
          onClick={e => {
            closeMenu(e.currentTarget)
            onPickPage()
          }}
        >
          {!override && !preset ? mark : <span className="w-3 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{t('ai.mode.followPage')}</span>
          <span className="shrink-0 text-[10px] text-zinc-600">{t('ai.preset.pageHint')}</span>
        </button>
        <div className="px-1 pt-1 text-[10px] text-zinc-500">{t('ai.preset.groupRole')}</div>
        {AI_MODE_BUTTONS.map(({ mode, icon, labelKey, hintKey }) => {
          const active = !preset && override === mode
          return (
            <button
              key={mode}
              type="button"
              className={rowClass}
              aria-pressed={active}
              disabled={disabled}
              title={t(hintKey)}
              onClick={e => {
                closeMenu(e.currentTarget)
                onPickRole(mode)
              }}
            >
              {active ? mark : <span className="w-3 shrink-0" />}
              <span aria-hidden="true">{icon}</span>
              <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
            </button>
          )
        })}
        <div className="my-1 border-t border-zinc-800" />
        <div className="px-1 text-[10px] text-zinc-500">{t('ai.preset.groupMine')}</div>
        {options.length === 0 ? (
          <div className="px-1 py-1 text-zinc-500">{t('ai.preset.empty')}</div>
        ) : (
          options.map(o => {
            const active = preset === o.name
            const role = metaByName[o.name]?.role
            return (
              <button
                key={o.name}
                type="button"
                className={rowClass}
                aria-pressed={active}
                disabled={disabled}
                title={
                  role
                    ? t('ai.preset.roleFixed', { role: t(roleLabelKey(role)) })
                    : t('ai.preset.roleFollow')
                }
                onClick={e => {
                  closeMenu(e.currentTarget)
                  onPickPreset(o.name)
                }}
              >
                {active ? mark : <span className="w-3 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
              </button>
            )
          })
        )}
        <div className="my-1 border-t border-zinc-800" />
        <button
          type="button"
          className={rowClass}
          disabled={disabled}
          title={t('ai.agentCore.presetEditTitle')}
          onClick={e => {
            closeMenu(e.currentTarget)
            onEditPresets()
          }}
        >
          <span className="w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('ai.agentCore.presetEdit')}</span>
        </button>
      </div>
    </details>
  )
}

/**
 * 预设里写的 role 用角色按钮那一份文案说，不另写一套。
 * 注意 role（builder/coder/…）与 mode（blocks/code/…）是两个类型，先由 MODE_OF_ROLE 翻译 ——
 * 直接拿 role 去比 mode 会永远匹配不上，四行全落到 default 的"搭建者"。
 */
function roleLabelKey(role: AgentRole): string {
  return AI_MODE_BUTTONS.find(b => b.mode === MODE_OF_ROLE[role])?.labelKey ?? 'ai.mode.builder'
}
