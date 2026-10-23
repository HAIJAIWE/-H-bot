"""group_punish handler 单元测试。

覆盖 mute / kick 两种模式的正常路径、参数缺失、权限不足、API 异常、
默认值、适配器能力检测等场景。

被测源码：qqbat_nodes/builtin/group_punish.py
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.group_punish import group_punish, VALID_MODES


# ---------------------------------------------------------------------------
# 辅助 fixture / 函数
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _ensure_napcat_adapter(mock_bot, mock_event, monkeypatch):
    """自动配置为 NapCat 适配器（非官方），避免 check_adapter_support 误判。

    MagicMock 会自动创建 ``_openid`` / ``_qqbat_official`` 属性（truthy），
    导致 ``is_official_adapter`` 误判为官方适配器。本 fixture 显式清除这些
    标记并清空环境变量，确保默认走 NapCat 路径。
    需要测试官方适配器分支的用例可随后重新设置标记/环境变量。
    """
    mock_event._openid = None
    mock_bot._qqbat_official = False
    monkeypatch.delenv('QQBAT_OFFICIAL_MODE', raising=False)


@pytest.fixture
def group_event(mock_event):
    """预配置为群聊场景的 mock_event。"""
    mock_event.group_id = 67890
    mock_event.user_id = 12345
    return mock_event


def _make_action_failed(msg: str):
    """构造一个 ActionFailed 异常实例（兼容无 nonebot 环境时的 Exception 回退）。"""
    try:
        from nonebot.adapters.onebot.v11 import ActionFailed
        return ActionFailed(msg)
    except ImportError:
        return Exception(msg)


# ---------------------------------------------------------------------------
# mute 模式
# ---------------------------------------------------------------------------

class TestGroupPunishMute:
    """禁言（mute 模式）相关测试。"""

    @pytest.mark.asyncio
    async def test_mute_success_default_duration(self, mock_bot, group_event):
        """mute 模式默认禁言 60 秒。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await group_punish(mock_bot, group_event, mode='mute')

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_ban', group_id=67890, user_id=12345, duration=60,
        )

    @pytest.mark.asyncio
    async def test_mute_custom_duration(self, mock_bot, group_event):
        """mute 模式支持自定义禁言时长。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(mock_bot, group_event, mode='mute', duration=3600)

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_ban', group_id=67890, user_id=12345, duration=3600,
        )

    @pytest.mark.asyncio
    async def test_mute_duration_zero_unmute(self, mock_bot, group_event):
        """mute 模式 duration=0 表示解除禁言。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(mock_bot, group_event, mode='mute', duration=0)

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_ban', group_id=67890, user_id=12345, duration=0,
        )

    @pytest.mark.asyncio
    async def test_mute_duration_float_conversion(self, mock_bot, group_event):
        """duration 传入浮点数应被 int(float()) 转换为整数。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(mock_bot, group_event, mode='mute', duration=99.9)

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_ban', group_id=67890, user_id=12345, duration=99,
        )


# ---------------------------------------------------------------------------
# kick 模式
# ---------------------------------------------------------------------------

class TestGroupPunishKick:
    """踢出（kick 模式）相关测试。"""

    @pytest.mark.asyncio
    async def test_kick_success_default_reject(self, mock_bot, group_event):
        """kick 模式默认 reject_add_request=False（允许再次加群）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await group_punish(mock_bot, group_event, mode='kick')

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_kick',
            group_id=67890, user_id=12345, reject_add_request=False,
        )

    @pytest.mark.asyncio
    async def test_kick_with_reject_add_request(self, mock_bot, group_event):
        """kick 模式支持 reject_add_request=True（拒绝再次加群）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(
            mock_bot, group_event, mode='kick', reject_add_request=True,
        )

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_kick',
            group_id=67890, user_id=12345, reject_add_request=True,
        )

    @pytest.mark.asyncio
    async def test_kick_reject_bool_coercion(self, mock_bot, group_event):
        """reject_add_request 应被 bool() 强制转换。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(
            mock_bot, group_event, mode='kick', reject_add_request=1,
        )
        mock_bot.call_api.assert_awaited_with(
            'set_group_kick',
            group_id=67890, user_id=12345, reject_add_request=True,
        )


# ---------------------------------------------------------------------------
# 参数校验与缺失
# ---------------------------------------------------------------------------

class TestGroupPunishValidation:
    """参数校验与缺失场景测试。"""

    @pytest.mark.asyncio
    async def test_invalid_mode_rejected(self, mock_bot, group_event):
        """未知 mode 应被拒绝并提示合法值。"""
        mock_bot.call_api = AsyncMock()

        result = await group_punish(mock_bot, group_event, mode='ban')

        assert result['success'] is False
        assert 'mode' in result['error']
        assert 'ban' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_user_id(self, mock_bot, mock_event):
        """user_id 缺失时应返回错误。"""
        mock_event.group_id = 67890
        mock_event.user_id = None
        mock_bot.call_api = AsyncMock()

        result = await group_punish(mock_bot, mock_event, mode='mute')

        assert result['success'] is False
        assert 'user_id' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_group_id(self, mock_bot, mock_event):
        """group_id 缺失时应返回错误。"""
        mock_event.group_id = None
        mock_event.user_id = 12345
        mock_bot.call_api = AsyncMock()

        result = await group_punish(mock_bot, mock_event, mode='mute')

        assert result['success'] is False
        assert 'group_id' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_both_ids_missing(self, mock_bot, mock_event):
        """user_id 和 group_id 同时缺失时应返回错误。"""
        mock_event.group_id = None
        mock_event.user_id = None
        mock_bot.call_api = AsyncMock()

        result = await group_punish(mock_bot, mock_event, mode='mute')

        assert result['success'] is False
        assert 'user_id' in result['error']

    @pytest.mark.asyncio
    async def test_ids_fallback_from_event(self, mock_bot, mock_event):
        """user_id / group_id 为空时应从 event 回退获取。"""
        mock_event.group_id = 67890
        mock_event.user_id = 12345
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(mock_bot, mock_event, mode='mute')

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_ban', group_id=67890, user_id=12345, duration=60,
        )

    @pytest.mark.asyncio
    async def test_explicit_ids_override_event(self, mock_bot, group_event):
        """显式传入 user_id / group_id 应优先于 event 中的值。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await group_punish(
            mock_bot, group_event,
            mode='mute', user_id='99999', group_id='11111',
        )

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_ban', group_id=11111, user_id=99999, duration=60,
        )


# ---------------------------------------------------------------------------
# 异常处理
# ---------------------------------------------------------------------------

class TestGroupPunishErrors:
    """异常处理与权限不足场景测试。"""

    @pytest.mark.asyncio
    async def test_action_failed_1300_permission(self, mock_bot, group_event):
        """ActionFailed 含 1300 时应返回权限不足友好提示。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('retcode=1300 权限不足'))

        result = await group_punish(mock_bot, group_event, mode='mute')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_keyword_permission(self, mock_bot, group_event):
        """ActionFailed 含 '权限' 关键字应返回权限不足提示。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('权限不足'))

        result = await group_punish(mock_bot, group_event, mode='kick')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_other_error(self, mock_bot, group_event):
        """ActionFailed 不含权限关键字时应返回原始错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('群不存在'))

        result = await group_punish(mock_bot, group_event, mode='mute')

        assert result['success'] is False
        assert '群不存在' in result['error']

    @pytest.mark.asyncio
    async def test_general_exception_caught(self, mock_bot, group_event):
        """普通异常应被捕获并返回 error 字符串。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('连接失败'))

        result = await group_punish(mock_bot, group_event, mode='mute')

        assert result['success'] is False
        assert '连接失败' in result['error']


# ---------------------------------------------------------------------------
# 适配器能力检测
# ---------------------------------------------------------------------------

class TestGroupPunishAdapter:
    """官方适配器能力检测相关测试。"""

    @pytest.mark.asyncio
    async def test_official_adapter_unsupported(self, mock_bot, group_event, monkeypatch):
        """QQ 官方适配器下应直接返回不支持错误，不调用 API。"""
        monkeypatch.setenv('QQBAT_OFFICIAL_MODE', '1')
        mock_bot.call_api = AsyncMock()

        result = await group_punish(mock_bot, group_event, mode='mute')

        assert result['success'] is False
        assert '不支持' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_valid_modes_constant(self):
        """VALID_MODES 应包含 mute / kick 两种。"""
        assert VALID_MODES == {'mute', 'kick'}
