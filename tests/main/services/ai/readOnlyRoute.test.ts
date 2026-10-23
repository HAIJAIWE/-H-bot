// tests/main/services/ai/readOnlyRoute.test.ts
//
// **只读路由判定**（迁移阶段 2a）：保守 —— 漏判只是继续走旧链路，误判会把"要动手"的需求
// 送进只读循环（用户看到"它只会说、不动手"）。
import { describe, it, expect } from 'vitest';
import { shouldRouteReadOnlyToLoop } from '@main/services/ai/readOnlyRoute';
import { looksLikeAction, shouldPlan } from '@main/services/ai/planner';

describe('★ 只读路由判定（保守）', () => {
  it('问句/解释类 → 只读', () => {
    expect(shouldRouteReadOnlyToLoop('这个节点是干嘛的？')).toBe(true);
    expect(shouldRouteReadOnlyToLoop('read_flow 返回的 systems 是什么')).toBe(true);
  });

  it('★ 动作词一律不切（宁可漏判）', () => {
    expect(shouldRouteReadOnlyToLoop('加个签到指令')).toBe(false);
    expect(shouldRouteReadOnlyToLoop('把这段改写一下')).toBe(false);
    expect(shouldRouteReadOnlyToLoop('运行一下看看')).toBe(false);
  });

  it('空需求不切', () => {
    expect(shouldRouteReadOnlyToLoop('   ')).toBe(false);
  });

  it('★ 词表只有一份：路由判定与规划器读同一个 looksLikeAction', () => {
    for (const t of ['做一个签到', '解释一下这个节点', '跑一遍']) {
      expect(shouldRouteReadOnlyToLoop(t)).toBe(!looksLikeAction(t));
    }
    // 规划器还有"太短不规划"这条（<20 字），所以用长大的句子钉它的两条判据
    expect(shouldPlan('帮我加个签到指令，用户发送签到就回复已签到')).toBe(true);
    // 问句判据是"以问号结尾或怎么/为什么开头"，所以句子必须以问号收尾
    expect(shouldPlan('这个节点是干嘛的？它为什么会连到两个下游节点呢？')).toBe(false);
  });
});
