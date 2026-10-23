"""send_to 节点单元测试 — 主动发消息。

覆盖：
- 私聊发送（send_private_msg）
- 群聊发送（send_group_msg）
- 文本消息 / dict 消息段 / list 消息段
- user_id 为空返回错误
- group_id 为空返回错误
- API 返回 dict 提取 message_id
- API 返回对象提取 message_id
- API 异常处理
- message_type 大小写不敏感
- result 字段向后兼容
- 返回结构完整性

被测源码：qqbat_nodes/builtin/send_to.py

注：send_to._build_message 内部 import nonebot.adapters.onebot.v11，
    dict/list 消息需 mock nonebot；纯文本消息不需要。
"""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.send_to import send_to, _build_message


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
# 私聊发送
# =============================================================================
class TestPrivateSend:
    """验证私聊消息发送。"""

    @pytest.mark.asyncio
    async def test_send_private_text_success(self, mock_bot, mock_event):
        """文本消息发送到私聊，调用 send_private_msg。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 100})

        result = await send_to(
            mock_bot, mock_event, user_id='12345', message='hello',
            message_type='private',
        )

        assert result['success'] is True
        assert result['message_id'] == 100
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with(
            'send_private_msg', user_id=12345, message='hello',
        )

    @pytest.mark.asyncio
    async def test_send_private_default_type(self, mock_bot, mock_event):
        """不传 message_type 时默认 private。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 1})

        result = await send_to(mock_bot, mock_event, user_id='123', message='hi')

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'send_private_msg', user_id=123, message='hi',
        )

    @pytest.mark.asyncio
    async def test_send_private_empty_user_id(self, mock_bot, mock_event):
        """私聊 user_id 为空时返回错误。"""
        result = await send_to(
            mock_bot, mock_event, user_id='', message='hi', message_type='private',
        )

        assert result['success'] is False
        assert 'user_id 为空' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# 群聊发送
# =============================================================================
class TestGroupSend:
    """验证群聊消息发送。"""

    @pytest.mark.asyncio
    async def test_send_group_text_success(self, mock_bot, mock_event):
        """文本消息发送到群聊，调用 send_group_msg。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 200})

        result = await send_to(
            mock_bot, mock_event, group_id='67890', message='hello',
            message_type='group',
        )

        assert result['success'] is True
        assert result['message_id'] == 200
        mock_bot.call_api.assert_called_once_with(
            'send_group_msg', group_id=67890, message='hello',
        )

    @pytest.mark.asyncio
    async def test_send_group_empty_group_id(self, mock_bot, mock_event):
        """群聊 group_id 为空时返回错误。"""
        result = await send_to(
            mock_bot, mock_event, group_id='', message='hi', message_type='group',
        )

        assert result['success'] is False
        assert 'group_id 为空' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# 消息类型
# =============================================================================
class TestMessageType:
    """验证消息类型参数处理。"""

    @pytest.mark.asyncio
    async def test_message_type_case_insensitive(self, mock_bot, mock_event):
        """message_type 大小写不敏感。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 1})

        result = await send_to(
            mock_bot, mock_event, group_id='1', message='hi', message_type='GROUP',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'send_group_msg', group_id=1, message='hi',
        )

    @pytest.mark.asyncio
    async def test_message_type_none_defaults_private(self, mock_bot, mock_event):
        """message_type=None 默认 private。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 1})

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'send_private_msg', user_id=1, message='hi',
        )


# =============================================================================
# 消息段发送（需 mock nonebot）
# =============================================================================
class TestSegmentMessage:
    """验证 dict/list 消息段发送。"""

    @pytest.mark.asyncio
    async def test_send_dict_message(self, mock_bot, mock_event, mock_nonebot):
        """dict 消息段发送到私聊。"""
        seg = {'type': 'at', 'data': {'qq': '123'}}
        mock_bot.call_api = AsyncMock(return_value={'message_id': 1})

        result = await send_to(
            mock_bot, mock_event, user_id='1', message=seg, message_type='private',
        )

        assert result['success'] is True
        mock_nonebot.MessageSegment.assert_called_once_with('at', {'qq': '123'})

    @pytest.mark.asyncio
    async def test_send_list_message(self, mock_bot, mock_event, mock_nonebot):
        """list 消息段发送到群聊。"""
        segs = [
            {'type': 'text', 'data': {'text': 'a'}},
            {'type': 'at', 'data': {'qq': '1'}},
        ]
        mock_bot.call_api = AsyncMock(return_value={'message_id': 1})

        result = await send_to(
            mock_bot, mock_event, group_id='1', message=segs, message_type='group',
        )

        assert result['success'] is True
        assert mock_nonebot.MessageSegment.call_count == 2


# =============================================================================
# message_id 提取
# =============================================================================
class TestMessageIdExtraction:
    """验证 API 返回值的 message_id 提取。"""

    @pytest.mark.asyncio
    async def test_dict_response_with_message_id(self, mock_bot, mock_event):
        """API 返回 dict 含 message_id 时正确提取。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 999})

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['message_id'] == 999

    @pytest.mark.asyncio
    async def test_dict_response_without_message_id(self, mock_bot, mock_event):
        """API 返回 dict 不含 message_id 时默认 0。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['message_id'] == 0

    @pytest.mark.asyncio
    async def test_object_response_with_message_id(self, mock_bot, mock_event):
        """API 返回对象（含 message_id 属性）时正确提取。"""
        resp = MagicMock()
        resp.message_id = 555
        mock_bot.call_api = AsyncMock(return_value=resp)

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['message_id'] == 555

    @pytest.mark.asyncio
    async def test_none_response(self, mock_bot, mock_event):
        """API 返回 None 时 message_id=0。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['message_id'] == 0


# =============================================================================
# 异常处理
# =============================================================================
class TestExceptionHandling:
    """验证 API 异常时的处理。"""

    @pytest.mark.asyncio
    async def test_api_raises_runtime_error(self, mock_bot, mock_event):
        """API 抛 RuntimeError 时返回错误。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络错误'))

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['success'] is False
        assert result['message_id'] == 0
        assert '网络错误' in result['error']


# =============================================================================
# 向后兼容
# =============================================================================
class TestBackwardCompat:
    """验证 result 字段向后兼容。"""

    @pytest.mark.asyncio
    async def test_result_field_matches_success(self, mock_bot, mock_event):
        """result 字段与 success 同值。"""
        mock_bot.call_api = AsyncMock(return_value={'message_id': 1})

        result = await send_to(mock_bot, mock_event, user_id='1', message='hi')

        assert result['result'] is True
        assert result['success'] is True

    @pytest.mark.asyncio
    async def test_result_field_on_failure(self, mock_bot, mock_event):
        """失败时 result=False。"""
        result = await send_to(
            mock_bot, mock_event, user_id='', message='hi', message_type='private',
        )

        assert result['result'] is False
        assert result['success'] is False


# =============================================================================
# _build_message 辅助函数
# =============================================================================
class TestBuildMessage:
    """验证 _build_message 辅助函数。"""

    def test_string_message(self):
        """字符串消息原样返回。"""
        assert _build_message('hello') == 'hello'

    def test_int_message(self):
        """int 消息转为 str。"""
        assert _build_message(123) == '123'

    def test_dict_message_with_nonebot(self, mock_nonebot):
        """dict 消息调用 MessageSegment。"""
        seg = {'type': 'text', 'data': {'text': 'a'}}
        _build_message(seg)
        mock_nonebot.MessageSegment.assert_called_once_with('text', {'text': 'a'})

    def test_list_message_with_nonebot(self, mock_nonebot):
        """list 消息调用 Message。"""
        segs = [{'type': 'text', 'data': {}}, {'type': 'at', 'data': {}}]
        _build_message(segs)
        assert mock_nonebot.MessageSegment.call_count == 2
