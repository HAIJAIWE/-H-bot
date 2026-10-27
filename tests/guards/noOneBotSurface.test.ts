// tests/guards/noOneBotSurface.test.ts
// 守卫：OneBot 从来不是本项目的可选协议端（adapterRegistry 只注册过 official）。
// 2026-10-24 起：用户可见面清掉一切 OneBot 表述，随后连**内部命名**也一并改成
// 项目自己的（RuntimeEvent / ROLE_LEVELS / send_group_message），旧动作名只保留在
// 翻译器入口的别名表里（src/main/services/translator/actions/aliases.ts）做兼容。
// 这里同时锁住外表与命名：再出现大写 OneBot 说明有人从旧产物里搬回来了。
//
// 2026-10-24 补：连 flow 的 metadata.runtime 也只剩 `'typescript'` 一种（旧文件里的其它
// 字符串由 schema 静默归一），历史框架名不再作为可选值出现在类型里。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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

describe('OneBot 不是可选协议端（用户可见面已清理）', () => {
  it("源码里没有 'onebot' 字面量（平台标注/类型联合/徽标判断）", () => {
    const offenders = srcFiles.filter((file) => readFileSync(file, 'utf-8').includes("'onebot'"))
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([])
  })

  it('渲染层文案与星标里没有 OneBot', () => {
    for (const rel of ['src/renderer/src/i18n/zh-CN.json', 'src/renderer/src/i18n/en-US.json']) {
      expect(read(rel).toLowerCase(), rel).not.toContain('onebot')
    }
    const center = read('src/renderer/src/components/layout/CenterPanel.tsx')
    expect(center).not.toContain('botuniverse')
    expect(center).not.toContain('adapterOnebot')
  })

  it('节点平台标注只剩 all / qq', () => {
    const catalog = read('src/shared/nodes/builtinCatalog.ts')
    const block = catalog.slice(catalog.indexOf('PLATFORM_ANNOTATIONS'))
    expect(block).not.toContain("'onebot'")
    // message_edit / api_call / group_op / message_op 四个节点实际走官方 API
    for (const kind of ['message_edit', 'api_call', 'group_op', 'message_op']) {
      expect(block).toContain(kind)
    }
    // 2026-10-28 第 64 批：`all | qq` 这个联合值收到 `platform/registry.ts` 的 NodePlatformTag，
    // 类型字段只引用它；平台族清单的边界由 tests/guards/platformTagCoverage.test.ts 守。
    expect(read('src/shared/types/nodeV2.ts')).toContain('platform?: NodePlatformTag')
    expect(read('src/shared/types/flow.ts')).toContain('platform?: NodePlatformTag')
    expect(read('src/shared/domain/platform/registry.ts')).toContain(
      "export type NodePlatformTag = 'all'",
    )
  })

  it('删掉的多平台适配器配置没有回来', () => {
    const project = read('src/shared/types/project.ts')
    expect(project).not.toContain('BotAdapterName')
    expect(project).not.toContain('PlatformCredentials')
    expect(project).not.toContain('botAdapters')
    expect(read('src/main/schemas/project.ts')).not.toContain('platformCredentials')
  })

  it('src 里不再出现大写 OneBot（内部命名已改成 RuntimeEvent / 动作名_ message）', () => {
    const offenders = srcFiles
      .map((file) => ({ rel: file.slice(ROOT.length + 1), text: readFileSync(file, 'utf-8') }))
      .filter(({ text }) => /OneBot/.test(text))
    expect(offenders.map((o) => o.rel)).toEqual([])
  })

  it('文档不再把 OneBot 描述成外部协议端', () => {
    expect(read('README.md').toLowerCase()).not.toContain('onebot')
    expect(read('docs/nodes-reference.md').toLowerCase()).not.toContain('onebot')
  })
})
