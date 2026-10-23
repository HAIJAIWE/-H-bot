"""send_batch 节点单元测试 — 批量发送消息。

覆盖：
- 文本消息批量发送
- JSON 字符串解析
- list 直接传入
- 空消息列表返回错误
- 非法格式返回错误
- 部分失败统计（sent/failed/total/errors）
- bot.send 异常处理
- interval 间隔参数
- 返回结构完整性

被测源码：qqbat_nodes/builtin/send_batch.py

注：send_batch._build_message 内部 import nonebot.adapters.onebot.v11，
    dict/list 消息需 mock nonebot；纯文本消息不需要。
"""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.send_batch import send_batch


@pytest.fixture
def mock_nonebot():
    """Mock nonebot.adapters.onebot.v11 模块。"""
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
# 文本消息批量发送
# =============================================================================
class TestTextBatchSend:
    """验证纯文本消息的批量发送。"""

    @pytest.mark.asyncio
    async def test_send_multiple_text_messages(self, mock_bot, mock_event):
        """多条文本消息依次发送。"""
        mock_bot.send = AsyncMock()
        messages = ['hello', 'world', 'foo']

        result = await send_batch(
            mock_bot, mock_event, messages=messages, interval=0,
        )

        assert result['sent'] == 3
        assert result['failed'] == 0
        assert result['total'] == 3
        assert result['errors'] == []
        assert result['error'] == ''
        assert mock_bot.send.call_count == 3

    @pytest.mark.asyncio
    async def test_send_single_text_message(self, mock_bot, mock_event):
        """单条文本消息发送。"""
        mock_bot.send = AsyncMock()

        result = await send_batch(
            mock_bot, mock_event, messages=['only one'], interval=0,
        )

        assert result['sent'] == 1
        assert result['total'] == 1


# =============================================================================
# JSON 字符串解析
# =============================================================================
class TestJsonStringParse:
    """验证 JSON 字符串消息列表解析。"""

    @pytest.mark.asyncio
    async def test_valid_json_string(self, mock_bot, mock_event):
        """合法 JSON 字符串解析为 list 后发送。"""
        mock_bot.send = AsyncMock()
        import json
        messages = json.dumps(['a', 'b'])

        result = await send_batch(
            mock_bot, mock_event, messages=messages, interval=0,
        )

        assert result['sent'] == 2
        assert result['total'] == 2

    @pytest.mark.asyncio
    async def test_invalid_json_string(self, mock_bot, mock_event):
        """非法 JSON 字符串返回错误。"""
        result = await send_batch(
            mock_bot, mock_event, messages='not a json', interval=0,
        )

        assert result['sent'] == 0
        assert result['total'] == 0
        assert result['error'] != ''


# =============================================================================
# 空消息列表
# =============================================================================
class TestEmptyMessages:
    """验证空消息列表的处理。"""

    @pytest.mark.asyncio
    async def test_empty_list(self, mock_bot, mock_event):
        """空列表返回错误。"""
        result = await send_batch(
            mock_bot, mock_event, messages=[], interval=0,
        )

        assert result['sent'] == 0
        assert result['total'] == 0
        assert '为空' in result['error']
        mock_bot.send.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_string(self, mock_bot, mock_event):
        """空字符串返回错误（JSON 解析为空）。"""
        # 空字符串 json.loads 会抛 JSONDecodeError
        result = await send_batch(
            mock_bot, mock_event, messages='', interval=0,
        )

        assert result['sent'] == 0
        assert result['error'] != ''


# =============================================================================
# 非法格式
# =============================================================================
class TestInvalidFormat:
    """验证非法格式的处理。"""

    @pytest.mark.asyncio
    async def test_int_messages(self, mock_bot, mock_event):
        """messages 为 int 时返回格式错误。"""
        result = await send_batch(
            mock_bot, mock_event, messages=12345, interval=0,
        )

        assert result['sent'] == 0
        assert '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_dict_messages(self, mock_bot, mock_event):
        """messages 为 dict 时返回格式错误（JSON 解析后非 list）。"""
        result = await send_batch(
            mock_bot, mock_event, messages={'key': 'val'}, interval=0,
        )

        assert result['sent'] == 0
        assert '为空' in result['error'] or '格式错误' in result['error']


# =============================================================================
# 部分失败
# =============================================================================
class TestPartialFailure:
    """验证部分消息发送失败时的统计。"""

    @pytest.mark.asyncio
    async def test_some_messages_fail(self, mock_bot, mock_event):
        """部分消息发送失败时正确统计 sent/failed。"""
        mock_bot.send = AsyncMock(side_effect=[
            None,  # 第一条成功
            RuntimeError('发送失败'),  # 第二条失败
            None,  # 第三条成功
        ])

        result = await send_batch(
            mock_bot, mock_event, messages=['a', 'b', 'c'], interval=0,
        )

        assert result['sent'] == 2
        assert result['failed'] == 1
        assert result['total'] == 3
        assert len(result['errors']) == 1
        assert '第 2 条' in result['errors'][0]

    @pytest.mark.asyncio
    async def test_all_messages_fail(self, mock_bot, mock_event):
        """所有消息发送失败时 failed=total。"""
        mock_bot.send = AsyncMock(side_effect=RuntimeError('error'))

        result = await send_batch(
            mock_bot, mock_event, messages=['a', 'b'], interval=0,
        )

        assert result['sent'] == 0
        assert result['failed'] == 2
        assert result['total'] == 2
        assert len(result['errors']) == 2


# =============================================================================
# 消息段发送（需 mock nonebot）
# =============================================================================
class TestSegmentMessages:
    """验证 dict/list 消息段的批量发送。"""

    @pytest.mark.asyncio
    async def test_send_dict_messages(self, mock_bot, mock_event, mock_nonebot):
        """dict 消息段批量发送。"""
        mock_bot.send = AsyncMock()
        messages = [
            {'type': 'text', 'data': {'text': 'a'}},
            {'type': 'at', 'data': {'qq': '1'}},
        ]

        result = await send_batch(
            mock_bot, mock_event, messages=messages, interval=0,
        )

        assert result['sent'] == 2
        assert mock_nonebot.MessageSegment.call_count == 2

    @pytest.mark.asyncio
    async def test_send_list_messages(self, mock_bot, mock_event, mock_nonebot):
        """list 消息段批量发送。"""
        mock_bot.send = AsyncMock()
        messages = [
            [{'type': 'text', 'data': {}}],
            [{'type': 'at', 'data': {}}, {'type': 'text', 'data': {}}],
        ]

        result = await send_batch(
            mock_bot, mock_event, messages=messages, interval=0,
        )

        assert result['sent'] == 2


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_fields(self, mock_bot, mock_event):
        """返回 dict 必含 sent/failed/total/errors/error 字段。"""
        mock_bot.send = AsyncMock()

        result = await send_batch(
            mock_bot, mock_event, messages=['a'], interval=0,
        )

        assert set(result.keys()) == {'sent', 'failed', 'total', 'errors', 'error'}

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        mock_bot.send = AsyncMock()

        result = await send_batch(
            mock_bot, mock_event, messages=['a'], interval=0,
        )
        assert result['error'] == ''
