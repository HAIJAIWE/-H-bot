export { BaseType, FieldConfig, CompositeTypeDef, SchemaDefinition, TypeRegistry } from './typeSystem'

export interface DataSource {
  name: string
  path: string
  format: 'sqlite' | 'json' | 'yaml'
}

/**
 * 角色卡字段分类（簇），用于在角色档案卡里按组分展示字段。
 * 与 dataBrowserConstants.ts 的 FieldCategory 保持一致。
 *
 * 设计目的：让 DataTemplate 的字段可声明所属分类，角色卡优先用模板声明的分类，
 * 未声明时 fallback 到 FIELD_ALIASES 硬编码映射。
 */
export type FieldCategory =
  | 'identity' | 'level' | 'economy' | 'combat' | 'exploration'
  | 'cultivation' | 'collection' | 'business' | 'martial'
  | 'social_base' | 'status' | 'stats'

export interface FieldSchema {
  name: string
  type: string
  label?: string
  description?: string
  options?: string[]
  min?: number
  max?: number
  /** 外键指向的表（配置表字段：refTable + refField 表示关联到哪张表的哪个字段） */
  refTable?: string
  /** 外键指向的字段名 */
  refField?: string
}

export interface TableSchema {
  name: string
  fields: FieldSchema[]
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  total: number
  /**
   * 下一页游标（keyset pagination）。
   * - 使用 cursor 参数分页时，返回当前页最后一行的 rowid，调用方下次传入即可获取下一页
   * - 当本页结果不足 pageSize 条时返回 null，表示已到末页
   * - 旧调用方（不传 cursor）可忽略此字段，完全向后兼容
   */
  nextCursor?: number | null
}

export interface SearchResult {
  source: string
  table: string
  rowid: number
  row: Record<string, unknown>
}

export interface DashboardStatus {
  running: boolean
  onlineTime: number
  messageCount: number
  groupCount: number
  memberCount: number
}

export interface TimelineItem {
  id: number
  time: string
  content: string
  type: 'message' | 'reply' | 'event'
}

export interface ConfigCategory {
  name: string
  file: string
  tableCount: number
  displayName: string
  description?: string
}

export interface RunningBot {
  projectPath: string
  pid: number
  startedAt: string
}

export interface GroupInfo {
  groupId: string
  groupName: string
  memberCount: number
}
