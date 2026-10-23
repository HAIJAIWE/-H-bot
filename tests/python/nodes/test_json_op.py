"""json_op 节点单元测试。

覆盖：
- _dot_path_lookup 辅助函数：$/$. 前缀/嵌套 dict/列表正负索引/越界/缺失 key
- get 模式：字符串与 dict source/空 key/嵌套路径/列表索引/高级 JSONPath 回退/非法 JSON
- set 模式：基本设置/嵌套路径/空 key/路径非对象/JSON 值解析/非 JSON 值/source 非 dict/source 非法类型
- delete 模式：基本删除/嵌套删除/缺失 key/空 key/source 非 dict
- merge 模式：JSON 字符串/dict/非 dict 值不合并/JSON 数组不合并/source 非 dict
- 未知模式：回退到 set 逻辑

注：当前环境未安装 jsonpath_ng，高级 JSONPath 表达式会回退到点号查找。

被测源码：qqbat_nodes/builtin/json_op.py
"""
import json

import pytest

from qqbat_nodes.builtin.json_op import json_op, _dot_path_lookup


# =============================================================================
# _dot_path_lookup 辅助函数
# =============================================================================
class TestDotPathLookup:
    """验证 _dot_path_lookup 辅助函数。"""

    def test_dollar_dot_prefix(self):
        """$.a 前缀去除后查找。"""
        assert _dot_path_lookup({'a': 1}, '$.a') == 1

    def test_single_dollar_prefix(self):
        """$a 单 $ 前缀去除后查找。"""
        assert _dot_path_lookup({'a': 1}, '$a') == 1

    def test_nested_dict(self):
        """嵌套 dict 点号路径。"""
        assert _dot_path_lookup({'a': {'b': {'c': 42}}}, 'a.b.c') == 42

    def test_list_positive_index(self):
        """列表正索引（路径形如 list.0）。"""
        assert _dot_path_lookup({'list': [10, 20]}, '$.list.0') == 10

    def test_list_negative_index(self):
        """列表负索引（路径形如 list.-1）。"""
        assert _dot_path_lookup({'list': [10, 20, 30]}, '$.list.-1') == 30

    def test_list_index_out_of_range(self):
        """越界索引返回 None。"""
        assert _dot_path_lookup({'list': [10, 20]}, '$.list.5') is None

    def test_missing_key_returns_none(self):
        """不存在的 key 返回 None。"""
        assert _dot_path_lookup({'a': 1}, 'b') is None


# =============================================================================
# get 模式
# =============================================================================
class TestGetMode:
    """验证 get 模式提取字段。"""

    @pytest.mark.asyncio
    async def test_string_source(self, mock_bot, mock_event):
        """JSON 字符串 source 解析后提取。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source='{"name": "alice", "age": 18}', key='$.name',
        )
        assert result['result'] == 'alice'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_source(self, mock_bot, mock_event):
        """dict 直传 source。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source={'name': 'bob'}, key='name',
        )
        assert result['result'] == 'bob'

    @pytest.mark.asyncio
    async def test_empty_key_returns_parsed(self, mock_bot, mock_event):
        """key 为空时返回解析后的整个对象。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source='{"a": 1}', key='',
        )
        assert result['result'] == {'a': 1}

    @pytest.mark.asyncio
    async def test_nested_dot_path(self, mock_bot, mock_event):
        """嵌套点号路径提取。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source='{"a": {"b": {"c": 99}}}', key='$.a.b.c',
        )
        assert result['result'] == 99

    @pytest.mark.asyncio
    async def test_list_index_via_dot_path(self, mock_bot, mock_event):
        """点号路径访问列表元素。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source='{"items": [10, 20, 30]}', key='$.items.1',
        )
        assert result['result'] == 20

    @pytest.mark.asyncio
    async def test_advanced_jsonpath_falls_back(self, mock_bot, mock_event):
        """高级 JSONPath ($.list[0]) 在 jsonpath_ng 缺失时回退点号查找。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source='{"list": [10, 20]}', key='$.list[0]',
        )
        try:
            import jsonpath_ng  # noqa: F401
            # jsonpath_ng 可用：应返回 10
            assert result['result'] == 10
        except ImportError:
            # jsonpath_ng 不可用：回退点号查找，'list[0]' 作为整体 key 查不到 → None
            assert result['result'] is None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_invalid_json_source_returns_error(self, mock_bot, mock_event):
        """非法 JSON 字符串 source 返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='get',
            source='not json', key='$.a',
        )
        assert result['error'] != ''
        assert result['result'] is None


# =============================================================================
# set 模式
# =============================================================================
class TestSetMode:
    """验证 set 模式设置字段值。"""

    @pytest.mark.asyncio
    async def test_basic_set_on_string_source(self, mock_bot, mock_event):
        """字符串 source 上设置顶层字段（JSON 数字 value 被解析为 int）。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='{"a": 1}', key='b', value='2',
        )
        assert json.loads(result['result']) == {'a': 1, 'b': 2}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_set_on_dict_source(self, mock_bot, mock_event):
        """dict source 上设置字段（JSON 数字 value 被解析为 int）。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source={'a': 1}, key='b', value='3',
        )
        assert json.loads(result['result']) == {'a': 1, 'b': 3}

    @pytest.mark.asyncio
    async def test_nested_path_set(self, mock_bot, mock_event):
        """嵌套路径设置深层字段（JSON 数字 value 被解析为 int）。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='{"a": {"b": {}}}', key='a.b.c', value='42',
        )
        assert json.loads(result['result']) == {'a': {'b': {'c': 42}}}

    @pytest.mark.asyncio
    async def test_empty_key_returns_error(self, mock_bot, mock_event):
        """空 key 返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='{"a": 1}', key='', value='1',
        )
        assert 'key' in result['error']

    @pytest.mark.asyncio
    async def test_path_through_non_object_returns_error(self, mock_bot, mock_event):
        """路径中间节点非对象时返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='{"a": 1}', key='a.b.c', value='1',
        )
        assert '不是对象' in result['error']

    @pytest.mark.asyncio
    async def test_json_value_parsed(self, mock_bot, mock_event):
        """JSON 字符串 value 被解析为对象/列表。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='{}', key='data', value='{"x": 1}',
        )
        assert json.loads(result['result']) == {'data': {'x': 1}}

    @pytest.mark.asyncio
    async def test_non_json_value_kept_as_string(self, mock_bot, mock_event):
        """非 JSON 字符串 value 保持原字符串。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='{}', key='msg', value='hello world',
        )
        assert json.loads(result['result']) == {'msg': 'hello world'}

    @pytest.mark.asyncio
    async def test_source_not_dict_returns_error(self, mock_bot, mock_event):
        """source 为 JSON 数组时返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source='[1,2,3]', key='a', value='1',
        )
        assert '不是 JSON 对象' in result['error']

    @pytest.mark.asyncio
    async def test_source_invalid_type_returns_error(self, mock_bot, mock_event):
        """source 为 None 等非法类型返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='set',
            source=None, key='a', value='1',
        )
        assert 'source' in result['error']


# =============================================================================
# delete 模式
# =============================================================================
class TestDeleteMode:
    """验证 delete 模式删除字段。"""

    @pytest.mark.asyncio
    async def test_basic_delete(self, mock_bot, mock_event):
        """删除顶层字段。"""
        result = await json_op(
            mock_bot, mock_event, mode='delete',
            source='{"a": 1, "b": 2}', key='a',
        )
        assert json.loads(result['result']) == {'b': 2}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_nested_delete(self, mock_bot, mock_event):
        """删除嵌套字段。"""
        result = await json_op(
            mock_bot, mock_event, mode='delete',
            source='{"a": {"b": 1, "c": 2}}', key='a.b',
        )
        assert json.loads(result['result']) == {'a': {'c': 2}}

    @pytest.mark.asyncio
    async def test_missing_key_no_error(self, mock_bot, mock_event):
        """删除不存在的 key 不报错，原样返回。"""
        result = await json_op(
            mock_bot, mock_event, mode='delete',
            source='{"a": 1}', key='nonexistent',
        )
        assert json.loads(result['result']) == {'a': 1}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_key_returns_unchanged(self, mock_bot, mock_event):
        """空 key 时原样返回（不删除任何字段）。"""
        result = await json_op(
            mock_bot, mock_event, mode='delete',
            source='{"a": 1}', key='',
        )
        assert json.loads(result['result']) == {'a': 1}

    @pytest.mark.asyncio
    async def test_source_not_dict_returns_error(self, mock_bot, mock_event):
        """source 为 JSON 数组时返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='delete',
            source='[1,2,3]', key='a',
        )
        assert '不是 JSON 对象' in result['error']


# =============================================================================
# merge 模式
# =============================================================================
class TestMergeMode:
    """验证 merge 模式合并 JSON。"""

    @pytest.mark.asyncio
    async def test_merge_json_string(self, mock_bot, mock_event):
        """JSON 字符串 value 合并进 source。"""
        result = await json_op(
            mock_bot, mock_event, mode='merge',
            source='{"a": 1}', value='{"b": 2}',
        )
        assert json.loads(result['result']) == {'a': 1, 'b': 2}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_merge_dict_value(self, mock_bot, mock_event):
        """dict value 合并。"""
        result = await json_op(
            mock_bot, mock_event, mode='merge',
            source={'a': 1}, value={'b': 2},
        )
        assert json.loads(result['result']) == {'a': 1, 'b': 2}

    @pytest.mark.asyncio
    async def test_non_dict_value_not_merged(self, mock_bot, mock_event):
        """非 dict value（如普通字符串）不合并，原样返回 source。"""
        result = await json_op(
            mock_bot, mock_event, mode='merge',
            source='{"a": 1}', value='hello',
        )
        assert json.loads(result['result']) == {'a': 1}

    @pytest.mark.asyncio
    async def test_json_list_value_not_merged(self, mock_bot, mock_event):
        """JSON 数组 value 不合并（非 dict）。"""
        result = await json_op(
            mock_bot, mock_event, mode='merge',
            source='{"a": 1}', value='[1,2,3]',
        )
        assert json.loads(result['result']) == {'a': 1}

    @pytest.mark.asyncio
    async def test_source_not_dict_returns_error(self, mock_bot, mock_event):
        """source 为 JSON 数组时返回错误。"""
        result = await json_op(
            mock_bot, mock_event, mode='merge',
            source='[1,2]', value='{"a":1}',
        )
        assert '不是 JSON 对象' in result['error']


# =============================================================================
# 未知模式
# =============================================================================
class TestUnknownMode:
    """验证未知模式行为（未被显式拦截，落入 set 逻辑）。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_falls_through_to_set(self, mock_bot, mock_event):
        """未知 mode 在合法 source/key 下回退执行 set 逻辑。"""
        result = await json_op(
            mock_bot, mock_event, mode='frobnicate',
            source='{"a": 1}', key='b', value='2',
        )
        assert json.loads(result['result']) == {'a': 1, 'b': 2}
