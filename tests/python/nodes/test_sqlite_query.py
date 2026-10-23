"""sqlite_query 节点单元测试。

sqlite_query 节点执行 SQL 查询（强制只读），安全约束包括：
- PRAGMA query_only = 1 防止 DDL/DML 写操作
- db_path 必须在项目根目录内，禁止路径穿越
- 通过 params 参数化查询，防止 SQL 注入
- fetchmany(limit) 限制结果集大小

测试覆盖：
- 路径校验：空路径、路径穿越、超出项目范围
- 查询校验：空查询、纯空白查询
- limit 校验：默认值、自定义、0/负数/非法值回退
- params 解析：JSON 字符串、非法 JSON、非 list 类型、tuple
- SELECT 查询：全表查询、列名提取、参数化查询、空表、limit 截断
- 只读约束：INSERT/UPDATE/DROP 被 query_only 拦截
- 错误处理：SQL 语法错误、表不存在、返回结构完整性

被测源码：qqbat_nodes/builtin/sqlite_query.py
测试策略：使用临时数据库文件 + isolated_cwd fixture（切换 cwd 到 tmp_path），
让 validate_path 的 project_root 校验通过。
"""
import aiosqlite
import pytest

from qqbat_nodes.builtin.sqlite_query import sqlite_query


# ---------------------------------------------------------------------------
# 辅助 fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def isolated_cwd(tmp_path, monkeypatch):
    """切换 cwd 到 tmp_path，让 validate_path 的 project_root 校验通过。

    sqlite_query 内部使用 ``os.getcwd()`` 作为项目根目录沙箱边界，因此测试需要
    把工作目录切换到一个临时目录，db 文件即可放置在该目录下。
    """
    monkeypatch.chdir(tmp_path)
    return tmp_path


async def _init_test_db(db_path: str) -> None:
    """在 db_path 创建一张 users 表并插入测试数据。"""
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            'CREATE TABLE users ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'name TEXT NOT NULL, '
            'age INTEGER DEFAULT 0)'
        )
        await db.execute(
            'INSERT INTO users (name, age) VALUES '
            "('张三', 20), ('李四', 25), ('王五', 30)"
        )
        await db.commit()


# ===========================================================================
# 路径校验
# ===========================================================================

class TestPathValidation:
    """测试 db_path 的路径校验与安全约束。"""

    @pytest.mark.asyncio
    async def test_empty_db_path_returns_error(self, mock_bot, mock_event, isolated_cwd):
        """空 db_path 返回错误信息。"""
        result = await sqlite_query(mock_bot, mock_event, db_path='', query='SELECT 1')
        assert result['error'] != ''
        assert '路径' in result['error'] or '不能为空' in result['error']
        assert result['rows'] == []

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self, mock_bot, mock_event, isolated_cwd):
        """db_path 含 .. 路径穿越时被拒绝。"""
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path='../../etc/passwd.db', query='SELECT 1',
        )
        assert result['error'] != ''
        assert '..' in result['error'] or '路径' in result['error']

    @pytest.mark.asyncio
    async def test_path_outside_project_rejected(self, mock_bot, mock_event, isolated_cwd):
        """db_path 为绝对路径且超出项目范围时被拒绝。"""
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path='C:\\Windows\\System32\\evil.db', query='SELECT 1',
        )
        assert result['error'] != ''
        assert '路径' in result['error'] or '范围' in result['error']


# ===========================================================================
# 查询校验
# ===========================================================================

class TestQueryValidation:
    """测试 query 参数的校验。"""

    @pytest.mark.asyncio
    async def test_empty_query_returns_error(self, mock_bot, mock_event, isolated_cwd):
        """空 query 返回错误信息。"""
        result = await sqlite_query(
            mock_bot, mock_event, db_path='test.db', query='',
        )
        assert 'query 不能为空' in result['error']
        assert result['rows'] == []

    @pytest.mark.asyncio
    async def test_whitespace_only_query_returns_error(self, mock_bot, mock_event, isolated_cwd):
        """纯空白 query 返回错误信息。"""
        result = await sqlite_query(
            mock_bot, mock_event, db_path='test.db', query='   \t\n  ',
        )
        assert 'query 不能为空' in result['error']


# ===========================================================================
# limit 校验
# ===========================================================================

class TestLimitValidation:
    """测试 limit 参数的校验与回退逻辑。"""

    @pytest.mark.asyncio
    async def test_custom_limit(self, mock_bot, mock_event, isolated_cwd):
        """自定义 limit=2 时只返回 2 行。"""
        db_path = 'test_limit.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users ORDER BY id', limit=2,
        )
        assert result['error'] == ''
        assert len(result['rows']) == 2

    @pytest.mark.asyncio
    async def test_zero_limit_falls_back_to_1000(self, mock_bot, mock_event, isolated_cwd):
        """limit=0 回退为默认 1000。"""
        db_path = 'test_zero_limit.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users', limit=0,
        )
        assert result['error'] == ''
        # 3 行全部返回（limit 回退为 1000）
        assert len(result['rows']) == 3

    @pytest.mark.asyncio
    async def test_negative_limit_falls_back(self, mock_bot, mock_event, isolated_cwd):
        """负数 limit 回退为默认 1000。"""
        db_path = 'test_neg_limit.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users', limit=-5,
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3

    @pytest.mark.asyncio
    async def test_invalid_string_limit_falls_back(self, mock_bot, mock_event, isolated_cwd):
        """非法字符串 limit 回退为默认 1000。"""
        db_path = 'test_str_limit.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users', limit='abc',
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3

    @pytest.mark.asyncio
    async def test_none_limit_falls_back(self, mock_bot, mock_event, isolated_cwd):
        """None limit 回退为默认 1000。"""
        db_path = 'test_none_limit.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users', limit=None,
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3


# ===========================================================================
# params 类型解析
# ===========================================================================

class TestParamsParsing:
    """测试 params 参数的类型解析。"""

    @pytest.mark.asyncio
    async def test_string_params_json_parsed(self, mock_bot, mock_event, isolated_cwd):
        """JSON 字符串 params 被解析为 list。"""
        db_path = 'test_str_params.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users WHERE name = ?',
            params='["张三"]',
        )
        assert result['error'] == ''
        assert len(result['rows']) == 1
        assert result['rows'][0][1] == '张三'

    @pytest.mark.asyncio
    async def test_invalid_json_string_params_empty(self, mock_bot, mock_event, isolated_cwd):
        """非法 JSON 字符串 params 被当作空 list（查询不绑定参数）。"""
        db_path = 'test_bad_json.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users',
            params='{invalid}',
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3

    @pytest.mark.asyncio
    async def test_non_list_params_ignored(self, mock_bot, mock_event, isolated_cwd):
        """非 list/tuple 类型 params 被当作空 list。"""
        db_path = 'test_int_params.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users',
            params=123,
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3

    @pytest.mark.asyncio
    async def test_tuple_params_accepted(self, mock_bot, mock_event, isolated_cwd):
        """tuple 类型 params 被接受并转换为 list。"""
        db_path = 'test_tuple_params.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users WHERE age > ?',
            params=(22,),
        )
        assert result['error'] == ''
        assert len(result['rows']) == 2  # 李四(25) 和 王五(30)

    @pytest.mark.asyncio
    async def test_none_params_empty_list(self, mock_bot, mock_event, isolated_cwd):
        """None params 被当作空 list。"""
        db_path = 'test_none_params.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users',
            params=None,
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3


# ===========================================================================
# SELECT 查询
# ===========================================================================

class TestSelectQueries:
    """测试 SELECT 查询的正常执行。"""

    @pytest.mark.asyncio
    async def test_select_all_rows(self, mock_bot, mock_event, isolated_cwd):
        """SELECT * 返回全部行。"""
        db_path = 'test_select_all.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3

    @pytest.mark.asyncio
    async def test_select_returns_columns(self, mock_bot, mock_event, isolated_cwd):
        """columns 字段包含列名列表。"""
        db_path = 'test_columns.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert result['error'] == ''
        assert result['columns'] == ['id', 'name', 'age']

    @pytest.mark.asyncio
    async def test_select_with_params(self, mock_bot, mock_event, isolated_cwd):
        """参数化查询正确绑定参数。"""
        db_path = 'test_param_query.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users WHERE name = ?',
            params=['李四'],
        )
        assert result['error'] == ''
        assert len(result['rows']) == 1
        assert result['rows'][0][1] == '李四'

    @pytest.mark.asyncio
    async def test_select_empty_table(self, mock_bot, mock_event, isolated_cwd):
        """空表查询返回空 rows 列表，columns 仍有列名。"""
        db_path = 'test_empty_table.db'
        async with aiosqlite.connect(db_path) as db:
            await db.execute('CREATE TABLE empty_t (a TEXT, b INTEGER)')
            await db.commit()
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM empty_t',
        )
        assert result['error'] == ''
        assert result['rows'] == []
        assert result['columns'] == ['a', 'b']

    @pytest.mark.asyncio
    async def test_limit_truncates_results(self, mock_bot, mock_event, isolated_cwd):
        """limit 小于总行数时截断结果。"""
        db_path = 'test_truncate.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM users ORDER BY id',
            limit=1,
        )
        assert result['error'] == ''
        assert len(result['rows']) == 1

    @pytest.mark.asyncio
    async def test_select_specific_columns(self, mock_bot, mock_event, isolated_cwd):
        """SELECT 指定列时 columns 反映选择的列。"""
        db_path = 'test_specific.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT name, age FROM users',
        )
        assert result['error'] == ''
        assert result['columns'] == ['name', 'age']
        assert len(result['rows']) == 3


# ===========================================================================
# 只读约束（query_only）
# ===========================================================================

class TestQueryOnlyEnforcement:
    """测试 PRAGMA query_only = 1 对写操作的拦截。"""

    @pytest.mark.asyncio
    async def test_insert_blocked(self, mock_bot, mock_event, isolated_cwd):
        """INSERT 语句被 query_only 拦截，返回 SQL 错误。"""
        db_path = 'test_insert_blocked.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query="INSERT INTO users (name, age) VALUES ('赵六', 40)",
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']

    @pytest.mark.asyncio
    async def test_update_blocked(self, mock_bot, mock_event, isolated_cwd):
        """UPDATE 语句被 query_only 拦截。"""
        db_path = 'test_update_blocked.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query="UPDATE users SET age = 99 WHERE name = '张三'",
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']

    @pytest.mark.asyncio
    async def test_delete_blocked(self, mock_bot, mock_event, isolated_cwd):
        """DELETE 语句被 query_only 拦截。"""
        db_path = 'test_delete_blocked.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query="DELETE FROM users WHERE name = '张三'",
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']

    @pytest.mark.asyncio
    async def test_drop_table_blocked(self, mock_bot, mock_event, isolated_cwd):
        """DROP TABLE 语句被 query_only 拦截。"""
        db_path = 'test_drop_blocked.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='DROP TABLE users',
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']

    @pytest.mark.asyncio
    async def test_data_unchanged_after_write_attempt(self, mock_bot, mock_event, isolated_cwd):
        """写操作被拦截后，数据库中的数据保持不变。"""
        db_path = 'test_data_unchanged.db'
        await _init_test_db(db_path)
        # 尝试删除
        await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query="DELETE FROM users",
        )
        # 验证数据仍在
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert result['error'] == ''
        assert len(result['rows']) == 3  # 数据未被删除


# ===========================================================================
# 错误处理
# ===========================================================================

class TestErrorHandling:
    """测试 SQL 执行错误的处理。"""

    @pytest.mark.asyncio
    async def test_sql_syntax_error(self, mock_bot, mock_event, isolated_cwd):
        """SQL 语法错误返回 SQL 错误信息。"""
        db_path = 'test_syntax.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELEC * FORM users',
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']

    @pytest.mark.asyncio
    async def test_table_not_exist(self, mock_bot, mock_event, isolated_cwd):
        """查询不存在的表返回 SQL 错误。"""
        db_path = 'test_no_table.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path,
            query='SELECT * FROM ghost_table',
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']

    @pytest.mark.asyncio
    async def test_db_file_not_exist(self, mock_bot, mock_event, isolated_cwd):
        """数据库文件不存在时返回 SQL 错误（aiosqlite 会创建空库）。"""
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path='nonexistent.db',
            query='SELECT * FROM users',
        )
        assert result['error'] != ''
        assert 'SQL 错误' in result['error']


# ===========================================================================
# 返回结构完整性
# ===========================================================================

class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_success_return_fields(self, mock_bot, mock_event, isolated_cwd):
        """成功路径返回 {rows, columns, error} 三个键。"""
        db_path = 'test_struct.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert set(result.keys()) == {'rows', 'columns', 'error'}

    @pytest.mark.asyncio
    async def test_error_return_fields(self, mock_bot, mock_event, isolated_cwd):
        """错误路径同样返回 {rows, columns, error} 三个键。"""
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path='test.db', query='SELECT * FROM nonexistent',
        )
        assert set(result.keys()) == {'rows', 'columns', 'error'}

    @pytest.mark.asyncio
    async def test_rows_is_list_type(self, mock_bot, mock_event, isolated_cwd):
        """rows 字段始终为 list 类型。"""
        db_path = 'test_list.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert isinstance(result['rows'], list)

    @pytest.mark.asyncio
    async def test_columns_is_list_type(self, mock_bot, mock_event, isolated_cwd):
        """columns 字段始终为 list 类型。"""
        db_path = 'test_cols_type.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert isinstance(result['columns'], list)

    @pytest.mark.asyncio
    async def test_error_is_string_type(self, mock_bot, mock_event, isolated_cwd):
        """error 字段始终为字符串类型。"""
        db_path = 'test_err_type.db'
        await _init_test_db(db_path)
        result = await sqlite_query(
            mock_bot, mock_event,
            db_path=db_path, query='SELECT * FROM users',
        )
        assert isinstance(result['error'], str)
