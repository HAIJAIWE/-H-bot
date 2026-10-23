// src/renderer/src/lib/infra/recentStore.ts
// 节点使用记录（最近使用 / 收藏）的 localStorage 持久化。
// NodePalette 置顶分组与 BlockInsertMenu 共用此数据源，避免 canvas → blocks 反向依赖。

import { STORAGE_KEYS } from './storageKeys';

const RECENT_KEY = STORAGE_KEYS.recentNodes;
const FAVORITE_KEY = STORAGE_KEYS.favoriteNodes;
const MAX_RECENT = 8;
const MAX_FAVORITES = 50;

function loadList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* localStorage 不可用时静默失败 */
  }
}

/** 读取最近使用节点 kind 列表 */
export function loadRecentKinds(): string[] {
  return loadList(RECENT_KEY);
}

/** 记录节点使用：去重置顶 + 封顶 MAX_RECENT */
export function recordNodeUsage(kind: string): void {
  const list = loadList(RECENT_KEY).filter((k) => k !== kind);
  list.unshift(kind);
  saveList(RECENT_KEY, list.slice(0, MAX_RECENT));
}

/** 读取收藏节点 kind 列表 */
export function loadFavoriteKinds(): string[] {
  return loadList(FAVORITE_KEY);
}

/** 切换收藏状态，返回最新列表（写入时封顶 MAX_FAVORITES，防止长期使用无限增长） */
export function toggleFavoriteKind(kind: string, current: string[]): string[] {
  const next = current.includes(kind)
    ? current.filter((k) => k !== kind)
    : [...current, kind].slice(0, MAX_FAVORITES);
  saveList(FAVORITE_KEY, next);
  return next;
}
