// tests/main/services/backupService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createBackup,
  listBackups,
  restoreBackup,
  createSnapshot
} from '@main/services/backupService'
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  readdir,
  access
} from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import path from 'path'

let tmpDir: string
let dbPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qqbat-backup-'))
  const dbDir = join(tmpDir, 'db')
  await mkdir(dbDir, { recursive: true })
  dbPath = join(dbDir, 'test.db')
  await writeFile(dbPath, 'fake-db-content')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('backupService', () => {
  describe('createBackup', () => {
    it('正常备份返回路径', async () => {
      const result = await createBackup(tmpDir, dbPath, 'test backup')
      expect(result).not.toBeNull()
      expect(result!).toContain('test.db')
      expect(result!).toMatch(/\.bak$/)
    })

    it('dbPath 不存在返回 null', async () => {
      const result = await createBackup(tmpDir, join(tmpDir, 'nonexistent.db'), 'no db')
      expect(result).toBeNull()
    })

    it('备份文件和 meta 文件都生成', async () => {
      const backupPath = await createBackup(tmpDir, dbPath, 'desc')
      expect(backupPath).not.toBeNull()
      await expect(access(backupPath!)).resolves.toBeUndefined()
      await expect(access(backupPath! + '.meta.json')).resolves.toBeUndefined()
    })

    it('备份描述正确写入 meta', async () => {
      const backupPath = await createBackup(tmpDir, dbPath, 'my-description')
      const meta = JSON.parse(await readFile(backupPath! + '.meta.json', 'utf-8'))
      expect(meta.description).toBe('my-description')
      expect(meta.original).toBe(dbPath)
      expect(meta.size).toBe('fake-db-content'.length)
    })
  })

  describe('listBackups', () => {
    it('空目录返回空数组', async () => {
      const result = await listBackups(tmpDir)
      expect(result).toEqual([])
    })

    it('多个备份按时间倒序', async () => {
      const r1 = await createBackup(tmpDir, dbPath, 'first')
      await new Promise((r) => setTimeout(r, 50))
      const r2 = await createBackup(tmpDir, dbPath, 'second')
      await new Promise((r) => setTimeout(r, 50))
      const r3 = await createBackup(tmpDir, dbPath, 'third')
      const list = await listBackups(tmpDir)
      expect(list).toHaveLength(3)
      expect(list[0].name).toBe(path.basename(r3!))
      expect(list[2].name).toBe(path.basename(r1!))
    })

    it('损坏的 meta 文件被跳过不崩溃', async () => {
      await createBackup(tmpDir, dbPath, 'good')
      const backupDir = join(tmpDir, 'data', 'backups')
      await writeFile(join(backupDir, 'corrupted.bak.meta.json'), 'not-json{')
      const list = await listBackups(tmpDir)
      expect(list).toHaveLength(1)
      expect(list[0].description).toBe('good')
    })
  })

  describe('restoreBackup', () => {
    it('正常恢复', async () => {
      const backupPath = await createBackup(tmpDir, dbPath, 'to restore')
      const backupName = path.basename(backupPath!)
      await writeFile(dbPath, 'modified-content')
      const ok = await restoreBackup(tmpDir, backupName)
      expect(ok).toBe(true)
      expect(await readFile(dbPath, 'utf-8')).toBe('fake-db-content')
    })

    it('备份文件不存在返回 false', async () => {
      const ok = await restoreBackup(tmpDir, 'not-exist.bak')
      expect(ok).toBe(false)
    })

    it('meta 文件不存在返回 false', async () => {
      const backupPath = await createBackup(tmpDir, dbPath, 'no meta')
      const backupName = path.basename(backupPath!)
      await rm(backupPath! + '.meta.json')
      const ok = await restoreBackup(tmpDir, backupName)
      expect(ok).toBe(false)
    })
  })

  describe('createSnapshot', () => {
    it('正常创建快照', async () => {
      // Bug 3 修复后 createSnapshot 创建独立子目录而非单文件，返回目录路径
      const result = await createSnapshot(tmpDir, 'mysnap')
      expect(result).toContain('mysnap')
      // 返回的是 snapshot 子目录路径，应包含 backups 目录
      expect(result).toContain(path.join('data', 'backups'))
      // 子目录下应有 snapshot.meta.json 标识文件
      await expect(access(join(result, 'snapshot.meta.json'))).resolves.toBeUndefined()
    })

    it('快照标识文件内容正确', async () => {
      const snapshotDir = await createSnapshot(tmpDir, 'snap')
      const metaPath = join(snapshotDir, 'snapshot.meta.json')
      const content = JSON.parse(await readFile(metaPath, 'utf-8'))
      expect(content.projectPath).toBe(tmpDir)
      expect(content.time).toBeTruthy()
      // files 数组记录复制的数据库文件（相对路径）
      expect(Array.isArray(content.files)).toBe(true)
      await expect(access(metaPath)).resolves.toBeUndefined()
    })

    it('不带 name 使用默认 snapshot 前缀', async () => {
      const result = await createSnapshot(tmpDir)
      expect(result).toContain('snapshot_')
    })

    it('递归复制项目 data/ 下所有 .db/.sqlite 文件到快照子目录', async () => {
      // 在 tmpDir/data/players 下创建一个 .db 文件（tmpDir/db/test.db 在 data/ 外不会被复制）
      const playerDbDir = join(tmpDir, 'data', 'players')
      await mkdir(playerDbDir, { recursive: true })
      const playerDbPath = join(playerDbDir, 'players.db')
      await writeFile(playerDbPath, 'player-content')

      const snapshotDir = await createSnapshot(tmpDir, 'full')
      // data/players/players.db 应被复制到 snapshotDir/players/players.db（保持相对路径结构）
      const copiedDb = join(snapshotDir, 'players', 'players.db')
      await expect(access(copiedDb)).resolves.toBeUndefined()
      expect(await readFile(copiedDb, 'utf-8')).toBe('player-content')
    })
  })

  describe('cleanupOldBackups', () => {
    it('超过 MAX_BACKUPS(100) 时删除最旧的', async () => {
      // 注：此测试需创建 100+ 个文件，并行运行时 IO 竞争可能导致超时，故放宽至 15s
      const backupDir = join(tmpDir, 'data', 'backups')
      await mkdir(backupDir, { recursive: true })
      // 手动构造 100 个旧备份（meta + bak），时间戳早于当前，确保排序在最前
      const oldestName = 'test.db_2020-01-01T00-00-00-000Z.bak'
      for (let i = 0; i < 100; i++) {
        const ts = `2020-01-01T00-00-${String(i).padStart(2, '0')}-000Z`
        const name = `test.db_${ts}.bak`
        await writeFile(join(backupDir, name), 'old-bak')
        await writeFile(
          join(backupDir, name + '.meta.json'),
          JSON.stringify({ original: dbPath, time: ts, description: 'old', size: 7 })
        )
      }
      // 此时共有 100 个 meta，调用一次 createBackup 新增 1 个 → 101 → 触发清理删除最旧
      const realPath = await createBackup(tmpDir, dbPath, 'newest')
      expect(realPath).not.toBeNull()

      // 最旧的 meta + bak 应被删除
      await expect(access(join(backupDir, oldestName))).rejects.toThrow()
      await expect(access(join(backupDir, oldestName + '.meta.json'))).rejects.toThrow()

      // 最新的仍存在
      await expect(access(realPath!)).resolves.toBeUndefined()

      // 剩余 meta 数量为 100
      const remaining = (await readdir(backupDir)).filter((f) => f.endsWith('.meta.json'))
      expect(remaining).toHaveLength(100)

      // listBackups 仍可正常返回 100 条且最新在最前
      const list = await listBackups(tmpDir)
      expect(list).toHaveLength(100)
      expect(list[0].description).toBe('newest')
    }, 15000)

    it('listBackups 在清理失败/异常场景下不崩溃', async () => {
      const backupDir = join(tmpDir, 'data', 'backups')
      await mkdir(backupDir, { recursive: true })
      // 混合：1 个有效 meta + 1 个损坏 meta + 1 个空 meta
      await writeFile(join(tmpDir, 'db2.db'), 'x')
      await createBackup(tmpDir, dbPath, 'valid')
      await writeFile(join(backupDir, 'bad1.bak.meta.json'), '{broken')
      await writeFile(join(backupDir, 'bad2.bak.meta.json'), '')
      const list = await listBackups(tmpDir)
      expect(list).toHaveLength(1)
      expect(list[0].description).toBe('valid')
    })
  })
})
