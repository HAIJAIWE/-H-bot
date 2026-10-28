// tests/main/services/plugins/windowPackageScanner.test.ts
//
// 第 73 批：目录扫描。重点不是"能扫到好的"，而是**坏包不会拖垮整次扫描**：
// 一个坏 manifest 只进 issues，其他窗口照常出现。
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  disableWindowPackage,
  enableWindowPackage,
  readWindowPackageSource,
  scanWindowPackages,
  uninstallWindowPackage,
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

// =============================================================================
// 第 75 批：管理动作（禁用 / 启用 / 卸载）
// =============================================================================
//
// 这三个动作都是**写盘**，所以测试重点不是"UI 能不能点"，而是：
//   · 禁用真的留在一个**跟着包走**的地方（目录里的标记文件），而扫描能看见它；
//   · 启用是真正撤销禁用（不是"再写一个相反的标记"，否则两个标记谁赢就说不清了）；
//   · 三个动作都拒绝管理**扫盘不认得的 id** —— 这是它们和 `rm -rf 用户给的路径`
//     之间的唯一区别。
describe('窗口包管理动作（第 75 批）', () => {
  it('禁用 = 写 .disabled 标记；扫描照常返回这个包，只是带 disabled:true', async () => {
    await writePackage('a-dir', manifest('a.pkg'))

    await disableWindowPackage(root, 'a.pkg')

    await expect(stat(join(root, 'a-dir', '.disabled'))).resolves.toBeDefined()
    const { packages } = await scanWindowPackages(root)
    expect(packages).toHaveLength(1)
    expect(packages[0]?.disabled).toBe(true)
  })

  it('启用 = 删掉标记（幂等：本来没禁用也不算错）', async () => {
    await writePackage('a-dir', manifest('a.pkg'))
    await disableWindowPackage(root, 'a.pkg')

    await enableWindowPackage(root, 'a.pkg')

    await expect(stat(join(root, 'a-dir', '.disabled'))).rejects.toThrow()
    const { packages } = await scanWindowPackages(root)
    expect(packages[0]?.disabled).toBeUndefined()
    // 第二次启用（已经没有标记）：不该抛 —— 用户连点两下不是错误
    await expect(enableWindowPackage(root, 'a.pkg')).resolves.toBeUndefined()
  })

  it('卸载 = 删整个包目录', async () => {
    await writePackage('a-dir', manifest('a.pkg'))

    await uninstallWindowPackage(root, 'a.pkg')

    await expect(stat(join(root, 'a-dir'))).rejects.toThrow()
    const { packages } = await scanWindowPackages(root)
    expect(packages).toHaveLength(0)
  })

  it('扫盘不认得的 id → 三个动作都抛错，且不动任何目录', async () => {
    await writePackage('good-dir', manifest('good.pkg'))
    // 坏包：manifest 不合法 ⇒ 不在 packages 里，也没有可管理的身份
    await writePackage('broken-dir', '{ not json')

    await expect(disableWindowPackage(root, 'nope.pkg')).rejects.toThrow('找不到窗口包')
    await expect(enableWindowPackage(root, 'nope.pkg')).rejects.toThrow('找不到窗口包')
    await expect(uninstallWindowPackage(root, 'nope.pkg')).rejects.toThrow('找不到窗口包')
    // 连坏包目录也不该被"顺手删掉" —— 它只是没资格被管理，不是垃圾
    await expect(stat(join(root, 'broken-dir'))).resolves.toBeDefined()
    await expect(stat(join(root, 'good-dir'))).resolves.toBeDefined()
  })
})
