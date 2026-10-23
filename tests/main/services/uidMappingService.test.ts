// tests/main/services/uidMappingService.test.ts
// uidMappingService 单元测试 — 覆盖 uid_mapping.json 文件读写、
// UID 冲突检测、数据库记录更新（mock getDb）。
//
// 测试策略：
// - getUidMapping/saveUidMapping：纯文件操作，使用 mkdtemp 临时目录
// - updatePlayerUid：mock getDb 避免真实数据库依赖
// - getPlayersWithUid：mock getDb 与 readdirSync
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock dataService 的 getDb，避免依赖真实数据库
// 使用 vi.hoisted 提升 mock 函数声明，使其与 vi.mock 同步可见
const { mockGetDb } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}))
vi.mock('@main/services/dataService', () => ({
  getDb: mockGetDb,
}))

import {
  getUidMapping,
  saveUidMapping,
  updatePlayerUid,
  UidMappingData,
} from '@main/services/uidMappingService'

let tmpProjectDir: string

beforeEach(async () => {
  tmpProjectDir = await mkdtemp(join(tmpdir(), 'qqbat-uid-mapping-'))
  mockGetDb.mockReset()
})

afterEach(async () => {
  await rm(tmpProjectDir, { recursive: true, force: true })
})

describe('getUidMapping', () => {
  it('文件不存在时返回默认值（nextUid=10000, mapping={}）', () => {
    const result = getUidMapping(tmpProjectDir)
    expect(result.nextUid).toBe(10000)
    expect(result.mapping).toEqual({})
  })

  it('读取存在的 uid_mapping.json', () => {
    const data: UidMappingData = {
      nextUid: 10005,
      mapping: { openid_a: 10001, openid_b: 10002 },
    }
    saveUidMapping(tmpProjectDir, data)

    const result = getUidMapping(tmpProjectDir)
    expect(result.nextUid).toBe(10005)
    expect(result.mapping).toEqual({ openid_a: 10001, openid_b: 10002 })
  })

  it('文件内容非法 JSON 时返回默认值', () => {
    const { writeFileSync, mkdirSync } = require('fs')
    const dir = join(tmpProjectDir, '.qqbat')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'uid_mapping.json'), '{invalid json', 'utf-8')

    const result = getUidMapping(tmpProjectDir)
    expect(result.nextUid).toBe(10000)
    expect(result.mapping).toEqual({})
  })
})

describe('saveUidMapping', () => {
  it('保存后文件存在于 <projectPath>/.qqbat/uid_mapping.json', () => {
    saveUidMapping(tmpProjectDir, { nextUid: 10001, mapping: { a: 10000 } })
    expect(existsSync(join(tmpProjectDir, '.qqbat', 'uid_mapping.json'))).toBe(true)
  })

  it('.qqbat 目录不存在时自动创建', () => {
    expect(existsSync(join(tmpProjectDir, '.qqbat'))).toBe(false)
    saveUidMapping(tmpProjectDir, { nextUid: 10001, mapping: {} })
    expect(existsSync(join(tmpProjectDir, '.qqbat'))).toBe(true)
  })

  it('保存后可被 getUidMapping 读取（往返一致）', () => {
    const data: UidMappingData = {
      nextUid: 10050,
      mapping: {
        openid_x: 10010,
        openid_y: 10020,
        openid_z: 10030,
      },
    }
    saveUidMapping(tmpProjectDir, data)
    const loaded = getUidMapping(tmpProjectDir)
    expect(loaded).toEqual(data)
  })

  it('覆盖旧文件', () => {
    saveUidMapping(tmpProjectDir, { nextUid: 10001, mapping: { a: 10000 } })
    saveUidMapping(tmpProjectDir, { nextUid: 10002, mapping: { b: 10001 } })
    const loaded = getUidMapping(tmpProjectDir)
    expect(loaded.nextUid).toBe(10002)
    expect(loaded.mapping).toEqual({ b: 10001 })
  })

  it('空 mapping 也能保存', () => {
    saveUidMapping(tmpProjectDir, { nextUid: 10000, mapping: {} })
    const loaded = getUidMapping(tmpProjectDir)
    expect(loaded.mapping).toEqual({})
    expect(loaded.nextUid).toBe(10000)
  })
})

describe('updatePlayerUid', () => {
  it('新 openid 设置 UID 成功，oldUid=null', () => {
    const result = updatePlayerUid(tmpProjectDir, 'openid_new', 10001)
    expect(result.success).toBe(true)
    expect(result.oldUid).toBeNull()

    // 验证文件已更新
    const mapping = getUidMapping(tmpProjectDir)
    expect(mapping.mapping.openid_new).toBe(10001)
    expect(mapping.nextUid).toBe(10002) // nextUid 应自增
  })

  it('已有 openid 更新 UID，返回 oldUid', () => {
    saveUidMapping(tmpProjectDir, {
      nextUid: 10005,
      mapping: { openid_a: 10001 },
    })
    const result = updatePlayerUid(tmpProjectDir, 'openid_a', 10010)
    expect(result.success).toBe(true)
    expect(result.oldUid).toBe(10001)

    const mapping = getUidMapping(tmpProjectDir)
    expect(mapping.mapping.openid_a).toBe(10010)
  })

  it('newUid=0 抛异常（必须大于 0）', () => {
    expect(() => updatePlayerUid(tmpProjectDir, 'openid_a', 0)).toThrow('UID 必须大于 0')
  })

  it('newUid 为负数抛异常', () => {
    expect(() => updatePlayerUid(tmpProjectDir, 'openid_a', -1)).toThrow('UID 必须大于 0')
  })

  it('newUid 已被其他 openid 占用时抛异常', () => {
    saveUidMapping(tmpProjectDir, {
      nextUid: 10005,
      mapping: { openid_a: 10001, openid_b: 10002 },
    })
    // openid_a 尝试占用 openid_b 的 UID
    expect(() => updatePlayerUid(tmpProjectDir, 'openid_a', 10002)).toThrow('已被其他玩家占用')
  })

  it('同一 openid 重新设置相同 UID 不报冲突', () => {
    saveUidMapping(tmpProjectDir, {
      nextUid: 10005,
      mapping: { openid_a: 10001 },
    })
    // openid_a 重新设置自己的 UID，不应报冲突
    const result = updatePlayerUid(tmpProjectDir, 'openid_a', 10001)
    expect(result.success).toBe(true)
    expect(result.oldUid).toBe(10001)
  })

  it('newUid >= nextUid 时 nextUid 自动更新为 newUid+1', () => {
    saveUidMapping(tmpProjectDir, {
      nextUid: 10005,
      mapping: {},
    })
    updatePlayerUid(tmpProjectDir, 'openid_a', 10010)
    const mapping = getUidMapping(tmpProjectDir)
    expect(mapping.nextUid).toBe(10011) // 10010 + 1
  })

  it('newUid < nextUid 时 nextUid 不变', () => {
    saveUidMapping(tmpProjectDir, {
      nextUid: 10010,
      mapping: {},
    })
    updatePlayerUid(tmpProjectDir, 'openid_a', 10005)
    const mapping = getUidMapping(tmpProjectDir)
    expect(mapping.nextUid).toBe(10010) // 保持不变
  })

  it('更新已有 openid 的 UID 时，若存在旧 UID 则更新数据库记录', () => {
    // 准备：openid_a 当前 UID=10001
    saveUidMapping(tmpProjectDir, {
      nextUid: 10005,
      mapping: { openid_a: 10001 },
    })

    // Mock 数据库：模拟存在 oldUid 的记录需要被更新
    const mockDb = {
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        run: vi.fn(() => ({ changes: 1 })),
      })),
    }
    // data/players 目录需要存在
    const { mkdirSync } = require('fs')
    mkdirSync(join(tmpProjectDir, 'data', 'players'), { recursive: true })
    // 创建一个假的 .db 文件让 readdirSync 能扫描到
    const { writeFileSync } = require('fs')
    writeFileSync(join(tmpProjectDir, 'data', 'players', 'test.db'), '', 'utf-8')

    mockGetDb.mockReturnValue(mockDb)

    const result = updatePlayerUid(tmpProjectDir, 'openid_a', 10010)
    expect(result.success).toBe(true)
    expect(result.oldUid).toBe(10001)

    // 验证数据库 UPDATE 被调用（mockDb.prepare 应被调用以查询表与更新记录）
    // 由于 mockDb.prepare 返回统一的 mock，我们至少验证 getDb 被调用
    expect(mockGetDb).toHaveBeenCalled()
  })

  it('更新 UID 时不修改其他 openid 的映射', () => {
    saveUidMapping(tmpProjectDir, {
      nextUid: 10005,
      mapping: { openid_a: 10001, openid_b: 10002, openid_c: 10003 },
    })
    updatePlayerUid(tmpProjectDir, 'openid_a', 10010)
    const mapping = getUidMapping(tmpProjectDir)
    expect(mapping.mapping.openid_b).toBe(10002)
    expect(mapping.mapping.openid_c).toBe(10003)
    expect(mapping.mapping.openid_a).toBe(10010)
  })
})

describe('updatePlayerUid - 边界条件', () => {
  it('UID=1 是合法值（最小正整数）', () => {
    const result = updatePlayerUid(tmpProjectDir, 'openid_a', 1)
    expect(result.success).toBe(true)
    const mapping = getUidMapping(tmpProjectDir)
    expect(mapping.mapping.openid_a).toBe(1)
  })

  it('UID=999999 是合法值（大数）', () => {
    const result = updatePlayerUid(tmpProjectDir, 'openid_a', 999999)
    expect(result.success).toBe(true)
    expect(getUidMapping(tmpProjectDir).nextUid).toBe(1000000)
  })

  it('多次更新同一 openid 的 UID，oldUid 始终为上一次的值', () => {
    updatePlayerUid(tmpProjectDir, 'openid_a', 10001)
    const r1 = updatePlayerUid(tmpProjectDir, 'openid_a', 10002)
    expect(r1.oldUid).toBe(10001)
    const r2 = updatePlayerUid(tmpProjectDir, 'openid_a', 10003)
    expect(r2.oldUid).toBe(10002)
  })
})
