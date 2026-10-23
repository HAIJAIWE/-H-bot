"""now 节点单元测试。

覆盖：
- 默认格式化（'%Y-%m-%d %H:%M:%S'）
- 自定义 fmt 格式化
- timestamp 字段（patch time.time 固定时间戳）
- datetime/date/time/weekday 字段（patch datetime 固定时间）
- timezone 参数（合法时区 / 非法时区回退 / kwargs 传入）
- 返回结构完整性、默认参数、无参数调用

被测源码：qqbat_nodes/builtin/now.py

注：源码 `import time` 和 `from datetime import datetime`，
    因此 patch 路径为 qqbat_nodes.builtin.now.time.time 和
    qqbat_nodes.builtin.now.datetime。
"""
from datetime import datetime
from unittest.mock import patch

import pytest

from qqbat_nodes.builtin.now import now

# 固定时间：2024-01-01 10:30:45（周一，weekday=0）
FIXED_DT = datetime(2024, 1, 1, 10, 30, 45)
FIXED_TIMESTAMP = 1704119445


# =============================================================================
# 默认格式化
# =============================================================================
class TestDefaultFormat:
    """验证默认 fmt 参数的格式化输出。"""

    @pytest.mark.asyncio
    async def test_default_datetime_format(self, mock_bot, mock_event):
        """默认 fmt='%Y-%m-%d %H:%M:%S'，datetime 字段格式正确。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert result['datetime'] == '2024-01-01 10:30:45'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_date_format(self, mock_bot, mock_event):
        """date 字段固定为 '%Y-%m-%d' 格式。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert result['date'] == '2024-01-01'

    @pytest.mark.asyncio
    async def test_default_time_format(self, mock_bot, mock_event):
        """time 字段固定为 '%H:%M:%S' 格式。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert result['time'] == '10:30:45'

    @pytest.mark.asyncio
    async def test_weekday_value(self, mock_bot, mock_event):
        """weekday 字段：0=周一，6=周日。2024-01-01 是周一 → 0。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert result['weekday'] == 0

    @pytest.mark.asyncio
    async def test_timestamp_field(self, mock_bot, mock_event):
        """timestamp 字段等于 time.time() 的整数。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert result['timestamp'] == FIXED_TIMESTAMP
        assert isinstance(result['timestamp'], int)


# =============================================================================
# 自定义 fmt
# =============================================================================
class TestCustomFormat:
    """验证自定义 fmt 参数。"""

    @pytest.mark.asyncio
    async def test_custom_fmt_iso(self, mock_bot, mock_event):
        """自定义 fmt='%Y-%m-%dT%H:%M:%S'（ISO 格式）。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(
                mock_bot, mock_event, fmt='%Y-%m-%dT%H:%M:%S',
            )
        assert result['datetime'] == '2024-01-01T10:30:45'

    @pytest.mark.asyncio
    async def test_custom_fmt_date_only(self, mock_bot, mock_event):
        """自定义 fmt='%Y/%m/%d'（仅日期）。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event, fmt='%Y/%m/%d')
        assert result['datetime'] == '2024/01/01'

    @pytest.mark.asyncio
    async def test_custom_fmt_time_only(self, mock_bot, mock_event):
        """自定义 fmt='%H:%M'（仅时分）。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event, fmt='%H:%M')
        assert result['datetime'] == '10:30'

    @pytest.mark.asyncio
    async def test_custom_fmt_with_text(self, mock_bot, mock_event):
        """自定义 fmt 含文本：'今天是 %Y 年 %m 月 %d 日'。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(
                mock_bot, mock_event, fmt='今天是 %Y 年 %m 月 %d 日',
            )
        assert result['datetime'] == '今天是 2024 年 01 月 01 日'

    @pytest.mark.asyncio
    async def test_date_time_fields_unaffected_by_fmt(self, mock_bot, mock_event):
        """date/time 字段不受 fmt 影响（始终用固定格式）。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event, fmt='%H:%M')
        # date/time 字段仍是固定格式
        assert result['date'] == '2024-01-01'
        assert result['time'] == '10:30:45'


# =============================================================================
# weekday 边界值
# =============================================================================
class TestWeekdayValues:
    """验证 weekday 字段在不同日期的值。"""

    @pytest.mark.asyncio
    async def test_weekday_monday(self, mock_bot, mock_event):
        """周一：weekday=0。2024-01-01 是周一。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = datetime(2024, 1, 1)
            result = await now(mock_bot, mock_event)
        assert result['weekday'] == 0

    @pytest.mark.asyncio
    async def test_weekday_sunday(self, mock_bot, mock_event):
        """周日：weekday=6。2024-01-07 是周日。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = datetime(2024, 1, 7)
            result = await now(mock_bot, mock_event)
        assert result['weekday'] == 6

    @pytest.mark.asyncio
    async def test_weekday_midweek(self, mock_bot, mock_event):
        """周三：weekday=2。2024-01-03 是周三。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = datetime(2024, 1, 3)
            result = await now(mock_bot, mock_event)
        assert result['weekday'] == 2


# =============================================================================
# timezone 参数
# =============================================================================
class TestTimezone:
    """验证 timezone 参数的时区处理。"""

    @pytest.mark.asyncio
    async def test_valid_timezone_utc(self, mock_bot, mock_event):
        """合法时区 'UTC'：不报错，返回正常结构。"""
        result = await now(mock_bot, mock_event, timezone='UTC')
        assert result['error'] == ''
        assert result['datetime'] != ''
        assert result['timestamp'] > 0

    @pytest.mark.asyncio
    async def test_valid_timezone_shanghai(self, mock_bot, mock_event):
        """合法时区 'Asia/Shanghai'：不报错。"""
        result = await now(mock_bot, mock_event, timezone='Asia/Shanghai')
        assert result['error'] == ''
        assert result['datetime'] != ''

    @pytest.mark.asyncio
    async def test_invalid_timezone_falls_back(self, mock_bot, mock_event):
        """非法时区名称：回退到本地时间，不报错。"""
        result = await now(
            mock_bot, mock_event, timezone='Invalid/Nonexistent',
        )
        # 非法时区回退到本地时间，error 仍为空
        assert result['error'] == ''
        assert result['datetime'] != ''

    @pytest.mark.asyncio
    async def test_empty_timezone_uses_local(self, mock_bot, mock_event):
        """空 timezone：使用本地系统时区。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event, timezone='')
        assert result['datetime'] == '2024-01-01 10:30:45'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_timezone_via_kwargs(self, mock_bot, mock_event):
        """timezone 通过 kwargs 传入（向后兼容）。"""
        result = await now(mock_bot, mock_event, timezone='UTC')
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_timezone_with_custom_fmt(self, mock_bot, mock_event):
        """timezone 与自定义 fmt 同时使用：两者都生效。"""
        result = await now(
            mock_bot, mock_event, fmt='%Y-%m-%d', timezone='UTC',
        )
        assert result['error'] == ''
        # datetime 应为 '%Y-%m-%d' 格式（仅日期）
        assert len(result['datetime']) == 10


# =============================================================================
# 默认参数与无参数调用
# =============================================================================
class TestDefaults:
    """验证默认参数和无参数调用。"""

    @pytest.mark.asyncio
    async def test_no_args_uses_defaults(self, mock_bot, mock_event):
        """完全不传参数：使用默认 fmt，无 timezone。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now()
        assert result['datetime'] == '2024-01-01 10:30:45'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_only_fmt_provided(self, mock_bot, mock_event):
        """只传 fmt，其他用默认值。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(fmt='%Y')
        assert result['datetime'] == '2024'

    @pytest.mark.asyncio
    async def test_none_bot_and_event(self, mock_bot, mock_event):
        """bot 和 event 为 None 也能正常工作。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(None, None)
        assert result['datetime'] == '2024-01-01 10:30:45'
        assert result['error'] == ''


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 timestamp/datetime/date/time/weekday/error 六个字段。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert set(result.keys()) == {
            'timestamp', 'datetime', 'date', 'time', 'weekday', 'error'
        }

    @pytest.mark.asyncio
    async def test_error_always_empty(self, mock_bot, mock_event):
        """now 节点 error 始终为空字符串（不抛异常）。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_timestamp_is_integer(self, mock_bot, mock_event):
        """timestamp 字段始终为 int 类型。"""
        with patch('qqbat_nodes.builtin.now.time.time', return_value=1700000000.7):
            result = await now(mock_bot, mock_event)
        assert result['timestamp'] == 1700000000  # int() 截断
        assert isinstance(result['timestamp'], int)

    @pytest.mark.asyncio
    async def test_all_string_fields_are_strings(self, mock_bot, mock_event):
        """datetime/date/time 字段均为字符串类型。"""
        with patch('qqbat_nodes.builtin.now.datetime') as dt_mock, \
             patch('qqbat_nodes.builtin.now.time.time', return_value=FIXED_TIMESTAMP):
            dt_mock.now.return_value = FIXED_DT
            result = await now(mock_bot, mock_event)
        assert isinstance(result['datetime'], str)
        assert isinstance(result['date'], str)
        assert isinstance(result['time'], str)

    @pytest.mark.asyncio
    async def test_weekday_in_valid_range(self, mock_bot, mock_event):
        """weekday 字段在 0-6 范围内。"""
        result = await now(mock_bot, mock_event)
        assert 0 <= result['weekday'] <= 6
