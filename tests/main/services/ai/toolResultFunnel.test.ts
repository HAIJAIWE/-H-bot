// tests/main/services/ai/toolResultFunnel.test.ts
//
// 「工具结果只有一个出口」的审计闸门。
//
// ## 为什么需要一条**审计**测试，而不是再多几个用例
//
// read_flow 那个 30 万 token 的洞能躺那么久，根因不是"预算函数写错了" ——
// 而是**没有任何东西保证每个分支都调了它**。后来实际复查又发现两条漏网：
//   · 工具执行失败的消息（异常消息可以任意大）
//   · MCP 出口整个没有预算
//
// 这类"少写一处"写多少个行为用例都守不住（用例只覆盖它 mock 的那条路径）。
// 所以这里改成守**结构**：全仓库只有 toolMessages.ts 允许写 `toolResult` 字段，
// 谁再另开一条路，这条测试就红。
//
// 与项目既有风格一致（nodeParamAudit / modeListConsistency 都是这种"审计"测试）。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { buildToolResultMessages, buildToolFailureMessages } from '@main/services/ai/toolMessages';
import {
  codePointLength,
  CODING_AGENT_BUDGET,
  setToolResultBudget,
  PRUNE_MARKER,
} from '@main/services/ai/toolResultBudget';

/**
 * ⚠️ 工具结果预算**默认是关的**（用户要求无上限，见 toolResultBudget.ts）。
 * 本文件守的是"漏斗"这个结构，所以显式打开预算 ——
 * 不打开就测不出"裁剪确实经过漏斗"，只测出"什么都没做"。
 */
beforeEach(() => setToolResultBudget(CODING_AGENT_BUDGET));

const AI_DIR = join(process.cwd(), 'src', 'main', 'services', 'ai');

/** 唯一允许构造 `toolResult` 字段的模块 */
const FUNNEL_MODULE = 'toolMessages.ts';

/** 去掉行注释与块注释，避免注释里提到 toolResult: 造成误判 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** 溢出引用夹具（见 toolResultBudget.test.ts 里的说明：没有它就不裁） */
const SPILL = { path: '/proj/.qqbat/ai-spill/x.txt' };

describe('审计：工具结果只有一个构造出口', () => {
  it('★ 除 toolMessages.ts 外，任何 ai/ 模块都不得直接写 `toolResult:`', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(AI_DIR)) {
      if (!name.endsWith('.ts') || name === FUNNEL_MODULE) continue;
      const code = stripComments(readFileSync(join(AI_DIR, name), 'utf-8'));
      if (/\btoolResult\s*:/.test(code)) offenders.push(name);
    }
    expect(
      offenders,
      `这些文件绕过了 toolMessages.ts 直接构造工具结果，等于绕过了预算层：${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('MCP 出口也必须过预算（同一个洞的另一个出口）', () => {
    const mcp = readFileSync(join(process.cwd(), 'src', 'main', 'mcp', 'server.ts'), 'utf-8');
    // 不许再把工具结果裸 JSON.stringify 出去
    expect(mcp).toContain('budgetToolResult');
    expect(stripComments(mcp)).not.toMatch(/text:\s*JSON\.stringify\(result\.result\)/);
  });
});

describe('buildToolResultMessages：消息形状与预算', () => {
  const call = { id: 'c1', name: 'read_flow', args: {} };

  it('产出配套的 assistant(toolCalls) + user(toolResult) 一对', () => {
    const { messages } = buildToolResultMessages(call, { ok: true });
    expect(messages).toHaveLength(2);
    // assistant 侧带调用，user 侧带结果 —— mapChatMessages 靠这个配对出 tool_call_id
    expect(messages[0].toolCalls?.[0].id).toBe('c1');
    expect(messages[1].toolResult).toBeDefined();
    expect(messages[1].role).toBe('user');
  });

  it('超长结果被裁到预算内，并回传裁剪元信息', () => {
    const { messages, budgeted } = buildToolResultMessages(
      call,
      'x'.repeat(500_000),
      undefined,
      SPILL,
    );
    expect(budgeted.pruned).toBe(true);
    expect(budgeted.charsAfter).toBeLessThanOrEqual(CODING_AGENT_BUDGET.thresholdChars);
    // 契约变更（2026-10-01）：裁剪后的结果里必须带**可恢复路径**（fail-open 的配套：
    // 没有路径就不裁，有路径就必须写出来）
    expect(messages[1].toolResult).toContain(SPILL.path);
    // content 与 toolResult 必须是**同一份**文本，否则"量到的"和"发出去的"不是一回事
    expect(messages[1].content).toContain(messages[1].toolResult!);
  });

  it('短结果原样通过', () => {
    const { messages, budgeted } = buildToolResultMessages(call, { a: 1 });
    expect(budgeted.pruned).toBe(false);
    expect(messages[1].toolResult).toContain('"a": 1');
  });
});

describe('buildToolFailureMessages：失败也是一条受预算约束的结果', () => {
  const call = { id: 'c1', name: 'read_flow', args: {} };

  it('★ 携带超大 payload 的异常消息同样被裁剪（这就是当初漏掉的那条路径）', () => {
    const huge = new Error('boom: ' + 'y'.repeat(800_000));
    // 新契约：要裁剪就得有可恢复路径（fail-open）——
    // 所以这条也传 SPILL；"没有路径就不裁"另有专门的用例守着
    const { messages, budgeted } = buildToolFailureMessages(call, huge, undefined, SPILL);
    expect(budgeted.pruned).toBe(true);
    expect(codePointLength(messages[1].toolResult!)).toBeLessThanOrEqual(
      CODING_AGENT_BUDGET.thresholdChars,
    );
  });

  it('普通错误照常传给模型（不是抛出去中断整轮）', () => {
    const { messages } = buildToolFailureMessages(call, new Error('节点不存在'));
    expect(messages[1].toolResult).toContain('节点不存在');
  });

  it('非 Error 类型的抛出物也能处理', () => {
    const { messages } = buildToolFailureMessages(call, '纯字符串错误');
    expect(messages[1].toolResult).toContain('纯字符串错误');
  });
});
