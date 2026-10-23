"""set_group_leave handler 单元测试。

覆盖退群操作的正常路径、group_id 回退/缺失、API 异常、适配器能力检测等场景。

被测源码：qqbat_nodes/builtin/set_group_leave.py
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.set_group_leave import set_group_leave


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


def _make_action_failed(msg: str):
    """构造一个 ActionFailed 异常实例（兼容无 nonebot 环境时的 Exception 回退）。"""
    try:
        from nonebot.adapters.onebot.v11 import ActionFailed
        return ActionFailed(msg)
    except ImportError:
        return Exception(msg)


# ---------------------------------------------------------------------------
# 正常路径
# ---------------------------------------------------------------------------

class TestSetGroupLeaveSuccess:
    """退群操作正常调用测试。"""

    @pytest.mark.asyncio
    async def test_leave_with_explicit_group_id(self, mock_bot, mock_event):
        """显式传入 group_id 应成功退群并调用 set_group_leave API。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_leave(mock_bot, mock_event, group_id='67890')

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_leave', group_id=67890,
        )

    @pytest.mark.asyncio
    async def test_leave_group_id_int_conversion(self, mock_bot, mock_event):
        """字符串 group_id 应被转换为 int 传给 API。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_group_leave(mock_bot, mock_event, group_id='98765')

        call_kwargs = mock_bot.call_api.await_args
        assert call_kwargs.kwargs['group_id'] == 98765
        assert isinstance(call_kwargs.kwargs['group_id'], int)

    @pytest.mark.asyncio
    async def test_leave_group_id_fallback_from_event(self, mock_bot, mock_event):
        """group_id 为空时应从 event.group_id 回退获取。"""
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_leave(mock_bot, mock_event)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_leave', group_id=67890,
        )

    @pytest.mark.asyncio
    async def test_leave_group_id_fallback_string_event(self, mock_bot, mock_event):
        """event.group_id 为字符串时应正确转换。"""
        mock_event.group_id = '11111'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_leave(mock_bot, mock_event)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_leave', group_id=11111,
        )


# ---------------------------------------------------------------------------
# 参数缺失
# ---------------------------------------------------------------------------

class TestSetGroupLeaveValidation:
    """参数缺失与边界场景测试。"""

    @pytest.mark.asyncio
    async def test_missing_group_id_private_chat(self, mock_bot, mock_event):
        """私聊场景（无 group_id）应拒绝退群。"""
        mock_event.group_id = None
        mock_bot.call_api = AsyncMock()

        result = await set_group_leave(mock_bot, mock_event)

        assert result['success'] is False
        assert '私聊' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_group_id_string_rejected(self, mock_bot, mock_event):
        """显式传空字符串 group_id 且 event 无 group_id 时应拒绝。"""
        mock_event.group_id = ''
        mock_bot.call_api = AsyncMock()

        result = await set_group_leave(mock_bot, mock_event, group_id='')

        assert result['success'] is False
        assert '私聊' in result['error']

    @pytest.mark.asyncio
    async def test_explicit_group_id_overrides_event(self, mock_bot, mock_event):
        """显式传入 group_id 应优先于 event.group_id。"""
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_group_leave(mock_bot, mock_event, group_id='99999')

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_leave', group_id=99999,
        )


# ---------------------------------------------------------------------------
# 异常处理
# ---------------------------------------------------------------------------

class TestSetGroupLeaveErrors:
    """异常处理场景测试。"""

    @pytest.mark.asyncio
    async def test_action_failed_caught(self, mock_bot, mock_event):
        """ActionFailed 应被捕获并返回错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('权限不足'))

        result = await set_group_leave(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_general_exception_caught(self, mock_bot, mock_event):
        """普通异常应被捕获并返回 error 字符串。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络断开'))

        result = await set_group_leave(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '网络断开' in result['error']

    @pytest.mark.asyncio
    async def test_value_error_on_invalid_group_id(self, mock_bot, mock_event):
        """group_id 非数字时应触发 ValueError 并被捕获。"""
        mock_bot.call_api = AsyncMock(side_effect=ValueError('invalid literal for int()'))

        result = await set_group_leave(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert 'invalid literal' in result['error']


# ---------------------------------------------------------------------------
# 适配器能力检测
# ---------------------------------------------------------------------------

class TestSetGroupLeaveAdapter:
    """官方适配器能力检测相关测试。"""

    @pytest.mark.asyncio
    async def test_official_adapter_unsupported(self, mock_bot, mock_event, monkeypatch):
        """QQ 官方适配器下应直接返回不支持错误，不调用 API。"""
        monkeypatch.setenv('QQBAT_OFFICIAL_MODE', '1')
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock()

        result = await set_group_leave(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '不支持' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_official_adapter_unsupported_via_event_openid(self, mock_bot, mock_event):
        """event 带 _openid 字段时识别为官方适配器并拒绝。"""
        mock_event._openid = 'official_user_openid'
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock()

        result = await set_group_leave(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '不支持' in result['error']
        mock_bot.call_api.assert_not_called()
