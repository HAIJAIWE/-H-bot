"""set_group_whole_ban handler 单元测试。

覆盖开启/解除全体禁言的正常路径、group_id 缺失、参数回退、权限不足、
API 异常、默认值、适配器能力检测等场景。

被测源码：qqbat_nodes/builtin/set_group_whole_ban.py

注：set_group_whole_ban 调用 check_adapter_support 检测官方适配器。
    MagicMock/AsyncMock 默认自动生成 _openid / _qqbat_official 属性（truthy），
    会误判为官方适配器。需用 napcat_mode fixture 显式置空这些属性。
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.set_group_whole_ban import set_group_whole_ban


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _make_action_failed(msg: str):
    """构造一个 ActionFailed 异常实例（兼容无 nonebot 环境时的 Exception 回退）。"""
    try:
        from nonebot.adapters.onebot.v11 import ActionFailed
        return ActionFailed(msg)
    except ImportError:
        return Exception(msg)


@pytest.fixture
def napcat_mode(mock_bot, mock_event):
    """配置 mock 为 NapCat 模式（非官方适配器），绕过适配器检测。

    MagicMock/AsyncMock 会自动生成 _openid / _qqbat_official 属性（truthy），
    导致 is_official_adapter 误判为官方适配器。此 fixture 显式置空。
    """
    mock_event._openid = None
    mock_bot._qqbat_official = False
    return mock_bot, mock_event


# ---------------------------------------------------------------------------
# 正常路径
# ---------------------------------------------------------------------------

class TestSetGroupWholeBanSuccess:
    """全体禁言/解除的正常调用测试。"""

    @pytest.mark.asyncio
    async def test_enable_whole_ban(self, napcat_mode):
        """开启全体禁言应调用 set_group_whole_ban 且 enable=True。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890', enable=True)

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_whole_ban', group_id=67890, enable=True,
        )

    @pytest.mark.asyncio
    async def test_disable_whole_ban(self, napcat_mode):
        """解除全体禁言应调用 set_group_whole_ban 且 enable=False。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890', enable=False)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_whole_ban', group_id=67890, enable=False,
        )

    @pytest.mark.asyncio
    async def test_default_enable_is_true(self, napcat_mode):
        """不传 enable 时默认为 True（开启全体禁言）。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890')

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_whole_ban', group_id=67890, enable=True,
        )

    @pytest.mark.asyncio
    async def test_group_id_int_conversion(self, napcat_mode):
        """字符串 group_id 应被转换为 int 传给 API。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='98765', enable=True)

        assert result['success'] is True
        # 验证传入的是 int 类型
        call_kwargs = mock_bot.call_api.await_args
        assert call_kwargs.kwargs['group_id'] == 98765
        assert isinstance(call_kwargs.kwargs['group_id'], int)


# ---------------------------------------------------------------------------
# 参数回退与缺失
# ---------------------------------------------------------------------------

class TestSetGroupWholeBanFallback:
    """group_id 回退与缺失场景测试。"""

    @pytest.mark.asyncio
    async def test_group_id_fallback_from_event(self, napcat_mode):
        """group_id 为空时应从 event.group_id 回退获取。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_whole_ban(mock_bot, mock_event, enable=True)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_whole_ban', group_id=67890, enable=True,
        )

    @pytest.mark.asyncio
    async def test_group_id_fallback_string_event(self, napcat_mode):
        """event.group_id 为字符串时应正确转换。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = '11111'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_group_whole_ban(mock_bot, mock_event)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_whole_ban', group_id=11111, enable=True,
        )

    @pytest.mark.asyncio
    async def test_missing_group_id_private_chat(self, napcat_mode):
        """私聊场景（无 group_id）应拒绝执行。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = None
        mock_bot.call_api = AsyncMock()

        result = await set_group_whole_ban(mock_bot, mock_event, enable=True)

        assert result['success'] is False
        assert 'group_id' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_group_id_string_rejected(self, napcat_mode):
        """显式传空字符串 group_id 且 event 无 group_id 时应拒绝。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = ''
        mock_bot.call_api = AsyncMock()

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='', enable=True)

        assert result['success'] is False
        assert 'group_id' in result['error']


# ---------------------------------------------------------------------------
# 异常处理
# ---------------------------------------------------------------------------

class TestSetGroupWholeBanErrors:
    """异常处理与权限不足场景测试。"""

    @pytest.mark.asyncio
    async def test_action_failed_1300_permission(self, napcat_mode):
        """ActionFailed 含 1300 时应返回权限不足友好提示。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('retcode=1300 权限不足'))

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_keyword_permission(self, napcat_mode):
        """ActionFailed 含 '权限' 关键字应返回权限不足提示。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('权限不足'))

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_other_error(self, napcat_mode):
        """ActionFailed 不含权限关键字时应返回原始错误信息。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('群不存在'))

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '群不存在' in result['error']

    @pytest.mark.asyncio
    async def test_general_exception_caught(self, napcat_mode):
        """普通异常应被捕获并返回 error 字符串。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络超时'))

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890')

        assert result['success'] is False
        assert '网络超时' in result['error']

    @pytest.mark.asyncio
    async def test_enable_bool_coercion(self, napcat_mode):
        """enable 参数应被 bool() 强制转换。"""
        mock_bot, mock_event = napcat_mode
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value=None)

        # 传 truthy 值
        await set_group_whole_ban(mock_bot, mock_event, group_id='67890', enable=1)
        mock_bot.call_api.assert_awaited_with(
            'set_group_whole_ban', group_id=67890, enable=True,
        )

        # 传 falsy 值
        await set_group_whole_ban(mock_bot, mock_event, group_id='67890', enable=0)
        mock_bot.call_api.assert_awaited_with(
            'set_group_whole_ban', group_id=67890, enable=False,
        )


# ---------------------------------------------------------------------------
# 适配器能力检测
# ---------------------------------------------------------------------------

class TestAdapterUnsupported:
    """验证 QQ 官方适配器不支持全体禁言时的友好错误。"""

    @pytest.mark.asyncio
    async def test_official_adapter_returns_unsupported(self, mock_bot, mock_event):
        """事件含 _openid（官方适配器标记）时返回不支持错误。"""
        mock_event._openid = 'some_openid_value'

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890', enable=True)

        assert result['success'] is False
        assert '不支持' in result['error']
        assert 'set_group_whole_ban' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_official_adapter_via_bot_flag(self, mock_bot, mock_event):
        """bot 含 _qqbat_official 标记时返回不支持错误。"""
        mock_event._openid = None
        mock_bot._qqbat_official = True

        result = await set_group_whole_ban(mock_bot, mock_event, group_id='67890', enable=True)

        assert result['success'] is False
        assert '不支持' in result['error']
