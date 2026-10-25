// src/main/services/ai/presetUndo.ts
//
// **预设导入的撤销点：读写与撤销**（2026-10-26，第 54 批）。
//
// 边界：这个文件只管 `.qqbat/agent-presets.undo.json` 与"把 presets 文件恢复成导入前
// 的字节"。导入流程本身在 `presetShare.ts`；写 presets 的通道仍是 `presets.ts` 的
// writePresets（这里不碰它，也不把备份塞进它 —— 那会让每次保存都变成一个撤销点）。
//
// 几条刻意的选择：
//   · 备份存**原始字节**（base64 + sha256），撤销按字节写回。用文本读再写会把 BOM、
//     非法字节、换行风格改掉，"恢复"出来的就不再是用户原来那份文件；
//   · 撤销前先比当前文件哈希与记录里的 afterSha256：导入之后用户又改过预设，就拒绝。
//     宁可撤销不了，也不能拿旧备份覆盖掉用户后来的改动；
//   · 记录只留一级：下一次成功导入覆盖它。撤销语义永远是"上一次导入"，不是历史回滚；
//   · 坏记录不自动删（用户可能留着查证据）；下一次成功导入会把它盖掉。
import { createHash } from 'node:crypto'
import { readFile, rm } from 'fs/promises'
import { join } from 'node:path'
import {
  PRESET_UNDO_FILE,
  PRESET_UNDO_VERSION,
  type PresetUndoRecord,
  type PresetUndoResult,
  type PresetUndoState,
} from '@shared/ai/presetUndo'
import { PRESETS_BASENAME } from '@shared/ai/presetRoster'
import { atomicWrite } from '../infra/fileOps'

/** 导入前 presets 文件的完整备份；capture 与 write 之间由 importPresetShare 串起来 */
export interface PresetUndoCapture {
  previousExisted: boolean
  previousSha256: string | null
  previousBase64: string | null
}

const HEX64 = /^[0-9a-f]{64}$/

function presetsPath(projectPath: string): string {
  return join(projectPath, '.qqbat', PRESETS_BASENAME)
}

function undoPath(projectPath: string): string {
  // PRESET_UNDO_FILE 已经带 `.qqbat/` 前缀
  return join(projectPath, PRESET_UNDO_FILE)
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 读原始字节；文件不存在返回 null，其他错误照常抛（磁盘故障不该被当成"没有备份"） */
async function readRawOrNull(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

type LoadedRecord =
  | { kind: 'missing' }
  | { kind: 'ok'; record: PresetUndoRecord }
  | { kind: 'corrupt'; reason: string }

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value)
}

/**
 * 校验盘上的记录。
 *
 * 这里刻意不"尽量修"：字段不对就是坏记录，撤销时拒绝并说明原因。撤销点是从旧版本
 * 写下的东西，也可能被手改过 —— 拿一个半信半疑的记录去覆盖预设文件，风险全落在
 * 用户身上。
 */
function parseRecord(
  raw: Buffer,
): { kind: 'ok'; record: PresetUndoRecord } | { kind: 'corrupt'; reason: string } {
  let value: unknown
  try {
    value = JSON.parse(raw.toString('utf-8'))
  } catch {
    return { kind: 'corrupt', reason: '不是合法 JSON' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'corrupt', reason: '顶层不是对象' }
  }
  const row = value as Record<string, unknown>
  if (row['version'] !== PRESET_UNDO_VERSION) {
    return { kind: 'corrupt', reason: '版本不认识（' + String(row['version']) + '）' }
  }
  if (row['action'] !== 'import') {
    return { kind: 'corrupt', reason: 'action 不是 import' }
  }
  const createdAt = row['createdAt']
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    return { kind: 'corrupt', reason: 'createdAt 不合法' }
  }
  const previousExisted = row['previousExisted']
  if (typeof previousExisted !== 'boolean') {
    return { kind: 'corrupt', reason: 'previousExisted 不合法' }
  }
  if (!isHex64(row['afterSha256'])) {
    return { kind: 'corrupt', reason: 'afterSha256 不合法' }
  }
  const afterSha256 = row['afterSha256']
  const added = row['added']
  const replaced = row['replaced']
  const total = row['total']
  if (!isNonNegInt(added) || !isNonNegInt(replaced) || !isNonNegInt(total)) {
    return { kind: 'corrupt', reason: 'added/replaced/total 不合法' }
  }
  if (total < added + replaced) {
    return { kind: 'corrupt', reason: 'total 小于 added+replaced' }
  }
  const sourceName = row['sourceName']
  if (sourceName !== undefined && typeof sourceName !== 'string') {
    return { kind: 'corrupt', reason: 'sourceName 不合法' }
  }
  let previousSha256: string | null = null
  let previousBase64: string | null = null
  if (previousExisted) {
    if (!isHex64(row['previousSha256'])) {
      return { kind: 'corrupt', reason: 'previousSha256 不合法' }
    }
    const base64 = row['previousBase64']
    if (typeof base64 !== 'string' || base64.length === 0) {
      return { kind: 'corrupt', reason: 'previousBase64 不合法' }
    }
    previousSha256 = row['previousSha256']
    previousBase64 = base64
  } else if (row['previousSha256'] !== null || row['previousBase64'] !== null) {
    return { kind: 'corrupt', reason: '导入前文件不存在，previous 字段应该是 null' }
  }
  return {
    kind: 'ok',
    record: {
      version: 1,
      createdAt,
      action: 'import',
      ...(sourceName !== undefined ? { sourceName } : {}),
      previousExisted,
      previousSha256,
      previousBase64,
      afterSha256,
      added,
      replaced,
      total,
    },
  }
}

async function loadRecord(projectPath: string): Promise<LoadedRecord> {
  const raw = await readRawOrNull(undoPath(projectPath))
  if (!raw) return { kind: 'missing' }
  return parseRecord(raw)
}

function toState(record: PresetUndoRecord): PresetUndoState {
  return {
    available: true,
    createdAt: record.createdAt,
    ...(record.sourceName ? { sourceName: record.sourceName } : {}),
    added: record.added,
    replaced: record.replaced,
    total: record.total,
    previousExisted: record.previousExisted,
  }
}

/**
 * 在写 presets **之前**调用：读旧字节。
 *
 * 读失败直接抛 —— 宁可不导入，也不做一次没有备份的写。文件不存在是正常情况
 *（第一次导入），撤销时据此删除文件而不是写回空内容。
 */
export async function capturePresetUndo(projectPath: string): Promise<PresetUndoCapture> {
  const previous = await readRawOrNull(presetsPath(projectPath))
  if (!previous) {
    return { previousExisted: false, previousSha256: null, previousBase64: null }
  }
  return {
    previousExisted: true,
    previousSha256: sha256Hex(previous),
    previousBase64: previous.toString('base64'),
  }
}

/**
 * 在写 presets **之后**调用：落撤销点。
 *
 * 原子写，记录连同 afterSha256（= 当前文件哈希）。写失败是**导入已成功**之后的事，
 * 由调用方决定怎么提示；这里只负责把错误抛出去。
 */
export async function writePresetUndoPoint(
  projectPath: string,
  capture: PresetUndoCapture,
  meta: { sourceName?: string; added: number; replaced: number; total: number },
): Promise<PresetUndoState> {
  const current = await readRawOrNull(presetsPath(projectPath))
  if (!current) throw new Error('撤销点写入失败：导入后的预设文件不存在')
  const record: PresetUndoRecord = {
    version: 1,
    createdAt: new Date().toISOString(),
    action: 'import',
    ...(meta.sourceName ? { sourceName: meta.sourceName } : {}),
    previousExisted: capture.previousExisted,
    previousSha256: capture.previousSha256,
    previousBase64: capture.previousBase64,
    afterSha256: sha256Hex(current),
    added: meta.added,
    replaced: meta.replaced,
    total: meta.total,
  }
  await atomicWrite(undoPath(projectPath), JSON.stringify(record, null, 2) + '\n')
  return toState(record)
}

/**
 * 给界面的只读状态（预设菜单在每个项目上都会问一次，所以必须容忍一切坏文件）。
 *
 * 除了记录本身坏，还要能识别"记录过时"：当前 presets 的哈希已经不等于导入完成时的
 * 哈希 ⇒ 导入之后被改过 ⇒ 不亮撤销按钮（不给一个点了才报错的入口）。
 */
export async function readPresetUndo(projectPath: string): Promise<PresetUndoState> {
  const loaded = await loadRecord(projectPath)
  if (loaded.kind === 'missing') return { available: false }
  if (loaded.kind === 'corrupt') {
    return { available: false, problem: '撤销点读不出来：' + loaded.reason }
  }
  const current = await readRawOrNull(presetsPath(projectPath))
  const currentSha = current ? sha256Hex(current) : null
  if (currentSha !== loaded.record.afterSha256) {
    return { available: false, problem: '导入之后预设文件又被改过，撤销已失效' }
  }
  return toState(loaded.record)
}

/**
 * 撤销一次导入：核当前文件 → 核备份 → 写回/删除 → 复核 → 删撤销点。
 *
 * 任何一步对不上都抛错且**不写盘**。写回用 atomicWrite；导入前文件本不存在时删文件。
 * 复核是必要的：Windows 上文件可能被别的程序占用/杀软拦截，atomicWrite 成功不代表
 * 落盘内容就是我们要的。
 */
export async function undoPresetImport(projectPath: string): Promise<PresetUndoResult> {
  const loaded = await loadRecord(projectPath)
  if (loaded.kind === 'missing') {
    throw new Error('没有可撤销的导入（只保留最近一次，而且导入后又改过预设会失效）')
  }
  if (loaded.kind === 'corrupt') {
    throw new Error('撤销点读不出来：' + loaded.reason + '；为免写坏预设，这次没有撤销')
  }
  const record = loaded.record
  const target = presetsPath(projectPath)
  const current = await readRawOrNull(target)
  const currentSha = current ? sha256Hex(current) : null
  if (currentSha !== record.afterSha256) {
    throw new Error(
      '导入之后预设文件又被改过（当前 sha256 ' +
        String(currentSha) +
        '，导入完成时 ' +
        record.afterSha256 +
        '）；为免覆盖你后来的改动，这次没有撤销',
    )
  }
  let previous: Buffer | null = null
  if (record.previousExisted) {
    previous = Buffer.from(record.previousBase64 ?? '', 'base64')
    if (sha256Hex(previous) !== record.previousSha256) {
      throw new Error('撤销点里的备份损坏（sha256 对不上）；为免写坏预设，这次没有撤销')
    }
  }
  if (previous) {
    await atomicWrite(target, previous)
  } else {
    await rm(target, { force: true })
  }
  const after = await readRawOrNull(target)
  const afterSha = after ? sha256Hex(after) : null
  const wantSha = previous ? sha256Hex(previous) : null
  if (afterSha !== wantSha) {
    throw new Error('撤销写入后校验失败；文件可能被其他程序占用，请重试')
  }
  // 删记录失败不回滚（文件已经恢复）；下一次 readPresetUndo 会因哈希不符把它标成不可用
  await clearPresetUndo(projectPath).catch(() => {})
  return {
    restored: true,
    removed: !previous,
    createdAt: record.createdAt,
    added: record.added,
    replaced: record.replaced,
    total: record.total,
  }
}

/** 删除撤销点（下一次导入前清旧点、撤销成功后清、撤销点写失败时尽力清） */
export async function clearPresetUndo(projectPath: string): Promise<void> {
  await rm(undoPath(projectPath), { force: true })
}
