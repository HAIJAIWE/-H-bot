// src/renderer/src/components/launch/fieldLabels.ts
//
// **标签与说明的解析**：有 schema（数据模板声明的）就用 schema，查不到回退到内置表。
//
// 口径要一致：字段名、列名、说明三处都走这里，否则同一个字段在面板、编辑弹窗、
// 角色卡里会显示成三个不同的名字。

import { COLUMN_LABELS, KEY_LABELS } from './dataBrowserData';
import { type FieldSchema, type TableSchema } from '@shared/types/launch';

/** 获取 key 的中文标签（模块级版本，组件内有动态版本覆盖） */
export function getKeyLabel(key: string): string {
  // 去掉前缀 user_xxx: 或 group_xxx: 或 config:
  const parts = key.split(':');
  const rawKey = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
  return KEY_LABELS[rawKey] || rawKey;
}

/** 单列名 → 显示名（schema 里查不到该列时用）。查不到时回退为列名本身 */
export function columnLabel(fieldName: string): string {
  return COLUMN_LABELS[fieldName] || fieldName;
}

export function getFieldLabel(tableName: string, fieldName: string, schema: TableSchema[]): string {
  const tbl = schema.find((t) => t.name === tableName);
  if (tbl) {
    const f = tbl.fields.find((f) => f.name === fieldName);
    if (f?.label) return f.label;
  }
  return columnLabel(fieldName);
}

export function getFieldDesc(
  tableName: string,
  fieldName: string,
  schema: TableSchema[],
): string | undefined {
  const tbl = schema.find((t) => t.name === tableName);
  if (!tbl) return undefined;
  const f = tbl.fields.find((f) => f.name === fieldName);
  return f?.description;
}

/**
 * 将 schema 中的 enum 选项合并到 fields（用于编辑弹窗）
 *
 * queryPlayerTables 返回的 fields 来自 PRAGMA 推断，不含 enum 选项；
 * getSchema 返回的 schema 已从 data/config/.schema/ 元数据文件加载 enumValues。
 * 本函数按字段名匹配，把 schema 中的 options 填充到 fields 中（仅在未设置时），
 * 让 RecordEditModal 能识别 enum 字段并渲染下拉选项。
 */
export function mergeSchemaOptions(
  fields: FieldSchema[],
  tableName: string,
  schema: TableSchema[],
): FieldSchema[] {
  const tbl = schema.find((t) => t.name === tableName);
  if (!tbl) return fields;
  let changed = false;
  const merged = fields.map((f) => {
    const schemaField = tbl.fields.find((sf) => sf.name === f.name);
    if (
      schemaField?.options &&
      schemaField.options.length > 0 &&
      (!f.options || f.options.length === 0)
    ) {
      changed = true;
      return { ...f, options: schemaField.options };
    }
    return f;
  });
  return changed ? merged : fields;
}

export function getTitleField(row: Record<string, unknown>): string | null {
  for (const key of [
    'name',
    'item_name',
    'skill_name',
    'pet_name',
    'title',
    'quest_name',
    'achievement_name',
  ]) {
    if (row[key] !== undefined && row[key] !== null) return String(row[key]);
  }
  return null;
}
