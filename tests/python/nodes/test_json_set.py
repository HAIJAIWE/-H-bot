"""json_set 节点单元测试。

覆盖：
- set 模式：基础设值 / 嵌套路径 / JSON 值 / 标量值 / 空值 / 空 key / 路径非对象
- delete 模式：删除字段 / 嵌套删除 / 不存在 key / 空 key / 中途路径缺失
- merge 模式：合并 dict / 非_dict 值 / 非法 JSON / 空值
- 源类型：JSON 字符串 / dict 直传 / 空字符串 / list 源（非法）/ 非法类型
- mode 大小写兼容 / 默认 mode

被测源码：qqbat_nodes/builtin/json_set.py
"""
import json

import pytest

from qqbat_nodes.builtin.json_set import json_set


# =============================================================================
# set 模式
# =============================================================================
class TestSetMode:
    """验证 mode='set' 的字段设置逻辑。"""

    @pytest.mark.asyncio
    async def test_set_simple_key_with_json_string_value(self, mock_bot, mock_event):
        """set 模式：JSON 字符串 value 被解析为对应类型。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='name', value='"alice"',
        )
        data = json.loads(result['result'])
        assert data['name'] == 'alice'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_set_numeric_value(self, mock_bot, mock_event):
        """set 模式：数字 JSON 字符串被解析为 int。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='age', value='42',
        )
        data = json.loads(result['result'])
        assert data['age'] == 42

    @pytest.mark.asyncio
    async def test_set_dict_value(self, mock_bot, mock_event):
        """set 模式：dict JSON 字符串被解析为 dict。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='stats',
            value='{"hp": 100, "mp": 50}',
        )
        data = json.loads(result['result'])
        assert data['stats'] == {"hp": 100, "mp": 50}

    @pytest.mark.asyncio
    async def test_set_plain_string_value(self, mock_bot, mock_event):
        """set 模式：非 JSON 字符串 value 原样存为字符串。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='msg', value='hello world',
        )
        data = json.loads(result['result'])
        assert data['msg'] == 'hello world'

    @pytest.mark.asyncio
    async def test_set_empty_string_value(self, mock_bot, mock_event):
        """set 模式：value 为空字符串时原样存为 ''。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='empty', value='',
        )
        data = json.loads(result['result'])
        assert data['empty'] == ''

    @pytest.mark.asyncio
    async def test_set_nested_path_missing_parent_returns_error(self, mock_bot, mock_event):
        """set 模式：点号路径父对象不存在时返回错误（不自动创建中间对象）。

        源码逻辑：current.get('user')=None 不是 dict → 返回 '路径 user 不是对象'。
        """
        result = await json_set(
            mock_bot, mock_event, source='{}', key='user.name', value='"bob"',
        )
        assert '路径 user 不是对象' in result['error']

    @pytest.mark.asyncio
    async def test_set_nested_path_existing_parent(self, mock_bot, mock_event):
        """set 模式：已存在父对象时深入设值。"""
        result = await json_set(
            mock_bot, mock_event, source='{"user": {"name": "old"}}',
            key='user.age', value='25',
        )
        data = json.loads(result['result'])
        assert data['user']['age'] == 25
        assert data['user']['name'] == 'old'

    @pytest.mark.asyncio
    async def test_set_empty_key_returns_error(self, mock_bot, mock_event):
        """set 模式：key 为空返回 'key 为空' 错误。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='', value='"x"',
        )
        assert result['error'] == 'key 为空'
        # result 仍为原 JSON
        assert json.loads(result['result']) == {}

    @pytest.mark.asyncio
    async def test_set_path_through_scalar_returns_error(self, mock_bot, mock_event):
        """set 模式：路径中途遇到非对象时返回错误。

        source={"a": 1}，key='a.b'：current.get('a')=1 不是 dict → 错误。
        """
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}', key='a.b', value='2',
        )
        assert '路径 a 不是对象' in result['error']

    @pytest.mark.asyncio
    async def test_set_default_mode_is_set(self, mock_bot, mock_event):
        """不传 mode 时默认 'set'。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='k', value='"v"',
        )
        data = json.loads(result['result'])
        assert data['k'] == 'v'

    @pytest.mark.asyncio
    async def test_set_overwrites_existing_value(self, mock_bot, mock_event):
        """set 模式：覆盖已存在的值。"""
        result = await json_set(
            mock_bot, mock_event, source='{"k": "old"}', key='k', value='"new"',
        )
        data = json.loads(result['result'])
        assert data['k'] == 'new'


# =============================================================================
# delete 模式
# =============================================================================
class TestDeleteMode:
    """验证 mode='delete' 的字段删除逻辑。"""

    @pytest.mark.asyncio
    async def test_delete_simple_key(self, mock_bot, mock_event):
        """delete 模式：删除顶层字段。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1, "b": 2}',
            key='a', mode='delete',
        )
        data = json.loads(result['result'])
        assert 'a' not in data
        assert data['b'] == 2

    @pytest.mark.asyncio
    async def test_delete_nested_key(self, mock_bot, mock_event):
        """delete 模式：删除嵌套字段。"""
        source = '{"user": {"name": "x", "age": 20}}'
        result = await json_set(
            mock_bot, mock_event, source=source, key='user.age', mode='delete',
        )
        data = json.loads(result['result'])
        assert 'age' not in data['user']
        assert data['user']['name'] == 'x'

    @pytest.mark.asyncio
    async def test_delete_missing_key_no_error(self, mock_bot, mock_event):
        """delete 模式：删除不存在的 key 不报错，原样返回。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}', key='b', mode='delete',
        )
        data = json.loads(result['result'])
        assert data == {"a": 1}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_delete_empty_key_returns_unchanged(self, mock_bot, mock_event):
        """delete 模式：key 为空时 parts=[]，跳过 pop，原样返回。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}', key='', mode='delete',
        )
        data = json.loads(result['result'])
        assert data == {"a": 1}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_delete_path_through_missing_parent(self, mock_bot, mock_event):
        """delete 模式：路径中途父对象不存在时提前返回（不报错）。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}', key='x.y', mode='delete',
        )
        # 'x' 不在 data 中 → current 不变 → parts[-1]='y' pop 不生效
        data = json.loads(result['result'])
        assert data == {"a": 1}
        assert result['error'] == ''


# =============================================================================
# merge 模式
# =============================================================================
class TestMergeMode:
    """验证 mode='merge' 的合并逻辑。"""

    @pytest.mark.asyncio
    async def test_merge_dict_value(self, mock_bot, mock_event):
        """merge 模式：dict 值合并进 source。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}',
            value='{"b": 2, "c": 3}', mode='merge',
        )
        data = json.loads(result['result'])
        assert data == {"a": 1, "b": 2, "c": 3}

    @pytest.mark.asyncio
    async def test_merge_overrides_existing_keys(self, mock_bot, mock_event):
        """merge 模式：合并时同名 key 被覆盖。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1, "b": 2}',
            value='{"b": 99}', mode='merge',
        )
        data = json.loads(result['result'])
        assert data['b'] == 99

    @pytest.mark.asyncio
    async def test_merge_non_dict_value_no_change(self, mock_bot, mock_event):
        """merge 模式：value 非 dict（如字符串）时不修改 data。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}',
            value='hello', mode='merge',
        )
        data = json.loads(result['result'])
        assert data == {"a": 1}

    @pytest.mark.asyncio
    async def test_merge_invalid_json_string_treated_as_string(self, mock_bot, mock_event):
        """merge 模式：非法 JSON 字符串 value 被当作普通字符串，不修改 data。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}',
            value='not json', mode='merge',
        )
        data = json.loads(result['result'])
        assert data == {"a": 1}

    @pytest.mark.asyncio
    async def test_merge_dict_value_direct(self, mock_bot, mock_event):
        """merge 模式：value 为 dict 类型直传时合并。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}',
            value={"b": 2}, mode='merge',
        )
        data = json.loads(result['result'])
        assert data == {"a": 1, "b": 2}


# =============================================================================
# 源类型与错误处理
# =============================================================================
class TestSourceTypes:
    """验证不同 source 类型与错误处理。"""

    @pytest.mark.asyncio
    async def test_dict_source_direct(self, mock_bot, mock_event):
        """source 为 dict 类型时直接使用。"""
        result = await json_set(
            mock_bot, mock_event, source={"k": 1}, key='k2', value='2',
        )
        data = json.loads(result['result'])
        assert data['k'] == 1
        assert data['k2'] == 2

    @pytest.mark.asyncio
    async def test_empty_string_source_defaults_to_empty_dict(self, mock_bot, mock_event):
        """source 为空字符串时默认为 {}。"""
        result = await json_set(
            mock_bot, mock_event, source='', key='k', value='"v"',
        )
        data = json.loads(result['result'])
        assert data == {"k": "v"}

    @pytest.mark.asyncio
    async def test_list_source_returns_error(self, mock_bot, mock_event):
        """source 为 list JSON 字符串时返回 'source 不是 JSON 对象'。"""
        result = await json_set(
            mock_bot, mock_event, source='[1, 2, 3]', key='k', value='"v"',
        )
        assert 'source 不是 JSON 对象' in result['error']
        assert result['result'] == '{}'

    @pytest.mark.asyncio
    async def test_invalid_source_type_returns_error(self, mock_bot, mock_event):
        """source 为非 str/dict 类型（如 int）返回错误。"""
        result = await json_set(
            mock_bot, mock_event, source=12345, key='k', value='"v"',
        )
        assert 'source 不是有效的 JSON 对象' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_json_source_returns_error(self, mock_bot, mock_event):
        """source 为非法 JSON 字符串触发异常 → 返回 error。"""
        result = await json_set(
            mock_bot, mock_event, source='not json', key='k', value='"v"',
        )
        assert result['error'] != ''
        assert result['result'] == '{}'

    @pytest.mark.asyncio
    async def test_mode_case_insensitive(self, mock_bot, mock_event):
        """mode 大小写不敏感（str(mode).lower()）。"""
        result = await json_set(
            mock_bot, mock_event, source='{"a": 1}', key='a', mode='DELETE',
        )
        data = json.loads(result['result'])
        assert 'a' not in data

    @pytest.mark.asyncio
    async def test_unknown_mode_falls_back_to_set(self, mock_bot, mock_event):
        """未知 mode 走到 set 分支（源码 if/elif 后默认 set）。"""
        result = await json_set(
            mock_bot, mock_event, source='{}', key='k', value='"v"', mode='unknown',
        )
        data = json.loads(result['result'])
        assert data['k'] == 'v'
