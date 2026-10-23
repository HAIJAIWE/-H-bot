// src/renderer/src/components/launch/useRefOptions.ts
//
// 「引用字段」的选项加载 —— 唯一实现。
//
// 谁在用：
//   1. `RefFieldPicker`（配置阶段：选"引用哪张表 + 哪个字段"）
//   2. `RefEditor`（录入阶段：值的下拉，选项来自目标表）
// 两处都需要"表清单 → 目标表字段清单/行值"，各写一份必然漂移，所以收敛到这里。
//
// 数据来源都是**现成 IPC**，不需要后端新增接口：
//   `launchConfig.listCategories` / `launchConfig.getSchema` / `launchConfig.getTable`
import { useEffect, useState } from 'react';
import { categoryLabel } from './configCategoryLabels';

export interface TableCategory {
  name: string;
  displayName?: string;
  description?: string;
}

/** 引用目标表的候选项：`name` 是落盘用的表名，`label` 是给人看的中文名 */
export interface RefTableOption {
  name: string;
  label: string;
}

export interface SimpleField {
  name: string;
  label?: string;
}

/**
 * 字段名不是"人看的"标签时，优先显示 label（如 `atk_bonus` → 攻击加成（atk_bonus））。
 * 用户在自己建的表里认得出字段，比只显示英文列名友好得多。
 */
export function fieldLabel(field: SimpleField): string {
  if (field.label && field.label !== field.name) return `${field.label}（${field.name}）`;
  return field.name;
}

/** 拉配置表清单（建表向导可把"正在建的表"也塞进去，便于自引用） */
export function useConfigTables(projectPath: string, extraTable?: string) {
  const [categories, setCategories] = useState<TableCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    setLoading(true);
    window.qqbat.launchConfig
      .listCategories(projectPath)
      .then((res) => {
        if (cancelled) return;
        setCategories((res?.data ?? []) as TableCategory[]);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  /**
   * ⚠️ 标签在**渲染期**算，不放 effect 里。
   *
   * 踩过的坑：标签原来在 effect 里算成 `{name,label}[]`，而 effect 只依赖 projectPath ——
   * 于是**切换语言时标签不会重算**（下拉里一直显示英文表名，中文界面下也是）。
   * 这与本项目"文案冻在 import/effect 时刻"是同一类错误：凡是跟随语言的值，
   * 都必须在渲染路径上求值。
   */
  const tables: RefTableOption[] = categories.map((c) => ({
    // 给人看的中文名（i18n）优先；自定义表回退它自己的 displayName
    name: c.name,
    label: categoryLabel(c),
  }));
  if (extraTable && !tables.some((t) => t.name === extraTable)) {
    tables.unshift({ name: extraTable, label: extraTable });
  }

  return { tables, loading, error };
}

/** 拉某张表的字段清单（用于"用哪个字段当选项值"） */
export function useTableFields(projectPath: string, table: string | undefined) {
  const [fields, setFields] = useState<SimpleField[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath || !table) {
      setFields([]);
      return;
    }
    let cancelled = false;
    window.qqbat.launchConfig
      .getSchema(projectPath, table)
      .then((res) => {
        if (cancelled) return;
        const first = (res?.data ?? [])[0] as { fields?: SimpleField[] } | undefined;
        setFields(first?.fields ?? []);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setFields([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, table]);

  return { fields, error };
}

/**
 * 拉引用字段的**可选项值**（目标表该列的所有值，去重、按当前值兜底）。
 *
 * ⚠️ 用 `getTable` 一次拿一页而不是"每行一个下拉查询"：53 行掉落表也就是一次调用。
 * 目标表很大时（>500 行）这里会截断，所以额外把**当前值**补进选项，
 * 避免"值存在但不在第一页里 → 下拉显示空 → 保存时被清掉"这种静默数据丢失。
 */
export function useRefValueOptions(
  projectPath: string,
  refTable: string | undefined,
  refField: string | undefined,
  currentValue: unknown,
) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath || !refTable || !refField) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.qqbat.launchConfig
      .getTable(projectPath, refTable, 1, 500)
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data?.rows ?? []) as Record<string, unknown>[];
        const values = new Set<string>();
        for (const row of rows) {
          const v = row[refField];
          if (v !== null && v !== undefined && String(v) !== '') values.add(String(v));
        }
        // 当前值兜底：不在选项里也要保住，否则用户一保存就被改掉
        if (currentValue !== null && currentValue !== undefined && String(currentValue) !== '') {
          values.add(String(currentValue));
        }
        setOptions([...values]);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setOptions([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, refTable, refField, currentValue]);

  return { options, loading, error };
}
