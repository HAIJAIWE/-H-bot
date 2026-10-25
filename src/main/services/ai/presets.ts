// src/main/services/ai/presets.ts
//
// **会话预设**：`.qqbat/agent-presets.json` —— 名字 → 这一轮怎么跑。
//
// 2026-10-24 对齐 DSH `agent-preset` 后多三件事：
//   · `role`           —— 这一轮用哪个**角色**（缺省跟页面走，见 shared/ai/roleDomains.ts）；
//   · `prompt`         —— **附加要求**（拼在角色强调句之后）；
//   · `permissionMode` —— **审批口径**（`'full'` = 这一轮无人值守，不落规则）。
//
// 仍是"约束这一轮"，不存模型参数：模型是用户在设置里选的，预设不该偷偷换掉。
// 工具表是**权限边界**（提示词里写"别用某工具"是劝告）——真正越不越界看
// `allowedTools` / `plugins` / 角色写域这三道闸。
//
// 第 48 批：只有这一处解析，返回 `AgentPresetRow[]`，坏条目不再静默跳过（菜单自己
// 解析文件的日子结束）：`broken` = 整条不可用；`notes` = 部分字段被忽略但可用；
// `order` = 菜单排序（没写的排后面，仍按文件顺序）。
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import {
  PRESETS_BASENAME,
  PRESET_DEFAULT_BASENAME,
  PRESET_NAME_MAX,
  PRESET_PROMPT_MAX,
  PRESET_ROLES,
  type AgentPreset,
  type AgentPresetRoster,
  type AgentPresetRow,
} from '@shared/ai/presetRoster'
import { BUILTIN_PRESETS, BUILTIN_PRESET_NAMES } from '@shared/ai/builtinPresets'

function presetsPath(projectPath: string): string {
  return join(projectPath, '.qqbat', PRESETS_BASENAME)
}

function defaultPresetPath(projectPath: string): string {
  return join(projectPath, '.qqbat', PRESET_DEFAULT_BASENAME)
}

/** 角色字段容错：不认识的值当没写（拼错不该让整条预设失效，但也不能猜） */
function normalizeRole(value: unknown): AgentPresetRow['role'] {
  return PRESET_ROLES.find(r => r === value)
}

/** 审批口径容错：只认 ask / full，其余（拼错、老数据、数字）一律当没写 */
function normalizePermission(value: unknown): 'ask' | 'full' | undefined {
  return value === 'ask' || value === 'full' ? value : undefined
}

/** 名字表归一：只留非空字符串、去空白、去重；`dirty` 数出被丢掉几项（notes 用） */
function nameList(value: unknown): { list: string[]; dirty: number } {
  if (!Array.isArray(value)) return { list: [], dirty: 0 }
  const trimmed = value.map(v => (typeof v === 'string' ? v.trim() : ''))
  const list = [...new Set(trimmed.filter(v => v.length > 0))]
  return { list, dirty: value.length - list.length }
}

/**
 * 纯函数：把解析出来的 JSON 变成注册表（不碰磁盘，方便单测）。
 * 两种"不可用"分得很清：`fileProblem` 是整个文件读不了，`broken` 是这一条用不了。
 */
export function parsePresetRoster(data: unknown): AgentPresetRoster {
  if (!Array.isArray(data)) {
    return {
      presets: [],
      fileProblem: '顶层不是数组（应该是 [{ "name": "…" }]）',
    }
  }
  const usable: Array<{ row: AgentPresetRow; index: number }> = []
  const broken: AgentPresetRow[] = []
  const seen = new Set<string>()
  data.forEach((item, index) => {
    const at = `第 ${index + 1} 条`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      broken.push({ name: at, broken: '不是对象（一条预设应该是 { "name": "…" }）' })
      return
    }
    const m = item as Record<string, unknown>
    const name = typeof m.name === 'string' ? m.name.trim() : ''
    if (!name) {
      broken.push({ name: at, broken: '没有名字（"name" 必填）' })
      return
    }
    if (name.length > PRESET_NAME_MAX) {
      broken.push({
        name: name.slice(0, PRESET_NAME_MAX),
        broken: `名字超过 ${PRESET_NAME_MAX} 个字`,
      })
      return
    }
    if (BUILTIN_PRESET_NAMES.has(name)) {
      broken.push({
        name,
        broken: `与内置预设「${name}」重名（内置预设不可覆盖，换个名字）`,
      })
      return
    }
    if (seen.has(name)) {
      broken.push({ name, broken: `与前面的「${name}」重名（这一条不生效）` })
      return
    }
    seen.add(name)

    const notes: string[] = []
    const role = normalizeRole(m.role)
    if (m.role !== undefined && !role) notes.push('role 不认识，已忽略')
    const permissionMode = normalizePermission(m.permissionMode)
    if (m.permissionMode !== undefined && !permissionMode)
      notes.push('permissionMode 不认识，已忽略')

    let prompt: string | undefined
    if (typeof m.prompt === 'string' && m.prompt.trim()) {
      const text = m.prompt.trim()
      prompt = text.length > PRESET_PROMPT_MAX ? text.slice(0, PRESET_PROMPT_MAX) : text
      if (text.length > PRESET_PROMPT_MAX) {
        notes.push(`附加要求超过 ${PRESET_PROMPT_MAX} 字，已截断`)
      }
    }

    const tools = nameList(m.allowedTools)
    if (m.allowedTools !== undefined && !Array.isArray(m.allowedTools)) {
      notes.push('工具白名单不是数组，已忽略')
    } else if (tools.dirty > 0) {
      notes.push(`工具白名单里有 ${tools.dirty} 项不是有效名字，已忽略`)
    }
    const plugins = nameList(m.plugins)
    if (m.plugins !== undefined && !Array.isArray(m.plugins)) {
      notes.push('插件集不是数组，已忽略')
    } else if (plugins.dirty > 0) {
      notes.push(`插件集里有 ${plugins.dirty} 项不是有效名字，已忽略`)
    }

    let order: number | undefined
    if (typeof m.order === 'number' && Number.isFinite(m.order)) order = m.order
    else if (m.order !== undefined) notes.push('order 不是数字，已忽略')

    const description =
      typeof m.description === 'string' && m.description.trim() ? m.description.trim() : undefined

    usable.push({
      index,
      row: {
        name,
        ...(role ? { role } : {}),
        ...(prompt ? { prompt } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(tools.list.length > 0 ? { allowedTools: tools.list } : {}),
        ...(plugins.list.length > 0 ? { plugins: plugins.list } : {}),
        ...(description ? { description } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      },
    })
  })
  // 有 order 的按 order 升序，没写的排后面，同序仍按文件顺序；坏条目按原顺序附在最后
  usable.sort(
    (a, b) =>
      (a.row.order ?? Number.POSITIVE_INFINITY) - (b.row.order ?? Number.POSITIVE_INFINITY) ||
      a.index - b.index,
  )
  return { presets: [...usable.map(u => u.row), ...broken] }
}

type PresetFile = Pick<AgentPresetRoster, 'presets' | 'fileProblem'>

/** 读用户文件：不存在 = 空表（不是错误）；坏文件 = fileProblem，永不抛 */
async function readUserPresets(projectPath: string): Promise<PresetFile> {
  let raw: string
  try {
    raw = await readFile(presetsPath(projectPath), 'utf-8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { presets: [] }
    return { presets: [], fileProblem: e instanceof Error ? e.message : String(e) }
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return {
      presets: [],
      fileProblem: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  return parsePresetRoster(data)
}

/** 默认记录的读结果；`problem` 有值 = 文件在但读不懂（不是"没设置"） */
export interface PresetDefaultRead {
  value: string | null
  problem?: string
}

/**
 * 读默认预设：缺失 = null（跟页面），与"读到 null"同义；坏文件给 problem。
 *
 * 为什么不复用 `readPresetRoster`：默认记录和预设表是两份文件，坏一份不该拖死另一份；
 * 而且解析默认值不需要先解析全部预设（快速路径也少一次 JSON.parse）。
 */
export async function readPresetDefault(projectPath: string): Promise<PresetDefaultRead> {
  let raw: string
  try {
    raw = await readFile(defaultPresetPath(projectPath), 'utf-8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { value: null }
    return { value: null, problem: e instanceof Error ? e.message : String(e) }
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return {
      value: null,
      problem: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { value: null, problem: '默认预设文件不是对象（应该是 { "default": "名字" }）' }
  }
  const m = data as Record<string, unknown>
  if (m.default === null || m.default === undefined) return { value: null }
  if (typeof m.default !== 'string' || !m.default.trim()) {
    return { value: null, problem: 'default 应该是预设名或 null' }
  }
  return { value: m.default.trim() }
}

/**
 * 合并三层真相：内置 → 用户 → 默认标记。
 *
 * 顺序沿用第 48 批：可用的按 order、再按来源顺序（内置在前）；坏条目附在最后。
 * 默认值指向坏条目/不存在的名字时**不静默退回跟页面** —— 记 `defaultProblem`，
 * 运行时由 `resolveDefaultPreset` 变成 fail-closed（默认也是权限口径）。
 */
export function mergePresetRoster(
  user: PresetFile,
  defaultRead: PresetDefaultRead,
): AgentPresetRoster {
  const builtins: AgentPresetRow[] = BUILTIN_PRESETS.map(p => ({ ...p }))
  const usable = [...builtins, ...user.presets.filter(p => !p.broken)]
  const broken = user.presets.filter(p => p.broken)
  usable.sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
  )

  const defaultName = defaultRead.value
  let defaultProblem = defaultRead.problem
  if (defaultProblem === undefined && defaultName !== null) {
    const row = usable.find(p => p.name === defaultName)
    if (row) row.isDefault = true
    else {
      defaultProblem = `默认预设「${defaultName}」不存在或不可用（在菜单里重选，或改成「跟页面」）`
    }
  }

  return {
    presets: [...usable, ...broken],
    ...(user.fileProblem ? { fileProblem: user.fileProblem } : {}),
    defaultPreset: defaultName,
    ...(defaultProblem ? { defaultProblem } : {}),
  }
}

/** 读完整注册表（内置 + 用户 + 默认）；任何一份文件坏掉都不抛 */
export async function readPresetRoster(projectPath: string): Promise<AgentPresetRoster> {
  const [user, def] = await Promise.all([
    readUserPresets(projectPath),
    readPresetDefault(projectPath),
  ])
  return mergePresetRoster(user, def)
}

/**
 * 运行时解析：传了预设名就必须**拿得到一条能用的**，否则这一轮不开跑。
 *
 * 为什么 fail-closed（2026-10-26）：以前 `readPreset` 查不到就 `undefined`，
 * 而调用方紧接着 `allowedToolNames = presetTools`、`role = preset?.role ?? …` ——
 * 查不到的后果是**权限白名单消失、角色悄悄退回页面默认**，且没有任何提示。
 * 删掉预设文件里的一行，等于静默放开这一轮的边界，这是最难被当成 bug 报的那种静默。
 */
export type PresetResolution = { ok: true; preset: AgentPresetRow } | { ok: false; error: string }

export async function resolvePresetForRun(
  projectPath: string,
  name: string,
): Promise<PresetResolution> {
  const roster = await readPresetRoster(projectPath)
  const row = roster.presets.find(p => p.name === name)
  if (!row) {
    const why = roster.fileProblem ? `（${roster.fileProblem}）` : ''
    return {
      ok: false,
      error: `找不到预设「${name}」${why}；为避免静默放开权限，这一轮没有开始`,
    }
  }
  if (row.broken) {
    return {
      ok: false,
      error: `预设「${name}」不可用：${row.broken}；这一轮没有开始`,
    }
  }
  return { ok: true, preset: row }
}

export type DefaultPresetResolution =
  { ok: true; preset: string | null } | { ok: false; error: string }

/**
 * 运行时取默认预设（只在"用户这一轮没表态 + 线程还是空白"时调用）。
 *
 * 默认值坏了就 fail-closed：默认值也是权限口径，读不懂时退回"跟页面"等于
 * 悄悄把边界放宽到页面默认。错误文案与 `resolvePresetForRun` 保持同一句式。
 */
export async function resolveDefaultPreset(projectPath: string): Promise<DefaultPresetResolution> {
  const roster = await readPresetRoster(projectPath)
  if (roster.defaultProblem) {
    return {
      ok: false,
      error: `默认预设不可用：${roster.defaultProblem}；为避免静默放开权限，这一轮没有开始`,
    }
  }
  return { ok: true, preset: roster.defaultPreset ?? null }
}

/**
 * 写默认预设：`null` = 删掉记录（跟页面），不是写一个 `{"default":null}`。
 * 服务层再校验一次目标可用（IPC 也查，但文件可能在两次读之间被改）。
 */
export async function writePresetDefault(projectPath: string, name: string | null): Promise<void> {
  if (name === null) {
    await rm(defaultPresetPath(projectPath), { force: true })
    return
  }
  const roster = await readPresetRoster(projectPath)
  const row = roster.presets.find(p => p.name === name)
  if (!row || row.broken) {
    throw new Error(`不能把「${name}」设为默认：它不是可用的预设`)
  }
  await mkdir(join(projectPath, '.qqbat'), { recursive: true })
  await writeFile(
    defaultPresetPath(projectPath),
    JSON.stringify({ default: row.name }, null, 2) + '\n',
    'utf-8',
  )
}

/** 写预设（整表覆盖；名字去重，后者覆盖前者）。保持不变：编辑器按对象保存，未知字段由界面负责保留。 */
export async function writePresets(projectPath: string, presets: AgentPreset[]): Promise<void> {
  const byName = new Map<string, AgentPreset>()
  for (const p of presets) {
    const name = String(p.name ?? '').trim()
    if (!name || name.length > PRESET_NAME_MAX) continue
    if (BUILTIN_PRESET_NAMES.has(name)) {
      throw new Error(`「${name}」是内置预设名，不能保存；请换个名字`)
    }
    const role = normalizeRole(p.role)
    const prompt =
      typeof p.prompt === 'string' && p.prompt.trim()
        ? p.prompt.trim().slice(0, PRESET_PROMPT_MAX)
        : undefined
    const permissionMode = normalizePermission(p.permissionMode)
    const tools = nameList(p.allowedTools)
    const plugins = nameList(p.plugins)
    byName.set(name, {
      name,
      ...(role ? { role } : {}),
      ...(prompt ? { prompt } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(tools.list.length > 0 ? { allowedTools: tools.list } : {}),
      ...(plugins.list.length > 0 ? { plugins: plugins.list } : {}),
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
      ...(typeof p.order === 'number' && Number.isFinite(p.order) ? { order: p.order } : {}),
    })
  }
  const dir = join(projectPath, '.qqbat')
  await mkdir(dir, { recursive: true })
  await writeFile(
    presetsPath(projectPath),
    JSON.stringify([...byName.values()], null, 2) + '\n',
    'utf-8',
  )
}
