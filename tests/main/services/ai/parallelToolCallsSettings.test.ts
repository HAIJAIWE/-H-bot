// tests/main/services/ai/parallelToolCallsSettings.test.ts
//
// 「并行工具调用数」设置的读写与生效语义（第 59 批，形状照 budgetSettings）。
//
// 三条最要紧的：
//   · 文件不存在 / 坏 JSON / 字段越界 → 一律回落默认（默认开着、10 个），不抛
//   · 关掉时 `effectiveMaxParallelToolCalls()` 必须返回 **1**，不是 undefined
//     （undefined 会让循环回落默认 10 —— 那是"界面关了、实际还在并行"的静默失败）
//   · 写盘是整份覆盖（原子写），读侧认新位置
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pathsState = vi.hoisted(() => ({ root: '' }))

vi.mock('@main/services/infra/paths', async () => {
  const { join: j } = await import('node:path')
  const { existsSync } = await import('node:fs')
  const current = () => j(pathsState.root, 'config', 'ai-parallel-tool-calls.json')
  return {
    USER_DATA_LAYOUT: { aiParallelToolCalls: ['config', 'ai-parallel-tool-calls.json'] },
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
  DEFAULT_PARALLEL_SETTING,
  MAX_PARALLEL_DEFAULT,
  MAX_PARALLEL_LIMIT,
  applyParallelToolCallsSetting,
  currentParallelToolCallsSetting,
  effectiveMaxParallelToolCalls,
  loadAndApplyParallelToolCalls,
  parallelToolCallsSchema,
  readParallelToolCallsSetting,
  writeParallelToolCallsSetting,
} from '@main/services/ai/parallelToolCallsSettings'

let root = ''

function settingFile(): string {
  return join(root, 'config', 'ai-parallel-tool-calls.json')
}

/** 每个用例开始都回到"默认已应用"的状态：模块级 active 是跨用例共享的 */
function resetActive(): void {
  applyParallelToolCallsSetting({ ...DEFAULT_PARALLEL_SETTING })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qqbat-parallel-'))
  pathsState.root = root
  mkdirSync(join(root, 'config'), { recursive: true })
  resetActive()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('读设置', () => {
  it('文件不存在 → 默认值（开着、10 个）', async () => {
    expect(await readParallelToolCallsSetting()).toEqual({ enabled: true, maxParallel: 10 })
  })

  it('默认值与 agent-core 的 MAX_PARALLEL_TOOL_CALLS_DEFAULT 一致（10）', () => {
    expect(MAX_PARALLEL_DEFAULT).toBe(10)
    expect(DEFAULT_PARALLEL_SETTING.maxParallel).toBe(MAX_PARALLEL_DEFAULT)
  })

  it('正常文件按盘上内容读回', async () => {
    writeFileSync(settingFile(), JSON.stringify({ enabled: false, maxParallel: 3 }), 'utf-8')
    expect(await readParallelToolCallsSetting()).toEqual({ enabled: false, maxParallel: 3 })
  })

  it('坏 JSON → 默认值，不抛', async () => {
    writeFileSync(settingFile(), '{ 这不是 json', 'utf-8')
    expect(await readParallelToolCallsSetting()).toEqual({ enabled: true, maxParallel: 10 })
  })

  it('字段越界（0 / 51 / 非整数）→ 默认值，不抛', async () => {
    writeFileSync(settingFile(), JSON.stringify({ enabled: true, maxParallel: 0 }), 'utf-8')
    expect(await readParallelToolCallsSetting()).toEqual(DEFAULT_PARALLEL_SETTING)

    writeFileSync(settingFile(), JSON.stringify({ enabled: true, maxParallel: 51 }), 'utf-8')
    expect(await readParallelToolCallsSetting()).toEqual(DEFAULT_PARALLEL_SETTING)

    writeFileSync(settingFile(), JSON.stringify({ enabled: true, maxParallel: 2.5 }), 'utf-8')
    expect(await readParallelToolCallsSetting()).toEqual(DEFAULT_PARALLEL_SETTING)
  })

  it('缺字段 → 默认值', async () => {
    writeFileSync(settingFile(), JSON.stringify({ enabled: true }), 'utf-8')
    expect(await readParallelToolCallsSetting()).toEqual(DEFAULT_PARALLEL_SETTING)
  })
})

describe('写设置', () => {
  it('写盘是整份 JSON（人能看懂、能手改）', async () => {
    await writeParallelToolCallsSetting({ enabled: false, maxParallel: 4 })
    const raw = readFileSync(settingFile(), 'utf-8')
    expect(JSON.parse(raw)).toEqual({ enabled: false, maxParallel: 4 })
    expect(raw).toContain('\n') // 有缩进，不是一行压扁
  })

  it('写完能读回来（往返一致）', async () => {
    await writeParallelToolCallsSetting({ enabled: true, maxParallel: 7 })
    expect(await readParallelToolCallsSetting()).toEqual({ enabled: true, maxParallel: 7 })
  })
})

describe('应用到运行时', () => {
  it('apply 之后 current 反映新值', () => {
    applyParallelToolCallsSetting({ enabled: false, maxParallel: 2 })
    expect(currentParallelToolCallsSetting()).toEqual({ enabled: false, maxParallel: 2 })
  })

  it('current 返回副本：外部改动不会污染运行时状态', () => {
    const snapshot = currentParallelToolCallsSetting()
    snapshot.maxParallel = 99
    expect(currentParallelToolCallsSetting().maxParallel).toBe(10)
  })

  it('loadAndApply 读盘并应用', async () => {
    writeFileSync(settingFile(), JSON.stringify({ enabled: true, maxParallel: 6 }), 'utf-8')
    const applied = await loadAndApplyParallelToolCalls()
    expect(applied.maxParallel).toBe(6)
    expect(effectiveMaxParallelToolCalls()).toBe(6)
  })

  it('loadAndApply 遇到坏文件不阻断启动（回落默认并应用）', async () => {
    writeFileSync(settingFile(), 'nope', 'utf-8')
    await loadAndApplyParallelToolCalls()
    expect(effectiveMaxParallelToolCalls()).toBe(MAX_PARALLEL_DEFAULT)
  })
})

describe('★ effectiveMaxParallelToolCalls：关掉必须是 1，不能是 undefined', () => {
  it('开启时 = maxParallel', () => {
    applyParallelToolCallsSetting({ enabled: true, maxParallel: 4 })
    expect(effectiveMaxParallelToolCalls()).toBe(4)
  })

  it('★ 关闭时 = 1（若返回 undefined，循环会回落默认 10 = 假装关了）', () => {
    applyParallelToolCallsSetting({ enabled: false, maxParallel: 8 })
    const value = effectiveMaxParallelToolCalls()
    expect(value).toBe(1)
    expect(value).not.toBeUndefined()
  })

  it('默认状态 = 10', () => {
    expect(effectiveMaxParallelToolCalls()).toBe(MAX_PARALLEL_DEFAULT)
  })
})

describe('schema 边界', () => {
  it('接受 1 与 50（两端都合法）', () => {
    expect(parallelToolCallsSchema.safeParse({ enabled: true, maxParallel: 1 }).success).toBe(true)
    expect(parallelToolCallsSchema.safeParse({ enabled: true, maxParallel: MAX_PARALLEL_LIMIT }).success).toBe(true)
  })

  it('拒绝 0 / 51 / 小数 / 缺 enabled', () => {
    expect(parallelToolCallsSchema.safeParse({ enabled: true, maxParallel: 0 }).success).toBe(false)
    expect(parallelToolCallsSchema.safeParse({ enabled: true, maxParallel: 51 }).success).toBe(false)
    expect(parallelToolCallsSchema.safeParse({ enabled: true, maxParallel: 1.5 }).success).toBe(false)
    expect(parallelToolCallsSchema.safeParse({ maxParallel: 3 }).success).toBe(false)
  })
})
