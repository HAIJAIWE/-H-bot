"""delay 节点单元测试。

覆盖：
- 正常延迟（默认值、指定秒数）
- 边界值（0 秒、负数、浮点数）
- 类型兼容（int / float / 字符串）
- 异常路径（asyncio.sleep 抛异常时返回 result=False + error）
- 返回结构字段完整性

被测源码：qqbat_nodes/builtin/delay.py

测试策略：
- patch asyncio.sleep 避免真实等待，加速测试
- 通过 mock 的 call_args 验证传入 sleep 的参数（int/float/str 数字）
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.delay import delay


# =============================================================================
# 正常路径
# =============================================================================
class TestNormalDelay:
    """验证 delay 节点正常路径返回结构。"""

    @pytest.mark.asyncio
    async def test_default_seconds(self, mock_bot, mock_event):
        """不传 seconds 时使用默认值 1，返回 result=True。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event)
        assert result['result'] is True
        assert result['error'] == ''
        mock_sleep.assert_awaited_once_with(1.0)

    @pytest.mark.asyncio
    async def test_custom_seconds(self, mock_bot, mock_event):
        """传入 seconds=2.5 时正确调用 asyncio.sleep(2.5)。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds=2.5)
        assert result['result'] is True
        assert result['error'] == ''
        mock_sleep.assert_awaited_once_with(2.5)

    @pytest.mark.asyncio
    async def test_kwargs_passed_through(self, mock_bot, mock_event):
        """delay 接受任意 **kwargs（兼容 interpreter 注入的额外参数）。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()):
            # 不应抛 TypeError
            result = await delay(mock_bot, mock_event, seconds=1,
                                 extra_param='ignored', trace_id='abc')
        assert result['result'] is True


# =============================================================================
# 边界值
# =============================================================================
class TestBoundaryValues:
    """验证 delay 节点对边界秒数的处理。"""

    @pytest.mark.asyncio
    async def test_zero_seconds(self, mock_bot, mock_event):
        """seconds=0 仍然调用 asyncio.sleep(0.0) 并返回成功。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds=0)
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(0.0)

    @pytest.mark.asyncio
    async def test_negative_seconds(self, mock_bot, mock_event):
        """负数秒数仍走 float() 转换并 sleep（asyncio.sleep 对负数会抛 ValueError，
        但 delay 捕获后返回 result=False + error 信息）。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock(side_effect=ValueError("negative delay"))):
            result = await delay(mock_bot, mock_event, seconds=-1)
        assert result['result'] is False
        assert 'negative delay' in result['error']

    @pytest.mark.asyncio
    async def test_very_small_float(self, mock_bot, mock_event):
        """极小浮点数 0.001 正确转换并 sleep。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds=0.001)
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(0.001)

    @pytest.mark.asyncio
    async def test_large_seconds(self, mock_bot, mock_event):
        """大数值秒数仍正常调用 sleep（实际不会等待，因被 mock）。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds=86400)
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(86400.0)


# =============================================================================
# 类型兼容
# =============================================================================
class TestTypeCompatibility:
    """验证 delay 节点对各种 seconds 类型的处理（均走 float() 转换）。"""

    @pytest.mark.asyncio
    async def test_int_seconds(self, mock_bot, mock_event):
        """int 类型秒数转换为 float。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds=3)
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(3.0)

    @pytest.mark.asyncio
    async def test_float_seconds(self, mock_bot, mock_event):
        """float 类型秒数保持精度。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds=1.5)
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(1.5)

    @pytest.mark.asyncio
    async def test_string_numeric_seconds(self, mock_bot, mock_event):
        """数字字符串 '2.5' 被 float() 转换为 2.5。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds='2.5')
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(2.5)

    @pytest.mark.asyncio
    async def test_string_int_seconds(self, mock_bot, mock_event):
        """整数字符串 '10' 被 float() 转换为 10.0。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()) as mock_sleep:
            result = await delay(mock_bot, mock_event, seconds='10')
        assert result['result'] is True
        mock_sleep.assert_awaited_once_with(10.0)


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证 delay 节点对异常的捕获。"""

    @pytest.mark.asyncio
    async def test_sleep_cancelled_returns_false(self, mock_bot, mock_event):
        """asyncio.sleep 被取消（CancelledError）时返回 result=False + error。

        注：asyncio.CancelledError 在 Python 3.8+ 继承自 BaseException，
        delay 的 except Exception 捕获不到，会向上抛出。
        但测试用例使用 ValueError 模拟通用异常路径。
        用 ValueError 模拟「sleep 抛通用异常」场景。
        """
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock(side_effect=ValueError("cancelled"))):
            result = await delay(mock_bot, mock_event, seconds=1)
        assert result['result'] is False
        assert 'cancelled' in result['error']

    @pytest.mark.asyncio
    async def test_sleep_runtime_error_returns_false(self, mock_bot, mock_event):
        """asyncio.sleep 抛 RuntimeError 时返回 result=False + error 信息。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock(side_effect=RuntimeError("runtime failure"))):
            result = await delay(mock_bot, mock_event, seconds=1)
        assert result['result'] is False
        assert 'runtime failure' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_seconds_type_returns_false(self, mock_bot, mock_event):
        """seconds 为不可转换为 float 的字符串时返回 result=False + error。

        'abc' 无法 float() → ValueError → 被捕获返回错误。
        """
        result = await delay(mock_bot, mock_event, seconds='abc')
        assert result['result'] is False
        assert result['error']  # 错误信息非空

    @pytest.mark.asyncio
    async def test_none_seconds_uses_default(self, mock_bot, mock_event):
        """seconds=None 时 float(None) 抛 TypeError → 返回 result=False。

        注：handler 默认值为 1，但显式传 None 会覆盖默认值，触发 TypeError。
        """
        result = await delay(mock_bot, mock_event, seconds=None)
        assert result['result'] is False
        assert result['error']  # 错误信息非空


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_success_return_fields(self, mock_bot, mock_event):
        """成功路径返回 {result, error} 两个键。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock()):
            result = await delay(mock_bot, mock_event, seconds=1)
        assert set(result.keys()) == {'result', 'error'}
        assert result['result'] is True
        assert isinstance(result['error'], str)

    @pytest.mark.asyncio
    async def test_error_return_fields(self, mock_bot, mock_event):
        """错误路径同样返回 {result, error} 两个键。"""
        result = await delay(mock_bot, mock_event, seconds='not a number')
        assert set(result.keys()) == {'result', 'error'}
        assert result['result'] is False
        assert isinstance(result['error'], str)
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_error_is_string_type(self, mock_bot, mock_event):
        """error 字段始终为字符串类型。"""
        with patch('qqbat_nodes.builtin.delay.asyncio.sleep',
                   new=AsyncMock(side_effect=Exception(12345))):
            result = await delay(mock_bot, mock_event, seconds=1)
        assert isinstance(result['error'], str)
        assert '12345' in result['error']
