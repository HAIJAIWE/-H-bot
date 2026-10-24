// tests/main/services/agent-core/tokenEstimate.test.ts
//
// # 循环的 token 估算（定价算法来自 vendor/dsh/token-meter）
//
// 四件事：纯文本密度口径没变、回合多算了块结构开销、图片按张算、空回合只算角色框。
import { describe, expect, it } from 'vitest'
import {
  IMAGE_TOKENS,
  estimateTextTokens,
  estimateTurnTokens,
} from '@main/services/agent-core/tokenEstimate'
import type { ChatTurn } from '@main/services/agent-core/core'

const turn = (role: ChatTurn['role'], content: string, images?: readonly string[]): ChatTurn =>
  images ? { role, content, images } : { role, content }

describe('★ 纯文本密度', () => {
  it('ASCII 4 字符 1 token（与旧 estimateTokens 一致）', () => {
    expect(estimateTextTokens('')).toBe(0)
    expect(estimateTextTokens('abcd')).toBe(1)
    expect(estimateTextTokens('x'.repeat(40))).toBe(10)
  })

  it('★ 中文按 1 字符 1 token（vendor 的 measureChars 把它记成 4 个字符）', () => {
    expect(estimateTextTokens('中文中文中文')).toBe(6)
    expect(estimateTextTokens('ab中文')).toBe(3)
  })
})

describe('★ 回合估算', () => {
  it('内容价 + 块结构开销 + 角色框（比旧口径每条多 4）', () => {
    // 'hello' = ceil(5/4)=2，块开销 4，角色框 4
    expect(estimateTurnTokens(turn('user', 'hello'))).toBe(10)
    expect(estimateTurnTokens(turn('assistant', 'x'.repeat(40)))).toBe(18)
  })

  it('空内容只算角色框（工具调用回合没有正文）', () => {
    expect(estimateTurnTokens(turn('tool', ''))).toBe(4)
  })

  it('★ 图片按张算，不按 base64 长度算', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(200_000)
    expect(estimateTurnTokens(turn('user', '看图', [dataUrl]))).toBe(2 + 4 + 4 + IMAGE_TOKENS)
  })
})
