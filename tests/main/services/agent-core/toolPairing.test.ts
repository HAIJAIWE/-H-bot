// tests/main/services/agent-core/toolPairing.test.ts
//
// # 工具调用配对（对齐 DSH `compaction/tool-pairing`）
//
// 压缩的切口只有在"没有跨切口的未完成调用"时才安全。这里锁住四件事：
// 增减口径、配平切口、坏数据（结果没有调用）不抛错但整段不可切、往回退到配平点。
import { describe, it, expect } from 'vitest'
import {
  retreatToBalancedCut,
  toolCallDelta,
  toolPairingBalancedBefore,
  toolPairingCuts,
} from '@main/services/agent-core/toolPairing'
import type { ChatTurn } from '@main/services/agent-core/core'

const assistant = (content: string, calls: number): ChatTurn => ({
  role: 'assistant',
  content,
  toolCalls: Array.from({ length: calls }, (_, i) => ({
    id: content + '-' + i,
    name: 'read_file',
    args: { path: 'a.txt' },
  })),
})
const result = (content: string): ChatTurn => ({ role: 'tool', content, toolResult: content })
const text = (role: ChatTurn['role'], content: string): ChatTurn => ({ role, content })

describe('★ 增减口径', () => {
  it('assistant 每带一个调用 +N，tool 结果 −1，其余不变', () => {
    expect(toolCallDelta(assistant('a', 2))).toBe(2)
    expect(toolCallDelta(result('r'))).toBe(-1)
    expect(toolCallDelta(text('user', 'hi'))).toBe(0)
    expect(toolCallDelta(text('system', 'sys'))).toBe(0)
  })
})

describe('★ 哪些切口安全', () => {
  it('配平的序列每个切口都安全', () => {
    const turns = [assistant('a', 1), result('r1'), assistant('b', 1), result('r2')]
    expect(toolPairingCuts(turns)).toEqual([true, false, true, false, true])
  })

  it('★ 调用在中段、结果在尾部：切口不安全（这就是厂商 400 的形状）', () => {
    const turns = [assistant('a', 1), result('r1')]
    expect(toolPairingBalancedBefore(turns, 1)).toBe(false)
    expect(toolPairingBalancedBefore(turns, 2)).toBe(true)
  })

  it('并发调用要等全部结果回来才配平', () => {
    const turns = [assistant('a', 2), result('r1'), result('r2')]
    expect(toolPairingCuts(turns)).toEqual([true, false, false, true])
  })

  it('★ 结果没有调用（坏数据）：不抛错，但从那里起一律不可切', () => {
    const turns = [result('孤儿结果'), assistant('a', 1), result('r1')]
    expect(toolPairingCuts(turns)).toEqual([true, false, false, false])
  })

  it('切口越界直接判不安全', () => {
    const turns = [assistant('a', 1), result('r1')]
    expect(toolPairingBalancedBefore(turns, -1)).toBe(false)
    expect(toolPairingBalancedBefore(turns, 99)).toBe(false)
  })
})

describe('★ 往回退到配平点', () => {
  const turns = [assistant('a', 1), result('r1'), assistant('b', 1)]

  it('从想切的位置往回退（退 = 多留）', () => {
    expect(retreatToBalancedCut(turns, 3, 0)).toBe(2)
    expect(retreatToBalancedCut(turns, 2, 0)).toBe(2)
  })

  it('下限之上找不到就返回 −1（调用方放弃这次压缩）', () => {
    expect(retreatToBalancedCut(turns, 3, 3)).toBe(-1)
  })
})
