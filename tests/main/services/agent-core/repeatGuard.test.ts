// tests/main/services/agent-core/repeatGuard.test.ts
//
// # 连续重复调用提醒（搬自 DSH `guard/repeat-tool-reminder`）
//
// 三件事必须成立：只对连续相同的调用计数、命中阈值升级文案、插进对话后模型能看见。
import { describe, it, expect } from 'vitest'
import { RepeatGuard } from '@main/services/agent-core/repeatGuard'
import { runAgentLoop, type ChatTurn } from '@main/services/agent-core/core'

describe('RepeatGuard：计数规则', () => {
  it('★ 参数键序不同也算同一个调用（深键排序）；换个参数就清零', () => {
    const guard = new RepeatGuard({ thresholds: [2] })
    expect(guard.observe('read_file', { path: 'a', offset: 1 })).toBeUndefined()
    // 键序不同，规范化后同一个 key
    expect(guard.observe('read_file', { offset: 1, path: 'a' })).toBeTypeOf('string')
    expect(guard.consecutive).toBe(2)
    // 参数变了：链清零
    expect(guard.observe('read_file', { path: 'b' })).toBeUndefined()
    expect(guard.consecutive).toBe(1)
  })

  it('★ 第一次命中给温和提醒，之后点名工具与次数', () => {
    const guard = new RepeatGuard({ thresholds: [2, 3] })
    guard.observe('run_command', { command: 'ls' })
    const gentle = guard.observe('run_command', { command: 'ls' })!
    const named = guard.observe('run_command', { command: 'ls' })!
    expect(gentle).toContain('repeating the exact same tool call')
    expect(named).toContain('tool: run_command')
    expect(named).toContain('consecutive_calls: 3')
  })

  it('include / exclude 是通配符：不参与的工具既不计数也不清零', () => {
    const guard = new RepeatGuard({ thresholds: [2], include: ['read_*'] })
    guard.observe('read_file', { path: 'a' })
    expect(guard.observe('write_file', { path: 'a' })).toBeUndefined()
    // write_file 透明：链还停在 read_file 的 1
    expect(guard.consecutive).toBe(1)
    expect(guard.observe('read_file', { path: 'a' })).toBeTypeOf('string')

    const excluded = new RepeatGuard({ thresholds: [2], exclude: ['*'] })
    excluded.observe('read_file', { path: 'a' })
    excluded.observe('read_file', { path: 'a' })
    expect(excluded.consecutive).toBe(0)
  })

  it('reset 后重新开始（用户插话的场景）', () => {
    const guard = new RepeatGuard({ thresholds: [3] })
    guard.observe('read_file', { path: 'a' })
    guard.observe('read_file', { path: 'a' })
    guard.reset()
    expect(guard.consecutive).toBe(0)
    expect(guard.observe('read_file', { path: 'a' })).toBeUndefined()
    expect(guard.consecutive).toBe(1)
  })

  it('参数预览有上限，且标出省略了多少字符', () => {
    const guard = new RepeatGuard({ thresholds: [2, 3], argumentsPreviewChars: 12 })
    const big = { path: 'a'.repeat(40) }
    guard.observe('read_file', big)
    guard.observe('read_file', big)
    const text = guard.observe('read_file', big)!
    expect(text).toContain('… (+')
    expect(text.length).toBeLessThan(400)
  })

  it('非法配置直接抛，不静默回退', () => {
    expect(() => new RepeatGuard({ thresholds: [] })).toThrow(/must not be empty/)
    expect(() => new RepeatGuard({ thresholds: [1] })).toThrow(/integer >= 2/)
    expect(() => new RepeatGuard({ thresholds: [3, 3] })).toThrow(/duplicates/)
    expect(() => new RepeatGuard({ argumentsPreviewChars: 0 })).toThrow(/argumentsPreviewChars/)
  })
})

describe('循环里的提醒：真的进对话', () => {
  it('★ 第三次相同调用之后，下一轮请求里多一条「你在重复」的 user 回合', async () => {
    const seen: ChatTurn[][] = []
    let round = 0
    const result = await runAgentLoop({
      workspace: process.cwd(),
      tools: [{ name: 'ping', description: 'd', category: 'query', run: async () => 'PONG' }],
      model: async messages => {
        seen.push([...messages])
        round += 1
        if (round <= 3) return { calls: [{ id: 'c1', name: 'ping', args: { x: 1 } }] }
        return { text: 'done' }
      },
      maxRounds: 5,
    })
    // 第 4 轮请求里应该已经有提醒（第 3 次调用之后注入）
    const last = seen[seen.length - 1]
    const reminder = last.find(
      t => t.role === 'user' && t.content.includes('repeating the exact same tool call'),
    )
    expect(reminder).toBeDefined()
    expect(result.rounds).toBe(4)
    expect(result.toolResults).toHaveLength(3)
  })

  it('repeatGuard: false 时一次提醒都不插', async () => {
    const seen: ChatTurn[][] = []
    let round = 0
    await runAgentLoop({
      workspace: process.cwd(),
      repeatGuard: false,
      tools: [{ name: 'ping', description: 'd', category: 'query', run: async () => 'PONG' }],
      model: async messages => {
        seen.push([...messages])
        round += 1
        if (round <= 3) return { calls: [{ id: 'c1', name: 'ping', args: { x: 1 } }] }
        return { text: 'done' }
      },
      maxRounds: 5,
    })
    expect(seen.flat().some(t => t.content.includes('repeating the exact same'))).toBe(false)
  })
})
