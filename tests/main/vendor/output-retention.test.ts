// tests/main/vendor/output-retention.test.ts
//
// 上游 output-retention 的两个 retainer：ItemRetainer（有序条目）与
// TextRetainer（字节流 head/tail/headTail）。这里钉的是**机械事实**：
// 省了多少要精确、UTF-8 边界不许切出半个字符、内存窗口不许无界增长。
import { describe, it, expect } from 'vitest'
import { ItemRetainer, TextRetainer } from '@main/vendor/dsh/output-retention'

describe('ItemRetainer：只留前 N 个，省略数必须精确', () => {
  it('没超上限：全留、truncated=false、omitted=none', () => {
    const r = new ItemRetainer<string>({ kind: 'head', maxItems: 3 })
    const decisions = ['a', 'b', 'c'].map(x => r.push(x))
    const out = r.finish()
    expect(decisions.every(d => d.kept && !d.truncated)).toBe(true)
    expect(out).toEqual({
      items: ['a', 'b', 'c'],
      truncated: false,
      seen: 3,
      kept: 3,
      omitted: { kind: 'none' },
    })
  })

  it('超上限：留下前 N 个，seen 记的是"看过多少"，omitted 是精确值', () => {
    const r = new ItemRetainer<number>({ kind: 'head', maxItems: 2 })
    for (let i = 0; i < 5; i += 1) r.push(i)
    const out = r.finish()
    expect(out.items).toEqual([0, 1])
    expect(out.seen).toBe(5)
    expect(out.kept).toBe(2)
    expect(out.omitted).toEqual({ kind: 'exact', count: 3 })
    expect(out.truncated).toBe(true)
  })

  it('push 的返回值：第一次丢的瞬间 kept=false 且 truncated=true', () => {
    const r = new ItemRetainer<string>({ kind: 'head', maxItems: 1 })
    expect(r.push('a')).toEqual({ kept: true, truncated: false })
    expect(r.push('b')).toEqual({ kept: false, truncated: true })
  })

  it('非法上限直接抛（负数 / 小数 / 非数字）', () => {
    expect(() => new ItemRetainer({ kind: 'head', maxItems: -1 })).toThrow(/maxItems/)
    expect(() => new ItemRetainer({ kind: 'head', maxItems: 1.5 })).toThrow(/maxItems/)
  })
})

describe('TextRetainer：字节窗口 + UTF-8 边界', () => {
  it('head：只留开头，省多少字节精确', () => {
    const r = new TextRetainer({ kind: 'head', maxBytes: 4 })
    r.push('abcdefgh')
    const out = r.finish()
    expect(out.text).toBe('abcd')
    expect(out.truncated).toBe(true)
    expect(out.omittedBytes).toEqual({ kind: 'exact', count: 4 })
  })

  it('tail：留结尾（命令报错在结尾，这条最要紧）', () => {
    const r = new TextRetainer({ kind: 'tail', maxBytes: 4 })
    r.push('abcdefgh')
    const out = r.finish()
    expect(out.text).toBe('efgh')
    expect(out.omittedBytes).toEqual({ kind: 'exact', count: 4 })
  })

  it('headTail：两头都留，中间的省略数精确', () => {
    const r = new TextRetainer({ kind: 'headTail', headBytes: 3, tailBytes: 3 })
    r.push('AAA')
    r.push('BBBB')
    r.push('CCC')
    const out = r.finish()
    expect(out.text).toBe('AAACCC')
    expect(out.omittedBytes).toEqual({ kind: 'exact', count: 4 })
  })

  it('★ 切点落在多字节字符中间：结果里不许出现替换符', () => {
    // "中" = e4 b8 ad；headBytes=1 会切在字中间
    const r = new TextRetainer({ kind: 'headTail', headBytes: 1, tailBytes: 1 })
    r.push('中')
    const out = r.finish()
    expect(out.text).not.toContain('\uFFFD')
    expect(out.text).toBe('')
    // 边界真的被裁掉了，省略量按"实际返回的字节"算，不是按预算算
    expect(out.omittedBytes).toEqual({ kind: 'exact', count: 3 })
  })

  it('没超预算时不做任何裁剪（不能凭空造出省略）', () => {
    const r = new TextRetainer({ kind: 'headTail', headBytes: 4, tailBytes: 4 })
    r.push('中') // 3 字节，两头窗口都装得下
    const out = r.finish()
    expect(out).toEqual({ text: '中', truncated: false, omittedBytes: { kind: 'none' } })
  })

  it('跨块拼接（一帧被切成两半也能还原）', () => {
    const r = new TextRetainer({ kind: 'headTail', headBytes: 2, tailBytes: 2 })
    r.push('ab')
    r.push('cd')
    expect(r.finish().text).toBe('abcd')
  })
})
