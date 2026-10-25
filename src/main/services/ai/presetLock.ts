// src/main/services/ai/presetLock.ts
//
// **线程级预设锁**（2026-10-26，第 50 批）。
//
// 对齐 DSH 的 agent-preset/locked：会话一旦开始（有过一轮），权限组合固定，不能再换；
// 空白会话可以换，而且选择要落盘。区别只在粒度 —— DSH 按 session 锁，我们按 thread 锁
// （同一个项目可以开多条互不影响的对话）。
//
// 记录放在**线程记忆文件旁边**（<threadFile>.preset.json），不另建目录：
//  · default 线程 = .qqbat/ai-history.jsonl.preset.json；
//  · 其它线程 = .qqbat/ai-history/<id>.jsonl.preset.json。
// 这样"清空线程"能把记忆与锁一起处理，也不会与线程 id 的路径收敛逻辑抄成两份。
//
// 三种状态，不许含糊：
//  · 空白线程 → 可以换；这一轮按传入值开跑并落盘；
//  · 已开始 + 有记录 → 只认记录；传入不同名直接 fail-closed；
//  · 已开始 + 没记录（第 48 批之前的老会话）→ 按 null（跟页面）锁住，
//    显式换预设也拒绝 —— 不能因为"以前没记过"就静默换掉权限组合。
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWrite } from '../infra/fileOps'
import { threadFile } from './threads'
import { loadHistory } from './historyStore'
import type { PresetSessionState } from '@shared/ai/presetRoster'

/** 锁文件名 = 记忆文件名 + 这个后缀；由 threadFile 统一收敛路径 */
const LOCK_SUFFIX = '.preset.json'

export interface PresetDecision {
  /** 这一轮实际生效的预设名；null = 跟页面 */
  preset: string | null
  /** 空白线程：调用方在预设解析成功后再落盘（解析失败不许写） */
  persist: boolean
}

type PresetRecord =
  { kind: 'ok'; preset: string | null } | { kind: 'missing' } | { kind: 'corrupt'; reason: string }

/** 某条线程的锁文件路径。固定规则拼出，不接用户输入。 */
export function presetLockFile(projectPath: string, threadId: string): string {
  return threadFile(projectPath, threadId) + LOCK_SUFFIX
}

/** 读锁文件。缺失不等于坏：老会话就是缺失，按 null 锁；坏文件必须说出来。 */
async function readRecord(file: string): Promise<PresetRecord> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'corrupt', reason: e instanceof Error ? e.message : String(e) }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'corrupt', reason: '顶层不是对象' }
    }
    const preset = (parsed as { preset?: unknown }).preset
    if (preset === null) return { kind: 'ok', preset: null }
    if (typeof preset === 'string' && preset.trim()) {
      return { kind: 'ok', preset: preset.trim() }
    }
    return { kind: 'corrupt', reason: 'preset 字段既不是非空名字也不是 null' }
  } catch {
    return { kind: 'corrupt', reason: '不是合法 JSON' }
  }
}

/** 写下一轮的选择（空白线程开跑前调；路径固定、原子写）。 */
export async function writePresetSession(
  projectPath: string,
  threadId: string,
  preset: string | null,
): Promise<void> {
  const file = presetLockFile(projectPath, threadId)
  // 新线程的 .qqbat/ai-history/ 可能还不存在（第一条消息才会建）；先建目录，
  // 否则"先落锁再跑第一轮"会在空白线程上直接失败。
  await mkdir(dirname(file), { recursive: true })
  const body = JSON.stringify({ preset: preset }, null, 2) + '\n'
  await atomicWrite(file, body)
}

/** 清空线程时一并删锁；不存在不算失败。 */
export async function clearPresetSession(projectPath: string, threadId: string): Promise<void> {
  await rm(presetLockFile(projectPath, threadId), { force: true })
}

/**
 * 这一轮该用哪个预设。
 *
 * @param hasHistory 线程是否已有记忆（调用方已经读过记忆，不再重复读盘）
 * @param requested 界面这一轮传来的预设名；null = 没指定
 */
export async function decideSessionPreset(
  projectPath: string,
  threadId: string,
  hasHistory: boolean,
  requested: string | null,
): Promise<{ ok: true; decision: PresetDecision } | { ok: false; error: string }> {
  const record = await readRecord(presetLockFile(projectPath, threadId))
  // 空白线程：传什么就是什么；旧锁（包括坏文件）会在本轮开跑后覆盖。
  if (!hasHistory) return { ok: true, decision: { preset: requested, persist: true } }
  if (record.kind === 'corrupt') {
    return {
      ok: false,
      error:
        '这个会话的预设记录读不出来（' +
        record.reason +
        '）。为了不悄悄换掉权限组合，这一轮没有开始；先清空这个会话再选预设。',
    }
  }
  const stored = record.kind === 'ok' ? record.preset : null
  const storedLabel = stored ?? '跟页面'
  if (requested !== null && requested !== stored) {
    return {
      ok: false,
      error:
        '这个会话已经以预设「' +
        storedLabel +
        '」开始，不能再换成「' +
        requested +
        '」。要换预设，先清空这个会话。',
    }
  }
  return { ok: true, decision: { preset: requested ?? stored, persist: false } }
}

/**
 * 给界面看的状态（不写盘）。
 *
 * started 由记忆条数决定，与运行时同一判据；空白线程哪怕留着旧锁也显示"可换"。
 */
export async function readPresetSession(
  projectPath: string,
  threadId: string,
): Promise<PresetSessionState> {
  const entries = await loadHistory(projectPath, threadFile(projectPath, threadId))
  const started = entries.length > 0
  if (!started) return { started: false, preset: null, locked: false }
  const record = await readRecord(presetLockFile(projectPath, threadId))
  if (record.kind === 'ok') return { started: true, preset: record.preset, locked: true }
  if (record.kind === 'corrupt') {
    return { started: true, preset: null, locked: true, problem: record.reason }
  }
  // 老会话（第 48 批之前）没有记录：按 null 锁，界面要说明"要换先清空"
  return { started: true, preset: null, locked: true }
}
