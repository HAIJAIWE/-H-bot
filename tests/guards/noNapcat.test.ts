// tests/guards/noNapcat.test.ts
// 守卫：NapCat 能力已于 2026-10-24 彻底删除（用户只用 QQ 官方 API）。
//
// 这里锁住的是"能力面"而不是注释：源码里提到 NapCat 的历史注释可以留，
// 但任何可执行的 NapCat 分支、类型、字段、部署开关都不该回来。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 递归收集 src 下的 .ts/.tsx */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const srcFiles = walk(join(ROOT, 'src'))

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

describe('NapCat 能力已删除', () => {
  it('源码里没有可执行的 NapCat 分支', () => {
    const offenders: string[] = []
    for (const file of srcFiles) {
      const text = readFileSync(file, 'utf-8')
      if (/\b(adapter|type|mode)\s*===\s*['"]napcat['"]/.test(text)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('没有 NapCat 类型/字段/部署开关', () => {
    const patterns = [/interface\s+NapCatConfig/, /interface\s+NapcatConfig/, /includeNapcat/, /\bnapcat\?:/]
    const offenders: string[] = []
    for (const file of srcFiles) {
      const text = readFileSync(file, 'utf-8')
      if (patterns.some((p) => p.test(text))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('适配器枚举只剩官方 / 飞书 / 钉钉', () => {
    expect(read('src/shared/types/project.ts')).toContain(
      "export type AdapterType = 'official' | 'lark' | 'dingtalk'"
    )
  })

  it('部署 schema 只接受 official，且没有打包 NapCat 的选项', () => {
    const schema = read('src/main/schemas/deploy.ts')
    expect(schema).toContain("const adapterSchema = z.enum(['official'])")
    expect(schema).not.toContain('includeNapcat')
  })

  it('Docker 导出只产出官方适配器形态', () => {
    const svc = read('src/main/services/dockerExport.ts')
    expect(svc).toContain("export type DeployAdapter = 'official'")
    expect(svc).not.toContain('NAPCAT_DIR')
    expect(svc).not.toContain('includeNapcat')
  })
})
