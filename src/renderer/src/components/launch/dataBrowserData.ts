// src/renderer/src/components/launch/dataBrowserData.ts
//
// **纯数据**：「玩家数据」面板的字段元信息 —— 表名/字段名的中文标签、编辑类型、enum 选项、
// 字段簇、别名映射（FIELD_ALIASES）、战斗字段词典。
//
// ## 为什么和逻辑分开
//
// `tests/guards/fileSize.test.ts` 早就把原来那个文件登记成「数据面板的字段映射表（半数据）——
// 里面混着判定逻辑，**长期该把逻辑抽出去**」。2026-10 照做了：本文件只剩"表"，
// 判定/格式化/提取在 fieldValues / fieldLabels / characterFields，对外入口仍是
// `dataBrowserConstants.ts`（barrel，消费方一行都不用改）。
//
// ⚠️ 文案一律用 **getter**（`get label() { return t(...) }`，本文件 200+ 处）：
// 这样 `setLocale` 之后文案才会跟着变（`tests/renderer/i18n/localeSubscription.test.ts` 盯着这件事）。
// 改成普通属性 = 文案在首次 import 时被冻结、切语言不生效。

import { t } from '../../i18n';
import { type FieldCategory } from '@shared/types/launch';
import { type BotType } from '@shared/types/project';

/** 玩家列表虚拟滚动的单行高度（px）—— 与渲染内容估算匹配（py-2 + 两行文本） */
export const PLAYER_ROW_HEIGHT = 56;
// 玩家列表**只有一条渲染路径**（全部走虚拟滚动），所以不再需要"超过 N 行才虚拟化"的阈值。
// 曾经按数量分两条（>50 虚拟 / ≤50 内联 map），后果是"改一处不生效" ——
// 2026-10-03 实测踩到：给行加了「删除玩家」按钮，而 11 个玩家走的是内联那条，看不到。

export const TABLE_DESCRIPTIONS: Record<string, { label: string; icon: string }> = {
  _persistent: {
    get label() {
      return t('data.table.player');
    },
    icon: 'ClipboardList',
  },
  players: {
    get label() {
      return t('data.group.basic');
    },
    icon: 'User',
  },
  inventory: {
    get label() {
      return t('data.table.inventory');
    },
    icon: 'Backpack',
  },
  sign_in: {
    get label() {
      return t('data.table.signIn');
    },
    icon: 'Calendar',
  },
  pets_owned: {
    get label() {
      return t('data.table.pets');
    },
    icon: 'PawPrint',
  },
  mounts_owned: {
    get label() {
      return t('data.table.mounts');
    },
    icon: 'Footprints',
  },
  achievements: {
    get label() {
      return t('data.table.achievements');
    },
    icon: 'Trophy',
  },
  quests_progress: {
    get label() {
      return t('data.table.quests');
    },
    icon: 'ClipboardList',
  },
  vip_records: {
    get label() {
      return t('data.table.vip');
    },
    icon: 'Gem',
  },
  lottery_records: {
    get label() {
      return t('data.table.lottery');
    },
    icon: 'Dices',
  },
  trades: {
    get label() {
      return t('data.table.trades');
    },
    icon: 'RefreshCw',
  },
  rankings_cache: {
    get label() {
      return t('data.table.rankings');
    },
    icon: 'BarChart3',
  },
  skills_owned: {
    get label() {
      return t('data.table.skills');
    },
    icon: 'Swords',
  },
};

/** 持久化 key 的中文映射（去掉前缀后的 key 部分） */
export const KEY_LABELS: Record<string, string> = {
  // 基础信息
  uid: 'UID',
  get nickname() {
    return t('data.field.nickname');
  },
  get registered_at() {
    return t('data.field.registeredAt');
  },
  get last_active() {
    return t('data.field.lastActive');
  },
  // 权限管理
  get permission() {
    return t('data.field.permissionLevel');
  },
  get remark() {
    return t('data.field.remark');
  },
  // 签到系统
  get signin_count() {
    return t('data.field.signinCount');
  },
  get signin_streak() {
    return t('data.field.signinStreak');
  },
  get signin_total() {
    return t('data.field.signinTotalDays');
  },
  get signin_total_days() {
    return t('data.field.signinTotalDays');
  },
  get last_signin_date() {
    return t('data.field.lastSigninDate');
  },
  get signin_reward() {
    return t('data.field.signinReward');
  },
  // 等级系统（可选）
  get level() {
    return t('data.field.level');
  },
  get exp() {
    return t('data.field.exp');
  },
  get experience() {
    return t('data.field.exp');
  },
  get exp_to_next() {
    return t('data.field.expToNext');
  },
  // 经济系统（可选）
  get points() {
    return t('data.field.points');
  },
  get coins() {
    return t('data.field.gold');
  },
  get gold() {
    return t('data.field.gold');
  },
  get silver() {
    return t('data.field.silver');
  },
  get diamond() {
    return t('data.field.diamond');
  },
  get gems() {
    return t('data.field.gems');
  },
  get balance() {
    return t('data.field.balance');
  },
  // 行为统计
  get message_count() {
    return t('data.field.messageCount');
  },
  get total_messages() {
    return t('data.field.totalMessages');
  },
  get command_count() {
    return t('data.field.commandCount');
  },
  get active_days() {
    return t('data.field.activeDays');
  },
  get last_command() {
    return t('data.field.lastCommand');
  },
  get total_play_time() {
    return t('data.field.playTime');
  },
  // 账号状态
  get is_banned() {
    return t('data.field.banStatus');
  },
  get ban_status() {
    return t('data.field.banStatus');
  },
  get ban_until() {
    return t('data.field.banUntil');
  },
  get is_muted() {
    return t('data.field.muteStatus');
  },
  get mute_status() {
    return t('data.field.muteStatus');
  },
  get mute_until() {
    return t('data.field.muteUntil');
  },
  get warn_count() {
    return t('data.field.warnCount');
  },
  // 冷却机制
  get cooldowns() {
    return t('data.field.cooldowns');
  },
  get cooldown() {
    return t('data.field.cooldown');
  },
  // 称号系统
  get title() {
    return t('data.field.title');
  },
  get titles_owned() {
    return t('data.field.titlesOwned');
  },
  // 偏好设置
  get notify_enabled() {
    return t('data.field.notifyEnabled');
  },
  get preferences() {
    return t('data.field.preferences');
  },
  // 群信息
  get group_joined_at() {
    return t('data.field.groupJoinedAt');
  },
  get current_groups() {
    return t('data.field.currentGroups');
  },
  // 互动记录
  get interaction_count() {
    return t('data.field.interactionCount');
  },
  get reputation() {
    return t('data.field.reputation');
  },
  // 探索进度
  get current_map() {
    return t('data.field.currentMap');
  },
  get current_zone() {
    return t('data.field.currentZone');
  },
  get current_location() {
    return t('data.field.currentLocation');
  },
  get map_progress() {
    return t('data.field.mapProgress');
  },
  get explored() {
    return t('data.field.explored');
  },
  get story_progress() {
    return t('data.field.storyProgress');
  },
  get quest_name() {
    return t('data.field.questName');
  },
  get quest_stage() {
    return t('data.field.questStage');
  },
  // 战斗属性（RPG扩展）
  get hp() {
    return t('data.field.hp');
  },
  get mp() {
    return t('data.field.mp');
  },
  get attack() {
    return t('data.field.attack');
  },
  get defense() {
    return t('data.field.defense');
  },
  get speed() {
    return t('data.field.speed');
  },
  get luck() {
    return t('data.field.luck');
  },
  get rpg_hp_max() {
    return t('data.field.hpMax');
  },
  get rpg_monster_name() {
    return t('data.field.monsterName');
  },
  get rpg_monster_hp() {
    return t('data.field.monsterHp');
  },
  get rpg_monster_atk() {
    return t('data.field.monsterAtk');
  },
  // VIP
  get vip_level() {
    return t('data.field.vipLevel');
  },
  get vip_exp() {
    return t('data.field.vipExp');
  },
  // 装备（RPG扩展）
  get equipped_weapon() {
    return t('data.field.equippedWeapon');
  },
  get equipped_armor() {
    return t('data.field.equippedArmor');
  },
  get equipped_mount() {
    return t('data.field.equippedMount');
  },
};

/** 字段分组配置 */
export const FIELD_GROUPS: { id: string; label: string; icon: string; fields: string[] }[] = [
  {
    id: 'basic',
    get label() {
      return t('data.group.basic');
    },
    icon: 'User',
    fields: ['registered_at', 'last_active', 'last_active_date', 'title', 'permission'],
  },
  {
    id: 'signin',
    get label() {
      return t('data.group.signin');
    },
    icon: 'Calendar',
    fields: ['signin_count', 'signin_streak', 'signin_total', 'last_signin_date'],
  },
  {
    id: 'stats',
    get label() {
      return t('data.group.stats');
    },
    icon: 'BarChart3',
    fields: ['message_count', 'command_count', 'active_days', 'last_command', 'interaction_count'],
  },
  {
    id: 'status',
    get label() {
      return t('data.group.status');
    },
    icon: 'Lock',
    fields: ['is_banned', 'ban_until', 'is_muted', 'mute_until', 'warn_count'],
  },
  {
    id: 'pref',
    get label() {
      return t('data.group.prefs');
    },
    icon: 'Settings',
    fields: ['notify_enabled', 'cooldowns'],
  },
  {
    id: 'social',
    get label() {
      return t('data.group.social');
    },
    icon: 'MessageCircle',
    fields: ['reputation'],
  },
];

/** 字段编辑器类型 */
export type FieldType = 'number' | 'boolean' | 'text' | 'date' | 'datetime' | 'json' | 'enum';

export const FIELD_TYPES: Record<string, FieldType> = {
  registered_at: 'datetime',
  last_active: 'datetime',
  last_active_date: 'date',
  title: 'text',
  permission: 'enum',
  signin_count: 'number',
  signin_streak: 'number',
  signin_total: 'number',
  last_signin_date: 'date',
  message_count: 'number',
  command_count: 'number',
  active_days: 'number',
  last_command: 'text',
  interaction_count: 'number',
  is_banned: 'boolean',
  ban_until: 'datetime',
  is_muted: 'boolean',
  mute_until: 'datetime',
  warn_count: 'number',
  notify_enabled: 'boolean',
  cooldowns: 'json',
  reputation: 'number',
};

/** enum 选项 */
export const FIELD_ENUMS: Record<string, { value: string; label: string }[]> = {
  permission: [
    {
      value: 'member',
      get label() {
        return t('data.perm.member');
      },
    },
    {
      value: 'admin',
      get label() {
        return t('data.perm.admin');
      },
    },
    {
      value: 'owner',
      get label() {
        return t('data.perm.owner');
      },
    },
  ],
};

/** 通用列名中文映射（schema 不存在时使用） */
export const COLUMN_LABELS: Record<string, string> = {
  get key() {
    return t('data.field.key');
  },
  get value() {
    return t('data.field.value');
  },
  get scope() {
    return t('data.field.scope');
  },
  qq: 'QQ',
  get user_id() {
    return t('data.field.userId');
  },
  get qq_number() {
    return t('data.field.qqNumber');
  },
  get nickname() {
    return t('data.field.nickname');
  },
  get name() {
    return t('data.field.name');
  },
  get player_name() {
    return t('data.field.playerName');
  },
  get updated_at() {
    return t('data.field.updatedAt');
  },
  get created_at() {
    return t('data.field.createdAt');
  },
  get level() {
    return t('data.field.level');
  },
  get exp() {
    return t('data.field.exp');
  },
  get hp() {
    return t('data.field.hp');
  },
  get mp() {
    return t('data.field.mp');
  },
  get attack() {
    return t('data.field.attack');
  },
  get defense() {
    return t('data.field.defense');
  },
  get count() {
    return t('data.field.count');
  },
  get amount() {
    return t('data.field.amount');
  },
  get description() {
    return t('data.field.description');
  },
  get status() {
    return t('data.field.status');
  },
  get type() {
    return t('data.field.type');
  },
};

// ============================================================
// 机器人类型 → 角色卡字段簇映射
//
// 设计原则：
// - 基础簇（identity/growth/economy/stats/status/social_base）所有机器人共有
// - 游戏专属簇按玩法差异划分（combat/battle/exploration/cultivation/martial/collection/business）
// - 社交是基础能力，所有类型都包含 social_base
// - 联合玩法未来通过簇并集实现，当前架构支持
// ============================================================

/** 角色卡字段簇 */
export type FieldCluster =
  | 'identity'
  | 'growth'
  | 'economy'
  | 'stats'
  | 'status'
  | 'social_base'
  | 'combat'
  | 'battle'
  | 'exploration'
  | 'cultivation'
  | 'martial'
  | 'collection'
  | 'business';

/** 字段簇定义 */
export interface ClusterDef {
  id: FieldCluster;
  label: string;
  icon: string;
  /** 该簇是否只在非功能型的游戏类型中展示 */
  gameOnly: boolean;
}

export const FIELD_CLUSTERS: Record<FieldCluster, ClusterDef> = {
  // ========== 基础簇（所有机器人共有） ==========
  identity: {
    id: 'identity',
    get label() {
      return t('data.cluster.identity');
    },
    icon: 'User',
    gameOnly: false,
  },
  growth: {
    id: 'growth',
    get label() {
      return t('data.cluster.growth');
    },
    icon: 'TrendingUp',
    gameOnly: false,
  },
  economy: {
    id: 'economy',
    get label() {
      return t('data.cluster.economy');
    },
    icon: 'Wallet',
    gameOnly: false,
  },
  stats: {
    id: 'stats',
    get label() {
      return t('data.cluster.stats');
    },
    icon: 'BarChart3',
    gameOnly: false,
  },
  status: {
    id: 'status',
    get label() {
      return t('data.field.status');
    },
    icon: 'Tag',
    gameOnly: false,
  },
  social_base: {
    id: 'social_base',
    get label() {
      return t('data.cluster.social_base');
    },
    icon: 'Users',
    gameOnly: false,
  },
  // ========== 游戏专属簇 ==========
  combat: {
    id: 'combat',
    get label() {
      return t('data.cluster.combat');
    },
    icon: 'Swords',
    gameOnly: true,
  },
  battle: {
    id: 'battle',
    get label() {
      return t('data.cluster.battle');
    },
    icon: 'Crosshair',
    gameOnly: true,
  },
  exploration: {
    id: 'exploration',
    get label() {
      return t('data.field.mapProgress');
    },
    icon: 'Compass',
    gameOnly: true,
  },
  cultivation: {
    id: 'cultivation',
    get label() {
      return t('data.cluster.cultivation');
    },
    icon: 'Sparkles',
    gameOnly: true,
  },
  martial: {
    id: 'martial',
    get label() {
      return t('data.cluster.martial');
    },
    icon: 'Swords',
    gameOnly: true,
  },
  collection: {
    id: 'collection',
    get label() {
      return t('data.cluster.collection');
    },
    icon: 'Dices',
    gameOnly: true,
  },
  business: {
    id: 'business',
    get label() {
      return t('data.cluster.business');
    },
    icon: 'Factory',
    gameOnly: true,
  },
};

/** 每个机器人类型展示的字段簇（顺序决定渲染顺序） */
export const BOT_TYPE_CLUSTERS: Record<BotType, FieldCluster[]> = {
  // QQ 官方 / 通用：同一套字段分组（两者的区别在**节点库**显示什么，不在数据面板）
  qq: ['identity', 'growth', 'economy', 'stats', 'status', 'social_base'],
  general: ['identity', 'growth', 'economy', 'stats', 'status', 'social_base'],
  game: ['identity', 'growth', 'combat', 'economy', 'stats', 'status', 'social_base', 'battle'],
};

// FieldCategory 类型已移至 @shared/types/launch，本文件通过顶部 import type 引入使用。
// 其他文件如需 FieldCategory，请从 @shared/types/launch 直接导入。

/** 字段别名映射：key 的各种可能命名 → 标准分类 + 中文标签 */
export interface FieldAlias {
  category: FieldCategory;
  label: string;
  /** 显示优先级（越小越靠前） */
  priority: number;
  /** 是否适合用进度条展示（如 hp/exp） */
  progressBar?: boolean;
  /** 进度条的最大值字段名（如 hp 的 max 是 hp_max） */
  maxField?: string;
  /** 语义色（tailwind 类名） */
  color?: string;
}

export const FIELD_ALIASES: Record<string, FieldAlias> = {
  // ========== 身份类 ==========
  uid: { category: 'identity', label: 'UID', priority: 0 },
  nickname: {
    category: 'identity',
    get label() {
      return t('data.field.nickname');
    },
    priority: 1,
  },
  name: {
    category: 'identity',
    get label() {
      return t('data.field.name');
    },
    priority: 2,
  },
  player_name: {
    category: 'identity',
    get label() {
      return t('data.field.playerName');
    },
    priority: 3,
  },
  registered_at: {
    category: 'identity',
    get label() {
      return t('data.field.registeredAt');
    },
    priority: 10,
  },
  last_active: {
    category: 'identity',
    get label() {
      return t('data.field.lastActive');
    },
    priority: 11,
  },
  last_active_date: {
    category: 'identity',
    get label() {
      return t('data.field.lastActive');
    },
    priority: 12,
  },
  group_joined_at: {
    category: 'identity',
    get label() {
      return t('data.field.groupJoinedAt');
    },
    priority: 13,
  },
  current_groups: {
    category: 'identity',
    get label() {
      return t('data.field.currentGroups');
    },
    priority: 14,
  },

  // ========== 成长（等级/经验/VIP） ==========
  level: {
    category: 'level',
    get label() {
      return t('data.field.level');
    },
    priority: 0,
    color: 'text-amber-400',
  },
  rpg_level: {
    category: 'level',
    get label() {
      return t('data.field.level');
    },
    priority: 0,
    color: 'text-amber-400',
  },
  vip_level: {
    category: 'level',
    get label() {
      return t('data.field.vipLevel');
    },
    priority: 1,
    color: 'text-amber-400',
  },
  exp: {
    category: 'level',
    get label() {
      return t('data.field.exp');
    },
    priority: 2,
    color: 'text-blue-400',
    progressBar: true,
    maxField: 'exp_to_next',
  },
  experience: {
    category: 'level',
    get label() {
      return t('data.field.exp');
    },
    priority: 2,
    color: 'text-blue-400',
    progressBar: true,
    maxField: 'exp_to_next',
  },
  rpg_experience: {
    category: 'level',
    get label() {
      return t('data.field.exp');
    },
    priority: 2,
    color: 'text-blue-400',
  },
  vip_exp: {
    category: 'level',
    get label() {
      return t('data.field.vipExp');
    },
    priority: 3,
    color: 'text-blue-400',
  },
  exp_to_next: {
    category: 'level',
    get label() {
      return t('data.field.expToNextShort');
    },
    priority: 4,
  },
  titles_owned: {
    category: 'level',
    get label() {
      return t('data.field.titlesOwned');
    },
    priority: 5,
  },

  // ========== 经济 ==========
  gold: {
    category: 'economy',
    get label() {
      return t('data.field.gold');
    },
    priority: 0,
    color: 'text-yellow-400',
  },
  rpg_gold: {
    category: 'economy',
    get label() {
      return t('data.field.gold');
    },
    priority: 0,
    color: 'text-yellow-400',
  },
  coins: {
    category: 'economy',
    get label() {
      return t('data.field.gold');
    },
    priority: 0,
    color: 'text-yellow-400',
  },
  points: {
    category: 'economy',
    get label() {
      return t('data.field.points');
    },
    priority: 1,
    color: 'text-cyan-400',
  },
  silver: {
    category: 'economy',
    get label() {
      return t('data.field.silver');
    },
    priority: 2,
  },
  diamond: {
    category: 'economy',
    get label() {
      return t('data.field.diamond');
    },
    priority: 3,
    color: 'text-cyan-300',
  },
  gems: {
    category: 'economy',
    get label() {
      return t('data.field.gems');
    },
    priority: 4,
  },
  balance: {
    category: 'economy',
    get label() {
      return t('data.field.balance');
    },
    priority: 5,
  },
  potions: {
    category: 'economy',
    get label() {
      return t('data.field.potions');
    },
    priority: 6,
  },
  rpg_potions: {
    category: 'economy',
    get label() {
      return t('data.field.potions');
    },
    priority: 6,
  },
  spirit_stones: {
    category: 'economy',
    get label() {
      return t('data.field.spiritStones');
    },
    priority: 7,
    color: 'text-purple-400',
  },
  lingshi: {
    category: 'economy',
    get label() {
      return t('data.field.spiritStones');
    },
    priority: 7,
    color: 'text-purple-400',
  },
  contribution: {
    category: 'economy',
    get label() {
      return t('data.field.contribution');
    },
    priority: 8,
  },
  merit: {
    category: 'economy',
    get label() {
      return t('data.field.merit');
    },
    priority: 9,
  },

  // ========== 战斗属性（RPG 通用） ==========
  hp: {
    category: 'combat',
    get label() {
      return t('data.field.hp');
    },
    priority: 0,
    color: 'text-green-400',
    progressBar: true,
    maxField: 'hp_max',
  },
  rpg_hp: {
    category: 'combat',
    get label() {
      return t('data.field.hp');
    },
    priority: 0,
    color: 'text-green-400',
    progressBar: true,
    maxField: 'rpg_hp_max',
  },
  hp_max: {
    category: 'combat',
    get label() {
      return t('data.field.hpMax');
    },
    priority: 10,
  },
  rpg_hp_max: {
    category: 'combat',
    get label() {
      return t('data.field.hpMax');
    },
    priority: 10,
  },
  mp: {
    category: 'combat',
    get label() {
      return t('data.field.mp');
    },
    priority: 1,
    color: 'text-blue-300',
    progressBar: true,
    maxField: 'mp_max',
  },
  mp_max: {
    category: 'combat',
    get label() {
      return t('data.field.mpMax');
    },
    priority: 11,
  },
  atk: {
    category: 'combat',
    get label() {
      return t('data.field.attack');
    },
    priority: 2,
    color: 'text-red-400',
  },
  rpg_atk: {
    category: 'combat',
    get label() {
      return t('data.field.attack');
    },
    priority: 2,
    color: 'text-red-400',
  },
  attack: {
    category: 'combat',
    get label() {
      return t('data.field.attack');
    },
    priority: 2,
    color: 'text-red-400',
  },
  def: {
    category: 'combat',
    get label() {
      return t('data.field.defense');
    },
    priority: 3,
  },
  defense: {
    category: 'combat',
    get label() {
      return t('data.field.defense');
    },
    priority: 3,
  },
  speed: {
    category: 'combat',
    get label() {
      return t('data.field.speed');
    },
    priority: 4,
  },
  luck: {
    category: 'combat',
    get label() {
      return t('data.field.luckShort');
    },
    priority: 5,
  },
  crit_rate: {
    category: 'combat',
    get label() {
      return t('data.field.critRate');
    },
    priority: 6,
    color: 'text-red-400',
  },
  crit_damage: {
    category: 'combat',
    get label() {
      return t('data.field.critDamage');
    },
    priority: 7,
    color: 'text-red-400',
  },
  rpg_class: {
    category: 'combat',
    get label() {
      return t('data.field.class');
    },
    priority: 6,
    color: 'text-purple-400',
  },
  class: {
    category: 'combat',
    get label() {
      return t('data.field.class');
    },
    priority: 6,
    color: 'text-purple-400',
  },
  stamina: {
    category: 'combat',
    get label() {
      return t('data.field.stamina');
    },
    priority: 7,
    color: 'text-orange-400',
    progressBar: true,
    maxField: 'stamina_max',
  },
  stamina_max: {
    category: 'combat',
    get label() {
      return t('data.field.staminaMax');
    },
    priority: 12,
  },
  energy: {
    category: 'combat',
    get label() {
      return t('data.field.energy');
    },
    priority: 8,
    color: 'text-orange-400',
    progressBar: true,
    maxField: 'energy_max',
  },
  energy_max: {
    category: 'combat',
    get label() {
      return t('data.field.energyMax');
    },
    priority: 13,
  },
  equipped_weapon: {
    category: 'combat',
    get label() {
      return t('data.field.equippedWeapon');
    },
    priority: 14,
  },
  equipped_armor: {
    category: 'combat',
    get label() {
      return t('data.field.equippedArmor');
    },
    priority: 15,
  },
  equipped_mount: {
    category: 'combat',
    get label() {
      return t('data.field.equippedMount');
    },
    priority: 16,
  },

  // ========== 探索进度（RPG） ==========
  current_map: {
    category: 'exploration',
    get label() {
      return t('data.field.currentMap');
    },
    priority: 0,
    color: 'text-emerald-400',
  },
  current_zone: {
    category: 'exploration',
    get label() {
      return t('data.field.currentZone');
    },
    priority: 1,
  },
  current_location: {
    category: 'exploration',
    get label() {
      return t('data.field.currentLocation');
    },
    priority: 2,
  },
  map_progress: {
    category: 'exploration',
    get label() {
      return t('data.field.mapProgress');
    },
    priority: 3,
    color: 'text-emerald-400',
    progressBar: true,
    maxField: 'map_total',
  },
  map_total: {
    category: 'exploration',
    get label() {
      return t('data.field.mapTotal');
    },
    priority: 8,
  },
  explored: {
    category: 'exploration',
    get label() {
      return t('data.field.exploredShort');
    },
    priority: 4,
  },
  story_progress: {
    category: 'exploration',
    get label() {
      return t('data.field.storyProgress');
    },
    priority: 5,
    color: 'text-purple-400',
    progressBar: true,
    maxField: 'story_total',
  },
  story_total: {
    category: 'exploration',
    get label() {
      return t('data.field.storyTotal');
    },
    priority: 9,
  },
  quest_name: {
    category: 'exploration',
    get label() {
      return t('data.field.questName');
    },
    priority: 6,
  },
  quest_stage: {
    category: 'exploration',
    get label() {
      return t('data.field.questStage');
    },
    priority: 7,
  },

  // ========== 修仙修真（cultivation） ==========
  realm: {
    category: 'cultivation',
    get label() {
      return t('data.field.realm');
    },
    priority: 0,
    color: 'text-purple-400',
  },
  realm_level: {
    category: 'cultivation',
    get label() {
      return t('data.field.realmLevel');
    },
    priority: 1,
    color: 'text-purple-400',
  },
  cultivation_exp: {
    category: 'cultivation',
    get label() {
      return t('data.cluster.cultivation');
    },
    priority: 2,
    color: 'text-purple-400',
    progressBar: true,
    maxField: 'cultivation_to_next',
  },
  cultivation_to_next: {
    category: 'cultivation',
    get label() {
      return t('data.field.cultivationToNext');
    },
    priority: 10,
  },
  qi: {
    category: 'cultivation',
    get label() {
      return t('data.field.qi');
    },
    priority: 3,
    color: 'text-cyan-400',
  },
  linggen: {
    category: 'cultivation',
    get label() {
      return t('data.field.spiritRoot');
    },
    priority: 4,
    color: 'text-cyan-400',
  },
  spirit_root: {
    category: 'cultivation',
    get label() {
      return t('data.field.spiritRoot');
    },
    priority: 4,
    color: 'text-cyan-400',
  },
  foundation: {
    category: 'cultivation',
    get label() {
      return t('data.field.foundation');
    },
    priority: 5,
  },
  dao_xing: {
    category: 'cultivation',
    get label() {
      return t('data.field.daoXing');
    },
    priority: 6,
    color: 'text-purple-400',
  },
  merit_value: {
    category: 'cultivation',
    get label() {
      return t('data.field.meritValue');
    },
    priority: 7,
    color: 'text-amber-400',
  },
  karma: {
    category: 'cultivation',
    get label() {
      return t('data.field.karma');
    },
    priority: 8,
  },
  inner_demon: {
    category: 'cultivation',
    get label() {
      return t('data.field.innerDemon');
    },
    priority: 9,
    color: 'text-red-400',
  },
  tribulation_count: {
    category: 'cultivation',
    get label() {
      return t('data.field.tribulationCount');
    },
    priority: 11,
  },
  tribulation_success: {
    category: 'cultivation',
    get label() {
      return t('data.field.tribulationSuccess');
    },
    priority: 12,
  },
  dan_pills: {
    category: 'cultivation',
    get label() {
      return t('data.field.danPills');
    },
    priority: 13,
  },
  danfang_level: {
    category: 'cultivation',
    get label() {
      return t('data.field.danfangLevel');
    },
    priority: 14,
  },
  artifacts: {
    category: 'cultivation',
    get label() {
      return t('data.field.artifacts');
    },
    priority: 15,
  },
  artifact_count: {
    category: 'cultivation',
    get label() {
      return t('data.field.artifactCount');
    },
    priority: 16,
  },
  techniques: {
    category: 'cultivation',
    get label() {
      return t('data.field.techniques');
    },
    priority: 17,
  },
  technique_count: {
    category: 'cultivation',
    get label() {
      return t('data.field.techniqueCount');
    },
    priority: 18,
  },
  sect_id: {
    category: 'cultivation',
    get label() {
      return t('data.field.sectId');
    },
    priority: 19,
  },
  sect_name: {
    category: 'cultivation',
    get label() {
      return t('data.field.sectName');
    },
    priority: 20,
    color: 'text-emerald-400',
  },
  sect_role: {
    category: 'cultivation',
    get label() {
      return t('data.field.sectRole');
    },
    priority: 21,
  },
  master: {
    category: 'cultivation',
    get label() {
      return t('data.field.master');
    },
    priority: 22,
  },
  apprentices: {
    category: 'cultivation',
    get label() {
      return t('data.field.apprentices');
    },
    priority: 23,
  },

  // ========== 武侠 MUD（wuxia） ==========
  // 注：sect_id/sect_name 归入 cultivation（修仙宗门系统更完善），
  // 武侠门派用 sect/sect_position/martial_sect_id 等专属字段
  sect: {
    category: 'martial',
    get label() {
      return t('data.field.martialSect');
    },
    priority: 0,
    color: 'text-emerald-400',
  },
  martial_sect_id: {
    category: 'martial',
    get label() {
      return t('data.field.martialSectId');
    },
    priority: 1,
  },
  sect_position: {
    category: 'martial',
    get label() {
      return t('data.field.sectPosition');
    },
    priority: 2,
  },
  inner_skill: {
    category: 'martial',
    get label() {
      return t('data.field.innerSkill');
    },
    priority: 3,
    color: 'text-purple-400',
  },
  inner_skill_level: {
    category: 'martial',
    get label() {
      return t('data.field.innerSkillLevel');
    },
    priority: 4,
  },
  outer_skill: {
    category: 'martial',
    get label() {
      return t('data.field.outerSkill');
    },
    priority: 5,
    color: 'text-red-400',
  },
  outer_skill_level: {
    category: 'martial',
    get label() {
      return t('data.field.outerSkillLevel');
    },
    priority: 6,
  },
  light_skill: {
    category: 'martial',
    get label() {
      return t('data.field.lightSkill');
    },
    priority: 7,
    color: 'text-cyan-400',
  },
  light_skill_level: {
    category: 'martial',
    get label() {
      return t('data.field.lightSkillLevel');
    },
    priority: 8,
  },
  martial_arts: {
    category: 'martial',
    get label() {
      return t('data.field.martialArts');
    },
    priority: 9,
  },
  martial_count: {
    category: 'martial',
    get label() {
      return t('data.field.martialCount');
    },
    priority: 10,
  },
  jianghu_reputation: {
    category: 'martial',
    get label() {
      return t('data.field.jianghuReputation');
    },
    priority: 11,
    color: 'text-amber-400',
  },
  jianghu_exp: {
    category: 'martial',
    get label() {
      return t('data.field.jianghuExp');
    },
    priority: 12,
  },
  righteousness: {
    category: 'martial',
    get label() {
      return t('data.field.righteousness');
    },
    priority: 13,
    color: 'text-emerald-400',
  },
  evil_value: {
    category: 'martial',
    get label() {
      return t('data.field.evilValue');
    },
    priority: 14,
    color: 'text-red-400',
  },
  martial_level: {
    category: 'martial',
    get label() {
      return t('data.field.martialLevel');
    },
    priority: 15,
    color: 'text-amber-400',
  },
  sparring_count: {
    category: 'martial',
    get label() {
      return t('data.field.sparringCount');
    },
    priority: 16,
  },
  pvp_win: {
    category: 'martial',
    get label() {
      return t('data.field.pvpWin');
    },
    priority: 17,
  },
  pvp_lose: {
    category: 'martial',
    get label() {
      return t('data.field.pvpLose');
    },
    priority: 18,
  },

  // ========== 卡牌收集（card） ==========
  card_count: {
    category: 'collection',
    get label() {
      return t('data.field.cardCount');
    },
    priority: 0,
    color: 'text-amber-400',
  },
  gacha_count: {
    category: 'collection',
    get label() {
      return t('data.field.gachaCount');
    },
    priority: 1,
  },
  gacha_pity: {
    category: 'collection',
    get label() {
      return t('data.field.gachaPity');
    },
    priority: 2,
    color: 'text-purple-400',
    progressBar: true,
    maxField: 'gacha_pity_max',
  },
  gacha_pity_max: {
    category: 'collection',
    get label() {
      return t('data.field.gachaPityMax');
    },
    priority: 10,
  },
  card_level: {
    category: 'collection',
    get label() {
      return t('data.field.cardLevel');
    },
    priority: 3,
    color: 'text-orange-400',
  },
  rarity_points: {
    category: 'collection',
    get label() {
      return t('data.field.rarity');
    },
    priority: 4,
    color: 'text-purple-400',
  },
  card_deck: {
    category: 'collection',
    get label() {
      return t('data.field.cardDeck');
    },
    priority: 5,
  },
  deck_count: {
    category: 'collection',
    get label() {
      return t('data.field.deckCount');
    },
    priority: 6,
  },
  collection_rate: {
    category: 'collection',
    get label() {
      return t('data.field.collectionRate');
    },
    priority: 7,
    color: 'text-emerald-400',
    progressBar: true,
    maxField: 'collection_total',
  },
  collection_total: {
    category: 'collection',
    get label() {
      return t('data.field.collectionTotal');
    },
    priority: 11,
  },
  fragments: {
    category: 'collection',
    get label() {
      return t('data.field.fragments');
    },
    priority: 8,
  },
  card_stars: {
    category: 'collection',
    get label() {
      return t('data.field.cardStars');
    },
    priority: 9,
    color: 'text-amber-400',
  },
  legendary_count: {
    category: 'collection',
    get label() {
      return t('data.field.legendaryCount');
    },
    priority: 12,
    color: 'text-amber-400',
  },
  epic_count: {
    category: 'collection',
    get label() {
      return t('data.field.epicCount');
    },
    priority: 13,
    color: 'text-purple-400',
  },

  // ========== 模拟经营（management） ==========
  building_count: {
    category: 'business',
    get label() {
      return t('data.field.buildingCount');
    },
    priority: 0,
    color: 'text-emerald-400',
  },
  farm_level: {
    category: 'business',
    get label() {
      return t('data.field.farmLevel');
    },
    priority: 1,
    color: 'text-green-400',
  },
  shop_level: {
    category: 'business',
    get label() {
      return t('data.field.shopLevel');
    },
    priority: 2,
    color: 'text-emerald-400',
  },
  factory_level: {
    category: 'business',
    get label() {
      return t('data.field.factoryLevel');
    },
    priority: 3,
  },
  stock: {
    category: 'business',
    get label() {
      return t('data.field.stock');
    },
    priority: 4,
  },
  warehouse_cap: {
    category: 'business',
    get label() {
      return t('data.field.warehouseCap');
    },
    priority: 5,
  },
  production_rate: {
    category: 'business',
    get label() {
      return t('data.field.productionRate');
    },
    priority: 6,
  },
  harvest_count: {
    category: 'business',
    get label() {
      return t('data.field.harvestCount');
    },
    priority: 7,
  },
  employee_count: {
    category: 'business',
    get label() {
      return t('data.field.employeeCount');
    },
    priority: 8,
  },
  order_count: {
    category: 'business',
    get label() {
      return t('data.field.orderCount');
    },
    priority: 9,
  },
  order_completed: {
    category: 'business',
    get label() {
      return t('data.field.orderCompleted');
    },
    priority: 10,
  },
  prosperity: {
    category: 'business',
    get label() {
      return t('data.field.prosperity');
    },
    priority: 11,
    color: 'text-amber-400',
    progressBar: true,
    maxField: 'prosperity_max',
  },
  prosperity_max: {
    category: 'business',
    get label() {
      return t('data.field.prosperityMax');
    },
    priority: 12,
  },
  raw_materials: {
    category: 'business',
    get label() {
      return t('data.field.rawMaterials');
    },
    priority: 13,
  },
  products: {
    category: 'business',
    get label() {
      return t('data.field.products');
    },
    priority: 14,
  },
  daily_revenue: {
    category: 'business',
    get label() {
      return t('data.field.dailyRevenue');
    },
    priority: 15,
    color: 'text-yellow-400',
  },

  // ========== 社交基础（所有类型共有） ==========
  married_to: {
    category: 'social_base',
    get label() {
      return t('data.field.marriedTo');
    },
    priority: 0,
  },
  intimacy: {
    category: 'social_base',
    get label() {
      return t('data.field.intimacy');
    },
    priority: 1,
    color: 'text-pink-400',
  },
  master_id: {
    category: 'social_base',
    get label() {
      return t('data.field.masterId');
    },
    priority: 2,
  },
  apprentice_count: {
    category: 'social_base',
    get label() {
      return t('data.field.apprenticeCount');
    },
    priority: 3,
  },
  friends_count: {
    category: 'social_base',
    get label() {
      return t('data.field.friendsCount');
    },
    priority: 4,
  },
  guild_id: {
    category: 'social_base',
    get label() {
      return t('data.field.guildId');
    },
    priority: 5,
  },
  guild_name: {
    category: 'social_base',
    get label() {
      return t('data.field.guildName');
    },
    priority: 6,
    color: 'text-emerald-400',
  },
  guild_role: {
    category: 'social_base',
    get label() {
      return t('data.field.guildRole');
    },
    priority: 7,
  },
  rank_score: {
    category: 'social_base',
    get label() {
      return t('data.field.rankScore');
    },
    priority: 8,
    color: 'text-amber-400',
  },
  rank_tier: {
    category: 'social_base',
    get label() {
      return t('data.field.rankTier');
    },
    priority: 9,
    color: 'text-amber-400',
  },
  win_count: {
    category: 'social_base',
    get label() {
      return t('data.field.winCount');
    },
    priority: 10,
  },
  lose_count: {
    category: 'social_base',
    get label() {
      return t('data.field.loseCount');
    },
    priority: 11,
  },
  season: {
    category: 'social_base',
    get label() {
      return t('data.field.season');
    },
    priority: 12,
  },

  // ========== 状态（所有类型通用，角色卡头部展示为标签） ==========
  title: {
    category: 'status',
    get label() {
      return t('data.field.titleShort');
    },
    priority: 0,
    color: 'text-amber-400',
  },
  permission: {
    category: 'status',
    get label() {
      return t('data.field.permissionShort');
    },
    priority: 1,
  },
  is_banned: {
    category: 'status',
    get label() {
      return t('data.field.banned');
    },
    priority: 2,
  },
  is_muted: {
    category: 'status',
    get label() {
      return t('data.field.muted');
    },
    priority: 3,
  },
  ban_until: {
    category: 'status',
    get label() {
      return t('data.field.banUntil');
    },
    priority: 4,
  },
  mute_until: {
    category: 'status',
    get label() {
      return t('data.field.muteUntil');
    },
    priority: 5,
  },
  warn_count: {
    category: 'status',
    get label() {
      return t('data.field.warned');
    },
    priority: 6,
  },
  ban_status: {
    category: 'status',
    get label() {
      return t('data.field.banStatus');
    },
    priority: 7,
  },
  mute_status: {
    category: 'status',
    get label() {
      return t('data.field.muteStatus');
    },
    priority: 8,
  },

  // ========== 数据统计（所有类型通用） ==========
  signin_count: {
    category: 'stats',
    get label() {
      return t('data.field.signinCount');
    },
    priority: 0,
  },
  signin_streak: {
    category: 'stats',
    get label() {
      return t('data.field.signinStreak');
    },
    priority: 1,
  },
  signin_total: {
    category: 'stats',
    get label() {
      return t('data.field.signinTotalShort');
    },
    priority: 2,
  },
  signin_total_days: {
    category: 'stats',
    get label() {
      return t('data.field.signinTotalDays');
    },
    priority: 3,
  },
  last_signin_date: {
    category: 'stats',
    get label() {
      return t('data.field.lastSigninShort');
    },
    priority: 4,
  },
  signin_reward: {
    category: 'stats',
    get label() {
      return t('data.field.signinReward');
    },
    priority: 5,
  },
  message_count: {
    category: 'stats',
    get label() {
      return t('data.field.messageCount');
    },
    priority: 6,
  },
  total_messages: {
    category: 'stats',
    get label() {
      return t('data.field.totalMessages');
    },
    priority: 7,
  },
  command_count: {
    category: 'stats',
    get label() {
      return t('data.field.commandCountShort');
    },
    priority: 8,
  },
  active_days: {
    category: 'stats',
    get label() {
      return t('data.field.activeDays');
    },
    priority: 9,
  },
  last_command: {
    category: 'stats',
    get label() {
      return t('data.field.lastCommand');
    },
    priority: 10,
  },
  total_play_time: {
    category: 'stats',
    get label() {
      return t('data.field.playTime');
    },
    priority: 11,
  },
  interaction_count: {
    category: 'stats',
    get label() {
      return t('data.field.interactionCount');
    },
    priority: 12,
  },
  reputation: {
    category: 'stats',
    get label() {
      return t('data.field.reputationShort');
    },
    priority: 13,
  },
  cooldowns: {
    category: 'stats',
    get label() {
      return t('data.field.cooldowns');
    },
    priority: 14,
  },
  cooldown: {
    category: 'stats',
    get label() {
      return t('data.field.cooldown');
    },
    priority: 15,
  },
};

/** 战斗状态检测：key 包含这些关键词则认为是战斗相关字段（归入 battleFields，只在战斗卡展示） */
export const BATTLE_KEYWORDS = ['in_battle', 'monster', 'battle'];

/** 战斗详情字段的中文标签（monster_* 等） */
export const BATTLE_FIELD_LABELS: Record<string, string> = {
  get rpg_monster_name() {
    return t('data.field.monster');
  },
  get monster_name() {
    return t('data.field.monster');
  },
  get rpg_monster_hp() {
    return t('data.field.monsterHp');
  },
  get monster_hp() {
    return t('data.field.monsterHp');
  },
  get rpg_monster_atk() {
    return t('data.field.monsterAtk');
  },
  get monster_atk() {
    return t('data.field.monsterAtk');
  },
  get rpg_monster_def() {
    return t('data.field.monsterDef');
  },
  get monster_def() {
    return t('data.field.monsterDef');
  },
};

export interface PlayerSummary {
  qq: string;
  recordCount: number;
  sources: string[];
}

/** 带 UID 映射的玩家信息（由 getPlayersWithUid 返回） */
export interface PlayerWithUid {
  uid: string;
  openid: string | null;
  nickname?: string;
  recordCount: number;
  sources: string[];
}

/** 获取指定机器人类型对应的角色卡簇 ID 列表 */
export function getClustersForBotType(botType: BotType | undefined): FieldCluster[] {
  return BOT_TYPE_CLUSTERS[botType ?? 'general'] || BOT_TYPE_CLUSTERS.general;
}
