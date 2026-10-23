// src/renderer/src/lib/canvas/branchColors.ts
// 阶段 4：分支边颜色映射。
// 由 source 节点 kind + sourcePort 推断分支色，注入到 React Flow edge.data.branchColor。
// 不写入 flow.json（颜色是衍生物，与 _executing 同性质）。
import { t } from '../../i18n';

/** 按端口名映射分支颜色（hex 字符串，避开 Tailwind 动态 class 拼接限制）。
 *  500 级 Tailwind 色，在 zinc-900 背景上可见，不过分饱和。
 *  out/next 等默认出口不在表中 → 返回 undefined → 走默认灰。 */
export const BRANCH_PORT_COLORS: Record<string, string> = {
  true: '#10b981', // emerald-500 — branch_if 真分支
  false: '#f43f5e', // rose-500 — branch_if 假分支
  body: '#0ea5e9', // sky-500 — loop/retry_exec 循环体
  done: '#a1a1aa', // zinc-400 — loop 完成（弱色，避免抢眼）
  try: '#10b981', // emerald-500 — try_catch 正常路径
  catch: '#f59e0b', // amber-500 — 异常捕获
  finally: '#8b5cf6', // violet-500 — 最终块
  success: '#10b981', // retry_exec 成功
  // ⚠️ **不能和 `false` 共用 rose**（2026-09 改）：两者语义完全不同 ——
  // `false` 是**正常的 else 出路**（天天走），`failed` 是**真的出错了**。
  // 真机里 `branch_if.假` 与 `variable_persist.失败` 会同时出现（8 条 + 2 条边），
  // 同色会让人把"正常分支"看成"报错"。
  //
  // 橙色和 `catch`（amber）同属暖色 —— 这是**有意**的：两者都是"出错路径"
  // （`catch` 属 try_catch、`failed` 属 retry_exec / variable_persist，
  // 不会出现在同一个节点上），而真正要一眼分清的对比是 **rose（假）vs 橙（失败）**。
  failed: '#f97316', // orange-500 — retry_exec / variable_persist 失败
};

/** branch_switch 动态分支调色板（hash case label → 稳定选色） */
const SWITCH_PALETTE = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16'];

/** 按端口名映射分支中文标签。
 *  - out/next 等默认出口返回 undefined（不显示标签，避免画布杂乱）
 *  - branch_switch 动态 case 端口 → 直接用 case label（sourcePort 即用户定义的 case 名）
 *  - 其他 → 查 BRANCH_PORT_LABELS 表 */
const BRANCH_PORT_LABELS: Record<string, string> = {
  get true() {
    return t('branch.true');
  },
  get false() {
    return t('branch.false');
  },
  get body() {
    return t('branch.body');
  },
  get done() {
    return t('branch.done');
  },
  get try() {
    return t('branch.try');
  },
  get catch() {
    return t('branch.catch');
  },
  get finally() {
    return t('branch.finally');
  },
  get success() {
    return t('branch.success');
  },
  get failed() {
    return t('branch.failed');
  },
};

/** 静态分支端口保留集：颜色表与标签表的键并集。
 *  两函数共用此判定，避免颜色/标签对同一 case label 判定分叉（如 case 名为 "true"）。 */
const STATIC_BRANCH_PORTS = new Set([
  ...Object.keys(BRANCH_PORT_COLORS),
  ...Object.keys(BRANCH_PORT_LABELS),
]);

/** 由 source 节点 kind + sourcePort 推断分支色。
 *  - branch_switch 的动态 case 分支端口（不在静态保留集中）→ hash 选调色板
 *  - 其他节点 → 查 BRANCH_PORT_COLORS 表，无匹配返回 undefined（走默认灰） */
export function getBranchColor(sourceNodeKind: string, sourcePort: string): string | undefined {
  // branch_switch 动态分支端口（不在静态表中）
  if (sourceNodeKind === 'branch_switch' && !STATIC_BRANCH_PORTS.has(sourcePort)) {
    let hash = 0;
    for (let i = 0; i < sourcePort.length; i++) {
      hash = (hash * 31 + sourcePort.charCodeAt(i)) | 0;
    }
    return SWITCH_PALETTE[Math.abs(hash) % SWITCH_PALETTE.length];
  }
  // 静态端口名匹配
  return BRANCH_PORT_COLORS[sourcePort];
}

/** 按端口名映射分支中文标签（getBranchLabel 使用，见上方声明）。 */

/** 由 source 节点 kind + sourcePort 推断分支标签。
 *  返回 undefined 表示不显示标签（如 out/next 默认出口）。 */
export function getBranchLabel(sourceNodeKind: string, sourcePort: string): string | undefined {
  // branch_switch 动态 case 分支：sourcePort 就是 case label（与 getBranchColor 同一判定集合）
  if (sourceNodeKind === 'branch_switch' && !STATIC_BRANCH_PORTS.has(sourcePort)) {
    return sourcePort;
  }
  return BRANCH_PORT_LABELS[sourcePort];
}
