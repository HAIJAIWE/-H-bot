// src/renderer/src/components/launch/playerItemsModel.ts
//
// 背包/装备这类**数组字段**的展示模型：把 `[{"name":"金创药","count":9}]`
// 变成「金创药 ×9 · 回血 30 · 价格 20」。
//
// ## 为什么需要查配置表
//
// 面板原来只知道「`bag` 是个数组」，于是 `JSON.stringify` 给你看一串文本 ——
// 它**不知道道具的属性是什么**。但项目自己建了配置表：
//
//   data/config/items.db → items 表
//   列: id, name, type, atk_bonus, def_bonus, heal, mp_heal, desc, level_req, price, element, sellable
//
// `bag` 里的 `name` 与 `items.name` 能对上，对上之后就能显示完整属性。
//
// ## 铁律：查不到就说查不到，不编
//
// 配置表里没有同名行时，只显示「名称 ×数量」并标注「配置表里没有」——
// **绝不猜测属性**。这跟"不造图标"是同一条纪律（`items` 表没有图标列，所以不显示图）。
import type { TableSchema } from '@shared/types/launch';
import { lookupMappedLabel } from '../../i18n/fieldLabels';

/** 配置表里的一行（按 name 建索引） */
export type ConfigRow = Record<string, unknown>;

/** 一张配置表：表名 + 列定义 + 按 name 索引的行 */
export interface ConfigTable {
  table: string;
  columns: string[];
  byName: Map<string, ConfigRow>;
}

/** 道具卡上要展示的一条属性 */
export interface ItemAttribute {
  /** 列名（原文，开发者核对用） */
  column: string;
  /** 中文标签 */
  label: string;
  /** 格式化后的值 */
  value: string;
}

/** 一件道具的展示模型 */
export interface ItemCardModel {
  /** 道具名（来自存档里的 name） */
  name: string;
  /** 数量（存档里的 count；缺省 1） */
  count: number;
  /** 从配置表查到的列（未命中时为空） */
  attributes: ItemAttribute[];
  /** 说明（配置表 desc 列） */
  description?: string;
  /** 配置表里有没有这件道具 */
  foundInConfig: boolean;
  /** 原始元素（「查看原始 JSON」用） */
  raw: unknown;
  /** 用于视觉区分的 emoji（从**真实 type 列**推，不是编的） */
  icon: string;
}

/**
 * 列名 → 文案 key（`items` 表这类配置表的通用列）。
 *
 * 值是 **i18n key**，取文案时走 `lookupMappedLabel` —— 不硬编码中文
 * （`tests/renderer/i18n/noHardcodedCopy.test.ts` 会拦）。
 */
const COLUMN_LABEL_KEYS: Record<string, string> = {
  type: 'data.field.type',
  atk_bonus: 'data.field.atkBonus',
  def_bonus: 'data.field.defBonus',
  heal: 'data.field.healHp',
  mp_heal: 'data.field.healMp',
  level_req: 'data.field.levelReq',
  price: 'data.field.price',
  element: 'data.field.element',
  sellable: 'data.field.sellable',
  desc: 'data.field.description',
};

/** 列名的显示标签；没有映射时回退列名本身（开发者能看懂原文列名） */
export function columnLabel(column: string): string {
  const key = COLUMN_LABEL_KEYS[column];
  return (key ? lookupMappedLabel(key) : undefined) ?? column;
}

/** `type` 列的值 → 视觉标记。只用**真实存在的 type 值**推，不做通用猜测。 */
const TYPE_ICONS: Record<string, string> = {
  weapon: '⚔️',
  armor: '🛡️',
  potion: '💊',
  consumable: '💊',
  material: '🪨',
  accessory: '💍',
  book: '📖',
  treasure: '🎁',
};

/** 从 schema 的列定义里取列名列表 */
export function columnsFromSchema(schema: TableSchema | null | undefined): string[] {
  if (!schema) return [];
  const fields = (schema as { fields?: { name: string }[] }).fields;
  if (Array.isArray(fields)) return fields.map((f) => f.name);
  return [];
}

/**
 * 把 `queryTable` 拿到的行建成配置表索引。
 *
 * 索引键是 `name` 列（配置表里道具的显示名）。表里没有 `name` 列时返回空索引 ——
 * 调用方据此知道"这张表不能用来解析道具"。
 */
export function buildConfigTable(table: string, columns: string[], rows: ConfigRow[]): ConfigTable {
  const byName = new Map<string, ConfigRow>();
  if (columns.includes('name')) {
    for (const row of rows) {
      const name = row.name;
      if (typeof name === 'string' && name && !byName.has(name)) byName.set(name, row);
    }
  }
  return { table, columns, byName };
}

/** `type` 列 → emoji；未知 type 给一个中性标记（不猜具体是什么） */
export function iconForType(type: unknown): string {
  if (typeof type !== 'string') return '📦';
  return TYPE_ICONS[type.toLowerCase()] ?? '📦';
}

/** 单列值 → 展示文本。布尔转「是/否」，其余 String() */
function formatColumn(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  // 布尔走 `data.yes/no`（i18n）—— 硬编码「是/否」会被 noHardcodedCopy 拦下
  if (typeof value === 'boolean') {
    return value
      ? (lookupMappedLabel('data.yes') ?? 'true')
      : (lookupMappedLabel('data.no') ?? 'false');
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 一件道具 → 展示模型。
 *
 * 数量取存档里的 `count`；属性取配置表同名行里**除 `id`/`name`/`desc` 外**的有值列
 * （`desc` 单独作为说明展示，避免在属性列表里重复）。
 */
export function buildItemCard(entry: unknown, config: ConfigTable | null): ItemCardModel | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const obj = entry as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : '';
  if (!name) return null;

  const rawCount = obj.count ?? obj.num ?? obj.amount ?? 1;
  const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 1;

  const configRow = config?.byName.get(name) ?? null;
  const attributes: ItemAttribute[] = [];
  let description: string | undefined;

  if (configRow && config) {
    for (const column of config.columns) {
      if (column === 'id' || column === 'name') continue;
      const formatted = formatColumn(configRow[column]);
      if (formatted === '') continue;
      // `sellable=0` 这种"无信息"的假值不展示，避免噪声
      if (
        (column === 'atk_bonus' ||
          column === 'def_bonus' ||
          column === 'heal' ||
          column === 'mp_heal') &&
        formatted === '0'
      ) {
        continue;
      }
      if (column === 'desc') {
        description = formatted;
        continue;
      }
      attributes.push({ column, label: columnLabel(column), value: formatted });
    }
  }

  return {
    name,
    count,
    attributes,
    description,
    foundInConfig: !!configRow,
    raw: entry,
    icon: iconForType(configRow?.type),
  };
}

/**
 * 判断一个数组值是否"看起来是道具列表"。
 *
 * 判据：非空数组，且**每个**元素都是对象并带 `name` 字符串。
 * 这样 `[{name,count}]` 会走道具卡，而 `[1,2,3]` / `["a","b"]` 不会。
 */
export function looksLikeItemList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (e) =>
      typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string',
  );
}

/**
 * 一批道具 → 卡片列表（按名称去重合并数量，保持初次出现顺序）。
 *
 * 存档里同一件道具可能出现多行（不同来源），合并后更好读。
 */
export function buildItemCards(list: unknown[], config: ConfigTable | null): ItemCardModel[] {
  const merged = new Map<string, ItemCardModel>();
  for (const entry of list) {
    const card = buildItemCard(entry, config);
    if (!card) continue;
    const prev = merged.get(card.name);
    if (prev) {
      prev.count += card.count;
      continue;
    }
    merged.set(card.name, card);
  }
  return [...merged.values()];
}
