"""debug_log 节点单元测试。

被测源码：qqbat_nodes/builtin/debug_log.py

覆盖：
- 4 种日志级别（debug/info/warning/error）调用对应 logger 方法
- 默认级别为 debug
- message / value 参数组合（仅 message / message+value / 仅 value）
- value 的 repr 格式化（value={value!r}）
- 未知级别回退到 debug
- 日志失败不影响流程（返回 logged=False + error）
- 返回结构完整性

返回 dict 结构：
- 成功: {"logged": True, "error": ""}
- 失败: {"logged": False, "error": str(e)}
"""
from unittest.mock import patch, MagicMock

import pytest

from qqbat_nodes.builtin import debug_log as debug_log_module
from qqbat_nodes.builtin.debug_log import debug_log


# =============================================================================
# 日志级别
# =============================================================================
class TestLogLevel:
    """验证 4 种日志级别调用对应 logger 方法。"""

    @pytest.mark.asyncio
    async def test_debug_level_calls_logger_debug(self, mock_bot, mock_event):
        """level='debug' 调用 logger.debug。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            logger_mock.info = MagicMock()
            logger_mock.warning = MagicMock()
            logger_mock.error = MagicMock()
            await debug_log(mock_bot, mock_event, message='测试', level='debug')
            logger_mock.debug.assert_called_once()
            logger_mock.info.assert_not_called()

    @pytest.mark.asyncio
    async def test_info_level_calls_logger_info(self, mock_bot, mock_event):
        """level='info' 调用 logger.info。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            logger_mock.info = MagicMock()
            logger_mock.warning = MagicMock()
            logger_mock.error = MagicMock()
            await debug_log(mock_bot, mock_event, message='信息', level='info')
            logger_mock.info.assert_called_once()
            logger_mock.debug.assert_not_called()

    @pytest.mark.asyncio
    async def test_warning_level_calls_logger_warning(self, mock_bot, mock_event):
        """level='warning' 调用 logger.warning。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            logger_mock.info = MagicMock()
            logger_mock.warning = MagicMock()
            logger_mock.error = MagicMock()
            await debug_log(mock_bot, mock_event, message='警告', level='warning')
            logger_mock.warning.assert_called_once()

    @pytest.mark.asyncio
    async def test_error_level_calls_logger_error(self, mock_bot, mock_event):
        """level='error' 调用 logger.error。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            logger_mock.info = MagicMock()
            logger_mock.warning = MagicMock()
            logger_mock.error = MagicMock()
            await debug_log(mock_bot, mock_event, message='错误', level='error')
            logger_mock.error.assert_called_once()

    @pytest.mark.asyncio
    async def test_default_level_is_debug(self, mock_bot, mock_event):
        """不传 level 时默认为 'debug'。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='默认')
            logger_mock.debug.assert_called_once()

    @pytest.mark.asyncio
    async def test_unknown_level_falls_back_to_debug(self, mock_bot, mock_event):
        """未知 level 回退到 debug。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            logger_mock.info = MagicMock()
            await debug_log(mock_bot, mock_event, message='未知', level='unknown')
            logger_mock.debug.assert_called_once()
            logger_mock.info.assert_not_called()


# =============================================================================
# 消息格式化
# =============================================================================
class TestMessageFormat:
    """验证日志消息的格式化逻辑。"""

    @pytest.mark.asyncio
    async def test_message_only(self, mock_bot, mock_event):
        """仅 message 参数：日志为 '[debug_log] {message}'。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='hello', level='debug')
            logged_msg = logger_mock.debug.call_args.args[0]
            assert logged_msg == '[debug_log] hello'

    @pytest.mark.asyncio
    async def test_message_with_value(self, mock_bot, mock_event):
        """message + value：日志含 'value={value!r}' 后缀。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(
                mock_bot, mock_event, message='data', value=42, level='debug',
            )
            logged_msg = logger_mock.debug.call_args.args[0]
            assert '[debug_log] data' in logged_msg
            assert 'value=42' in logged_msg

    @pytest.mark.asyncio
    async def test_value_repr_format(self, mock_bot, mock_event):
        """value 用 repr 格式化（字符串带引号）。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(
                mock_bot, mock_event, message='m', value='text', level='debug',
            )
            logged_msg = logger_mock.debug.call_args.args[0]
            # repr('text') == "'text'"
            assert "value='text'" in logged_msg

    @pytest.mark.asyncio
    async def test_value_none_not_appended(self, mock_bot, mock_event):
        """value=None 时不追加 value= 后缀。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(
                mock_bot, mock_event, message='only msg', value=None, level='debug',
            )
            logged_msg = logger_mock.debug.call_args.args[0]
            assert 'value=' not in logged_msg
            assert logged_msg == '[debug_log] only msg'

    @pytest.mark.asyncio
    async def test_empty_message(self, mock_bot, mock_event):
        """空 message：日志为 '[debug_log] '。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='', level='debug')
            logged_msg = logger_mock.debug.call_args.args[0]
            assert logged_msg == '[debug_log] '


# =============================================================================
# 返回结构
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_logged_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 logged 和 error 两个字段。"""
        with patch.object(debug_log_module, 'logger'):
            result = await debug_log(mock_bot, mock_event, message='x')
        assert set(result.keys()) == {'logged', 'error'}

    @pytest.mark.asyncio
    async def test_logged_is_true_on_success(self, mock_bot, mock_event):
        """成功时 logged=True。"""
        with patch.object(debug_log_module, 'logger'):
            result = await debug_log(mock_bot, mock_event, message='x')
        assert result['logged'] is True

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        with patch.object(debug_log_module, 'logger'):
            result = await debug_log(mock_bot, mock_event, message='x')
        assert result['error'] == ''


# =============================================================================
# 异常容错
# =============================================================================
class TestExceptionHandling:
    """验证日志失败时不中断流程。"""

    @pytest.mark.asyncio
    async def test_log_fn_raises_returns_error(self, mock_bot, mock_event):
        """logger 方法抛异常 → 返回 logged=False + error 信息。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock(side_effect=RuntimeError('log fail'))
            result = await debug_log(
                mock_bot, mock_event, message='x', level='debug',
            )
        assert result['logged'] is False
        assert 'log fail' in result['error']


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaults:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_no_args_uses_defaults(self, mock_bot, mock_event):
        """完全不传业务参数：message='', value=None, level='debug'。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            result = await debug_log(mock_bot, mock_event)
        assert result['logged'] is True
        # 应调用 debug（默认级别）
        logger_mock.debug.assert_called_once()
        # 日志内容为 '[debug_log] '（message 为空）
        logged_msg = logger_mock.debug.call_args.args[0]
        assert logged_msg == '[debug_log] '

    @pytest.mark.asyncio
    async def test_only_message_provided(self, mock_bot, mock_event):
        """只传 message，其他用默认值。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='only')
        logger_mock.debug.assert_called_once_with('[debug_log] only')


# =============================================================================
# 各类 value 类型
# =============================================================================
class TestValueTypes:
    """验证不同类型 value 的 repr 格式化。"""

    @pytest.mark.asyncio
    async def test_value_int(self, mock_bot, mock_event):
        """value 为整数。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='m', value=100)
        logged_msg = logger_mock.debug.call_args.args[0]
        assert 'value=100' in logged_msg

    @pytest.mark.asyncio
    async def test_value_list(self, mock_bot, mock_event):
        """value 为列表。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='m', value=[1, 2, 3])
        logged_msg = logger_mock.debug.call_args.args[0]
        assert 'value=[1, 2, 3]' in logged_msg

    @pytest.mark.asyncio
    async def test_value_dict(self, mock_bot, mock_event):
        """value 为字典。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='m', value={'k': 'v'})
        logged_msg = logger_mock.debug.call_args.args[0]
        assert "value={'k': 'v'}" in logged_msg

    @pytest.mark.asyncio
    async def test_value_zero(self, mock_bot, mock_event):
        """value=0（边界值，0 不是 None，应追加 value=0）。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='m', value=0)
        logged_msg = logger_mock.debug.call_args.args[0]
        assert 'value=0' in logged_msg

    @pytest.mark.asyncio
    async def test_value_empty_string(self, mock_bot, mock_event):
        """value='' （空字符串，非 None，应追加 value=''）。"""
        with patch.object(debug_log_module, 'logger') as logger_mock:
            logger_mock.debug = MagicMock()
            await debug_log(mock_bot, mock_event, message='m', value='')
        logged_msg = logger_mock.debug.call_args.args[0]
        assert "value=''" in logged_msg
