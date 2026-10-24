// tests/main/services/agent-core/contextGate.test.ts
//
// # 循环内的上下文闸门
//
// 六件事：预算内不动、头与任务句不被压、只压中段、注记说清条数、语义摘要失败要退回、
// 估算器对中文不能低估三倍。
import { describe, it, expect } from 'vitest'
import {
  COMPACTION_NOTE_HEAD,
  MAX_SUMMARY_CHARS,
  applyCompaction,
  buildCompactionNote,
  buildTurnSummaryPrompt,
  estimateTokens,
  estimateTurns,
  makeTurnSummarizer,
  planCompaction,
} from '@main/services/agent-core/contextGate'
import type { ChatTurn } from '@main/services/agent-core/core'

const turn = (role: ChatTurn['role'], content: string, name?: string): ChatTurn =>
  name ? { role, content, name } : { role, content }
/** ASCII 4 字符 ≈ 1 token，方便算预算 */
const ascii = (n: number): string => 'x'.repeat(n)

describe('★ token 估算', () => {
  it('ASCII 按 4 字符 1 token', () => {
    expect(estimateTokens(ascii(4))).toBe(1)
    expect(estimateTokens(ascii(40))).toBe(10)
  })

  it('★ 中文按 1 字符 1 token（旧实现 length/3 会把 3 倍低估）', () => {
    expect(estimateTokens('中文中文中文')).toBe(6)
    expect(estimateTokens('ab中文')).toBe(3)
  })

  it('逐条相加时带一点结构开销', () => {
    expect(estimateTurns([turn('user', ascii(40))])).toBe(14)
  })

  it('★ 贴图按张计 1000 token（不算的话贴图的人以为还有余量）', () => {
    const withImages: ChatTurn = { role: 'user', content: ascii(40), images: ['data:image/png;base64,AA'] }
    expect(estimateTurns([withImages])).toBe(14 + 1000)
    expect(estimateTurns([{ ...withImages, images: ['a', 'b'] }])).toBe(14 + 2000)
    // 没图的回合不多算
    expect(estimateTurns([turn('user', ascii(40))])).toBe(14)
  })
})

describe('★ 压哪一段', () => {
  const headAndTask = [turn('system', 'SYS'), turn('user', 'REQ')]

  it('预算内不压', () => {
    expect(planCompaction(headAndTask, { budgetTokens: 1000 })).toBeNull()
  })

  it('★ 系统提示与任务句留在原地，只压中段', () => {
    const turns = [
      ...headAndTask,
      turn('tool', ascii(400), 'read_file'),
      turn('tool', ascii(400), 'read_file'),
      turn('tool', ascii(400), 'read_file'),
      turn('tool', ascii(400), 'read_file'),
    ]
    const plan = planCompaction(turns, { budgetTokens: 100, keepRecentTurns: 2 })
    expect(plan).not.toBeNull()
    expect(plan!.start).toBe(2)
    expect(plan!.end).toBe(4)
    expect(plan!.dropped).toHaveLength(2)
    expect(plan!.tokensBefore).toBeGreaterThan(plan!.tokensAfter)
  })

  it('没得压时返回 null（尾部保留区盖住了全部中段）', () => {
    const turns = [...headAndTask, turn('tool', ascii(400), 'read_file')]
    expect(planCompaction(turns, { budgetTokens: 10, keepRecentTurns: 2 })).toBeNull()
  })

  it('只有系统提示 + 一条工具输出时也不会压出空注记', () => {
    const turns = [turn('system', 'SYS'), turn('tool', ascii(400))]
    expect(planCompaction(turns, { budgetTokens: 10, keepRecentTurns: 2 })).toBeNull()
  })
})

describe('★ 注记', () => {
  it('确定性摘要带条数、角色与截断', () => {
    const note = buildCompactionNote([
      turn('user', '把 flow.json 里 test001 的回复改掉'),
      turn('tool', ascii(500), 'read_file'),
      turn('assistant', '好'),
    ])
    expect(note.startsWith(COMPACTION_NOTE_HEAD)).toBe(true)
    expect(note).toContain('共 3 条')
    expect(note).toContain('- 用户：把 flow.json')
    expect(note).toContain('- 工具(read_file)：')
    expect(note).not.toContain(ascii(500))
  })

  it('给了语义摘要就直接用它（不再逐条列）', () => {
    const note = buildCompactionNote([turn('tool', 'X', 'read_file')], '已读 flow.json，改了两处')
    expect(note).toContain('已读 flow.json，改了两处')
    expect(note).not.toContain('- 工具(read_file)')
  })

  it('摘要请求的素材有上限（被压下来的工具输出可能 24k 字符一条）', () => {
    const dropped = Array.from({ length: 40 }, () => turn('tool', ascii(2000), 'read_file'))
    const prompt = buildTurnSummaryPrompt(dropped)
    expect(prompt).toContain('…（后面的回合继续省略）')
    expect(prompt.length).toBeLessThan(8000)
  })
})

describe('★ 语义摘要：能退回去', () => {
  it('没给模型就没有摘要器（只用确定性摘要）', () => {
    expect(makeTurnSummarizer(undefined)).toBeUndefined()
  })

  it('摘要过长按上限截断', async () => {
    const summarize = makeTurnSummarizer({
      summarize: async () => '  ' + '摘'.repeat(MAX_SUMMARY_CHARS + 100) + '  ',
    })!
    const text = await summarize([turn('user', 'REQ')])
    expect(text).toHaveLength(MAX_SUMMARY_CHARS)
  })

  it('★ 摘要抛错时返回 undefined（压缩不能变成新的故障点）', async () => {
    const summarize = makeTurnSummarizer({
      summarize: async () => {
        throw new Error('模型挂了')
      },
    })!
    await expect(summarize([turn('user', 'REQ')])).resolves.toBeUndefined()
  })
})

describe('★ 就地落地', () => {
  const grown = (): ChatTurn[] => [
    turn('system', 'SYS'),
    turn('user', 'REQ'),
    turn('tool', ascii(400), 'read_file'),
    turn('tool', ascii(400), 'read_file'),
    turn('tool', ascii(400), 'read_file'),
    turn('tool', ascii(400), 'read_file'),
  ]

  it('没配压缩就什么都不做', async () => {
    const messages = grown()
    await expect(applyCompaction(messages)).resolves.toBeNull()
    expect(messages).toHaveLength(6)
  })

  it('★ 同一个数组就地改（调度器与调用方拿的是同一个引用）', async () => {
    const messages = grown()
    const before = messages
    const outcome = await applyCompaction(messages, { budgetTokens: 100, keepRecentTurns: 2 })
    expect(messages).toBe(before)
    expect(outcome).not.toBeNull()
    expect(outcome!.dropped).toBe(2)
    expect(messages).toHaveLength(5)
    expect(messages[0]!.content).toBe('SYS')
    expect(messages[1]!.content).toBe('REQ')
    expect(messages[2]!.role).toBe('system')
    expect(messages[2]!.content.startsWith(COMPACTION_NOTE_HEAD)).toBe(true)
    expect(messages[4]!.content).toBe(ascii(400))
  })

  it('语义摘要落进注记', async () => {
    const messages = grown()
    await applyCompaction(messages, {
      budgetTokens: 100,
      keepRecentTurns: 2,
      summarize: async () => '读过 flow.json 的两个节点',
    })
    expect(messages[2]!.content).toContain('读过 flow.json 的两个节点')
  })
})
