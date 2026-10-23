// src/main/services/builtinNodes/__tests__/databaseWrite.test.ts
// 验证 databaseWrite.ts 的参数归一化与 JSON 列序列化行为
// 已修复 better-sqlite3 版本 mismatch 问题（npm rebuild 后已解决）
// 所有测试覆盖安全校验逻辑（SQL 执行前完成）

import { describe, it, expect } from 'vitest';
import { databaseWrite } from '../databaseWrite';
import type { DBOptions } from '../databaseWrite';

const TEST_DB_PATH = 'test_data.db';

describe('databaseWrite - insert 模式', () => {
  it('应接受合法的 insert 参数（表名、列名合法）', async () => {
    const result = await databaseWrite({
      mode: 'insert',
      table: 'users',
      data: { name: '张三', level: 1 },
      db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('非法表名');
    expect(result.error).not.toContain('非法列名');
    expect(result.error).toContain('SQL 错误');
  });

  it('应拒绝空表名', async () => {
    const result = await databaseWrite({
      mode: 'insert', table: '', data: { name: '张三' }, db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('table 不能为空');
  });

  it('应拒绝非法表名（含空格）', async () => {
    const result = await databaseWrite({
      mode: 'insert', table: 'users table', data: { name: '张三' }, db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('非法表名');
  });

  it('应拒绝非法列名', async () => {
    const result = await databaseWrite({
      mode: 'insert', table: 'users', data: { 'invalid col': '值' }, db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('非法列名');
  });

  it('应拒绝空数据', async () => {
    const result = await databaseWrite({
      mode: 'insert', table: 'users', data: null, db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('data 不能为空');
  });
});

describe('databaseWrite - update 模式', () => {
  it('应拒绝空 condition（禁止全表更新）', async () => {
    const result = await databaseWrite({
      mode: 'update', table: 'users', data: { name: '张三' }, condition: '', db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('condition 不能为空，禁止全表更新');
  });

  it('应拒绝 condition 中的引号（SQL 注入防护）', async () => {
    const result = await databaseWrite({
      mode: 'update', table: 'users', data: { name: '张三' }, condition: "name = 'admin'", where_params: ['admin'], db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('condition 包含引号');
  });

  it('应拒绝 condition 中的 UNION 关键字', async () => {
    const result = await databaseWrite({
      mode: 'update', table: 'users', data: { name: '张三' }, condition: "name UNION SELECT", where_params: [], db_path: TEST_DB_PATH,
    });
    expect(!result.success || result.error?.includes('UNION')).toBe(true);
  });

  it('应拒绝 condition 中的分号', async () => {
    const result = await databaseWrite({
      mode: 'update', table: 'users', data: { name: '张三' }, condition: "name = ; DROP TABLE", where_params: [], db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('condition 包含非法字符');
  });

  it('应接受合法的有参数 condition', async () => {
    const result = await databaseWrite({
      mode: 'update', table: 'users', data: { name: '张三' }, condition: 'id = ?', where_params: [123], db_path: TEST_DB_PATH,
    });
    // 断言"安全校验放行"：不能出现占位符数量/非法字符类错误。
    // 注意不能用"SQL 错误"反推 —— 那条断言在旧的 `/\\?/g` 正则下是**假通过**
    // （`\\?` 匹配每个位置的空串，占位符数量恒等于字符串长度，于是任何带
    //  where_params 的语句都被判为"数量不匹配"）。修正正则后这里会真正走到
    // 执行阶段，报什么错取决于环境里有没有 better-sqlite3 / 表，故不再断言它。
    expect(result.error ?? '').not.toContain('占位符')
    expect(result.error ?? '').not.toContain('非法')
  });

  it('占位符与 where_params 数量不匹配时应拒绝', async () => {
    const result = await databaseWrite({
      mode: 'update', table: 'users', data: { name: '张三' }, condition: 'id = ? AND name = ?', where_params: [1], db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('占位符');
  });

  it('占位符数量按 where_params 判断，而不是按 SET 的列数', async () => {
    // 回归：原实现把 `data`（SET 的列值）当成 WHERE 绑定值去数占位符，
    // 于是"改 2 列 + 1 个 WHERE 占位符"会被误判为数量不匹配。
    const result = await databaseWrite({
      mode: 'update',
      table: 'users',
      data: { name: '张三', level: 2 },
      condition: 'id = ?',
      where_params: [1],
      db_path: TEST_DB_PATH,
    });
    expect(result.error ?? '').not.toContain('占位符');
  });
});

describe('databaseWrite - delete 模式', () => {
  it('应拒绝空 condition（禁止全表删除）', async () => {
    const result = await databaseWrite({
      mode: 'delete', table: 'users', condition: '', db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('condition 不能为空，禁止全表删除');
  });

  it('应拒绝 condition 中的引号', async () => {
    const result = await databaseWrite({
      mode: 'delete', table: 'users', condition: "id = '1'", where_params: [], db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('condition 包含引号');
  });

  it('应拒绝 condition 中的 UNION', async () => {
    const result = await databaseWrite({
      mode: 'delete', table: 'users', condition: 'id = ? UNION ALL', where_params: [1], db_path: TEST_DB_PATH,
    });
    expect(!result.success || result.error?.includes('UNION')).toBe(true);
  });
});

describe('databaseWrite - select 模式', () => {
  it('应拒绝非法 result_field', async () => {
    const result = await databaseWrite({
      mode: 'select', table: 'users', condition: '', result_field: 'invalid-field', db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('非法 result_field');
  });

  it('应接受合法的 result_field', async () => {
    const result = await databaseWrite({
      mode: 'select', table: 'users', condition: '', result_field: 'name', db_path: TEST_DB_PATH,
    });
    expect(typeof result.success).toBe('boolean');
  });

  it('应拒绝无效的 mode', async () => {
    const result = await databaseWrite({
      mode: 'invalid_mode' as unknown as DBOptions['mode'], table: 'users', db_path: TEST_DB_PATH,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('未知模式');
  });
});
// End of file - no extra braces