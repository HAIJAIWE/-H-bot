// tests/main/services/ai/parallelDecision.test.ts
//
// # 闸门：只读工具并行的**决策**（P3）
//
// 为什么单独测这个纯函数：并行执行发生在 `dispatchToolCalls` 的预取里，
// 而那个测试夹具是"包装真实 executeTool"（**没有可注入延迟的 mock**）——
// 直接断言"并发峰值"当初就没跑通（我为此撤过两条用例，见提交 8ac28945）。
// 正确的做法就是把判据抽出来（就是本文件），执行路径由既有用例继续覆盖。
import { describe, it, expect } from 'vitest';
import { guardBlockedCalls, shouldParallelizeTools } from '@main/services/ai/chatRun';

const q = (name: string, args: unknown = {}) => ({ name, args });

describe('只读工具并行的决策', () => {
  it('★ 多个只读工具、参数两两不同 → 并行', () => {
    expect(shouldParallelizeTools([q('list_nodes', { kind: 'a' }), q('read_flow', {})])).toBe(true);
    expect(
      shouldParallelizeTools([
        q('list_nodes', { kind: 'a' }),
        q('read_flow', { nodeId: 'n1' }),
        q('list_templates', { id: 'signin-flow' }),
      ]),
    ).toBe(true);
  });

  it('★ 已取消 → 一个都不并行（"点了停止不该再跑任何工具"）', () => {
    const calls = [q('list_nodes', { kind: 'a' }), q('read_flow', {})];
    expect(shouldParallelizeTools(calls, { aborted: true })).toBe(false);
  });

  it('★ 混了 mutation → 不并行（预览图上下文有顺序依赖）', () => {
    expect(
      shouldParallelizeTools([
        q('list_nodes', { kind: 'a' }),
        q('add_node', { nodeKind: 'message_send' }),
      ]),
    ).toBe(false);
  });

  it('★ 参数重复 → 不并行（去重必须按顺序判定）', () => {
    expect(
      shouldParallelizeTools([q('list_nodes', { kind: 'a' }), q('list_nodes', { kind: 'a' })]),
    ).toBe(false);
  });

  it('单个 / 未知工具 / 越界工具 → 不并行', () => {
    expect(shouldParallelizeTools([q('list_nodes', {})])).toBe(false);
    expect(
      shouldParallelizeTools([q('list_nodes', {}), q('压根不存在', {})], {
        knownTools: new Set(['list_nodes', 'read_flow']),
      }),
    ).toBe(false);
    expect(
      shouldParallelizeTools([q('list_nodes', { kind: 'a' }), q('read_flow', {})], {
        allowedTools: new Set(['list_nodes']),
      }),
    ).toBe(false);
  });
});

/**
 * P0-2（2026-10-18）：预取发生在审批**之前**，所以「能不能并行」多了一条前置条件 ——
 * 批次里只要有一个调用需要审批（ask/deny），整批退回串行。
 */
describe('并行预取的前置条件：批次里不能有待审批的调用', () => {
  it('★ run_test（声明 query、handler 真执行）→ 必须挡住整批并行', () => {
    expect(guardBlockedCalls([{ name: 'run_test' }], { mode: 'acceptEdits' })).toEqual(['run_test']);
    expect(
      guardBlockedCalls([{ name: 'read_logs' }, { name: 'run_test' }], { mode: 'acceptEdits' }),
    ).toEqual(['run_test']);
  });

  it('纯只读工具 → 不挡（read_logs 在 PURE_READS 白名单里）', () => {
    expect(
      guardBlockedCalls([{ name: 'read_logs' }, { name: 'read_flow' }], { mode: 'acceptEdits' }),
    ).toEqual([]);
  });

  it('未知工具 → 挡住（fail-safe：不认识就先问）', () => {
    expect(guardBlockedCalls([{ name: 'definitely_unknown' }], { mode: 'acceptEdits' })).toEqual([
      'definitely_unknown',
    ]);
  });

  it('用户已批准（always）→ 解除，恢复并行', () => {
    expect(
      guardBlockedCalls([{ name: 'run_test' }], {
        mode: 'acceptEdits',
        approved: new Set(['run_test']),
      }),
    ).toEqual([]);
  });

  it('全自动模式（auto）→ 不挡（用户显式选择「不询问」）', () => {
    expect(guardBlockedCalls([{ name: 'run_test' }], { mode: 'auto' })).toEqual([]);
  });

  it('提案类 mutation（add_node）→ 不挡：它本来就只进待确认计划', () => {
    expect(guardBlockedCalls([{ name: 'add_node' }], { mode: 'acceptEdits' })).toEqual([]);
  });
});