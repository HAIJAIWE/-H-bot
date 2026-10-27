// tests/shared/nodes/packRegistry.test.ts
//
// 平台节点包注册表（第 67 批）：内置包已注册、外部包可注册、平台可见性与归属判定。
// 注意：注册表是模块级单例，本文件内的注册互不影响其它测试文件（vitest 默认按文件隔离）。
import { describe, it, expect } from 'vitest'
import type { NodeSpecV2 } from '@shared/types/nodeV2'
import {
  getNodePacks,
  isPackNodeKind,
  registerNodePack,
  visibleNodeKinds,
} from '@shared/nodes/packRegistry'
import '@shared/nodes/builtinCatalog'

const spec = (kind: string, extra: Partial<NodeSpecV2> = {}): NodeSpecV2 =>
  ({
    kind,
    type: 'action',
    label: kind,
    group: '测试',
    description: '',
    summary: '',
    sideEffects: [],
    tags: [],
    handler: { source: 'builtin', module: kind },
    exposedAsTool: false,
    defaultConfig: {},
    inputs: [],
    outputs: [],
    ...extra,
  }) as NodeSpecV2

describe('平台节点包注册表', () => {
  it('内置包在 builtinCatalog 加载时已注册，且 common 排第一', () => {
    const packs = getNodePacks()
    expect(packs.length).toBeGreaterThan(1)
    expect(packs[0].source).toBe('builtin')
    expect(packs[0].pack.id).toBe('common')
  })

  it('外部包可注册，来源标为 external', () => {
    // 用没有内置节点的平台族（minecraft）手搭一个外部包，避免与内置包 id 冲突
    registerNodePack(
      { id: 'minecraft', families: ['minecraft'], specs: [spec('x1', { platform: 'minecraft' })] },
      'external',
    )
    const found = getNodePacks().find(
      entry => entry.pack.id === 'minecraft' && entry.source === 'external',
    )
    expect(found?.pack.specs.map(s => s.kind)).toEqual(['x1'])
  })

  it('同一个包 id 不能注册两次（包是交付单位，来源必须唯一）', () => {
    expect(() =>
      registerNodePack(
        {
          id: 'minecraft',
          families: ['minecraft'],
          specs: [spec('x2', { platform: 'minecraft' })],
        },
        'external',
      ),
    ).toThrow(/重复注册/)
  })

  it('可见 kind：无项目 → 全部包内节点；指定平台 → common + 该平台', () => {
    const all = visibleNodeKinds(null)
    const qq = visibleNodeKinds('qq')
    expect(qq.size).toBeGreaterThan(0)
    expect(qq.size).toBeLessThan(all.size)
    // common 包里的节点在 QQ 视角下也必须可见
    const commonKinds = getNodePacks()
      .filter(entry => entry.pack.id === 'common')
      .flatMap(entry => entry.pack.specs.map(s => s.kind))
    for (const kind of commonKinds) expect(qq.has(kind)).toBe(true)
  })

  it('isPackNodeKind：包内 kind 为真，无关 kind 为假', () => {
    const someBuiltin = getNodePacks()[0].pack.specs[0].kind
    expect(isPackNodeKind(someBuiltin)).toBe(true)
    expect(isPackNodeKind('__no_such_node__')).toBe(false)
  })
})
