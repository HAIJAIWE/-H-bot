"""query 节点单元测试 — 批量数据查询（list/sort/filter/aggregate 4 种 mode）。

被测源码：qqbat_nodes/builtin/query.py
通过 persistent_store._save_value / _batch_save_values 写入测试数据，
再调用 query() 验证查询结果。每个测试前后清空 _persistent 表避免串扰。
"""
import json
import time
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.builtin.persistent_store import (
    _batch_save_values,
    _get_connection,
    _save_value,
)
from qqbat_nodes.builtin.query import (
    _DEFAULT_LIMIT,
    _MAX_LIMIT,
    query,
)


# ---------------------------------------------------------------------------
# 辅助函数与 fixture
# ---------------------------------------------------------------------------

def make_event(user_id=None, group_id=None):
    """构造 mock event，显式设置 user_id / group_id 属性。"""
    ev = MagicMock()
    if user_id is not None:
        ev.user_id = user_id
    if group_id is not None:
        ev.group_id = group_id
    return ev


@pytest.fixture
async def clean_db():
    """每个测试前后清空 _persistent 表，避免数据串扰。"""
    db = await _get_connection()
    await db.execute("DELETE FROM _persistent")
    await db.commit()
    yield
    await db.execute("DELETE FROM _persistent")
    await db.commit()


# ===========================================================================
# mode='list'：列出匹配 key_pattern 的所有记录
# ===========================================================================

class TestModeList:
    """验证 mode='list' 的基本列出、通配符匹配、scope 隔离。"""

    @pytest.mark.asyncio
    async def test_list_basic(self, clean_db):
        """基本列出 global scope 下所有记录。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)
        await _save_value('b', 2, scope='global', event=event)

        r = await query(event=event, mode='list', scope='global', key_pattern='*')

        assert r['error'] == ''
        assert r['count'] == 2
        keys = sorted(x['key'] for x in r['results'])
        assert keys == ['a', 'b']
        values = sorted(x['value'] for x in r['results'])
        assert values == [1, 2]

    @pytest.mark.asyncio
    async def test_list_key_pattern_wildcard(self, clean_db):
        """key_pattern='score:*' 通配符匹配 score: 前缀的 key。"""
        event = make_event()
        await _save_value('score:1', 10, scope='global', event=event)
        await _save_value('score:2', 20, scope='global', event=event)
        await _save_value('name', 'abc', scope='global', event=event)

        r = await query(event=event, mode='list', scope='global', key_pattern='score:*')

        assert r['count'] == 2
        keys = sorted(x['key'] for x in r['results'])
        assert keys == ['score:1', 'score:2']

    @pytest.mark.asyncio
    async def test_list_scope_user_isolated(self, clean_db):
        """user scope 按 user_id 隔离，不同用户互不可见。"""
        ev1 = make_event(user_id='123', group_id='')
        ev2 = make_event(user_id='456', group_id='')
        await _save_value('k', 'v1', scope='user', event=ev1)
        await _save_value('k', 'v2', scope='user', event=ev2)

        r1 = await query(event=ev1, mode='list', scope='user', key_pattern='k')
        r2 = await query(event=ev2, mode='list', scope='user', key_pattern='k')

        assert r1['count'] == 1
        assert r1['results'][0]['value'] == 'v1'
        assert r2['count'] == 1
        assert r2['results'][0]['value'] == 'v2'

    @pytest.mark.asyncio
    async def test_list_scope_group_isolated(self, clean_db):
        """group scope 按 group_id 隔离。"""
        ev1 = make_event(user_id='123', group_id='g1')
        ev2 = make_event(user_id='123', group_id='g2')
        await _save_value('k', 'g1v', scope='group', event=ev1)
        await _save_value('k', 'g2v', scope='group', event=ev2)

        r1 = await query(event=ev1, mode='list', scope='group', key_pattern='k')
        r2 = await query(event=ev2, mode='list', scope='group', key_pattern='k')

        assert r1['results'][0]['value'] == 'g1v'
        assert r2['results'][0]['value'] == 'g2v'

    @pytest.mark.asyncio
    async def test_list_scope_global_shared(self, clean_db):
        """global scope 全局共享，不同 event 都能读到。"""
        ev1 = make_event(user_id='123', group_id='')
        ev2 = make_event(user_id='456', group_id='')
        await _save_value('gk', 'gv', scope='global', event=ev1)

        r = await query(event=ev2, mode='list', scope='global', key_pattern='gk')

        assert r['count'] == 1
        assert r['results'][0]['value'] == 'gv'

    @pytest.mark.asyncio
    async def test_list_empty_result(self, clean_db):
        """无匹配数据时返回空列表。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(event=event, mode='list', scope='global', key_pattern='nonexist:*')

        assert r['count'] == 0
        assert r['results'] == []
        assert r['error'] == ''

    @pytest.mark.asyncio
    async def test_list_strip_scope_prefix(self, clean_db):
        """返回结果中的 key 已剥离 scope 前缀。"""
        event = make_event(user_id='123', group_id='')
        await _save_value('mykey', 'v', scope='user', event=event)

        r = await query(event=event, mode='list', scope='user', key_pattern='mykey')

        assert r['count'] == 1
        assert r['results'][0]['key'] == 'mykey'  # 而非 user_123:mykey


# ===========================================================================
# mode='sort'：按字段排序后返回
# ===========================================================================

class TestModeSort:
    """验证 mode='sort' 的升降序、字段排序、limit 截断。"""

    @pytest.mark.asyncio
    async def test_sort_asc(self, clean_db):
        """按 value 升序排序。"""
        event = make_event()
        await _save_value('a', 30, scope='global', event=event)
        await _save_value('b', 10, scope='global', event=event)
        await _save_value('c', 20, scope='global', event=event)

        r = await query(event=event, mode='sort', scope='global', order='asc')

        assert r['error'] == ''
        values = [x['value'] for x in r['results']]
        assert values == [10, 20, 30]

    @pytest.mark.asyncio
    async def test_sort_desc(self, clean_db):
        """按 value 降序排序。"""
        event = make_event()
        await _save_value('a', 30, scope='global', event=event)
        await _save_value('b', 10, scope='global', event=event)
        await _save_value('c', 20, scope='global', event=event)

        r = await query(event=event, mode='sort', scope='global', order='desc')

        values = [x['value'] for x in r['results']]
        assert values == [30, 20, 10]

    @pytest.mark.asyncio
    async def test_sort_by_dict_field(self, clean_db):
        """按 dict 内字段排序（sort_by='score'）。"""
        event = make_event()
        await _save_value('a', {'score': 30}, scope='global', event=event)
        await _save_value('b', {'score': 10}, scope='global', event=event)
        await _save_value('c', {'score': 20}, scope='global', event=event)

        r = await query(
            event=event, mode='sort', scope='global',
            sort_by='score', order='asc',
        )

        scores = [x['value']['score'] for x in r['results']]
        assert scores == [10, 20, 30]

    @pytest.mark.asyncio
    async def test_sort_limit_truncates(self, clean_db):
        """limit 截断排序结果。"""
        event = make_event()
        for i in range(5):
            await _save_value(f'k{i}', i, scope='global', event=event)

        r = await query(
            event=event, mode='sort', scope='global',
            order='asc', limit=3,
        )

        assert r['count'] == 3
        values = [x['value'] for x in r['results']]
        assert values == [0, 1, 2]

    @pytest.mark.asyncio
    async def test_sort_empty_list(self, clean_db):
        """空数据排序返回空列表。"""
        event = make_event()

        r = await query(event=event, mode='sort', scope='global')

        assert r['count'] == 0
        assert r['results'] == []

    @pytest.mark.asyncio
    async def test_sort_invalid_order_defaults_asc(self, clean_db):
        """非法 order 值回退为 asc。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)
        await _save_value('b', 2, scope='global', event=event)

        r = await query(
            event=event, mode='sort', scope='global', order='invalid',
        )

        assert r['error'] == ''
        values = [x['value'] for x in r['results']]
        assert values == [1, 2]  # asc 默认

    @pytest.mark.asyncio
    async def test_sort_no_internal_field_leaked(self, clean_db):
        """sort 模式输出不应泄露内部辅助字段 _sort_value。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(event=event, mode='sort', scope='global')

        assert '_sort_value' not in r['results'][0]


# ===========================================================================
# mode='filter'：按条件过滤
# ===========================================================================

class TestModeFilter:
    """验证 mode='filter' 的条件匹配、字段过滤、contains。"""

    @pytest.mark.asyncio
    async def test_filter_match_numeric(self, clean_db):
        """数值比较过滤：value > 40 命中两条。"""
        event = make_event()
        await _save_value('a', 10, scope='global', event=event)
        await _save_value('b', 50, scope='global', event=event)
        await _save_value('c', 80, scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value > 40',
        )

        assert r['error'] == ''
        assert r['count'] == 2
        values = sorted(x['value'] for x in r['results'])
        assert values == [50, 80]

    @pytest.mark.asyncio
    async def test_filter_no_match(self, clean_db):
        """过滤条件无匹配返回空。"""
        event = make_event()
        await _save_value('a', 10, scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value > 1000',
        )

        assert r['count'] == 0
        assert r['results'] == []

    @pytest.mark.asyncio
    async def test_filter_dict_field(self, clean_db):
        """dict 字段过滤：score > 50。"""
        event = make_event()
        await _save_value('a', {'score': 30}, scope='global', event=event)
        await _save_value('b', {'score': 80}, scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='score > 50',
        )

        assert r['count'] == 1
        assert r['results'][0]['value']['score'] == 80

    @pytest.mark.asyncio
    async def test_filter_empty_result(self, clean_db):
        """空数据过滤返回空。"""
        event = make_event()

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value > 0',
        )

        assert r['count'] == 0

    @pytest.mark.asyncio
    async def test_filter_empty_expr_degrades_to_list(self, clean_db):
        """filter_expr 为空时退化为 list 行为。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)
        await _save_value('b', 2, scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global', filter_expr='',
        )

        assert r['error'] == ''
        assert r['count'] == 2

    @pytest.mark.asyncio
    async def test_filter_contains_string(self, clean_db):
        """contains 操作符匹配字符串子串。"""
        event = make_event()
        await _save_value('a', 'hello world', scope='global', event=event)
        await _save_value('b', 'goodbye', scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value contains "hello"',
        )

        assert r['count'] == 1
        assert r['results'][0]['value'] == 'hello world'

    @pytest.mark.asyncio
    async def test_filter_contains_list(self, clean_db):
        """contains 操作符匹配列表元素。"""
        event = make_event()
        await _save_value('a', ['x', 'y', 'z'], scope='global', event=event)
        await _save_value('b', ['p', 'q'], scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value contains "y"',
        )

        assert r['count'] == 1
        assert r['results'][0]['key'] == 'a'

    @pytest.mark.asyncio
    async def test_filter_equals_string(self, clean_db):
        """== 操作符匹配字符串相等。"""
        event = make_event()
        await _save_value('a', 'abc', scope='global', event=event)
        await _save_value('b', 'def', scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr="value == 'abc'",
        )

        assert r['count'] == 1
        assert r['results'][0]['value'] == 'abc'

    @pytest.mark.asyncio
    async def test_filter_not_equal(self, clean_db):
        """!= 操作符过滤不等记录。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)
        await _save_value('b', 2, scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value != 1',
        )

        assert r['count'] == 1
        assert r['results'][0]['value'] == 2


# ===========================================================================
# mode='aggregate'：聚合统计 count/sum/avg
# ===========================================================================

class TestModeAggregate:
    """验证 mode='aggregate' 的 count/sum/avg 聚合。"""

    @pytest.mark.asyncio
    async def test_aggregate_count(self, clean_db):
        """count 返回记录总数。"""
        event = make_event()
        await _save_value('a', 10, scope='global', event=event)
        await _save_value('b', 20, scope='global', event=event)
        await _save_value('c', 30, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='count',
        )

        assert r['error'] == ''
        assert r['count'] == 3
        assert r['results'][0]['func'] == 'count'
        assert r['results'][0]['value'] == 3
        assert r['results'][0]['field'] == 'value'

    @pytest.mark.asyncio
    async def test_aggregate_sum(self, clean_db):
        """sum 返回数值总和。"""
        event = make_event()
        await _save_value('a', 10, scope='global', event=event)
        await _save_value('b', 20, scope='global', event=event)
        await _save_value('c', 30, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='sum',
        )

        assert r['results'][0]['value'] == 60

    @pytest.mark.asyncio
    async def test_aggregate_avg(self, clean_db):
        """avg 返回数值平均。"""
        event = make_event()
        await _save_value('a', 10, scope='global', event=event)
        await _save_value('b', 20, scope='global', event=event)
        await _save_value('c', 30, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='avg',
        )

        assert r['results'][0]['value'] == 20

    @pytest.mark.asyncio
    async def test_aggregate_empty_count(self, clean_db):
        """空数据 count 返回 0。"""
        event = make_event()

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='count',
        )

        assert r['count'] == 0
        assert r['results'][0]['value'] == 0

    @pytest.mark.asyncio
    async def test_aggregate_empty_sum(self, clean_db):
        """空数据 sum 返回 0。"""
        event = make_event()

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='sum',
        )

        assert r['results'][0]['value'] == 0

    @pytest.mark.asyncio
    async def test_aggregate_empty_avg(self, clean_db):
        """空数据 avg 返回 0（避免除零）。"""
        event = make_event()

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='avg',
        )

        assert r['results'][0]['value'] == 0

    @pytest.mark.asyncio
    async def test_aggregate_dict_field_sum(self, clean_db):
        """按 dict 字段聚合 sum（sort_by='score'）。"""
        event = make_event()
        await _save_value('a', {'score': 10}, scope='global', event=event)
        await _save_value('b', {'score': 20}, scope='global', event=event)
        await _save_value('c', {'score': 30}, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='sum', sort_by='score',
        )

        assert r['results'][0]['value'] == 60
        assert r['results'][0]['field'] == 'score'

    @pytest.mark.asyncio
    async def test_aggregate_skips_bool_values(self, clean_db):
        """sum/avg 聚合跳过 bool 值（bool 是 int 子类但不应参与数值聚合）。"""
        event = make_event()
        await _save_value('a', True, scope='global', event=event)
        await _save_value('b', 10, scope='global', event=event)
        await _save_value('c', 20, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='sum',
        )

        # 仅 10 + 20 = 30，跳过 True
        assert r['results'][0]['value'] == 30
        # count 仍统计所有记录
        assert r['count'] == 3

    @pytest.mark.asyncio
    async def test_aggregate_count_field_label(self, clean_db):
        """count 模式下 field 标签为 sort_by 或 'value'。"""
        event = make_event()
        await _save_value('a', {'x': 1}, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='count', sort_by='x',
        )

        assert r['results'][0]['field'] == 'x'


# ===========================================================================
# 边界情况：无数据、limit 上限/默认、过期记录
# ===========================================================================

class TestBoundary:
    """验证边界条件与 limit 参数处理。"""

    @pytest.mark.asyncio
    async def test_no_data_list(self, clean_db):
        """无数据时 list 返回空。"""
        event = make_event()
        r = await query(event=event, mode='list', scope='global')
        assert r['count'] == 0
        assert r['results'] == []

    @pytest.mark.asyncio
    async def test_no_data_sort(self, clean_db):
        """无数据时 sort 返回空。"""
        event = make_event()
        r = await query(event=event, mode='sort', scope='global')
        assert r['count'] == 0
        assert r['results'] == []

    @pytest.mark.asyncio
    async def test_no_data_filter(self, clean_db):
        """无数据时 filter 返回空。"""
        event = make_event()
        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='value > 0',
        )
        assert r['count'] == 0

    @pytest.mark.asyncio
    async def test_no_data_aggregate(self, clean_db):
        """无数据时 aggregate 返回聚合零值。"""
        event = make_event()
        r = await query(event=event, mode='aggregate', scope='global')
        assert r['count'] == 0
        assert r['results'][0]['value'] == 0

    @pytest.mark.asyncio
    async def test_limit_takes_effect(self, clean_db):
        """limit 生效：5 条数据 limit=3 返回 3 条。"""
        event = make_event()
        for i in range(5):
            await _save_value(f'k{i}', i, scope='global', event=event)

        r = await query(
            event=event, mode='list', scope='global', key_pattern='k*', limit=3,
        )

        assert r['count'] == 3

    @pytest.mark.asyncio
    async def test_limit_default_value(self, clean_db):
        """limit 默认值 1000：1100 条数据不传 limit 返回 1000 条。"""
        event = make_event(user_id='123', group_id='')
        data = {f'k{i}': i for i in range(1100)}
        await _batch_save_values(data, scope='user', event=event)

        r = await query(
            event=event, mode='list', scope='user', key_pattern='k*',
        )

        assert r['count'] == _DEFAULT_LIMIT
        assert r['error'] == ''

    @pytest.mark.asyncio
    async def test_limit_max_capped(self, clean_db):
        """limit 超过 10000 被截断到 10000。"""
        event = make_event(user_id='123', group_id='')
        data = {f'k{i}': i for i in range(11000)}
        await _batch_save_values(data, scope='user', event=event)

        r = await query(
            event=event, mode='list', scope='user', key_pattern='k*',
            limit=99999,
        )

        assert r['count'] == _MAX_LIMIT

    @pytest.mark.asyncio
    async def test_limit_zero_falls_back(self, clean_db):
        """limit=0 回退默认值（5 条数据全部返回）。"""
        event = make_event()
        for i in range(5):
            await _save_value(f'k{i}', i, scope='global', event=event)

        r = await query(
            event=event, mode='list', scope='global', key_pattern='k*', limit=0,
        )

        assert r['count'] == 5  # 5 < 1000，全部返回

    @pytest.mark.asyncio
    async def test_limit_negative_falls_back(self, clean_db):
        """limit=-1 回退默认值。"""
        event = make_event()
        for i in range(3):
            await _save_value(f'k{i}', i, scope='global', event=event)

        r = await query(
            event=event, mode='list', scope='global', key_pattern='k*', limit=-1,
        )

        assert r['count'] == 3

    @pytest.mark.asyncio
    async def test_limit_invalid_type_falls_back(self, clean_db):
        """limit 为非数值字符串回退默认值。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(
            event=event, mode='list', scope='global', key_pattern='*', limit='abc',
        )

        assert r['error'] == ''
        assert r['count'] == 1

    @pytest.mark.asyncio
    async def test_expired_records_skipped(self, clean_db):
        """已过期记录在查询时被跳过。"""
        event = make_event()
        # 正常记录
        await _save_value('live', 1, scope='global', event=event)
        # 手工写入一条已过期记录（expire_at 为过去时间）
        db = await _get_connection()
        expired_payload = json.dumps(
            {"value": "old", "expire_at": time.time() - 100}
        )
        await db.execute(
            "INSERT INTO _persistent (key, value, scope) VALUES (?, ?, 'global')",
            ("expired", expired_payload),
        )
        await db.commit()

        r = await query(event=event, mode='list', scope='global', key_pattern='*')

        assert r['count'] == 1
        assert r['results'][0]['key'] == 'live'

    @pytest.mark.asyncio
    async def test_default_mode_is_list(self, clean_db):
        """不传 mode 默认为 list。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(event=event, scope='global')

        assert r['error'] == ''
        assert r['count'] == 1

    @pytest.mark.asyncio
    async def test_mode_case_insensitive(self, clean_db):
        """mode 大小写不敏感（LIST 等价 list）。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(event=event, mode='LIST', scope='global')

        assert r['error'] == ''
        assert r['count'] == 1


# ===========================================================================
# 错误处理：无效 mode/scope/filter_expr/aggregate_func
# ===========================================================================

class TestErrorHandling:
    """验证参数校验与错误返回。"""

    @pytest.mark.asyncio
    async def test_invalid_mode(self, clean_db):
        """无效 mode 返回错误。"""
        event = make_event()
        r = await query(event=event, mode='invalid_mode', scope='global')
        assert r['error'] != ''
        assert 'mode' in r['error']
        assert r['count'] == 0

    @pytest.mark.asyncio
    async def test_invalid_scope(self, clean_db):
        """无效 scope 返回错误。"""
        event = make_event()
        r = await query(event=event, mode='list', scope='invalid_scope')
        assert r['error'] != ''
        assert 'scope' in r['error']

    @pytest.mark.asyncio
    async def test_invalid_filter_expr(self, clean_db):
        """无效 filter_expr（缺少操作符）返回错误。"""
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(
            event=event, mode='filter', scope='global',
            filter_expr='invalid_no_operator',
        )

        assert r['error'] != ''
        assert 'filter_expr' in r['error']

    @pytest.mark.asyncio
    async def test_invalid_aggregate_func(self, clean_db):
        """无效 aggregate_func（如 max/min）返回错误。

        注：源码仅支持 count/sum/avg，不支持 max/min。
        """
        event = make_event()
        await _save_value('a', 1, scope='global', event=event)

        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='max',
        )

        assert r['error'] != ''
        assert 'aggregate_func' in r['error']

    @pytest.mark.asyncio
    async def test_aggregate_func_median_rejected(self, clean_db):
        """aggregate_func='median' 也应被拒绝。"""
        event = make_event()
        r = await query(
            event=event, mode='aggregate', scope='global',
            aggregate_func='median',
        )
        assert r['error'] != ''

    @pytest.mark.asyncio
    async def test_user_scope_missing_event_user_id(self, clean_db):
        """user scope 但 event 无 user_id 时返回错误。"""
        event = make_event(user_id='', group_id='')
        r = await query(event=event, mode='list', scope='user', key_pattern='*')
        assert r['error'] != ''

    @pytest.mark.asyncio
    async def test_group_scope_missing_event_group_id(self, clean_db):
        """group scope 但 event 无 group_id 时返回错误。"""
        event = make_event(user_id='123', group_id='')
        r = await query(event=event, mode='list', scope='group', key_pattern='*')
        assert r['error'] != ''

    @pytest.mark.asyncio
    async def test_return_structure_on_error(self, clean_db):
        """错误时返回结构含 results/count/error 三个键。"""
        event = make_event()
        r = await query(event=event, mode='invalid', scope='global')
        assert set(r.keys()) == {'results', 'count', 'error'}
        assert r['results'] == []
        assert r['count'] == 0
