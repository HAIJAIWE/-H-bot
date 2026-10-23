// tests/main/services/dataTransferService.test.ts
// SQL 白名单校验回归测试：验证 dataTransferService 的 4 个导出函数对
// 表名/列名执行严格白名单校验，防止 SQL 注入。
//
// 测试策略：
// - mock getDb 避免真实 better-sqlite3 数据库（校验在 getDb 之前发生，无需真实 DB）
// - 使用真实 tmp 目录读写 JSON/CSV 文件（vitest 4 下 vi.mock('fs') 不稳定）
// - 聚焦校验逻辑：非法表名/列名应在调用 getDb 之前抛出 Error
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// mock @main/services/dataService 的 getDb，避免真实数据库连接
// 校验逻辑在 getDb 调用之前执行，所以 mock 仅用于"合法路径"测试中验证 prepare 调用
vi.mock('@main/services/dataService', () => ({
  getDb: vi.fn(() => {
    // 返回一个 mock db，提供 prepare/all/run/transaction 方法
    return {
      prepare: vi.fn(() => ({
        all: vi.fn(() => [{ id: 1, name: 'mock-row' }]),
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 }))
      })),
      transaction: vi.fn((fn: () => void) => fn)
    }
  })
}))

// 在所有 mock 之后导入被测模块
import {
  exportTableToJson,
  exportTableToCsv,
  importFromJson,
  importFromCsv
} from '@main/services/dataTransferService'
import { getDb } from '@main/services/dataService'

let tmpDir: string

beforeEach(() => {
  vi.clearAllMocks()
  tmpDir = mkdtempSync(join(tmpdir(), 'qqbat-transfer-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** 写一个 JSON 文件到 tmp 目录，返回路径 */
function writeJsonFile(name: string, data: unknown): string {
  const path = join(tmpDir, name)
  writeFileSync(path, JSON.stringify(data), 'utf-8')
  return path
}

/** 写一个 CSV 文件到 tmp 目录，返回路径 */
function writeCsvFile(name: string, content: string): string {
  const path = join(tmpDir, name)
  writeFileSync(path, content, 'utf-8')
  return path
}

describe('SQL 白名单校验', () => {
  describe('拒绝 SQLite 系统表导出', () => {
    it('exportTableToJson 拒绝 sqlite_master', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'sqlite_master', outPath)).toThrow(
        /SQLite internal table|Invalid table/i
      )
      // 校验失败时不应访问数据库
      expect(getDb).not.toHaveBeenCalled()
    })

    it('exportTableToJson 拒绝 sqlite_sequence（破坏自增序列）', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'sqlite_sequence', outPath)).toThrow(
        /SQLite internal table|Invalid table/i
      )
      expect(getDb).not.toHaveBeenCalled()
    })

    it('exportTableToCsv 拒绝 sqlite_schema', () => {
      const outPath = join(tmpDir, 'out.csv')
      expect(() => exportTableToCsv('/fake.db', 'sqlite_schema', outPath)).toThrow(
        /SQLite internal table|Invalid table/i
      )
      expect(getDb).not.toHaveBeenCalled()
    })

    it('大小写不敏感：SQLITE_MASTER 也被拒绝', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'SQLITE_MASTER', outPath)).toThrow(
        /SQLite internal table|Invalid table/i
      )
      expect(getDb).not.toHaveBeenCalled()
    })

    it('importFromJson 拒绝 sqlite_master 作为目标表', () => {
      const jsonPath = writeJsonFile('data.json', [{ id: 1 }])
      expect(() => importFromJson('/fake.db', 'sqlite_master', jsonPath)).toThrow(
        /SQLite internal table|Invalid table/i
      )
      expect(getDb).not.toHaveBeenCalled()
    })

    it('importFromCsv 拒绝 sqlite_master 作为目标表', () => {
      const csvPath = writeCsvFile('data.csv', 'id\n1\n')
      expect(() => importFromCsv('/fake.db', 'sqlite_master', csvPath)).toThrow(
        /SQLite internal table|Invalid table/i
      )
      expect(getDb).not.toHaveBeenCalled()
    })
  })

  describe('拒绝非法表名（含分号/引号/空格等 SQL 元字符）', () => {
    const illegalTableNames = [
      'users; DROP TABLE users--',
      'users"; DROP TABLE users--',
      "users'; DROP TABLE users--",
      '"users"',
      "'users'",
      'user name', // 空格
      'user--name', // SQL 注释
      'user`name', // 反引号
      'user*name', // 通配符
      '123table', // 数字开头（不是合法标识符）
      '', // 空字符串
      '   ' // 纯空白
    ]

    for (const name of illegalTableNames) {
      it(`exportTableToJson 拒绝 "${name}"`, () => {
        const outPath = join(tmpDir, 'out.json')
        expect(() => exportTableToJson('/fake.db', name, outPath)).toThrow()
        expect(getDb).not.toHaveBeenCalled()
      })
    }

    it('exportTableToCsv 拒绝含分号的注入表名', () => {
      const outPath = join(tmpDir, 'out.csv')
      expect(() =>
        exportTableToCsv('/fake.db', 'users; DROP TABLE users--', outPath)
      ).toThrow()
      expect(getDb).not.toHaveBeenCalled()
    })

    it('importFromJson 拒绝含引号的注入表名', () => {
      const jsonPath = writeJsonFile('data.json', [{ id: 1 }])
      expect(() => importFromJson('/fake.db', '"users"', jsonPath)).toThrow()
      expect(getDb).not.toHaveBeenCalled()
    })

    it('importFromCsv 拒绝含空格的注入表名', () => {
      const csvPath = writeCsvFile('data.csv', 'id\n1\n')
      expect(() => importFromCsv('/fake.db', 'user name', csvPath)).toThrow()
      expect(getDb).not.toHaveBeenCalled()
    })
  })

  describe('拒绝非法列名', () => {
    const illegalColumnNames = [
      "col'; DROP--",
      'col"; DROP--',
      'col; DROP TABLE t--',
      'col space',
      'col--comment',
      'col`backtick',
      'col*star',
      '123col' // 数字开头
      // 注意：'col"quote"' 不在 CSV 列名测试中，因为 CSV 解析器会剥离引号，
      // 这是 CSV 解析逻辑的职责，不是 SQL 白名单校验的职责
    ]

    for (const col of illegalColumnNames) {
      it(`importFromJson 拒绝 JSON 列名 "${col}"`, () => {
        // 构造一个含非法列名的 JSON 数据
        const jsonPath = writeJsonFile('data.json', [{ [col]: 'value' }])
        expect(() => importFromJson('/fake.db', 'equipment', jsonPath)).toThrow(
          /Invalid column/i
        )
        expect(getDb).not.toHaveBeenCalled()
      })
    }

    for (const col of illegalColumnNames) {
      it(`importFromCsv 拒绝 CSV 表头 "${col}"`, () => {
        const csvPath = writeCsvFile('data.csv', `${col}\nvalue\n`)
        expect(() => importFromCsv('/fake.db', 'equipment', csvPath)).toThrow(
          /Invalid column/i
        )
        expect(getDb).not.toHaveBeenCalled()
      })
    }

    it('importFromJson 多列中只要有一列非法即拒绝', () => {
      const jsonPath = writeJsonFile('data.json', [{ id: 1, name: 'ok', "col'; DROP--": 'bad' }])
      expect(() => importFromJson('/fake.db', 'equipment', jsonPath)).toThrow(/Invalid column/i)
      expect(getDb).not.toHaveBeenCalled()
    })
  })

  describe('允许合法表名', () => {
    it('exportTableToJson 允许白名单内的系统表（audit_log）', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'audit_log', outPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('exportTableToJson 允许白名单内的系统表（bot_state）', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'bot_state', outPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('exportTableToJson 允许白名单内的系统表（_persistent）', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', '_persistent', outPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('exportTableToJson 允许合法用户表名（equipment）', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'equipment', outPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('exportTableToJson 允许合法用户表名（skills）', () => {
      const outPath = join(tmpDir, 'out.json')
      expect(() => exportTableToJson('/fake.db', 'skills', outPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('exportTableToCsv 允许合法用户表名', () => {
      const outPath = join(tmpDir, 'out.csv')
      expect(() => exportTableToCsv('/fake.db', 'skills', outPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('importFromJson 允许合法表名（跳过列名校验通过路径）', () => {
      const jsonPath = writeJsonFile('data.json', [{ id: 1, name: 'ok' }])
      expect(() => importFromJson('/fake.db', 'equipment', jsonPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })

    it('importFromCsv 允许合法表名', () => {
      const csvPath = writeCsvFile('data.csv', 'id,name\n1,ok\n')
      expect(() => importFromCsv('/fake.db', 'equipment', csvPath)).not.toThrow()
      expect(getDb).toHaveBeenCalledTimes(1)
    })
  })

  describe('参数化 VALUES 占位符', () => {
    /**
     * 从 prepare 调用中提取实际 SQL 字符串
     * 注意：dataTransferService 使用 `columns.map(() => '?').join(',')` 生成占位符，
     * 实际格式是 `VALUES (?,?)`（无空格），而非 `VALUES (?, ?)`。
     */
    function getPreparedSql(): string {
      const mockDb = (getDb as ReturnType<typeof vi.fn>).mock.results[0].value
      const prepareMock = mockDb.prepare as ReturnType<typeof vi.fn>
      return prepareMock.mock.calls[0][0] as string
    }

    /** 统计 SQL 中 ? 占位符的数量 */
    function countPlaceholders(sql: string): number {
      const matches = sql.match(/\?/g)
      return matches ? matches.length : 0
    }

    it('importFromJson 使用 ? 占位符，不拼接用户值到 SQL', () => {
      // 用户提供的 JSON 中包含"看起来像 SQL"的值，验证这些值只会通过参数绑定传入
      const maliciousValue = "'); DROP TABLE equipment;--"
      const jsonPath = writeJsonFile('data.json', [
        { id: 1, name: maliciousValue }
      ])
      importFromJson('/fake.db', 'equipment', jsonPath)

      const sql = getPreparedSql()
      // SQL 必须使用 ? 占位符（2 列 → 2 个 ?）
      expect(countPlaceholders(sql)).toBe(2)
      expect(sql).toMatch(/VALUES \(\?,\?\)/)
      // SQL 中绝不能出现用户值（用户值只通过 better-sqlite3 的参数绑定传入）
      expect(sql).not.toContain(maliciousValue)
      expect(sql).not.toContain('DROP TABLE')
      // 列名经校验后拼接（合法列名才允许拼接）
      expect(sql).toContain('id')
      expect(sql).toContain('name')
    })

    it('importFromCsv 使用 ? 占位符，不拼接用户值到 SQL', () => {
      const maliciousValue = "'; DROP TABLE skills;--"
      const csvPath = writeCsvFile('data.csv', `id,name\n1,${maliciousValue}\n`)
      importFromCsv('/fake.db', 'skills', csvPath)

      const sql = getPreparedSql()
      expect(countPlaceholders(sql)).toBe(2)
      expect(sql).toMatch(/VALUES \(\?,\?\)/)
      // SQL 中绝不能出现用户值
      expect(sql).not.toContain(maliciousValue)
      expect(sql).not.toContain('DROP TABLE')
    })

    it('importFromJson 多列时占位符数量与列数一致', () => {
      const jsonPath = writeJsonFile('data.json', [
        { id: 1, name: 'a', level: 10, extra: 'x' }
      ])
      importFromJson('/fake.db', 'equipment', jsonPath)

      const sql = getPreparedSql()
      // 4 列 → 4 个 ? 占位符
      expect(countPlaceholders(sql)).toBe(4)
      expect(sql).toMatch(/VALUES \(\?,\?,\?,\?\)/)
    })

    it('importFromCsv 多列时占位符数量与列数一致', () => {
      const csvPath = writeCsvFile('data.csv', 'id,name,level\n1,a,10\n')
      importFromCsv('/fake.db', 'equipment', csvPath)

      const sql = getPreparedSql()
      // 3 列 → 3 个 ? 占位符
      expect(countPlaceholders(sql)).toBe(3)
      expect(sql).toMatch(/VALUES \(\?,\?,\?\)/)
    })
  })

  describe('表名校验在数据库访问之前发生', () => {
    it('非法表名不会触发 getDb 调用（避免打开不存在的数据库文件）', () => {
      const outPath = join(tmpDir, 'out.json')
      try {
        exportTableToJson('/nonexistent/path.db', 'users; DROP', outPath)
      } catch {
        // 预期抛错
      }
      // 关键：校验失败时不应调用 getDb（getDb 会因文件不存在而抛另一个错）
      expect(getDb).not.toHaveBeenCalled()
    })

    it('非法列名不会触发 getDb 调用', () => {
      const jsonPath = writeJsonFile('data.json', [{ "col'; DROP--": 1 }])
      try {
        importFromJson('/fake.db', 'equipment', jsonPath)
      } catch {
        // 预期抛错
      }
      expect(getDb).not.toHaveBeenCalled()
    })
  })
})
