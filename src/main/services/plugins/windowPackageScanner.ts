// src/main/services/plugins/windowPackageScanner.ts
//
// **外部窗口包的目录扫描**（第 73 批，P4 加载器 v1）。
//
// 目录约定：`<userData>/plugins/windows/<任意目录名>/manifest.json`
// （准入按"有 manifest.json"判断，不看目录名；与 `pluginScanner` 的纪律一致）。
//
// 本模块只读盘 + 校验 + 汇总，不 import electron：路径由调用方（IPC handler）传入，
// 这样 node 测试可以直接给临时目录。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  validateWindowPackage,
  type WindowPackageInfo,
  type WindowPackageScanIssue,
  type WindowPackageScanResult,
} from '@shared/plugins/windowPackage'

/**
 * 扫描窗口包根目录。目录不存在 → 空结果（首次启动的正常情况，不是错误）。
 *
 * 排序：order 升序（小的优先当默认），同 order 按 id —— 保证下拉列表顺序稳定，
 * 不会因为目录枚举顺序变化导致"默认窗口"在重启后换人。
 */
export async function scanWindowPackages(root: string): Promise<WindowPackageScanResult> {
  const packages: WindowPackageInfo[] = []
  const issues: WindowPackageScanIssue[] = []

  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    // 目录还没建：正常。真错误（权限等）也按空处理 —— 加载器不该让应用起不来。
    return { packages, issues }
  }

  for (const entry of entries.sort()) {
    const dir = join(root, entry)
    const manifestPath = join(dir, 'manifest.json')
    let raw: string
    try {
      raw = await readFile(manifestPath, 'utf-8')
    } catch {
      // 没有 manifest.json 的子目录：跳过（可能是用户放错的目录，不吵）
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      issues.push({ file: manifestPath, message: `JSON 解析失败：${(e as Error).message}` })
      continue
    }

    const result = validateWindowPackage(parsed)
    if (!result.ok) {
      issues.push({
        file: manifestPath,
        message: result.issues
          .map(i => (i.field ? `${i.field}: ${i.message}` : i.message))
          .join('; '),
      })
      continue
    }

    const duplicate = packages.find(p => p.id === result.value.id)
    if (duplicate) {
      issues.push({
        file: manifestPath,
        message: `id 与 ${duplicate.dir} 重复（先扫到的生效）：${result.value.id}`,
      })
      continue
    }

    packages.push({ ...result.value, dir })
  }

  packages.sort((a, b) => (a.order ?? 5000) - (b.order ?? 5000) || a.id.localeCompare(b.id))
  return { packages, issues }
}
