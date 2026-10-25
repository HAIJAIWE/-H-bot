// tests/main/services/ai/presetLock.test.ts
//
// 第 50 批：线程级预设锁（对齐 DSH agent-preset/locked）。
// 语义只有三条：空白线程可换并落盘；开始过的线程只认记录；记录坏了 fail-closed。
import { describe, it, expect } from 'vitest'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  clearPresetSession,
  decideSessionPreset,
  presetLockFile,
  readPresetSession,
  writePresetSession,
} from '@main/services/ai/presetLock'
import { threadFile } from '@main/services/ai/threads'

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-preset-lock-'))
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  return dir
}

async function withHistory(dir: string, threadId = 'default'): Promise<void> {
  const file = threadFile(dir, threadId)
  await mkdir(dirname(file), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), role: 'user', content: 'hi' })
  await writeFile(file, line + '\n', 'utf-8')
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

describe('★ 线程级预设锁', () => {
  it('锁文件就在记忆文件旁边（default 与普通线程同一规则）', async () => {
    const dir = await project()
    expect(presetLockFile(dir, 'default')).toBe(threadFile(dir, 'default') + '.preset.json')
    expect(presetLockFile(dir, 't-abc')).toBe(threadFile(dir, 't-abc') + '.preset.json')
  })

  it('★ 空白线程：传什么就是什么，而且要求落盘', async () => {
    const dir = await project()
    const decided = await decideSessionPreset(dir, 'default', false, '只读巡检')
    expect(decided).toEqual({ ok: true, decision: { preset: '只读巡检', persist: true } })
    await writePresetSession(dir, 'default', '只读巡检')
    // 还没历史：仍然算"可换"（哪怕盘上已经有锁）
    expect(await readPresetSession(dir, 'default')).toEqual({
      started: false,
      preset: null,
      locked: false,
    })
  })

  it('★ 空白线程不传预设也要落盘 null：明确"跟页面"，不是"还没决定"', async () => {
    const dir = await project()
    const decided = await decideSessionPreset(dir, 'default', false, null)
    expect(decided).toEqual({ ok: true, decision: { preset: null, persist: true } })
    await writePresetSession(dir, 'default', null)
    expect(JSON.parse(await readFile(presetLockFile(dir, 'default'), 'utf8'))).toEqual({
      preset: null,
    })
  })

  it('★ 开始过的线程：同值放行、不一致拒绝（错误里要有两个名字）', async () => {
    const dir = await project()
    await withHistory(dir)
    await writePresetSession(dir, 'default', '只读巡检')
    await expect(decideSessionPreset(dir, 'default', true, '只读巡检')).resolves.toEqual({
      ok: true,
      decision: { preset: '只读巡检', persist: false },
    })
    const denied = await decideSessionPreset(dir, 'default', true, '全放行')
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.error).toContain('已经以预设「只读巡检」开始')
      expect(denied.error).toContain('全放行')
      expect(denied.error).toContain('先清空')
    }
  })

  it('★ 开始过的线程：界面不传 preset 时沿用锁里的值（少传一个字段不能悄悄放开）', async () => {
    const dir = await project()
    await withHistory(dir)
    await writePresetSession(dir, 'default', '只读巡检')
    expect(await decideSessionPreset(dir, 'default', true, null)).toEqual({
      ok: true,
      decision: { preset: '只读巡检', persist: false },
    })
  })

  it('★ 老会话没有锁记录：按 null 锁；显式换预设直接拒绝', async () => {
    const dir = await project()
    await withHistory(dir)
    const state = await readPresetSession(dir, 'default')
    expect(state).toEqual({ started: true, preset: null, locked: true })
    expect(await decideSessionPreset(dir, 'default', true, null)).toEqual({
      ok: true,
      decision: { preset: null, persist: false },
    })
    const denied = await decideSessionPreset(dir, 'default', true, '只读巡检')
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toContain('「跟页面」开始')
  })

  it('★ 锁文件坏了：fail-closed，不猜也不静默放开', async () => {
    const dir = await project()
    await withHistory(dir)
    await writeFile(presetLockFile(dir, 'default'), '{oops', 'utf-8')
    const denied = await decideSessionPreset(dir, 'default', true, null)
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.error).toContain('预设记录读不出来')
      expect(denied.error).toContain('这一轮没有开始')
    }
    expect(await readPresetSession(dir, 'default')).toMatchObject({
      started: true,
      locked: true,
      problem: '不是合法 JSON',
    })
  })

  it('空白线程可以直接覆盖坏锁（没有已生效的权限组合要保护）', async () => {
    const dir = await project()
    await writeFile(presetLockFile(dir, 'default'), '{oops', 'utf-8')
    expect(await decideSessionPreset(dir, 'default', false, '全放行')).toEqual({
      ok: true,
      decision: { preset: '全放行', persist: true },
    })
  })

  it('★ 清空线程时锁也删掉（否则清空后还是换不了）', async () => {
    const dir = await project()
    await writePresetSession(dir, 'default', '只读巡检')
    expect(await exists(presetLockFile(dir, 'default'))).toBe(true)
    await clearPresetSession(dir, 'default')
    expect(await exists(presetLockFile(dir, 'default'))).toBe(false)
    // 再清一次也不抛
    await expect(clearPresetSession(dir, 'default')).resolves.toBeUndefined()
  })
})
