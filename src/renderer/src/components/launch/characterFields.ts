// src/renderer/src/components/launch/characterFields.ts
//
// **角色卡字段提取 + 战斗字段判定**：`extractCharacterFields` 是「玩家数据」面板角色卡的
// 数据源（把 _persistent 的扁平行拆成 身份/成长/战斗/其它 四类可渲染字段）。
//
// 判定顺序（改这里之前先读）：模板声明的 category 优先 → 回退 FIELD_ALIASES → 战斗词典
//（BATTLE_KEYWORDS）兜底。分类错了的表现是"字段跑到别的卡上"，不会报错。
//
// 本文件还带着一个模块私有常量 CATEGORY_ORDER（提取时的分类顺序）。

import { type DataTemplate } from '../../types/ipc';
import {
  BATTLE_FIELD_LABELS,
  BATTLE_KEYWORDS,
  FIELD_ALIASES,
  type FieldCluster,
} from './dataBrowserData';
import { formatValue, getRawKey, isEmptyValue } from './fieldValues';
import { decodePersistentValue } from '@shared/persist/value';
import { type FieldCategory } from '@shared/types/launch';

/** 从 _persistent 行数组中提取角色卡字段 */
export interface ExtractedField {
  key: string; // 原始 key（含前缀）
  label: string; // 中文标签
  value: string; // 格式化后的值
  category: FieldCategory;
  priority: number;
  color?: string;
  progressBar?: boolean;
  maxField?: string;
  maxValue?: string; // 如果有 maxField 且找到了对应的值
}

/** category 显示顺序 */
const CATEGORY_ORDER: FieldCategory[] = [
  'identity',
  'level',
  'economy',
  'combat',
  'exploration',
  'cultivation',
  'martial',
  'collection',
  'business',
  'social_base',
  'status',
  'stats',
];

/** category → cluster 映射 */
export const CATEGORY_TO_CLUSTER: Record<FieldCategory, FieldCluster> = {
  identity: 'identity',
  level: 'growth',
  economy: 'economy',
  combat: 'combat',
  exploration: 'exploration',
  cultivation: 'cultivation',
  martial: 'martial',
  collection: 'collection',
  business: 'business',
  social_base: 'social_base',
  status: 'status',
  stats: 'stats',
};

/** 判断 key 是否为战斗状态字段（归入 battleFields，只在战斗卡展示） */
export function isBattleField(key: string): boolean {
  const lower = key.toLowerCase();
  return BATTLE_KEYWORDS.some(function (kw) {
    return lower.includes(kw);
  });
}

/** 判断 key 是否为"在战斗中"的布尔状态 */
export function isInBattleField(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === 'in_battle' || lower === 'rpg_in_battle' || lower === 'battling';
}

/**
 * 判断是否为游戏型机器人（存在 rpg_* 字段）
 *
 * 游戏型机器人会在 _persistent 中存储 rpg_class / rpg_hp / rpg_atk 等字段，
 * 功能型机器人（纯签到/积分/群管）则没有这些字段。
 * 角色卡根据此结果切换两种展示模式：
 * - 游戏型：完整模式（簇分组展示，含进度条 + 战斗卡）
 * - 功能型：精简模式（只展示基础信息 + 经济/统计网格）
 */
export function isGameMode(persistentRows: Record<string, unknown>[]): boolean {
  return persistentRows.some(function (r) {
    const key = String(r.key ?? '');
    const raw = getRawKey(key);
    return raw.startsWith('rpg_');
  });
}

/** 判断字段是否为"0 值也需展示"的关键字段（如 hp=0 表示死亡，是有意义的状态） */
export function isCriticalField(rawKey: string): boolean {
  const k = rawKey.toLowerCase();
  return (
    k === 'hp' ||
    k === 'rpg_hp' ||
    k === 'mp' ||
    k === 'rpg_mp' ||
    k === 'level' ||
    k === 'rpg_level' ||
    k === 'rpg_in_battle' ||
    k === 'stamina' ||
    k === 'energy'
  );
}

/** 综合判断字段是否应该展示（空值 + 关键字段判断） */
export function shouldDisplayField(field: { value: string }, rawKey: string): boolean {
  if (isCriticalField(rawKey)) return field.value !== '—' && field.value !== '';
  return !isEmptyValue(field.value);
}

/**
 * 从持久化行数组中提取角色卡字段
 *
 * - 遍历每行，用 getRawKey 去前缀后查 FIELD_ALIASES
 * - 战斗字段（isBattleField）单独提取到 battleFields
 * - 匹配到的归入 characterFields，按 category 顺序 + priority 排序
 * - 未匹配的归入 otherFields
 *
 * @param persistentRows 玩家数据行
 * @param template 可选的数据模板。若提供，会优先使用模板中字段声明的 category，
 *                 label 也会优先采用模板标签；color/progressBar/maxField 仍由 FIELD_ALIASES 提供。
 *                 模板未声明 category 的字段回退到 FIELD_ALIASES。
 */
export function extractCharacterFields(
  persistentRows: Record<string, unknown>[],
  template?: DataTemplate | null,
): {
  characterFields: ExtractedField[];
  battleFields: ExtractedField[];
  otherFields: { key: string; label: string; value: string }[];
} {
  const characterFields: ExtractedField[] = [];
  const battleFields: ExtractedField[] = [];
  const otherFields: { key: string; label: string; value: string }[] = [];

  // 构建 rawKey → { category, label } 映射（来自模板声明）
  const templateFieldMap = new Map<string, { category: FieldCategory; label: string }>();
  if (template) {
    for (const group of template.groups) {
      for (const f of group.fields) {
        if (f.category) {
          const rk = getRawKey(f.key);
          // 同一 rawKey 多次出现时保留首次声明
          if (!templateFieldMap.has(rk)) {
            templateFieldMap.set(rk, { category: f.category, label: f.label });
          }
        }
      }
    }
  }

  // 先收集 rawKey → 行 的映射，用于查找 maxField 的值
  const rawToRow = new Map<string, Record<string, unknown>>();
  persistentRows.forEach(function (r) {
    const fullKey = String(r.key ?? '');
    if (fullKey === '') return;
    const rawKey = getRawKey(fullKey);
    if (!rawToRow.has(rawKey)) rawToRow.set(rawKey, r);
  });

  persistentRows.forEach(function (r) {
    const fullKey = String(r.key ?? '');
    if (fullKey === '') return;
    const rawKey = getRawKey(fullKey);
    // `_persistent.value` 存的是 `{"value":x,"expire_at":t}` 包装（见 shared/persist/value.ts）。
    // 不解包的话，玩家卡上会直接显示存储格式 —— 用户看到 `经验值 {"value":55,"expire_at":null}`。
    const decoded = decodePersistentValue(r.value);
    const value = decoded.value;

    // 战斗状态字段单独提取（monster_*/in_battle 等，只在战斗卡展示）
    if (isBattleField(rawKey)) {
      const label = BATTLE_FIELD_LABELS[rawKey] || rawKey;
      battleFields.push({
        key: fullKey,
        label: label,
        value: formatValue(value, 'value'),
        category: 'combat',
        priority: 99,
      });
      return;
    }

    // 查找别名映射
    const alias = FIELD_ALIASES[rawKey];
    // 查找模板声明
    const tplDecl = templateFieldMap.get(rawKey);
    if (alias || tplDecl) {
      // 模板声明的 category 优先；否则回退到 alias.category
      const category = tplDecl?.category || alias?.category || 'stats';
      // 模板声明的 label 优先（仅当非空）；否则回退到 alias.label；最后回退到 rawKey
      const label = tplDecl && tplDecl.label ? tplDecl.label : alias?.label || rawKey;
      let maxValue: string | undefined;
      if (alias?.maxField) {
        const maxRow = rawToRow.get(alias.maxField);
        // maxField 指向的也是 `_persistent` 行，同样需要解包
        if (maxRow) maxValue = formatValue(decodePersistentValue(maxRow.value).value, 'value');
      }
      characterFields.push({
        key: fullKey,
        label: label,
        value: formatValue(value, 'value'),
        category: category,
        priority: alias?.priority ?? 50,
        color: alias?.color,
        progressBar: alias?.progressBar,
        maxField: alias?.maxField,
        maxValue: maxValue,
      });
      return;
    }

    // 未匹配的字段归入 otherFields
    otherFields.push({
      key: fullKey,
      label: rawKey,
      value: formatValue(value, 'value'),
    });
  });

  // characterFields 按 category 顺序 + priority 排序
  characterFields.sort(function (a, b) {
    const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    return a.priority - b.priority;
  });

  // battleFields 按 priority 排序
  battleFields.sort(function (a, b) {
    return a.priority - b.priority;
  });

  return { characterFields: characterFields, battleFields: battleFields, otherFields: otherFields };
}
