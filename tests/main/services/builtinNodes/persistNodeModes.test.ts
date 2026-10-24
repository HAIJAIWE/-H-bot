// tests/main/services/builtinNodes/persistNodeModes.test.ts
//
// `variable_persist` 节点的**全部模式**（运行时用的那一份实现）。
//
// ## 为什么不是已有测试就够了
//
// 现有 `tests/main/services/persistIncrement.test.ts` 测的是 increment 的四个缺陷，但它
// import 的是 `services/builtinNodes/builtinNodes.ts` —— 那是同一个实现的**旧单文件副本**
// （codegen 的节点注册表仍在引用它）。**运行时真正执行的是 dataNodes.variablePersist**
// （经 handlerRegistry → dataNodes）。两份实现一旦漂移，increment 的回归测试仍然全绿，
// 而线上的 increment 已经错了。
//
// 这个文件直接测运行时那份，并把除 increment 之外的 11 个模式也覆盖上：
// save / load / delete / exists / load_or_default / load_or_default / batch_* /
// list_append / compare_update。迁移前这些模式由 pytest 的 test_persistent_store.py 覆盖。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeSqliteShim } from '../../../helpers/sqliteShim'
import { variablePersist } from '@main/services/builtinNodes/dataNodes'
import {
  closeDb,
  getDbSync,
  makeKey,
  setDbOpenerForTesting,
  setPreviewDataDirOverride,
} from '@main/services/builtinNodes/persistentStore'

const ShimDatabase = makeSqliteShim()
const user = { user_id: 10001, group_id: 20002 }
const group = { user_id: 10001, group_id: 30003 }

let dataDir: string
let infoSpy: ReturnType<typeof vi.spyOn>

/** 运行时就是这么调的：bot / event 在前，其余全是 kwargs 位置参数 */
const persist = (mode: string, key: string, extra: Record<string, unknown> = {}, event: any = user) =>
  (variablePersist as any)(
    null,
    event,
    mode,
    key,
    extra.value ?? null,
    extra.scope ?? 'user',
    extra.ttl ?? 0,
    extra.defaultValue ?? null,
    extra.amount ?? 1,
    extra.autoSave ?? true,
    extra.maxLength ?? 0,
    extra.data ?? '',
    extra.compareOp ?? '>=',
    extra.threshold ?? 1,
    extra.delta ?? -1,
    extra.keys ?? '[]',
    extra.item ?? null,
  )

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'qqbat-persistmodes-'))
  setPreviewDataDirOverride(dataDir)
  setDbOpenerForTesting((filePath: string) => new ShimDatabase(filePath) as never)
  // 实现每次调用都 console.info 一行（生产诊断用），测试里静音，避免淹没失败信息
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterAll(() => {
  infoSpy.mockRestore()
  setDbOpenerForTesting(null)
  setPreviewDataDirOverride(null)
  closeDb()
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
})

describe('save / load：值形态要能原样回来', () => {
  it('数字 / 字符串 / 对象 / 数组 都原样读回（不是 "\"[object Object]\""）', async () => {
    await persist('save', 'n', { value: 42 })
    expect((await persist('load', 'n')).result).toBe(42)
    await persist('save', 's', { value: '你好' })
    expect((await persist('load', 's')).result).toBe('你好')
    await persist('save', 'o', { value: { hp: 7, bag: ['剑'] } })
    expect((await persist('load', 'o')).result).toEqual({ hp: 7, bag: ['剑'] })
    await persist('save', 'a', { value: [1, 2] })
    expect((await persist('load', 'a')).result).toEqual([1, 2])
  })

  it('save 回报 success / saved / count，供下游判断是否真的写进去了', async () => {
    const r = await persist('save', 'flag', { value: true })
    expect(r.success).toBe(true)
    expect(r.saved).toBe(1)
    expect(r.count).toBe(1)
    expect(r.error).toBe('')
  })

  it('load 已有键：exists=true、is_default=false', async () => {
    await persist('save', 'hp', { value: 3 })
    const r = await persist('load', 'hp')
    expect(r.result).toBe(3)
    expect(r.exists).toBe(true)
    expect(r.is_default).toBe(false)
  })

  it('load 缺键：给 default 且标记 is_default=true（下游靠它区分"新玩家"）', async () => {
    const r = await persist('load', 'never_saved', { defaultValue: 100 })
    expect(r.result).toBe(100)
    expect(r.exists).toBe(false)
    expect(r.is_default).toBe(true)
    expect(r.success).toBe(true)
  })

  it('load_or_default 与 load 同语义（历史两个模式并存）', async () => {
    const r = await persist('load_or_default', 'never_saved2', { defaultValue: 'x' })
    expect(r.result).toBe('x')
    expect(r.is_default).toBe(true)
  })
})

describe('exists / delete', () => {
  it('exists 只看有没有，不改数据', async () => {
    expect((await persist('exists', 'ex')).exists).toBe(false)
    await persist('save', 'ex', { value: 1 })
    expect((await persist('exists', 'ex')).exists).toBe(true)
  })

  it('delete 之后 exists=false、再 load 回到 default', async () => {
    await persist('save', 'tmp', { value: 9 })
    const del = await persist('delete', 'tmp')
    expect(del.success).toBe(true)
    expect((await persist('exists', 'tmp')).exists).toBe(false)
    expect((await persist('load', 'tmp', { defaultValue: 0 })).result).toBe(0)
  })

  it('delete 不存在的键：success=false 但不报错（幂等）', async () => {
    const r = await persist('delete', 'nothing_here')
    expect(r.success).toBe(false)
    expect(r.error).toBe('')
  })
})

describe('increment（运行时那份实现，不是旧副本）', () => {
  it('缺键时以 default 为初值：default=100 + 1 → 101', async () => {
    const r = await persist('increment', 'incr_default', { defaultValue: 100, amount: 1 })
    expect(r.result).toBe(101)
    expect(r.old_value).toBe(100)
    expect((await persist('load', 'incr_default')).result).toBe(101)
  })

  it('连续自增累加；负数 amount 等于扣减', async () => {
    await persist('increment', 'incr_seq', { defaultValue: 0, amount: 2 })
    expect((await persist('increment', 'incr_seq', { defaultValue: 0, amount: 2 })).result).toBe(4)
    expect((await persist('increment', 'incr_seq', { defaultValue: 0, amount: -5 })).result).toBe(-1)
  })
})

describe('scope 隔离（user / group / global 各存各的）', () => {
  it('同名键在不同 scope 互不影响', async () => {
    await persist('save', 'scoped', { value: 'user值', scope: 'user' })
    await persist('save', 'scoped', { value: 'group值', scope: 'group' }, group)
    await persist('save', 'scoped', { value: 'global值', scope: 'global' })
    expect((await persist('load', 'scoped', { scope: 'user' })).result).toBe('user值')
    expect((await persist('load', 'scoped', { scope: 'group' }, group)).result).toBe('group值')
    expect((await persist('load', 'scoped', { scope: 'global' })).result).toBe('global值')
  })

  it('群作用域的键只在同一个群可见（别的群读不到）', async () => {
    await persist('save', 'group_only', { value: 1, scope: 'group' }, group)
    expect((await persist('load', 'group_only', { scope: 'group' }, group)).result).toBe(1)
    expect((await persist('load', 'group_only', { scope: 'group' }, user)).exists).toBe(false)
  })

  it('落库的 scope 列真的是声明的那一个（不是硬编码 user）', async () => {
    await persist('save', 'scope_col', { value: 5, scope: 'group' }, group)
    await persist('save', 'scope_col', { value: 6, scope: 'user' })
    const groupKey = makeKey('scope_col', 'group', group)
    const userKey = makeKey('scope_col', 'user', user)
    const groupRow = getDbSync().prepare('SELECT scope, qq FROM _persistent WHERE key = ?').get(groupKey)
    const userRow = getDbSync().prepare('SELECT scope, qq FROM _persistent WHERE key = ?').get(userKey)
    // 两列由完整 key 派生（persistentKey.ts 的 columnsForKey），不是各自独立算的
    expect(groupRow.scope).toBe('group')
    expect(groupRow.qq).toBeNull() // group 行的 qq 保持 null（既有表语义）
    expect(userRow.scope).toBe('user')
    expect(String(userRow.qq)).toBe('10001')
    // key 本身带身份前缀，这正是 query 节点按前缀筛的依据
    expect(groupKey.startsWith('group_30003:')).toBe(true)
    expect(userKey.startsWith('user_10001:')).toBe(true)
  })
})

describe('批量：batch_save / batch_load / batch_update', () => {
  it('batch_save 写多键，batch_load 读回同一份', async () => {
    const saved = await persist('batch_save', '', { data: JSON.stringify({ gold: 10, gem: 2 }) })
    expect(saved.success).toBe(true)
    expect(saved.saved).toBe(2)
    const loaded = await persist('batch_load', '', { keys: '["gold","gem"]', defaultValue: 0 })
    expect(loaded.values).toEqual({ gold: 10, gem: 2 })
    expect(loaded.count).toBe(2)
  })

  it('batch_save 收到非 JSON / 空对象 → 明确报错，不写半个库', async () => {
    expect((await persist('batch_save', '', { data: 'not json' })).error).toContain('不是合法 JSON')
    expect((await persist('batch_save', '', { data: '{}' })).error).toContain('空对象')
    expect((await persist('batch_save', '', { data: '' })).error).toContain('为空')
    expect((await persist('batch_save', '', { data: '[1,2]' })).error).toContain('必须是 JSON 对象')
  })

  it('batch_update 一次事务里 inc/dec 多键', async () => {
    const r = await persist('batch_update', '', {
      data: JSON.stringify([
        { key: 'gold', op: 'dec', value: 3 },
        { key: 'gem', op: 'inc', value: 1 },
      ]),
    })
    expect(r.ok).toBe(true)
    expect(r.__control_port__).toBe('out')
    expect(r.values).toEqual({ gold: 7, gem: 3 })
    expect(r.keys_list.sort()).toEqual(['gem', 'gold'])
    expect((await persist('batch_load', '', { keys: '["gold","gem"]' })).values).toEqual({ gold: 7, gem: 3 })
  })

  it('batch_update 条件不过 → 整批不写，values 回报的是当前值而不是半成品', async () => {
    const r = await persist('batch_update', '', {
      data: JSON.stringify([
        { key: 'gold', op: 'dec', value: 1 },
        { key: 'gem', op: 'dec', value: 100, expectOp: '>=', expect: 999 },
      ]),
    })
    expect(r.ok).toBe(false)
    expect(r.__control_port__).toBe('failed')
    expect(r.failed_key).toBe('gem')
    expect(r.reason).toContain('不满足')
    expect(r.values.gold).toBe(7)
    expect((await persist('batch_load', '', { keys: '["gold"]' })).values.gold).toBe(7)
  })

  it('batch_update 数据形状错 → 各自明确报错', async () => {
    expect((await persist('batch_update', '', { data: '' })).error).toContain('为空')
    expect((await persist('batch_update', '', { data: '{"key":"a"}' })).error).toContain('必须是 JSON 数组')
    expect((await persist('batch_update', '', { data: '[{"op":"inc"}]' })).error).toContain('缺少 key')
    expect((await persist('batch_update', '', { data: '[{"key":"a","op":"mul"}]' })).error).toContain('op 非法')
  })
})

describe('list_append（背包 / 名单）', () => {
  it('第一次追加起手一个列表，第二次追加在原来的后面（历史实现只返回单元素）', async () => {
    const a = await persist('list_append', 'bag', { item: '木剑' })
    expect(a.result).toEqual(['木剑'])
    const b = await persist('list_append', 'bag', { item: '铁剑' })
    expect(b.result).toEqual(['木剑', '铁剑'])
    expect(b.length).toBe(2)
    expect((await persist('load', 'bag')).result).toEqual(['木剑', '铁剑'])
  })

  it('maxLength 生效：超出只留最后 N 条（聊天记录类用法）', async () => {
    await persist('save', 'recent', { value: ['a'] })
    await persist('list_append', 'recent', { item: 'b', maxLength: 2 })
    const r = await persist('list_append', 'recent', { item: 'c', maxLength: 2 })
    expect(r.result).toEqual(['b', 'c'])
  })

  it('autoSave=false：只算不写（下游要自己决定什么时候落盘）', async () => {
    await persist('save', 'nosave', { value: ['x'] })
    const r = await persist('list_append', 'nosave', { item: 'y', autoSave: false })
    expect(r.result).toEqual(['x', 'y'])
    expect((await persist('load', 'nosave')).result).toEqual(['x'])
  })

  it('旧值是 JSON 字符串数组时也能接着追加（历史数据兼容）', async () => {
    await persist('save', 'json_arr', { value: '["a"]' })
    expect((await persist('list_append', 'json_arr', { item: 'b' })).result).toEqual(['a', 'b'])
  })
})

describe('compare_update：条件满足才改（并发安全的单键扣减）', () => {
  it('满足条件 → ok，返回新值，控制端口走 out', async () => {
    await persist('save', 'money', { value: 50 })
    const r = await persist('compare_update', 'money', { compareOp: '>=', threshold: 50, delta: -50 })
    expect(r.ok).toBe(true)
    expect(r.__control_port__).toBe('out')
    expect(r.result).toBe(0)
    expect(r.old_value).toBe(50)
    expect((await persist('load', 'money')).result).toBe(0)
  })

  it('不满足条件 → ok=false、值不变、控制端口走 failed（这就是"买不起"分支）', async () => {
    const r = await persist('compare_update', 'money', { compareOp: '>=', threshold: 10, delta: -10 })
    expect(r.ok).toBe(false)
    expect(r.__control_port__).toBe('failed')
    expect(r.reason).toContain('不满足')
    expect((await persist('load', 'money')).result).toBe(0)
  })

  it('缺键时用 default 作为当前值参与判断', async () => {
    const ok = await persist('compare_update', 'fresh_key', {
      compareOp: '>=',
      threshold: 5,
      delta: -1,
      defaultValue: 10,
    })
    expect(ok.ok).toBe(true)
    expect(ok.result).toBe(9)
  })
})

describe('参数校验：错在配置上就要立刻说清', () => {
  it('非法变量名 / 保留前缀', async () => {
    expect((await persist('load', '1hp')).error).toContain('非法变量名')
    expect((await persist('load', '')).error).toContain('非法变量名')
    expect((await persist('load', '__sys_gold')).error).toContain('保留前缀')
  })

  it('ttl 只接受 0..86400', async () => {
    expect((await persist('save', 'ttl1', { value: 1, ttl: -1 })).error).toContain('非法 ttl')
    expect((await persist('save', 'ttl2', { value: 1, ttl: 86_401 })).error).toContain('超出上限')
    expect((await persist('save', 'ttl3', { value: 1, ttl: 60 })).success).toBe(true)
  })

  it('未知模式 → 报错（不静默成功）', async () => {
    expect((await persist('whatever', 'k')).error).toContain('未知模式')
  })

  it('batch 模式不需要 key（它们按 data/keys 干活）', async () => {
    expect((await persist('batch_load', '', { keys: '["nope"]', defaultValue: 7 })).values).toEqual({ nope: 7 })
  })
})