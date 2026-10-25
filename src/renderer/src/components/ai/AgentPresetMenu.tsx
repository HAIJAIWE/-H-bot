// src/renderer/src/components/ai/AgentPresetMenu.tsx
//
// **一个选择器，而不是两个**（2026-10-25）。原来是「角色：🧩流程助手 📝代码助手 …
// 跟页面」一排按钮 + 下拉里再列自定义预设 —— 同一件事在两处选，界面上还多一条
// 带下划线的「跟页面」。DSH 的做法（packages/client/ui-agent-preset）是一个菜单：
// 内置与自定义分组、当前项高亮、编辑走另一个入口。这里就按那个形状。
//
// 三种取值落到同一件事上（主进程只认「角色 + 预设名」这两样）：
//   · 跟随页面  → 角色不覆盖（按当前页签推） + 不带预设；
//   · 内置角色  → 覆盖角色 + 不带预设；
//   · 我的预设  → 带预设名；角色由预设的 role 决定（没写就跟页面走）。
//
// ## 第 48 批：菜单不再自己解析文件
//
// 以前这里 `file.read` + `parsePresetOptions` 自己解析，容错口径与主进程不同 ——
// 菜单里看得到、跑起来查不到。现在只显示 `ai:getPresets` 返回的注册表：
// 坏条目带原因（禁用）、字段被忽略带 notes（可选中，title 里说明差异）。
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { MODE_OF_ROLE, type AgentMode, type AgentRole } from '@shared/ai/roleDomains'
import type { AgentPresetRow, PresetSessionState } from '@shared/ai/presetRoster'
import { AI_MODE_BUTTONS } from './agentModes'

export interface AgentPresetMenuProps {
  /** 当前项目路径；没有项目时「我的预设」分组只留编辑入口的禁用态 */
  projectPath: string | undefined
  /** 手动覆盖的角色；null = 跟随页面（用于高亮） */
  override: AgentMode | null
  /** 选中的自定义预设名；null = 没用预设 */
  preset: string | null
  /** 当前线程（第 50 批）：带上才能读到会话锁状态 */
  threadId?: string
  /** 会话锁生效时，把锁里的预设同步回调用方（界面以主进程为准，不自己猜） */
  onSessionPreset?: (name: string | null) => void
  /** 选中预设的元信息（边界行/提示用；主进程仍自己裁决，不依赖这里） */
  onResolve?: (meta: AgentPresetRow | null) => void
  /** 变更计数：编辑保存后 +1，触发重新读注册表 */
  reloadKey?: number
  disabled?: boolean
  onPickPage: () => void
  onPickRole: (mode: AgentMode) => void
  onPickPreset: (name: string) => void
  onEditPresets: () => void
  /** 导出/导入（第 53 批）：操作的是磁盘上的预设表，所以不做进编辑器 */
  onExportPresets?: () => void
  onImportPresets?: () => void
}

/** 收掉 details 菜单（点完一项就关，不靠点第二次） */
function closeMenu(el: HTMLElement): void {
  el.closest('details')?.removeAttribute('open')
}

export function AgentPresetMenu({
  projectPath,
  override,
  preset,
  threadId,
  onSessionPreset,
  onResolve,
  reloadKey,
  disabled,
  onPickPage,
  onPickRole,
  onPickPreset,
  onEditPresets,
  onExportPresets,
  onImportPresets,
}: AgentPresetMenuProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const [rows, setRows] = useState<AgentPresetRow[]>([])
  const [fileProblem, setFileProblem] = useState<string | undefined>(undefined)
  const [session, setSession] = useState<PresetSessionState | undefined>(undefined)
  /** 项目默认预设（第 51 批）：只影响**空白线程**，当前会话锁定也照样能改 */
  const [defaultName, setDefaultName] = useState<string | null>(null)
  const [defaultProblem, setDefaultProblem] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!projectPath) {
      setRows([])
      setFileProblem(undefined)
      setSession(undefined)
      setDefaultName(null)
      setDefaultProblem(undefined)
      return
    }
    let alive = true
    void (async () => {
      try {
        const res = await window.qqbat.ai.getPresets(projectPath, threadId)
        if (!alive) return
        if (res.ok) {
          setRows(res.data.presets)
          setFileProblem(res.data.fileProblem)
          setSession(res.data.session)
          setDefaultName(res.data.defaultPreset ?? null)
          setDefaultProblem(res.data.defaultProblem)
        } else {
          setRows([])
          setFileProblem(res.error)
          setSession(undefined)
          setDefaultName(null)
          setDefaultProblem(undefined)
        }
      } catch {
        if (alive) {
          setRows([])
          setFileProblem(undefined)
          setSession(undefined)
          setDefaultName(null)
          setDefaultProblem(undefined)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [projectPath, threadId, reloadKey])
  /** 会话锁生效时以主进程为准：把锁里的选择同步回 store（回调方负责比较，避免循环） */
  useEffect(() => {
    if (session?.locked) onSessionPreset?.(session.preset)
  }, [session, onSessionPreset])
  // 把"选中项的元信息"报给调用方（界面显示用；主进程仍会自己裁决）
  useEffect(() => {
    onResolve?.(preset ? (rows.find(r => r.name === preset && !r.broken) ?? null) : null)
  }, [preset, rows, onResolve])
  const usable = rows.filter(r => !r.broken)
  const broken = rows.filter(r => r.broken)
  /** 默认值指向的条目还在不在（不在时 select 要能显示"不可用"，而不是悄悄跳到第一项） */
  const defaultUsable = defaultName ? usable.some(r => r.name === defaultName) : true
  const pickDefault = async (next: string | null): Promise<void> => {
    if (!projectPath) return
    const prev = defaultName
    setDefaultName(next)
    setDefaultProblem(undefined)
    try {
      const res = await window.qqbat.ai.setPresetDefault(projectPath, next)
      if (!res.ok) {
        setDefaultName(prev)
        setDefaultProblem(res.error)
      }
    } catch (e) {
      setDefaultName(prev)
      setDefaultProblem(e instanceof Error ? e.message : String(e))
    }
  }
  /** 会话锁：开始过一轮就不能再换（第 50 批）。锁定时界面只认锁里的值。 */
  const locked = session?.locked ?? false
  const shownPreset = locked ? (session?.preset ?? null) : preset
  const selectedUsable = shownPreset ? usable.some(r => r.name === shownPreset) : true
  /** 触发器上显示的那个名字：预设名 > 角色名 > 跟随页面 */
  const currentLabel = shownPreset
    ? shownPreset + (selectedUsable ? '' : ' ⚠')
    : override
      ? t(AI_MODE_BUTTONS.find(b => b.mode === override)?.labelKey ?? 'ai.mode.builder')
      : t('ai.mode.followPage')
  const rowClass =
    'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
  const mark = <span className="w-3 shrink-0 text-center text-blue-300">✓</span>
  /** 一条预设的悬浮说明：角色口径 + 被忽略的字段（有就写出来） */
  const titleOf = (row: AgentPresetRow): string => {
    const head = row.role
      ? t('ai.preset.roleFixed', { role: t(roleLabelKey(row.role)) })
      : t('ai.preset.roleFollow')
    return row.notes && row.notes.length > 0 ? `${head} · ${row.notes.join('；')}` : head
  }
  return (
    <details className="relative min-w-0">
      <summary
        className="flex min-w-0 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 [&::-webkit-details-marker]:hidden"
        title={
          locked
            ? t('ai.preset.lockedTitle', { preset: shownPreset ?? t('ai.mode.followPage') })
            : t('ai.preset.title')
        }
      >
        <span className="shrink-0 text-zinc-500">{t('ai.preset.trigger')}</span>
        <span className="min-w-0 truncate text-zinc-300">{currentLabel}</span>
        <span className="shrink-0 text-zinc-600">▾</span>
      </summary>
      {/*
        宽度按**栏宽**收，不按视口：右栏是 @container，菜单挂着绝对定位但被祖先
        `overflow-hidden` 的列容器裁剪（696 档实测：left-0 + 256px 会戳出栏外 121px，
        而 absolute 不撑大 scrollWidth —— 不是"出现滚动条"那种看得见的破版，是右边直接没了）。
        100cqw = 最近容器（aside 右栏）的宽度，180px 栏下收到 164px，行内靠 truncate 收尾。
      */}
      <div className="absolute bottom-full left-0 z-20 mb-1 w-[min(16rem,calc(100cqw-1rem))] space-y-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs shadow-xl">
        {/* 会话锁：先解释为什么下面的可选项都点不了，否则禁用态看起来像坏了 */}
        {locked ? (
          <div
            className="mx-1 my-0.5 rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-1 text-[10px] leading-4 text-amber-300"
            title={
              session?.problem
                ? t('ai.preset.lockedProblem', { reason: session.problem })
                : t('ai.preset.locked', { preset: shownPreset ?? t('ai.mode.followPage') })
            }
          >
            <span className="line-clamp-2">
              {session?.problem
                ? t('ai.preset.lockedProblem', { reason: session.problem })
                : t('ai.preset.locked', { preset: shownPreset ?? t('ai.mode.followPage') })}
            </span>
          </div>
        ) : null}
        {/* 默认预设：只影响新会话；和下面"这一轮选什么"是两件事 */}
        <div className="flex items-center gap-1 px-1 py-1">
          <span className="shrink-0 text-[10px] text-zinc-500">{t('ai.preset.defaultLabel')}</span>
          <select
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200"
            value={defaultName ?? ''}
            disabled={disabled || !projectPath}
            title={t('ai.preset.defaultHint')}
            onChange={e => {
              void pickDefault(e.target.value || null)
            }}
          >
            <option value="">{t('ai.mode.followPage')}</option>
            {!defaultUsable && defaultName ? (
              <option value={defaultName} disabled>
                {defaultName}（{t('ai.preset.brokenTag')}）
              </option>
            ) : null}
            {usable.map(row => (
              <option key={`default:${row.name}`} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        {defaultProblem ? (
          <div
            className="mx-1 my-0.5 rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-1 text-[10px] leading-4 text-amber-300"
            title={defaultProblem}
          >
            <span className="line-clamp-2">
              {t('ai.preset.defaultProblem', { reason: defaultProblem })}
            </span>
          </div>
        ) : null}
        {/* 跟随页面：相当于"没有预设、角色跟着页签走" */}
        <button
          type="button"
          className={rowClass}
          aria-pressed={!override && !shownPreset}
          disabled={disabled || locked}
          title={t('ai.preset.followPageHint')}
          onClick={e => {
            closeMenu(e.currentTarget)
            onPickPage()
          }}
        >
          {!override && !shownPreset ? mark : <span className="w-3 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{t('ai.mode.followPage')}</span>
          {/* 180px 栏下这行只剩个"按页签"的碎影，索性让位 —— 和会话头插件计数同一个手法。 */}
          <span className="hidden shrink-0 text-[10px] text-zinc-600 @min-[220px]:inline">
            {t('ai.preset.pageHint')}
          </span>
        </button>
        <div className="px-1 pt-1 text-[10px] text-zinc-500">{t('ai.preset.groupRole')}</div>
        {AI_MODE_BUTTONS.map(({ mode, icon, labelKey, hintKey }) => {
          const active = !shownPreset && override === mode
          return (
            <button
              key={mode}
              type="button"
              className={rowClass}
              aria-pressed={active}
              disabled={disabled || locked}
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
        {/* 文件级问题：整份读不了 / 顶层不是数组 —— 不说出来，用户只会看到"我的预设没了" */}
        {fileProblem ? (
          <div
            className="mx-1 my-0.5 rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-1 text-[10px] leading-4 text-amber-300"
            title={fileProblem}
          >
            <span className="line-clamp-2">
              {t('ai.preset.fileProblem', { reason: fileProblem })}
            </span>
          </div>
        ) : null}
        {usable.length === 0 && broken.length === 0 ? (
          <div className="px-1 py-1 text-zinc-500">{t('ai.preset.empty')}</div>
        ) : (
          usable.map(row => {
            const active = shownPreset === row.name
            return (
              <button
                key={row.name}
                type="button"
                className={rowClass}
                aria-pressed={active}
                disabled={disabled || locked}
                title={titleOf(row)}
                onClick={e => {
                  closeMenu(e.currentTarget)
                  onPickPreset(row.name)
                }}
              >
                {active ? mark : <span className="w-3 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {/* 内置 / 默认是两件事：内置随程序来，默认只影响空白线程 */}
                {row.builtin ? (
                  <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">
                    {t('ai.preset.builtinTag')}
                  </span>
                ) : null}
                {defaultName === row.name ? (
                  <span className="shrink-0 rounded bg-blue-950 px-1 text-[10px] text-blue-300">
                    {t('ai.preset.defaultTag')}
                  </span>
                ) : null}
                {/* 有字段被忽略：能选，但别让用户以为文件里的值都生效了 */}
                {row.notes && row.notes.length > 0 ? (
                  <span
                    className="shrink-0 text-[10px] text-amber-400"
                    title={row.notes.join('；')}
                  >
                    {t('ai.preset.notesHint')}
                  </span>
                ) : null}
              </button>
            )
          })
        )}
        {broken.length > 0 ? (
          <>
            <div className="my-1 border-t border-zinc-800" />
            <div className="px-1 text-[10px] text-zinc-500">{t('ai.preset.groupBroken')}</div>
            {broken.map(row => (
              <button
                key={`broken:${row.name}`}
                type="button"
                className={rowClass}
                disabled
                title={row.broken}
              >
                <span className="w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate line-through">{row.name}</span>
                <span className="shrink-0 text-[10px] text-red-400">
                  {t('ai.preset.brokenTag')}
                </span>
              </button>
            ))}
          </>
        ) : null}
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
        {/* 导出/导入放最后：它们搬的是整张表，不是「这一轮用哪个」 */}
        <button
          type="button"
          className={rowClass}
          disabled={disabled || !projectPath || !onExportPresets}
          onClick={e => {
            closeMenu(e.currentTarget)
            onExportPresets?.()
          }}
        >
          <span className="w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('ai.preset.exportAction')}</span>
        </button>
        <button
          type="button"
          className={rowClass}
          disabled={disabled || !projectPath || !onImportPresets}
          onClick={e => {
            closeMenu(e.currentTarget)
            onImportPresets?.()
          }}
        >
          <span className="w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('ai.preset.importAction')}</span>
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
