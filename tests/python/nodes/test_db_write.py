"""db_write handler 单元测试。

覆盖 insert / update / delete 三种模式的正常路径、错误路径与边界条件，
重点验证安全约束（标识符白名单、condition 强制必填、SQL 注入字符拦截、
路径越权拒绝）。

被测源码：qqbat_nodes/builtin/db_write.py
"""
import os

import aiosqlite
import pytest

from qqbat_nodes.builtin.db_write import (
    _DB_POOL,
    _close_all_connections,
    _validate_identifier,
    db_write,
)

# ---------------------------------------------------------------------------
# 辅助 fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def isolated_cwd(tmp_path, monkeypatch):
    """将项目根定位到 tmp_path，让 validate_path 的 project_root 校验通过。

    db_write 内部使用 ``get_project_root()`` 作为项目根目录沙箱边界，
    因此测试需要通过环境变量 QQ_BOT_PROJECT_ROOT 把项目根设置为临时目录，
    db 文件即可放置在该目录下。同时切换 cwd 到 tmp_path，保证测试中相对路径的
    _init_users_db / aiosqlite.connect 也能解析到同一目录。
    """
    monkeypatch.setenv('QQ_BOT_PROJECT_ROOT', str(tmp_path))
    monkeypatch.chdir(tmp_path)
    return tmp_path


async def _init_users_db(db_path: str) -> None:
    """在 db_path 创建一张 users 表，供 insert/update/delete 测试使用。"""
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'name TEXT NOT NULL, level INTEGER DEFAULT 0)'
        )
        await db.commit()


async def _seed_users(db_path: str, rows) -> None:
    """向 users 表插入若干初始数据。"""
    async with aiosqlite.connect(db_path) as db:
        for row in rows:
            await db.execute(
                'INSERT INTO users (name, level) VALUES (?, ?)', row
            )
        await db.commit()


# ---------------------------------------------------------------------------
# 标识符校验单元函数
# ---------------------------------------------------------------------------

def test_validate_identifier_legal():
    assert _validate_identifier('users') is True
    assert _validate_identifier('_user_1') is True
    assert _validate_identifier('Users123') is True


def test_validate_identifier_illegal():
    # 空字符串
    assert _validate_identifier('') is False
    # 数字开头
    assert _validate_identifier('1abc') is False
    # 含特殊字符（典型 SQL 注入尝试）
    assert _validate_identifier('user; DROP TABLE') is False
    assert _validate_identifier('user--') is False
    assert _validate_identifier('user OR 1=1') is False
    # None
    assert _validate_identifier(None) is False  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 未知模式
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_write_unknown_mode(mock_bot, mock_event):
    """未知的 mode 返回 success=False，错误信息含模式名。"""
    result = await db_write(mock_bot, mock_event, mode='frobnicate', table='users', data={'a': 1})
    assert result['success'] is False
    assert '未知模式' in result['error']
    assert 'frobnicate' in result['error']


# ---------------------------------------------------------------------------
# insert 模式
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_write_insert_success(mock_bot, mock_event, isolated_cwd):
    """正常 insert 返回 success=True 且 lastrowid 为正整数。"""
    db_path = 'test_insert.db'
    await _init_users_db(db_path)

    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name': '张三', 'level': 1},
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['lastrowid'] >= 1
    assert result['error'] == ''

    # 校验数据真的写入数据库
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute('SELECT name, level FROM users WHERE id = ?', (result['lastrowid'],))
        row = await cur.fetchone()
    assert row == ('张三', 1)


@pytest.mark.asyncio
async def test_db_write_insert_empty_table(mock_bot, mock_event, isolated_cwd):
    """table 为空返回明确错误。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='', data={'name': '张三'},
    )
    assert result['success'] is False
    assert 'table' in result['error']
    assert result['lastrowid'] == -1


@pytest.mark.asyncio
async def test_db_write_insert_empty_data(mock_bot, mock_event, isolated_cwd):
    """data 为空 / None 返回明确错误。"""
    result_none = await db_write(
        mock_bot, mock_event, mode='insert', table='users', data=None,
    )
    assert result_none['success'] is False
    assert 'data' in result_none['error']

    result_empty = await db_write(
        mock_bot, mock_event, mode='insert', table='users', data={},
    )
    assert result_empty['success'] is False
    assert 'data' in result_empty['error']


@pytest.mark.asyncio
async def test_db_write_insert_illegal_table(mock_bot, mock_event, isolated_cwd):
    """非法表名（含 SQL 注入字符）应被白名单拒绝。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users; DROP TABLE x', data={'a': 1},
    )
    assert result['success'] is False
    assert '非法表名' in result['error']


@pytest.mark.asyncio
async def test_db_write_insert_illegal_column(mock_bot, mock_event, isolated_cwd):
    """非法列名应被白名单拒绝。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name; DROP TABLE users': 'evil'},
    )
    assert result['success'] is False
    assert '非法列名' in result['error']


@pytest.mark.asyncio
async def test_db_write_insert_path_traversal(mock_bot, mock_event, isolated_cwd):
    """db_path 含 .. 应被路径校验拒绝，禁止路径穿越。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name': 'evil'},
        db_path='../../etc/passwd.db',
    )
    assert result['success'] is False
    assert '路径' in result['error'] or '..' in result['error']


@pytest.mark.asyncio
async def test_db_write_insert_table_not_exist(mock_bot, mock_event, isolated_cwd):
    """向不存在的表 insert 返回 SQL 错误。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='ghost_table',
        data={'name': 'x'},
        db_path='not_exist.db',
    )
    assert result['success'] is False
    assert 'SQL 错误' in result['error']


@pytest.mark.asyncio
async def test_db_write_insert_column_type_mismatch(mock_bot, mock_event, isolated_cwd):
    """列类型不匹配（向 NOT NULL 列插 NULL / 缺列）应返回 SQL 错误。"""
    db_path = 'test_type.db'
    await _init_users_db(db_path)

    # 缺少必填的 name 列
    result = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'level': 1},  # name 缺失 → NOT NULL 约束失败
        db_path=db_path,
    )
    assert result['success'] is False
    assert 'SQL 错误' in result['error']


# ---------------------------------------------------------------------------
# update 模式
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_write_update_success(mock_bot, mock_event, isolated_cwd):
    """正常 update：命中 level=1 的两行，rows_updated==2。"""
    db_path = 'test_update.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 1), ('李四', 2), ('王五', 1)])

    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data={'level': 99},
        condition='level = ?',
        where_params=[1],
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_updated'] == 2
    assert result['error'] == ''

    # 校验数据真的被更新
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute('SELECT name, level FROM users ORDER BY id')
        rows = await cur.fetchall()
    assert rows == [('张三', 99), ('李四', 2), ('王五', 99)]


@pytest.mark.asyncio
async def test_db_write_update_zero_rows(mock_bot, mock_event, isolated_cwd):
    """update 命中 0 行：success=True 但 rows_updated==0。"""
    db_path = 'test_update_zero.db'
    await _init_users_db(db_path)

    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data={'level': 99},
        condition='id = ?',
        where_params=[999],
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_updated'] == 0
    assert result['error'] == ''


@pytest.mark.asyncio
async def test_db_write_update_empty_condition(mock_bot, mock_event, isolated_cwd):
    """condition 为空（含纯空白）应被拒绝，禁止全表更新。"""
    db_path = 'test_update_no_cond.db'
    await _init_users_db(db_path)

    for cond in ('', '   ', '\t\n'):
        result = await db_write(
            mock_bot, mock_event,
            mode='update', table='users',
            data={'level': 1},
            condition=cond,
            db_path=db_path,
        )
        assert result['success'] is False
        assert 'condition' in result['error']
        assert '全表' in result['error']


@pytest.mark.asyncio
async def test_db_write_update_condition_with_semicolon(mock_bot, mock_event, isolated_cwd):
    """condition 含分号应被拒绝（防 SQL 注入）。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data={'level': 1},
        condition='1=1; DROP TABLE users',
        db_path='test.db',
    )
    assert result['success'] is False
    assert '非法字符' in result['error']


@pytest.mark.asyncio
async def test_db_write_update_condition_with_comment(mock_bot, mock_event, isolated_cwd):
    """condition 含 SQL 注释（-- / /* */ / ;--）应被拒绝。"""
    for cond in ('id = 1 --', 'id = 1 /* xxx */', 'id = 1;--'):
        result = await db_write(
            mock_bot, mock_event,
            mode='update', table='users',
            data={'level': 1},
            condition=cond,
            db_path='test.db',
        )
        assert result['success'] is False, f'cond={cond!r} 应被拒绝'
        assert '非法字符' in result['error'], f'cond={cond!r} 应提示非法字符'


@pytest.mark.asyncio
async def test_db_write_update_with_string_where_param(mock_bot, mock_event, isolated_cwd):
    """condition 用 ? 占位符 + where_params 绑定字符串值，命中张三一行。

    P0-A8 修复后：禁止 condition 内联字面量字符串（引号注入风险），
    必须通过 ? 占位符 + where_params 参数化绑定。
    """
    db_path = 'test_update_literal.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 5)])

    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data={'level': 99},
        condition='name = ?',
        where_params=['张三'],
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_updated'] == 1
    assert result['error'] == ''


@pytest.mark.asyncio
async def test_db_write_update_condition_with_quote_rejected(mock_bot, mock_event, isolated_cwd):
    """P0-A8: condition 含引号（内联字面量字符串）应被拒绝，防 SQL 注入。"""
    for cond in (
        "name = 'admin' OR '1'='1'",  # 经典引号注入
        'name = "admin"',              # 双引号
        "name = '张三'",               # 单引号字面量
    ):
        result = await db_write(
            mock_bot, mock_event,
            mode='update', table='users',
            data={'level': 1},
            condition=cond,
            where_params=None,
            db_path='test.db',
        )
        assert result['success'] is False, f'cond={cond!r} 应被拒绝'
        assert '引号' in result['error'], f'cond={cond!r} 应提示引号'


@pytest.mark.asyncio
async def test_db_write_update_condition_with_union_rejected(mock_bot, mock_event, isolated_cwd):
    """P0-A8: condition 含 UNION 关键字应被拒绝，防 UNION SELECT 注入。"""
    for cond in (
        'id = ? UNION SELECT * FROM users',
        'id = ? union select password from users',
    ):
        result = await db_write(
            mock_bot, mock_event,
            mode='update', table='users',
            data={'level': 1},
            condition=cond,
            where_params=[1],
            db_path='test.db',
        )
        assert result['success'] is False, f'cond={cond!r} 应被拒绝'
        assert 'UNION' in result['error'], f'cond={cond!r} 应提示 UNION'


@pytest.mark.asyncio
async def test_db_write_update_condition_placeholder_mismatch(mock_bot, mock_event, isolated_cwd):
    """P0-A8: ? 占位符数量与 where_params 长度不匹配应被拒绝。"""
    # condition 有 1 个 ?，但 where_params 传 2 个值
    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data={'level': 1},
        condition='id = ?',
        where_params=[1, 2],
        db_path='test.db',
    )
    assert result['success'] is False
    assert '不匹配' in result['error']

    # condition 有 2 个 ?，但 where_params 传 1 个值
    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data={'level': 1},
        condition='id = ? AND level = ?',
        where_params=[1],
        db_path='test.db',
    )
    assert result['success'] is False
    assert '不匹配' in result['error']


@pytest.mark.asyncio
async def test_db_write_delete_condition_with_quote_rejected(mock_bot, mock_event, isolated_cwd):
    """P0-A8: delete 的 condition 含引号应被拒绝。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='delete', table='users',
        condition="name = 'admin' OR '1'='1'",
        db_path='test.db',
    )
    assert result['success'] is False
    assert '引号' in result['error']


@pytest.mark.asyncio
async def test_db_write_select_condition_with_quote_rejected(mock_bot, mock_event, isolated_cwd):
    """P0-A8: select 的 condition 含引号应被拒绝。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='select', table='users',
        condition="name = 'admin'",
        db_path='test.db',
    )
    assert result['success'] is False
    assert '引号' in result['error']


@pytest.mark.asyncio
async def test_db_write_update_illegal_table(mock_bot, mock_event, isolated_cwd):
    """update 时非法表名应被白名单拒绝。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users; DROP TABLE x',
        data={'level': 1},
        condition='id = ?',
        where_params=[1],
    )
    assert result['success'] is False
    assert '非法表名' in result['error']


@pytest.mark.asyncio
async def test_db_write_update_empty_data(mock_bot, mock_event, isolated_cwd):
    """update 时 data 为空 / None 应返回明确错误。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='update', table='users',
        data=None,
        condition='id = ?',
        where_params=[1],
    )
    assert result['success'] is False
    assert 'data' in result['error']


# ---------------------------------------------------------------------------
# delete 模式
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_write_delete_success(mock_bot, mock_event, isolated_cwd):
    """正常 delete：命中 level=1 的两行，rows_deleted==2。"""
    db_path = 'test_delete.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 1), ('李四', 2), ('王五', 1)])

    result = await db_write(
        mock_bot, mock_event,
        mode='delete', table='users',
        condition='level = ?',
        where_params=[1],
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_deleted'] == 2
    assert result['error'] == ''

    # 校验数据真的被删除，只剩李四
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute('SELECT name FROM users ORDER BY id')
        rows = await cur.fetchall()
    assert rows == [('李四',)]


@pytest.mark.asyncio
async def test_db_write_delete_zero_rows(mock_bot, mock_event, isolated_cwd):
    """delete 命中 0 行：success=True 但 rows_deleted==0。"""
    db_path = 'test_delete_zero.db'
    await _init_users_db(db_path)

    result = await db_write(
        mock_bot, mock_event,
        mode='delete', table='users',
        condition='id = ?',
        where_params=[999],
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_deleted'] == 0
    assert result['error'] == ''


@pytest.mark.asyncio
async def test_db_write_delete_empty_condition(mock_bot, mock_event, isolated_cwd):
    """delete 时 condition 为空应被拒绝，禁止全表删除。"""
    db_path = 'test_delete_no_cond.db'
    await _init_users_db(db_path)

    result = await db_write(
        mock_bot, mock_event,
        mode='delete', table='users',
        condition='',
        db_path=db_path,
    )
    assert result['success'] is False
    assert 'condition' in result['error']
    assert '全表' in result['error']


@pytest.mark.asyncio
async def test_db_write_delete_condition_with_semicolon(mock_bot, mock_event, isolated_cwd):
    """delete 的 condition 含分号应被拒绝（防 SQL 注入）。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='delete', table='users',
        condition='1=1; DROP TABLE users',
        db_path='test.db',
    )
    assert result['success'] is False
    assert '非法字符' in result['error']


@pytest.mark.asyncio
async def test_db_write_delete_illegal_table(mock_bot, mock_event, isolated_cwd):
    """delete 时非法表名应被白名单拒绝。"""
    result = await db_write(
        mock_bot, mock_event,
        mode='delete', table='1users',
        condition='id = ?',
        where_params=[1],
    )
    assert result['success'] is False
    assert '非法表名' in result['error']


# ---------------------------------------------------------------------------
# select 模式
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_write_select_success(mock_bot, mock_event, isolated_cwd):
    """正常 select：返回所有行，rows_count 正确。"""
    db_path = 'test_select.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 1), ('李四', 2)])

    result = await db_write(
        mock_bot, mock_event,
        mode='select', table='users',
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_count'] == 2
    assert result['error'] == ''
    assert result['found'] is True


@pytest.mark.asyncio
async def test_db_write_select_with_condition(mock_bot, mock_event, isolated_cwd):
    """select 带 WHERE 条件 + where_params 参数化绑定。"""
    db_path = 'test_select_cond.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 1), ('李四', 2), ('王五', 1)])

    result = await db_write(
        mock_bot, mock_event,
        mode='select', table='users',
        condition='level = ?',
        where_params=[1],
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_count'] == 2
    assert all(r['level'] == 1 for r in result['rows'])


@pytest.mark.asyncio
async def test_db_write_select_with_result_field(mock_bot, mock_event, isolated_cwd):
    """select + result_field：提取第一行指定字段到 value。"""
    db_path = 'test_select_field.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 1), ('李四', 2)])

    result = await db_write(
        mock_bot, mock_event,
        mode='select', table='users',
        condition='level = ?',
        where_params=[1],
        result_field='name',
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['value'] == '张三'
    assert result['found'] is True


@pytest.mark.asyncio
async def test_db_write_select_scalar_where_params(mock_bot, mock_event, isolated_cwd):
    """select 传标量 where_params（非 list）应自动包装。"""
    db_path = 'test_select_scalar.db'
    await _init_users_db(db_path)
    await _seed_users(db_path, [('张三', 1)])

    result = await db_write(
        mock_bot, mock_event,
        mode='select', table='users',
        condition='level = ?',
        where_params=1,  # 标量，应自动包装为 [1]
        db_path=db_path,
    )

    assert result['success'] is True
    assert result['rows_count'] == 1


# ---------------------------------------------------------------------------
# 连接池（P0-B7）
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_write_connection_pool_reuse(mock_bot, mock_event, isolated_cwd):
    """P0-B7: 同一 db_path 多次操作应复用连接（不重复 connect/close）。"""
    db_path = 'test_pool_reuse.db'
    await _init_users_db(db_path)

    # 第一次 insert 建立连接
    r1 = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name': '张三', 'level': 1},
        db_path=db_path,
    )
    assert r1['success'] is True

    # 捕获第一次操作后池中的连接对象
    # 规范化路径：_resolve_db_path 用 os.path.abspath
    abs_path = os.path.abspath(db_path)
    conn_after_first = _DB_POOL.get(abs_path)
    assert conn_after_first is not None, '首次操作后连接应在池中'

    # 第二次操作应复用同一连接对象
    r2 = await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name': '李四', 'level': 2},
        db_path=db_path,
    )
    assert r2['success'] is True
    conn_after_second = _DB_POOL.get(abs_path)
    assert conn_after_second is conn_after_first, '同一 db_path 应复用连接对象'


@pytest.mark.asyncio
async def test_db_write_connection_pool_wal_mode(mock_bot, mock_event, isolated_cwd):
    """P0-B7: 连接池首次连接应开启 WAL 模式。"""
    db_path = 'test_pool_wal.db'
    await _init_users_db(db_path)

    # 触发连接池建立连接
    await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name': '张三', 'level': 1},
        db_path=db_path,
    )

    abs_path = os.path.abspath(db_path)
    db = _DB_POOL.get(abs_path)
    assert db is not None, '连接应在池中'
    # 验证 journal_mode=WAL
    cursor = await db.execute('PRAGMA journal_mode')
    row = await cursor.fetchone()
    assert row[0].lower() == 'wal'


@pytest.mark.asyncio
async def test_db_write_close_all_connections(mock_bot, mock_event, isolated_cwd):
    """P0-B7: _close_all_connections 应关闭并清空池中所有连接。"""
    db_path = 'test_pool_close.db'
    await _init_users_db(db_path)

    await db_write(
        mock_bot, mock_event,
        mode='insert', table='users',
        data={'name': '张三', 'level': 1},
        db_path=db_path,
    )

    abs_path = os.path.abspath(db_path)
    assert _DB_POOL.get(abs_path) is not None, '操作后连接应在池中'

    await _close_all_connections()

    assert _DB_POOL.get(abs_path) is None, '关闭后连接应已从池中移除'
    assert len(_DB_POOL) == 0, '池应已清空'
