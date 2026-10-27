// src/shared/domain/platform/registry.ts
//
// 平台注册表：一个平台在仓库里有三种叫法 ——
//   1. 项目接入方式 `ProjectConfig.adapter`（'official' | 'lark' | 'dingtalk'）；
//   2. 适配器配置里的 platform id（'qq-official' / 'qq-gateway' / 'lark' / …，
//      词表在 shared/domain/common/capabilities.ts 的 PlatformIdSchema）；
//   3. 节点 tags 里的历史中文标签（'QQ' / '飞书' / '微信' / '钉钉'）。
//
// 以前它们分头维护：节点库过滤读中文标签（botTypeConfig.PLATFORM_TAGS），画布徽标读
// `spec.platform`（'all' | 'qq'），新增一个平台要改两处、且两边会漂移。这里统一成
// **PlatformFamily**：节点过滤与徽标都从 spec 推导 family，新增平台只改下面的 FAMILIES。
//
// 边界：本模块只做纯映射与判定 —— 不读文件、不依赖 i18n 运行时，main / renderer / 测试
// 都能直接 import；label 中英各存一份，由调用方按当前语言取。
// 平台专属节点的登记纪律见 docs/ai/agent-core-wiring.md §64。

/** 平台族：对外统一的平台标识（一个族可含多个适配器 platform id） */
export type PlatformFamily =
  | 'qq'
  | 'lark'
  | 'dingtalk'
  | 'wechat'
  | 'kook'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'sandbox'
  | 'minecraft'

/** 节点平台标注：'all' = 跨平台通用（默认，未标注时视为它），其余 = 某平台专属 */
export type NodePlatformTag = 'all' | PlatformFamily

interface PlatformFamilyDef {
  id: PlatformFamily
  label: { zh: string; en: string }
  /** 适配器配置的 platform id（与 capabilities.ts 的 PlatformIdSchema 同源） */
  platformIds: readonly string[]
  /** `ProjectConfig.adapter` 的取值 */
  projectAdapters: readonly string[]
  /** 节点 tags 里的历史中文标签 */
  legacyTags: readonly string[]
}

const FAMILIES: readonly PlatformFamilyDef[] = [
  {
    id: 'qq',
    label: { zh: 'QQ', en: 'QQ' },
    platformIds: ['qq-official', 'qq-gateway'],
    projectAdapters: ['official'],
    legacyTags: ['QQ'],
  },
  {
    id: 'lark',
    label: { zh: '飞书', en: 'Feishu' },
    platformIds: ['lark'],
    projectAdapters: ['lark'],
    legacyTags: ['飞书'],
  },
  {
    id: 'dingtalk',
    label: { zh: '钉钉', en: 'DingTalk' },
    platformIds: ['dingtalk'],
    projectAdapters: ['dingtalk'],
    legacyTags: ['钉钉'],
  },
  {
    // 企业微信（wecom）与公众号（wechat-mp）对外是同一个平台族：节点标签只有一个「微信」
    id: 'wechat',
    label: { zh: '微信', en: 'WeChat' },
    platformIds: ['wecom', 'wechat-mp'],
    projectAdapters: [],
    legacyTags: ['微信'],
  },
  {
    id: 'kook',
    label: { zh: 'KOOK', en: 'KOOK' },
    platformIds: ['kook'],
    projectAdapters: [],
    legacyTags: ['KOOK'],
  },
  {
    id: 'telegram',
    label: { zh: 'Telegram', en: 'Telegram' },
    platformIds: ['telegram'],
    projectAdapters: [],
    legacyTags: ['Telegram'],
  },
  {
    id: 'discord',
    label: { zh: 'Discord', en: 'Discord' },
    platformIds: ['discord'],
    projectAdapters: [],
    legacyTags: ['Discord'],
  },
  {
    id: 'slack',
    label: { zh: 'Slack', en: 'Slack' },
    platformIds: ['slack'],
    projectAdapters: [],
    legacyTags: ['Slack'],
  },
  {
    id: 'sandbox',
    label: { zh: '本地沙箱', en: 'Sandbox' },
    platformIds: ['sandbox'],
    projectAdapters: [],
    legacyTags: [],
  },
  {
    id: 'minecraft',
    label: { zh: 'Minecraft', en: 'Minecraft' },
    platformIds: ['minecraft'],
    projectAdapters: [],
    legacyTags: [],
  },
]

const BY_ID = new Map<PlatformFamily, PlatformFamilyDef>(FAMILIES.map(f => [f.id, f]))
const BY_PLATFORM_ID = new Map<string, PlatformFamily>(
  FAMILIES.flatMap(f => f.platformIds.map(id => [id, f.id] as const)),
)
const BY_ADAPTER = new Map<string, PlatformFamily>(
  FAMILIES.flatMap(f => f.projectAdapters.map(a => [a, f.id] as const)),
)
const BY_LEGACY_TAG = new Map<string, PlatformFamily>(
  FAMILIES.flatMap(f => f.legacyTags.map(t => [t, f.id] as const)),
)

/** 平台族的显示名（未知 platform id 原样返回，宁可显示原文也不显示空白） */
export function platformLabel(family: PlatformFamily, locale?: string): string {
  const def = BY_ID.get(family)
  if (!def) return family
  return locale?.toLowerCase().startsWith('en') ? def.label.en : def.label.zh
}

/**
 * 项目当前属于哪个平台族。
 *
 * 优先级：**接入方式（adapter）** 胜过 botType —— 飞书/钉钉项目的 botType 通常是
 * 'general'（历史原因：botType 只有 qq/general/game 三档），若按 botType 判会落到
 * "不绑平台"，把飞书/钉钉专属节点全挡掉。adapter 才是真正的平台声明。
 * 没有 adapter 平台信息时：qq / game 型项目按 qq 处理，其余视为不绑平台。
 */
export function projectPlatformFamily(
  project: { adapter?: string | null; botType?: string | null } | null | undefined,
): PlatformFamily | undefined {
  if (!project) return undefined
  const byAdapter = project.adapter ? BY_ADAPTER.get(project.adapter) : undefined
  if (byAdapter) return byAdapter
  if (project.botType === 'qq' || project.botType === 'game') return 'qq'
  return undefined
}

/**
 * 节点属于哪些平台族（可能为空 = 跨平台通用）。
 *
 * 两个来源取并集：
 *   - 显式 `platform` 标注（'all' 不算平台）；
 *   - tags 里的历史中文标签（存量节点只有这个）。
 */
export function nodePlatformTags(
  spec: { platform?: string; tags?: readonly string[] } | null | undefined,
): PlatformFamily[] {
  if (!spec) return []
  const out = new Set<PlatformFamily>()
  if (spec.platform && spec.platform !== 'all') {
    const byId = BY_PLATFORM_ID.get(spec.platform)
    if (byId) out.add(byId)
    else if (BY_ID.has(spec.platform as PlatformFamily)) out.add(spec.platform as PlatformFamily)
    else {
      const byTag = BY_LEGACY_TAG.get(spec.platform)
      if (byTag) out.add(byTag)
    }
  }
  for (const tag of spec.tags ?? []) {
    const fam = BY_LEGACY_TAG.get(tag)
    if (fam) out.add(fam)
  }
  return [...out]
}

/**
 * 这个节点在当前平台下是否该出现在节点库里。
 *
 * 规则只有一条：**不带平台标注的（通用）永远可见；带标注的只有本平台可见**。
 * `family` 为 null（不绑平台的项目）时只显示通用节点。
 */
export function specVisibleOnPlatform(
  spec: { platform?: string; tags?: readonly string[] },
  family: PlatformFamily | null,
): boolean {
  const fams = nodePlatformTags(spec)
  if (fams.length === 0) return true
  return family !== null && fams.includes(family)
}
