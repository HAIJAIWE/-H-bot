"""essence_msg 节点单元测试 — 设置精华消息。

覆盖：
- 正常设置精华消息
- 从事件回退取 message_id
- message_id 为空时返回错误
- 适配器不支持时返回友好错误
- 通用异常处理
- API 调用参数验证
- 返回结构完整性

被测源码：qqbat_nodes/builtin/essence_msg.py

注：essence_msg 调用 check_adapter_support 检测官方适配器。
    MagicMock/AsyncMock 默认自动生成 _openid / _qqbat_official 属性（truthy），
    会误判为官方适配器。需用 napcat_mode fixture 显式置空这些属性。
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.essence_msg import essence_msg


@pytest.fixture
def napcat_mode(mock_bot, mock_event):
    """配置 mock 为 NapCat 模式（非官方适配器），绕过适配器检测。

    MagicMock/AsyncMock 会自动生成 _openid / _qqbat_official 属性（truthy），
    导致 is_official_adapter 误判为官方适配器。此 fixture 显式置空。
    """
    mock_event._openid = None
    mock_bot._qqbat_official = False
    return mock_bot, mock_event


# =============================================================================
# 正常设置精华
# =============================================================================
class TestEssenceSuccess:
    """验证设置精华消息的正常路径。"""

    @pytest.mark.asyncio
    async def test_set_essence_with_explicit_message_id(self, napcat_mode):
        """显式传入 message_id 时调用 set_essence_msg API。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await essence_msg(mock_bot, mock_event, message_id=12345)

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with('set_essence_msg', message_id=12345)

    @pytest.mark.asyncio
    async def test_set_essence_fallback_to_event(self, napcat_mode):
        """message_id 为空时从事件取 message_id。"""
        mock_bot, mock_event = napcat_mode
        mock_event.message_id = 99999
        mock_bot.call_api = AsyncMock(return_value={})

        result = await essence_msg(mock_bot, mock_event, message_id=0)

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with('set_essence_msg', message_id=99999)

    @pytest.mark.asyncio
    async def test_set_essence_message_id_string(self, napcat_mode):
        """message_id 为字符串时转为 int。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await essence_msg(mock_bot, mock_event, message_id='88888')

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with('set_essence_msg', message_id=88888)


# =============================================================================
# 参数缺失
# =============================================================================
class TestMissingMessageId:
    """验证 message_id 缺失时的错误处理。"""

    @pytest.mark.asyncio
    async def test_empty_message_id_returns_error(self, napcat_mode):
        """message_id 为空且事件无 message_id 时返回错误。"""
        mock_bot, mock_event = napcat_mode
        mock_event.message_id = 0

        result = await essence_msg(mock_bot, mock_event, message_id=0)

        assert result['success'] is False
        assert 'message_id 不能为空' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# 适配器不支持
# =============================================================================
class TestAdapterUnsupported:
    """验证 QQ 官方适配器不支持精华消息时的友好错误。"""

    @pytest.mark.asyncio
    async def test_official_adapter_returns_unsupported(self, mock_bot, mock_event):
        """事件含 _openid（官方适配器标记）时返回不支持错误。"""
        mock_event._openid = 'some_openid_value'

        result = await essence_msg(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '不支持' in result['error']
        assert 'essence_msg' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_official_adapter_via_bot_flag(self, mock_bot, mock_event):
        """bot 含 _qqbat_official 标记时返回不支持错误。"""
        mock_event._openid = None
        mock_bot._qqbat_official = True

        result = await essence_msg(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '不支持' in result['error']


# =============================================================================
# 通用异常
# =============================================================================
class TestGenericException:
    """验证通用异常的处理。"""

    @pytest.mark.asyncio
    async def test_api_raises_runtime_error(self, napcat_mode):
        """API 抛 RuntimeError 时返回错误信息。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络超时'))

        result = await essence_msg(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '网络超时' in result['error']

    @pytest.mark.asyncio
    async def test_api_raises_value_error(self, napcat_mode):
        """API 抛 ValueError 时返回错误信息。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(side_effect=ValueError('参数错误'))

        result = await essence_msg(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '参数错误' in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_success_and_error(self, napcat_mode):
        """返回 dict 必含 success 与 error 字段。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await essence_msg(mock_bot, mock_event, message_id=1)

        assert 'success' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, napcat_mode):
        """成功时 error 为空字符串。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await essence_msg(mock_bot, mock_event, message_id=1)
        assert result['error'] == ''
