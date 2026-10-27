// tests/guards/nodePackContract.test.ts
//
// 闸门：平台节点包（第 66 批）与节点目录**不许漂**。
//
// 包是目录的视图，切的规则在 `src/shared/nodes/packs.ts`（有平台标注 → 该平台包；
// 没有 → common）。这道闸门守的是「视图没有偷偷改变目录」：
//   · 不丢失、不重复、kind 集合相等（切包把节点漏了/复制了会红）；
//   · 包内每个节点的平台标注与包 id 一致（common 里混进 QQ 节点会红）；
//   · 一个节点只能属于一个包（多平台标注会让归属含糊 —— 真出现要先决定语义）；
//   · 包 id 都在平台注册表里（写错平台族会红）。
import { describe, it, expect } from 'vitest'
import { NODE_CATALOG_V2, NODE_PACKS } from '@shared/nodes/builtinCatalog'
import { nodePlatformTags } from '@shared/domain/platform/registry'

describe('闸门：平台节点包契约', () => {
  it('扫描确实在工作（目录与包都非空）', () => {
    expect(NODE_CATALOG_V2.length).toBeGreaterThan(40)
    expect(NODE_PACKS.length).toBeGreaterThan(1)
  })

  it('★ 包覆盖全部节点：不丢失、不重复、kind 集合相等', () => {
    const packKinds = NODE_PACKS.flatMap(p => p.specs.map(s => s.kind))

    expect(packKinds.length, '切包后节点总数变了（有节点被漏掉或复制）').toBe(
      NODE_CATALOG_V2.length,
    )
    expect(new Set(packKinds).size, '同一个 kind 出现在多个包里').toBe(packKinds.length)
    expect(new Set(packKinds)).toEqual(new Set(NODE_CATALOG_V2.map(s => s.kind)))
  })

  it('★ 每个节点的包归属与平台标注一致（common 包只装无标注节点）', () => {
    const offenders: string[] = []
    for (const pack of NODE_PACKS) {
      for (const spec of pack.specs) {
        const fams = nodePlatformTags(spec)
        if (pack.id === 'common') {
          if (fams.length !== 0)
            offenders.push(`  ${spec.kind}: 在 common 包里但标注了 ${fams.join('/')}`)
        } else if (fams.length !== 1 || fams[0] !== pack.id) {
          offenders.push(`  ${spec.kind}: 在 ${pack.id} 包里但标注是 ${fams.join('/') || '(无)'}`)
        }
      }
    }
    expect(offenders, '包归属与平台标注不一致').toEqual([])
  })

  it('★ 每个节点只属于一个平台（多平台标注需要先定语义）', () => {
    const multi = NODE_CATALOG_V2.filter(s => nodePlatformTags(s).length > 1).map(s => s.kind)
    expect(multi, '这些节点同时标注了多个平台族；要么拆节点，要么扩包语义').toEqual([])
  })

  it('★ 包 id 都登记在平台注册表里，common 排第一', () => {
    expect(NODE_PACKS[0].id).toBe('common')
    for (const pack of NODE_PACKS) {
      if (pack.id === 'common') continue
      expect(
        nodePlatformTags({ platform: pack.id }).length,
        `包 ${pack.id} 不在平台注册表的平台族里`,
      ).toBe(1)
    }
  })
})
