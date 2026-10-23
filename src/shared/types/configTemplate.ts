// src/shared/types/configTemplate.ts
// 分层配置模板系统类型定义
// 三层架构：通用层(所有bot) → 玩法层(botCategory=game) → 模板层(特定templateId)

/** 配置字段定义（与 configService.FieldDefinition 兼容，避免循环依赖） */
export interface ConfigFieldDefinition {
  /** 英文字段名，如 'attack' */
  name: string
  /** 中文显示名，如 '攻击力' */
  label: string
  /** 字段类型 */
  type: 'integer' | 'real' | 'text' | 'boolean' | 'json' | 'enum'
  /** 描述 */
  description?: string
  /** 默认值（已序列化为字符串） */
  defaultValue?: unknown
  /** 是否非空 */
  notNull?: boolean
  /** enum 选项（仅 type='enum' 时有效） */
  enumValues?: string[]
  /** 数值最小值 */
  min?: number
  /** 数值最大值 */
  max?: number
}

/** 配置模板层标签 */
export type ConfigTemplateLayer = 'common' | 'game' | 'cultivation' | 'wuxia' | 'card' | 'management'

/** 单个配置表模板：建表 schema + 种子数据 */
export interface ConfigTableTemplate {
  /** 表名（英文标识，与磁盘文件名一致） */
  tableName: string
  /** 中文显示名 */
  displayName: string
  /** 字段定义（与 configService.FieldDefinition 兼容） */
  fields: ConfigFieldDefinition[]
  /** 种子数据行（可选，空表无种子） */
  seedRows?: Record<string, unknown>[]
}

/** 分层配置模板集合 */
export interface LayeredConfigTemplates {
  /** 通用层：所有 bot 共享（sign_in, game_defaults 等） */
  common: ConfigTableTemplate[]
  /** 玩法层：game 类共享（class_attrs, attr_formulas 等） */
  game: ConfigTableTemplate[]
  /** 模板层：按 templateId 命名的子目录（cultivation/wuxia/card/management） */
  templateSpecific: ConfigTableTemplate[]
}

/** 项目创建时初始化配置表所需上下文 */
export interface ConfigInitContext {
  /** 项目类型：functional 不初始化游戏玩法表，game 初始化玩法层 */
  botType: 'functional' | 'game'
  /** 玩法模板 ID（如 builtin-cultivation, gameplay-wuxia） */
  templateId?: string
}
