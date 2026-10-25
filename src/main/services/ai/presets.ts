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
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import {
  PRESETS_BASENAME,
  PRESET_NAME_MAX,
  PRESET_PROMPT_MAX,
  PRESET_ROLES,
  type AgentPreset,
  type AgentPresetRoster,
  type AgentPresetRow,
} from '@shared/ai/presetRoster'

function presetsPath(projectPath: string): string {
  return join(projectPath, '.qqbat', PRESETS_BASENAME)
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

/** 读注册表：文件不存在 = 空表（不是错误）；坏文件 = fileProblem，永不抛 */
export async function readPresetRoster(projectPath: string): Promise<AgentPresetRoster> {
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

/** 写预设（整表覆盖；名字去重，后者覆盖前者）。保持不变：编辑器按对象保存，未知字段由界面负责保留。 */
export async function writePresets(projectPath: string, presets: AgentPreset[]): Promise<void> {
  const byName = new Map<string, AgentPreset>()
  for (const p of presets) {
    const name = String(p.name ?? '').trim()
    if (!name || name.length > PRESET_NAME_MAX) continue
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
