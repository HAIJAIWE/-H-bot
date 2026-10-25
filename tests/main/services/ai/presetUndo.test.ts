// tests/main/services/ai/presetUndo.test.ts
//
// 第 54 批：导入撤销点的读写与撤销。
//
// 这里最在乎的不是"能撤销"，而是"什么时候必须拒绝撤销"：撤销会覆盖用户文件，
// 宁可撤销不了，也不能覆盖掉导入之后的改动。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({ failAtomicWrite: null as Error | null }))

// 只给"撤销点落盘"制造失败，其余调用照旧走真实实现（撤销流程本身要用 atomicWrite）
vi.mock('@main/services/infra/fileOps', async importOriginal => {
  const actual = await importOriginal<typeof import('@main/services/infra/fileOps')>()
  return {
    ...actual,
    atomicWrite: async (filePath: string, content: string | Buffer) => {
      if (h.failAtomicWrite) throw h.failAtomicWrite
      return actual.atomicWrite(filePath, content)
    },
  }
})

import { importPresetShare } from '@main/services/ai/presetShare'
import {
  capturePresetUndo,
  readPresetUndo,
  undoPresetImport,
  writePresetUndoPoint,
} from '@main/services/ai/presetUndo'
import { PRESET_SHARE_TYPE, PRESET_SHARE_VERSION } from '@shared/ai/presetShare'

const PRESETS_FILE = join('.qqbat', 'agent-presets.json')
const UNDO_FILE = join('.qqbat', 'agent-presets.undo.json')

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'qqbat-preset-undo-'))
}

async function writeRaw(dir: string, raw: string): Promise<void> {
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  await writeFile(join(dir, '.qqbat', 'agent-presets.json'), raw, 'utf-8')
}

async function readRaw(dir: string): Promise<Buffer> {
  return readFile(join(dir, '.qqbat', 'agent-presets.json'))
}

async function readUndoText(dir: string): Promise<string> {
  return readFile(join(dir, '.qqbat', 'agent-presets.undo.json'), 'utf-8')
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 一份合法的分享文件文本（默认只含一条预设） */
function shareText(presets: unknown[]): string {
  return JSON.stringify({
    type: PRESET_SHARE_TYPE,
    version: PRESET_SHARE_VERSION,
    exportedAt: '2026-10-26T00:00:00.000Z',
    presets,
  })
}

/** 手写一份撤销点记录，用于构造"备份损坏"等异常 */
async function writeRecord(dir: string, record: Record<string, unknown>): Promise<void> {
  await writeFile(join(dir, '.qqbat', 'agent-presets.undo.json'), JSON.stringify(record), 'utf-8')
}

beforeEach(() => {
  h.failAtomicWrite = null
})

afterEach(() => {
  h.failAtomicWrite = null
})

describe('★ 预设撤销：没有可撤销的导入', () => {
  it('没有记录 → available:false 且没 problem；撤销报「没有可撤销」', async () => {
    const dir = await project()
    expect(await readPresetUndo(dir)).toEqual({ available: false })
    await expect(undoPresetImport(dir)).rejects.toThrow('没有可撤销的导入')
  })

  it('撤销成功后记录被删掉，再撤销又是「没有可撤销」', async () => {
    const dir = await project()
    await importPresetShare(dir, shareText([{ name: '甲' }]), false)
    const result = await undoPresetImport(dir)
    expect(result.restored).toBe(true)
    expect(await exists(join(dir, UNDO_FILE))).toBe(false)
    await expect(undoPresetImport(dir)).rejects.toThrow('没有可撤销的导入')
  })
})

describe('★ 预设撤销：导入前文件不存在', () => {
  it('capture 记 previousExisted:false；撤销删掉文件而不是写空数组', async () => {
    const dir = await project()
    const capture = await capturePresetUndo(dir)
    expect(capture).toEqual({
      previousExisted: false,
      previousSha256: null,
      previousBase64: null,
    })
    await writeRaw(dir, '')
    const state = await writePresetUndoPoint(dir, capture, {
      sourceName: '同事的预设.json',
      added: 2,
      replaced: 0,
      total: 2,
    })
    expect(state).toMatchObject({ available: true, previousExisted: false, total: 2 })
    const result = await undoPresetImport(dir)
    expect(result).toEqual({
      restored: true,
      removed: true,
      createdAt: state.createdAt,
      added: 2,
      replaced: 0,
      total: 2,
    })
    expect(await exists(join(dir, PRESETS_FILE))).toBe(false)
    expect(await exists(join(dir, UNDO_FILE))).toBe(false)
  })
})

describe('★ 预设撤销：精确字节恢复', () => {
  it('旧文件带非标准缩进/无结尾换行 → 撤销后字节与原来完全一致', async () => {
    const dir = await project()
    const original = '[\n    {"name":"甲","prompt":"旧"}\n]'
    await writeRaw(dir, original)
    await importPresetShare(dir, shareText([{ name: '乙', prompt: '新' }]), false)
    const afterImport = await readRaw(dir)
    expect(sha256Hex(afterImport)).not.toBe(sha256Hex(Buffer.from(original, 'utf-8')))
    const result = await undoPresetImport(dir)
    expect(result.removed).toBe(false)
    const restored = await readRaw(dir)
    expect(restored.equals(Buffer.from(original, 'utf-8'))).toBe(true)
    expect(sha256Hex(restored)).toBe(sha256Hex(Buffer.from(original, 'utf-8')))
  })
})

describe('★ 预设撤销：导入后又改过 → 拒绝且一字不写', () => {
  it('手改 presets → read 给 problem；undo 报「又被改过」，文件与记录都不动', async () => {
    const dir = await project()
    await importPresetShare(dir, shareText([{ name: '甲' }]), false)
    const undoBefore = await readUndoText(dir)
    // 模拟用户手改：在原内容后追加空白（不经过 JSON.parse 重排）
    const edited = (await readRaw(dir)).toString('utf-8') + '\n'
    await writeFile(join(dir, PRESETS_FILE), edited, 'utf-8')
    const editedBytes = await readRaw(dir)
    const state = await readPresetUndo(dir)
    expect(state.available).toBe(false)
    expect(state.problem).toContain('又被改过')
    await expect(undoPresetImport(dir)).rejects.toThrow('又被改过')
    expect((await readRaw(dir)).equals(editedBytes)).toBe(true)
    expect(await readUndoText(dir)).toBe(undoBefore)
  })

  it('presets 文件被删掉也算「被改过」', async () => {
    const dir = await project()
    await importPresetShare(dir, shareText([{ name: '甲' }]), false)
    await writeFile(join(dir, PRESETS_FILE), '', 'utf-8')
    const state = await readPresetUndo(dir)
    expect(state.available).toBe(false)
    expect(state.problem).toContain('又被改过')
  })
})

describe('★ 预设撤销：坏记录', () => {
  it('非法 JSON → problem；undo 报「读不出来」且不写盘', async () => {
    const dir = await project()
    const original = '[{"name":"甲"}]'
    await writeRaw(dir, original)
    await mkdir(join(dir, '.qqbat'), { recursive: true })
    await writeFile(join(dir, UNDO_FILE), '{oops', 'utf-8')
    const state = await readPresetUndo(dir)
    expect(state.available).toBe(false)
    expect(state.problem).toContain('不是合法 JSON')
    await expect(undoPresetImport(dir)).rejects.toThrow('撤销点读不出来')
    expect((await readRaw(dir)).toString('utf-8')).toBe(original)
  })

  it('版本不认识 / action 不对 / previous 字段与 previousExisted 矛盾 → 都算坏记录', async () => {
    const dir = await project()
    await writeRaw(dir, '[{"name":"甲"}]')
    const after = sha256Hex(await readRaw(dir))
    const base = {
      version: 1,
      createdAt: '2026-10-26T00:00:00.000Z',
      action: 'import',
      previousExisted: false,
      previousSha256: null,
      previousBase64: null,
      afterSha256: after,
      added: 1,
      replaced: 0,
      total: 1,
    }
    await writeRecord(dir, { ...base, version: 2 })
    expect((await readPresetUndo(dir)).problem).toContain('版本不认识')
    await writeRecord(dir, { ...base, action: 'save' })
    expect((await readPresetUndo(dir)).problem).toContain('action')
    await writeRecord(dir, { ...base, previousExisted: true })
    expect((await readPresetUndo(dir)).problem).toContain('previous')
  })
})

describe('★ 预设撤销：备份损坏', () => {
  it('记录里的 previousSha 与 base64 对不上 → undo 报「备份损坏」，不写盘', async () => {
    const dir = await project()
    const current = '[{"name":"乙"}]'
    await writeRaw(dir, current)
    const after = sha256Hex(Buffer.from(current, 'utf-8'))
    const wrongSha = sha256Hex(Buffer.from('[{"name":"甲"}]', 'utf-8'))
    const otherBase64 = Buffer.from('[{"name":"丙"}]', 'utf-8').toString('base64')
    await writeRecord(dir, {
      version: 1,
      createdAt: '2026-10-26T00:00:00.000Z',
      action: 'import',
      previousExisted: true,
      previousSha256: wrongSha,
      previousBase64: otherBase64,
      afterSha256: after,
      added: 1,
      replaced: 0,
      total: 1,
    })
    await expect(undoPresetImport(dir)).rejects.toThrow('备份损坏')
    expect((await readRaw(dir)).toString('utf-8')).toBe(current)
  })
})

describe('★ 预设撤销：无变化导入', () => {
  it('同一份文件再导一次（内容逐字节相同）→ unchanged:true，旧撤销点保留', async () => {
    const dir = await project()
    const first = await importPresetShare(dir, shareText([{ name: '甲' }]), false, '同事.json')
    expect(first.unchanged).toBe(false)
    expect(first.undo?.available).toBe(true)
    const presetsAfterFirst = await readRaw(dir)
    const undoAfterFirst = await readUndoText(dir)

    const again = await importPresetShare(dir, shareText([{ name: '甲' }]), true, '同事.json')
    expect(again).toMatchObject({ added: 0, replaced: 0, unchanged: true })
    expect(again.undo).toBeUndefined()
    expect((await readRaw(dir)).equals(presetsAfterFirst)).toBe(true)
    expect(await readUndoText(dir)).toBe(undoAfterFirst)

    // 旧撤销点仍然可用，并且能回到第一次导入之前
    const state = await readPresetUndo(dir)
    expect(state.available).toBe(true)
    const undone = await undoPresetImport(dir)
    expect(undone.restored).toBe(true)
    expect(await exists(join(dir, PRESETS_FILE))).toBe(false)
  })
})

describe('★ 预设撤销：撤销点写失败', () => {
  it('导入仍成功但返回 undoProblem；旧撤销点被清掉，不留误导', async () => {
    const dir = await project()
    const first = await importPresetShare(dir, shareText([{ name: '甲' }]), false)
    expect(first.undo?.available).toBe(true)
    expect(await exists(join(dir, UNDO_FILE))).toBe(true)

    h.failAtomicWrite = new Error('模拟磁盘写失败')
    const second = await importPresetShare(dir, shareText([{ name: '乙' }]), false, '同事.json')
    expect(second.unchanged).toBe(false)
    expect(second.undo).toBeUndefined()
    expect(second.undoProblem).toContain('模拟磁盘写失败')
    expect(second.total).toBe(2)
    // 导入数据本身已经写进去了
    expect((await readRaw(dir)).toString('utf-8')).toContain('乙')
    // 旧撤销点必须消失：它指向的状态已经不是"上一次导入"
    expect(await exists(join(dir, UNDO_FILE))).toBe(false)
    expect(await readPresetUndo(dir)).toEqual({ available: false })
  })
})
