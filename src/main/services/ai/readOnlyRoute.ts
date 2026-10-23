// src/main/services/ai/readOnlyRoute.ts
//
// **只读意图的路由判定**（迁移阶段 2a，2026-10-18）。
//
// 判据故意保守：**漏判只是继续走旧链路**（今天的行为）；误判会把"要动手"的需求送进
// 只读循环 —— 用户看到的是"它只会说、不动手"。所以宁可 conservatively false。
import { looksLikeAction } from './planner';

/**
 * 这条需求能不能只走新循环（只读工具子集）。
 *
 * 现在只有一条判据：**没有动作词**。问句、解释、看看现状都算只读；
 * 带"加/改/写/运行…"的一律不切（那些需求要旧链路的流程/代码工具）。
 *
 * @param opts.hasActionWord 注入判据（测试/以后按角色调整用）；不传用共享词表
 */
export function shouldRouteReadOnlyToLoop(
  requirement: string,
  opts: { hasActionWord?: (text: string) => boolean } = {},
): boolean {
  const text = String(requirement ?? '').trim();
  if (text.length === 0) return false;
  return !(opts.hasActionWord ?? looksLikeAction)(text);
}
