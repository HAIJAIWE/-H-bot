// tests/main/services/ai/messageFeedback.test.ts
//
// 第 58 批：消息反馈落盘（主进程侧）。对照 DSH `dsh-message-feedback` 的三条硬语义：
//   ① 反馈只能挂在**真实存在的 assistant 消息**上（target-not-found）；
//   ② 说明超限是**拒绝**而不是悄悄截断（用户会以为自己整段都提交了）；
//   ③ 内容没变就不写盘（重复点赞不该刷 updatedAt，也不该每点一次重写文件）。
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { threadFile } from '@main/services/ai/threads'
import {
  MessageFeedbackError,
  clearThreadFeedback,
  deleteMessageFeedback,
  feedbackPath,
  readThreadFeedback,
  setMessageFeedback,
} from '@main/services/ai/messageFeedback'

interface Entry {
  id?: string
  ts: string
  role: 'user' | 'assistant' | 'attempt'
  content: string
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-msg-feedback-'))
  await mkdir(join(dir, '.qqbat', 'ai-history'), { recursive: true })
  return dir
}

async function writeThread(dir: string, threadId: string, entries: Entry[]): Promise<void> {
  await writeFile(
    threadFile(dir, threadId),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n',
    'utf-8',
  )
}

const TS = '2026-10-27T02:00:00.000Z'

/** 一条线程：user + 带稳定 id 的 assistant（反馈只能挂后者） */
async function makeThread(dir: string, threadId = 'default'): Promise<void> {
  await writeThread(dir, threadId, [
    { ts: TS, role: 'user', content: '问一句' },
    { id: 'msg-a1', ts: TS, role: 'assistant', content: '答一句' },
  ])
}

function readItems(dir: string, threadId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(feedbackPath(dir, threadId), 'utf-8')).items
}

describe('setMessageFeedback：只能挂在真实存在的回答上', () => {
  it('好评落盘到 .qqbat/ai-feedback/<线程>.json', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    const item = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'positive',
    })
    expect(item.rating).toBe('positive')
    expect(item.createdAt).toBe(item.updatedAt)
    expect(
      feedbackPath(dir, 'default').endsWith(join('.qqbat', 'ai-feedback', 'default.json')),
    ).toBe(true)
    const onDisk = JSON.parse(readFileSync(feedbackPath(dir, 'default'), 'utf-8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.items['msg-a1'].rating).toBe('positive')
  })

  it('消息 id 不存在 → target-not-found', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    await expect(
      setMessageFeedback({
        projectPath: dir,
        threadId: 'default',
        messageId: 'msg-nope',
        rating: 'negative',
      }),
    ).rejects.toMatchObject({ code: 'target-not-found' })
  })

  it('user 消息不能打反馈（只认 assistant）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 'default', [
      { id: 'msg-u1', ts: TS, role: 'user', content: '我' },
      { id: 'msg-a1', ts: TS, role: 'assistant', content: '它' },
    ])
    await expect(
      setMessageFeedback({
        projectPath: dir,
        threadId: 'default',
        messageId: 'msg-u1',
        rating: 'positive',
      }),
    ).rejects.toMatchObject({ code: 'target-not-found' })
  })

  it('未知分类 → invalid-category；未知评分 → invalid-rating', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    const base = { projectPath: dir, threadId: 'default', messageId: 'msg-a1' }
    await expect(
      setMessageFeedback({ ...base, rating: 'positive', category: 'nope' as never }),
    ).rejects.toMatchObject({ code: 'invalid-category' })
    await expect(setMessageFeedback({ ...base, rating: 'good' as never })).rejects.toMatchObject({
      code: 'invalid-rating',
    })
  })

  it('说明归一后落盘；纯控制字符等于没写', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    const item = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'negative',
      category: 'service-stability',
      note: '  太   慢\n了  ',
    })
    expect(item.note).toBe('太 慢 了')
    expect(item.category).toBe('service-stability')

    const item2 = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'negative',
      note: '\u0000\u0007',
    })
    expect('note' in item2).toBe(false)
  })

  it('说明超限是拒绝，不是截断', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    await expect(
      setMessageFeedback({
        projectPath: dir,
        threadId: 'default',
        messageId: 'msg-a1',
        rating: 'positive',
        note: 'a'.repeat(2001),
      }),
    ).rejects.toBeInstanceOf(MessageFeedbackError)
    await expect(
      setMessageFeedback({
        projectPath: dir,
        threadId: 'default',
        messageId: 'msg-a1',
        rating: 'positive',
        note: 'a'.repeat(2001),
      }),
    ).rejects.toMatchObject({ code: 'note-too-long' })
  })
})

describe('setMessageFeedback：幂等与 createdAt', () => {
  it('内容没变 → 不写盘、updatedAt 不动', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    const first = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'positive',
    })
    // 手工把 updatedAt 改成明显不同的过去时间：若再次写入，文件里就会变
    const onDisk = JSON.parse(readFileSync(feedbackPath(dir, 'default'), 'utf-8'))
    onDisk.items['msg-a1'].updatedAt = '2020-01-01T00:00:00.000Z'
    await writeFile(feedbackPath(dir, 'default'), JSON.stringify(onDisk), 'utf-8')

    const second = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'positive',
    })
    expect(second.createdAt).toBe(first.createdAt)
    expect(readItems(dir, 'default')['msg-a1']).toMatchObject({
      updatedAt: '2020-01-01T00:00:00.000Z',
    })
  })

  it('改评分 → createdAt 保留、updatedAt 变', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    const first = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'positive',
    })
    const second = await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'negative',
    })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.rating).toBe('negative')
    expect(readItems(dir, 'default')['msg-a1']).toMatchObject({ rating: 'negative' })
  })
})

describe('deleteMessageFeedback / clearThreadFeedback', () => {
  it('撤回：第一次 true、第二次 false（不存在不报错）', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    const base = { projectPath: dir, threadId: 'default', messageId: 'msg-a1' }
    await setMessageFeedback({ ...base, rating: 'positive' })
    await expect(deleteMessageFeedback(base)).resolves.toBe(true)
    await expect(readThreadFeedback(dir, 'default')).resolves.toEqual({})
    await expect(deleteMessageFeedback(base)).resolves.toBe(false)
  })

  it('清空线程反馈', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'negative',
      note: '慢',
    })
    await clearThreadFeedback(dir, 'default')
    await expect(readThreadFeedback(dir, 'default')).resolves.toEqual({})
  })

  it('两条线程的反馈互不影响', async () => {
    const dir = await makeProject()
    await makeThread(dir, 'default')
    await makeThread(dir, 'thread-b')
    await setMessageFeedback({
      projectPath: dir,
      threadId: 'default',
      messageId: 'msg-a1',
      rating: 'positive',
    })
    await setMessageFeedback({
      projectPath: dir,
      threadId: 'thread-b',
      messageId: 'msg-a1',
      rating: 'negative',
    })
    expect(basename(feedbackPath(dir, 'thread-b'))).toBe('thread-b.json')
    await expect(readThreadFeedback(dir, 'default')).resolves.toMatchObject({
      'msg-a1': { rating: 'positive' },
    })
    await expect(readThreadFeedback(dir, 'thread-b')).resolves.toMatchObject({
      'msg-a1': { rating: 'negative' },
    })
  })

  it('坏文件 / 坏版本 → 按空表读，不抛', async () => {
    const dir = await makeProject()
    await makeThread(dir)
    await mkdir(join(dir, '.qqbat', 'ai-feedback'), { recursive: true })
    await writeFile(feedbackPath(dir, 'default'), '{ 这不是 json', 'utf-8')
    await expect(readThreadFeedback(dir, 'default')).resolves.toEqual({})

    await writeFile(
      feedbackPath(dir, 'default'),
      JSON.stringify({ version: 99, items: { 'msg-a1': { rating: 'positive' } } }),
      'utf-8',
    )
    await expect(readThreadFeedback(dir, 'default')).resolves.toEqual({})
  })
})
