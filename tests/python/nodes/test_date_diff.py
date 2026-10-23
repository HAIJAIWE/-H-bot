"""date_diff 节点单元测试。

覆盖：
- 时间差计算：固定 timestamp + target 字符串
- unit 转换：seconds/minutes/hours/days / 未知 unit 默认 seconds
- is_past：未来/过去/同时
- timestamp=0：使用当前时间
- target 为空：使用当前时间
- 自定义 target_fmt
- 错误处理：非法 target / 非法 timestamp / 非法 unit
- 返回结构：diff / seconds / is_past / error

注意：datetime.strptime 解析的 naive datetime 调用 .timestamp() 时按本地时区
解释，因此测试用辅助函数 _target_ts 动态计算期望值，避免硬编码时间戳导致跨时区失败。

被测源码：qqbat_nodes/builtin/date_diff.py
"""
from datetime import datetime

import pytest

from qqbat_nodes.builtin.date_diff import date_diff


def _target_ts(target: str, fmt: str = '%Y-%m-%d %H:%M:%S') -> float:
    """与源码相同方式计算 target 时间戳（naive datetime → 本地时区 timestamp）。"""
    return datetime.strptime(target, fmt).timestamp()


# =============================================================================
# 基础时间差计算
# =============================================================================
class TestBasicDiff:
    """验证固定 timestamp 与 target 的时间差计算。"""

    @pytest.mark.asyncio
    async def test_fixed_diff_seconds(self, mock_bot, mock_event):
        """固定 timestamp=1000，target 时间戳动态计算 → diff = (target_ts - 1000) 绝对值。"""
        target = '2000-01-01 12:00:00'
        expected_seconds = abs(_target_ts(target) - 1000)
        result = await date_diff(
            mock_bot, mock_event, timestamp=1000, target=target,
        )
        assert result['seconds'] == expected_seconds
        assert result['diff'] == expected_seconds
        assert result['is_past'] is False  # target 远大于 1000
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_past_target_is_past_true(self, mock_bot, mock_event):
        """target 早于 timestamp → is_past=True。"""
        # timestamp 远大于 2000 年的时间戳
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=946684800,  # 2000-01-01 UTC（约 1999-12-31 本地）
            target='2000-01-01 00:00:00',
        )
        # 946684800 是 2000-01-01 00:00:00 UTC，本地 UTC+8 是 2000-01-01 08:00:00
        # target='2000-01-01 00:00:00' 本地 = 2000-01-01 00:00:00 UTC+8 = 946684800 - 28800
        # seconds = (946684800 - 28800) - 946684800 = -28800 → is_past=True
        assert result['is_past'] is True
        assert result['seconds'] == 28800.0

    @pytest.mark.asyncio
    async def test_future_target_is_past_false(self, mock_bot, mock_event):
        """target 晚于 timestamp → is_past=False。"""
        # timestamp=0, target='2030-01-01 00:00:00' 远在未来
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=0,
            target='2030-01-01 00:00:00',
        )
        assert result['is_past'] is False
        assert result['seconds'] > 0

    @pytest.mark.asyncio
    async def test_same_timestamp_and_target(self, mock_bot, mock_event):
        """timestamp 与 target 时间戳相同 → diff=0, is_past=False。"""
        target = '2000-01-01 00:00:00'
        ts = _target_ts(target)
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target,
        )
        assert result['diff'] == 0.0
        assert result['seconds'] == 0.0
        assert result['is_past'] is False

    @pytest.mark.asyncio
    async def test_seconds_field_always_absolute(self, mock_bot, mock_event):
        """seconds 字段始终为绝对值（abs_seconds）。"""
        # timestamp 大于 target_ts → seconds 为负 → abs 后为正
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        # 用比 target_ts 大很多的 timestamp
        big_ts = target_ts + 100000
        result = await date_diff(
            mock_bot, mock_event, timestamp=big_ts, target=target,
        )
        # seconds = target_ts - big_ts = -100000 → abs = 100000
        assert result['seconds'] == 100000.0
        assert result['is_past'] is True


# =============================================================================
# unit 转换
# =============================================================================
class TestUnitConversion:
    """验证不同 unit 的时间差单位转换。"""

    @pytest.mark.asyncio
    async def test_seconds_unit(self, mock_bot, mock_event):
        """seconds 单位：diff = abs_seconds / 1。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 2600  # target 比 ts 晚 2600 秒
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target, unit='seconds',
        )
        assert result['diff'] == 2600.0
        assert result['seconds'] == 2600.0

    @pytest.mark.asyncio
    async def test_minutes_unit(self, mock_bot, mock_event):
        """minutes 单位：diff = abs_seconds / 60。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 3600  # 差 3600 秒 = 60 分钟
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target, unit='minutes',
        )
        assert result['diff'] == 60.0
        assert result['seconds'] == 3600.0

    @pytest.mark.asyncio
    async def test_hours_unit(self, mock_bot, mock_event):
        """hours 单位：diff = abs_seconds / 3600。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 7200  # 差 7200 秒 = 2 小时
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target, unit='hours',
        )
        assert result['diff'] == 2.0
        assert result['seconds'] == 7200.0

    @pytest.mark.asyncio
    async def test_days_unit(self, mock_bot, mock_event):
        """days 单位：diff = abs_seconds / 86400。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 86400  # 差 86400 秒 = 1 天
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target, unit='days',
        )
        assert result['diff'] == 1.0
        assert result['seconds'] == 86400.0

    @pytest.mark.asyncio
    async def test_unknown_unit_defaults_to_seconds(self, mock_bot, mock_event):
        """未知 unit 默认除数=1（等价于 seconds）。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 1000
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target, unit='unknown_unit',
        )
        assert result['diff'] == 1000.0

    @pytest.mark.asyncio
    async def test_default_unit_is_seconds(self, mock_bot, mock_event):
        """默认 unit='seconds'。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 500
        result = await date_diff(
            mock_bot, mock_event, timestamp=ts, target=target,
        )
        assert result['diff'] == 500.0


# =============================================================================
# timestamp=0 与 target 为空
# =============================================================================
class TestDefaults:
    """验证 timestamp=0 和 target 为空时使用当前时间。"""

    @pytest.mark.asyncio
    async def test_timestamp_zero_uses_now(self, mock_bot, mock_event):
        """timestamp=0 → source=now，target 为固定过去时间 → is_past=True。"""
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=0,
            target='2000-01-01 00:00:00',
        )
        # now 远大于 2000 年的时间戳 → is_past=True
        assert result['is_past'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_target_uses_now(self, mock_bot, mock_event):
        """target 为空 → target_ts=now，固定 timestamp=1000 → is_past=False。"""
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=1000,
            target='',
        )
        # now 远大于 1000 → is_past=False
        assert result['is_past'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_both_default_uses_now(self, mock_bot, mock_event):
        """timestamp=0 且 target='' → source=now, target_ts=now → diff≈0。"""
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=0,
            target='',
        )
        # 两次 time.time() 调用可能略有差异，但应非常接近 0
        assert abs(result['diff']) < 1.0
        assert result['error'] == ''


# =============================================================================
# 自定义格式与错误处理
# =============================================================================
class TestCustomFormatAndErrors:
    """验证自定义 target_fmt 与错误处理。"""

    @pytest.mark.asyncio
    async def test_custom_target_fmt_date_only(self, mock_bot, mock_event):
        """自定义 target_fmt='%Y-%m-%d' 解析仅日期。"""
        target = '2000-01-02'
        target_ts = datetime.strptime(target, '%Y-%m-%d').timestamp()
        # timestamp 设为 target 前一天
        ts = target_ts - 86400
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=ts, target=target,
            target_fmt='%Y-%m-%d', unit='days',
        )
        assert result['diff'] == 1.0
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_invalid_target_format_returns_error(self, mock_bot, mock_event):
        """target 格式与 target_fmt 不匹配 → 异常 → error。"""
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=0,
            target='not a date',
            target_fmt='%Y-%m-%d %H:%M:%S',
        )
        assert result['diff'] == 0.0
        assert result['seconds'] == 0.0
        assert result['is_past'] is False
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_invalid_timestamp_returns_error(self, mock_bot, mock_event):
        """非法 timestamp 字符串 → float() 失败 → error。"""
        result = await date_diff(
            mock_bot, mock_event,
            timestamp='not a number',
            target='2000-01-01 00:00:00',
        )
        assert result['error'] != ''
        assert result['diff'] == 0.0

    @pytest.mark.asyncio
    async def test_string_timestamp_converted(self, mock_bot, mock_event):
        """字符串数字 timestamp 被 float() 转换。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts_str = str(target_ts - 1000)
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=ts_str, target=target,
        )
        assert result['diff'] == 1000.0
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_float_timestamp_accepted(self, mock_bot, mock_event):
        """float 类型 timestamp 直接使用。"""
        target = '2000-01-01 00:00:00'
        target_ts = _target_ts(target)
        ts = target_ts - 500.5
        result = await date_diff(
            mock_bot, mock_event,
            timestamp=ts, target=target,
        )
        assert result['seconds'] == 500.5
        assert result['error'] == ''
