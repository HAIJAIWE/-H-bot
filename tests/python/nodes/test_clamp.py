"""clamp 节点单元测试。

覆盖：
- 范围内：不限制 / is_clamped=False
- 超出范围：低于 min / 高于 max / is_clamped=True
- 边界值：等于 min / 等于 max
- min/max 互换自动纠正
- 默认参数：默认 min=0 / max=999999
- 类型兼容：int / 字符串数字 / float / bool
- 错误处理：非法值
- 返回结构：result / original / is_clamped / error

被测源码：qqbat_nodes/builtin/clamp.py
"""
import pytest

from qqbat_nodes.builtin.clamp import clamp


# =============================================================================
# 范围内（不限制）
# =============================================================================
class TestWithinRange:
    """验证值在范围内时不被限制。"""

    @pytest.mark.asyncio
    async def test_value_within_range(self, mock_bot, mock_event):
        """值在 [0, 100] 内 → 不变，is_clamped=False。"""
        result = await clamp(
            mock_bot, mock_event, value=50, min_value=0, max_value=100,
        )
        assert result['result'] == 50.0
        assert result['original'] == 50.0
        assert result['is_clamped'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_value_at_min(self, mock_bot, mock_event):
        """值等于 min → 不变，is_clamped=False。"""
        result = await clamp(
            mock_bot, mock_event, value=0, min_value=0, max_value=100,
        )
        assert result['result'] == 0.0
        assert result['is_clamped'] is False

    @pytest.mark.asyncio
    async def test_value_at_max(self, mock_bot, mock_event):
        """值等于 max → 不变，is_clamped=False。"""
        result = await clamp(
            mock_bot, mock_event, value=100, min_value=0, max_value=100,
        )
        assert result['result'] == 100.0
        assert result['is_clamped'] is False

    @pytest.mark.asyncio
    async def test_value_in_middle(self, mock_bot, mock_event):
        """值在中间 → 不变。"""
        result = await clamp(
            mock_bot, mock_event, value=3.14, min_value=0, max_value=10,
        )
        assert result['result'] == 3.14
        assert result['is_clamped'] is False


# =============================================================================
# 超出范围（限制）
# =============================================================================
class TestOutOfRange:
    """验证值超出范围时被限制。"""

    @pytest.mark.asyncio
    async def test_value_below_min(self, mock_bot, mock_event):
        """值低于 min → 被限制为 min，is_clamped=True。"""
        result = await clamp(
            mock_bot, mock_event, value=-10, min_value=0, max_value=100,
        )
        assert result['result'] == 0.0
        assert result['original'] == -10.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_value_above_max(self, mock_bot, mock_event):
        """值高于 max → 被限制为 max，is_clamped=True。"""
        result = await clamp(
            mock_bot, mock_event, value=200, min_value=0, max_value=100,
        )
        assert result['result'] == 100.0
        assert result['original'] == 200.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_far_below_min(self, mock_bot, mock_event):
        """远低于 min 的负数 → 被限制为 min。"""
        result = await clamp(
            mock_bot, mock_event, value=-9999, min_value=0, max_value=100,
        )
        assert result['result'] == 0.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_far_above_max(self, mock_bot, mock_event):
        """远高于 max 的大数 → 被限制为 max。"""
        result = await clamp(
            mock_bot, mock_event, value=999999, min_value=0, max_value=100,
        )
        assert result['result'] == 100.0
        assert result['is_clamped'] is True


# =============================================================================
# min/max 互换
# =============================================================================
class TestMinMaxSwap:
    """验证 min > max 时自动交换。"""

    @pytest.mark.asyncio
    async def test_swapped_range_within(self, mock_bot, mock_event):
        """min=100, max=0 互换为 min=0, max=100，值 50 在范围内。"""
        result = await clamp(
            mock_bot, mock_event, value=50, min_value=100, max_value=0,
        )
        assert result['result'] == 50.0
        assert result['is_clamped'] is False

    @pytest.mark.asyncio
    async def test_swapped_range_clamped_high(self, mock_bot, mock_event):
        """min=100, max=0 互换后值 200 被限制为 100（max）。"""
        result = await clamp(
            mock_bot, mock_event, value=200, min_value=100, max_value=0,
        )
        assert result['result'] == 100.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_swapped_range_clamped_low(self, mock_bot, mock_event):
        """min=100, max=0 互换后值 -50 被限制为 0（min）。"""
        result = await clamp(
            mock_bot, mock_event, value=-50, min_value=100, max_value=0,
        )
        assert result['result'] == 0.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_equal_min_max(self, mock_bot, mock_event):
        """min == max 时所有值都被限制为该值（除等于的情况）。"""
        result = await clamp(
            mock_bot, mock_event, value=5, min_value=5, max_value=5,
        )
        assert result['result'] == 5.0
        assert result['is_clamped'] is False


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaultParams:
    """验证默认 min_value=0 / max_value=999999。"""

    @pytest.mark.asyncio
    async def test_default_min_zero(self, mock_bot, mock_event):
        """默认 min=0：负数被限制为 0。"""
        result = await clamp(mock_bot, mock_event, value=-5)
        assert result['result'] == 0.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_default_max_large(self, mock_bot, mock_event):
        """默认 max=999999：大数在范围内不被限制。"""
        result = await clamp(mock_bot, mock_event, value=500000)
        assert result['result'] == 500000.0
        assert result['is_clamped'] is False

    @pytest.mark.asyncio
    async def test_default_max_exceeded(self, mock_bot, mock_event):
        """默认 max=999999：超出被限制。"""
        result = await clamp(mock_bot, mock_event, value=1000000)
        assert result['result'] == 999999.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_default_value_zero(self, mock_bot, mock_event):
        """默认 value=0 在默认范围内 → 0.0。"""
        result = await clamp(mock_bot, mock_event)
        assert result['result'] == 0.0
        assert result['is_clamped'] is False


# =============================================================================
# 类型兼容与错误处理
# =============================================================================
class TestTypeCompatibility:
    """验证不同输入类型与错误处理。"""

    @pytest.mark.asyncio
    async def test_int_value_converted_to_float(self, mock_bot, mock_event):
        """int 值被 float() 转换。"""
        result = await clamp(
            mock_bot, mock_event, value=50, min_value=0, max_value=100,
        )
        assert result['result'] == 50.0
        assert isinstance(result['result'], float)

    @pytest.mark.asyncio
    async def test_string_numeric_value(self, mock_bot, mock_event):
        """数字字符串被 float() 转换。"""
        result = await clamp(
            mock_bot, mock_event, value='50', min_value='0', max_value='100',
        )
        assert result['result'] == 50.0

    @pytest.mark.asyncio
    async def test_float_value(self, mock_bot, mock_event):
        """float 值正常处理。"""
        result = await clamp(
            mock_bot, mock_event, value=3.14, min_value=0.0, max_value=10.0,
        )
        assert result['result'] == 3.14

    @pytest.mark.asyncio
    async def test_negative_range(self, mock_bot, mock_event):
        """负数范围：[-10, -1]。"""
        result = await clamp(
            mock_bot, mock_event, value=-5, min_value=-10, max_value=-1,
        )
        assert result['result'] == -5.0
        assert result['is_clamped'] is False

    @pytest.mark.asyncio
    async def test_negative_range_below(self, mock_bot, mock_event):
        """负数范围低于 min：-20 → -10。"""
        result = await clamp(
            mock_bot, mock_event, value=-20, min_value=-10, max_value=-1,
        )
        assert result['result'] == -10.0
        assert result['is_clamped'] is True

    @pytest.mark.asyncio
    async def test_bool_value_converted(self, mock_bot, mock_event):
        """bool 被 float() 转换为 1.0/0.0。"""
        result = await clamp(
            mock_bot, mock_event, value=True, min_value=0, max_value=10,
        )
        assert result['result'] == 1.0

    @pytest.mark.asyncio
    async def test_invalid_value_returns_error(self, mock_bot, mock_event):
        """非法字符串触发异常 → 返回 error。"""
        result = await clamp(
            mock_bot, mock_event, value='not a number',
        )
        assert result['result'] is None
        assert result['original'] is None
        assert result['is_clamped'] is False
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_large_numbers(self, mock_bot, mock_event):
        """大数限制：1e10 被 max=1e9 限制。"""
        result = await clamp(
            mock_bot, mock_event, value=1e10, min_value=0, max_value=1e9,
        )
        assert result['result'] == 1e9
        assert result['is_clamped'] is True
