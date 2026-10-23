"""send_group_notice 节点单元测试 — 发布群公告。

覆盖：
- 正常发布群公告
- content 为空返回错误
- group_id 为空时回退取当前群
- 非群聊场景（无 group_id）返回错误
- image 可选参数
- ActionFailed 权限不足处理
- ActionFailed 其他错误
- 通用异常处理
- API 调用参数验证
- 返回结构完整性

被测源码：qqbat_nodes/builtin/send_group_notice.py
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.send_group_notice import send_group_notice


# =============================================================================
# 正常发布
# =============================================================================
class TestSendNoticeSuccess:
    """验证群公告发布的正常路径。"""

    @pytest.mark.asyncio
    async def test_send_notice_with_explicit_group_id(self, mock_bot, mock_event):
        """显式传入 group_id 时调用 _send_group_notice API。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await send_group_notice(
            mock_bot, mock_event, group_id='12345', content='公告内容',
        )

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with(
            '_send_group_notice', group_id=12345, content='公告内容', image=None,
        )

    @pytest.mark.asyncio
    async def test_send_notice_fallback_to_event_group(self, mock_bot, mock_event):
        """group_id 为空时回退取当前群。"""
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value={})

        result = await send_group_notice(
            mock_bot, mock_event, group_id='', content='公告',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            '_send_group_notice', group_id=67890, content='公告', image=None,
        )

    @pytest.mark.asyncio
    async def test_send_notice_with_image(self, mock_bot, mock_event):
        """image 参数传入时调用 API 含 image。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
            image='https://img.com/1.png',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            '_send_group_notice', group_id=1, content='公告',
            image='https://img.com/1.png',
        )


# =============================================================================
# 参数缺失
# =============================================================================
class TestMissingParams:
    """验证参数缺失时的错误处理。"""

    @pytest.mark.asyncio
    async def test_empty_content_returns_error(self, mock_bot, mock_event):
        """content 为空时返回错误。"""
        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='',
        )
        assert result['success'] is False
        assert 'content 不能为空' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_whitespace_content_returns_error(self, mock_bot, mock_event):
        """content 为纯空白时返回错误。"""
        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='   ',
        )
        assert result['success'] is False
        assert 'content 不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_none_content_returns_error(self, mock_bot, mock_event):
        """content=None 时返回错误。"""
        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content=None,
        )
        assert result['success'] is False

    @pytest.mark.asyncio
    async def test_no_group_id_no_event_group(self, mock_bot, mock_event):
        """group_id 为空且事件无 group_id 时返回错误。"""
        mock_event.group_id = ''
        result = await send_group_notice(
            mock_bot, mock_event, group_id='', content='公告',
        )
        assert result['success'] is False
        assert 'group_id 不能为空' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# ActionFailed 异常
# =============================================================================
class TestActionFailed:
    """验证 ActionFailed 异常的细分处理。"""

    @pytest.mark.asyncio
    async def test_permission_denied_1300(self, mock_bot, mock_event):
        """ActionFailed 含 1300 时返回权限不足错误。"""
        mock_bot.call_api = AsyncMock(
            side_effect=Exception('retcode=1300 权限不足')
        )

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
        )

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_permission_denied_chinese(self, mock_bot, mock_event):
        """ActionFailed 含 '权限' 中文时返回权限不足错误。"""
        mock_bot.call_api = AsyncMock(side_effect=Exception('权限不足'))

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
        )

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_other_action_failed(self, mock_bot, mock_event):
        """ActionFailed 其他错误时返回原始错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=Exception('频率限制'))

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
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
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络超时'))

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
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
        mock_bot.call_api = AsyncMock(return_value={})

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
        )

        assert 'success' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await send_group_notice(
            mock_bot, mock_event, group_id='1', content='公告',
        )
        assert result['error'] == ''
