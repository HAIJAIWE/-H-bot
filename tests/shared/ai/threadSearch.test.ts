// tests/shared/ai/threadSearch.test.ts
//
// 第 57 批：线程正文搜索的纯函数。
// 钉住四件事：查询归一是**唯一**口径、命中索引与原文片段对得上、上限真的生效、切片段不切碎 emoji。
import { describe, it, expect } from 'vitest'
import {
  THREAD_SEARCH_HITS_PER_THREAD,
  THREAD_SEARCH_QUERY_MAX_CHARS,
  THREAD_SEARCH_SNIPPET_RADIUS,
  formatThreadSearchSnippet,
  matchThreadEntries,
  normalizeThreadSearchQuery,
} from '@shared/ai/threadSearch'

const entries = (...contents: { role?: string; content?: string }[]) => contents

describe('normalizeThreadSearchQuery：trim / 折叠空白 / 小写 / 码点截断', () => {
  it('去掉首尾空白，连续空白（含换行）折成一个空格', () => {
    expect(normalizeThreadSearchQuery('  把超时\n改成   30 秒  ')).toBe('把超时 改成 30 秒')
  })

  it('转小写（查询大小写不影响命中）', () => {
    expect(normalizeThreadSearchQuery('Timeout')).toBe('timeout')
  })

  it(`按码点截到 ${THREAD_SEARCH_QUERY_MAX_CHARS}（不切碎代理对）`, () => {
    const raw = '😀'.repeat(THREAD_SEARCH_QUERY_MAX_CHARS + 10)
    const out = normalizeThreadSearchQuery(raw)
    // 每个 emoji 是一个码点、两个 UTF-16 单元：截断后长度必须是 2 的整数倍
    expect(Array.from(out).length).toBe(THREAD_SEARCH_QUERY_MAX_CHARS)
    expect(out.length).toBe(THREAD_SEARCH_QUERY_MAX_CHARS * 2)
  })

  it('空串 / 纯空白 → 空串', () => {
    expect(normalizeThreadSearchQuery('')).toBe('')
    expect(normalizeThreadSearchQuery('  \n\t ')).toBe('')
  })
})

describe('matchThreadEntries：命中位置与片段', () => {
  it('空查询 → 没有命中（不返回"全部"）', () => {
    expect(matchThreadEntries(entries({ role: 'user', content: '你好' }), '  ')).toEqual([])
  })

  it('命中给出条目下标、角色、以及原文三个片段', () => {
    const hits = matchThreadEntries(
      entries(
        { role: 'user', content: '第一句' },
        { role: 'assistant', content: '把超时改成 30 秒就行' },
      ),
      '超时',
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ index: 1, role: 'assistant', match: '超时' })
    expect(hits[0].before).toBe('把')
    expect(hits[0].after).toBe('改成 30 秒就行')
  })

  it('不区分大小写，但片段保留原文大小写', () => {
    const hits = matchThreadEntries(
      entries({ role: 'user', content: '把 Timeout 改成 30' }),
      'timeout',
    )
    expect(hits[0].match).toBe('Timeout')
  })

  it('最多命中前 N 处（按条目顺序），不会把整条线程都吐出来', () => {
    const hits = matchThreadEntries(
      entries(
        { role: 'user', content: '关键词 1' },
        { role: 'assistant', content: '关键词 2' },
        { role: 'user', content: '关键词 3' },
        { role: 'assistant', content: '关键词 4' },
      ),
      '关键词',
    )
    expect(hits).toHaveLength(THREAD_SEARCH_HITS_PER_THREAD)
    expect(hits.map(h => h.index)).toEqual([0, 1, 2])
  })

  it('同一个条目里出现多次只算一处（用户问的是"哪一轮"，不是"几次"）', () => {
    const hits = matchThreadEntries(entries({ role: 'user', content: '超时 超时 超时' }), '超时')
    expect(hits).toHaveLength(1)
  })

  it('attempt 诊断行与 system 角色不参与搜索', () => {
    const hits = matchThreadEntries(
      entries(
        { role: 'attempt', content: '超时不够' },
        { role: 'system', content: '超时不够' },
        { role: 'user', content: '超时不够' },
      ),
      '超时',
    )
    expect(hits.map(h => h.index)).toEqual([2])
  })

  it('查询比正文长 → 不命中', () => {
    expect(matchThreadEntries(entries({ role: 'user', content: '短' }), '很长很长的查询')).toEqual(
      [],
    )
  })
})

describe('matchThreadEntries：片段边界与省略号', () => {
  it('开头命中 → moreBefore=false；后面还有 → moreAfter=true', () => {
    const long = '超时' + '后'.repeat(THREAD_SEARCH_SNIPPET_RADIUS * 2)
    const hit = matchThreadEntries(entries({ role: 'user', content: long }), '超时')[0]
    expect(hit.moreBefore).toBe(false)
    expect(hit.moreAfter).toBe(true)
    expect(Array.from(hit.after).length).toBe(THREAD_SEARCH_SNIPPET_RADIUS)
  })

  it('中间命中 → 前后都被裁剪，两边的省略号都要有', () => {
    const long =
      '前'.repeat(THREAD_SEARCH_SNIPPET_RADIUS * 2) +
      '超时' +
      '后'.repeat(THREAD_SEARCH_SNIPPET_RADIUS * 2)
    const hit = matchThreadEntries(entries({ role: 'user', content: long }), '超时')[0]
    expect(hit.moreBefore).toBe(true)
    expect(hit.moreAfter).toBe(true)
    expect(Array.from(hit.before).length).toBe(THREAD_SEARCH_SNIPPET_RADIUS)
    expect(Array.from(hit.after).length).toBe(THREAD_SEARCH_SNIPPET_RADIUS)
    expect(formatThreadSearchSnippet(hit)).toBe(`…${hit.before}超时${hit.after}…`)
  })

  it('emoji 附近的命中不切碎代理对（片段里没有 replacement char）', () => {
    const content = '😀😀😀 超时 😀😀😀'
    const hit = matchThreadEntries(entries({ role: 'user', content }), '超时')[0]
    expect(hit.match).toBe('超时')
    expect([hit.before, hit.after].join('')).not.toContain('\uFFFD')
    expect(formatThreadSearchSnippet(hit)).toContain('超时')
  })
})
