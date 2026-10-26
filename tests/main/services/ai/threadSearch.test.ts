// tests/main/services/ai/threadSearch.test.ts
//
// 第 57 批：线程**正文**搜索（主进程侧）。
// 钉住：只搜 user/assistant 正文（不搜标题、不搜思考与工具痕迹）、同线程最多 3 处、
// 结果按"最后活动在前"、空查询不发请求、limit 有上限。
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THREAD_TITLES_FILE, THREAD_TITLES_VERSION } from '@main/services/ai/threadTitles'
import { threadFile } from '@main/services/ai/threads'
import { searchProjectThreads } from '@main/services/ai/threadSearch'

interface Entry {
  ts: string
  role: 'user' | 'assistant' | 'attempt'
  content: string
  reasoning?: string
  trace?: Array<{ name: string; args?: Record<string, unknown>; status?: string; result?: string }>
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-thread-search-'))
  await mkdir(join(dir, '.qqbat', 'ai-history'), { recursive: true })
  return dir
}

async function writeThread(
  dir: string,
  threadId: string,
  entries: Entry[],
  mtimeIso?: string,
): Promise<void> {
  const file = threadFile(dir, threadId)
  await writeFile(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8')
  if (mtimeIso) {
    const at = new Date(mtimeIso)
    await utimes(file, at, at)
  }
}

async function writeTitles(dir: string, titles: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(dir, THREAD_TITLES_FILE),
    JSON.stringify({ version: THREAD_TITLES_VERSION, titles }, null, 2) + '\n',
    'utf-8',
  )
}

const T0 = '2026-10-26T07:00:00.000Z'
const T1 = '2026-10-26T08:00:00.000Z'
const T2 = '2026-10-26T09:00:00.000Z'

describe('searchProjectThreads：正文命中', () => {
  it('命中正文并带回片段，match 保留原文大小写', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-a', [
      { ts: T0, role: 'user', content: '帮我查一下 FOO 的位置' },
      { ts: T1, role: 'assistant', content: '好，我先看看' },
    ])
    const res = await searchProjectThreads(dir, 'foo')
    expect(res.query).toBe('foo')
    expect(res.results).toHaveLength(1)
    const [hit] = res.results[0].hits
    expect(hit).toMatchObject({ index: 0, role: 'user', match: 'FOO' })
    expect(hit.before).toBe('帮我查一下 ')
    expect(hit.after).toBe(' 的位置')
    expect(hit.moreBefore).toBe(false)
    expect(hit.moreAfter).toBe(false)
    // 列表项该有的字段都要在（界面直接拿来渲染行）
    expect(res.results[0]).toMatchObject({ id: 't-a', titleSource: 'fallback' })
    expect(res.results[0].stats.turns).toBe(1)
  })

  it('只搜正文，不搜标题：标题里有关键词但正文没有 → 不返回', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-a', [{ ts: T0, role: 'user', content: '今天天气不错' }])
    await writeTitles(dir, {
      't-a': { title: '寻找关键词的会话', source: 'user', updatedAt: T0 },
    })
    const res = await searchProjectThreads(dir, '关键词')
    expect(res.results).toHaveLength(0)
  })

  it('不搜思考与工具痕迹（那些不进模型记忆，也不该进"我说过什么"的搜索）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-a', [
      {
        ts: T0,
        role: 'assistant',
        content: '看完了',
        reasoning: '目标词在思考里',
        trace: [
          { name: 'read_file', args: { path: '目标词.txt' }, status: 'done', result: '目标词' },
        ],
      },
    ])
    const res = await searchProjectThreads(dir, '目标词')
    expect(res.results).toHaveLength(0)
  })

  it('同一条线程最多 3 处命中，且一处命中 = 一个条目', async () => {
    const dir = await makeProject()
    await writeThread(
      dir,
      't-a',
      Array.from({ length: 5 }, (_, i) => ({
        ts: T0,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `第${i}条里都有检索词`,
      })),
    )
    const res = await searchProjectThreads(dir, '检索词')
    expect(res.results).toHaveLength(1)
    expect(res.results[0].hits).toHaveLength(3)
    expect(res.results[0].hits.map(h => h.index)).toEqual([0, 1, 2])
  })

  it('同一个条目里出现多次只算一处（否则一条长消息会占满全部名额）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-a', [
      { ts: T0, role: 'user', content: '重复词 重复词 重复词，另外还有第二件事' },
      { ts: T1, role: 'assistant', content: '重复词 也出现在这里' },
    ])
    const res = await searchProjectThreads(dir, '重复词')
    expect(res.results[0].hits).toHaveLength(2)
    expect(res.results[0].hits.map(h => h.index)).toEqual([0, 1])
  })

  it('空查询（含纯空白）→ 不发请求，返回空结果', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-a', [{ ts: T0, role: 'user', content: '随便什么' }])
    expect(await searchProjectThreads(dir, '   ')).toEqual({ query: '', results: [] })
  })

  it('查询归一：折叠空白 + 小写（正文是逐字比对，不会被折叠）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-a', [{ ts: T0, role: 'user', content: '前面 A B C 后面' }])
    const res = await searchProjectThreads(dir, '  A   B  C  ')
    expect(res.query).toBe('a b c')
    expect(res.results).toHaveLength(1)
    // 正文里的连续空格不会被折叠 —— 查询归一只是把"人打进来的空格"整理成一种写法
    await writeThread(dir, 't-b', [{ ts: T0, role: 'user', content: '前面 A  B  C 后面' }])
    const missing = await searchProjectThreads(dir, 'A B C')
    expect(missing.results.map(r => r.id)).toEqual(['t-a'])
  })

  it('多条线程命中时按最后活动倒序，limit 生效且有上限 12', async () => {
    const dir = await makeProject()
    await writeThread(dir, 'old', [{ ts: T0, role: 'user', content: '共同词' }], T0)
    await writeThread(dir, 'mid', [{ ts: T1, role: 'user', content: '共同词' }], T1)
    await writeThread(dir, 'new', [{ ts: T2, role: 'user', content: '共同词' }], T2)
    const all = await searchProjectThreads(dir, '共同词')
    expect(all.results.map(r => r.id)).toEqual(['new', 'mid', 'old'])
    const limited = await searchProjectThreads(dir, '共同词', 2)
    expect(limited.results.map(r => r.id)).toEqual(['new', 'mid'])
    const tooMany = await searchProjectThreads(dir, '共同词', 99)
    expect(tooMany.results).toHaveLength(3)
  })

  it('坏行只坏那一行：坏线程跳过，好线程照样命中', async () => {
    const dir = await makeProject()
    await writeFile(threadFile(dir, 'broken'), '{坏行\n', 'utf-8')
    await writeThread(dir, 'good', [{ ts: T0, role: 'user', content: '好线程里有词' }])
    const res = await searchProjectThreads(dir, '有词')
    expect(res.results.map(r => r.id)).toEqual(['good'])
  })
})
