// tests/guards/noOneBotSurface.test.ts
// 守卫：OneBot 从来不是本项目的可选协议端（adapterRegistry 只注册过 official），
// 它只是"翻译器 ↔ 运行时"之间的私有事件/动作形状。2026-10-24 起，用户可见面上
// 一切 OneBot 表述都已清掉；这里锁住这层外表，避免从旧文档/旧代码里又被搬回来。
//
// 注意：内部契约（OneBotEvent / ONEBOT_ROLE_LEVELS / send_group_msg 这类动作名）
// 仍然存在，那是运行时私有协议，不在本守卫范围内。
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
    expect(read('src/shared/types/nodeV2.ts')).toContain("platform?: 'all' | 'qq'")
    expect(read('src/shared/types/flow.ts')).toContain("platform?: 'all' | 'qq'")
  })

  it('删掉的多平台适配器配置没有回来', () => {
    const project = read('src/shared/types/project.ts')
    expect(project).not.toContain('BotAdapterName')
    expect(project).not.toContain('PlatformCredentials')
    expect(project).not.toContain('botAdapters')
    expect(read('src/main/schemas/project.ts')).not.toContain('platformCredentials')
  })

  it('文档不再把 OneBot 描述成外部协议端', () => {
    expect(read('README.md').toLowerCase()).not.toContain('onebot')
    expect(read('docs/nodes-reference.md').toLowerCase()).not.toContain('onebot')
  })
})
