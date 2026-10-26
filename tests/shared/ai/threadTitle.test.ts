// tests/shared/ai/threadTitle.test.ts
//
// 第 56 批：会话标题的归一与截断。
// 钉住三件事：控制序列要被剥掉、字节截断不能切出半个字符、fallback 是"前 N 个词 + 字节上限"。
import { describe, it, expect } from 'vitest'
import {
  THREAD_TITLE_FALLBACK_MAX_BYTES,
  THREAD_TITLE_FALLBACK_MAX_WORDS,
  THREAD_TITLE_MAX_BYTES,
  cleanTitleText,
  fallbackThreadTitle,
  normalizeThreadTitle,
  truncateTitleUtf8,
} from '@shared/ai/threadTitle'

describe('cleanTitleText：剥控制序列 + 折叠空白', () => {
  it('剥掉 CSI/OSC/ESC 控制序列，只留可见文字', () => {
    const raw = '\u001B[31m红色标题\u001B[0m\u001B]0;窗口标题\u0007'
    expect(cleanTitleText(raw)).toBe('红色标题')
  })

  it('剥掉 C0/C1 控制字符与方向性字符，折叠连续空白', () => {
    const raw = '  第一行\u0001  \u007F 第二行 \u202E 反向 \uFEFF'
    expect(cleanTitleText(raw)).toBe('第一行 第二行 反向')
  })

  it('纯控制字符 → 空串', () => {
    expect(cleanTitleText('\u001B[31m\u0007\u009F')).toBe('')
  })
})

describe('truncateTitleUtf8：按码点截，不切半个字符', () => {
  it('ASCII 正好在预算内原样返回', () => {
    expect(truncateTitleUtf8('a'.repeat(THREAD_TITLE_MAX_BYTES), THREAD_TITLE_MAX_BYTES)).toBe(
      'a'.repeat(THREAD_TITLE_MAX_BYTES),
    )
  })

  it('21 个汉字 = 63 字节，通过；第 22 个汉字放不下就不放', () => {
    const title = '汉'.repeat(22)
    expect(truncateTitleUtf8(title, THREAD_TITLE_MAX_BYTES)).toBe('汉'.repeat(21))
  })

  it('放不下下一个码点时停在完整码点边界（不会出 replacement char）', () => {
    const once = truncateTitleUtf8('a'.repeat(62) + '汉', THREAD_TITLE_MAX_BYTES)
    expect(once).toBe('a'.repeat(62))
    expect(once.includes('\uFFFD')).toBe(false)
  })

  it('预算非法/非正 → 空串', () => {
    expect(truncateTitleUtf8('abc', 0)).toBe('')
    expect(truncateTitleUtf8('abc', -1)).toBe('')
    expect(truncateTitleUtf8('abc', Number.NaN)).toBe('')
  })
})

describe('normalizeThreadTitle：清洗 + 64 字节 + 去尾部空白', () => {
  it('生成里的引号和换行都被规整', () => {
    expect(normalizeThreadTitle('  "给机器人\n加定时提醒"  ')).toBe('"给机器人 加定时提醒"')
  })

  it('超长中文按字节截断', () => {
    const out = normalizeThreadTitle('长'.repeat(40))
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(THREAD_TITLE_MAX_BYTES)
    expect(out.length).toBe(21)
  })

  it('归一后为空 → 空串（调用方据此报错）', () => {
    expect(normalizeThreadTitle('\u001B[31m\u0007')).toBe('')
  })
})

describe('fallbackThreadTitle：前 N 个词 + 方言节上限', () => {
  it('取前 8 个词，再按 48 字节截断', () => {
    const out = fallbackThreadTitle('一 二 三 四 五 六 七 八 九 十')
    expect(out.split(' ').length).toBeLessThanOrEqual(THREAD_TITLE_FALLBACK_MAX_WORDS)
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(THREAD_TITLE_FALLBACK_MAX_BYTES)
  })

  it('多行需求先折叠空白再取词', () => {
    expect(fallbackThreadTitle('帮我\n\n  写个定时提醒')).toBe('帮我 写个定时提醒')
  })

  it('空输入 → 空串', () => {
    expect(fallbackThreadTitle('   \u0007 ')).toBe('')
  })
})
