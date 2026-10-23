"""load_persistent 节点单元测试。

覆盖：
- key 校验（空 key 返回 None，error 为空）
- 正常读取（各种值类型：int/str/list/dict/None/0/False）
- ValueError 异常处理（scope 非法 / event 缺失）
- scope 透传、返回结构完整性

被测源码：qqbat_nodes/builtin/load_persistent.py

注：load_persistent 在模块顶层 `from .persistent_store import _load_value`，
    因此 patch 路径为 qqbat_nodes.builtin.load_persistent._load_value。
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.load_persistent import load_persistent


# =============================================================================
# key 校验
# =============================================================================
class TestKeyValidation:
    """验证 key 为空时的行为。"""

    @pytest.mark.asyncio
    async def test_empty_key_returns_none_no_error(self, mock_bot, mock_event):
        """key 为空：result=None, error=''（空字符串，非错误）。

        注：源码中 key 为空时直接返回 result=None, error=''，
            不视为错误（与 save_persistent 不同）。
        """
        result = await load_persistent(mock_bot, mock_event, key='')
        assert result['result'] is None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_key_does_not_call_load(self, mock_bot, mock_event):
        """key 为空时不调用 _load_value。"""
        load_mock = AsyncMock()
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='')
        load_mock.assert_not_awaited()


# =============================================================================
# 正常读取
# =============================================================================
class TestSuccessfulLoad:
    """验证各种值类型的读取。"""

    @pytest.mark.asyncio
    async def test_load_integer(self, mock_bot, mock_event):
        """读取整数值。"""
        load_mock = AsyncMock(return_value=100)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='hp')
        assert result['result'] == 100
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_load_string(self, mock_bot, mock_event):
        """读取字符串值。"""
        load_mock = AsyncMock(return_value='player1')
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='name')
        assert result['result'] == 'player1'

    @pytest.mark.asyncio
    async def test_load_list(self, mock_bot, mock_event):
        """读取列表值。"""
        load_mock = AsyncMock(return_value=[1, 2, 3])
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='items')
        assert result['result'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_load_dict(self, mock_bot, mock_event):
        """读取字典值。"""
        load_mock = AsyncMock(return_value={'hp': 100, 'mp': 50})
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='stats')
        assert result['result'] == {'hp': 100, 'mp': 50}

    @pytest.mark.asyncio
    async def test_load_none_value(self, mock_bot, mock_event):
        """读取 None（键不存在或已过期）。

        注：result=None 既可能是键不存在，也可能是值本身就是 None，
            调用方需根据业务语义区分。
        """
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='ghost')
        assert result['result'] is None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_load_zero_value(self, mock_bot, mock_event):
        """读取 0（边界值，确保 0 不被当作 None 误处理）。"""
        load_mock = AsyncMock(return_value=0)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='cnt')
        assert result['result'] == 0
        assert result['result'] is not None

    @pytest.mark.asyncio
    async def test_load_false_value(self, mock_bot, mock_event):
        """读取 False（边界值）。"""
        load_mock = AsyncMock(return_value=False)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='flag')
        assert result['result'] is False
        assert result['result'] is not None

    @pytest.mark.asyncio
    async def test_load_empty_string(self, mock_bot, mock_event):
        """读取空字符串（边界值）。"""
        load_mock = AsyncMock(return_value='')
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='empty')
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_load_float(self, mock_bot, mock_event):
        """读取浮点数。"""
        load_mock = AsyncMock(return_value=3.14)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='pi')
        assert result['result'] == 3.14

    @pytest.mark.asyncio
    async def test_load_nested_structure(self, mock_bot, mock_event):
        """读取嵌套结构。"""
        val = {'players': [{'name': 'a'}, {'name': 'b'}]}
        load_mock = AsyncMock(return_value=val)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='data')
        assert result['result'] == {'players': [{'name': 'a'}, {'name': 'b'}]}


# =============================================================================
# 异常处理
# =============================================================================
class TestExceptionHandling:
    """验证 ValueError 异常捕获。"""

    @pytest.mark.asyncio
    async def test_value_error_invalid_scope(self, mock_bot, mock_event):
        """_load_value 抛 ValueError（scope 非法）：result=None, error=信息。"""
        load_mock = AsyncMock(side_effect=ValueError("非法 scope: invalid"))
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(
                mock_bot, mock_event, key='k', scope='invalid',
            )
        assert result['result'] is None
        assert '非法 scope' in result['error']
        assert 'invalid' in result['error']

    @pytest.mark.asyncio
    async def test_value_error_missing_user_id(self, mock_bot, mock_event):
        """_load_value 抛 ValueError（user scope 缺少 user_id）。"""
        load_mock = AsyncMock(side_effect=ValueError("user scope 需要 event.user_id"))
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(
                mock_bot, mock_event, key='k', scope='user',
            )
        assert result['result'] is None
        assert 'event.user_id' in result['error']

    @pytest.mark.asyncio
    async def test_value_error_missing_group_id(self, mock_bot, mock_event):
        """_load_value 抛 ValueError（group scope 缺少 group_id）。"""
        load_mock = AsyncMock(side_effect=ValueError("group scope 需要 event.group_id"))
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(
                mock_bot, mock_event, key='k', scope='group',
            )
        assert result['result'] is None
        assert 'event.group_id' in result['error']


# =============================================================================
# scope 透传
# =============================================================================
class TestScopePassThrough:
    """验证 scope 参数透传给 _load_value。"""

    @pytest.mark.asyncio
    async def test_scope_user_passed_through(self, mock_bot, mock_event):
        """scope=user 透传。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='k', scope='user')
        assert load_mock.call_args.args[1] == 'user'

    @pytest.mark.asyncio
    async def test_scope_group_passed_through(self, mock_bot, mock_event):
        """scope=group 透传。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='k', scope='group')
        assert load_mock.call_args.args[1] == 'group'

    @pytest.mark.asyncio
    async def test_scope_global_passed_through(self, mock_bot, mock_event):
        """scope=global 透传。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='k', scope='global')
        assert load_mock.call_args.args[1] == 'global'

    @pytest.mark.asyncio
    async def test_default_scope_is_user(self, mock_bot, mock_event):
        """不传 scope 时默认为 'user'。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='k')
        assert load_mock.call_args.args[1] == 'user'

    @pytest.mark.asyncio
    async def test_event_passed_through(self, mock_bot, mock_event):
        """event 对象透传给 _load_value。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='k')
        assert load_mock.call_args.args[2] is mock_event

    @pytest.mark.asyncio
    async def test_key_passed_through(self, mock_bot, mock_event):
        """key 透传给 _load_value。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            await load_persistent(mock_bot, mock_event, key='my_key')
        assert load_mock.call_args.args[0] == 'my_key'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 result/error 两个字段。"""
        load_mock = AsyncMock(return_value=1)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='k')
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        load_mock = AsyncMock(return_value=42)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='k')
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_error_empty_when_key_not_found(self, mock_bot, mock_event):
        """键不存在（_load_value 返回 None）时 error 仍为空。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.load_persistent._load_value', new=load_mock):
            result = await load_persistent(mock_bot, mock_event, key='k')
        assert result['error'] == ''
