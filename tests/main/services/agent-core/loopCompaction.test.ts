// tests/main/services/agent-core/loopCompaction.test.ts
//
// # 循环级：一轮里越滚越长的 messages 会被压回去
//
// 单元测试只证明"算得对"，这里要证明**循环真的会调它**：
// 模型那边看到的消息数组，在顶出预算之后变小了，而系统提示与任务句还在原位。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgentLoop, type ChatTurn, type Tool } from '@main/services/agent-core/core'
import { COMPACTION_NOTE_HEAD, estimateTurns } from '@main/services/agent-core/contextGate'

let ws: string
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'qqbat-compact-'))
})
afterEach(async () => {
  await rm(ws, { recursive: true, force: true })
})

const OUTPUT = 'y'.repeat(4000)
const bigTool: Tool = {
  name: 'big',
  description: '吐一大段内容（模拟读一个大文件）',
  category: 'query',
  run: async () => OUTPUT,
}

/**
 * 跑 N 轮工具再收尾的循环。
 * 返回的 snapshots 是模型每次**实际看到**的消息；outcomes 是压缩回报。
 */
async function runWithGrowth(toolRounds: number): Promise<{
  snapshots: ChatTurn[][]
  outcomes: Array<{ dropped: number; tokensBefore: number; tokensAfter: number }>
  finalText: string
  rounds: number
}> {
  const snapshots: ChatTurn[][] = []
  const outcomes: Array<{ dropped: number; tokensBefore: number; tokensAfter: number }> = []
  let round = 0
  const result = await runAgentLoop({
    workspace: ws,
    tools: [bigTool],
    initialTurns: [
      { role: 'system', content: 'SYS-RULES' },
      { role: 'user', content: 'REQ-TASK' },
    ],
    maxRounds: toolRounds + 2,
    compaction: { budgetTokens: 2000, keepRecentTurns: 2 },
    onCompact: info => outcomes.push(info),
    model: async messages => {
      snapshots.push(messages.map(m => ({ ...m })))
      round += 1
      if (round <= toolRounds)
        return { text: '', calls: [{ id: 'c' + round, name: 'big', args: {} }] }
      return { text: 'done' }
    },
  })
  return { snapshots, outcomes, finalText: result.finalText, rounds: result.rounds }
}

describe('★ 循环内压缩', () => {
  it('★ 多轮工具输出顶出预算后压缩，头和任务句留在原位', async () => {
    const { snapshots, outcomes, finalText } = await runWithGrowth(5)
    expect(finalText).toBe('done')
    expect(outcomes.length).toBeGreaterThan(0)
    for (const info of outcomes) {
      expect(info.dropped).toBeGreaterThanOrEqual(2)
      expect(info.tokensBefore).toBeGreaterThan(info.tokensAfter)
    }
    const last = snapshots[snapshots.length - 1]!
    expect(last[0]!.content).toBe('SYS-RULES')
    expect(last[1]!.content).toBe('REQ-TASK')
    expect(last.some(t => t.content.startsWith(COMPACTION_NOTE_HEAD))).toBe(true)
    // 最近一次工具结果必须还在（不然模型刚看的东西就没了）
    expect(last[last.length - 1]!.content).toBe(OUTPUT)
  })

  it('★ 压缩后模型看到的消息确实变少了（不是只报了个结果）', async () => {
    const { snapshots } = await runWithGrowth(5)
    const tokenCounts = snapshots.map(s => estimateTurns(s))
    const peak = Math.max(...tokenCounts)
    const last = tokenCounts[tokenCounts.length - 1]!
    expect(last).toBeLessThan(peak)
  })

  it('预算很大时一次都不压（压缩不能变成常态干扰）', async () => {
    const outcomes: unknown[] = []
    let round = 0
    await runAgentLoop({
      workspace: ws,
      tools: [bigTool],
      initialTurns: [
        { role: 'system', content: 'SYS-RULES' },
        { role: 'user', content: 'REQ-TASK' },
      ],
      maxRounds: 4,
      compaction: { budgetTokens: 1_000_000 },
      onCompact: info => outcomes.push(info),
      model: async () => {
        round += 1
        return round <= 2
          ? { text: '', calls: [{ id: 'c' + round, name: 'big', args: {} }] }
          : { text: 'done' }
      },
    })
    expect(outcomes).toEqual([])
  })

  it('不传 compaction 时行为与以前一模一样（默认不压）', async () => {
    const seen: ChatTurn[][] = []
    let round = 0
    await runAgentLoop({
      workspace: ws,
      tools: [bigTool],
      initialTurns: [{ role: 'user', content: 'REQ' }],
      maxRounds: 4,
      model: async messages => {
        seen.push(messages.map(m => ({ ...m })))
        round += 1
        return round <= 2
          ? { text: '', calls: [{ id: 'c' + round, name: 'big', args: {} }] }
          : { text: 'done' }
      },
    })
    // 每次都只多一条工具输出，没有任何 system 注记被插进来
    expect(seen.map(s => s.length)).toEqual([1, 2, 3])
    expect(seen.every(s => !s.some(t => t.content.startsWith(COMPACTION_NOTE_HEAD)))).toBe(true)
  })
})
