// src/renderer/src/lib/ai/agentSurface.tsx
//
// **智能体窗口（agent surface）贡献点**（第 68 批，P3 第一刀）。
//
// 现状：右侧面板固定渲染 `ChatPanel`（`components/layout/RightPanel.tsx`），要换一整套
// 对话界面只能改这个组件本身。本模块把「智能体窗口」变成一个**可注册的贡献点**：
// 谁注册谁提供 render，界面按 order 取第一个 —— 内置对话窗口以 order=1000 注册，
// 贡献方用更小的 order 注册即可接管（第 68 批先按 order 抢占；等有了设置页再改成显式切换）。
//
// 与 `uiSlots.tsx` 同一套纪律：注册返回 dispose、订阅版本号重渲染、重名直接抛错、
// 刻意不做沙箱与权限（那是插件宿主的事）——这里只解决「谁渲染整个窗口」和「可撤销」。
import { useSyncExternalStore, type ReactNode } from 'react'

export interface AgentSurfaceEntry {
  /** 全局唯一：重复注册直接报错 */
  id: string
  /** 越小越优先；内置对话窗口是 1000，外部注册想接管就用更小的值 */
  order?: number
  /**
   * 给人看的名字（可选）：用函数而不是字符串 —— 界面文案要走 i18n，
   * 注册时取一次会把当时语言定死，函数每次渲染时现算。
   */
  label?: () => string
  render: () => ReactNode
}

const REGISTRY = new Map<string, AgentSurfaceEntry>()
const LISTENERS = new Set<() => void>()
let VERSION = 0

function emit(): void {
  VERSION += 1
  for (const listener of LISTENERS) listener()
}

/** 注册一个智能体窗口，返回 dispose（撤销这一项）。重复 id / 空 id 直接抛错。 */
export function registerAgentSurface(entry: AgentSurfaceEntry): () => void {
  if (!entry.id || entry.id.trim().length === 0) throw new Error('agent surface requires an id')
  if (REGISTRY.has(entry.id)) throw new Error('agent surface already registered: ' + entry.id)
  REGISTRY.set(entry.id, entry)
  emit()
  return () => {
    if (REGISTRY.delete(entry.id)) emit()
  }
}

/** 已注册的窗口（按 order 排序；设置页的下拉用它） */
export function listAgentSurfaces(): AgentSurfaceEntry[] {
  return [...REGISTRY.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/**
 * 当前生效的智能体窗口：
 * - 指定了 `preferredId` 且该窗口仍在注册表里 → 用它（用户在设置页选过）；
 * - 否则按 order 取第一个（默认行为）。
 * 指定的窗口被撤销时自动回落到默认，不会白屏。
 */
export function getAgentSurface(preferredId?: string | null): AgentSurfaceEntry | undefined {
  if (preferredId) {
    const picked = REGISTRY.get(preferredId)
    if (picked) return picked
  }
  return listAgentSurfaces()[0]
}

/** 订阅注册表变化（启停窗口时界面跟着变） */
export function subscribeAgentSurfaces(listener: () => void): () => void {
  LISTENERS.add(listener)
  return () => LISTENERS.delete(listener)
}

function getAgentSurfaceVersion(): number {
  return VERSION
}

/**
 * 在右侧面板放这个组件 = 「智能体窗口」的位置（注册表变化后会自动重渲染）。
 * `preferredId` 来自设置页的选择（`uiStore.agentSurfaceId`，null = 自动）。
 */
export function AgentSurfaceHost({ preferredId }: { preferredId?: string | null }): ReactNode {
  useSyncExternalStore(subscribeAgentSurfaces, getAgentSurfaceVersion, getAgentSurfaceVersion)
  const active = getAgentSurface(preferredId)
  return active ? <>{active.render()}</> : null
}
