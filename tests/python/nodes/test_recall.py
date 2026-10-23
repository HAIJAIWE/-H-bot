"""recall 节点单元测试 — 消息撤回。

覆盖：
- 正常撤回（显式 message_id）
- 从事件回退取 message_id
- message_id 为空时返回错误
- 适配器不支持时返回友好错误
- ActionFailed 权限不足处理
- ActionFailed 其他错误
- 通用异常处理
- API 调用参数验证

被测源码：qqbat_nodes/builtin/recall.py

注：recall 调用 check_adapter_support 检测官方适配器。
    MagicMock/AsyncMock 默认自动生成 _openid / _qqbat_official 属性（truthy），
    会误判为官方适配器。需用 napcat_mode fixture 显式置空这些属性。
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.recall import recall


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
# 正常撤回
# =============================================================================
class TestRecallSuccess:
    """验证撤回成功的正常路径。"""

    @pytest.mark.asyncio
    async def test_recall_with_explicit_message_id(self, napcat_mode):
        """显式传入 message_id 时调用 delete_msg API。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await recall(mock_bot, mock_event, message_id=12345)

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with('delete_msg', message_id=12345)

    @pytest.mark.asyncio
    async def test_recall_fallback_to_event(self, napcat_mode):
        """message_id 为空时从事件取 message_id。"""
        mock_bot, mock_event = napcat_mode
        mock_event.message_id = 99999
        mock_bot.call_api = AsyncMock(return_value={})

        result = await recall(mock_bot, mock_event, message_id=0)

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with('delete_msg', message_id=99999)

    @pytest.mark.asyncio
    async def test_recall_message_id_string_converted_to_int(self, napcat_mode):
        """message_id 为字符串时应转为 int 传给 API。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await recall(mock_bot, mock_event, message_id='88888')

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with('delete_msg', message_id=88888)


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

        result = await recall(mock_bot, mock_event, message_id=0)

        assert result['success'] is False
        assert 'message_id 不能为空' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# 适配器支持（官方适配器现在支持撤回自身消息）
# =============================================================================
class TestAdapterSupported:
    """验证 QQ 官方适配器现在支持撤回（通过 delete_msg 桥接到 recallOfficialMessage）。

    历史背景：recall 曾经在官方适配器下被标记为不支持，check_adapter_support 返回错误。
    现已改为支持（_OFFICIAL_FEATURE_SUPPORT['recall'] = True），OneBotTranslator 的
    delete_msg case 会桥接到 recallOfficialMessage 撤回自身发送的消息。
    """

    @pytest.mark.asyncio
    async def test_official_adapter_proceeds_to_delete_msg(self, mock_bot, mock_event):
        """事件含 _openid（官方适配器标记）时仍继续执行 delete_msg 调用。"""
        mock_event._openid = 'some_openid_value'
        mock_bot.call_api = AsyncMock(return_value={})

        result = await recall(mock_bot, mock_event, message_id=12345)

        # 官方适配器现在支持撤回，应继续调用 delete_msg
        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with('delete_msg', message_id=12345)

    @pytest.mark.asyncio
    async def test_official_adapter_via_bot_flag_proceeds(self, mock_bot, mock_event):
        """bot 含 _qqbat_official 标记时仍继续执行 delete_msg 调用。"""
        mock_event._openid = None
        mock_bot._qqbat_official = True
        mock_bot.call_api = AsyncMock(return_value={})

        result = await recall(mock_bot, mock_event, message_id=12345)

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with('delete_msg', message_id=12345)


# =============================================================================
# ActionFailed 异常
# =============================================================================
class TestActionFailed:
    """验证 ActionFailed 异常的细分处理。"""

    @pytest.mark.asyncio
    async def test_permission_denied_error(self, napcat_mode):
        """ActionFailed 含 1300 时返回权限不足错误。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(side_effect=Exception('retcode=1300 权限不足'))

        result = await recall(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_permission_denied_chinese_keyword(self, napcat_mode):
        """ActionFailed 含 '权限' 中文时返回权限不足错误。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(side_effect=Exception('操作失败，权限不足'))

        result = await recall(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_other_action_failed_error(self, napcat_mode):
        """ActionFailed 其他错误时返回原始错误信息。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(side_effect=Exception('消息不存在'))

        result = await recall(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '消息不存在' in result['error']


# =============================================================================
# 通用异常
# =============================================================================
class TestGenericException:
    """验证通用异常的处理。"""

    @pytest.mark.asyncio
    async def test_runtime_error_returns_error(self, napcat_mode):
        """RuntimeError 异常被捕获并返回错误信息。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络超时'))

        result = await recall(mock_bot, mock_event, message_id=12345)

        assert result['success'] is False
        assert '网络超时' in result['error']


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

        result = await recall(mock_bot, mock_event, message_id=1)

        assert 'success' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, napcat_mode):
        """成功时 error 为空字符串。"""
        mock_bot, mock_event = napcat_mode
        mock_bot.call_api = AsyncMock(return_value={})

        result = await recall(mock_bot, mock_event, message_id=1)
        assert result['error'] == ''
