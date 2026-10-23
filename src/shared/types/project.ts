// @ts-nocheck
// src/shared/types/project.ts

/**
 * 主适配器 = 项目跑在哪个平台。
 *
 * 'napcat' 是 OneBot 时代的遗留值：10/18 起新建项目只允许 official / lark / dingtalk
 * （与 `src/main/schemas/project.ts` 的 createProjectSchema 一致），但老的 NapCat 项目存档
 * 还在磁盘上，读取路径要能认出它，所以保留在联合类型里。
 */
export type AdapterType = 'official' | 'lark' | 'dingtalk' | 'napcat'

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

export interface NapcatConfig {
  port: number
  token?: string
  napcatPath?: string
}

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

/**
 * 额外启用的多平台适配器（不含主 adapter）。
 *
 * 设计说明：
 * - 主 adapter（`adapter` 字段）保持 'napcat' | 'official' 不变，决定 QQ 接入方式
 * - `botAdapters` 数组列出额外启用的非 QQ 平台适配器（如 Feishu/Kook/Telegram 等）
 * - botManager 启动时把主 adapter 对应的 OneBot V11 + botAdapters 合并写到 .env 的 BOT_ADAPTERS
 * - 空数组表示只用主 adapter（向后兼容，不写 BOT_ADAPTERS，bot.py 默认回退 OneBot V11）
 *
 * 显示名对应 bot.py 内置 `_ADAPTER_MAP` 的 key：
 *   'OneBot V11' | 'OneBot V12' | 'QQ' | 'Telegram' | 'Discord'
 *   | 'Kook' | 'Feishu' | 'Mirai2' | 'Satori' | 'Console'
 */
export type BotAdapterName =
  | 'OneBot V11'
  | 'OneBot V12'
  | 'QQ'
  | 'Telegram'
  | 'Discord'
  | 'Kook'
  | 'Feishu'
  | 'Mirai2'
  | 'Satori'
  | 'Console'

/**
 * 各平台凭据（写入 .env 的平台配置）。
 *
 * key 是环境变量名（如 FEISHU_APP_ID），value 是凭据值。
 * 凭据不进 project.json 的明文，由 UI 临时持有并直接写到 .env 文件。
 * 但为简化首版实现，先存到 project.json 的 platformCredentials，后续可改为加密存储。
 */
export type PlatformCredentials = Record<string, string>

export interface ProjectConfig {
  name: string
  qq?: string
  adapter: AdapterType
  botType?: BotType
  templateId?: string
  napcat?: import('@shared/types/launch').NapCatConfig
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
  /**
   * 旧 Java/Python 混合架构的执行入口（bot.py 的 pythonPath）。
   *
   * ADR-003 之后 TS 运行时直接解释 .qqbat/flow.json，不再生成 bot.py ——
   * 这个字段只为**读出老项目存档**而保留，新建项目不会写它。
   */
  pythonPath?: string
  resourceLimit?: ResourceLimit
  // 端口块编号（1=1000块, 2=2000块...）。翻译器端口 = portBlock * 1000 + 1，NapCat端口 = portBlock * 1000 + 2
  portBlock?: number
  // 翻译器端口：自动分配（从 portBlock 计算），用户不可修改
  translatorPort?: number
  /**
   * 额外启用的多平台适配器（不含主 adapter）。
   * 空数组表示只用主 adapter，向后兼容旧行为。
   */
  botAdapters?: BotAdapterName[]
  /**
   * 各平台凭据。key 为平台显示名（如 'Feishu'），value 为环境变量字典（如 { FEISHU_APP_ID: '...', ... }）。
   * botManager 启动时把这些 key=value 追加到 .env。
   */
  platformCredentials?: Record<BotAdapterName, PlatformCredentials>
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
