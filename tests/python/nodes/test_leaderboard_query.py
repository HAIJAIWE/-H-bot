"""leaderboard_query 节点单元测试。

覆盖：
- 参数校验：空 key / 非法 scope / 非法 sort / 非法 value_type / limit 边界
- 正常查询：数值降序 / 数值升序 / 字符串排序 / limit 截断
- 数据过滤：跳过 None 值 / 跳过已过期数据 / 跳过旧格式 None
- 格式化输出：text 含标题/排行/空提示；自定义标题与值标签
- 旧格式数据兼容：直接存储原始值（无 value/expire_at 包裹）
- 异常处理：数据库异常返回 success=False

被测源码：qqbat_nodes/builtin/leaderboard_query.py
测试策略：使用真实 aiosqlite 临时数据库 + patch _get_connection，
避免触达生产持久化数据库。
"""
import json
import time
from unittest.mock import patch

import aiosqlite
import pytest

from qqbat_nodes.builtin.leaderboard_query import leaderboard_query


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

async def _make_test_db(rows):
    """创建临时 aiosqlite 数据库，预置 _persistent 表与 rows 数据。

    Args:
        rows: list of tuple (key, value, scope, qq, updated_at)

    Returns:
        (db_conn, db_path) — 调用方负责关闭 db_conn
    """
    db_path = ':memory:'  # 内存数据库，测试结束自动释放
    db = await aiosqlite.connect(db_path)
    db.row_factory = aiosqlite.Row
    await db.execute("""
        CREATE TABLE _persistent (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'user',
            qq TEXT,
            updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
        )
    """)
    for row in rows:
        await db.execute(
            "INSERT INTO _persistent (key, value, scope, qq, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            row,
        )
    await db.commit()
    return db


def _wrap_value(value, expire_at=None):
    """按生产格式包裹 value：{"value": ..., "expire_at": ...}。"""
    return json.dumps({"value": value, "expire_at": expire_at}, ensure_ascii=False)


# ===========================================================================
# 参数校验
# ===========================================================================

class TestParameterValidation:
    """验证 key/scope/sort/value_type/limit 等参数校验。"""

    @pytest.mark.asyncio
    async def test_empty_key_returns_error(self, mock_bot, mock_event):
        """空 key 返回 success=False + 'key 不能为空'。"""
        result = await leaderboard_query(mock_bot, mock_event, key='')
        assert result['success'] is False
        assert result['rankings'] == []
        assert result['count'] == 0
        assert result['text'] == ''
        assert 'key' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_scope_returns_error(self, mock_bot, mock_event):
        """非法 scope 返回 success=False + 错误信息。"""
        result = await leaderboard_query(
            mock_bot, mock_event, key='level', scope='global',
        )
        assert result['success'] is False
        assert 'scope' in result['error']
        assert 'global' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_sort_returns_error(self, mock_bot, mock_event):
        """非法 sort 返回 success=False + 错误信息。"""
        result = await leaderboard_query(
            mock_bot, mock_event, key='level', sort='random',
        )
        assert result['success'] is False
        assert 'sort' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_value_type_returns_error(self, mock_bot, mock_event):
        """非法 value_type 返回 success=False + 错误信息。"""
        result = await leaderboard_query(
            mock_bot, mock_event, key='level', value_type='boolean',
        )
        assert result['success'] is False
        assert 'value_type' in result['error']

    @pytest.mark.asyncio
    async def test_limit_invalid_falls_back_to_default(self, mock_bot, mock_event):
        """limit 非数值时回退到默认 10。"""
        db = await _make_test_db([])
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                # limit='abc' 应回退到 10
                result = await leaderboard_query(
                    mock_bot, mock_event, key='level', limit='abc',
                )
            assert result['success'] is True
            assert result['count'] == 0
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_limit_none_falls_back_to_default(self, mock_bot, mock_event):
        """limit=None 时回退到默认 10。"""
        db = await _make_test_db([])
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='level', limit=None,
                )
            assert result['success'] is True
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_limit_zero_clamped_to_one(self, mock_bot, mock_event):
        """limit=0 被 clamp 到 1。"""
        rows = [
            (f'user_111:level', _wrap_value(50), 'user', '111', '2026-07-06'),
            (f'user_222:level', _wrap_value(80), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='level', limit=0,
                )
            assert result['success'] is True
            assert result['count'] == 1
            # 第一名应为最高分 80
            assert result['rankings'][0]['value'] == 80
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_limit_negative_clamped_to_one(self, mock_bot, mock_event):
        """limit=-5 被 clamp 到 1。"""
        rows = [
            (f'user_111:level', _wrap_value(50), 'user', '111', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='level', limit=-5,
                )
            assert result['success'] is True
            assert result['count'] == 1
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_limit_above_max_clamped_to_100(self, mock_bot, mock_event):
        """limit=200 被 clamp 到 100。"""
        rows = [
            (f'user_111:level', _wrap_value(50), 'user', '111', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='level', limit=200,
                )
            assert result['success'] is True
            # 数据量只有 1 条，故 count=1；但 limit 应已被 clamp 到 100，不会报错
            assert result['count'] == 1
        finally:
            await db.close()


# ===========================================================================
# 正常查询路径
# ===========================================================================

class TestNormalQuery:
    """验证数值/字符串、降序/升序、limit 截断等正常路径。"""

    @pytest.mark.asyncio
    async def test_number_desc_sort(self, mock_bot, mock_event):
        """数值降序：大值在前。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
            ('user_333:exp', _wrap_value(300), 'user', '333', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', sort='desc',
                )
            assert result['success'] is True
            assert result['count'] == 3
            # 降序：500 > 300 > 100
            assert result['rankings'][0]['value'] == 500
            assert result['rankings'][0]['rank'] == 1
            assert result['rankings'][0]['qq'] == '222'
            assert result['rankings'][1]['value'] == 300
            assert result['rankings'][2]['value'] == 100
            # text 输出含全部排名
            assert '排行榜' in result['text']
            assert 'QQ222' in result['text']
            assert '500' in result['text']
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_number_asc_sort(self, mock_bot, mock_event):
        """数值升序：小值在前。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
            ('user_333:exp', _wrap_value(300), 'user', '333', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', sort='asc',
                )
            assert result['success'] is True
            # 升序：100 < 300 < 500
            assert result['rankings'][0]['value'] == 100
            assert result['rankings'][1]['value'] == 300
            assert result['rankings'][2]['value'] == 500
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_string_sort_desc(self, mock_bot, mock_event):
        """字符串降序：按字典序倒序。"""
        rows = [
            ('user_111:name', _wrap_value('alice'), 'user', '111', '2026-07-06'),
            ('user_222:name', _wrap_value('bob'), 'user', '222', '2026-07-06'),
            ('user_333:name', _wrap_value('carol'), 'user', '333', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='name',
                    value_type='string', sort='desc',
                )
            assert result['success'] is True
            # 字典序倒序：alice < bob < carol，倒序为 carol > bob > alice
            assert result['rankings'][0]['value'] == 'carol'
            assert result['rankings'][1]['value'] == 'bob'
            assert result['rankings'][2]['value'] == 'alice'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_limit_truncation(self, mock_bot, mock_event):
        """limit=2 截断到前 2 名，rank 字段从 1 开始。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
            ('user_333:exp', _wrap_value(300), 'user', '333', '2026-07-06'),
            ('user_444:exp', _wrap_value(800), 'user', '444', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', sort='desc', limit=2,
                )
            assert result['success'] is True
            assert result['count'] == 2
            # 降序前 2 名：800, 500
            assert result['rankings'][0]['value'] == 800
            assert result['rankings'][0]['rank'] == 1
            assert result['rankings'][1]['value'] == 500
            assert result['rankings'][1]['rank'] == 2
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_empty_result_returns_default_text(self, mock_bot, mock_event):
        """空结果：rankings=[], count=0, text 含默认空提示。"""
        db = await _make_test_db([])
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            assert result['rankings'] == []
            assert result['count'] == 0
            assert '暂无排行数据' in result['text']
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_custom_title_and_value_label(self, mock_bot, mock_event):
        """自定义 title/value_label/empty_hint 影响 text 输出。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                    title='🏆 修为排行榜', value_label='修为',
                )
            assert result['success'] is True
            text = result['text']
            assert '🏆 修为排行榜' in text
            assert '修为' in text
            assert 'QQ111' in text
            # 验证不出现 key 名 'exp'
            assert 'exp' not in text
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_custom_empty_hint(self, mock_bot, mock_event):
        """空数据时使用自定义 empty_hint。"""
        db = await _make_test_db([])
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                    title='🏆 修为排行榜',
                    empty_hint='快去 /修炼 成为第一人！',
                )
            assert result['success'] is True
            assert '快去 /修炼 成为第一人！' in result['text']
            assert '🏆 修为排行榜' in result['text']
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_default_header_when_no_title(self, mock_bot, mock_event):
        """未提供 title 时使用默认标题 '排行榜（{label}）'。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            # 默认 header 含 '排行榜' 与 key 名 'exp'
            assert '排行榜' in result['text']
            assert 'exp' in result['text']
        finally:
            await db.close()


# ===========================================================================
# 数据过滤
# ===========================================================================

class TestDataFiltering:
    """验证过期数据/None 值/旧格式数据的过滤行为。"""

    @pytest.mark.asyncio
    async def test_expired_data_skipped(self, mock_bot, mock_event):
        """已过期数据被跳过，不参与排序。"""
        expired_at = time.time() - 3600  # 1 小时前已过期
        rows = [
            ('user_111:exp', _wrap_value(100, expire_at=expired_at), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            # 111 已过期，只剩 222
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == '222'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_non_expired_data_included(self, mock_bot, mock_event):
        """未过期数据（expire_at 在未来）正常参与排序。"""
        future_at = time.time() + 3600  # 1 小时后才过期
        rows = [
            ('user_111:exp', _wrap_value(100, expire_at=future_at), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500, expire_at=future_at), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            assert result['count'] == 2
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_none_value_in_payload_skipped(self, mock_bot, mock_event):
        """新格式 value=null 时被跳过。"""
        rows = [
            ('user_111:exp', _wrap_value(None), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            # 111 的 value 为 None，被跳过
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == '222'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_legacy_format_direct_value(self, mock_bot, mock_event):
        """旧格式数据（直接存储原始值，无 value/expire_at 包裹）正常参与排序。"""
        rows = [
            # 旧格式：直接存 JSON 字符串 "100"（不是 {"value":...,"expire_at":...}）
            ('user_111:exp', json.dumps(100), 'user', '111', '2026-07-06'),
            ('user_222:exp', json.dumps(500), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            assert result['count'] == 2
            # 降序：500 在前
            assert result['rankings'][0]['value'] == 500
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_legacy_format_none_value_skipped(self, mock_bot, mock_event):
        """旧格式 value=null（JSON null）被跳过。"""
        rows = [
            # 旧格式：JSON null
            ('user_111:exp', json.dumps(None), 'user', '111', '2026-07-06'),
            ('user_222:exp', json.dumps(500), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            # 111 的旧格式 None 被跳过
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == '222'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_invalid_json_treated_as_raw_string(self, mock_bot, mock_event):
        """非 JSON 字符串（解析失败）当作原始字符串值，参与字符串排序。"""
        rows = [
            ('user_111:exp', 'not_a_json', 'user', '111', '2026-07-06'),
            ('user_222:exp', 'also_not_json', 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                    value_type='string', sort='desc',
                )
            assert result['success'] is True
            assert result['count'] == 2
            # 字典序倒序：'not_a_json' > 'also_not_json'
            assert result['rankings'][0]['value'] == 'not_a_json'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_qq_null_skipped(self, mock_bot, mock_event):
        """qq 字段为 NULL 的记录被跳过（防御性，正常不会出现）。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', None, '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            # 111 的 qq 为 NULL，被跳过
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == '222'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_only_matching_key_suffix_included(self, mock_bot, mock_event):
        """LIKE '%:exp' 仅匹配后缀，不误匹配 'expert'。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('user_222:expert', _wrap_value(500), 'user', '222', '2026-07-06'),
            ('user_333:exp', _wrap_value(300), 'user', '333', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['success'] is True
            # 仅匹配 user_111:exp 和 user_333:exp，不匹配 user_222:expert
            assert result['count'] == 2
            qqs = {r['qq'] for r in result['rankings']}
            assert qqs == {'111', '333'}
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_special_chars_in_key_escaped(self, mock_bot, mock_event):
        """key 含 % 和 _ 时通过 ESCAPE 子句正确转义。"""
        # key 'a_b%c' 应匹配 'user_111:a_b%c'，但不应误匹配 'user_222:axbxc'
        # （因 _ 被转义为字面量，% 也被转义为字面量）
        rows = [
            ('user_111:a_b%c', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('user_222:axbxc', _wrap_value(500), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='a_b%c',
                )
            assert result['success'] is True
            # 仅匹配字面量 'a_b%c'，不匹配 'axbxc'
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == '111'
        finally:
            await db.close()


# ===========================================================================
# scope 过滤
# ===========================================================================

class TestScopeFiltering:
    """验证 scope='user' 仅查用户排行，scope='group' 仅查群排行。"""

    @pytest.mark.asyncio
    async def test_user_scope_only(self, mock_bot, mock_event):
        """scope='user' 仅返回 user scope 的记录，不返回 group scope。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('group_999:exp', _wrap_value(999), 'group', 'group_qq', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', scope='user',
                )
            assert result['success'] is True
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == '111'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_group_scope_only(self, mock_bot, mock_event):
        """scope='group' 仅返回 group scope 的记录。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
            ('group_999:exp', _wrap_value(999), 'group', 'group_qq', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', scope='group',
                )
            assert result['success'] is True
            assert result['count'] == 1
            assert result['rankings'][0]['qq'] == 'group_qq'
        finally:
            await db.close()


# ===========================================================================
# 数值类型容错
# ===========================================================================

class TestNumberTypeTolerance:
    """验证 value_type='number' 时非数值 value 的容错处理。"""

    @pytest.mark.asyncio
    async def test_non_number_value_sorted_to_bottom(self, mock_bot, mock_event):
        """value_type='number' 时非数值 value 排到末尾（-inf）。"""
        rows = [
            ('user_111:exp', _wrap_value('not_a_number'), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(500), 'user', '222', '2026-07-06'),
            ('user_333:exp', _wrap_value(300), 'user', '333', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', sort='desc',
                )
            assert result['success'] is True
            assert result['count'] == 3
            # 降序：500 > 300 > -inf（'not_a_number'）
            assert result['rankings'][0]['value'] == 500
            assert result['rankings'][1]['value'] == 300
            assert result['rankings'][2]['value'] == 'not_a_number'
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_float_value_supported(self, mock_bot, mock_event):
        """float 类型 value 正常参与数值排序。"""
        rows = [
            ('user_111:exp', _wrap_value(100.5), 'user', '111', '2026-07-06'),
            ('user_222:exp', _wrap_value(99.9), 'user', '222', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp', sort='desc',
                )
            assert result['success'] is True
            assert result['rankings'][0]['value'] == 100.5
            assert result['rankings'][1]['value'] == 99.9
        finally:
            await db.close()


# ===========================================================================
# 异常处理
# ===========================================================================

class TestExceptionHandling:
    """验证数据库异常时返回 success=False + 错误信息。"""

    @pytest.mark.asyncio
    async def test_db_execute_raises_returns_error(self, mock_bot, mock_event):
        """_get_connection 返回的 db.execute 抛异常 → success=False。"""
        # 使用 MagicMock 模拟 db，execute 抛异常
        from unittest.mock import AsyncMock, MagicMock

        mock_db = MagicMock()
        mock_db.execute = AsyncMock(side_effect=RuntimeError("DB locked"))
        with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                   return_value=mock_db):
            result = await leaderboard_query(
                mock_bot, mock_event, key='exp',
            )
        assert result['success'] is False
        assert result['rankings'] == []
        assert result['count'] == 0
        assert result['text'] == ''
        assert 'DB locked' in result['error']

    @pytest.mark.asyncio
    async def test_get_connection_raises_returns_error(self, mock_bot, mock_event):
        """_get_connection 抛异常 → success=False。"""
        with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                   side_effect=RuntimeError("connection failed")):
            result = await leaderboard_query(
                mock_bot, mock_event, key='exp',
            )
        assert result['success'] is False
        assert result['rankings'] == []
        assert result['count'] == 0
        assert result['text'] == ''
        assert 'connection failed' in result['error']


# ===========================================================================
# 返回结构完整性
# ===========================================================================

class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_success_return_fields(self, mock_bot, mock_event):
        """成功时返回字段含 success/rankings/count/text/error。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert set(result.keys()) == {
                'success', 'rankings', 'count', 'text', 'error'
            }
            assert isinstance(result['rankings'], list)
            assert isinstance(result['count'], int)
            assert isinstance(result['text'], str)
            assert isinstance(result['error'], str)
        finally:
            await db.close()

    @pytest.mark.asyncio
    async def test_error_return_fields(self, mock_bot, mock_event):
        """失败时返回字段含 success/rankings/count/text/error。"""
        result = await leaderboard_query(mock_bot, mock_event, key='')
        assert set(result.keys()) == {
            'success', 'rankings', 'count', 'text', 'error'
        }
        assert result['success'] is False
        assert result['rankings'] == []
        assert result['count'] == 0
        assert result['text'] == ''

    @pytest.mark.asyncio
    async def test_rankings_entry_fields(self, mock_bot, mock_event):
        """每条 rankings 项含 qq/value/rank 三个字段。"""
        rows = [
            ('user_111:exp', _wrap_value(100), 'user', '111', '2026-07-06'),
        ]
        db = await _make_test_db(rows)
        try:
            with patch('qqbat_nodes.builtin.leaderboard_query._get_connection',
                       return_value=db):
                result = await leaderboard_query(
                    mock_bot, mock_event, key='exp',
                )
            assert result['count'] == 1
            entry = result['rankings'][0]
            assert set(entry.keys()) == {'qq', 'value', 'rank'}
            assert entry['qq'] == '111'
            assert entry['value'] == 100
            assert entry['rank'] == 1
        finally:
            await db.close()
