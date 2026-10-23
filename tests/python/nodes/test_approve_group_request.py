"""approve_group_request handler 单元测试。

覆盖同意/拒绝加群请求/邀请的正常路径、flag/sub_type 缺失与回退、
sub_type 非法、API 异常、默认值等场景。

被测源码：qqbat_nodes/builtin/approve_group_request.py
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.approve_group_request import (
    approve_group_request,
    _VALID_SUB_TYPES,
)


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

class TestApproveGroupRequestSuccess:
    """同意/拒绝加群请求的正常调用测试。"""

    @pytest.mark.asyncio
    async def test_approve_add_request_default(self, mock_bot, mock_event):
        """默认 approve=True 同意加群请求（sub_type=add）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag_001', sub_type='add',
        )

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='grp_flag_001', sub_type='add', approve=True, reason='',
        )

    @pytest.mark.asyncio
    async def test_approve_invite_request(self, mock_bot, mock_event):
        """同意加群邀请（sub_type=invite）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag_002', sub_type='invite',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='grp_flag_002', sub_type='invite', approve=True, reason='',
        )

    @pytest.mark.asyncio
    async def test_reject_add_request_with_reason(self, mock_bot, mock_event):
        """拒绝加群请求并附带理由。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(
            mock_bot, mock_event,
            flag='grp_flag_003', sub_type='add', approve=False, reason='不符合入群条件',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='grp_flag_003', sub_type='add', approve=False, reason='不符合入群条件',
        )

    @pytest.mark.asyncio
    async def test_reject_invite_request_with_reason(self, mock_bot, mock_event):
        """拒绝加群邀请并附带理由。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(
            mock_bot, mock_event,
            flag='grp_flag_004', sub_type='invite', approve=False, reason='暂时不想加入',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='grp_flag_004', sub_type='invite', approve=False, reason='暂时不想加入',
        )

    @pytest.mark.asyncio
    async def test_approve_bool_coercion(self, mock_bot, mock_event):
        """approve 参数应被 bool() 强制转换。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        # truthy
        await approve_group_request(
            mock_bot, mock_event, flag='f1', sub_type='add', approve=1,
        )
        mock_bot.call_api.assert_awaited_with(
            'set_group_add_request', flag='f1', sub_type='add', approve=True, reason='',
        )

        # falsy
        await approve_group_request(
            mock_bot, mock_event, flag='f2', sub_type='add', approve=0,
        )
        mock_bot.call_api.assert_awaited_with(
            'set_group_add_request', flag='f2', sub_type='add', approve=False, reason='',
        )


# ---------------------------------------------------------------------------
# flag / sub_type 回退与缺失
# ---------------------------------------------------------------------------

class TestApproveGroupRequestFallback:
    """flag / sub_type 回退与缺失场景测试。"""

    @pytest.mark.asyncio
    async def test_flag_fallback_from_event(self, mock_bot, mock_event):
        """flag 为空时应从 event.flag 回退获取。"""
        mock_event.flag = 'event_grp_flag'
        mock_event.sub_type = 'add'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(mock_bot, mock_event)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='event_grp_flag', sub_type='add', approve=True, reason='',
        )

    @pytest.mark.asyncio
    async def test_sub_type_fallback_from_event(self, mock_bot, mock_event):
        """sub_type 为空时应从 event.sub_type 回退获取。"""
        mock_event.flag = 'grp_flag'
        mock_event.sub_type = 'invite'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(mock_bot, mock_event, flag='grp_flag')

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='grp_flag', sub_type='invite', approve=True, reason='',
        )

    @pytest.mark.asyncio
    async def test_both_fallback_from_event(self, mock_bot, mock_event):
        """flag 和 sub_type 都从 event 回退获取。"""
        mock_event.flag = 'event_flag'
        mock_event.sub_type = 'add'
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(mock_bot, mock_event)

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='event_flag', sub_type='add', approve=True, reason='',
        )

    @pytest.mark.asyncio
    async def test_explicit_params_override_event(self, mock_bot, mock_event):
        """显式传入的 flag / sub_type 应优先于 event 中的值。"""
        mock_event.flag = 'event_flag'
        mock_event.sub_type = 'add'
        mock_bot.call_api = AsyncMock(return_value=None)

        await approve_group_request(
            mock_bot, mock_event, flag='explicit_flag', sub_type='invite',
        )

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='explicit_flag', sub_type='invite', approve=True, reason='',
        )


# ---------------------------------------------------------------------------
# 参数校验
# ---------------------------------------------------------------------------

class TestApproveGroupRequestValidation:
    """参数校验场景测试。"""

    @pytest.mark.asyncio
    async def test_missing_flag(self, mock_bot, mock_event):
        """flag 缺失且 event 无 flag 时应返回错误。"""
        mock_event.flag = ''
        mock_event.sub_type = 'add'
        mock_bot.call_api = AsyncMock()

        result = await approve_group_request(mock_bot, mock_event)

        assert result['success'] is False
        assert 'flag' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_sub_type(self, mock_bot, mock_event):
        """sub_type 缺失且 event 无 sub_type 时应返回错误。"""
        mock_event.flag = 'grp_flag'
        mock_event.sub_type = ''
        mock_bot.call_api = AsyncMock()

        result = await approve_group_request(mock_bot, mock_event, flag='grp_flag')

        assert result['success'] is False
        assert 'sub_type' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_invalid_sub_type(self, mock_bot, mock_event):
        """sub_type 不在 add/invite 中时应返回错误。"""
        mock_bot.call_api = AsyncMock()

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag', sub_type='unknown',
        )

        assert result['success'] is False
        assert 'sub_type' in result['error']
        assert 'unknown' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_invalid_sub_type_other_value(self, mock_bot, mock_event):
        """sub_type 为其他值（如 'join'）也应被拒绝。"""
        mock_bot.call_api = AsyncMock()

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag', sub_type='join',
        )

        assert result['success'] is False
        assert 'sub_type' in result['error']


# ---------------------------------------------------------------------------
# 异常处理
# ---------------------------------------------------------------------------

class TestApproveGroupRequestErrors:
    """异常处理场景测试。"""

    @pytest.mark.asyncio
    async def test_action_failed_caught(self, mock_bot, mock_event):
        """ActionFailed 应被捕获并返回错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('请求已处理'))

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag', sub_type='add',
        )

        assert result['success'] is False
        assert '请求已处理' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_permission(self, mock_bot, mock_event):
        """ActionFailed 含权限关键字时返回原始错误。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('权限不足'))

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag', sub_type='invite',
        )

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_general_exception_caught(self, mock_bot, mock_event):
        """普通异常应被捕获并返回 error 字符串。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('连接失败'))

        result = await approve_group_request(
            mock_bot, mock_event, flag='grp_flag', sub_type='add',
        )

        assert result['success'] is False
        assert '连接失败' in result['error']

    @pytest.mark.asyncio
    async def test_reason_none_default_empty(self, mock_bot, mock_event):
        """reason=None 时应被转为空字符串传给 API。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await approve_group_request(
            mock_bot, mock_event,
            flag='grp_flag', sub_type='add', reason=None,
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_add_request',
            flag='grp_flag', sub_type='add', approve=True, reason='',
        )


# ---------------------------------------------------------------------------
# 常量校验
# ---------------------------------------------------------------------------

class TestApproveGroupRequestConstants:
    """模块常量校验测试。"""

    def test_valid_sub_types_constant(self):
        """_VALID_SUB_TYPES 应为 ('add', 'invite')。"""
        assert _VALID_SUB_TYPES == ('add', 'invite')
