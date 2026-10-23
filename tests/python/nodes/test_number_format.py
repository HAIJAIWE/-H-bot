"""number_format 节点单元测试。

覆盖：
- 基础格式化：默认小数位 / 自定义小数位 / 0 位小数
- thousands_sep：千分位分隔
- short 模式：万/亿 中文单位 / 低于万 / 负数 / 边界值
- 类型兼容：int / 字符串数字 / 负数 / 零
- 错误处理：非法值
- 默认参数与 original 字段

被测源码：qqbat_nodes/builtin/number_format.py
"""
import pytest

from qqbat_nodes.builtin.number_format import number_format


# =============================================================================
# 基础格式化
# =============================================================================
class TestBasicFormatting:
    """验证默认小数位格式化。"""

    @pytest.mark.asyncio
    async def test_default_two_decimals(self, mock_bot, mock_event):
        """默认保留 2 位小数。"""
        result = await number_format(mock_bot, mock_event, value=3.14159)
        assert result['result'] == '3.14'
        assert result['original'] == 3.14159
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_custom_decimals(self, mock_bot, mock_event):
        """自定义 4 位小数。"""
        result = await number_format(
            mock_bot, mock_event, value=3.14159265, decimals=4,
        )
        assert result['result'] == '3.1416'

    @pytest.mark.asyncio
    async def test_zero_decimals(self, mock_bot, mock_event):
        """0 位小数（整数显示）。"""
        result = await number_format(
            mock_bot, mock_event, value=3.14159, decimals=0,
        )
        assert result['result'] == '3'

    @pytest.mark.asyncio
    async def test_round_half_up(self, mock_bot, mock_event):
        """四舍五入：3.5 保留 0 位小数 → '4'。"""
        result = await number_format(
            mock_bot, mock_event, value=3.5, decimals=0,
        )
        assert result['result'] == '4'

    @pytest.mark.asyncio
    async def test_default_value_zero(self, mock_bot, mock_event):
        """默认 value=0.0 → '0.00'。"""
        result = await number_format(mock_bot, mock_event)
        assert result['result'] == '0.00'

    @pytest.mark.asyncio
    async def test_padding_zero(self, mock_bot, mock_event):
        """小数位不足时补 0。"""
        result = await number_format(
            mock_bot, mock_event, value=3.1, decimals=4,
        )
        assert result['result'] == '3.1000'

    @pytest.mark.asyncio
    async def test_original_field_is_float(self, mock_bot, mock_event):
        """original 字段为 float 类型的原始值。"""
        result = await number_format(mock_bot, mock_event, value=100)
        assert result['original'] == 100.0
        assert isinstance(result['original'], float)


# =============================================================================
# thousands_sep 千分位
# =============================================================================
class TestThousandsSeparator:
    """验证千分位分隔符。"""

    @pytest.mark.asyncio
    async def test_thousands_sep_basic(self, mock_bot, mock_event):
        """千分位分隔：1234567.89 → '1,234,567.89'。"""
        result = await number_format(
            mock_bot, mock_event, value=1234567.89, decimals=2, thousands_sep=True,
        )
        assert result['result'] == '1,234,567.89'

    @pytest.mark.asyncio
    async def test_thousands_sep_large_number(self, mock_bot, mock_event):
        """大数千分位：999999999 → '999,999,999.00'。"""
        result = await number_format(
            mock_bot, mock_event, value=999999999, thousands_sep=True,
        )
        assert result['result'] == '999,999,999.00'

    @pytest.mark.asyncio
    async def test_thousands_sep_small_number_no_comma(self, mock_bot, mock_event):
        """小数不需要千分位：999.99 → '999.99'。"""
        result = await number_format(
            mock_bot, mock_event, value=999.99, thousands_sep=True,
        )
        assert result['result'] == '999.99'

    @pytest.mark.asyncio
    async def test_thousands_sep_negative(self, mock_bot, mock_event):
        """负数千分位：-1234567 → '-1,234,567.00'。"""
        result = await number_format(
            mock_bot, mock_event, value=-1234567, thousands_sep=True,
        )
        assert result['result'] == '-1,234,567.00'

    @pytest.mark.asyncio
    async def test_no_thousands_sep_by_default(self, mock_bot, mock_event):
        """默认不启用千分位。"""
        result = await number_format(
            mock_bot, mock_event, value=1234567.89,
        )
        assert result['result'] == '1234567.89'


# =============================================================================
# short 简写模式
# =============================================================================
class TestShortMode:
    """验证 short=True 的中文单位简写。"""

    @pytest.mark.asyncio
    async def test_short_wan_unit(self, mock_bot, mock_event):
        """12345 → '1.23万'（decimals=2）。"""
        result = await number_format(
            mock_bot, mock_event, value=12345, decimals=2, short=True,
        )
        assert result['result'] == '1.23万'

    @pytest.mark.asyncio
    async def test_short_yi_unit(self, mock_bot, mock_event):
        """123456789 → '1.23亿'（decimals=2）。"""
        result = await number_format(
            mock_bot, mock_event, value=123456789, decimals=2, short=True,
        )
        assert result['result'] == '1.23亿'

    @pytest.mark.asyncio
    async def test_short_below_wan_no_unit(self, mock_bot, mock_event):
        """低于万的小数不加单位：9999 → '9999.00'。"""
        result = await number_format(
            mock_bot, mock_event, value=9999, decimals=2, short=True,
        )
        assert result['result'] == '9999.00'

    @pytest.mark.asyncio
    async def test_short_negative_wan(self, mock_bot, mock_event):
        """负数万单位：-12345 → '-1.23万'。"""
        result = await number_format(
            mock_bot, mock_event, value=-12345, decimals=2, short=True,
        )
        assert result['result'] == '-1.23万'

    @pytest.mark.asyncio
    async def test_short_exactly_wan(self, mock_bot, mock_event):
        """恰好 10000 → '1.00万'。"""
        result = await number_format(
            mock_bot, mock_event, value=10000, decimals=2, short=True,
        )
        assert result['result'] == '1.00万'

    @pytest.mark.asyncio
    async def test_short_exactly_yi(self, mock_bot, mock_event):
        """恰好 100000000 → '1.00亿'。"""
        result = await number_format(
            mock_bot, mock_event, value=100000000, decimals=2, short=True,
        )
        assert result['result'] == '1.00亿'

    @pytest.mark.asyncio
    async def test_short_zero(self, mock_bot, mock_event):
        """0 的 short 模式：'0.00'（无单位）。"""
        result = await number_format(
            mock_bot, mock_event, value=0, decimals=2, short=True,
        )
        assert result['result'] == '0.00'

    @pytest.mark.asyncio
    async def test_short_large_yi(self, mock_bot, mock_event):
        """大数亿单位：9999999999 → '99.99亿'。"""
        result = await number_format(
            mock_bot, mock_event, value=9999999999, decimals=2, short=True,
        )
        assert result['result'] == '100.00亿'

    @pytest.mark.asyncio
    async def test_short_overrides_thousands_sep(self, mock_bot, mock_event):
        """short=True 时忽略 thousands_sep（short 分支优先）。"""
        result = await number_format(
            mock_bot, mock_event, value=12345,
            decimals=2, short=True, thousands_sep=True,
        )
        assert result['result'] == '1.23万'


# =============================================================================
# 类型兼容与错误处理
# =============================================================================
class TestTypeCompatibility:
    """验证不同输入类型与错误处理。"""

    @pytest.mark.asyncio
    async def test_int_value(self, mock_bot, mock_event):
        """int 值被 float() 转换。"""
        result = await number_format(mock_bot, mock_event, value=100)
        assert result['result'] == '100.00'
        assert result['original'] == 100.0

    @pytest.mark.asyncio
    async def test_string_numeric_value(self, mock_bot, mock_event):
        """数字字符串被 float() 转换。"""
        result = await number_format(
            mock_bot, mock_event, value='123.456',
        )
        assert result['result'] == '123.46'
        assert result['original'] == 123.456

    @pytest.mark.asyncio
    async def test_negative_value(self, mock_bot, mock_event):
        """负数格式化。"""
        result = await number_format(
            mock_bot, mock_event, value=-1234.567,
        )
        assert result['result'] == '-1234.57'

    @pytest.mark.asyncio
    async def test_zero_value(self, mock_bot, mock_event):
        """0 格式化为 '0.00'。"""
        result = await number_format(mock_bot, mock_event, value=0)
        assert result['result'] == '0.00'

    @pytest.mark.asyncio
    async def test_invalid_string_returns_error(self, mock_bot, mock_event):
        """非法字符串触发异常 → 返回 error。"""
        result = await number_format(
            mock_bot, mock_event, value='not a number',
        )
        assert result['error'] != ''
        assert result['result'] == 'not a number'
        assert result['original'] == 0.0

    @pytest.mark.asyncio
    async def test_bool_value_converted(self, mock_bot, mock_event):
        """bool 被 float() 转换为 1.0/0.0。"""
        result = await number_format(mock_bot, mock_event, value=True)
        assert result['result'] == '1.00'
        assert result['original'] == 1.0
