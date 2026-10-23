// src/renderer/src/components/launch/templateFieldModel.ts
//
// 数据模板的**纯函数**：深拷贝、组 ID 生成、默认值 ↔ 输入框字符串的双向转换。
//
// `defaultToInput` / `inputToDefault` 必须**成对**改：一个负责"存的值怎么显示"，一个负责
// "用户改完怎么存回去"。只动一边的表现是"打开编辑器值变了"或"改完没保存"。

import type { TemplateField, TemplateGroup } from '../../types/ipc';

// 注：这里曾有一份 `DEFAULT_TEMPLATE`（6 组 22 个示例字段），与主进程
// `dataTemplateService.getDefaultTemplate()` 是**同一份内容的两个副本**。
// 它有两个问题，都已修掉：
//   1. 两份要手工保持同步（本文件顶部就写着"与主进程保持一致"）——必然漂移；
//   2. 内容是一份与任何项目都无关的示例（注册时间/最后活跃/称号/权限…），
//      于是"恢复默认"会把项目里根本不存在的字段塞进模板。
// 现在「恢复默认」走 `window.qqbat.launchData.deriveDataTemplate(projectPath)`：
// 从项目自己的 `flow.json`（`variable_persist` 声明）+ `persistent.db`（实际字段）推导，
// 推导逻辑只有主进程一处（`shared/persist/fieldSemantics` 提供两侧共用的语义）。

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 深拷贝（模板结构为纯数据，JSON 方式足够） */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** 生成唯一分组 ID */
export function generateGroupId(label: string, existing: TemplateGroup[]): string {
  const base = label.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() || 'group';
  let id = base;
  let n = 2;
  while (existing.some((g) => g.id === id)) {
    id = `${base}_${n}`;
    n++;
  }
  return id;
}

/** 把默认值转换为 input 字符串（用于编辑） */
export function defaultToInput(value: unknown, type: TemplateField['type']): string {
  if (value === undefined || value === null) return '';
  if (type === 'json') {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 把 input 字符串转换为默认值 */
export function inputToDefault(input: string, type: TemplateField['type']): unknown {
  if (type === 'number') {
    if (input.trim() === '') return 0;
    const n = parseFloat(input);
    return isNaN(n) ? 0 : n;
  }
  if (type === 'boolean') {
    return input === 'true' || input === '1';
  }
  if (type === 'json') {
    if (input.trim() === '') return {};
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  return input;
}
