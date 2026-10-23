"""message_op(mode='send') 节点单元测试 — 发送消息段。

覆盖：
- dict 消息段发送
- list[dict] 消息段发送
- 空 segments 返回错误
- 非 dict/list 格式返回错误
- bot.send 异常处理
- list 中非 dict 项过滤
- 返回结构完整性

被测源码：qqbat_nodes/builtin/message_op.py

注：message_op(mode='send') 内部 import nonebot.adapters.onebot.v11，
    测试通过 patch.dict(sys.modules) 注入 mock nonebot 模块。
"""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.message_op import message_op


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
        result = await message_op(mock_bot, mock_event, mode='send', segments=None)
        assert result['success'] is False
        assert '不能为空' in result['error']
        mock_bot.send.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_dict_returns_error(self, mock_bot, mock_event):
        """空 dict（falsy）返回错误。"""
        result = await message_op(mock_bot, mock_event, mode='send', segments={})
        assert result['success'] is False
        assert '不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_list_returns_error(self, mock_bot, mock_event):
        """空列表返回错误。"""
        result = await message_op(mock_bot, mock_event, mode='send', segments=[])
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

        result = await message_op(mock_bot, mock_event, mode='send', segments=seg)

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

        result = await message_op(mock_bot, mock_event, mode='send', segments=seg)

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

        result = await message_op(mock_bot, mock_event, mode='send', segments=segs)

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

        result = await message_op(mock_bot, mock_event, mode='send', segments=segs)

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
        result = await message_op(mock_bot, mock_event, mode='send', segments='hello')
        assert result['success'] is False
        assert '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_int_segments_returns_format_error(self, mock_bot, mock_event, mock_nonebot):
        """segments 为 int 时返回格式错误。"""
        result = await message_op(mock_bot, mock_event, mode='send', segments=12345)
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

        result = await message_op(mock_bot, mock_event, mode='send', segments=seg)

        assert result['success'] is False
        assert '参数错误' in result['error']


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

        result = await message_op(mock_bot, mock_event, mode='send', segments=seg)

        assert 'success' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event, mock_nonebot):
        """成功时 error 为空字符串。"""
        seg = {'type': 'text', 'data': {}}
        mock_bot.send = AsyncMock()

        result = await message_op(mock_bot, mock_event, mode='send', segments=seg)
        assert result['error'] == ''
