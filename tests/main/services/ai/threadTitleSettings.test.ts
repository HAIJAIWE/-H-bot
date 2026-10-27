// tests/main/services/ai/threadTitleSettings.test.ts
//
// 「每轮自动刷新会话标题」设置的读写与生效语义（第 60 批，形状照 parallelToolCallsSettings）。
//
// 三条最要紧的：
//   · 文件不存在 / 坏 JSON / 非法 mode → 一律回落默认 auto，不抛
//   · 默认必须是 **auto**（加开关之前每轮都会自动刷新），否则等于"升级悄悄改了默认行为"
//   · apply 之后 `threadTitleAutoRefreshEnabled()` 必须反映当前值 —— 轮次末尾只读它
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pathsState = vi.hoisted(() => ({ root: '' }))

vi.mock('@main/services/infra/paths', async () => {
  const { join: j } = await import('node:path')
  const { existsSync } = await import('node:fs')
  const current = () => j(pathsState.root, 'config', 'ai-thread-title-refresh.json')
  return {
    USER_DATA_LAYOUT: { aiThreadTitleRefresh: ['config', 'ai-thread-title-refresh.json'] },
    LEGACY_USER_DATA_LAYOUT: {},
    userDataRoot: () => pathsState.root || null,
    // 读侧：只有文件真的存在才回路径（模拟 existingUserDataPath 的语义）
    existingUserDataPath: () => (existsSync(current()) ? current() : null),
    userDataPathOrThrow: () => current(),
    legacyUserDataPath: () => null,
    userDataPath: () => current(),
    runtimeDir: () => null,
  }
})

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

import {
  DEFAULT_THREAD_TITLE_REFRESH,
  applyThreadTitleRefreshSetting,
  currentThreadTitleRefreshSetting,
  loadAndApplyThreadTitleRefresh,
  readThreadTitleRefreshSetting,
  threadTitleAutoRefreshEnabled,
  threadTitleRefreshSchema,
  writeThreadTitleRefreshSetting,
} from '@main/services/ai/threadTitleSettings'

let root = ''

function settingFile(): string {
  return join(root, 'config', 'ai-thread-title-refresh.json')
}

/** 每个用例开始都回到"默认已应用"的状态：模块级 active 是跨用例共享的 */
function resetActive(): void {
  applyThreadTitleRefreshSetting({ ...DEFAULT_THREAD_TITLE_REFRESH })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qqbat-title-refresh-'))
  pathsState.root = root
  mkdirSync(join(root, 'config'), { recursive: true })
  resetActive()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('读设置', () => {
  it('文件不存在 → 默认值（auto）', async () => {
    expect(await readThreadTitleRefreshSetting()).toEqual({ mode: 'auto' })
  })

  it('默认值是 auto —— 加开关之前每轮都会刷新，默认值必须保持那个行为', () => {
    expect(DEFAULT_THREAD_TITLE_REFRESH).toEqual({ mode: 'auto' })
  })

  it('正常文件按盘上内容读回', async () => {
    writeFileSync(settingFile(), JSON.stringify({ mode: 'off' }), 'utf-8')
    expect(await readThreadTitleRefreshSetting()).toEqual({ mode: 'off' })
  })

  it('坏 JSON → 默认值，不抛', async () => {
    writeFileSync(settingFile(), '{ 这不是 json', 'utf-8')
    expect(await readThreadTitleRefreshSetting()).toEqual(DEFAULT_THREAD_TITLE_REFRESH)
  })

  it('非法 mode（on / AUTO / 空串 / 数字）→ 默认值，不抛', async () => {
    for (const bad of ['on', 'AUTO', '', 1]) {
      writeFileSync(settingFile(), JSON.stringify({ mode: bad }), 'utf-8')
      expect(await readThreadTitleRefreshSetting()).toEqual(DEFAULT_THREAD_TITLE_REFRESH)
    }
  })

  it('缺字段 → 默认值', async () => {
    writeFileSync(settingFile(), JSON.stringify({}), 'utf-8')
    expect(await readThreadTitleRefreshSetting()).toEqual(DEFAULT_THREAD_TITLE_REFRESH)
  })
})

describe('写设置', () => {
  it('写盘是整份 JSON（人能看懂、能手改）', async () => {
    await writeThreadTitleRefreshSetting({ mode: 'off' })
    const raw = readFileSync(settingFile(), 'utf-8')
    expect(JSON.parse(raw)).toEqual({ mode: 'off' })
    expect(raw).toContain('\n') // 有缩进，不是一行压扁
  })

  it('写完能读回来（往返一致）', async () => {
    await writeThreadTitleRefreshSetting({ mode: 'off' })
    expect(await readThreadTitleRefreshSetting()).toEqual({ mode: 'off' })
  })
})

describe('应用到运行时', () => {
  it('apply 之后 current 反映新值', () => {
    applyThreadTitleRefreshSetting({ mode: 'off' })
    expect(currentThreadTitleRefreshSetting()).toEqual({ mode: 'off' })
  })

  it('current 返回副本：外部改动不会污染运行时状态', () => {
    applyThreadTitleRefreshSetting({ mode: 'off' })
    const snapshot = currentThreadTitleRefreshSetting()
    snapshot.mode = 'auto'
    expect(currentThreadTitleRefreshSetting().mode).toBe('off')
  })

  it('loadAndApply 读盘并应用', async () => {
    writeFileSync(settingFile(), JSON.stringify({ mode: 'off' }), 'utf-8')
    const applied = await loadAndApplyThreadTitleRefresh()
    expect(applied.mode).toBe('off')
    expect(threadTitleAutoRefreshEnabled()).toBe(false)
  })

  it('loadAndApply 遇到坏文件不阻断启动（回落默认并应用）', async () => {
    writeFileSync(settingFile(), 'nope', 'utf-8')
    await loadAndApplyThreadTitleRefresh()
    expect(threadTitleAutoRefreshEnabled()).toBe(true)
  })
})

describe('★ threadTitleAutoRefreshEnabled：只有 auto 才是 true', () => {
  it('auto → true', () => {
    applyThreadTitleRefreshSetting({ mode: 'auto' })
    expect(threadTitleAutoRefreshEnabled()).toBe(true)
  })

  it('★ off → false（且必须是布尔 false，不是 undefined —— 轮次里直接当 if 条件用）', () => {
    applyThreadTitleRefreshSetting({ mode: 'off' })
    const value = threadTitleAutoRefreshEnabled()
    expect(value).toBe(false)
    expect(typeof value).toBe('boolean')
  })

  it('默认状态 → true', () => {
    expect(threadTitleAutoRefreshEnabled()).toBe(true)
  })
})

describe('schema 边界', () => {
  it('接受 off 与 auto', () => {
    expect(threadTitleRefreshSchema.safeParse({ mode: 'off' }).success).toBe(true)
    expect(threadTitleRefreshSchema.safeParse({ mode: 'auto' }).success).toBe(true)
  })

  it('拒绝 on / 大写 / 缺 mode / 空对象', () => {
    expect(threadTitleRefreshSchema.safeParse({ mode: 'on' }).success).toBe(false)
    expect(threadTitleRefreshSchema.safeParse({ mode: 'AUTO' }).success).toBe(false)
    expect(threadTitleRefreshSchema.safeParse({ mode: true }).success).toBe(false)
    expect(threadTitleRefreshSchema.safeParse({}).success).toBe(false)
  })
})
