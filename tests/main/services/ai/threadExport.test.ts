// tests/main/services/ai/threadExport.test.ts
//
// 第 57 批：会话导出 Markdown（主进程侧读记忆 + 组装）。
// 钉住：找不到线程明确报错；导出的头信息/轮次/工具行/耗时都对；
// 思考原文与工具参数**不进导出**（那是过程噪音，不是"我说过什么"）。
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THREAD_TITLES_FILE, THREAD_TITLES_VERSION } from '@main/services/ai/threadTitles'
import { threadFile } from '@main/services/ai/threads'
import { buildThreadMarkdown } from '@main/services/ai/threadExport'

interface Entry {
  ts: string
  role: 'user' | 'assistant' | 'attempt'
  content: string
  reasoning?: string
  turnMs?: number
  reason?: string
  trace?: Array<{ name: string; args?: Record<string, unknown>; status?: string; result?: string }>
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-thread-export-'))
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

async function writeTitle(dir: string, threadId: string, title: string): Promise<void> {
  await writeFile(
    join(dir, THREAD_TITLES_FILE),
    JSON.stringify(
      {
        version: THREAD_TITLES_VERSION,
        titles: { [threadId]: { title, source: 'user', updatedAt: '2026-10-26T07:00:00.000Z' } },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
}

const T0 = '2026-10-26T07:00:00.000Z'
const T1 = '2026-10-26T07:01:00.000Z'
const NOW = new Date(2026, 9, 27, 10, 30, 0) // 本地时间 2026-10-27 10:30:00

describe('buildThreadMarkdown：头信息与轮次', () => {
  it('正常导出：头信息、轮次小节、署名、字节数', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [
      { ts: T0, role: 'user', content: '帮我写个定时任务' },
      { ts: T1, role: 'assistant', content: '好，已经加好了' },
    ])
    await writeTitle(dir, 't-1', '定时任务')
    const payload = await buildThreadMarkdown(dir, 't-1', NOW)
    expect(payload.title).toBe('定时任务')
    expect(payload.threadId).toBe('t-1')
    expect(payload.entries).toBe(2)
    expect(payload.bytes).toBe(Buffer.byteLength(payload.text, 'utf-8'))
    expect(payload.bytes).toBeGreaterThan(0)
    expect(payload.fileName).toContain('定时任务')
    expect(payload.fileName.endsWith('.md')).toBe(true)
    expect(payload.text).toContain('# 定时任务')
    expect(payload.text).toContain('- 会话：`t-1`')
    expect(payload.text).toContain(`- 项目：${dir.split(/[\\/]/).filter(Boolean).pop()}`)
    expect(payload.text).toContain('- 导出时间：2026-10-27 10:30:00')
    expect(payload.text).toContain('- 规模：1 轮 · 2 条消息')
    expect(payload.text).toContain('## 第 1 轮')
    expect(payload.text).toContain('**你**')
    expect(payload.text).toContain('**助手**')
    expect(payload.text).toContain('> 帮我写个定时任务')
    expect(payload.text.endsWith('\n')).toBe(true)
  })

  it('多轮对话按轮编号，工具行与耗时进导出', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [
      { ts: T0, role: 'user', content: '第一问' },
      {
        ts: T1,
        role: 'assistant',
        content: '第一答',
        turnMs: 2500,
        trace: [
          { name: 'read_file', args: { path: 'a.ts' }, status: 'done', result: '内容' },
          { name: 'write_file', args: { path: 'b.ts' }, status: 'error' },
        ],
      },
      { ts: T1, role: 'user', content: '第二问' },
      { ts: T1, role: 'assistant', content: '第二答' },
    ])
    const { text } = await buildThreadMarkdown(dir, 't-1', NOW)
    expect(text).toContain('## 第 1 轮')
    expect(text).toContain('## 第 2 轮')
    expect(text).toContain('**助手**（用时 2.5 秒）')
    expect(text).toContain('- 工具：read_file ✓ · write_file ✗')
  })

  it('思考原文与工具参数不进导出（只留名称/状态）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [
      { ts: T0, role: 'user', content: '问一句' },
      {
        ts: T1,
        role: 'assistant',
        content: '答一句',
        reasoning: '这是不该外流的思考原文',
        trace: [{ name: 'read_file', args: { path: '不该外流的参数' }, status: 'done' }],
      },
    ])
    const { text } = await buildThreadMarkdown(dir, 't-1', NOW)
    expect(text).not.toContain('不该外流的思考原文')
    expect(text).not.toContain('不该外流的参数')
    expect(text).toContain('read_file')
  })

  it('没跑完的一轮导成警告引用块（不是普通助手消息）', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-1', [
      { ts: T0, role: 'user', content: '这轮没跑完' },
      { ts: T1, role: 'attempt', content: '失败细节', reason: '超时' },
    ])
    const { text } = await buildThreadMarkdown(dir, 't-1', NOW)
    expect(text).toContain('> ⚠️ 这一轮没有跑完：超时')
    expect(text).not.toContain('**助手**')
  })

  it('标题里的非法文件名字符被替换，文件名可用', async () => {
    const dir = await makeProject()
    await writeThread(dir, 't-9', [{ ts: T0, role: 'user', content: '随便' }])
    await writeTitle(dir, 't-9', 'a/b:c*? 标题')
    const { fileName } = await buildThreadMarkdown(dir, 't-9', NOW)
    expect(fileName).not.toMatch(/[\\/:*?"<>|]/u)
    expect(fileName).toContain('t-9'.slice(0, 6))
    expect(fileName.endsWith('.md')).toBe(true)
  })

  it('线程不存在 → 明确报错（而不是导出一份空文件）', async () => {
    const dir = await makeProject()
    await expect(buildThreadMarkdown(dir, 'missing', NOW)).rejects.toThrow(
      '找不到这条会话（可能已经被清空或删除）',
    )
  })
})
