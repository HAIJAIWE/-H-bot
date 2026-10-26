// tests/main/services/ai/threads.test.ts
//
// 第 56 批：线程列表的标题优先级与整条会话统计。
// 钉住：落盘标题（user/provider）优先于 fallback；fallback 是首条需求前 8 词；stats 只算已有事实。
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THREAD_TITLES_FILE, THREAD_TITLES_VERSION } from '@main/services/ai/threadTitles'
import { listThreads, threadFile } from '@main/services/ai/threads'

interface Entry {
  ts: string
  role: 'user' | 'assistant' | 'attempt'
  content: string
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-threads-'))
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
  await mkdir(join(dir, '.qqbat', 'ai-history'), { recursive: true })
  if (threadId === 'default') await mkdir(join(dir, '.qqbat'), { recursive: true })
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
const T1 = '2026-10-26T07:05:00.000Z'

describe('listThreads：标题与统计', () => {
  it('没有落盘标题 → fallback 用首条用户消息前 8 词', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [
      { ts: T0, role: 'user', content: '帮 我 写 个 每 天 早 上 提 醒 我 喝 水 的 定 时 任务' },
      { ts: T1, role: 'assistant', content: '好，已经加好了' },
    ])
    const threads = await listThreads(dir)
    expect(threads).toHaveLength(1)
    expect(threads[0].title).toBe('帮 我 写 个 每 天 早 上')
    expect(threads[0].titleSource).toBe('fallback')
  })

  it('落盘标题优先于 fallback（provider 与 user 都算）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-provider', [{ ts: T0, role: 'user', content: '原始需求' }])
    await writeThread(dir, 't-user', [{ ts: T0, role: 'user', content: '原始需求' }])
    await writeTitles(dir, {
      't-provider': { title: '模型起的标题', source: 'provider', updatedAt: T0 },
      't-user': { title: '用户改的标题', source: 'user', updatedAt: T0 },
    })
    const threads = await listThreads(dir)
    const byId = Object.fromEntries(threads.map(t => [t.id, t]))
    expect(byId['t-provider']).toMatchObject({ title: '模型起的标题', titleSource: 'provider' })
    expect(byId['t-user']).toMatchObject({ title: '用户改的标题', titleSource: 'user' })
  })

  it('标题文件坏了 → 退回 fallback，列表不消失', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [{ ts: T0, role: 'user', content: '原始需求' }])
    await writeFile(join(dir, THREAD_TITLES_FILE), '{坏文件', 'utf-8')
    const threads = await listThreads(dir)
    expect(threads).toHaveLength(1)
    expect(threads[0].title).toBe('原始需求')
    expect(threads[0].titleSource).toBe('fallback')
  })

  it('只有助手消息没有用户消息 → 时间戳兜底（非空标题）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [{ ts: T1, role: 'assistant', content: '先说话的是助手' }])
    const threads = await listThreads(dir)
    expect(threads[0].title.length).toBeGreaterThan(0)
    expect(threads[0].titleSource).toBe('fallback')
  })

  it('stats：轮=用户消息数、字符=正文、估算 token=ceil(chars/4)、时长=首尾 ts 差', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [
      { ts: '2026-10-26T07:00:00.000Z', role: 'user', content: '12345' },
      { ts: '2026-10-26T07:01:00.000Z', role: 'assistant', content: '678' },
      { ts: '2026-10-26T07:02:00.000Z', role: 'user', content: '9' },
      { ts: '2026-10-26T07:03:00.000Z', role: 'assistant', content: '01' },
      { ts: '2026-10-26T07:04:00.000Z', role: 'attempt', content: '失败原因' },
    ])
    const [thread] = await listThreads(dir)
    expect(thread.stats).toEqual({
      turns: 2,
      messages: 5,
      assistantMessages: 2,
      chars: 5 + 3 + 1 + 2,
      estimatedTokens: Math.ceil(11 / 4),
      durationMs: 4 * 60_000,
    })
  })

  it('legacy default 线程 + 目录线程一起列出，按最后活动倒序', async () => {
    const dir = await makeProject()
    await writeThread(dir, 'default', [{ ts: T0, role: 'user', content: '老会话' }], T0)
    await writeThread(dir, 'newer', [{ ts: T1, role: 'user', content: '新会话' }], T1)
    const threads = await listThreads(dir)
    expect(threads.map(t => t.id)).toEqual(['newer', 'default'])
    expect(threads[1]).toMatchObject({ id: 'default', title: '老会话' })
  })
})
