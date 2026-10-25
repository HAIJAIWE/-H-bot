// tests/main/services/ai/timeContext.test.ts
//
// # 时间上下文（2026-10-26，第 55 批，对齐上游 context/time-context）
//
// 输出是**逐字**的两行（设计文档 §3.2），这里按固定时刻断言全文，
// 避免"大概包含 '时间'"这种松断言把格式漂移放过去。
import { describe, it, expect } from 'vitest'
import { buildTimeContext } from '@main/services/ai/timeContext'

// 2026-10-26 07:52:31（+08:00）本地时间；那天是周一
const NOW = new Date('2026-10-25T23:52:31Z')
const zone = 'Asia/Shanghai'

describe('★ 时间行：逐字格式', () => {
  it('★ 固定时区下的完整两行', () => {
    expect(
      buildTimeContext({
        now: NOW,
        timeZone: zone,
        previousMessageAt: new Date('2026-10-25T23:44:31Z').toISOString(),
      }),
    ).toBe(
      ['时间：2026-10-26 07:52:31（Asia/Shanghai，周一）', '距上一条消息：约 8 分钟前'].join('\n'),
    )
  })

  it('UTC 时区：钟面与标签都跟着走（周几按该时区的日历）', () => {
    const text = buildTimeContext({ now: NOW, timeZone: 'UTC' })
    expect(text.split('\n')[0]).toBe('时间：2026-10-25 23:52:31（UTC，周日）')
  })

  it('非法时区退回 UTC（不抛错）', () => {
    const text = buildTimeContext({ now: NOW, timeZone: 'Mars/Olympus' })
    expect(text.split('\n')[0]).toContain('（UTC，周日）')
  })

  it('没有上一条消息（不传 / 空串）', () => {
    expect(buildTimeContext({ now: NOW, timeZone: zone }).split('\n')[1]).toBe(
      '距上一条消息：这是本次对话的第一条消息',
    )
    expect(
      buildTimeContext({ now: NOW, timeZone: zone, previousMessageAt: '' }).split('\n')[1],
    ).toBe('距上一条消息：这是本次对话的第一条消息')
  })

  it('上一条时间非法：明说没有记录，而不是编一个时间', () => {
    expect(
      buildTimeContext({ now: NOW, timeZone: zone, previousMessageAt: '不是时间' }).split('\n')[1],
    ).toBe('距上一条消息：上一条消息没有时间记录')
  })

  it('上一条在未来（时钟被调过）：按"不到 1 分钟"处理，不出现负分钟', () => {
    expect(
      buildTimeContext({
        now: NOW,
        timeZone: zone,
        previousMessageAt: new Date('2026-10-26T01:00:00Z').toISOString(),
      }).split('\n')[1],
    ).toBe('距上一条消息：不到 1 分钟前')
  })
})

describe('★ elapsed：人话分档', () => {
  const elapsedOf = (ms: number) =>
    buildTimeContext({
      now: NOW,
      timeZone: zone,
      previousMessageAt: new Date(NOW.getTime() - ms).toISOString(),
    }).split('\n')[1]

  it('不足 1 分钟（含 40 秒）', () => {
    expect(elapsedOf(40_000)).toBe('距上一条消息：不到 1 分钟前')
  })

  it('8 分钟', () => {
    expect(elapsedOf(8 * 60_000)).toBe('距上一条消息：约 8 分钟前')
  })

  it('2 小时 5 分钟', () => {
    expect(elapsedOf((2 * 60 + 5) * 60_000)).toBe('距上一条消息：约 2 小时 5 分钟前')
  })

  it('1 天 3 小时', () => {
    expect(elapsedOf((24 + 3) * 3_600_000)).toBe('距上一条消息：约 1 天 3 小时前')
  })

  it('超过 30 天只给天数（再细的小时数没意义）', () => {
    expect(elapsedOf(40 * 24 * 3_600_000)).toBe('距上一条消息：约 40 天前')
  })
})
