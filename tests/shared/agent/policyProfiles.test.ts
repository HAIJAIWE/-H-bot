// tests/shared/agent/policyProfiles.test.ts
//
// **A/B 差异表**的闸门（W2）。守的不是数值本身，而是"数值只有一处"：
// 预算常量的**唯一来源**是 PolicyProfile —— 改一处漏一处就会红。
//
// 轮数这条接线在 2026-10-25 断了：旧助手引擎（chatRun.ts 的 MAX_ROUNDS=18，原先由这条用例对齐
// AUTHOR_PROFILE.maxRounds）随助手链路一起删除；现在唯一的循环是 agent-core，它的
// MAX_ROUNDS_DEFAULT=12 是循环自己的默认值、不读 profile（profile 目前只剩预算/守卫/审批三项接在线上）。
// 所以这里不再断言轮数 —— 留着一条指向已删模块的 import 只会让测试替死代码作证。
import { describe, it, expect } from 'vitest'
import { AUTHOR_PROFILE, BOT_PROFILE } from '@shared/agent/policy'
import { CONVERSATION_TOKEN_BUDGET } from '@main/services/ai/tokenBudget'

describe('PolicyProfile：A/B 的差异只有这几项', () => {
  it('★ 对话预算常量 == profile（改一处漏一处就会红）', () => {
    expect(CONVERSATION_TOKEN_BUDGET).toBe(AUTHOR_PROFILE.conversationTokenBudget)
  })

  it('★ 两侧的旋钮都合法，且 B 侧更保守', () => {
    for (const p of [AUTHOR_PROFILE, BOT_PROFILE]) {
      expect(['readonly', 'acceptEdits', 'auto']).toContain(p.guardMode)
      expect(p.maxRounds).toBeGreaterThan(0)
      expect(p.conversationTokenBudget).toBeGreaterThan(0)
      expect(p.toolResultBudgetChars).toBeGreaterThan(0)
    }
    expect(BOT_PROFILE.maxRounds).toBeLessThan(AUTHOR_PROFILE.maxRounds)
    expect(BOT_PROFILE.conversationTokenBudget).toBeLessThan(AUTHOR_PROFILE.conversationTokenBudget)
  })

  it('★ 审批形态与面向对象一致：A 阻塞等用户，B 两阶段，B 不估算用量', () => {
    expect(AUTHOR_PROFILE.approval).toBe('blocking')
    expect(BOT_PROFILE.approval).toBe('twoPhase')
    // 额度必须真实：估出来的用量会让"每天 5 万 token"变成假数
    expect(BOT_PROFILE.estimateUsageWhenMissing).toBe(false)
    expect(AUTHOR_PROFILE.estimateUsageWhenMissing).toBe(true)
  })
})
