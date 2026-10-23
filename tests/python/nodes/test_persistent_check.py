"""persistent_check 节点单元测试。

覆盖：
- delete 模式：删除成功 / 删除失败 / key 为空
- exists 模式：存在 / 不存在 / key 为空
- 未知 mode
- 异常捕获

被测源码：qqbat_nodes/builtin/persistent_check.py
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.persistent_check import persistent_check


# =============================================================================
# delete 模式
# =============================================================================
class TestDeleteMode:
    """验证 delete 模式的删除行为。"""

    @pytest.mark.asyncio
    async def test_delete_success(self, mock_bot, mock_event):
        """delete 模式：成功删除返回 success=True, exists=False。"""
        delete_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.persistent_check._delete_value',
                   new=delete_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='delete', key='rpg_exp',
            )
        assert result['success'] is True
        assert result['exists'] is False
        assert result['error'] == ''
        assert result['out'] is None
        delete_mock.assert_awaited_once()
        # 验证参数透传
        call_args = delete_mock.call_args.args
        assert call_args[0] == 'rpg_exp'  # key
        assert call_args[1] == 'user'  # scope

    @pytest.mark.asyncio
    async def test_delete_failure_returns_error(self, mock_bot, mock_event):
        """delete 模式：_delete_value 返回 False（删除失败）→ success 仍为 True。

        注：源码中 _delete_value 抛异常才会返回 success=False，
        _delete_value 返回 False 时函数仍正常返回 success=True。
        此测试覆盖正常返回路径。
        """
        delete_mock = AsyncMock(return_value=False)
        with patch('qqbat_nodes.builtin.persistent_check._delete_value',
                   new=delete_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='delete', key='k',
            )
        # _delete_value 返回 False 不抛异常，源码仍返回 success=True
        assert result['success'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_delete_empty_key(self, mock_bot, mock_event):
        """delete 模式：key 为空返回 success=False + 'key 为空'。"""
        result = await persistent_check(
            mock_bot, mock_event, mode='delete', key='',
        )
        assert result['success'] is False
        assert result['exists'] is False
        assert result['error'] == 'key 为空'

    @pytest.mark.asyncio
    async def test_delete_raises_exception(self, mock_bot, mock_event):
        """delete 模式：_delete_value 抛异常 → success=False + error 信息。"""
        delete_mock = AsyncMock(side_effect=RuntimeError("DB locked"))
        with patch('qqbat_nodes.builtin.persistent_check._delete_value',
                   new=delete_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='delete', key='k',
            )
        assert result['success'] is False
        assert 'DB locked' in result['error']

    @pytest.mark.asyncio
    async def test_delete_scope_passed_through(self, mock_bot, mock_event):
        """delete 模式：scope 参数透传给 _delete_value。"""
        delete_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.persistent_check._delete_value',
                   new=delete_mock):
            await persistent_check(
                mock_bot, mock_event, mode='delete', key='k', scope='group',
            )
        assert delete_mock.call_args.args[1] == 'group'


# =============================================================================
# exists 模式
# =============================================================================
class TestExistsMode:
    """验证 exists 模式的存在性检查。"""

    @pytest.mark.asyncio
    async def test_exists_key_present(self, mock_bot, mock_event):
        """exists 模式：key 存在（_load_value 返回非 None）→ exists=True。"""
        load_mock = AsyncMock(return_value=100)
        with patch('qqbat_nodes.builtin.persistent_check._load_value',
                   new=load_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='exists', key='rpg_gold',
            )
        assert result['success'] is True
        assert result['exists'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_exists_key_absent(self, mock_bot, mock_event):
        """exists 模式：key 不存在（_load_value 返回 None）→ exists=False。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_check._load_value',
                   new=load_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='exists', key='ghost_key',
            )
        assert result['success'] is True
        assert result['exists'] is False

    @pytest.mark.asyncio
    async def test_exists_zero_value_treated_as_present(self, mock_bot, mock_event):
        """exists 模式：值为 0 仍视为存在（0 is not None）。"""
        load_mock = AsyncMock(return_value=0)
        with patch('qqbat_nodes.builtin.persistent_check._load_value',
                   new=load_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='exists', key='cnt',
            )
        assert result['exists'] is True

    @pytest.mark.asyncio
    async def test_exists_empty_key(self, mock_bot, mock_event):
        """exists 模式：key 为空返回 success=False + 'key 为空'。"""
        result = await persistent_check(
            mock_bot, mock_event, mode='exists', key='',
        )
        assert result['success'] is False
        assert result['exists'] is False
        assert result['error'] == 'key 为空'

    @pytest.mark.asyncio
    async def test_exists_raises_exception(self, mock_bot, mock_event):
        """exists 模式：_load_value 抛异常 → success=False + error 信息。"""
        load_mock = AsyncMock(side_effect=RuntimeError("connection lost"))
        with patch('qqbat_nodes.builtin.persistent_check._load_value',
                   new=load_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='exists', key='k',
            )
        assert result['success'] is False
        assert result['exists'] is False
        assert 'connection lost' in result['error']

    @pytest.mark.asyncio
    async def test_exists_false_value_treated_as_present(self, mock_bot, mock_event):
        """exists 模式：值为 False 仍视为存在（False is not None）。

        注：源码逻辑是 `value is not None`，因此 False/0/空字符串都视为存在。
        """
        load_mock = AsyncMock(return_value=False)
        with patch('qqbat_nodes.builtin.persistent_check._load_value',
                   new=load_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='exists', key='flag',
            )
        assert result['exists'] is True


# =============================================================================
# 未知 mode
# =============================================================================
class TestUnknownMode:
    """验证未知 mode 的错误返回。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode：返回 success=False + '未知 mode'。"""
        result = await persistent_check(
            mock_bot, mock_event, mode='update', key='k',
        )
        assert result['success'] is False
        assert result['exists'] is False
        assert '未知 mode' in result['error']
        assert 'update' in result['error']

    @pytest.mark.asyncio
    async def test_empty_mode_returns_error(self, mock_bot, mock_event):
        """空 mode 字符串：返回 '未知 mode' 错误。"""
        result = await persistent_check(
            mock_bot, mock_event, mode='', key='k',
        )
        assert result['success'] is False
        assert '未知 mode' in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 out/success/exists/error 四个字段。"""
        delete_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.persistent_check._delete_value',
                   new=delete_mock):
            result = await persistent_check(
                mock_bot, mock_event, mode='delete', key='k',
            )
        assert set(result.keys()) == {'out', 'success', 'exists', 'error'}
