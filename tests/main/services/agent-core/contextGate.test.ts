// tests/main/services/agent-core/contextGate.test.ts
//
// # 循环内的上下文闸门
//
// 八件事：预算内不动、头与任务句不被压、只压中段、注记说清条数、语义摘要失败要退回、
// 估算器对中文不能低估三倍、尾部按 token 保留且**不许劈开工具调用配对**、压了不比注记大就不压。
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
import { PRUNE_MARKER } from '@main/vendor/dsh/tool-result-pruner/config'
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

  it('逐条相加时带结构开销与角色框（定价算法来自 vendor/dsh/token-meter）', () => {
    // 40 个 ASCII = 10 token 密度 + 4 块结构开销 + 4 角色框
    // 旧实现只加 4（角色框），换成上游算法后每条多 4 —— 保守方向，不是回归
    expect(estimateTurns([turn('user', ascii(40))])).toBe(18)
  })

  it('★ assistant 的工具调用参数也要计价（write_file 的 content 可能上万字符）', () => {
    const plain: ChatTurn = { role: 'assistant', content: '' }
    const withCall: ChatTurn = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: '1', name: 'write_file', args: { path: 'a.txt', content: ascii(4000) } }],
    }
    // 4000 字符参数 ≈ 1000 token；以前只算 content，压力被低估到只剩角色框那 4
    expect(estimateTurns([withCall])).toBeGreaterThan(estimateTurns([plain]) + 900)
  })

  it('★ 贴图按张计 1000 token（不算的话贴图的人以为还有余量）', () => {
    const withImages: ChatTurn = {
      role: 'user',
      content: ascii(40),
      images: ['data:image/png;base64,AA'],
    }
    expect(estimateTurns([withImages])).toBe(18 + 1000)
    expect(estimateTurns([{ ...withImages, images: ['a', 'b'] }])).toBe(18 + 2000)
    // 没图的回合不多算
    expect(estimateTurns([turn('user', ascii(40))])).toBe(18)
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

describe('★ 尾部保留：条数下限 + token 保留区（对齐上游 retainTokens）', () => {
  const call = (content: string): ChatTurn => ({
    role: 'assistant',
    content,
    toolCalls: [{ id: content, name: 'read_file', args: { path: 'a.txt' } }],
  })
  const result = (content: string): ChatTurn => ({ role: 'tool', content, toolResult: content })

  it('★ 按 token 多留（只数条数会留得太少：一条工具输出能顶掉几十条短消息）', () => {
    const turns = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      ...Array.from({ length: 20 }, () => turn('user', ascii(40))),
    ]
    // 每条 user 回合 18 token（10 文本 + 4 块开销 + 4 角色框）；100 token ≈ 6 条
    const plan = planCompaction(turns, {
      budgetTokens: 100,
      keepRecentTurns: 2,
      retainTokens: 100,
    })
    expect(plan).not.toBeNull()
    expect(plan!.end).toBe(turns.length - 6)
    expect(plan!.dropped).toHaveLength(14)
  })

  it('条数下限仍然生效（token 保留区很小也不许把现场压掉）', () => {
    const turns = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      ...Array.from({ length: 10 }, (_, i) => turn('tool', ascii(400), 'read_file' + i)),
    ]
    const plan = planCompaction(turns, {
      budgetTokens: 100,
      keepRecentTurns: 4,
      retainTokens: 0,
    })
    expect(plan).not.toBeNull()
    expect(plan!.end).toBe(turns.length - 4)
  })

  it('★ 切口会劈开「调用 / 结果」时往回想（多留一条，也不让厂商 400）', () => {
    const turns: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      call('call-a'),
      result(ascii(400)),
      call('call-b'),
      result(ascii(400)),
      turn('assistant', 'ok'),
    ]
    const plan = planCompaction(turns, {
      budgetTokens: 100,
      keepRecentTurns: 2,
      retainTokens: 0,
    })!
    // 朴素切口 end=5 会丢掉 call-b、留下它的结果 → 退到 4（call-a 与它的结果一起丢）
    expect(plan.end).toBe(4)
    expect(plan.dropped.map(t => t.content)).toEqual(['call-a', ascii(400)])
  })

  it('退到起点已经压不动（不足两条）→ null，而不是切出坏数据', () => {
    const turns: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      call('call-a'),
      result(ascii(400)),
      turn('assistant', 'ok'),
    ]
    expect(
      planCompaction(turns, { budgetTokens: 10, keepRecentTurns: 2, retainTokens: 0 }),
    ).toBeNull()
  })
})

describe('★ 最小收益：压了不比注记大就不压', () => {
  it('★ 只压掉两条空回复（8 token）却贴一条 1200 字备忘录 → 保持原样', async () => {
    const messages: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      turn('assistant', ''),
      turn('assistant', ''),
      turn('tool', ascii(400), 'read_file'),
      turn('tool', ascii(400), 'read_file'),
    ]
    const before = messages.map(m => m.content)
    const outcome = await applyCompaction(messages, {
      budgetTokens: 100,
      keepRecentTurns: 2,
      retainTokens: 0,
      pruneToolResults: false,
    })
    expect(outcome).not.toBeNull()
    expect(outcome!.dropped).toBe(0)
    expect(messages.map(m => m.content)).toEqual(before)
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

describe('★ 先剪工具结果，再考虑压回合', () => {
  const huge = (n: number): string => 'x'.repeat(n)

  it('★ 剪完回到预算内：一条回合都不丢，只留剪枝标记', async () => {
    const messages: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
    ]
    const outcome = await applyCompaction(messages, { budgetTokens: 20_000, keepRecentTurns: 2 })
    expect(outcome).not.toBeNull()
    // 中段两条被剪，剪完总数回到预算内 → 不压回合、不加注记
    expect(outcome!.dropped).toBe(0)
    expect(outcome!.pruned).toBe(2)
    expect(messages).toHaveLength(6)
    expect(messages[2]!.content).toContain(PRUNE_MARKER)
    expect(messages[3]!.content).toContain(PRUNE_MARKER)
    // 尾部保留区不动（推理链不能半剪）
    expect(messages[5]!.content).toBe(huge(20_000))
    expect(messages.some(m => m.content.startsWith(COMPACTION_NOTE_HEAD))).toBe(false)
  })

  it('剪完还超预算：照旧压回合，两件事的计数各自如实', async () => {
    const messages: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
    ]
    const outcome = await applyCompaction(messages, { budgetTokens: 4_000, keepRecentTurns: 2 })
    expect(outcome!.pruned).toBe(2)
    expect(outcome!.dropped).toBe(2)
    expect(messages).toHaveLength(5)
    expect(messages[2]!.role).toBe('system')
    expect(messages[2]!.content.startsWith(COMPACTION_NOTE_HEAD)).toBe(true)
  })

  it('pruneToolResults: false 时退回纯压回合（给不想剪的人留开关）', async () => {
    const messages: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
      turn('tool', huge(20_000), 'read_file'),
    ]
    const outcome = await applyCompaction(messages, {
      budgetTokens: 20_000,
      keepRecentTurns: 2,
      pruneToolResults: false,
    })
    expect(outcome!.pruned).toBe(0)
    expect(outcome!.dropped).toBe(2)
  })
})

describe('★ 到预算 80% 就开始压（不等撞线）', () => {
  // 8 条 400 字符 ASCII 用户回合 ≈ 8×108 + 头尾 22 ≈ 886 token：高于 800、低于 1000
  const nearLimit = (): ChatTurn[] => [
    turn('system', 'SYS'),
    turn('user', 'REQ'),
    ...Array.from({ length: 8 }, () => turn('user', ascii(400))),
  ]

  it('总量在 80%~100% 之间：默认先压，旧语义（必须撞线）会漏', () => {
    const turns = nearLimit()
    expect(estimateTurns(turns)).toBeGreaterThan(800)
    expect(estimateTurns(turns)).toBeLessThan(1000)
    expect(planCompaction(turns, { budgetTokens: 1000, keepRecentTurns: 2 })).not.toBeNull()
  })

  it('thresholdRatio 调高到 0.95：同样的量不压（阈值可配）', () => {
    expect(
      planCompaction(nearLimit(), { budgetTokens: 1000, keepRecentTurns: 2, thresholdRatio: 0.95 }),
    ).toBeNull()
  })

  it('非法 thresholdRatio（>1 / 0 / NaN）退回默认 0.8，不是放任不压', () => {
    for (const bad of [2, 0, Number.NaN]) {
      expect(
        planCompaction(nearLimit(), {
          budgetTokens: 1000,
          keepRecentTurns: 2,
          thresholdRatio: bad,
        }),
      ).not.toBeNull()
    }
  })
})

describe('★ 厂商报上下文超了：只留最后一条的救火', () => {
  it('离阈值还很远也照压：只留最后一条，outcome 标明 overflow', async () => {
    const messages: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      ...Array.from({ length: 6 }, () => turn('user', ascii(400))),
    ]
    const outcome = await applyCompaction(
      messages,
      { budgetTokens: 100_000, keepRecentTurns: 8, pruneToolResults: false },
      'overflow',
    )
    expect(outcome).not.toBeNull()
    expect(outcome!.trigger).toBe('overflow')
    expect(outcome!.dropped).toBe(5)
    expect(messages).toHaveLength(4)
    expect(messages[0]!.content).toBe('SYS')
    expect(messages[1]!.content).toBe('REQ')
    expect(messages[2]!.role).toBe('system')
    expect(messages[3]!.content).toBe(ascii(400))
  })

  it('★ 最后一条是工具结果时，连它的 assistant 调用一起留下', async () => {
    const messages: ChatTurn[] = [
      turn('system', 'SYS'),
      turn('user', 'REQ'),
      turn('user', ascii(400)),
      turn('user', ascii(400)),
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }],
      },
      turn('tool', ascii(400)),
    ]
    const outcome = await applyCompaction(messages, { budgetTokens: 100_000 }, 'overflow')
    expect(outcome).not.toBeNull()
    // 头两条 + 注记 + 配对的两条
    expect(messages).toHaveLength(5)
    expect(messages[2]!.content.startsWith(COMPACTION_NOTE_HEAD)).toBe(true)
    expect(messages[3]!.role).toBe('assistant')
    expect(messages[3]!.toolCalls?.[0]?.id).toBe('c1')
    expect(messages[4]!.role).toBe('tool')
  })

  it('没得压（只有系统提示 + 一条用户）返回 null，调用方保留原始 400', async () => {
    const messages: ChatTurn[] = [turn('system', 'SYS'), turn('user', 'REQ')]
    expect(await applyCompaction(messages, { budgetTokens: 100_000 }, 'overflow')).toBeNull()
    expect(messages).toHaveLength(2)
  })
})
