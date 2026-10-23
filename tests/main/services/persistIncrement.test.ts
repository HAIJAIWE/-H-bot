// tests/main/services/persistIncrement.test.ts
//
// `variable_persist(mode:'increment')` —— 修完四处缺陷后的回归。
//
// 原来的实现有四个问题挤在一个函数里，其中两个是**静默错**（用户看不出来）：
// ① 目录承诺"缺键时以 default 为初值"，实际 `defaultVal` 参数从没被读过 → `default: 100` 拿到 1
// ② 用临时连接硬编码 `scope='user'`、`qq=null` 落库 → scope=group/global 的数据被标成 user，
//    `query` 节点按 scope/qq 过滤时永远找不到它们
// ③ prepare 出来的语句没用过（死代码）+ 另开一个连接
// ④ 值不是数字时算出 NaN 并**存进去**
//
// 为什么用注入后端：本机 better-sqlite3 只有 electron ABI，Node 下加载不了，
// 靠 `setDbOpenerForTesting` 注入 `node:sqlite` 写的 shim 真跑 SQL。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeSqliteShim } from '../../helpers/sqliteShim'
import {
  incrValue,
  loadValue,
  makeKey,
  getDbSync,
  setDbOpenerForTesting,
  setPreviewDataDirOverride,
  closeDb,
} from '@main/services/builtinNodes/persistentStore'
import { variablePersist } from '@main/services/builtinNodes/builtinNodes'

const ShimDatabase = makeSqliteShim()
const event = { user_id: 10001, group_id: 20002 }
const groupEvent = { user_id: 10001, group_id: 30003 }

beforeAll(() => {
  setPreviewDataDirOverride(mkdtempSync(join(tmpdir(), 'qqbat-incr-')))
  setDbOpenerForTesting(
    ((filePath: string) => new ShimDatabase(filePath)) as unknown as Parameters<
      typeof setDbOpenerForTesting
    >[0],
  )
})

afterAll(() => {
  setDbOpenerForTesting(null)
  setPreviewDataDirOverride(null)
  closeDb()
})

/** 直接查原始行，用来验证 scope / qq 两列真的写对了 */
function rawRow(key: string, scope: 'user' | 'group' | 'global', ev: any) {
  return getDbSync()
    .prepare('SELECT key, value, scope, qq FROM _persistent WHERE key = ?')
    .get(makeKey(key, scope, ev))
}

describe('increment：default 生效（原来被完全忽略）', () => {
  it('缺键时以 default 为初值：default=100 + 1 → 101（修复前是 1）', () => {
    const r = incrValue('hp', 1, 'user', 100, event)
    expect(r.error).toBe('')
    expect(r.oldValue).toBe(100)
    expect(r.result).toBe(101)
    expect(loadValue('hp', 'user', event)).toBe(101)
  })

  it('default=0 时行为不变（老图的 /签到 就是这个用法）', () => {
    const r = incrValue('score', 1, 'user', 0, event)
    expect(r.result).toBe(1)
    expect(incrValue('score', 1, 'user', 0, event).result).toBe(2)
  })

  it('键已存在时 default 不参与（在旧值上继续加）', () => {
    incrValue('gold', 5, 'user', 0, event)
    const r = incrValue('gold', 3, 'user', 999, event)
    expect(r.oldValue).toBe(5)
    expect(r.result).toBe(8)
  })
})

describe('increment：scope / qq 真的写对了（原来写死 user/null）', () => {
  it('user scope：scope 列为 user，qq 列是触发者 QQ', () => {
    incrValue('coin', 1, 'user', 0, event)
    const row = rawRow('coin', 'user', event)
    expect(row.scope).toBe('user')
    expect(row.qq).toBe('10001')
  })

  it('group scope：scope 列是 group（原来会被写成 user）', () => {
    incrValue('pool', 1, 'group', 0, groupEvent)
    const row = rawRow('pool', 'group', groupEvent)
    expect(row.scope).toBe('group')
    expect(row.qq).toBe(null)
    // 键名带群号前缀，不同群互不干扰
    expect(row.key).toBe('group_30003:pool')
  })

  it('global scope：scope 列是 global，键名不带前缀', () => {
    incrValue('total', 1, 'global', 0, event)
    const row = rawRow('total', 'global', event)
    expect(row.scope).toBe('global')
    expect(row.key).toBe('total')
  })

  it('scope=global 的数据能被 query 的 scope 过滤找到（原来找不到）', () => {
    incrValue('season', 1, 'global', 0, event)
    const rows = getDbSync()
      .prepare('SELECT key FROM _persistent WHERE scope = ?')
      .all('global')
    expect(rows.map((r: any) => r.key)).toContain('season')
  })
})

describe('increment：不再静默产生 NaN', () => {
  it('当前值不是数字 → 明确报错，且不写入', () => {
    // 先塞一个非数字
    const db = getDbSync()
    db.prepare(
      'INSERT INTO _persistent (key, value, scope, qq, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    ).run(makeKey('nickname', 'user', event), JSON.stringify({ value: '很多', expire_at: null }), 'user', '10001')

    const r = incrValue('nickname', 1, 'user', 0, event)
    expect(r.error).toContain('不是数字')
    expect(r.result).toBe(0)
    // 原值没被 NaN 覆盖
    expect(loadValue('nickname', 'user', event)).toBe('很多')
  })
})

// 节点层的前置校验（`variablePersist` 里那次 `makeKey` 调用）。
//
// 为什么单独锁住它：下游的 `loadValue` / `saveValue` 内部各自 catch 掉异常并返回 null/false，
// 所以少了这次前置校验，「非法 scope」不会报错，而是变成**"保存成功但什么都没写"** ——
// 典型的静默失败（用户在界面上看到 success，数据其实没进库）。
describe('variable_persist：非法 scope / 缺身份必须报错，不能静默成功', () => {
  it('非法 scope → 错误端口有值、success=false', async () => {
    const r = await variablePersist({} as never, event as never, 'save', 'hp', 1, 'bogus' as never)
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法 scope')
  })

  it('user scope 但事件里没有 user_id → 报错（而不是"保存成功但没写进去"）', async () => {
    const r = await variablePersist({} as never, {} as never, 'save', 'hp', 1, 'user')
    expect(r.success).toBe(false)
    expect(r.error).toContain('user_id')
  })
})
