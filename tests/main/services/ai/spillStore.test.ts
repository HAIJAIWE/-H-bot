import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// 适配层：位置约定（<项目>/.qqbat/ai-spill）、fail-open、过期清扫。
// 落盘/清扫算法本身在 vendor 里，见 tests/main/vendor/spill-local.test.ts。

const h = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@main/services/infra/logger', () => ({
  logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() },
}))

import { saveSpillText, sweepProjectSpill } from '@main/services/ai/spillStore'

const DAY = 24 * 60 * 60 * 1000
let base = ''
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'qqbat-spill-adapter-'))
})
afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('saveSpillText：跟项目走 + fail-open', () => {
  it('★ 落到 <项目>/.qqbat/ai-spill/session-<hash>/ 下，返回可读路径', async () => {
    const project = join(base, 'p1')
    await mkdir(project, { recursive: true })
    const path = await saveSpillText(project, 'run_command', '完整输出'.repeat(50))
    expect(path).toBeTruthy()
    expect(path!.startsWith(join(project, '.qqbat', 'ai-spill'))).toBe(true)
    expect(await readFile(path!, 'utf8')).toBe('完整输出'.repeat(50))
    const [session] = await readdir(join(project, '.qqbat', 'ai-spill'))
    expect(session).toMatch(/^session-[0-9a-f]{12}$/)
  })

  it('没有项目 / 没有正文时直接返回 undefined，一个目录都不建', async () => {
    const project = join(base, 'p2')
    await mkdir(project, { recursive: true })
    expect(await saveSpillText('', 'read_file', 'x')).toBeUndefined()
    expect(await saveSpillText(project, 'read_file', '')).toBeUndefined()
    expect(await exists(join(project, '.qqbat'))).toBe(false)
  })

  it('写不进去（.qqbat 被一个同名文件占住）→ 警告一次、返回 undefined，绝不抛', async () => {
    const project = join(base, 'p3')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, '.qqbat'), 'not a dir', 'utf8')
    h.warn.mockClear()
    await expect(saveSpillText(project, 'run_command', 'x')).resolves.toBeUndefined()
    expect(h.warn).toHaveBeenCalledTimes(1)
    expect(String(h.warn.mock.calls[0]?.[0])).toContain('溢出入库失败')
  })
})

describe('sweepProjectSpill：过期才删、根目录永远保留', () => {
  it('★ 30 天前的删掉、刚写的保留；只剩过期文件的会话目录被删掉，ai-spill 根还在', async () => {
    const project = join(base, 'p4')
    await mkdir(project, { recursive: true })
    const old = await saveSpillText(project, 'run_command', 'old')
    const oldDate = new Date(Date.now() - 30 * DAY)
    await utimes(old!, oldDate, oldDate)
    const fresh = await saveSpillText(project, 'read_file', 'new')

    await sweepProjectSpill(project)

    expect(await exists(old!)).toBe(false)
    expect(await exists(fresh!)).toBe(true)
    expect(await exists(join(project, '.qqbat', 'ai-spill'))).toBe(true)
  })

  it('会话目录清空后被删掉（下次写盘会重建）', async () => {
    const project = join(base, 'p5')
    await mkdir(project, { recursive: true })
    const only = await saveSpillText(project, 'search_text', 'only')
    const oldDate = new Date(Date.now() - 30 * DAY)
    await utimes(only!, oldDate, oldDate)

    await sweepProjectSpill(project)

    expect(await exists(dirname(only!))).toBe(false)
    expect(await exists(join(project, '.qqbat', 'ai-spill'))).toBe(true)
    // 会话目录没了也能继续写：saveTextFile 遇 ENOENT 会重建
    const again = await saveSpillText(project, 'search_text', 'again')
    expect(await readFile(again!, 'utf8')).toBe('again')
  })

  it('项目目录都不存在时静默返回（清扫永不影响业务）', async () => {
    await expect(sweepProjectSpill(join(base, 'missing'))).resolves.toBeUndefined()
    await expect(sweepProjectSpill('')).resolves.toBeUndefined()
  })
})
