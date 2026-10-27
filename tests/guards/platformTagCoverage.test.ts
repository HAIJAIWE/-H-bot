// tests/guards/platformTagCoverage.test.ts
//
// 闸门：节点/适配器的平台标注不许出现「注册表里没有的平台」。
//
// 修法只有两种：要么把节点标注改成注册表里已有的平台族，要么在
// `src/shared/domain/platform/registry.ts` 的 FAMILIES 里加一项（加完记得配中英显示名）。
// 平台词表（capabilities.ts 的 PlatformIdSchema）新增了值却忘了登记平台族，这里会红 ——
// 那正是"加平台只改一处"的边界检查。
import { describe, it, expect } from 'vitest'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { PlatformIdSchema } from '@shared/domain/common/capabilities'
import {
  nodePlatformTags,
  platformLabel,
  projectPlatformFamily,
} from '@shared/domain/platform/registry'
import { PLATFORM_TAGS } from '@shared/domain/project/botTypeConfig'

/** 平台族清单（加平台时同步这里 + registry 的 FAMILIES；两边漏一个这里就红） */
const FAMILIES = [
  'qq',
  'lark',
  'dingtalk',
  'wechat',
  'kook',
  'telegram',
  'discord',
  'slack',
  'sandbox',
  'minecraft',
] as const

describe('闸门：平台标注覆盖', () => {
  it('扫描确实在工作（防空转）', () => {
    expect(NODE_CATALOG_V2.length).toBeGreaterThan(40)
  })

  it('★ 每个节点的 platform 标注都已登记到平台注册表', () => {
    const offenders: string[] = []
    for (const spec of NODE_CATALOG_V2) {
      const p = spec.platform
      if (p === undefined || p === 'all') continue
      if (nodePlatformTags({ platform: p }).length !== 1) {
        offenders.push(`  ${spec.kind}: platform=${p} 不在 platform/registry.ts 的 FAMILIES 里`)
      }
    }
    expect(offenders, '节点平台标注与平台注册表不一致').toEqual([])
  })

  it('★ 节点 tags 里的历史平台标签都已登记', () => {
    const offenders: string[] = []
    for (const spec of NODE_CATALOG_V2) {
      for (const tag of spec.tags ?? []) {
        if (!PLATFORM_TAGS.includes(tag)) continue
        if (nodePlatformTags({ tags: [tag] }).length !== 1) {
          offenders.push(`  ${spec.kind}: tags 里的平台标签 ${tag} 未登记到平台注册表`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('★ PlatformIdSchema 的每个值都归属唯一平台族', () => {
    expect(PlatformIdSchema.options.length).toBeGreaterThan(0)
    for (const id of PlatformIdSchema.options) {
      expect(
        nodePlatformTags({ platform: id }),
        `适配器 platform id ${id} 未登记平台族`,
      ).toHaveLength(1)
    }
  })

  it('★ 每个平台族都有中英显示名，AdapterType 全部有归属', () => {
    for (const f of FAMILIES) {
      expect(platformLabel(f, 'zh-CN').length, `${f} 缺中文显示名`).toBeGreaterThan(0)
      expect(platformLabel(f, 'en-US').length, `${f} 缺英文显示名`).toBeGreaterThan(0)
    }
    for (const adapter of ['official', 'lark', 'dingtalk'] as const) {
      expect(projectPlatformFamily({ adapter }), `adapter ${adapter} 没有对应平台族`).toBeDefined()
    }
  })
})
