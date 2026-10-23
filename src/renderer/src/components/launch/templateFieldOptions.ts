// src/renderer/src/components/launch/templateFieldOptions.ts
//
// 数据模板编辑器的**选项表**：图标、字段类型的标签与颜色、字段分类。
//
// 纯数据 —— 加字段类型 / 改文案只动这里（`ALL_FIELD_TYPES` 由 FIELD_TYPE_LABELS 派生，保证两边不脱节）。

import { t } from '../../i18n';
import type { TemplateField } from '../../types/ipc';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 可选图标列表 */
export const ICON_OPTIONS = [
  '👤',
  '📅',
  '📊',
  '🔒',
  '⚙️',
  '💬',
  '⚔️',
  '🎮',
  '🏆',
  '💰',
  '🎒',
  '🎯',
  '🌟',
  '❤️',
  '⚡',
  '🛡️',
  '🏹',
  '💊',
  '📜',
  '🗺️',
];

/** 字段类型中文名 */
export const FIELD_TYPE_LABELS: Record<TemplateField['type'], string> = {
  get number() {
    return t('data.fieldtype.number');
  },
  get boolean() {
    return t('data.fieldtype.boolPair');
  },
  get text() {
    return t('data.fieldtype.text');
  },
  get date() {
    return t('data.fieldtype.date');
  },
  get datetime() {
    return t('data.fieldtype.datetime');
  },
  get json() {
    return t('data.fieldtype.json');
  },
  get enum() {
    return t('data.fieldtype.enumPick');
  },
};

/** 字段类型对应的标签颜色 */
export const FIELD_TYPE_COLORS: Record<TemplateField['type'], string> = {
  number: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  boolean: 'bg-purple-900/40 text-purple-300 border-purple-800/50',
  text: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50',
  date: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
  datetime: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
  json: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50',
  enum: 'bg-rose-900/40 text-rose-300 border-rose-800/50',
};

export const ALL_FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as TemplateField['type'][];

/**
 * 角色卡分类（FieldCategory）下拉选项。
 * 与 dataBrowserConstants.ts 的 FIELD_CLUSTERS 标签保持一致。
 * 留空（''）表示"未分类"，由角色卡自动按 FIELD_ALIASES 匹配。
 */
export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  {
    value: '',
    get label() {
      return t('data.common.uncategorized');
    },
  },
  {
    value: 'identity',
    get label() {
      return t('data.cluster.identity');
    },
  },
  {
    value: 'level',
    get label() {
      return t('data.cluster.levelProgress');
    },
  },
  {
    value: 'economy',
    get label() {
      return t('data.cluster.economy');
    },
  },
  {
    value: 'stats',
    get label() {
      return t('data.cluster.stats');
    },
  },
  {
    value: 'status',
    get label() {
      return t('data.field.status');
    },
  },
  {
    value: 'social_base',
    get label() {
      return t('data.cluster.social_base');
    },
  },
  {
    value: 'combat',
    get label() {
      return t('data.cluster.combat');
    },
  },
  {
    value: 'exploration',
    get label() {
      return t('data.field.mapProgress');
    },
  },
  {
    value: 'cultivation',
    get label() {
      return t('data.cluster.cultivation');
    },
  },
  {
    value: 'martial',
    get label() {
      return t('data.cluster.martial');
    },
  },
  {
    value: 'collection',
    get label() {
      return t('data.cluster.collection');
    },
  },
  {
    value: 'business',
    get label() {
      return t('data.cluster.business');
    },
  },
];
