// src/shared/plugins/settings.ts
//
// **插件设置（参数表单）的共享契约**（2026-10-25）。
//
// 一件事：插件清单里 `settings` 声明它要用户填哪些参数；宿主按这份声明生成表单、
// 校验用户填的值、再把值交给插件自己读（沙箱里的 `api.getSetting(key)`）。
//
// 为什么放 shared：同一份声明要在**主进程**（校验/落盘/交给插件）和**渲染层**（画表单）
// 两边解释，规则写两份就一定漂移。这里只有纯函数，不碰 fs / electron。
//
// 边界：设置是"用户填的配置"，不是权限，也不是能力 —— 读设置不需要声明 permission。
export type PluginSettingType = 'string' | 'number' | 'boolean' | 'select';

export type PluginSettingValue = string | number | boolean;

export type PluginSettingValues = Record<string, PluginSettingValue>;

export interface PluginSettingOption {
  value: string;
  /** 界面上显示的文案；缺省 = value */
  label?: string;
}

export interface PluginSettingSpec {
  /** 插件读取时用的键；小写字母开头，字母数字下划线 */
  key: string;
  /** 表单标签（插件作者写，可以是英文） */
  label: string;
  type: PluginSettingType;
  description?: string;
  /** 用户没填过时的值；缺省 = 不提供（插件读到 null） */
  default?: PluginSettingValue;
  /** type === 'select' 时必填 */
  options?: PluginSettingOption[];
}

/** 键名规则：小写字母开头，只允许字母数字下划线（与 JSON 路径片段一致，不做转义） */
export const PLUGIN_SETTING_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** 一个插件的设置项上限：表单是给人看的，超过这个数说明该拆插件 */
export const MAX_PLUGIN_SETTINGS = 24;

/** 文本值上限（IPC 与落盘都要挡） */
export const MAX_PLUGIN_SETTING_TEXT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptions(raw: unknown): PluginSettingOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PluginSettingOption[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const value = typeof item.value === 'string' ? item.value.trim() : '';
    if (!value || value.length > MAX_PLUGIN_SETTING_TEXT) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, ...(typeof item.label === 'string' && item.label.trim() ? { label: item.label.trim() } : {}) });
  }
  return out;
}

/**
 * 把**不可信**的清单字段整理成规范设置项。
 *
 * 静默丢弃非法项而不是整体报错：插件清单是第三方写的，一条坏字段不该让整个插件装不上；
 * 但坏到"没有可渲染的表单"的项留着只会让界面崩，所以直接不留。
 */
export function normalizeSettingSpecs(raw: unknown): PluginSettingSpec[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PluginSettingSpec[] = [];
  for (const item of raw) {
    if (out.length >= MAX_PLUGIN_SETTINGS) break;
    if (!isRecord(item)) continue;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!PLUGIN_SETTING_KEY_RE.test(key) || seen.has(key)) continue;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) continue;
    const type = item.type;
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'select') continue;
    const options = type === 'select' ? normalizeOptions(item.options) : [];
    // select 没有可选项 = 没法选，这条声明没意义
    if (type === 'select' && options.length === 0) continue;
    const spec: PluginSettingSpec = {
      key,
      label,
      type,
      ...(typeof item.description === 'string' && item.description.trim()
        ? { description: item.description.trim() }
        : {}),
      ...(type === 'select' ? { options } : {}),
    };
    // default 走同一套校验：坏默认值丢掉，而不是带着坏值进表单
    if (item.default !== undefined) {
      const coerced = coerceOne(spec, item.default);
      if (coerced.ok) spec.default = coerced.value;
    }
    seen.add(key);
    out.push(spec);
  }
  return out;
}

function coerceOne(
  spec: PluginSettingSpec,
  raw: unknown,
): { ok: true; value: PluginSettingValue } | { ok: false; error: string } {
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };
    return { ok: false, error: 'setting "' + spec.key + '" must be a boolean' };
  }
  if (spec.type === 'number') {
    const num =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    if (!Number.isFinite(num)) return { ok: false, error: 'setting "' + spec.key + '" must be a number' };
    return { ok: true, value: num };
  }
  if (spec.type === 'select') {
    const value = String(raw);
    const hit = (spec.options ?? []).some((o) => o.value === value);
    if (!hit) return { ok: false, error: 'setting "' + spec.key + '" must be one of its options' };
    return { ok: true, value };
  }
  if (typeof raw !== 'string') return { ok: false, error: 'setting "' + spec.key + '" must be a string' };
  const text = raw.trim();
  if (text.length > MAX_PLUGIN_SETTING_TEXT) {
    return { ok: false, error: 'setting "' + spec.key + '" is longer than ' + MAX_PLUGIN_SETTING_TEXT };
  }
  return { ok: true, value: text };
}

/** 出厂值：只含有 default 的项（没写 default 的项不出现，插件读到 null） */
export function defaultSettingValues(specs: readonly PluginSettingSpec[]): PluginSettingValues {
  const out: PluginSettingValues = {};
  for (const spec of specs) {
    if (spec.default !== undefined) out[spec.key] = spec.default;
  }
  return out;
}

export type CoerceSettingsResult =
  | { ok: true; values: PluginSettingValues }
  | { ok: false; error: string };

/**
 * 校验并规范化用户提交的值。
 *
 * - 未提交的键：有 default 用 default，否则不写（插件读到 null）；
 * - 声明外多出来的键：**丢掉**（插件将来删了某项，旧值不该继续流进插件）；
 * - 类型不对：整体失败并指出是哪个键 —— 静默回退会让用户以为"保存成功了"。
 */
export function coerceSettingValues(
  specs: readonly PluginSettingSpec[],
  raw: unknown,
): CoerceSettingsResult {
  const input = isRecord(raw) ? raw : {};
  const values: PluginSettingValues = {};
  for (const spec of specs) {
    const submitted = input[spec.key];
    if (submitted === undefined) {
      if (spec.default !== undefined) values[spec.key] = spec.default;
      continue;
    }
    const coerced = coerceOne(spec, submitted);
    if (!coerced.ok) return { ok: false, error: coerced.error };
    values[spec.key] = coerced.value;
  }
  return { ok: true, values };
}

/** 把"出厂值 + 已存值"合成一份完整值（装载时用） */
export function mergeSettingValues(
  specs: readonly PluginSettingSpec[],
  stored: unknown,
): PluginSettingValues {
  const coerced = coerceSettingValues(specs, stored);
  return coerced.ok ? coerced.values : defaultSettingValues(specs);
}
