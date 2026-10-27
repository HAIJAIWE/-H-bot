// src/shared/nodes/packRegistry.ts
//
// 平台节点包注册表（第 67 批 P2b-2）—— 把第 66 批的「视图常量」升级成**运行时注册表**。
//
// 第 66 批 `buildNodePacks(NODE_CATALOG_V2)` 只是目录的一个静态视图；本批让它可注册：
// 内置包在 `builtinCatalog.ts` 模块加载时注册一次（source='builtin'），将来的外部插件包
// 走同一个 `registerNodePack(..., 'external')` —— 这是 P4 生态的接口预演，**现在还没有
// 任何外部来源调用它**，所以本批对用户可见行为的影响只有一处：节点库/命令面板的过滤
// 从「逐节点判平台标注」换成「查包内的 kind 集合」，两者由 `nodePackContract` 闸门保证等价。
//
// 消费方约定（Palette / 命令面板）：**属于某个包的节点**按包可见性过滤；**不在任何包里
// 的节点**（自定义节点 / 插件节点 / AI 生成节点）不参与平台收窄，始终可见 —— 与第 65 批
// 之前的行为一致，避免把「别的来源」误伤成「别的平台」。
//
// 注册顺序即包顺序：内置包先注册（`common` 第一），外部包后注册。重复 id 直接抛错 ——
// 包是交付单位，同一个 id 两个来源会让「谁提供这个平台的节点」变得不可回答。
import type { PlatformFamily } from '../domain/platform/registry'
import type { NodePack } from './packs'

/** 包的来源：内置（进仓代码）或外部（将来的插件包） */
export type NodePackSource = 'builtin' | 'external'

/** 注册表里的一条：包 + 来源 */
export interface RegisteredNodePack {
  pack: NodePack
  source: NodePackSource
}

/** 注册表本体（模块级，进程内单例；main 与 renderer 各自一份） */
const packs: RegisteredNodePack[] = []

/**
 * 注册一个平台节点包。
 *
 * @param pack   包（`buildNodePacks` 的产物，或外部来源自己组装的同形结构）
 * @param source 来源；外部插件包必须显式传 `'external'`，便于将来按来源做信任分层
 */
export function registerNodePack(pack: NodePack, source: NodePackSource = 'external'): void {
  if (packs.some(entry => entry.pack.id === pack.id)) {
    throw new Error(`平台节点包 id 重复注册：${pack.id}（同一个 id 只能有一个来源）`)
  }
  packs.push({ pack, source })
}

/** 当前注册的全部包（注册顺序；内置在前） */
export function getNodePacks(): readonly RegisteredNodePack[] {
  return packs
}

/** 某个 kind 是否属于已注册的包 —— 用来区分「包内节点」与「自定义/插件/AI 节点」 */
export function isPackNodeKind(kind: string): boolean {
  return packs.some(entry => entry.pack.specs.some(spec => spec.kind === kind))
}

/**
 * 某个项目平台族下**可见的节点 kind**。
 *
 * - `family` 为 `null` / `undefined`（无项目）→ 全部包内节点可见；
 * - 否则只放行 `common` 包与该平台族的包。
 */
export function visibleNodeKinds(family: PlatformFamily | null | undefined): ReadonlySet<string> {
  const visible = new Set<string>()
  for (const { pack } of packs) {
    if (family != null && pack.id !== 'common' && !pack.families.includes(family)) continue
    for (const spec of pack.specs) visible.add(spec.kind)
  }
  return visible
}
