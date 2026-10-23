"""save_persistent 节点单元测试。

覆盖：
- key 校验（空 key 返回错误）
- ttl 校验（负数非法 / 0=永不过期 / >0=有效过期）
- 成功保存路径（value_out 回流）
- _save_value 返回 False 时的失败路径
- ValueError 异常处理（scope 非法 / event 缺失）
- scope 透传、各种 value 类型、返回结构完整性

被测源码：qqbat_nodes/builtin/save_persistent.py

注：save_persistent 在模块顶层 `from .persistent_store import _save_value`，
    因此 patch 路径为 qqbat_nodes.builtin.save_persistent._save_value。
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.save_persistent import save_persistent


# =============================================================================
# key 校验
# =============================================================================
class TestKeyValidation:
    """验证 key 为空时的快速失败。"""

    @pytest.mark.asyncio
    async def test_empty_key_returns_error(self, mock_bot, mock_event):
        """key 为空：返回 success=False, value_out=None。"""
        result = await save_persistent(
            mock_bot, mock_event, key='', value=100,
        )
        assert result['success'] is False
        assert result['value_out'] is None
        assert result['error'] == 'key 为空'

    @pytest.mark.asyncio
    async def test_empty_key_does_not_call_save(self, mock_bot, mock_event):
        """key 为空时不调用 _save_value。"""
        save_mock = AsyncMock()
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(mock_bot, mock_event, key='', value=1)
        save_mock.assert_not_awaited()


# =============================================================================
# ttl 校验
# =============================================================================
class TestTtlValidation:
    """验证 ttl 参数的校验逻辑。"""

    @pytest.mark.asyncio
    async def test_negative_ttl_returns_error(self, mock_bot, mock_event):
        """ttl 为负数：返回错误，不调用 _save_value。"""
        save_mock = AsyncMock()
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1, ttl=-1,
            )
        assert result['success'] is False
        assert result['value_out'] is None
        assert result['error'] == 'ttl 不能为负数'
        save_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_zero_ttl_is_valid(self, mock_bot, mock_event):
        """ttl=0 表示永不过期，合法。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1, ttl=0,
            )
        assert result['success'] is True
        # 验证 ttl=0 透传给 _save_value
        assert save_mock.call_args.kwargs.get('ttl', 0) == 0

    @pytest.mark.asyncio
    async def test_positive_ttl_is_valid(self, mock_bot, mock_event):
        """ttl>0 表示有效过期时间。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1, ttl=3600,
            )
        assert result['success'] is True
        assert save_mock.call_args.kwargs.get('ttl') == 3600

    @pytest.mark.asyncio
    async def test_default_ttl_is_zero(self, mock_bot, mock_event):
        """不传 ttl 时默认为 0（永不过期）。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(mock_bot, mock_event, key='k', value=1)
        assert save_mock.call_args.kwargs.get('ttl', 0) == 0


# =============================================================================
# 成功保存路径
# =============================================================================
class TestSuccessPath:
    """验证保存成功的返回值。"""

    @pytest.mark.asyncio
    async def test_success_returns_value_out(self, mock_bot, mock_event):
        """保存成功：value_out 回流保存的值。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='hp', value=100,
            )
        assert result['success'] is True
        assert result['value_out'] == 100
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_success_with_string_value(self, mock_bot, mock_event):
        """保存字符串值。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='name', value='player1',
            )
        assert result['value_out'] == 'player1'

    @pytest.mark.asyncio
    async def test_success_with_list_value(self, mock_bot, mock_event):
        """保存列表值。"""
        val = [1, 2, 3]
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='items', value=val,
            )
        assert result['value_out'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_success_with_dict_value(self, mock_bot, mock_event):
        """保存字典值。"""
        val = {'hp': 100, 'mp': 50}
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='stats', value=val,
            )
        assert result['value_out'] == {'hp': 100, 'mp': 50}

    @pytest.mark.asyncio
    async def test_success_with_none_value(self, mock_bot, mock_event):
        """保存 None 值（边界值）。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='empty', value=None,
            )
        assert result['success'] is True
        assert result['value_out'] is None

    @pytest.mark.asyncio
    async def test_success_with_zero_value(self, mock_bot, mock_event):
        """保存 0 值（边界值，确保不被当作 falsy 误处理）。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='cnt', value=0,
            )
        assert result['success'] is True
        assert result['value_out'] == 0

    @pytest.mark.asyncio
    async def test_value_out_is_same_object(self, mock_bot, mock_event):
        """value_out 与传入的 value 是同一对象（无复制）。"""
        val = {'nested': [1, 2]}
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=val,
            )
        assert result['value_out'] is val


# =============================================================================
# 失败路径
# =============================================================================
class TestFailurePath:
    """验证 _save_value 返回 False 时的失败处理。"""

    @pytest.mark.asyncio
    async def test_save_returns_false(self, mock_bot, mock_event):
        """_save_value 返回 False：success=False, value_out=None。"""
        save_mock = AsyncMock(return_value=False)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=100,
            )
        assert result['success'] is False
        assert result['value_out'] is None
        assert result['error'] == '保存失败'

    @pytest.mark.asyncio
    async def test_value_error_from_save_returns_error(self, mock_bot, mock_event):
        """_save_value 抛 ValueError：返回错误信息。"""
        save_mock = AsyncMock(side_effect=ValueError("scope 非法"))
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1,
            )
        assert result['success'] is False
        assert result['value_out'] is None
        assert 'scope 非法' in result['error']

    @pytest.mark.asyncio
    async def test_value_error_missing_event_field(self, mock_bot, mock_event):
        """_save_value 抛 ValueError（event 缺失字段）。"""
        save_mock = AsyncMock(side_effect=ValueError("user scope 需要 event.user_id"))
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1, scope='user',
            )
        assert result['success'] is False
        assert 'event.user_id' in result['error']


# =============================================================================
# scope 透传
# =============================================================================
class TestScopePassThrough:
    """验证 scope 参数透传给 _save_value。"""

    @pytest.mark.asyncio
    async def test_scope_user_passed_through(self, mock_bot, mock_event):
        """scope=user 透传。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(
                mock_bot, mock_event, key='k', value=1, scope='user',
            )
        assert save_mock.call_args.args[2] == 'user'

    @pytest.mark.asyncio
    async def test_scope_group_passed_through(self, mock_bot, mock_event):
        """scope=group 透传。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(
                mock_bot, mock_event, key='k', value=1, scope='group',
            )
        assert save_mock.call_args.args[2] == 'group'

    @pytest.mark.asyncio
    async def test_scope_global_passed_through(self, mock_bot, mock_event):
        """scope=global 透传。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(
                mock_bot, mock_event, key='k', value=1, scope='global',
            )
        assert save_mock.call_args.args[2] == 'global'

    @pytest.mark.asyncio
    async def test_default_scope_is_user(self, mock_bot, mock_event):
        """不传 scope 时默认为 'user'。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(mock_bot, mock_event, key='k', value=1)
        assert save_mock.call_args.args[2] == 'user'

    @pytest.mark.asyncio
    async def test_event_passed_through(self, mock_bot, mock_event):
        """event 对象透传给 _save_value。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            await save_persistent(mock_bot, mock_event, key='k', value=1)
        assert save_mock.call_args.args[3] is mock_event


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 success/value_out/error 三个字段。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1,
            )
        assert set(result.keys()) == {'success', 'value_out', 'error'}

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.save_persistent._save_value', new=save_mock):
            result = await save_persistent(
                mock_bot, mock_event, key='k', value=1,
            )
        assert result['error'] == ''
