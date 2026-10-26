// tests/shared/ai/turnOutline.test.ts
//
// 第 56 批：回合目录切分。
// 钉住：轮数从 1 开始、response 取本轮最后一条 assistant、预览截断 50/120、没有用户消息就是空目录。
import { describe, it, expect } from 'vitest'
import {
  TURN_PROMPT_PREVIEW_LIMIT,
  TURN_RESPONSE_PREVIEW_LIMIT,
  buildTurnOutline,
  previewText,
} from '@shared/ai/turnOutline'

describe('previewText：折叠空白 + 截断 + 省略号', () => {
  it('把换行/多空格折叠成单空格', () => {
    expect(previewText('第一行\n\n  第二行', 50)).toBe('第一行 第二行')
  })

  it('超过上限截断并加 …', () => {
    const out = previewText('字'.repeat(TURN_PROMPT_PREVIEW_LIMIT + 5), TURN_PROMPT_PREVIEW_LIMIT)
    expect(out).toBe('字'.repeat(TURN_PROMPT_PREVIEW_LIMIT) + '…')
  })

  it('空内容 → 空串', () => {
    expect(previewText('   ', 10)).toBe('')
  })
})

describe('buildTurnOutline：每轮一条', () => {
  it('没有用户消息 → 空数组（不造空轮）', () => {
    expect(buildTurnOutline([{ role: 'system', content: 'x' }])).toEqual([])
  })

  it('每轮记 userIndex / turn，response 取本轮最后一条 assistant', () => {
    const messages = [
      { role: 'system', content: '提示词' },
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '中间半句' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
      { role: 'assistant', content: '第二答' },
    ]
    const outline = buildTurnOutline(messages)
    expect(outline).toHaveLength(2)
    expect(outline[0]).toMatchObject({
      turn: 1,
      userIndex: 1,
      prompt: '第一问',
      response: '第一答',
    })
    expect(outline[1]).toMatchObject({
      turn: 2,
      userIndex: 4,
      prompt: '第二问',
      response: '第二答',
    })
  })

  it('本轮只有工具过程没正文 → response 空串', () => {
    const outline = buildTurnOutline([
      { role: 'user', content: '问' },
      { role: 'assistant', content: '   ' },
    ])
    expect(outline[0].response).toBe('')
  })

  it('超长 prompt/response 按 50/120 截断', () => {
    const outline = buildTurnOutline([
      { role: 'user', content: '需'.repeat(80) },
      { role: 'assistant', content: '答'.repeat(200) },
    ])
    expect(outline[0].prompt).toBe('需'.repeat(TURN_PROMPT_PREVIEW_LIMIT) + '…')
    expect(outline[0].response).toBe('答'.repeat(TURN_RESPONSE_PREVIEW_LIMIT) + '…')
  })

  it('attempt 等非 user/assistant 角色不参与', () => {
    const outline = buildTurnOutline([
      { role: 'user', content: '问' },
      { role: 'attempt', content: '尝试状态' },
      { role: 'assistant', content: '答' },
    ])
    expect(outline).toHaveLength(1)
    expect(outline[0].response).toBe('答')
  })
})
