// tests/main/services/agent-core/toolResultPrune.test.ts
//
// # 先剪工具结果，再考虑压回合
//
// 五件事：预算内不动、超了保头保尾、只剪 tool 回合、只剪指定区间、
// 按 code point 切不劈代理对（emoji 不能只剩半个）。
import { describe, expect, it } from 'vitest'
import { PRUNE_MARKER } from '@main/vendor/dsh/tool-result-pruner/config'
import { pruneToolTurns, TOOL_PRUNE_DEFAULTS } from '@main/services/agent-core/toolResultPrune'
import type { ChatTurn } from '@main/services/agent-core/core'

const turn = (role: ChatTurn['role'], content: string, name?: string): ChatTurn =>
  name ? { role, content, name } : { role, content }

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/

describe('★ 剪枝策略', () => {
  it('预算内的工具结果原样不动', () => {
    const turns = [turn('tool', 'x'.repeat(100), 'read_file')]
    const outcome = pruneToolTurns(turns, 0, 1)
    expect(outcome).toEqual({ pruned: 0, charsRemoved: 0 })
    expect(turns[0]!.content).toBe('x'.repeat(100))
  })

  it('★ 超了：保头 4096 / 保尾 1024，中间换成上游标记', () => {
    const content = 'x'.repeat(20_000)
    const turns = [turn('tool', content, 'read_file')]
    const outcome = pruneToolTurns(turns, 0, 1)
    const after = turns[0]!.content
    expect(outcome.pruned).toBe(1)
    expect(after.startsWith('x'.repeat(TOOL_PRUNE_DEFAULTS.headChars!))).toBe(true)
    expect(after.endsWith('x'.repeat(TOOL_PRUNE_DEFAULTS.tailChars!))).toBe(true)
    expect(after).toContain(PRUNE_MARKER)
    expect(after.length).toBeLessThan(content.length)
    expect(outcome.charsRemoved).toBe(content.length - after.length)
  })

  it('★ 只剪 tool 回合：用户/助手的话再长也不许剪', () => {
    const long = 'y'.repeat(20_000)
    const turns = [turn('user', long), turn('assistant', long), turn('tool', long)]
    const outcome = pruneToolTurns(turns, 0, 3)
    expect(outcome.pruned).toBe(1)
    expect(turns[0]!.content).toBe(long)
    expect(turns[1]!.content).toBe(long)
    expect(turns[2]!.content).toContain(PRUNE_MARKER)
  })

  it('只剪指定区间（区间外的工具结果不动）', () => {
    const long = 'z'.repeat(20_000)
    const turns = [turn('tool', long), turn('tool', long)]
    const outcome = pruneToolTurns(turns, 1, 2)
    expect(outcome.pruned).toBe(1)
    expect(turns[0]!.content).toBe(long)
    expect(turns[1]!.content).toContain(PRUNE_MARKER)
  })

  it('★ 按 code point 切：emoji 不会只剩半个', () => {
    const content = '😀'.repeat(4000)
    const turns = [turn('tool', content)]
    pruneToolTurns(turns, 0, 1, { thresholdChars: 4000, headChars: 1000, tailChars: 500 })
    expect(turns[0]!.content).not.toMatch(LONE_SURROGATE)
  })
})
