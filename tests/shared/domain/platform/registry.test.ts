// tests/shared/domain/platform/registry.test.ts
//
// 平台注册表：平台族映射、节点标注推导、节点库可见性。
// 守的是「加平台只改一处」—— 平台词表漂移（PlatformIdSchema 有新值但注册表没收录）
// 由 tests/guards/platformTagCoverage.test.ts 兜住。
import { describe, it, expect } from 'vitest'
import { PlatformIdSchema } from '@shared/domain/common/capabilities'
import {
  nodePlatformTags,
  platformLabel,
  platformTagsVisible,
  projectPlatformFamily,
  specVisibleOnPlatform,
} from '@shared/domain/platform/registry'
import { BOT_TYPE_PLATFORM, PLATFORM_TAGS } from '@shared/domain/project/botTypeConfig'

describe('平台注册表：项目平台族', () => {
  it('接入方式优先：official / lark / dingtalk 各自映射到平台族', () => {
    expect(projectPlatformFamily({ adapter: 'official' })).toBe('qq')
    expect(projectPlatformFamily({ adapter: 'lark' })).toBe('lark')
    expect(projectPlatformFamily({ adapter: 'dingtalk' })).toBe('dingtalk')
  })

  it('adapter 胜过 botType：飞书项目即使 botType=general 也算飞书', () => {
    expect(projectPlatformFamily({ adapter: 'lark', botType: 'general' })).toBe('lark')
    expect(projectPlatformFamily({ adapter: 'official', botType: 'general' })).toBe('qq')
  })

  it('没有 adapter 平台信息时按 botType 兜底：qq / game → qq，general → 不绑平台', () => {
    expect(projectPlatformFamily({ botType: 'qq' })).toBe('qq')
    expect(projectPlatformFamily({ botType: 'game' })).toBe('qq')
    expect(projectPlatformFamily({ botType: 'general' })).toBeUndefined()
    expect(projectPlatformFamily({})).toBeUndefined()
    expect(projectPlatformFamily(null)).toBeUndefined()
  })
})

describe('平台注册表：节点标注推导', () => {
  it('显式 platform 优先，历史 tags 兜底，两者取并集去重', () => {
    expect(nodePlatformTags({ platform: 'qq' })).toEqual(['qq'])
    expect(nodePlatformTags({ platform: 'all' })).toEqual([])
    expect(nodePlatformTags({ tags: ['QQ', 'composite'] })).toEqual(['qq'])
    expect(nodePlatformTags({ platform: 'qq', tags: ['QQ'] })).toEqual(['qq'])
  })

  it('适配器 platform id 与平台族 id 都能识别', () => {
    expect(nodePlatformTags({ platform: 'qq-official' })).toEqual(['qq'])
    expect(nodePlatformTags({ platform: 'qq-gateway' })).toEqual(['qq'])
    expect(nodePlatformTags({ platform: 'wecom' })).toEqual(['wechat'])
    expect(nodePlatformTags({ platform: 'lark' })).toEqual(['lark'])
  })

  it('每个 PlatformIdSchema 取值都归属且仅归属一个平台族（词表不漂移）', () => {
    for (const id of PlatformIdSchema.options) {
      const fams = nodePlatformTags({ platform: id })
      expect(fams, `platform id ${id} 应归属且仅归属一个平台族`).toHaveLength(1)
    }
  })

  it('未标注视为通用', () => {
    expect(nodePlatformTags({})).toEqual([])
    expect(nodePlatformTags(null)).toEqual([])
  })
})

describe('平台注册表：节点库可见性', () => {
  it('通用节点在任何项目都可见（包括不绑平台的项目）', () => {
    expect(specVisibleOnPlatform({}, null)).toBe(true)
    expect(specVisibleOnPlatform({ tags: ['composite'] }, null)).toBe(true)
    expect(specVisibleOnPlatform({}, 'qq')).toBe(true)
  })

  it('平台专属节点只在本平台可见', () => {
    expect(specVisibleOnPlatform({ platform: 'qq' }, 'qq')).toBe(true)
    expect(specVisibleOnPlatform({ platform: 'qq' }, 'lark')).toBe(false)
    expect(specVisibleOnPlatform({ platform: 'qq' }, null)).toBe(false)
    expect(specVisibleOnPlatform({ tags: ['飞书'] }, 'lark')).toBe(true)
    expect(specVisibleOnPlatform({ tags: ['飞书'] }, 'qq')).toBe(false)
  })
})

describe('平台注册表：与 botTypeConfig 的存量词表不漂移', () => {
  it('PLATFORM_TAGS 里每个历史标签都能被注册表识别', () => {
    expect(PLATFORM_TAGS.length).toBeGreaterThan(0)
    for (const tag of PLATFORM_TAGS) {
      expect(nodePlatformTags({ tags: [tag] }), `历史标签 ${tag} 未登记到平台注册表`).toHaveLength(
        1,
      )
    }
  })

  it('BOT_TYPE_PLATFORM 的 qq / game 平台名与注册表中文标签一致，general 不绑平台', () => {
    expect(BOT_TYPE_PLATFORM.qq.platform).toBe(platformLabel('qq', 'zh-CN'))
    expect(BOT_TYPE_PLATFORM.game.platform).toBe(platformLabel('qq', 'zh-CN'))
    expect(BOT_TYPE_PLATFORM.general.platform).toBeNull()
    expect(projectPlatformFamily({ botType: 'general' })).toBeUndefined()
  })
})

describe('平台注册表：显示名', () => {
  it('中英各一份，未知 id 原样返回', () => {
    expect(platformLabel('qq', 'zh-CN')).toBe('QQ')
    expect(platformLabel('lark', 'zh-CN')).toBe('飞书')
    expect(platformLabel('lark', 'en-US')).toBe('Feishu')
    expect(platformLabel('unknown-x' as never, 'zh-CN')).toBe('unknown-x')
  })
})

describe('平台注册表：UI 入口可见性（第 65 批）', () => {
  it('不带标签（通用）任何项目都显示', () => {
    expect(platformTagsVisible([], 'qq')).toBe(true)
    expect(platformTagsVisible([], 'lark')).toBe(true)
    expect(platformTagsVisible([], undefined)).toBe(true)
  })

  it('★ 带标签的只有本平台项目显示；不绑平台的项目一律藏', () => {
    expect(platformTagsVisible(['qq'], 'qq')).toBe(true)
    expect(platformTagsVisible(['qq'], 'lark')).toBe(false)
    expect(platformTagsVisible(['qq'], undefined)).toBe(false)
  })

  it('多标签取并集', () => {
    expect(platformTagsVisible(['qq', 'lark'], 'lark')).toBe(true)
    expect(platformTagsVisible(['qq', 'lark'], 'dingtalk')).toBe(false)
  })
})
