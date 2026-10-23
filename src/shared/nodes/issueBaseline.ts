// src/shared/nodes/issueBaseline.ts
//
// 把校验结果分成「历史遗留」与「本次新出现」。
//
// ## 为什么需要（原注释，来自渲染层）
//
// 一个 246 节点的老项目一打开就有上百条存量问题（实测 102 条：43 条节点没有入口 +
// 59 条必填端口没绑）。这些对用户不是"你刚做错了什么"，而是历史债；一打开就满屏红色/琥珀色，
// 小白会以为"工具坏了"。所以：**打开项目后的第一次校验结果记为基线**，
// 之后新出现的（键不在基线里）才算"新问题"，默认只提示这些。
//
// ## 2026-09-30：从 `renderer/src/lib/` 挪到这里
//
// 因为**主进程也要用**：提案生成时要算出"这次改动引入了哪些问题"（只拦这些，
// 否则用户会被历史问题淹没、学会无视红色）。渲染层与主进程各写一份 = 两份真相，
// 而"哪些算同一条问题"的判据一旦不一致，两边显示的就是两套结论。判据只写在这里。
import type { FlowIssue } from './flowNormalize';

/**
 * 一条问题的稳定标识。
 *
 * 用 code + nodeId + message：同一节点同一规则的同一句话才算"同一条"。
 * 刻意不用数组下标 —— 增删问题会让下标漂移，把历史问题误判成新问题。
 */
export function issueKey(issue: Pick<FlowIssue, 'code' | 'nodeId' | 'message'>): string {
  return `${issue.code}|${issue.nodeId ?? ''}|${issue.message}`;
}

export interface IssueSplit {
  newIssues: FlowIssue[];
  legacyIssues: FlowIssue[];
}

/** 基线为空（还没记过基线）时，所有问题都算历史 —— 宁可少吓人，也不要误报"你刚弄坏了" */
export function splitIssuesByBaseline(
  issues: FlowIssue[],
  baseline: ReadonlySet<string>,
): IssueSplit {
  if (baseline.size === 0) return { newIssues: [], legacyIssues: [...issues] };
  const newIssues: FlowIssue[] = [];
  const legacyIssues: FlowIssue[] = [];
  for (const issue of issues) {
    if (baseline.has(issueKey(issue))) legacyIssues.push(issue);
    else newIssues.push(issue);
  }
  return { newIssues, legacyIssues };
}

/** 一批问题 → 它们的键集合（用于当基线） */
export function issueKeySet(issues: readonly FlowIssue[]): Set<string> {
  return new Set(issues.map((i) => issueKey(i)));
}
