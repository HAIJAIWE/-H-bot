// @ts-nocheck
// src/shared/types/project.ts

/**
 * 主适配器 = 项目跑在哪个平台。
 *
 * 'napcat' 已于 2026-10-24 彻底删除（用户只用 QQ 官方 API）；老存档里的该值读回时
 * 会被当成未知字符串，不再有类型分支。
 */
export type AdapterType = 'official' | 'lark' | 'dingtalk'

/**
 * 机器人类型（大类）
 *
 * 设计原则：
 * - 类型只用于分类，不绑定具体步骤节点
 * - 具体玩法由模板（FlowTemplate）决定，模板自带 botCategory 字段
 * - qq：QQ 平台项目（节点库显示「通用 + QQ 专属」）
 * - general：不绑平台（只显示通用节点）
 * - game：游戏玩法项目（RPG、修仙、武侠、卡牌、经营、答题…，平台同 qq）
 *
 * 旧值 'functional' 已由 migrateBotType() 迁移到 'general'，见
 * `src/shared/domain/project/botTypeConfig.ts`（迁移表只有那一处）。
 */
export type BotType = 'qq' | 'general' | 'game'

export interface OfficialConfig {
  appId: string
  appSecret: string
  // 沙箱环境开关
  sandbox?: boolean
  // WebSocket 地址（留空则自动获取）
  wsUrl?: string
  /** 落盘标记：appSecret 是否为 safeStorage 密文（明文历史配置无此字段） */
  _encrypted?: boolean
}

/** 飞书自建应用配置（10/18 与 official 并列的第二类主适配器）。 */
export interface LarkConfig {
  appId: string
  appSecret: string
  /** long-connection = 长连接（默认，不需要公网回调）；webhook = 明文回调 */
  eventMode?: 'long-connection' | 'webhook'
  /** 事件回调域名（webhook 模式用） */
  domain?: string
  /** 落盘标记：appSecret 是否为 safeStorage 密文 */
  _encrypted?: boolean
}

/** 钉钉企业内部应用配置（官方叫 AppKey / AppSecret，代码里是 clientId / clientSecret）。 */
export interface DingtalkConfig {
  clientId: string
  clientSecret: string
  /** 落盘标记：clientSecret 是否为 safeStorage 密文 */
  _encrypted?: boolean
}

export interface AiConfig {
  /**
   * 服务商 id（取自 `LLM_PRESET_IDS`）。
   *
   * 10/18 起运行期由 createProjectSchema 的 refine 对着 LLM_PRESET_IDS 校验；
   * 这里不再逐一枚举 —— 以前写死 glm/claude/openai/ollama，
   */
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
  /** 落盘标记：apiKey 是否为 safeStorage 密文（明文历史配置无此字段） */
  _encrypted?: boolean
}

export interface ResourceLimit {
  maxMemoryMB?: number
  maxCPUPercent?: number
}

export interface ProjectConfig {
  name: string
  qq?: string
  adapter: AdapterType
  botType?: BotType
  templateId?: string
  official?: OfficialConfig
  /** 飞书（adapter === lark 时才是主接入方式；同时也可能是额外启用的平台）。 */
  lark?: LarkConfig
  /** 钉钉（adapter === dingtalk 时才是主接入方式）。 */
  dingtalk?: DingtalkConfig
  /**
   * 项目级 AI 配置（界面上的「开发助手」）。
   *
   * 10/18 起可以**不配**：新建项目时 createProjectSchema.ai 是可选的，
   * 没配就走全局 ai-config.json（见 services/ai 的 resolveAuthorAiConfig）。
   */
  ai?: AiConfig
  resourceLimit?: ResourceLimit
  // 端口块编号（1=1000块, 2=2000块...）。翻译器端口 = portBlock * 1000 + 1
  portBlock?: number
  // 翻译器端口：自动分配（从 portBlock 计算），用户不可修改
  translatorPort?: number
  /** project.json 自身的结构版本（service 写入，用于以后的存档迁移）。 */
  projectSchemaVersion?: number
  createdAt: string
  updatedAt: string
}

export interface ProjectMeta {
  id: string
  name: string
  path: string
  qq?: string
  adapter: AdapterType
  botType?: BotType
  createdAt: string
  updatedAt: string
}

export interface RecentProject {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

export const SCHEMA_VERSION = '1.0' as const

export interface FlowFile {
  schemaVersion: string
  project: ProjectConfig
}
