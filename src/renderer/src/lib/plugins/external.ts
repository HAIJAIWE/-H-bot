// src/renderer/src/lib/plugins/external.ts
//
// **外部插件安装记录**（本地加载器 v0 的第一半，2026-10-18）。
//
// 现在还不能执行外部代码（没有沙箱；渲染层无法安全 import 任意文件）。
// 但"安装"这件事可以**先做真的**：校验清单 → 展示它声明的能力 → 记录 → 可卸载。
// 记录存在 localStorage（app 级界面偏好），键名带版本前缀，坏数据一律当空。
//
// ⚠️ 这里**不执行任何东西**：记录只说明"用户确认过这份清单"。
// 执行入口要等沙箱那一版 —— 那时清单里会有入口文件与 hash，现在刻意没有。
import type { PluginManifest, PluginPermission } from './api';
import { validatePluginIdentity } from '@shared/plugins/manifest';
import { AiSlotName } from '../ai/uiSlots';

const INSTALLED_KEY = 'qqbat.plugins.installed';

/** 外部清单允许的插槽名（与 uiSlots 保持一致；越界名字直接拒） */
const SLOT_NAMES: AiSlotName[] = ['composer.toolbar', 'composer.hint', 'session.header', 'panel.aside'];

export interface ExternalPluginRecord {
  manifest: PluginManifest;
  /** 安装时间（ISO） */
  installedAt: string;
  /** 这一版**不可执行**：记录只用于"看与卸载" */
  executable: false;
  /** 它声明要放的插槽（安装确认时展示；真正渲染要等执行器） */
  slots: AiSlotName[];
}

/**
 * 解析用户提供的插件清单（JSON 文本）。
 * 返回 { ok: true, manifest, slots } 或 { ok: false, error }（错误文案用英文：渲染层 i18n 闸门）。
 */
export function parseExternalManifest(
  raw: string,
): { ok: true; manifest: PluginManifest; slots: AiSlotName[] } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  // 身份字段的校验与两个宿主共用一份（shared/plugins/manifest），免得三处规则各漂各的
  const identity = validatePluginIdentity(data);
  if (!identity.ok) return { ok: false, error: identity.error };
  const permissions = identity.value.permissions ?? [];
  const m = data as Record<string, unknown>;
  for (const p of permissions) {
    if (p !== 'slot') return { ok: false, error: 'unsupported permission: ' + String(p) };
  }
  const rawSlots = Array.isArray(m.slots) ? m.slots : [];
  const slots: AiSlotName[] = [];
  for (const s of rawSlots) {
    if (typeof s !== 'string' || !SLOT_NAMES.includes(s as AiSlotName)) {
      return { ok: false, error: 'unsupported slot: ' + String(s) };
    }
    slots.push(s as AiSlotName);
  }
  return {
    ok: true,
    manifest: {
      id: identity.value.id,
      name: identity.value.name,
      version: identity.value.version,
      ...(identity.value.description ? { description: identity.value.description } : {}),
      ...(identity.value.requires ? { requires: identity.value.requires } : {}),
      ...(permissions.length > 0 ? { permissions: permissions as PluginPermission[] } : {}),
    },
    slots,
  };
}

function readRecords(): ExternalPluginRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(INSTALLED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ExternalPluginRecord =>
        !!r && typeof r === 'object' && typeof (r as ExternalPluginRecord).manifest?.id === 'string',
    );
  } catch {
    return [];
  }
}

function writeRecords(records: ExternalPluginRecord[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(INSTALLED_KEY, JSON.stringify(records));
  } catch {
    // 写不进去只影响"下次启动还记不记得"，不该让安装流程失败
  }
}

/** 已确认安装的外部插件（仅记录，不执行） */
export function listExternalPlugins(): ExternalPluginRecord[] {
  return readRecords();
}

/** 记录一次安装（id 重复时覆盖，视为"重新确认"） */
export function installExternalPlugin(
  manifest: PluginManifest,
  slots: AiSlotName[] = [],
): ExternalPluginRecord {
  const record: ExternalPluginRecord = {
    manifest,
    installedAt: new Date().toISOString(),
    executable: false,
    slots,
  };
  writeRecords([...readRecords().filter((r) => r.manifest.id !== manifest.id), record]);
  return record;
}

/** 卸载（删记录；这一版没有需要撤销的贡献） */
export function uninstallExternalPlugin(id: string): void {
  writeRecords(readRecords().filter((r) => r.manifest.id !== id));
}
