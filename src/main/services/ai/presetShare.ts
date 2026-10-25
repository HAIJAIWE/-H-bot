// src/main/services/ai/presetShare.ts
//
// **预设导入导出**（2026-10-26，第 53 批）。
//
// 这个文件只做两件事：把项目里的自定义预设收成一份可交换 JSON；把别人给的文件
// 先**完整校验**再合并。所有拒绝都发生在写盘之前 —— 导入失败时项目里的预设文件
// 一个字节都不该动。
//
// 为什么导入要这么严：
//   · 预设里的 allowedTools / permissionMode 是权限边界，不是普通配置；
//   · 导出文件可能被手改过，未知字段（例如以后新增的字段）如果静默 strip，
//     用户会以为导入成功，实际少了一部分声明；
//   · 当前项目自己的文件如果有坏条目/被忽略的字段，整次导入拒绝 —— 否则
//     "导入"会顺手把现有文件重写成只有解析结果的样子，等于静默清理。
import {
  PRESET_SHARE_MAX_BYTES,
  PRESET_SHARE_MAX_PRESETS,
  PRESET_SHARE_TYPE,
  PRESET_SHARE_VERSION,
  type PresetImportResult,
  type PresetSharePreview,
} from '@shared/ai/presetShare'
import type { AgentPreset, AgentPresetRow } from '@shared/ai/presetRoster'
import type { PresetUndoState } from '@shared/ai/presetUndo'
import { parsePresetRoster, readPresetRoster, serializePresets, writePresets } from './presets'
import { capturePresetUndo, clearPresetUndo, writePresetUndoPoint } from './presetUndo'

/** AgentPreset 允许出现在分享文件里的键；顺序只用于错误提示，不参与解析 */
const PRESET_KEYS = [
  'name',
  'role',
  'prompt',
  'permissionMode',
  'allowedTools',
  'plugins',
  'description',
  'order',
] as const
const PRESET_KEY_SET = new Set<string>(PRESET_KEYS)

/** 把注册表行剥回盘上声明：broken/notes/builtin/isDefault 都是主进程内部状态 */
function toDeclaredPreset(row: AgentPresetRow): AgentPreset {
  const out: AgentPreset = { name: row.name }
  if (row.role !== undefined) out.role = row.role
  if (row.prompt !== undefined) out.prompt = row.prompt
  if (row.permissionMode !== undefined) out.permissionMode = row.permissionMode
  if (row.allowedTools !== undefined) out.allowedTools = [...row.allowedTools]
  if (row.plugins !== undefined) out.plugins = [...row.plugins]
  if (row.description !== undefined) out.description = row.description
  if (row.order !== undefined) out.order = row.order
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function entryLabel(index: number): string {
  return '第 ' + (index + 1) + ' 条'
}

/** 当前项目的用户预设行（不含内置）；文件级问题/坏条目/被忽略字段一律拒绝 */
async function readExistingForImport(projectPath: string): Promise<AgentPresetRow[]> {
  const roster = await readPresetRoster(projectPath)
  if (roster.fileProblem) {
    throw new Error('当前预设文件读不了：' + roster.fileProblem + '；先修好再导入')
  }
  const userRows = roster.presets.filter(row => !row.builtin)
  const broken = userRows.filter(row => row.broken)
  if (broken.length > 0) {
    const detail = broken.map(row => row.name + '：' + row.broken).join('；')
    throw new Error('当前预设文件里有不可用的条目（' + detail + '）；先在菜单里修好再导入')
  }
  const noted = userRows.filter(row => row.notes && row.notes.length > 0)
  if (noted.length > 0) {
    const detail = noted.map(row => row.name + '：' + (row.notes ?? []).join('、')).join('；')
    throw new Error(
      '当前预设文件里有字段没生效（' + detail + '）；导入会按生效后的值重写，先修好再导入',
    )
  }
  return userRows
}

/**
 * 解析并校验分享文件。成功返回声明列表；任何不放心的地方都直接抛错。
 */
export async function parsePresetShareText(
  text: string,
): Promise<{ exportedAt?: string; presets: AgentPreset[] }> {
  if (!text.trim()) throw new Error('分享文件是空的')
  if (Buffer.byteLength(text, 'utf8') > PRESET_SHARE_MAX_BYTES) {
    throw new Error('分享文件太大（上限 ' + Math.round(PRESET_SHARE_MAX_BYTES / 1024) + ' KB）')
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error('分享文件不是合法 JSON：' + (e instanceof Error ? e.message : String(e)))
  }
  if (!isRecord(data)) {
    throw new Error('分享文件顶层应该是对象（{ type, version, presets }）')
  }
  if (data.type !== PRESET_SHARE_TYPE) {
    throw new Error('这不是 qqbat 的预设分享文件（type 应该是 ' + PRESET_SHARE_TYPE + '）')
  }
  if (data.version !== PRESET_SHARE_VERSION) {
    throw new Error(
      '分享文件版本不认识：' +
        String(data.version) +
        '（这个版本只认 ' +
        PRESET_SHARE_VERSION +
        '）',
    )
  }
  if (!Array.isArray(data.presets)) {
    throw new Error('分享文件里的 presets 应该是数组')
  }
  if (data.presets.length === 0) {
    throw new Error('分享文件里没有预设')
  }
  if (data.presets.length > PRESET_SHARE_MAX_PRESETS) {
    throw new Error('一条分享文件最多 ' + PRESET_SHARE_MAX_PRESETS + ' 条预设')
  }
  data.presets.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new Error(entryLabel(index) + '不是对象')
    }
    const unknown = Object.keys(item).filter(key => !PRESET_KEY_SET.has(key))
    if (unknown.length > 0) {
      throw new Error(
        entryLabel(index) + '有未知字段：' + unknown.join('、') + '（分享文件不允许夹带）',
      )
    }
  })

  const roster = parsePresetRoster(data.presets)
  if (roster.fileProblem) {
    throw new Error('分享文件的预设表读不了：' + roster.fileProblem)
  }
  const broken = roster.presets.filter(row => row.broken)
  if (broken.length > 0) {
    const detail = broken.map(row => row.name + '：' + row.broken).join('；')
    throw new Error('分享文件里有不可用的条目（' + detail + '）')
  }
  const noted = roster.presets.filter(row => row.notes && row.notes.length > 0)
  if (noted.length > 0) {
    const detail = noted.map(row => row.name + '：' + (row.notes ?? []).join('、')).join('；')
    throw new Error(
      '分享文件里有字段没生效（' + detail + '）；导入不会静默改字段，请在源文件里改正再导出',
    )
  }
  return {
    ...(typeof data.exportedAt === 'string' && data.exportedAt.trim()
      ? { exportedAt: data.exportedAt.trim() }
      : {}),
    presets: roster.presets.map(toDeclaredPreset),
  }
}

/**
 * 导出当前项目的自定义预设。内置不导出；坏条目/坏文件先拒绝。
 * 有 notes 的条目仍可导出（导的是生效后的值），但会以 warnings 返回给界面。
 */
export async function buildPresetShare(projectPath: string): Promise<{
  text: string
  count: number
  warnings: string[]
}> {
  const roster = await readPresetRoster(projectPath)
  if (roster.fileProblem) {
    throw new Error('预设文件读不了：' + roster.fileProblem + '；先修好再导出')
  }
  const userRows = roster.presets.filter(row => !row.builtin)
  const broken = userRows.filter(row => row.broken)
  if (broken.length > 0) {
    const detail = broken.map(row => row.name + '：' + row.broken).join('；')
    throw new Error('预设文件里有不可用的条目（' + detail + '）；先在菜单里修好再导出')
  }
  if (userRows.length === 0) {
    throw new Error('这个项目还没有可导出的自定义预设（内置预设随程序发布，不需要导出）')
  }
  const warnings = userRows.flatMap(row =>
    (row.notes ?? []).map(note => '「' + row.name + '」：' + note),
  )
  const presets = userRows.map(toDeclaredPreset)
  const text =
    JSON.stringify(
      {
        type: PRESET_SHARE_TYPE,
        version: PRESET_SHARE_VERSION,
        exportedAt: new Date().toISOString(),
        presets,
      },
      null,
      2,
    ) + '\n'
  return { text, count: presets.length, warnings }
}

/** 预览导入：只读，不写盘；冲突名字由调用方决定要不要覆盖 */
export async function previewPresetImport(
  projectPath: string,
  text: string,
): Promise<PresetSharePreview> {
  const share = await parsePresetShareText(text)
  const userRows = await readExistingForImport(projectPath)
  const existingNames = new Set(userRows.map(row => row.name))
  const conflicts = share.presets.map(preset => preset.name).filter(name => existingNames.has(name))
  return {
    ...(share.exportedAt ? { exportedAt: share.exportedAt } : {}),
    presets: share.presets,
    conflicts,
    existingCount: userRows.length,
  }
}

/**
 * 真正导入：解析 → 读现有 → 冲突检查 → 整表重写 → 留撤销点。
 *
 * overwrite=false 时只要有同名项就整次拒绝（不是"跳过冲突项"）——
 * 半份导入最难解释：用户以为全进来了，实际少了几条。
 *
 * 第 54 批起每次"真的有变化"的导入都留一个撤销点（第 4 参 sourceName 只用于界面展示）。
 * 顺序是 capture → 写 presets → 写撤销点：撤销点写失败不影响导入成功，只是界面会
 * 收到 undoProblem；没有变化时一个字节都不写，旧撤销点也不动。
 */
export async function importPresetShare(
  projectPath: string,
  text: string,
  overwrite: boolean,
  sourceName?: string,
): Promise<PresetImportResult> {
  const share = await parsePresetShareText(text)
  const userRows = await readExistingForImport(projectPath)
  const byName = new Map<string, AgentPreset>(
    userRows.map(row => [row.name, toDeclaredPreset(row)]),
  )
  const conflicts = share.presets.map(preset => preset.name).filter(name => byName.has(name))
  if (conflicts.length > 0 && !overwrite) {
    throw new Error(
      '有 ' +
        conflicts.length +
        ' 个同名预设：' +
        conflicts.join('、') +
        '；要么改名，要么勾选「覆盖同名项」',
    )
  }
  let added = 0
  let replaced = 0
  for (const preset of share.presets) {
    if (byName.has(preset.name)) replaced += 1
    else added += 1
    byName.set(preset.name, preset)
  }
  const total = byName.size
  if (added === 0 && replaced === 0) {
    return { added: 0, replaced: 0, total, unchanged: true }
  }
  const capture = await capturePresetUndo(projectPath)
  // 同名但内容完全相同（把同一份分享文件再导一次）也算"没有实际变化"：写盘结果与旧文件
  // 逐字节一样，若照常换撤销点，用户会失去"回到第一次导入之前"的能力。这里先预测
  // writePresets 会写出什么，确认真的变了才写。
  const nextBytes = Buffer.from(serializePresets([...byName.values()]), 'utf-8')
  const previousBytes = capture.previousBase64
    ? Buffer.from(capture.previousBase64, 'base64')
    : null
  if (previousBytes && previousBytes.equals(nextBytes)) {
    return { added: 0, replaced: 0, total, unchanged: true }
  }
  await writePresets(projectPath, [...byName.values()])
  let undo: PresetUndoState | undefined
  let undoProblem: string | undefined
  try {
    undo = await writePresetUndoPoint(projectPath, capture, {
      ...(sourceName ? { sourceName } : {}),
      added,
      replaced,
      total,
    })
  } catch (e) {
    undoProblem = e instanceof Error ? e.message : String(e)
    // 旧撤销点指向的是更早的状态，留着比没有更危险：清掉，让"没有可撤销的导入"成为真相
    await clearPresetUndo(projectPath).catch(() => {})
  }
  return {
    added,
    replaced,
    total,
    unchanged: false,
    ...(undo ? { undo } : {}),
    ...(undoProblem ? { undoProblem } : {}),
  }
}
