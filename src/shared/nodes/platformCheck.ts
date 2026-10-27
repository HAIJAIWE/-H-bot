// src/shared/nodes/platformCheck.ts
//
// 平台能力校验：节点声明的平台族与「当前项目所属的平台」不一致时，给出一条可读问题。
//
// 为什么要单独一个文件（而不是塞进 flowNormalize.ts）：
// - 口径只有一处 —— 节点库可见性（renderer）+ 校验面板（main 的 flow:validate）
//   + 运行时预检（FlowRuntime.start）都调这里，避免三处各写一遍判断；
// - 纯函数、不读盘：项目平台由调用方从 `.qqbat/project.json` 推导后传进来。
//
// 与 `shared/domain/platform/registry` 的关系：那里回答「这个节点属于哪些平台」，
// 这里回答「它和这个项目冲不冲突」。节点标注里出现注册表没有的平台由
// `tests/guards/platformTagCoverage.test.ts` 挡在提交前。
import { NODE_CATALOG_V2 } from './builtinCatalog'
import { nodePlatformTags, platformLabel, type PlatformFamily } from '../domain/platform/registry'

/** 一个与项目平台不兼容的节点 */
export interface PlatformMismatch {
  nodeId: string
  kind: string
  /** 界面上显示的名字（目录里没有时退回 kind） */
  label: string
  /** 节点要求的平台族（通常只有一个；多个时取第一个展示） */
  need: PlatformFamily[]
}

/** 图里最小的节点形状（既能吃 FlowNode，也能吃校验器里的 NormalizableNode） */
export interface PlatformCheckNode {
  id: string
  data?: { nodeKind?: string; label?: string }
}

/**
 * 扫描图里所有与项目平台不兼容的节点。
 *
 * - `projectPlatform` 为 `undefined` / `null`：项目没绑平台（如老项目、未配置 adapter），
 *   此时**不做平台校验**（返回空数组）—— 历史项目里摆着的节点照常跑，这是与
 *   「添加时拦截」的关键区别，别把老项目判成坏项目；
 * - 通用节点（没有任何平台标注）永远兼容；
 * - 目录里没有的 kind（插件 / 自定义节点）跳过，交给其它校验。
 */
export function findPlatformMismatches(
  graph: { nodes?: ReadonlyArray<PlatformCheckNode> } | null | undefined,
  projectPlatform: PlatformFamily | null | undefined,
): PlatformMismatch[] {
  if (!projectPlatform) return []
  const out: PlatformMismatch[] = []
  for (const node of graph?.nodes ?? []) {
    const kind = node.data?.nodeKind ?? ''
    const spec = NODE_CATALOG_V2.find(s => s.kind === kind)
    if (!spec) continue
    const need = nodePlatformTags(spec)
    if (need.length === 0) continue
    if (need.includes(projectPlatform)) continue
    out.push({ nodeId: node.id, kind, label: node.data?.label ?? spec.label, need })
  }
  return out
}

/**
 * 一行可读文案：校验面板、运行时错误、添加节点时的提示共用。
 * 默认中文（这个仓库面向中文用户；英文只在渲染层 i18n 走）。
 */
export function describePlatformMismatch(
  mismatch: PlatformMismatch,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const platforms = mismatch.need.map(f => platformLabel(f, locale)).join(' / ')
  return locale === 'en-US'
    ? `Node "${mismatch.label}" only works on ${platforms}; the current project is not on that platform`
    : `节点「${mismatch.label}」只能在 ${platforms} 平台工作，当前项目不是该平台`
}
