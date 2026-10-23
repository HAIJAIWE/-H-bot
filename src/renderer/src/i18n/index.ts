// src/renderer/src/i18n/index.ts
import zhCN from './zh-CN.json';
import enUS from './en-US.json';

type Messages = Record<string, string | Record<string, unknown>>;
type Listener = (locale: string) => void;

import { STORAGE_KEYS } from '../lib/infra/storageKeys';

const messages: Record<string, Messages> = {
  'zh-CN': zhCN as Messages,
  'en-US': enUS as Messages,
};

const STORAGE_KEY = STORAGE_KEYS.locale;

let currentLocale: string = 'zh-CN';
const listeners: Set<Listener> = new Set();

function getNestedValue(obj: Messages, key: string): string | undefined {
  const keys = key.split('.');
  let current: unknown = obj;
  for (const k of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[k];
  }
  return typeof current === 'string' ? current : undefined;
}

function getLastSegment(key: string): string {
  const parts = key.split('.');
  return parts[parts.length - 1];
}

/** 插值参数值：允许数字，调用方不必为了一个计数写 String(n) */
type ParamValue = string | number;

function interpolate(str: string, params?: Record<string, ParamValue>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, key: string) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`;
  });
}

function detectLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'zh-CN' || saved === 'en-US')) return saved;
  } catch {
    // localStorage not available
  }
  try {
    const lang = navigator.language;
    if (lang.startsWith('zh')) return 'zh-CN';
  } catch {
    // navigator not available
  }
  return 'zh-CN';
}

/**
 * 翻译函数
 * @param path 点号分隔的 key，如 'common.save'
 * @param params 插值参数，如 { name: 'world' }
 * @returns 翻译后的文本，找不到时返回 key 的最后一段
 */
export function t(path: string, params?: Record<string, ParamValue>): string {
  // 尝试当前语言
  const msg = getNestedValue(messages[currentLocale], path);
  if (msg !== undefined) return interpolate(msg, params);

  // fallback 到 zh-CN
  const fallback = getNestedValue(messages['zh-CN'], path);
  if (fallback !== undefined) return interpolate(fallback, params);

  // 找不到时返回 key 的最后一段
  return getLastSegment(path);
}

/**
 * 判断某个 key 是否有译文（当前语言或 zh-CN 兜底都算）。
 *
 * 为什么需要它：`t()` 在查不到时返回 key 的最后一段（如 `field.hint.zzz` → `hint`），
 * 这对"显示"是合理的兜底，但对"要不要显示这一项"是个陷阱 ——
 * 例如字段说明查不到时应该**不显示提示**，而不是显示一个 `hint` 字样的假提示。
 */
export function hasKey(path: string): boolean {
  return (
    getNestedValue(messages[currentLocale], path) !== undefined ||
    getNestedValue(messages['zh-CN'], path) !== undefined
  );
}

/**
 * 设置当前语言
 */
export function setLocale(locale: 'zh-CN' | 'en-US'): void {
  if (!messages[locale]) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage not available
  }
  listeners.forEach((fn) => fn(locale));
}

/**
 * 获取当前语言
 */
export function getLocale(): 'zh-CN' | 'en-US' {
  return currentLocale as 'zh-CN' | 'en-US';
}

/**
 * 订阅语言变更
 * @returns 取消订阅函数
 */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 初始化
currentLocale = detectLocale();
