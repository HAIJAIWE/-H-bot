// tests/shared/nodes/platformCheck.test.ts
//
// 平台能力校验（第 65 批）：平台专属节点落进别的平台的项目 → 给出一条可读问题。
// 守三件事：① 不绑平台的项目不做校验（别把老项目判坏）② 通用节点永远不报
// ③ 目录里没有的 kind（插件/自定义节点）不归这里管
import { describe, it, expect } from 'vitest'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { nodePlatformTags } from '@shared/domain/platform/registry'
import { describePlatformMismatch, findPlatformMismatches } from '@shared/nodes/platformCheck'

/** 目录里第一个只属于 QQ 的节点（避免把用例钉死在某一个节点上） */
const qqOnly = NODE_CATALOG_V2.find(s => nodePlatformTags(s).join() === 'qq')
/** 目录里第一个通用节点（没有任何平台标注） */
const universal = NODE_CATALOG_V2.find(s => nodePlatformTags(s).length === 0)

const nodeOf = (id: string, kind: string) => ({ id, data: { nodeKind: kind } })

describe('平台能力校验：findPlatformMismatches', () => {
  it('扫描确实在工作（目录里 QQ 专属与通用节点都存在）', () => {
    expect(qqOnly).toBeDefined()
    expect(universal).toBeDefined()
  })

  it('项目没绑平台（undefined / null）时不校验，历史项目照常跑', () => {
    const graph = { nodes: [nodeOf('q1', qqOnly!.kind)] }
    expect(findPlatformMismatches(graph, undefined)).toEqual([])
    expect(findPlatformMismatches(graph, null)).toEqual([])
  })

  it('通用节点在任何平台都不报', () => {
    const graph = { nodes: [nodeOf('u1', universal!.kind)] }
    expect(findPlatformMismatches(graph, 'lark')).toEqual([])
    expect(findPlatformMismatches(graph, 'qq')).toEqual([])
  })

  it('★ QQ 专属节点放进飞书项目 → 一条 platform 不匹配（带节点名与所需平台）', () => {
    const graph = { nodes: [nodeOf('u1', universal!.kind), nodeOf('q1', qqOnly!.kind)] }
    const out = findPlatformMismatches(graph, 'lark')
    expect(out).toHaveLength(1)
    expect(out[0].nodeId).toBe('q1')
    expect(out[0].kind).toBe(qqOnly!.kind)
    expect(out[0].need).toEqual(['qq'])
    expect(out[0].label.length).toBeGreaterThan(0)
  })

  it('QQ 专属节点留在 QQ 项目里不报', () => {
    const graph = { nodes: [nodeOf('q1', qqOnly!.kind)] }
    expect(findPlatformMismatches(graph, 'qq')).toEqual([])
  })

  it('目录里没有的 kind（插件 / 自定义节点）跳过，空图 / null 也不炸', () => {
    expect(
      findPlatformMismatches({ nodes: [nodeOf('x1', 'plugin_defined_kind')] }, 'lark'),
    ).toEqual([])
    expect(findPlatformMismatches({ nodes: [] }, 'lark')).toEqual([])
    expect(findPlatformMismatches(null, 'lark')).toEqual([])
  })
})

describe('平台能力校验：describePlatformMismatch', () => {
  const mismatch = {
    nodeId: 'q1',
    kind: 'official_group_op',
    label: 'QQ 群操作',
    need: ['qq'] as const,
  }

  it('中文默认文案包含节点名与平台名', () => {
    const text = describePlatformMismatch({ ...mismatch, need: [...mismatch.need] })
    expect(text).toContain('QQ 群操作')
    expect(text).toContain('QQ')
    expect(text).toContain('当前项目不是该平台')
  })

  it('英文文案同样带平台名', () => {
    const text = describePlatformMismatch({ ...mismatch, need: [...mismatch.need] }, 'en-US')
    expect(text).toContain('QQ 群操作')
    expect(text).toContain('only works on')
  })
})
