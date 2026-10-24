// tests/main/services/stateStore.test.ts
// StateStore 单元测试 — 覆盖 bot_state 表 KV 操作与 session_vars 表会话变量操作。
//
// 测试策略：使用 mkdtemp 创建临时项目目录，通过 StateStore.resetInstanceForTesting()
// 在每个测试前重置单例，避免跨测试状态污染。
//
// 数据库走 src/main/services/infra/sqlite 的统一入口：原生 better-sqlite3 不可用时
// 会自动降级到 node:sqlite（ABI 无关），所以这里不该再因为 ABI 跳过 —— 跳过等于
// 把「状态库到底能不能用」这条最重要的路径从测试里摘掉。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { sqliteStatus } from '@main/services/infra/sqlite'
import { StateStore } from '@main/services/stateStore'

// 两个引擎都不可用（极少见）时跳过；否则一定跑
const describeOrSkip = sqliteStatus().ok ? describe : describe.skip

let tmpProjectDir: string
let store: InstanceType<typeof StateStore>

beforeEach(async () => {
  tmpProjectDir = await mkdtemp(join(tmpdir(), 'qqbat-state-store-'))
  StateStore.resetInstanceForTesting()
  store = StateStore.getInstance()
})

afterEach(async () => {
  store.close()
  StateStore.resetInstanceForTesting()
  await rm(tmpProjectDir, { recursive: true, force: true })
})

describeOrSkip('StateStore - bot_state 表', () => {
  describe('set + get', () => {
    it('set 字符串值后 get 返回相同值', () => {
      store.set('k1', 'hello', tmpProjectDir)
      expect(store.get<string>('k1', tmpProjectDir)).toBe('hello')
    })

    it('set 数字值后 get 返回相同数字', () => {
      store.set('count', 42, tmpProjectDir)
      expect(store.get<number>('count', tmpProjectDir)).toBe(42)
    })

    it('set 布尔值后 get 返回相同布尔', () => {
      store.set('flag', true, tmpProjectDir)
      expect(store.get<boolean>('flag', tmpProjectDir)).toBe(true)
    })

    it('set 对象后 get 返回深相等对象', () => {
      const obj = { name: 'alice', level: 5, items: ['sword', 'shield'] }
      store.set('player', obj, tmpProjectDir)
      expect(store.get<typeof obj>('player', tmpProjectDir)).toEqual(obj)
    })

    it('set 数组后 get 返回深相等数组', () => {
      const arr = [1, 2, 3, 'four', { five: 5 }]
      store.set('list', arr, tmpProjectDir)
      expect(store.get<typeof arr>('list', tmpProjectDir)).toEqual(arr)
    })

    it('set null 值后 get 返回 null', () => {
      store.set('nullable', null, tmpProjectDir)
      expect(store.get('nullable', tmpProjectDir)).toBeNull()
    })

    it('get 不存在的 key 返回 null', () => {
      expect(store.get('nonexistent', tmpProjectDir)).toBeNull()
    })

    it('set 同一 key 覆盖旧值', () => {
      store.set('k', 'v1', tmpProjectDir)
      store.set('k', 'v2', tmpProjectDir)
      expect(store.get<string>('k', tmpProjectDir)).toBe('v2')
    })

    it('set 嵌套对象保持结构完整', () => {
      const nested = { a: { b: { c: { d: 'deep' } } } }
      store.set('nested', nested, tmpProjectDir)
      expect(store.get<typeof nested>('nested', tmpProjectDir)).toEqual(nested)
    })
  })

  describe('delete', () => {
    it('删除已存在的 key 返回 true', () => {
      store.set('to-del', 'val', tmpProjectDir)
      expect(store.delete('to-del', tmpProjectDir)).toBe(true)
      expect(store.get('to-del', tmpProjectDir)).toBeNull()
    })

    it('删除不存在的 key 返回 false', () => {
      expect(store.delete('nonexistent', tmpProjectDir)).toBe(false)
    })

    it('删除后再 get 返回 null', () => {
      store.set('k', 'v', tmpProjectDir)
      store.delete('k', tmpProjectDir)
      expect(store.get('k', tmpProjectDir)).toBeNull()
    })

    it('删除后再 set 同一 key 正常工作', () => {
      store.set('k', 'v1', tmpProjectDir)
      store.delete('k', tmpProjectDir)
      store.set('k', 'v2', tmpProjectDir)
      expect(store.get<string>('k', tmpProjectDir)).toBe('v2')
    })
  })

  describe('listKeys', () => {
    it('无 prefix 返回所有 key（按字母序）', () => {
      store.set('alpha', '1', tmpProjectDir)
      store.set('beta', '2', tmpProjectDir)
      store.set('gamma', '3', tmpProjectDir)
      const keys = store.listKeys(undefined, tmpProjectDir)
      expect(keys).toEqual(['alpha', 'beta', 'gamma'])
    })

    it('有 prefix 仅返回匹配的 key', () => {
      store.set('user_1:name', 'a', tmpProjectDir)
      store.set('user_2:name', 'b', tmpProjectDir)
      store.set('group_1:name', 'c', tmpProjectDir)
      const keys = store.listKeys('user_', tmpProjectDir)
      expect(keys).toEqual(['user_1:name', 'user_2:name'])
    })

    it('无数据时返回空数组', () => {
      const keys = store.listKeys(undefined, tmpProjectDir)
      expect(keys).toEqual([])
    })

    it('prefix 不匹配任何 key 返回空数组', () => {
      store.set('alpha', '1', tmpProjectDir)
      const keys = store.listKeys('xyz_', tmpProjectDir)
      expect(keys).toEqual([])
    })

    it('不传 projectPath 返回空数组', () => {
      store.set('k', 'v', tmpProjectDir)
      expect(store.listKeys('k')).toEqual([])
    })
  })

  describe('getStateCount', () => {
    it('空数据库返回 0', () => {
      expect(store.getStateCount(tmpProjectDir)).toBe(0)
    })

    it('set N 次后 count=N', () => {
      store.set('k1', 'v1', tmpProjectDir)
      store.set('k2', 'v2', tmpProjectDir)
      store.set('k3', 'v3', tmpProjectDir)
      expect(store.getStateCount(tmpProjectDir)).toBe(3)
    })

    it('set 同一 key 多次 count 仅增 1', () => {
      store.set('k', 'v1', tmpProjectDir)
      store.set('k', 'v2', tmpProjectDir)
      store.set('k', 'v3', tmpProjectDir)
      expect(store.getStateCount(tmpProjectDir)).toBe(1)
    })

    it('delete 后 count 减少', () => {
      store.set('k1', 'v1', tmpProjectDir)
      store.set('k2', 'v2', tmpProjectDir)
      store.delete('k1', tmpProjectDir)
      expect(store.getStateCount(tmpProjectDir)).toBe(1)
    })
  })

  describe('getAllStateEntries', () => {
    it('返回所有条目（含 key/value/updatedAt）', () => {
      store.set('k1', 'v1', tmpProjectDir)
      store.set('k2', 42, tmpProjectDir)
      const entries = store.getAllStateEntries(tmpProjectDir)
      expect(entries.length).toBe(2)
      const e1 = entries.find((e: { key: string }) => e.key === 'k1')
      expect(e1).toBeDefined()
      expect(e1!.value).toBe('v1')
      expect(typeof e1!.updatedAt).toBe('number')
      const e2 = entries.find((e: { key: string }) => e.key === 'k2')
      expect(e2!.value).toBe(42)
    })

    it('按 key 字母序返回', () => {
      store.set('zeta', '1', tmpProjectDir)
      store.set('alpha', '2', tmpProjectDir)
      store.set('mid', '3', tmpProjectDir)
      const entries = store.getAllStateEntries(tmpProjectDir)
      expect(entries.map((e: { key: string }) => e.key)).toEqual(['alpha', 'mid', 'zeta'])
    })

    it('空数据库返回空数组', () => {
      expect(store.getAllStateEntries(tmpProjectDir)).toEqual([])
    })

    it('对象 value 保持深相等', () => {
      const obj = { a: 1, b: { c: 2 } }
      store.set('obj', obj, tmpProjectDir)
      const entries = store.getAllStateEntries(tmpProjectDir)
      expect(entries[0].value).toEqual(obj)
    })
  })
})

describeOrSkip('StateStore - session_vars 表', () => {
  describe('setSessionVar + getSessionVar', () => {
    it('set 字符串后 get 返回相同值', () => {
      store.setSessionVar('sess1', 'mode', 'battle', tmpProjectDir)
      expect(store.getSessionVar<string>('sess1', 'mode', tmpProjectDir)).toBe('battle')
    })

    it('set 数字后 get 返回相同数字', () => {
      store.setSessionVar('sess1', 'turn', 5, tmpProjectDir)
      expect(store.getSessionVar<number>('sess1', 'turn', tmpProjectDir)).toBe(5)
    })

    it('set 对象后 get 返回深相等对象', () => {
      const ctx = { monster: 'dragon', hp: 100 }
      store.setSessionVar('sess1', 'ctx', ctx, tmpProjectDir)
      expect(store.getSessionVar<typeof ctx>('sess1', 'ctx', tmpProjectDir)).toEqual(ctx)
    })

    it('get 不存在的 session/var 返回 null', () => {
      expect(store.getSessionVar('nonexistent', 'var', tmpProjectDir)).toBeNull()
    })

    it('同一 session 不同 var 互不干扰', () => {
      store.setSessionVar('sess1', 'v1', 'a', tmpProjectDir)
      store.setSessionVar('sess1', 'v2', 'b', tmpProjectDir)
      expect(store.getSessionVar<string>('sess1', 'v1', tmpProjectDir)).toBe('a')
      expect(store.getSessionVar<string>('sess1', 'v2', tmpProjectDir)).toBe('b')
    })

    it('不同 session 同名 var 互不干扰', () => {
      store.setSessionVar('sess1', 'mode', 'battle', tmpProjectDir)
      store.setSessionVar('sess2', 'mode', 'explore', tmpProjectDir)
      expect(store.getSessionVar<string>('sess1', 'mode', tmpProjectDir)).toBe('battle')
      expect(store.getSessionVar<string>('sess2', 'mode', tmpProjectDir)).toBe('explore')
    })

    it('set 同一 session/var 覆盖旧值', () => {
      store.setSessionVar('sess1', 'mode', 'v1', tmpProjectDir)
      store.setSessionVar('sess1', 'mode', 'v2', tmpProjectDir)
      expect(store.getSessionVar<string>('sess1', 'mode', tmpProjectDir)).toBe('v2')
    })
  })

  describe('clearSession', () => {
    it('清除指定 session 的所有变量', () => {
      store.setSessionVar('sess1', 'v1', 'a', tmpProjectDir)
      store.setSessionVar('sess1', 'v2', 'b', tmpProjectDir)
      store.setSessionVar('sess2', 'v1', 'c', tmpProjectDir)
      store.clearSession('sess1', tmpProjectDir)
      expect(store.getSessionVar('sess1', 'v1', tmpProjectDir)).toBeNull()
      expect(store.getSessionVar('sess1', 'v2', tmpProjectDir)).toBeNull()
      // sess2 不受影响
      expect(store.getSessionVar<string>('sess2', 'v1', tmpProjectDir)).toBe('c')
    })

    it('清除不存在的 session 不抛异常', () => {
      expect(() => store.clearSession('nonexistent', tmpProjectDir)).not.toThrow()
    })

    it('清除后可重新 set 变量', () => {
      store.setSessionVar('sess1', 'mode', 'v1', tmpProjectDir)
      store.clearSession('sess1', tmpProjectDir)
      store.setSessionVar('sess1', 'mode', 'v2', tmpProjectDir)
      expect(store.getSessionVar<string>('sess1', 'mode', tmpProjectDir)).toBe('v2')
    })
  })

  describe('getSessionCount', () => {
    it('空数据库返回 0', () => {
      expect(store.getSessionCount(tmpProjectDir)).toBe(0)
    })

    it('按 sessionId 去重计数', () => {
      store.setSessionVar('sess1', 'v1', 'a', tmpProjectDir)
      store.setSessionVar('sess1', 'v2', 'b', tmpProjectDir)
      store.setSessionVar('sess1', 'v3', 'c', tmpProjectDir)
      // sess1 有 3 个变量，但只算 1 个 session
      expect(store.getSessionCount(tmpProjectDir)).toBe(1)
    })

    it('多个 session 分别计数', () => {
      store.setSessionVar('sess1', 'v', 'a', tmpProjectDir)
      store.setSessionVar('sess2', 'v', 'b', tmpProjectDir)
      store.setSessionVar('sess3', 'v', 'c', tmpProjectDir)
      expect(store.getSessionCount(tmpProjectDir)).toBe(3)
    })

    it('clearSession 后 count 减少', () => {
      store.setSessionVar('sess1', 'v', 'a', tmpProjectDir)
      store.setSessionVar('sess2', 'v', 'b', tmpProjectDir)
      store.clearSession('sess1', tmpProjectDir)
      expect(store.getSessionCount(tmpProjectDir)).toBe(1)
    })
  })
})

describeOrSkip('StateStore - 单例与多项目隔离', () => {
  it('getInstance 返回同一实例', () => {
    const s1 = StateStore.getInstance()
    const s2 = StateStore.getInstance()
    expect(s1).toBe(s2)
  })

  it('resetInstanceForTesting 后获取新实例', () => {
    const s1 = StateStore.getInstance()
    StateStore.resetInstanceForTesting()
    const s2 = StateStore.getInstance()
    expect(s1).not.toBe(s2)
  })

  it('不同 projectPath 数据隔离', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'qqbat-state-other-'))
    try {
      store.set('k', 'project1-value', tmpProjectDir)
      store.set('k', 'project2-value', otherDir)
      expect(store.get<string>('k', tmpProjectDir)).toBe('project1-value')
      expect(store.get<string>('k', otherDir)).toBe('project2-value')
    } finally {
      // 必须先关闭 otherDir 的数据库连接，否则 Windows 不允许删除 .db 文件
      store.clearAll(otherDir)
      await rm(otherDir, { recursive: true, force: true })
    }
  })
})

describeOrSkip('StateStore - 数据库文件', () => {
  it('getDbSize 返回文件大小（>0 表示已创建）', () => {
    store.set('k', 'v', tmpProjectDir)
    const size = store.getDbSize(tmpProjectDir)
    expect(size).toBeGreaterThan(0)
  })

  it('getDbSize 不存在的项目返回 0', () => {
    const size = store.getDbSize(join(tmpdir(), 'nonexistent-project-xxx'))
    expect(size).toBe(0)
  })

  it('数据库文件位于 <projectPath>/.qqbat/state.db', () => {
    store.set('k', 'v', tmpProjectDir)
    const { existsSync } = require('fs')
    expect(existsSync(join(tmpProjectDir, '.qqbat', 'state.db'))).toBe(true)
  })
})
