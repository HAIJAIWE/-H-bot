// tests/main/services/ai/threadTitles.test.ts
//
// 第 56 批：线程标题的落盘与生成。
// 钉住四件事：坏文件容忍（不炸列表）、归一后为空要报错、user 重命名会 pin、自动生成最多一次且绝不覆盖用户操作。
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
      't-ok': { title: '好的', source: 'provider', updatedAt: 'x' },
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
