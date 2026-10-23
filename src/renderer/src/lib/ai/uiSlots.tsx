// src/renderer/src/lib/ai/uiSlots.tsx
//
// **界面插槽 + 可回收注册**（2026-10-18）。
//
// 上游 dsh 的纪律是"注册即副作用、卸载即回收"（Cordis：registrations are effects that unwind
// when their plugin unloads）。我们还没有插件宿主，但这条纪律可以先用起来：
// 每次注册都返回一个 dispose，**谁注册谁负责撤销**；插槽订阅版本号重渲染。
//
// 刻意不做的事：没有沙箱、没有权限模型（那是插件宿主的事）；插槽只解决"位置"和"可撤销"。
import { Fragment, useSyncExternalStore, type ReactNode } from 'react';

export type AiSlotName =
  | 'composer.toolbar' // 输入框底部工具条（模型/用量/附件…）
  | 'composer.hint' // 输入框下的提示语
  | 'session.header' // 会话头右侧徽标
  | 'panel.aside'; // 面板侧栏（插件面板）

export interface AiSlotEntry {
  /** 全局唯一：重复注册直接报错（否则两段 UI 会悄悄互相覆盖） */
  id: string;
  slot: AiSlotName;
  order?: number;
  render: () => ReactNode;
}

const REGISTRY = new Map<string, AiSlotEntry>();
const LISTENERS = new Set<() => void>();
let VERSION = 0;

function emit(): void {
  VERSION += 1;
  for (const listener of LISTENERS) listener();
}

/** 注册一项，返回 dispose（撤销这一项）。重复 id 直接抛错。 */
export function registerAiSlot(entry: AiSlotEntry): () => void {
  if (!entry.id || entry.id.trim().length === 0) throw new Error('ai slot entry requires an id');
  if (REGISTRY.has(entry.id)) throw new Error('ai slot entry already registered: ' + entry.id);
  REGISTRY.set(entry.id, entry);
  emit();
  return () => unregisterAiSlot(entry.id);
}

/** 撤销一项（幂等：不存在就什么都不做） */
export function unregisterAiSlot(id: string): void {
  if (!REGISTRY.delete(id)) return;
  emit();
}

/** 某个插槽里的条目（按 order 排序；同 order 保持注册顺序） */
export function listAiSlot(slot: AiSlotName): AiSlotEntry[] {
  return [...REGISTRY.values()]
    .filter((e) => e.slot === slot)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** 订阅插槽变化（启停插件时界面要跟着变） */
export function subscribeAiSlots(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

function getAiSlotsVersion(): number {
  return VERSION;
}

/** 在面板里放这个组件 = 留出插槽位置（插件启停后会自动重渲染） */
export function AiSlot({ name }: { name: AiSlotName }): ReactNode {
  useSyncExternalStore(subscribeAiSlots, getAiSlotsVersion, getAiSlotsVersion);
  const entries = listAiSlot(name);
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((e) => (
        <Fragment key={e.id}>{e.render()}</Fragment>
      ))}
    </>
  );
}
