// tests/main/services/ai/presetShare.test.ts
//
// 第 53 批：预设分享文件的导出/预览/导入。
// 预设是权限边界，所以这里主要证明"不放心就整次拒绝"，而不是"能导进来"。
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildPresetShare,
  importPresetShare,
  parsePresetShareText,
  previewPresetImport,
} from '@main/services/ai/presetShare'
import { readPresetRoster, writePresets } from '@main/services/ai/presets'
import {
  PRESET_SHARE_MAX_BYTES,
  PRESET_SHARE_MAX_PRESETS,
  PRESET_SHARE_TYPE,
  PRESET_SHARE_VERSION,
} from '@shared/ai/presetShare'

async function project(withFile?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-preset-share-'))
  if (withFile !== undefined) {
    await mkdir(join(dir, '.qqbat'), { recursive: true })
    await writeFile(join(dir, '.qqbat', 'agent-presets.json'), JSON.stringify(withFile), 'utf-8')
  }
  return dir
}

async function projectRaw(raw: string) {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-preset-share-raw-'))
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  await writeFile(join(dir, '.qqbat', 'agent-presets.json'), raw, 'utf-8')
  return dir
}

function shareText(presets: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: PRESET_SHARE_TYPE,
    version: PRESET_SHARE_VERSION,
    exportedAt: '2026-10-26T00:00:00.000Z',
    presets,
    ...extra,
  })
}

async function rawFile(dir: string): Promise<string> {
  return readFile(join(dir, '.qqbat', 'agent-presets.json'), 'utf-8')
}

function userRows(roster: Awaited<ReturnType<typeof readPresetRoster>>) {
  return roster.presets.filter(p => !p.builtin)
}

describe('★ 预设分享：导出', () => {
  it('只导出用户预设，剥掉 broken/notes/builtin/isDefault，文件带 type/version', async () => {
    const dir = await project([
      { name: '巡检', role: 'coder', prompt: '只读', allowedTools: ['read_file'], order: 2 },
    ])
    const built = await buildPresetShare(dir)
    expect(built.count).toBe(1)
    expect(built.warnings).toEqual([])
    const parsed = JSON.parse(built.text) as Record<string, unknown>
    expect(parsed.type).toBe(PRESET_SHARE_TYPE)
    expect(parsed.version).toBe(PRESET_SHARE_VERSION)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(parsed.presets).toEqual([
      { name: '巡检', role: 'coder', prompt: '只读', allowedTools: ['read_file'], order: 2 },
    ])
  })

  it('没有自定义预设（只有内置）→ 拒绝导出', async () => {
    const dir = await project()
    await expect(buildPresetShare(dir)).rejects.toThrow('还没有可导出的自定义预设')
  })

  it('当前文件有坏条目 → 拒绝导出，并点名', async () => {
    const dir = await project([{ name: '好的' }, { name: '' }])
    await expect(buildPresetShare(dir)).rejects.toThrow('不可用的条目')
  })
})

describe('★ 预设分享：解析校验', () => {
  it('顶层不是对象 / type 不对 / version 不认识 / presets 不是数组', async () => {
    await expect(parsePresetShareText('[]')).rejects.toThrow('顶层应该是对象')
    await expect(
      parsePresetShareText(shareText([{ name: '甲' }], { type: 'other' })),
    ).rejects.toThrow('不是 qqbat 的预设分享文件')
    await expect(parsePresetShareText(shareText([{ name: '甲' }], { version: 2 }))).rejects.toThrow(
      '版本不认识',
    )
    await expect(
      parsePresetShareText(JSON.stringify({ type: PRESET_SHARE_TYPE, version: 1 })),
    ).rejects.toThrow('presets 应该是数组')
  })

  it('空文件 / 超字节 / 空列表 / 超过 200 条 / 未知字段 / 非法 JSON', async () => {
    await expect(parsePresetShareText('   ')).rejects.toThrow('分享文件是空的')
    await expect(parsePresetShareText('x'.repeat(PRESET_SHARE_MAX_BYTES + 1))).rejects.toThrow(
      '分享文件太大',
    )
    await expect(parsePresetShareText(shareText([]))).rejects.toThrow('没有预设')
    await expect(
      parsePresetShareText(
        shareText(
          Array.from({ length: PRESET_SHARE_MAX_PRESETS + 1 }, (_, i) => ({ name: 'p' + i })),
        ),
      ),
    ).rejects.toThrow('最多')
    await expect(parsePresetShareText(shareText([{ name: '甲', note: 'x' }]))).rejects.toThrow(
      '未知字段',
    )
    await expect(parsePresetShareText('{oops')).rejects.toThrow('不是合法 JSON')
  })

  it('与内置同名 / 重名 / 字段被忽略 → 一律拒绝（不静默降权或截断）', async () => {
    await expect(parsePresetShareText(shareText([{ name: '标准' }]))).rejects.toThrow('与内置预设')
    await expect(parsePresetShareText(shareText([{ name: '甲' }, { name: '甲' }]))).rejects.toThrow(
      '重名',
    )
    await expect(parsePresetShareText(shareText([{ name: '甲', role: 'nope' }]))).rejects.toThrow(
      '字段没生效',
    )
  })

  it('合法文件保留 exportedAt 与八字段', async () => {
    const parsed = await parsePresetShareText(
      shareText([{ name: '甲', permissionMode: 'full', plugins: ['market-clock'] }]),
    )
    expect(parsed.exportedAt).toBe('2026-10-26T00:00:00.000Z')
    expect(parsed.presets).toEqual([
      { name: '甲', permissionMode: 'full', plugins: ['market-clock'] },
    ])
  })
})

describe('★ 预设分享：预览与导入', () => {
  it('预览只读：报冲突名与现有条数，项目文件不变', async () => {
    const dir = await project([{ name: '甲' }])
    const before = await rawFile(dir)
    const preview = await previewPresetImport(dir, shareText([{ name: '甲' }, { name: '乙' }]))
    expect(preview.existingCount).toBe(1)
    expect(preview.conflicts).toEqual(['甲'])
    expect(preview.presets.map(p => p.name)).toEqual(['甲', '乙'])
    expect(await rawFile(dir)).toBe(before)
  })

  it('有冲突且没勾覆盖 → 整次拒绝，文件一个字节都不动', async () => {
    const dir = await project([{ name: '甲', allowedTools: ['read_file'] }])
    const before = await rawFile(dir)
    await expect(
      importPresetShare(dir, shareText([{ name: '甲', allowedTools: ['list_dir'] }]), false),
    ).rejects.toThrow('同名预设')
    expect(await rawFile(dir)).toBe(before)
  })

  it('无冲突 → 追加；勾覆盖 → 只替换同名项，内置永不动', async () => {
    const addedDir = await project([{ name: '甲' }])
    const added = await importPresetShare(addedDir, shareText([{ name: '乙' }]), false)
    expect(added).toEqual({ added: 1, replaced: 0, total: 2 })
    expect(
      userRows(await readPresetRoster(addedDir))
        .map(p => p.name)
        .sort(),
    ).toEqual(['乙', '甲'])

    const dir = await project([{ name: '甲', allowedTools: ['read_file'] }])
    const replaced = await importPresetShare(
      dir,
      shareText([{ name: '甲', allowedTools: ['list_dir'] }, { name: '乙' }]),
      true,
    )
    expect(replaced).toEqual({ added: 1, replaced: 1, total: 2 })
    const roster = await readPresetRoster(dir)
    expect(roster.presets.filter(p => p.builtin)).toHaveLength(2)
    expect(userRows(roster).find(p => p.name === '甲')?.allowedTools).toEqual(['list_dir'])
  })

  it('当前文件本身是坏的 → 拒绝导入（避免"导入"顺手清掉坏条目）', async () => {
    const dir = await projectRaw('[{"name":"甲"},{"name":""}]')
    await expect(importPresetShare(dir, shareText([{ name: '乙' }]), false)).rejects.toThrow(
      '不可用的条目',
    )
  })
})
