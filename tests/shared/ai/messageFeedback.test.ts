// tests/shared/ai/messageFeedback.test.ts
//
// 第 58 批：消息反馈的共享口径（分类词表 + 说明归一）。
// 钉住：七档分类与上游同名同序；说明剥控制字符、折叠空白、按码点截 500 不切碎 emoji。
import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_CATEGORIES,
  MAX_FEEDBACK_NOTE_CHARS,
  isFeedbackCategory,
  isFeedbackRating,
  normalizeFeedbackNote,
} from '@shared/ai/messageFeedback'

describe('反馈分类词表', () => {
  it('七档、顺序与上游一致', () => {
    expect(FEEDBACK_CATEGORIES).toEqual([
      'task-result',
      'instruction-following',
      'product-interaction',
      'service-stability',
      'resource-cost',
      'security-privacy-permission',
      'other',
    ])
  })

  it('isFeedbackCategory 只认词表里的值', () => {
    expect(isFeedbackCategory('other')).toBe(true)
    expect(isFeedbackCategory('task-result')).toBe(true)
    expect(isFeedbackCategory('taskResult')).toBe(false)
    expect(isFeedbackCategory(null)).toBe(false)
    expect(isFeedbackCategory(undefined)).toBe(false)
  })

  it('isFeedbackRating 只有两档', () => {
    expect(isFeedbackRating('positive')).toBe(true)
    expect(isFeedbackRating('negative')).toBe(true)
    expect(isFeedbackRating('good')).toBe(false)
    expect(isFeedbackRating(1)).toBe(false)
  })
})

describe('normalizeFeedbackNote：说明的三件归一', () => {
  it('剥掉 C0/C1 控制字符（换成空格再折叠）', () => {
    expect(normalizeFeedbackNote('好\u0007的\u001b[31m')).toBe('好 的 [31m')
    expect(normalizeFeedbackNote('\u0000\u0001')).toBe('')
  })

  it('折叠连续空白并 trim', () => {
    expect(normalizeFeedbackNote('  太   慢\n\n了\t ')).toBe('太 慢 了')
  })

  it('空串 / 纯空白 → 空串（调用方据此不落 note）', () => {
    expect(normalizeFeedbackNote('')).toBe('')
    expect(normalizeFeedbackNote('   \n\t ')).toBe('')
  })

  it('按码点截到 500，emoji 不被切碎', () => {
    const long = '😀'.repeat(MAX_FEEDBACK_NOTE_CHARS + 10)
    const out = normalizeFeedbackNote(long)
    expect(Array.from(out)).toHaveLength(MAX_FEEDBACK_NOTE_CHARS)
    // 切点在码点边界 → 最后一个字符仍是完整的 emoji
    expect(out.endsWith('😀')).toBe(true)
    expect(out.length).toBe(MAX_FEEDBACK_NOTE_CHARS * 2)
  })

  it('刚好 500 不超过', () => {
    const exact = 'a'.repeat(MAX_FEEDBACK_NOTE_CHARS)
    expect(normalizeFeedbackNote(exact)).toBe(exact)
  })
})
