// src/main/services/ai/allowRules.ts
//
// **「以后别再问」的规则表**（2026-10-18）：审批按钮点过之后，同类动作不再弹窗。
//
// 匹配键是**具体动作**而不是工具名 —— 只按工具名太宽（`run_command` 一个名字底下
// 是 `pnpm test` 和 `git push` 两种事）：write → 相对路径，command → 整条命令，
// tool → 工具名+参数。规则落盘在 `.qqbat/ai-approvals.json`。
//
// 规则必须**能看见、能删**（ChatPanel「已记住 N 个动作」）—— 没有撤销口的自动放行
// 是本仓库明文反对的。取舍与背景见 docs/ai/agent-core-wiring.md §11。
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { AiAllowRule } from '@shared/types/ai';
import { atomicWrite } from '../infra/fileOps';

export type AllowRuleKind = AiAllowRule['kind'];

/** 规则形状只有一份（shared/types/ai.ts），渲染层与本模块共用 */
export type AllowRule = AiAllowRule;

export interface AllowRulesSnapshot {
  version: 1;
  rules: AllowRule[];
}

/** 规则条数上限：再多就不该是"别再问"，而是改配置了 */
export const MAX_ALLOW_RULES = 50;

export function allowRulesPath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'ai-approvals.json');
}

/**
 * 读规则表。**任何异常都当成"没有规则"**（文件不存在 / 写坏了 / 版本不认识）——
 * 审批这条路上不能因为一张可选的便利表而把整轮对话挡死；读不到就退化成"每次都问"，
 * 那是最安全的一侧。
 */
export async function readAllowRules(projectPath: string): Promise<AllowRule[]> {
  try {
    const raw = await readFile(allowRulesPath(projectPath), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AllowRulesSnapshot>;
    if (!Array.isArray(parsed.rules)) return [];
    return parsed.rules.filter(
      (r): r is AllowRule =>
        !!r &&
        typeof r === 'object' &&
        (r.kind === 'write' || r.kind === 'command' || r.kind === 'tool') &&
        typeof r.match === 'string' &&
        r.match.length > 0,
    );
  } catch {
    return [];
  }
}

/** 这条动作在规则表里吗 */
export function ruleMatches(
  rules: readonly AllowRule[],
  req: { kind: AllowRuleKind; match: string },
): boolean {
  return rules.some((r) => r.kind === req.kind && r.match === req.match);
}

async function writeAllowRules(projectPath: string, rules: readonly AllowRule[]): Promise<void> {
  const snapshot: AllowRulesSnapshot = { version: 1, rules: [...rules] };
  await atomicWrite(allowRulesPath(projectPath), JSON.stringify(snapshot, null, 2) + '\n');
}

/** 记一条（去重 + 上限）。返回写入后的整份规则表 */
export async function addAllowRule(
  projectPath: string,
  rule: { kind: AllowRuleKind; match: string },
): Promise<AllowRule[]> {
  const match = rule.match.trim();
  if (!match) return readAllowRules(projectPath);
  const rules = await readAllowRules(projectPath);
  if (ruleMatches(rules, { kind: rule.kind, match })) return rules;
  const next = [...rules, { kind: rule.kind, match, addedAt: new Date().toISOString() }].slice(
    -MAX_ALLOW_RULES,
  );
  await writeAllowRules(projectPath, next);
  return next;
}

/** 删一条（按 kind + match 精确删）。返回删除后的整份规则表 */
export async function removeAllowRule(
  projectPath: string,
  rule: { kind: AllowRuleKind; match: string },
): Promise<AllowRule[]> {
  const rules = await readAllowRules(projectPath);
  const next = rules.filter((r) => !(r.kind === rule.kind && r.match === rule.match));
  if (next.length !== rules.length) await writeAllowRules(projectPath, next);
  return next;
}

/** 全部清空（文件留一个空表，不留"删了但有旧内容的假象"） */
export async function clearAllowRules(projectPath: string): Promise<AllowRule[]> {
  await writeAllowRules(projectPath, []);
  return [];
}

/**
 * 工具调用的匹配键：**同名 + 同参数**才算同一个动作。
 *
 * 参数要排序后再序列化，否则 `{a,b}` 与 `{b,a}` 会被当成两个动作 ——
 * 用户点了"别再问"，下一次同样的调用还是会被问一遍。
 */
export function toolRuleMatch(name: string, args: Record<string, unknown>): string {
  return name + ':' + stableStringify(args);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
