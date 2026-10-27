import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_SEARCH_TOOL } from '@main/services/agent-core/sessionSearchTool'
import { appendHistoryEntries } from '@main/services/ai/historyStore'
import { threadFile } from '@main/services/ai/threads'

/**
 * `search_sessions` 工具（第 59 批）。
 *
 * 测的是**工具面**的三件事：能搜到、能排除自己、达上限会说。
 * 具体匹配口径（子串/大小写/片段半径）由 `tests/shared/ai/threadSearch.test.ts` 覆盖，
 * 这里不重复 —— 重复写一遍只会让两处口径早晚分叉。
 */
describe('SESSION_SEARCH_TOOL', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'qqbat-session-search-'))
    mkdirSync(join(projectPath, '.qqbat'), { recursive: true })
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  /** 往某条线程里塞一条记录（走真实落盘路径，不 mock） */
  const seed = async (threadId: string, content: string): Promise<void> => {
    await appendHistoryEntries(
      projectPath,
      [{ ts: new Date().toISOString(), role: 'user', content }],
      threadFile(projectPath, threadId),
    )
  }

  const run = async (
    args: Record<string, unknown>,
    ctx: { workspace: string; threadId?: string },
  ): Promise<string> => {
    const out = await SESSION_SEARCH_TOOL.run(args, ctx)
    return typeof out === 'string' ? out : JSON.stringify(out)
  }

  it('搜到别的线程的正文 → 回标题 + 命中片段', async () => {
    await seed('thread-a', '我们上次改的是 powerShell 的沙箱权限问题')
    const text = await run({ query: '沙箱权限' }, { workspace: projectPath })
    expect(text).toContain('沙箱权限')
    expect(text).not.toContain('没有找到')
  })

  it('★ 排除调用方自己那条线程（不把自己的话当历史证据）', async () => {
    await seed('thread-a', '独一无二的关键词：紫色独角兽')
    // 当前线程是 thread-a → 应被排除
    const text = await run({ query: '紫色独角兽' }, { workspace: projectPath, threadId: 'thread-a' })
    expect(text).toContain('没有找到')
  })

  it('别的线程仍能搜到（排除只作用于自己）', async () => {
    await seed('thread-a', '独一无二的关键词：紫色独角兽')
    await seed('thread-b', '另一条线程的普通内容')
    const text = await run({ query: '紫色独角兽' }, { workspace: projectPath, threadId: 'thread-b' })
    expect(text).toContain('紫色独角兽')
    expect(text).not.toContain('没有找到')
  })

  it('没有命中 → 明确说没有，并提示换个说法', async () => {
    await seed('thread-a', '一些平常的内容')
    const text = await run({ query: '完全不存在的词' }, { workspace: projectPath })
    expect(text).toContain('没有找到包含')
    expect(text).toContain('换个说法')
  })

  it('空查询 → 直接拒绝，不去扫盘', async () => {
    await seed('thread-a', '内容')
    expect(await run({ query: '   ' }, { workspace: projectPath })).toContain('查询为空')
    expect(await run({}, { workspace: projectPath })).toContain('查询为空')
  })

  it('★ 达上限时必须说明「可能还有更多」（否则模型把一页当全集）', async () => {
    // 造满 12 条（= THREAD_SEARCH_MAX_RESULTS）命中的线程
    for (let i = 0; i < 13; i += 1) await seed(`thread-${i}`, `第 ${i} 条含关键词：阈值测试`)
    const text = await run({ query: '阈值测试' }, { workspace: projectPath })
    expect(text).toContain('已达上限')
    expect(text).toContain('更具体')
  })

  it('没到上限时不要多嘴', async () => {
    await seed('thread-a', '只有一条：阈值测试')
    const text = await run({ query: '阈值测试' }, { workspace: projectPath })
    expect(text).not.toContain('已达上限')
  })

  it('limit 参数能收窄返回条数', async () => {
    for (let i = 0; i < 5; i += 1) await seed(`thread-${i}`, `第 ${i} 条含：收窄测试`)
    const text = await run({ query: '收窄测试', limit: 2 }, { workspace: projectPath })
    expect(text).toContain('命中 2 条')
  })

  it('结果里带线程 id 与最后活动时间（模型要能说清出处）', async () => {
    await seed('thread-a', '带出处的内容：定位测试')
    const text = await run({ query: '定位测试' }, { workspace: projectPath })
    expect(text).toContain('会话 thread-a')
    expect(text).toMatch(/最后活动 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  })

  it('工具声明是只读查询、可并行（不必要审批、不阻塞别的工具）', () => {
    expect(SESSION_SEARCH_TOOL.readOnly).toBe(true)
    expect(SESSION_SEARCH_TOOL.category).toBe('query')
    expect(SESSION_SEARCH_TOOL.executionMode).toBe('parallel')
    expect(SESSION_SEARCH_TOOL.approval).toBeUndefined()
    expect(SESSION_SEARCH_TOOL.parameters).toMatchObject({ required: ['query'] })
  })

  it('工作区里没有任何线程 → 不抛错，回"没有找到"', async () => {
    const text = await run({ query: '什么都没有' }, { workspace: projectPath })
    expect(text).toContain('没有找到')
  })
})
