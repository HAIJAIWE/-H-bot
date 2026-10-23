import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { getDb } from './dataService'
import type { FieldCategory } from '@shared/types/launch'

export interface TemplateField {
  key: string        // 字段名，如 "signin_count"
  label: string      // 中文标签，如 "签到次数"
  type: 'number' | 'boolean' | 'text' | 'date' | 'datetime' | 'json' | 'enum'
  default?: unknown      // 默认值
  auto?: boolean     // 是否自动管理（如注册时间，不允许手动编辑）
  options?: { value: string; label: string }[]  // enum类型的选项
  description?: string  // 字段说明
  /**
   * 角色卡字段分类（可选）。声明后角色档案卡优先用此分类把字段归入对应簇展示。
   * 未声明时 fallback 到 dataBrowserConstants.FIELD_ALIASES 硬编码映射。
   */
  category?: FieldCategory
}

export interface TemplateGroup {
  id: string         // 分组ID，如 "basic"
  label: string      // 分组名，如 "基础信息"
  icon: string       // 图标emoji，如 "👤"
  fields: TemplateField[]
}

export interface DataTemplate {
  version: number
  groups: TemplateGroup[]
}

/** 权限枚举选项（与 DataBrowserPanel.tsx 的 FIELD_ENUMS 保持一致） */
const PERMISSION_OPTIONS: { value: string; label: string }[] = [
  { value: 'member', label: '普通成员' },
  { value: 'admin', label: '管理员' },
  { value: 'owner', label: '群主' },
]

/**
 * 返回默认数据模板。
 * 包含 6 大基础分组，共 22 个字段。
 * 字段分组与类型与 src/renderer/src/components/launch/DataBrowserPanel.tsx
 * 中的 FIELD_GROUPS / FIELD_TYPES / FIELD_ENUMS 保持一致。
 *
 * 每个字段都声明了 category，作为字段分类的示范，并确保即使 FIELD_ALIASES
 * 变更也能保持一致的角色卡分组行为。
 */
export function getDefaultTemplate(): DataTemplate {
  return {
    version: 1,
    groups: [
      {
        id: 'basic',
        label: '基础信息',
        icon: '👤',
        fields: [
          { key: 'registered_at', label: '注册时间', type: 'datetime', auto: true, description: '首次注册时间，自动生成', category: 'identity' },
          { key: 'last_active', label: '最后活跃', type: 'datetime', auto: true, description: '最后活跃时间，自动更新', category: 'identity' },
          { key: 'last_active_date', label: '最后活跃日期', type: 'date', auto: true, description: '最后活跃日期，自动更新', category: 'identity' },
          { key: 'title', label: '当前称号', type: 'text', default: '新人', description: '玩家当前称号', category: 'status' },
          { key: 'permission', label: '权限等级', type: 'enum', default: 'member', options: PERMISSION_OPTIONS, description: '权限等级：普通成员/管理员/群主', category: 'status' },
        ],
      },
      {
        id: 'signin',
        label: '签到系统',
        icon: '📅',
        fields: [
          { key: 'signin_count', label: '签到次数', type: 'number', default: 0, description: '累计签到次数', category: 'stats' },
          { key: 'signin_streak', label: '连续签到', type: 'number', default: 0, description: '当前连续签到天数', category: 'stats' },
          { key: 'signin_total', label: '累计签到天数', type: 'number', default: 0, description: '历史累计签到天数', category: 'stats' },
          { key: 'last_signin_date', label: '上次签到日期', type: 'date', default: '', description: '最后一次签到日期', category: 'stats' },
        ],
      },
      {
        id: 'stats',
        label: '行为统计',
        icon: '📊',
        fields: [
          { key: 'message_count', label: '消息数', type: 'number', default: 0, description: '累计消息数', category: 'stats' },
          { key: 'command_count', label: '命令次数', type: 'number', default: 0, description: '累计使用命令次数', category: 'stats' },
          { key: 'active_days', label: '活跃天数', type: 'number', default: 1, description: '活跃天数统计', category: 'stats' },
          { key: 'last_command', label: '最后命令', type: 'text', default: '', description: '最后使用的命令', category: 'stats' },
          { key: 'interaction_count', label: '互动次数', type: 'number', default: 0, description: '与机器人互动总次数', category: 'stats' },
        ],
      },
      {
        id: 'status',
        label: '账号状态',
        icon: '🔒',
        fields: [
          { key: 'is_banned', label: '封禁状态', type: 'boolean', default: false, description: '是否被封禁', category: 'status' },
          { key: 'ban_until', label: '封禁截止', type: 'datetime', default: '', description: '封禁截止时间，空表示永久', category: 'status' },
          { key: 'is_muted', label: '禁言状态', type: 'boolean', default: false, description: '是否被禁言', category: 'status' },
          { key: 'mute_until', label: '禁言截止', type: 'datetime', default: '', description: '禁言截止时间，空表示永久', category: 'status' },
          { key: 'warn_count', label: '警告次数', type: 'number', default: 0, description: '累计警告次数', category: 'status' },
        ],
      },
      {
        id: 'pref',
        label: '偏好设置',
        icon: '⚙️',
        fields: [
          { key: 'notify_enabled', label: '通知开关', type: 'boolean', default: true, description: '是否接收通知', category: 'status' },
          { key: 'cooldowns', label: '冷却记录', type: 'json', default: {}, description: '命令冷却记录，JSON对象', category: 'stats' },
        ],
      },
      {
        id: 'social',
        label: '互动记录',
        icon: '💬',
        fields: [
          { key: 'reputation', label: '威望值', type: 'number', default: 0, description: '玩家威望值', category: 'stats' },
        ],
      },
    ],
  }
}

/**
 * 读取项目的数据模板。
 * 文件位于 `projectPath/.qqbat/data_template.json`，不存在则返回默认模板。
 */
export function getDataTemplate(projectPath: string): DataTemplate {
  const filePath = join(projectPath, '.qqbat', 'data_template.json')
  if (!existsSync(filePath)) {
    return getDefaultTemplate()
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    // 基本结构校验，缺失关键字段时回退到默认模板
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups)) {
      return getDefaultTemplate()
    }
    return parsed as DataTemplate
  } catch {
    // 模板文件损坏时回退默认模板
    return getDefaultTemplate()
  }
}

/**
 * 保存数据模板到 `projectPath/.qqbat/data_template.json`。
 * 保存后自动将新字段同步到已有玩家的 _persistent 表。
 */
export function saveDataTemplate(projectPath: string, template: DataTemplate): void {
  const dir = join(projectPath, '.qqbat')
  const filePath = join(dir, 'data_template.json')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8')
  // 保存后同步到已有玩家
  syncTemplateToPlayers(projectPath, template)
}

/**
 * 将模板中所有字段同步到已有玩家的 _persistent 表。
 * 仅对当前不存在的字段写入默认值，不覆盖已有数据。
 */
function syncTemplateToPlayers(projectPath: string, template: DataTemplate): void {
  const dbPath = join(projectPath, 'data', 'players', 'persistent.db')
  if (!existsSync(dbPath)) return
  const db = getDb(dbPath)
  // 收集所有已有玩家的 user_id
  const rows = db.prepare(
    "SELECT DISTINCT REPLACE(key, 'user_', '') AS uid FROM _persistent WHERE scope = 'user'"
  ).all() as { uid: string }[]
  const uids = rows.map(r => r.uid).filter(Boolean)
  if (uids.length === 0) return

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO _persistent (key, value, scope, qq) VALUES (?, ?, 'user', ?)"
  )
  const tx = db.transaction(() => {
    for (const group of template.groups) {
      for (const field of group.fields) {
        if (field.auto) continue // auto 字段不预填充
        const defVal = field.default !== undefined ? field.default : ''
        const valStr = JSON.stringify(defVal)
        for (const uid of uids) {
          const fullKey = `user_${uid}:${field.key}`
          insertStmt.run(fullKey, valStr, uid)
        }
      }
    }
  })
  tx()
}
