"""relay_message 节点单元测试 — 跨群转发消息。

覆盖：
- 正常转发消息
- prefix 前缀添加
- target_group_id 为空返回错误
- 消息内容为空返回错误
- 从 raw_message 取消息内容
- raw_message 为空时回退取 message
- ActionFailed 权限不足/不在群处理
- ActionFailed 其他错误
- 通用异常处理
- API 调用参数验证
- 返回结构完整性

被测源码：qqbat_nodes/builtin/relay_message.py
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from qqbat_nodes.builtin.relay_message import relay_message


# =============================================================================
# 正常转发
# =============================================================================
class TestRelaySuccess:
    """验证消息转发的正常路径。"""

    @pytest.mark.asyncio
    async def test_relay_with_raw_message(self, mock_bot, mock_event):
        """正常转发 raw_message 内容。"""
        mock_event.raw_message = 'hello world'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with(
            'send_group_msg', group_id=12345, message='hello world',
        )

    @pytest.mark.asyncio
    async def test_relay_with_prefix(self, mock_bot, mock_event):
        """prefix 参数添加前缀。"""
        mock_event.raw_message = '原消息'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345, prefix='[转发] ',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'send_group_msg', group_id=12345, message='[转发] 原消息',
        )

    @pytest.mark.asyncio
    async def test_relay_fallback_to_message(self, mock_bot, mock_event):
        """raw_message 为空时回退取 event.message。"""
        mock_event.raw_message = ''
        mock_event.message = 'fallback message'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'send_group_msg', group_id=12345, message='fallback message',
        )

    @pytest.mark.asyncio
    async def test_relay_target_group_id_string(self, mock_bot, mock_event):
        """target_group_id 为字符串时转为 int。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await relay_message(
            mock_bot, mock_event, target_group_id='12345',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'send_group_msg', group_id=12345, message='hello',
        )


# =============================================================================
# 参数缺失
# =============================================================================
class TestMissingParams:
    """验证参数缺失时的错误处理。"""

    @pytest.mark.asyncio
    async def test_empty_target_group_id(self, mock_bot, mock_event):
        """target_group_id=0 时返回错误。"""
        mock_event.raw_message = 'hello'

        result = await relay_message(
            mock_bot, mock_event, target_group_id=0,
        )

        assert result['success'] is False
        assert 'target_group_id 为空' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_negative_target_group_id(self, mock_bot, mock_event):
        """target_group_id 为负数时返回错误。"""
        mock_event.raw_message = 'hello'

        result = await relay_message(
            mock_bot, mock_event, target_group_id=-1,
        )

        assert result['success'] is False
        assert 'target_group_id 为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_message_content(self, mock_bot, mock_event):
        """消息内容为空时返回错误。"""
        mock_event.raw_message = ''
        mock_event.message = ''

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is False
        assert '消息内容为空' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# ActionFailed 异常
# =============================================================================
class TestActionFailed:
    """验证 ActionFailed 异常的细分处理。"""

    @pytest.mark.asyncio
    async def test_permission_denied_1300(self, mock_bot, mock_event):
        """ActionFailed 含 1300 时返回不在群/被禁言错误。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(
            side_effect=Exception('retcode=1300 权限不足')
        )

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is False
        assert '不在目标群' in result['error'] or '被禁言' in result['error']

    @pytest.mark.asyncio
    async def test_permission_denied_chinese(self, mock_bot, mock_event):
        """ActionFailed 含 '权限' 中文时返回不在群/被禁言错误。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(side_effect=Exception('权限不足'))

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is False
        assert '不在目标群' in result['error'] or '被禁言' in result['error']

    @pytest.mark.asyncio
    async def test_other_action_failed(self, mock_bot, mock_event):
        """ActionFailed 其他错误时返回原始错误信息。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(side_effect=Exception('频率限制'))

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is False
        assert '频率限制' in result['error']


# =============================================================================
# 通用异常
# =============================================================================
class TestGenericException:
    """验证通用异常的处理。"""

    @pytest.mark.asyncio
    async def test_runtime_error(self, mock_bot, mock_event):
        """RuntimeError 被捕获并返回错误信息。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络超时'))

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert result['success'] is False
        assert '网络超时' in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_success_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 success 与 error 字段。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )

        assert 'success' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        mock_event.raw_message = 'hello'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await relay_message(
            mock_bot, mock_event, target_group_id=12345,
        )
        assert result['error'] == ''
