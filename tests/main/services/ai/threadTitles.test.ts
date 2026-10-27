// tests/main/services/ai/threadTitles.test.ts
//
// 第 56 批：线程标题的落盘与生成。
// 钉住四件事：坏文件容忍（不炸列表）、归一后为空要报错、user 重命名会 pin、自动生成最多一次且绝不覆盖用户操作。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@main/services/ai/llm', () => ({ callLlm: vi.fn() }))
vi.mock('@main/services/infra/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { callLlm } from '@main/services/ai/llm'
import {
  THREAD_TITLES_FILE,
  THREAD_TITLES_VERSION,
  maybeGenerateThreadTitle,
  maybeRefreshThreadTitle,
  readThreadTitles,
  renameThreadTitle,
  setThreadTitle,
} from '@main/services/ai/threadTitles'

const callLlmMock = vi.mocked(callLlm)

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-thread-titles-'))
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  return dir
}

function titlesPath(dir: string): string {
  return join(dir, THREAD_TITLES_FILE)
}

async function writeTitlesFile(dir: string, titles: unknown): Promise<void> {
  await writeFile(
    titlesPath(dir),
    JSON.stringify({ version: THREAD_TITLES_VERSION, titles }, null, 2) + '\n',
    'utf-8',
  )
}

beforeEach(() => {
  callLlmMock.mockReset()
})

describe('readThreadTitles：读不出来就当没有', () => {
  it('文件不存在 → 空表', async () => {
    const dir = await makeProject()
    expect(await readThreadTitles(dir)).toEqual({})
  })

  it('正常文件 → 条目（标题按归一后的值返回）', async () => {
    const dir = await makeProject()
    await writeTitlesFile(dir, {
      't-1': {
        title: '\u001B[31m定时提醒\u001B[0m',
        source: 'user',
        updatedAt: '2026-10-26T07:30:00.000Z',
      },
    })
    expect(await readThreadTitles(dir)).toEqual({
      't-1': {
        title: '定时提醒',
        source: 'user',
        updatedAt: '2026-10-26T07:30:00.000Z',
        revision: 1,
      },
    })
  })

  it('JSON 坏 / 版本不认识 / 条目字段不合法 → 分别当空表或丢该条', async () => {
    const dir = await makeProject()
    await writeTitlesFile(dir, {})
    await writeFile(titlesPath(dir), '{不是 json', 'utf-8')
    expect(await readThreadTitles(dir)).toEqual({})

    await writeFile(titlesPath(dir), JSON.stringify({ version: 99, titles: {} }), 'utf-8')
    expect(await readThreadTitles(dir)).toEqual({})

    await writeTitlesFile(dir, {
      't-bad-source': { title: '标题', source: 'robot', updatedAt: 'x' },
      't-bad-title': { title: '\u001B[31m', source: 'user', updatedAt: 'x' },
      't-ok': { title: '好的', source: 'provider', updatedAt: 'x' },
    })
    expect(await readThreadTitles(dir)).toEqual({
      't-ok': { title: '好的', source: 'provider', updatedAt: 'x', revision: 1 },
    })
  })
})

describe('setThreadTitle / renameThreadTitle', () => {
  it('写入后能读回，文件带 version', async () => {
    const dir = await makeProject()
    const record = await setThreadTitle(dir, 't-1', '  给机器人加定时提醒  ', 'provider')
    expect(record).toMatchObject({ title: '给机器人加定时提醒', source: 'provider' })
    expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await readThreadTitles(dir)).toEqual({ 't-1': record })
    const raw = JSON.parse(await readFile(titlesPath(dir), 'utf-8'))
    expect(raw.version).toBe(THREAD_TITLES_VERSION)
  })

  it('重命名固定 user 来源；归一后为空 → 报人话错误', async () => {
    const dir = await makeProject()
    const record = await renameThreadTitle(dir, 't-1', '同事的会话')
    expect(record.source).toBe('user')
    await expect(renameThreadTitle(dir, 't-1', '\u001B[31m\u0007')).rejects.toThrow('标题不能为空')
  })
})

describe('maybeGenerateThreadTitle：旁路生成', () => {
  const config = { provider: 'deepseek', apiKey: 'k', model: 'm' }

  it('配置缺 apiKey / 输入为空 → 不发请求', async () => {
    const dir = await makeProject()
    expect(
      await maybeGenerateThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        prompt: '问',
        responseText: '答',
        config: { ...config, apiKey: '' },
      }),
    ).toBeNull()
    expect(
      await maybeGenerateThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        prompt: '',
        responseText: '答',
        config,
      }),
    ).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })

  it('已有标题 → 不再生成（用户改过就不许覆盖）', async () => {
    const dir = await makeProject()
    await renameThreadTitle(dir, 't-1', '用户标题')
    expect(
      await maybeGenerateThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        prompt: '问',
        responseText: '答',
        config,
      }),
    ).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })

  it('生成成功 → 落盘 provider 来源（标题归一）', async () => {
    const dir = await makeProject()
    callLlmMock.mockImplementation(async (_cfg, messages, _tools, callbacks) => {
      expect(JSON.stringify(messages)).toContain('用户需求')
      callbacks.onChunk({ type: 'text', content: '  给机器人加定时提醒  ' })
      callbacks.onComplete('')
    })
    const record = await maybeGenerateThreadTitle({
      projectPath: dir,
      threadId: 't-1',
      prompt: '给机器人加个每天早上提醒我喝水',
      responseText: '好，已经加好了',
      config,
    })
    expect(record).toMatchObject({ title: '给机器人加定时提醒', source: 'provider' })
    expect((await readThreadTitles(dir))['t-1']).toEqual(record)
  })

  it('生成失败 / 结果为空 → 返回 null 且不写盘', async () => {
    const dir = await makeProject()
    callLlmMock.mockRejectedValue(new Error('401'))
    expect(
      await maybeGenerateThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        prompt: '问',
        responseText: '答',
        config,
      }),
    ).toBeNull()
    expect(await readThreadTitles(dir)).toEqual({})

    callLlmMock.mockImplementation(async (_cfg, _messages, _tools, callbacks) => {
      callbacks.onChunk({ type: 'text', content: '\u001B[31m\u0007' })
      callbacks.onComplete('')
    })
    expect(
      await maybeGenerateThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        prompt: '问',
        responseText: '答',
        config,
      }),
    ).toBeNull()
    expect(await readThreadTitles(dir)).toEqual({})
  })

  it('生成期间用户重命名 → 以用户为准，不覆盖', async () => {
    const dir = await makeProject()
    callLlmMock.mockImplementation(async (_cfg, _messages, _tools, callbacks) => {
      await writeTitlesFile(dir, {
        't-1': { title: '用户改的', source: 'user', updatedAt: '2026-10-26T07:40:00.000Z' },
      })
      callbacks.onChunk({ type: 'text', content: '模型起的标题' })
      callbacks.onComplete('')
    })
    expect(
      await maybeGenerateThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        prompt: '问',
        responseText: '答',
        config,
      }),
    ).toBeNull()
    expect((await readThreadTitles(dir))['t-1']).toMatchObject({
      title: '用户改的',
      source: 'user',
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 第 60 批：每轮刷新（对齐上游 session-title 的 per-turn refresh）
//
// 钉住三件事：**没变就不写盘**（大多数轮次该是零改动）、用户手动标题永不被覆盖、
// 异步窗口里用户改了名要作废（修订号栅栏）。
// ───────────────────────────────────────────────────────────────────────────
describe('maybeRefreshThreadTitle：每轮刷新', () => {
  const config = { provider: 'deepseek', apiKey: 'k', model: 'm' }

  /**
   * 只把 `Date.now` 假掉（不 fake setTimeout）：刷新之间有 2 秒最小间隔，
   * 真睡 2 秒太慢；假掉时间轴就能精确测"间隔内 → 丢、间隔外 → 发"。
   * `AbortSignal.timeout` 用的是 Node 原生计时器，不受影响。
   */
  let fakeNow = 0
  let realNow: typeof Date.now
  beforeEach(() => {
    realNow = Date.now
    fakeNow = realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  /** 把"现在"推到最小间隔之外 */
  function pastMinInterval(ms = 3000): void {
    fakeNow += ms
  }

  /** 让模型回一句标题正文 */
  function replyWith(text: string): void {
    callLlmMock.mockImplementation(async (_cfg, _messages, _tools, callbacks) => {
      callbacks.onChunk({ type: 'text', content: text })
      callbacks.onComplete('')
    })
  }

  async function refresh(
    dir: string,
    messages: string[],
    threadId = 't-1',
  ): Promise<Awaited<ReturnType<typeof maybeRefreshThreadTitle>>> {
    return maybeRefreshThreadTitle({ projectPath: dir, threadId, messages, config })
  }

  it('配置缺 key / 没有消息 → 不发请求', async () => {
    const dir = await makeProject()
    expect(
      await maybeRefreshThreadTitle({
        projectPath: dir,
        threadId: 't-1',
        messages: ['问'],
        config: { ...config, apiKey: '' },
      }),
    ).toBeNull()
    expect(await refresh(dir, [])).toBeNull()
    expect(await refresh(dir, ['   '])).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })

  it('用户手动改过标题 → 永不覆盖（pin）', async () => {
    const dir = await makeProject()
    await renameThreadTitle(dir, 't-1', '用户标题')
    expect(await refresh(dir, ['问', '追问'])).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })

  it('消息条数与上次刷新相同 → 同一个输入不再问第二次', async () => {
    const dir = await makeProject()
    replyWith('定时提醒')
    const first = await refresh(dir, ['给机器人加定时提醒'])
    expect(first).toMatchObject({ title: '定时提醒', source: 'provider', revision: 1 })

    callLlmMock.mockClear()
    pastMinInterval()
    expect(await refresh(dir, ['给机器人加定时提醒'])).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })

  it('模型原样返回现有标题 → 不写盘、不涨修订号', async () => {
    const dir = await makeProject()
    replyWith('定时提醒')
    const first = await refresh(dir, ['给机器人加定时提醒'])
    expect(first?.revision).toBe(1)

    replyWith('定时提醒')
    pastMinInterval()
    expect(await refresh(dir, ['给机器人加定时提醒', '再加个喝水提醒'])).toBeNull()
    // 零改动 = 文件里仍然是同一条
    expect((await readThreadTitles(dir))['t-1']).toEqual(first)
  })

  it('话题变了 → 落盘新标题，修订号 +1、记下输入条数', async () => {
    const dir = await makeProject()
    replyWith('定时提醒')
    await refresh(dir, ['给机器人加定时提醒'])

    replyWith('查天气')
    pastMinInterval()
    const next = await refresh(dir, ['给机器人加定时提醒', '算了，改成每天查天气'])
    expect(next).toMatchObject({ title: '查天气', source: 'provider', revision: 2, inputCount: 2 })
    expect((await readThreadTitles(dir))['t-1']).toEqual(next)
  })

  it('折叠消息超过 4000 字 → 跳过（标题不需要全文）', async () => {
    const dir = await makeProject()
    expect(await refresh(dir, ['很长的需求'.repeat(1000)])).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })

  it('生成期间用户改了名 → 栅栏作废，用户操作赢', async () => {
    const dir = await makeProject()
    callLlmMock.mockImplementation(async (_cfg, _messages, _tools, callbacks) => {
      await renameThreadTitle(dir, 't-1', '用户改的')
      callbacks.onChunk({ type: 'text', content: '模型起的标题' })
      callbacks.onComplete('')
    })
    expect(await refresh(dir, ['问', '追问'])).toBeNull()
    expect((await readThreadTitles(dir))['t-1']).toMatchObject({
      title: '用户改的',
      source: 'user',
    })
  })

  it('2 秒内连发两次 → 只发前一次（后一次马上会被前一次的上下文覆盖）', async () => {
    const dir = await makeProject()
    replyWith('定时提醒')
    const first = await refresh(dir, ['第一条'])
    expect(first).not.toBeNull()
    callLlmMock.mockClear()
    // 同线程、换消息：仍然被最小间隔挡住
    expect(await refresh(dir, ['第一条', '第二条'])).toBeNull()
    expect(callLlmMock).not.toHaveBeenCalled()
  })
})

describe('修订号：每次真落盘 +1（栅栏的口径）', () => {
  it('setThreadTitle 两次 → 1、2；重命名也不重置', async () => {
    const dir = await makeProject()
    const a = await setThreadTitle(dir, 't-1', '第一次', 'provider')
    expect(a.revision).toBe(1)
    const b = await setThreadTitle(dir, 't-1', '第二次', 'provider')
    expect(b.revision).toBe(2)
    const c = await renameThreadTitle(dir, 't-1', '用户改的')
    expect(c.revision).toBe(3)
  })
})
