"""approve_friend_request handler 单元测试。

覆盖同意/拒绝加好友请求的正常路径、flag 缺失、flag 回退、备注名、
API 异常、默认值等场景。

被测源码：qqbat_nodes/builtin/approve_friend_request.py
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.approve_friend_request import approve_friend_request


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


# ---------------------------------------------------------------------------
# 正常路径
# ---------------------------------------------------------------------------

class TestApproveFriendRequestSuccess:
    """同意/拒绝加好友请求的正常调用测试。"""

    @pytest.mark.asyncio
    async def test_approve_default_true(self, mock_bot, mock_event):
        """不传 approve 时默认为 True（同意请求）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(mock_bot, mock_event, flag='req_flag_001')

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='req_flag_001', approve=True, remark='',
        )

    @pytest.mark.asyncio
    async def test_approve_true_explicit(self, mock_bot, mock_event):
        """显式 approve=True 应调用 API 并同意。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(
            mock_bot, mock_event, flag='req_flag_001', approve=True,
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='req_flag_001', approve=True, remark='',
        )

    @pytest.mark.asyncio
    async def test_approve_false_reject(self, mock_bot, mock_event):
        """approve=False 应拒绝加好友请求。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(
            mock_bot, mock_event, flag='req_flag_001', approve=False,
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='req_flag_001', approve=False, remark='',
        )

    @pytest.mark.asyncio
    async def test_approve_with_remark(self, mock_bot, mock_event):
        """同意请求时可附带备注名。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(
            mock_bot, mock_event, flag='req_flag_001', approve=True, remark='老王',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='req_flag_001', approve=True, remark='老王',
        )

    @pytest.mark.asyncio
    async def test_approve_bool_coercion(self, mock_bot, mock_event):
        """approve 参数应被 bool() 强制转换。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        # truthy 值
        await approve_friend_request(mock_bot, mock_event, flag='f1', approve=1)
        mock_bot.call_api.assert_awaited_with(
            'set_friend_add_request', flag='f1', approve=True, remark='',
        )

        # falsy 值
        await approve_friend_request(mock_bot, mock_event, flag='f2', approve=0)
        mock_bot.call_api.assert_awaited_with(
            'set_friend_add_request', flag='f2', approve=False, remark='',
        )


# ---------------------------------------------------------------------------
# flag 回退与缺失
# ---------------------------------------------------------------------------

class TestApproveFriendRequestFlag:
    """flag 参数回退与缺失场景测试。"""

    @pytest.mark.asyncio
    async def test_flag_fallback_from_event(self, mock_bot, mock_event):
        """flag 为空时应从 event.flag 回退获取。"""
        mock_event.flag = 'event_flag_002'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(mock_bot, mock_event)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='event_flag_002', approve=True, remark='',
        )

    @pytest.mark.asyncio
    async def test_explicit_flag_overrides_event(self, mock_bot, mock_event):
        """显式传入 flag 应优先于 event.flag。"""
        mock_event.flag = 'event_flag_002'
        mock_bot.call_api = AsyncMock(return_value=None)

        await approve_friend_request(mock_bot, mock_event, flag='explicit_flag')

        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='explicit_flag', approve=True, remark='',
        )

    @pytest.mark.asyncio
    async def test_missing_flag_no_event_attr(self, mock_bot, mock_event):
        """flag 缺失且 event 无 flag 属性时应返回错误。"""
        # MagicMock 默认会返回 MagicMock 对象，需显式设为空
        mock_event.flag = ''
        mock_bot.call_api = AsyncMock()

        result = await approve_friend_request(mock_bot, mock_event)

        assert result['success'] is False
        assert 'flag' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_flag_string_rejected(self, mock_bot, mock_event):
        """显式传空字符串 flag 且 event.flag 也为空时应拒绝。"""
        mock_event.flag = ''
        mock_bot.call_api = AsyncMock()

        result = await approve_friend_request(mock_bot, mock_event, flag='')

        assert result['success'] is False
        assert 'flag' in result['error']

    @pytest.mark.asyncio
    async def test_flag_none_falls_back_to_event(self, mock_bot, mock_event):
        """flag=None 时应回退取 event.flag。"""
        mock_event.flag = 'event_flag_003'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(mock_bot, mock_event, flag=None)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='event_flag_003', approve=True, remark='',
        )


# ---------------------------------------------------------------------------
# 异常处理
# ---------------------------------------------------------------------------

class TestApproveFriendRequestErrors:
    """异常处理场景测试。"""

    @pytest.mark.asyncio
    async def test_action_failed_caught(self, mock_bot, mock_event):
        """ActionFailed 应被捕获并返回错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('请求已过期'))

        result = await approve_friend_request(mock_bot, mock_event, flag='req_flag')

        assert result['success'] is False
        assert '请求已过期' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_permission_denied(self, mock_bot, mock_event):
        """ActionFailed 含权限关键字时返回原始错误（本节点未做特殊提示）。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('权限不足'))

        result = await approve_friend_request(mock_bot, mock_event, flag='req_flag')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_general_exception_caught(self, mock_bot, mock_event):
        """普通异常应被捕获并返回 error 字符串。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络异常'))

        result = await approve_friend_request(mock_bot, mock_event, flag='req_flag')

        assert result['success'] is False
        assert '网络异常' in result['error']

    @pytest.mark.asyncio
    async def test_remark_none_default_empty(self, mock_bot, mock_event):
        """remark=None 时应被转为空字符串传给 API。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_friend_request(
            mock_bot, mock_event, flag='req_flag', remark=None,
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_friend_add_request',
            flag='req_flag', approve=True, remark='',
        )
