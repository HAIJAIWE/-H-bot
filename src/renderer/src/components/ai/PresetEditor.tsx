// src/renderer/src/components/ai/PresetEditor.tsx
//
// **会话预设编辑**（2026-10-19 JSON → 2026-10-25 表单）。
//
// 为什么改了：JSON 版把「我到底能改哪些东西」交给了用户的 JSON 水平 —— 字段拼错主进程只会
// 静默跳过，看起来保存成功、其实那一条没了约束。表单把真实字段摆出来，改错当场报错。
//
// 两条设计约束：
//  · **不认识的字段原样留着**：编辑对象就是文件里的那个对象，只动表单负责的键（未来字段、
//    老文件里的 id 都不会被保存动作抹掉）；保留「JSON 模式」兜表单还没做的字段（plugins）。
//  · **界面不做权限判断**：这里只负责写文件；工具白名单/角色写域/审批由主进程解析执行，
//    保存走 ai:savePresets，未知工具与未装载插件只回 warnings（预设允许「先写、后装」）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AI_MODE_BUTTONS } from './agentModes'
import { PresetImpact } from './PresetImpact'
import { MODE_OF_ROLE, type AgentRole } from '@shared/ai/roleDomains'
import type { AiToolDefinition } from '@shared/types/ai'
import {
  PRESET_NAME_MAX as NAME_MAX,
  PRESET_PROMPT_MAX as PROMPT_MAX,
  PRESET_ROLES as ROLES,
  PRESETS_FILE,
} from '@shared/ai/presetRoster'
import { BUILTIN_PRESET_NAMES } from '@shared/ai/builtinPresets'

/** 表单编辑的就是文件里的对象本身（未知字段跟着一起走） */
type Draft = Record<string, unknown>

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function asDrafts(parsed: unknown): Draft[] {
  return Array.isArray(parsed)
    ? parsed.filter((v): v is Draft => !!v && typeof v === 'object' && !Array.isArray(v))
    : []
}

export function PresetEditor({
  open,
  projectPath,
  onClose,
  onSaved,
}: {
  open: boolean
  projectPath: string | undefined
  onClose: () => void
  /** 保存成功后通知调用方刷新预设列表 */
  onSaved: () => void
}): React.ReactNode {
  useLocaleSubscription()
  const [rows, setRows] = useState<Draft[]>([])
  const [selected, setSelected] = useState(0)
  /** JSON 模式：兜表单没做的字段（plugins）与手改老文件 */
  const [raw, setRaw] = useState(false)
  const [rawText, setRawText] = useState('[]')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [tools, setTools] = useState<AiToolDefinition[]>([])
  const [toolQuery, setToolQuery] = useState('')

  // 打开时读盘 + 读工具表。工具表与项目无关（注册表是全局的），失败就空表 + 提示不勾即可。
  useEffect(() => {
    if (!open) return
    setError('')
    setWarnings([])
    setRaw(false)
    setRawText('[]')
    setSelected(0)
    setToolQuery('')
    if (!projectPath) {
      setRows([])
      return
    }
    void (async () => {
      const res = await window.qqbat.file.read(projectPath, PRESETS_FILE)
      const text = res.ok && typeof res.data === 'string' ? res.data : ''
      if (!text.trim()) {
        setRows([])
        return
      }
      try {
        const drafts = asDrafts(JSON.parse(text))
        setRows(drafts)
        setRawText(JSON.stringify(drafts, null, 2))
      } catch {
        // 坏文件：原样进 JSON 模式让用户修 —— 解析不了的东西不能假装能解析
        setRows([])
        setRawText(text)
        setRaw(true)
        setError(t('ai.agentCore.presetLoadBroken'))
      }
    })()
    void (async () => {
      const res = await window.qqbat.ai.tools()
      if (res.ok && Array.isArray(res.data)) setTools(res.data)
    })()
  }, [open, projectPath])

  /** 只改这一条的一个键；`undefined` = 把这个键从文件里删掉（空字段不落盘） */
  const setField = useCallback((index: number, key: string, value: unknown) => {
    setRows(prev =>
      prev.map((row, i) => {
        if (i !== index) return row
        const next: Draft = { ...row }
        if (value === undefined) delete next[key]
        else next[key] = value
        return next
      }),
    )
  }, [])

  const noProject = !projectPath
  const current = rows[selected]
  const currentTools = current ? asList(current.allowedTools) : []
  const currentPlugins = current ? asList(current.plugins) : []
  /** 预览用的角色：只认四个已知值（不认识的值当没写，与主进程 normalizeRole 一致） */
  const previewRole = ROLES.find(role => role === asText(current?.role)) ?? null
  const previewApproval = asText(current?.permissionMode) === 'full' ? 'full' : 'ask'

  const toggleTool = (name: string): void => {
    const next = currentTools.includes(name)
      ? currentTools.filter(n => n !== name)
      : [...currentTools, name]
    // 勾空 = 不限制（与主进程「空集不限定」一致），而不是写一个空数组进文件
    setField(selected, 'allowedTools', next.length > 0 ? next : undefined)
  }

  const filteredTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase()
    const list = q
      ? tools.filter(
          tool => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
        )
      : tools
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [tools, toolQuery])

  const addPreset = (): void => {
    const base = t('ai.agentCore.presetNewName')
    const taken = new Set(rows.map(row => asText(row.name).trim()))
    let name = base
    for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`
    setRows(prev => [...prev, { name }])
    setSelected(rows.length)
  }

  const removePreset = (): void => {
    setRows(prev => prev.filter((_, i) => i !== selected))
    setSelected(s => Math.max(0, Math.min(s, rows.length - 2)))
  }

  const toggleRaw = (next: boolean): void => {
    if (next) {
      setRawText(JSON.stringify(rows, null, 2))
      setRaw(true)
      setError('')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch (e) {
      // 解析不了就留在 JSON 模式：别把用户刚写的东西吞掉
      setError(
        t('ai.agentCore.presetInvalidJson', { message: e instanceof Error ? e.message : '' }),
      )
      return
    }
    if (!Array.isArray(parsed)) {
      setError(t('ai.agentCore.presetMustBeArray'))
      return
    }
    setRows(asDrafts(parsed))
    setSelected(0)
    setRaw(false)
    setError('')
  }

  const save = async (): Promise<void> => {
    if (!projectPath) {
      setError(t('ai.agentCore.presetNoProject'))
      return
    }
    setError('')
    setWarnings([])
    let payload: Array<Record<string, unknown>>
    if (raw) {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawText)
      } catch (e) {
        setError(
          t('ai.agentCore.presetInvalidJson', { message: e instanceof Error ? e.message : '' }),
        )
        return
      }
      if (!Array.isArray(parsed)) {
        setError(t('ai.agentCore.presetMustBeArray'))
        return
      }
      payload = asDrafts(parsed)
    } else {
      // 主进程遇到没名字/重名的条目只会静默跳过，这里必须先拦住（否则「保存成功」是假的）
      const seen = new Set<string>()
      for (let i = 0; i < rows.length; i += 1) {
        const name = asText(rows[i].name).trim()
        if (!name) {
          setError(t('ai.agentCore.presetNameRequired', { index: i + 1 }))
          setSelected(i)
          return
        }
        if (seen.has(name)) {
          setError(t('ai.agentCore.presetDuplicateName', { name }))
          setSelected(i)
          return
        }
        seen.add(name)
      }
      payload = rows.map(row => ({ ...row, name: asText(row.name).trim() }))
    }
    /**
     * 内置名不能保存（第 51 批）。主进程 `writePresets` 会再拦一次；
     * 这里先拦是为了把错误指到具体那一条，而不是等保存回来只有一个红条。
     */
    const builtinHit = payload.find(p => BUILTIN_PRESET_NAMES.has(asText(p.name).trim()))
    if (builtinHit) {
      setError(t('ai.agentCore.presetBuiltinName', { name: asText(builtinHit.name).trim() }))
      return
    }
    setSaving(true)
    try {
      const res = await window.qqbat.ai.savePresets(
        projectPath,
        payload as Parameters<typeof window.qqbat.ai.savePresets>[1],
      )
      if (!res.ok) {
        setError(res.error ?? t('ai.agentCore.presetMustBeArray'))
        return
      }
      onSaved()
      if (res.data && res.data.warnings.length > 0) {
        setWarnings(res.data.warnings)
        return // 有警告就不关窗：让用户看见再决定
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200'
  const labelClass = 'mb-1 block text-xs text-zinc-400'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ai.agentCore.presetEditTitle')}
      width="760px"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={raw} onChange={e => toggleRaw(e.target.checked)} />
            {t('ai.agentCore.presetRawToggle')}
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={saving || noProject}
              onClick={() => void save()}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <p className="mb-2 text-xs text-zinc-500">{t('ai.agentCore.presetEditHint')}</p>
      <p className="mb-2 text-[11px] leading-4 text-amber-400/90">
        {t('ai.agentCore.presetBuiltinHint')}
      </p>
      {noProject && (
        <p className="mb-2 text-xs text-amber-400">{t('ai.agentCore.presetNoProject')}</p>
      )}
      {raw ? (
        <>
          <textarea
            className="h-72 w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-200"
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            spellCheck={false}
            aria-label={t('ai.agentCore.presetRawToggle')}
          />
          <p className="mt-1 text-[11px] text-zinc-500">{t('ai.agentCore.presetRawHint')}</p>
        </>
      ) : (
        <div className="flex gap-3">
          <div className="flex w-40 shrink-0 flex-col gap-1">
            <div className="flex items-center justify-between gap-1 text-xs text-zinc-400">
              <span>{t('ai.agentCore.presetListTitle')}</span>
              <Button variant="secondary" size="sm" onClick={addPreset}>
                {t('ai.agentCore.presetAdd')}
              </Button>
            </div>
            <div className="max-h-64 overflow-auto rounded border border-zinc-800 p-1">
              {rows.length === 0 && (
                <p className="p-1 text-[11px] text-zinc-500">
                  {t(noProject ? 'ai.agentCore.presetNoProject' : 'ai.agentCore.presetEmpty')}
                </p>
              )}
              {rows.map((row, i) => (
                <button
                  key={i}
                  type="button"
                  aria-current={i === selected}
                  onClick={() => setSelected(i)}
                  className={`mb-0.5 block w-full truncate rounded px-2 py-1 text-left text-xs ${
                    i === selected
                      ? 'bg-blue-500/20 text-blue-200'
                      : 'text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  {asText(row.name).trim() || t('ai.agentCore.presetUntitled')}
                </button>
              ))}
            </div>
            {current && (
              <Button variant="secondary" size="sm" onClick={removePreset}>
                {t('ai.agentCore.presetDelete')}
              </Button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {!current ? (
              <p className="text-xs text-zinc-500">
                {t(noProject ? 'ai.agentCore.presetNoProject' : 'ai.agentCore.presetEmpty')}
              </p>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className={labelClass}>{t('ai.agentCore.presetFieldName')}</span>
                  <input
                    className={inputClass}
                    value={asText(current.name)}
                    maxLength={NAME_MAX}
                    onChange={e => setField(selected, 'name', e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>{t('ai.agentCore.presetFieldDescription')}</span>
                  <input
                    className={inputClass}
                    value={asText(current.description)}
                    onChange={e =>
                      setField(selected, 'description', e.target.value ? e.target.value : undefined)
                    }
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelClass}>{t('ai.agentCore.presetFieldRole')}</span>
                    <select
                      className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                      value={asText(current.role)}
                      onChange={e =>
                        setField(selected, 'role', e.target.value ? e.target.value : undefined)
                      }
                    >
                      <option value="">{t('ai.agentCore.presetRoleFollow')}</option>
                      {ROLES.map(role => {
                        const button = AI_MODE_BUTTONS.find(b => b.mode === MODE_OF_ROLE[role])
                        return (
                          <option key={role} value={role}>
                            {button ? t(button.labelKey) : role}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>{t('ai.agentCore.presetFieldApproval')}</span>
                    <select
                      className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                      value={asText(current.permissionMode) === 'full' ? 'full' : ''}
                      onChange={e =>
                        setField(
                          selected,
                          'permissionMode',
                          e.target.value === 'full' ? 'full' : undefined,
                        )
                      }
                    >
                      <option value="">{t('ai.agentCore.presetApprovalDefault')}</option>
                      <option value="full">{t('ai.agentCore.presetApprovalFull')}</option>
                    </select>
                  </label>
                </div>
                <PresetImpact
                  role={previewRole}
                  allowedTools={currentTools}
                  tools={tools}
                  permissionMode={previewApproval}
                  plugins={currentPlugins}
                />
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-400">
                      {t('ai.agentCore.presetFieldTools')}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-zinc-500">
                      <span>
                        {currentTools.length === 0
                          ? t('ai.agentCore.presetNone')
                          : t('ai.agentCore.presetToolsSelected', { n: currentTools.length })}
                      </span>
                      {currentTools.length > 0 && (
                        <button
                          type="button"
                          className="underline hover:text-zinc-300"
                          onClick={() => setField(selected, 'allowedTools', undefined)}
                        >
                          {t('ai.agentCore.presetToolsClear')}
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="mb-1 text-[11px] text-zinc-500">
                    {t('ai.agentCore.presetToolsHint')}
                  </p>
                  <input
                    className={inputClass}
                    value={toolQuery}
                    placeholder={t('ai.agentCore.presetToolsSearch')}
                    aria-label={t('ai.agentCore.presetToolsSearch')}
                    onChange={e => setToolQuery(e.target.value)}
                  />
                  <div className="mt-1 max-h-40 overflow-auto rounded border border-zinc-800 p-1">
                    {filteredTools.length === 0 ? (
                      <p className="p-1 text-[11px] text-zinc-500">
                        {t('ai.agentCore.presetToolsEmpty')}
                      </p>
                    ) : (
                      filteredTools.map(tool => (
                        <label
                          key={tool.name}
                          className="flex items-start gap-1.5 rounded px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={currentTools.includes(tool.name)}
                            onChange={() => toggleTool(tool.name)}
                          />
                          <span className="font-mono">{tool.name}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                            {tool.category === 'query'
                              ? t('ai.agentCore.presetToolsQuery')
                              : t('ai.agentCore.presetToolsMutation')}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                    <span>{t('ai.agentCore.presetFieldPrompt')}</span>
                    <span className="text-[11px] text-zinc-500">
                      {asText(current.prompt).length}/{PROMPT_MAX}
                    </span>
                  </span>
                  <textarea
                    className="h-20 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200"
                    value={asText(current.prompt)}
                    maxLength={PROMPT_MAX}
                    onChange={e =>
                      setField(selected, 'prompt', e.target.value ? e.target.value : undefined)
                    }
                    aria-label={t('ai.agentCore.presetFieldPrompt')}
                  />
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {t('ai.agentCore.presetFieldPromptHint')}
                  </span>
                </label>
                {currentPlugins.length > 0 && (
                  <p className="text-[11px] text-amber-300/80">
                    {t('ai.agentCore.presetPluginsOnlyJson', { list: currentPlugins.join(', ') })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {warnings.map(w => (
        <p key={w} className="mt-1 text-xs text-amber-300">
          {w}
        </p>
      ))}
    </Modal>
  )
}
