// tests/main/services/plugins/windowPackageScanner.test.ts
//
// 第 73 批：目录扫描。重点不是"能扫到好的"，而是**坏包不会拖垮整次扫描**：
// 一个坏 manifest 只进 issues，其他窗口照常出现。
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readWindowPackageSource,
  scanWindowPackages,
} from '../../../../src/main/services/plugins/windowPackageScanner'
import { WINDOW_PACKAGE_ENTRY_MAX_BYTES } from '../../../../src/shared/plugins/windowPackage'

let root = ''

const manifest = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    id,
    name: 'Window ' + id,
    version: '1.0.0',
    layout: 'compact',
    ...extra,
  })

async function writePackage(dir: string, content: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, dir, 'manifest.json'), content, 'utf-8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qqbat-window-pack-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanWindowPackages（第 73 批）', () => {
  it('目录不存在 → 空结果且不报错（首次启动的正常情况）', async () => {
    const result = await scanWindowPackages(join(root, 'nope'))
    expect(result).toEqual({ packages: [], issues: [] })
  })

  it('按 order 升序返回，同 order 按 id；目录名不参与准入判断', async () => {
    await writePackage('z-dir', manifest('zzz.last', { order: 900 }))
    await writePackage('a-dir', manifest('aaa.first', { order: 100 }))
    await writePackage('m-dir', manifest('mmm.mid'))

    const { packages } = await scanWindowPackages(root)
    expect(packages.map(p => p.id)).toEqual(['aaa.first', 'zzz.last', 'mmm.mid'])
    expect(packages[0]?.dir).toContain('a-dir')
  })

  it('坏 JSON / 非法清单进 issues，好包照常返回', async () => {
    await writePackage('good', manifest('good.one'))
    await writePackage('broken-json', '{ not json')
    await writePackage('bad-id', JSON.stringify({ ...JSON.parse(manifest('x')), id: 'BAD' }))

    const result = await scanWindowPackages(root)
    expect(result.packages.map(p => p.id)).toEqual(['good.one'])
    expect(result.issues).toHaveLength(2)
    expect(result.issues.some(i => i.message.includes('JSON 解析失败'))).toBe(true)
    expect(result.issues.some(i => i.message.includes('id'))).toBe(true)
  })

  it('没有 manifest.json 的子目录静默跳过', async () => {
    await mkdir(join(root, 'not-a-package'), { recursive: true })
    await writePackage('ok', manifest('ok.pkg'))

    const result = await scanWindowPackages(root)
    expect(result.packages).toHaveLength(1)
    expect(result.issues).toHaveLength(0)
  })

  it('重复 id：先扫到的生效，后者进 issues', async () => {
    await writePackage('a', manifest('dup.id'))
    await writePackage('b', manifest('dup.id'))

    const result = await scanWindowPackages(root)
    expect(result.packages).toHaveLength(1)
    expect(result.issues[0]?.message).toContain('重复')
  })
})

describe('readWindowPackageSource（第 74 批）', () => {
  it('读到入口源码与字节数', async () => {
    await writePackage('exec', manifest('exec.pkg', { entry: 'entry.js' }))
    await writeFile(join(root, 'exec', 'entry.js'), 'self.postMessage({ type: "view" })', 'utf-8')

    const result = await readWindowPackageSource(root, 'exec.pkg')
    expect(result.source).toContain('postMessage')
    expect(result.byteLength).toBe(Buffer.byteLength(result.source, 'utf-8'))
  })

  it('没有 entry 的声明式包 → 抛错（不让加载器去执行一个不存在的入口）', async () => {
    await writePackage('plain', manifest('plain.pkg'))
    await expect(readWindowPackageSource(root, 'plain.pkg')).rejects.toThrow('没有合法的 entry')
  })

  it('entry 文件不存在 → 抛错', async () => {
    await writePackage('missing', manifest('missing.pkg', { entry: 'entry.js' }))
    await expect(readWindowPackageSource(root, 'missing.pkg')).rejects.toThrow()
  })

  it('entry 超过体积上限 → 抛错', async () => {
    await writePackage('big', manifest('big.pkg', { entry: 'entry.js' }))
    await writeFile(join(root, 'big', 'entry.js'), 'x'.repeat(WINDOW_PACKAGE_ENTRY_MAX_BYTES + 1), 'utf-8')
    await expect(readWindowPackageSource(root, 'big.pkg')).rejects.toThrow('KB')
  })
})
