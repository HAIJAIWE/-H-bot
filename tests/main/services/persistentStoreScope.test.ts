// tests/main/services/persistentStoreScope.test.ts
//
// 玩家存档库「项目化」后的回归（对齐 10/18 客户端语义）：
//
// 原来的实现是全机器一份 `%APPDATA%/qqbot/data/players/persistent.db`，两个机器人项目共用，
// 同一个 QQ 号在不同项目里会互相覆盖存档。改完之后：
//   · 库跟着项目走：`{项目}/data/players/persistent.db`；
//   · 同时跑两个项目 = 两条独立连接（LRU 复用），关项目只关它自己那条；
//   · 老用户的全局库在首次打开老项目时**一次性复制**过来，旧库不删；
//   · 读/删另有 safe 版本，把异常降级成 `failed: true`，不把异常抛进流程链。
//
// better-sqlite3 在本机只有 Electron ABI，纯 Node 下 require 会失败，
// 所以用 `setDbOpenerForTesting` 注入 `node:sqlite` 写的 shim（见 tests/helpers/sqliteShim.ts）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { makeSqliteShim } from '../../helpers/sqliteShim'
import {
  closeDb,
  closeDbUnder,
  deleteValueSafe,
  getDbPath,
  getDbSync,
  legacyGlobalDbPaths,
  loadValueSafe,
  saveValue,
  setDbOpenerForTesting,
  setPreviewDataDirOverride,
} from '@main/services/builtinNodes/persistentStore'
import { currentProjectRoot, runWithProjectRoot } from '@main/services/builtinNodes/storeContext'

const ShimDatabase = makeSqliteShim()
const openShim = ((filePath: string) => new ShimDatabase(filePath)) as unknown as Parameters<
  typeof setDbOpenerForTesting
>[0]

let sandbox: string
const savedEnv: Record<string, string | undefined> = {}

/** 造一个「已经有很多玩家存档」的旧库：真实 SQLite 文件，迁移时才能走 backup/复制分支 */
function seedDatabase(filePath: string, rows: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new ShimDatabase(filePath)
  db.exec(
    'CREATE TABLE IF NOT EXISTS _persistent (key TEXT PRIMARY KEY, value TEXT NOT NULL, ' +
      "scope TEXT NOT NULL DEFAULT 'user', qq TEXT, updated_at TEXT)",
  )
  const stmt = db.prepare('INSERT OR REPLACE INTO _persistent (key, value, scope, qq) VALUES (?, ?, ?, ?)')
  for (const [key, value] of Object.entries(rows)) {
    stmt.run(key, JSON.stringify({ value, expire_at: null }), 'user', 'u1')
  }
  db.close()
}

function readKeys(filePath: string): string[] {
  const db = new ShimDatabase(filePath)
  const rows = db.prepare('SELECT key FROM _persistent ORDER BY key').all() as { key: string }[]
  db.close()
  return rows.map((r) => r.key)
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'qqbat-persist-'))
  for (const name of ['QQBOT_PROJECT_ROOT', 'QQBAT_USER_DATA_DIR', 'APPDATA']) {
    savedEnv[name] = process.env[name]
  }
  delete process.env.QQBOT_PROJECT_ROOT
  delete process.env.QQBAT_USER_DATA_DIR
  // 旧库探测会读 %APPDATA%，隔离到沙箱里，避免命中这台机器上的真实旧库
  process.env.APPDATA = join(sandbox, 'appdata')
  setPreviewDataDirOverride(null)
  setDbOpenerForTesting(openShim)
})

afterEach(() => {
  closeDb()
  setDbOpenerForTesting(null)
  setPreviewDataDirOverride(null)
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(sandbox, { recursive: true, force: true })
})

describe('库路径：预览覆盖优先，否则跟着项目走', () => {
  it('预览覆盖目录里只有一份 persistent.db（克隆副本隔离）', () => {
    const previewDir = join(sandbox, 'preview')
    setPreviewDataDirOverride(previewDir)
    expect(getDbPath()).toBe(join(previewDir, 'persistent.db'))
    expect(existsSync(previewDir)).toBe(true)
  })

  it('没有预览覆盖时落在 {项目}/data/players/persistent.db', () => {
    const project = join(sandbox, 'proj-a')
    process.env.QQBOT_PROJECT_ROOT = project
    expect(getDbPath()).toBe(join(project, 'data', 'players', 'persistent.db'))
  })
})

describe('项目上下文：异步链各看各的项目根', () => {
  it('runWithProjectRoot 里 currentProjectRoot 就是那条链的项目', () => {
    const a = join(sandbox, 'chain-a')
    const b = join(sandbox, 'chain-b')
    process.env.QQBOT_PROJECT_ROOT = join(sandbox, 'fallback')

    expect(runWithProjectRoot(a, () => currentProjectRoot())).toBe(a)
    // 嵌套时内层覆盖外层，出来之后外层恢复 —— 同时跑两个 bot 的基础
    expect(
      runWithProjectRoot(a, () => {
        const inner = runWithProjectRoot(b, () => currentProjectRoot())
        return { inner, outer: currentProjectRoot() }
      }),
    ).toEqual({ inner: b, outer: a })
  })
})

describe('连接池：每个项目一条，关项目只关它自己', () => {
  it('两个项目拿到不同连接；closeDbUnder 之后另一个仍可用', () => {
    const a = join(sandbox, 'bot-a')
    const b = join(sandbox, 'bot-b')
    const dbA = runWithProjectRoot(a, () => getDbSync())
    const dbB = runWithProjectRoot(b, () => getDbSync())
    expect(dbA).not.toBe(dbB)

    // 缓存复用：同一个项目再取还是那条连接
    expect(runWithProjectRoot(a, () => getDbSync())).toBe(dbA)

    expect(closeDbUnder(a)).toBe(1)
    expect(() => dbA.prepare('SELECT 1').get()).toThrow()
    expect(() => dbB.prepare('SELECT 1').get()).not.toThrow()

    // 关掉之后再用 a 会重新打开（不是继续吐已关闭的连接）
    const reopened = runWithProjectRoot(a, () => getDbSync())
    expect(reopened).not.toBe(dbA)
    expect(() => reopened.prepare('SELECT 1').get()).not.toThrow()
  })
})

describe('safe 读写：异常只降级成 failed，不抛给流程', () => {
  it('loadValueSafe / deleteValueSafe 正常路径返回真实结果', () => {
    const project = join(sandbox, 'proj-safe')
    runWithProjectRoot(project, () => {
      expect(saveValue('hp', 42, 'user', { user_id: 'u1' })).toBe(true)
      expect(loadValueSafe('hp', 'user', { user_id: 'u1' })).toEqual({ value: 42, failed: false })
      expect(loadValueSafe('nope', 'user', { user_id: 'u1' })).toEqual({ value: null, failed: false })
      expect(deleteValueSafe('hp', 'user', { user_id: 'u1' })).toEqual({
        deleted: true,
        failed: false,
      })
      expect(deleteValueSafe('hp', 'user', { user_id: 'u1' })).toEqual({
        deleted: false,
        failed: false,
      })
    })
  })

  it('打不开库时返回 failed: true，而不是把异常甩进节点链', () => {
    const project = join(sandbox, 'proj-broken')
    setDbOpenerForTesting((() => {
      throw new Error('boom')
    }) as unknown as Parameters<typeof setDbOpenerForTesting>[0])

    runWithProjectRoot(project, () => {
      expect(loadValueSafe('hp', 'user', { user_id: 'u1' })).toEqual({ value: null, failed: true })
      expect(deleteValueSafe('hp', 'user', { user_id: 'u1' })).toEqual({
        deleted: false,
        failed: true,
      })
    })
  })
})

describe('旧全局库迁移：只复制、不删旧库、不覆盖已有项目库', () => {
  it('首次打开项目时把旧库数据带过来，旧库仍在原地', () => {
    const legacy = legacyGlobalDbPaths()[0]
    seedDatabase(legacy, { legacy_hp: 99 })

    const project = join(sandbox, 'proj-migrate')
    const target = join(project, 'data', 'players', 'persistent.db')
    expect(existsSync(target)).toBe(false)

    const dbPath = runWithProjectRoot(project, () => getDbPath())
    expect(dbPath).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(readKeys(target)).toContain('legacy_hp')
    expect(existsSync(legacy)).toBe(true)
  })

  it('项目库已存在时绝不覆盖（迁移是幂等的）', () => {
    const legacy = legacyGlobalDbPaths()[0]
    seedDatabase(legacy, { legacy_hp: 99 })

    const project = join(sandbox, 'proj-existing')
    const target = join(project, 'data', 'players', 'persistent.db')
    seedDatabase(target, { own_hp: 7 })

    runWithProjectRoot(project, () => getDbPath())
    const keys = readKeys(target)
    expect(keys).toContain('own_hp')
    expect(keys).not.toContain('legacy_hp')
  })
})

describe('旧库探测位置', () => {
  it('第一个候选是 %APPDATA%/qqbot/data/players/persistent.db', () => {
    const appData = process.env.APPDATA as string
    const paths = legacyGlobalDbPaths()
    expect(paths[0]).toBe(join(appData, 'qqbot', 'data', 'players', 'persistent.db'))
    // 第二个候选（userDataRoot/qqbot/...）只在 Electron 下存在，这里只要求不重复
    expect(new Set(paths).size).toBe(paths.length)
  })
})
