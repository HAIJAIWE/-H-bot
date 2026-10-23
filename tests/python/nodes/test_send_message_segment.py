"""send_message(mode='segment') 节点单元测试 — 发送消息段。

覆盖：
- dict 消息段发送
- list[dict] 消息段发送
- 空 segments 返回错误
- 非 dict/list 格式返回错误
- bot.send 异常处理
- list 中非 dict 项过滤
- 推送目标（target_type=group/user）调用 call_api
- 返回结构完整性

被测源码：qqbat_nodes/builtin/send_message.py

注：send_message(mode='segment') 内部 import nonebot.adapters.onebot.v11，
    测试通过 patch.dict(sys.modules) 注入 mock nonebot 模块。
"""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.send_message import send_message


@pytest.fixture
def mock_nonebot():
    """Mock nonebot.adapters.onebot.v11 模块，避免依赖真实 nonebot。"""
    mock_module = MagicMock()
    mock_module.MessageSegment = MagicMock()
    mock_module.Message = MagicMock()
    with patch.dict(sys.modules, {
        'nonebot': MagicMock(),
        'nonebot.adapters': MagicMock(),
        'nonebot.adapters.onebot': MagicMock(),
        'nonebot.adapters.onebot.v11': mock_module,
    }):
        yield mock_module


# =============================================================================
# 空 segments
# =============================================================================
class TestEmptySegments:
    """验证空 segments 的错误处理。"""

    @pytest.mark.asyncio
    async def test_none_segments_returns_error(self, mock_bot, mock_event):
        """segments=None 返回错误。"""
        result = await send_message(mock_bot, mock_event, mode='segment', segments=None)
        assert result['success'] is False
        assert '不能为空' in result['error']
        mock_bot.send.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_dict_returns_error(self, mock_bot, mock_event):
        """空 dict（falsy）返回错误。"""
        result = await send_message(mock_bot, mock_event, mode='segment', segments={})
        assert result['success'] is False
        assert '不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_list_returns_error(self, mock_bot, mock_event):
        """空列表返回错误。"""
        result = await send_message(mock_bot, mock_event, mode='segment', segments=[])
        assert result['success'] is False
        assert '不能为空' in result['error']


# =============================================================================
# dict 消息段发送
# =============================================================================
class TestDictSegmentSend:
    """验证 dict 格式消息段发送。"""

    @pytest.mark.asyncio
    async def test_dict_segment_send_success(self, mock_bot, mock_event, mock_nonebot):
        """dict 消息段成功发送。"""
        seg = {'type': 'text', 'data': {'text': 'hello'}}
        mock_bot.send = AsyncMock()

        result = await send_message(mock_bot, mock_event, mode='segment', segments=seg)

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.send.assert_called_once()
        # 验证 MessageSegment 被调用
        mock_nonebot.MessageSegment.assert_called_once_with('text', {'text': 'hello'})

    @pytest.mark.asyncio
    async def test_dict_segment_send_failure(self, mock_bot, mock_event, mock_nonebot):
        """bot.send 抛异常时返回错误。"""
        seg = {'type': 'text', 'data': {'text': 'hello'}}
        mock_bot.send = AsyncMock(side_effect=RuntimeError('发送失败'))

        result = await send_message(mock_bot, mock_event, mode='segment', segments=seg)

        assert result['success'] is False
        assert '发送失败' in result['error']


# =============================================================================
# list 消息段发送
# =============================================================================
class TestListSegmentSend:
    """验证 list[dict] 格式消息段发送。"""

    @pytest.mark.asyncio
    async def test_list_segment_send_success(self, mock_bot, mock_event, mock_nonebot):
        """list 消息段成功发送。"""
        segs = [
            {'type': 'text', 'data': {'text': 'a'}},
            {'type': 'at', 'data': {'qq': '123'}},
        ]
        mock_bot.send = AsyncMock()

        result = await send_message(mock_bot, mock_event, mode='segment', segments=segs)

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.send.assert_called_once()
        # Message 被调用一次
        mock_nonebot.Message.assert_called_once()
        # MessageSegment 被调用两次（两个段）
        assert mock_nonebot.MessageSegment.call_count == 2

    @pytest.mark.asyncio
    async def test_list_with_non_dict_items_filtered(self, mock_bot, mock_event, mock_nonebot):
        """list 中非 dict 项被过滤。"""
        segs = [
            {'type': 'text', 'data': {}},
            'invalid',
            123,
            {'type': 'at', 'data': {'qq': '1'}},
        ]
        mock_bot.send = AsyncMock()

        result = await send_message(mock_bot, mock_event, mode='segment', segments=segs)

        assert result['success'] is True
        # 只有两个 dict 项被处理
        assert mock_nonebot.MessageSegment.call_count == 2


# =============================================================================
# 非法格式
# =============================================================================
class TestInvalidFormat:
    """验证非法格式的处理。"""

    @pytest.mark.asyncio
    async def test_string_segments_returns_format_error(self, mock_bot, mock_event, mock_nonebot):
        """segments 为字符串时返回格式错误。"""
        result = await send_message(mock_bot, mock_event, mode='segment', segments='hello')
        assert result['success'] is False
        assert '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_int_segments_returns_format_error(self, mock_bot, mock_event, mock_nonebot):
        """segments 为 int 时返回格式错误。"""
        result = await send_message(mock_bot, mock_event, mode='segment', segments=12345)
        assert result['success'] is False
        assert '格式错误' in result['error']


# =============================================================================
# bot.send 异常
# =============================================================================
class TestSendException:
    """验证 bot.send 异常时的处理。"""

    @pytest.mark.asyncio
    async def test_send_raises_value_error(self, mock_bot, mock_event, mock_nonebot):
        """bot.send 抛 ValueError 时返回错误。"""
        seg = {'type': 'text', 'data': {}}
        mock_bot.send = AsyncMock(side_effect=ValueError('参数错误'))

        result = await send_message(mock_bot, mock_event, mode='segment', segments=seg)

        assert result['success'] is False
        assert '参数错误' in result['error']


# =============================================================================
# 推送目标
# =============================================================================
class TestPushTarget:
    """验证推送目标模式（target_type + target_id）。"""

    @pytest.mark.asyncio
    async def test_push_to_group(self, mock_bot, mock_event, mock_nonebot):
        """target_type=group 时调用 send_group_msg。"""
        seg = {'type': 'text', 'data': {}}
        mock_bot.call_api = AsyncMock(return_value={'message_id': 100})

        result = await send_message(
            mock_bot, mock_event, mode='segment', segments=seg,
            target_type='group', target_id='999888',
        )

        assert result['success'] is True
        assert result['message_id'] == '100'
        mock_bot.call_api.assert_called_once()
        call_args = mock_bot.call_api.call_args
        assert call_args[0][0] == 'send_group_msg'
        assert call_args[1]['group_id'] == 999888

    @pytest.mark.asyncio
    async def test_push_to_user(self, mock_bot, mock_event, mock_nonebot):
        """target_type=user 时调用 send_private_msg。"""
        seg = {'type': 'text', 'data': {}}
        mock_bot.call_api = AsyncMock(return_value={'message_id': 200})

        result = await send_message(
            mock_bot, mock_event, mode='segment', segments=seg,
            target_type='user', target_id='123456',
        )

        assert result['success'] is True
        assert result['message_id'] == '200'
        mock_bot.call_api.assert_called_once()
        call_args = mock_bot.call_api.call_args
        assert call_args[0][0] == 'send_private_msg'
        assert call_args[1]['user_id'] == 123456


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_success_and_error(self, mock_bot, mock_event, mock_nonebot):
        """返回 dict 必含 success 与 error 字段。"""
        seg = {'type': 'text', 'data': {}}
        mock_bot.send = AsyncMock()

        result = await send_message(mock_bot, mock_event, mode='segment', segments=seg)

        assert 'success' in result
        assert 'error' in result
        assert 'message_id' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event, mock_nonebot):
        """成功时 error 为空字符串。"""
        seg = {'type': 'text', 'data': {}}
        mock_bot.send = AsyncMock()

        result = await send_message(mock_bot, mock_event, mode='segment', segments=seg)
        assert result['error'] == ''
