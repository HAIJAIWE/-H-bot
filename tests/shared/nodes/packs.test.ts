// tests/shared/nodes/packs.test.ts
//
// 平台节点包（第 66 批）：切包规则、顺序、归属。纯函数，不读盘。
import { describe, it, expect } from 'vitest'
import type { NodeSpecV2 } from '@shared/types/nodeV2'
import { buildNodePacks } from '@shared/nodes/packs'

/** 造一个只关心平台标注的最小节点（其余字段用不到） */
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

describe('平台节点包：buildNodePacks', () => {
  const specs = [
    spec('u1'),
    spec('q1', { platform: 'qq' }),
    spec('u2'),
    spec('l1', { platform: 'lark' }),
    spec('q2', { tags: ['QQ'] }),
    spec('u3', { platform: 'all' }),
  ]

  it('common 排第一，其余按目录里第一次出现的顺序', () => {
    expect(buildNodePacks(specs).map(p => p.id)).toEqual(['common', 'qq', 'lark'])
  })

  it('切包规则：显式 platform → 该平台；platform:"all" 与无标注 → common；历史 tags 兜底', () => {
    const packs = buildNodePacks(specs)
    expect(packs[0].specs.map(s => s.kind)).toEqual(['u1', 'u2', 'u3'])
    expect(packs[1].specs.map(s => s.kind)).toEqual(['q1', 'q2'])
    expect(packs[2].specs.map(s => s.kind)).toEqual(['l1'])
  })

  it('包内节点保持目录顺序，切包不丢不重', () => {
    const packs = buildNodePacks(specs)
    expect(
      packs
        .flatMap(p => p.specs)
        .map(s => s.kind)
        .sort(),
    ).toEqual(specs.map(s => s.kind).sort())
  })

  it('families 与 id 对应：common 为空，平台包只有自己', () => {
    const packs = buildNodePacks(specs)
    expect(packs[0].families).toEqual([])
    expect(packs[1].families).toEqual(['qq'])
    expect(packs[2].families).toEqual(['lark'])
  })

  it('空目录 → 空包列表；只有通用节点时只有 common 包', () => {
    expect(buildNodePacks([])).toEqual([])
    expect(buildNodePacks([spec('u1')]).map(p => p.id)).toEqual(['common'])
  })
})
