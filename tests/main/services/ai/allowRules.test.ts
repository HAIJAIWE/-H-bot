// tests/main/services/ai/allowRules.test.ts
//
// 「以后别再问」的规则表：加/删/清空、去重、上限、匹配语义、坏文件容错。
//
// 这张表决定"哪些动作**不问用户就直接执行**"，所以它的失败方向必须是**保守**的：
// 读不出来就当没有规则（退化成每次都问），绝不能反过来。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_ALLOW_RULES,
  addAllowRule,
  allowRulesPath,
  clearAllowRules,
  readAllowRules,
  removeAllowRule,
  ruleMatches,
  toolRuleMatch,
} from '@main/services/ai/allowRules';

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'qqbat-allow-'));
  await mkdir(join(ws, '.qqbat'), { recursive: true });
});

describe('★ 规则表：增删查 + 容错', () => {
  it('没有文件 = 没有规则（不是报错）', async () => {
    await expect(readAllowRules(ws)).resolves.toEqual([]);
  });

  it('★ 加了就落盘，重复加不产生第二条', async () => {
    await addAllowRule(ws, { kind: 'write', match: 'src/a.ts' });
    const rules = await addAllowRule(ws, { kind: 'write', match: 'src/a.ts' });
    expect(rules).toHaveLength(1);
    expect(await readAllowRules(ws)).toHaveLength(1);
    // 落的是 JSON（人可读、坏了好排查）
    const raw = await readFile(allowRulesPath(ws), 'utf-8');
    expect(JSON.parse(raw).version).toBe(1);
  });

  it('匹配必须 kind + match 同时相等', async () => {
    await addAllowRule(ws, { kind: 'write', match: 'src/a.ts' });
    const rules = await readAllowRules(ws);
    expect(ruleMatches(rules, { kind: 'write', match: 'src/a.ts' })).toBe(true);
    expect(ruleMatches(rules, { kind: 'write', match: 'src/b.ts' })).toBe(false);
    expect(ruleMatches(rules, { kind: 'command', match: 'src/a.ts' })).toBe(false);
  });

  it('删单条只删那一条；清空回到空表', async () => {
    await addAllowRule(ws, { kind: 'write', match: 'a' });
    await addAllowRule(ws, { kind: 'command', match: 'pnpm test' });
    const left = await removeAllowRule(ws, { kind: 'write', match: 'a' });
    expect(left.map((r) => r.kind + ':' + r.match)).toEqual(['command:pnpm test']);
    await expect(clearAllowRules(ws)).resolves.toEqual([]);
    expect(await readAllowRules(ws)).toEqual([]);
  });

  it('★ 坏文件 / 未来格式：当成"没有规则"，不抛错（审批路上不能因此挡住对话）', async () => {
    await writeFile(allowRulesPath(ws), '{ not json', 'utf-8');
    await expect(readAllowRules(ws)).resolves.toEqual([]);
    await writeFile(allowRulesPath(ws), JSON.stringify({ version: 99, rules: 'nope' }), 'utf-8');
    await expect(readAllowRules(ws)).resolves.toEqual([]);
    // 坏文件里夹着一条合法规则也要能用（逐条容错）
    await writeFile(
      allowRulesPath(ws),
      JSON.stringify({ version: 1, rules: [{ kind: 'bogus', match: 'x' }, { kind: 'write', match: 'ok' }] }),
      'utf-8',
    );
    expect((await readAllowRules(ws)).map((r) => r.match)).toEqual(['ok']);
  });

  it('★ 上限：超了丢最旧的（表不能无限长）', async () => {
    for (let i = 0; i < MAX_ALLOW_RULES + 5; i += 1) {
      await addAllowRule(ws, { kind: 'command', match: 'cmd-' + i });
    }
    const rules = await readAllowRules(ws);
    expect(rules).toHaveLength(MAX_ALLOW_RULES);
    expect(rules[0].match).toBe('cmd-5');
  });
});

describe('★ 工具匹配键：同名同参数才算同一个动作', () => {
  it('参数顺序不同 = 同一个动作（排序后再序列化）', () => {
    expect(toolRuleMatch('run_bot', { b: 1, a: 2 })).toBe(toolRuleMatch('run_bot', { a: 2, b: 1 }));
  });

  it('参数不同 / 工具名不同 = 不同动作', () => {
    expect(toolRuleMatch('run_bot', { a: 1 })).not.toBe(toolRuleMatch('run_bot', { a: 2 }));
    expect(toolRuleMatch('run_bot', { a: 1 })).not.toBe(toolRuleMatch('run_test', { a: 1 }));
  });

  it('嵌套对象也稳定', () => {
    const x = toolRuleMatch('t', { o: { z: 1, a: [3, { b: 2, a: 1 }] } });
    const y = toolRuleMatch('t', { o: { a: [3, { a: 1, b: 2 }], z: 1 } });
    expect(x).toBe(y);
  });
});
