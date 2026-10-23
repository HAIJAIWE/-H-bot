"""check_cooldown 节点单元测试。

覆盖：
- key 校验（空 key 返回错误）
- mode=check：无记录/冷却中/冷却过期/非法时间戳
- mode=set：写入时间戳
- scope 隔离（user/group/global 生成不同 storage_key）
- time.time 固定时间判定剩余秒数
- 异常捕获

被测源码：qqbat_nodes/builtin/check_cooldown.py

注：check_cooldown 在函数内部 `from qqbat_nodes.builtin.persistent_store
    import _load_value, _save_value`，因此 patch 路径为
    qqbat_nodes.builtin.persistent_store._load_value / _save_value。
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.check_cooldown import check_cooldown


# =============================================================================
# key 校验
# =============================================================================
class TestKeyValidation:
    """验证 key 为空时的快速失败。"""

    @pytest.mark.asyncio
    async def test_empty_key_returns_error(self, mock_bot, mock_event):
        """key 为空：返回 success=False, ready=True, error='key 为空'。"""
        result = await check_cooldown(
            mock_bot, mock_event, key='', cooldown_seconds=60,
        )
        assert result['success'] is False
        assert result['ready'] is True
        assert result['remaining'] == 0
        assert result['error'] == 'key 为空'

    @pytest.mark.asyncio
    async def test_empty_key_does_not_call_persistent(self, mock_bot, mock_event):
        """key 为空时不调用任何持久化操作。"""
        load_mock = AsyncMock()
        save_mock = AsyncMock()
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.persistent_store._save_value', new=save_mock):
            await check_cooldown(mock_bot, mock_event, key='', mode='check')
        load_mock.assert_not_awaited()
        save_mock.assert_not_awaited()


# =============================================================================
# check 模式
# =============================================================================
class TestCheckMode:
    """验证 mode=check 的冷却检查逻辑。"""

    @pytest.mark.asyncio
    async def test_no_record_ready_true(self, mock_bot, mock_event):
        """无冷却记录：ready=True, remaining=0。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        assert result['success'] is True
        assert result['ready'] is True
        assert result['remaining'] == 0
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_within_cooldown_ready_false(self, mock_bot, mock_event):
        """冷却中：ready=False, remaining>0。

        last_ts=1000, now=1005, cooldown=60 → remaining=60-5=55
        """
        load_mock = AsyncMock(return_value=1000.0)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=1005):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle',
                cooldown_seconds=60, mode='check',
            )
        assert result['success'] is True
        assert result['ready'] is False
        assert result['remaining'] == 55
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_cooldown_expired_ready_true(self, mock_bot, mock_event):
        """冷却已过期：ready=True, remaining=0。

        last_ts=1000, now=2000, cooldown=60 → remaining=60-1000=-940 ≤ 0
        """
        load_mock = AsyncMock(return_value=1000.0)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=2000):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle',
                cooldown_seconds=60, mode='check',
            )
        assert result['success'] is True
        assert result['ready'] is True
        assert result['remaining'] == 0

    @pytest.mark.asyncio
    async def test_cooldown_exactly_expired(self, mock_bot, mock_event):
        """冷却恰好到期：remaining=0 → ready=True。

        last_ts=1000, now=1060, cooldown=60 → remaining=60-60=0 ≤ 0
        """
        load_mock = AsyncMock(return_value=1000.0)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=1060):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle',
                cooldown_seconds=60, mode='check',
            )
        assert result['ready'] is True
        assert result['remaining'] == 0

    @pytest.mark.asyncio
    async def test_non_numeric_last_used_treated_as_no_record(self, mock_bot, mock_event):
        """last_used 非数字（如字符串）：视为无记录，ready=True。"""
        load_mock = AsyncMock(return_value="not_a_number")
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        assert result['success'] is True
        assert result['ready'] is True
        assert result['remaining'] == 0

    @pytest.mark.asyncio
    async def test_none_last_used_treated_as_no_record(self, mock_bot, mock_event):
        """last_used 为 None：视为无记录。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        assert result['ready'] is True

    @pytest.mark.asyncio
    async def test_integer_last_used_accepted(self, mock_bot, mock_event):
        """last_used 为整数也能正确计算（float 转换）。"""
        load_mock = AsyncMock(return_value=1000)  # int 而非 float
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=1010):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle',
                cooldown_seconds=60, mode='check',
            )
        assert result['ready'] is False
        assert result['remaining'] == 50  # 60 - 10

    @pytest.mark.asyncio
    async def test_remaining_truncated_to_int(self, mock_bot, mock_event):
        """remaining 向下取整为 int（int(remaining)）。

        last_ts=1000, now=1005.7, cooldown=60 → remaining=60-5.7=54.3 → int=54
        """
        load_mock = AsyncMock(return_value=1000.0)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=1005.7):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle',
                cooldown_seconds=60, mode='check',
            )
        assert result['remaining'] == 54
        assert isinstance(result['remaining'], int)

    @pytest.mark.asyncio
    async def test_load_value_error_treated_as_no_record(self, mock_bot, mock_event):
        """_load_value 抛 ValueError：视为无记录，ready=True。

        源码在 check 模式用 try-except ValueError 捕获 _load_value 异常。
        """
        load_mock = AsyncMock(side_effect=ValueError("scope 非法"))
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        assert result['success'] is True
        assert result['ready'] is True
        assert result['remaining'] == 0


# =============================================================================
# set 模式
# =============================================================================
class TestSetMode:
    """验证 mode=set 的冷却设置逻辑。"""

    @pytest.mark.asyncio
    async def test_set_mode_writes_timestamp(self, mock_bot, mock_event):
        """set 模式：写入当前时间戳，返回 ready=True。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.persistent_store._save_value', new=save_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=12345):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='set',
            )
        assert result['success'] is True
        assert result['ready'] is True
        assert result['remaining'] == 0
        assert result['error'] == ''
        # 验证保存的时间戳为当前时间
        save_mock.assert_awaited_once()
        assert save_mock.call_args.args[1] == 12345

    @pytest.mark.asyncio
    async def test_set_mode_uses_global_scope(self, mock_bot, mock_event):
        """set 模式始终用 global scope 保存时间戳。"""
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.persistent_store._save_value', new=save_mock):
            await check_cooldown(
                mock_bot, mock_event, key='battle', mode='set', scope='user',
            )
        # 源码中 set 模式硬编码 scope='global'
        assert save_mock.call_args.args[2] == 'global'

    @pytest.mark.asyncio
    async def test_set_mode_does_not_load(self, mock_bot, mock_event):
        """set 模式不调用 _load_value。"""
        load_mock = AsyncMock()
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.persistent_store._save_value', new=save_mock):
            await check_cooldown(
                mock_bot, mock_event, key='battle', mode='set',
            )
        load_mock.assert_not_awaited()


# =============================================================================
# scope 隔离
# =============================================================================
class TestScopeIsolation:
    """验证 scope 生成不同的 storage_key。"""

    @pytest.mark.asyncio
    async def test_scope_user_key_format(self, mock_bot, mock_event):
        """scope=user：storage_key 格式为 cd:<user_id>:<key>。"""
        mock_event.user_id = 12345
        mock_event.group_id = 67890
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            await check_cooldown(
                mock_bot, mock_event, key='battle',
                scope='user', mode='check',
            )
        # storage_key 应为 cd:12345:battle
        assert load_mock.call_args.args[0] == 'cd:12345:battle'

    @pytest.mark.asyncio
    async def test_scope_group_key_format(self, mock_bot, mock_event):
        """scope=group：storage_key 格式为 cd:<group_id>:<key>。"""
        mock_event.user_id = 12345
        mock_event.group_id = 67890
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            await check_cooldown(
                mock_bot, mock_event, key='battle',
                scope='group', mode='check',
            )
        assert load_mock.call_args.args[0] == 'cd:67890:battle'

    @pytest.mark.asyncio
    async def test_scope_global_key_format(self, mock_bot, mock_event):
        """scope=global：storage_key 格式为 cd:global:<key>。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            await check_cooldown(
                mock_bot, mock_event, key='battle',
                scope='global', mode='check',
            )
        assert load_mock.call_args.args[0] == 'cd:global:battle'

    @pytest.mark.asyncio
    async def test_invalid_scope_defaults_to_user(self, mock_bot, mock_event):
        """非法 scope 走 else 分支，按 user 格式生成 key。"""
        mock_event.user_id = 12345
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            await check_cooldown(
                mock_bot, mock_event, key='battle',
                scope='invalid', mode='check',
            )
        # scope 不是 group 也不是 global → else 分支 → cd:<user_id>:<key>
        assert load_mock.call_args.args[0] == 'cd:12345:battle'


# =============================================================================
# 异常处理
# =============================================================================
class TestExceptionHandling:
    """验证顶层 try-except 异常捕获。"""

    @pytest.mark.asyncio
    async def test_save_value_raises_returns_error(self, mock_bot, mock_event):
        """set 模式下 _save_value 抛异常 → success=False。"""
        save_mock = AsyncMock(side_effect=RuntimeError("DB locked"))
        with patch('qqbat_nodes.builtin.persistent_store._save_value', new=save_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='set',
            )
        assert result['success'] is False
        assert result['ready'] is True
        assert 'DB locked' in result['error']

    @pytest.mark.asyncio
    async def test_load_value_unexpected_exception_returns_error(self, mock_bot, mock_event):
        """check 模式下 _load_value 抛非 ValueError 异常 → success=False。

        注：源码 try-except 只捕获 ValueError，其他异常会上抛到顶层 try-except。
        """
        load_mock = AsyncMock(side_effect=RuntimeError("connection lost"))
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        assert result['success'] is False
        assert 'connection lost' in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 success/ready/remaining/error 四个字段。"""
        load_mock = AsyncMock(return_value=None)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        assert set(result.keys()) == {'success', 'ready', 'remaining', 'error'}

    @pytest.mark.asyncio
    async def test_default_cooldown_seconds(self, mock_bot, mock_event):
        """默认 cooldown_seconds=60。"""
        load_mock = AsyncMock(return_value=1000.0)
        with patch('qqbat_nodes.builtin.persistent_store._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.check_cooldown.time.time', return_value=1010):
            result = await check_cooldown(
                mock_bot, mock_event, key='battle', mode='check',
            )
        # 默认 60 秒，now-last=10 → remaining=50
        assert result['remaining'] == 50
