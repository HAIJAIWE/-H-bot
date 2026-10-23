"""is_today 节点单元测试。

覆盖：
- None 输入：使用当前时间 → True
- 当前时间戳：True
- 0 时间戳：False（1970-01-01）
- dict 输入：提取 timestamp 字段 / 缺失字段 / 嵌套 dict
- 字符串数字：解析为时间戳
- 非法输入：非数字字符串 → error
- int / float / bool 类型兼容
- 昨天 / 明天 / 边界日期

被测源码：qqbat_nodes/builtin/is_today.py
"""
import time
from datetime import date, timedelta

import pytest

from qqbat_nodes.builtin.is_today import is_today


# =============================================================================
# None 输入与当前时间
# =============================================================================
class TestNoneAndCurrent:
    """验证 None 与当前时间戳的判断。"""

    @pytest.mark.asyncio
    async def test_none_returns_true(self, mock_bot, mock_event):
        """timestamp=None → 使用当前时间 → True。"""
        result = await is_today(mock_bot, mock_event, timestamp=None)
        assert result['result'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_current_timestamp_returns_true(self, mock_bot, mock_event):
        """当前 Unix 时间戳 → True。"""
        now_ts = int(time.time())
        result = await is_today(mock_bot, mock_event, timestamp=now_ts)
        assert result['result'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_no_timestamp_arg_returns_true(self, mock_bot, mock_event):
        """不传 timestamp 参数（默认 None）→ True。"""
        result = await is_today(mock_bot, mock_event)
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_default_bot_event_none(self, mock_bot, mock_event):
        """bot/event 默认 None 也能正常工作。"""
        result = await is_today()
        assert result['result'] is True


# =============================================================================
# 非今天的时间戳
# =============================================================================
class TestNonTodayTimestamps:
    """验证非今天时间戳返回 False。"""

    @pytest.mark.asyncio
    async def test_zero_timestamp_is_epoch_not_today(self, mock_bot, mock_event):
        """timestamp=0 → 1970-01-01，非今天 → False。"""
        result = await is_today(mock_bot, mock_event, timestamp=0)
        assert result['result'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_yesterday_returns_false(self, mock_bot, mock_event):
        """昨天的时间戳 → False。"""
        yesterday = date.today() - timedelta(days=1)
        yesterday_ts = int(time.mktime(yesterday.timetuple()))
        result = await is_today(mock_bot, mock_event, timestamp=yesterday_ts)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_tomorrow_returns_false(self, mock_bot, mock_event):
        """明天的时间戳 → False。"""
        tomorrow = date.today() + timedelta(days=1)
        tomorrow_ts = int(time.mktime(tomorrow.timetuple()))
        result = await is_today(mock_bot, mock_event, timestamp=tomorrow_ts)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_far_past_returns_false(self, mock_bot, mock_event):
        """很久以前的时间戳（2000年）→ False。"""
        result = await is_today(mock_bot, mock_event, timestamp=946684800)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_far_future_returns_false(self, mock_bot, mock_event):
        """很久以后的时间戳（2099年）→ False。"""
        # 2099-01-01 约为 4070908800
        result = await is_today(mock_bot, mock_event, timestamp=4070908800)
        assert result['result'] is False


# =============================================================================
# dict 输入兼容
# =============================================================================
class TestDictInput:
    """验证 dict 输入时从 timestamp 字段提取。"""

    @pytest.mark.asyncio
    async def test_dict_with_current_timestamp(self, mock_bot, mock_event):
        """dict 含 timestamp 字段为当前时间 → True。"""
        now_ts = int(time.time())
        result = await is_today(
            mock_bot, mock_event,
            timestamp={'timestamp': now_ts, 'other': 'data'},
        )
        assert result['result'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_with_zero_timestamp(self, mock_bot, mock_event):
        """dict 含 timestamp=0 → False（1970）。"""
        result = await is_today(
            mock_bot, mock_event,
            timestamp={'timestamp': 0},
        )
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_dict_without_timestamp_key_returns_true(self, mock_bot, mock_event):
        """dict 无 timestamp 字段 → timestamp=None → True（当前时间）。"""
        result = await is_today(
            mock_bot, mock_event,
            timestamp={'other': 'value'},
        )
        assert result['result'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_dict_returns_true(self, mock_bot, mock_event):
        """空 dict {} → timestamp=None → True。"""
        result = await is_today(
            mock_bot, mock_event, timestamp={},
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_dict_with_none_timestamp_returns_true(self, mock_bot, mock_event):
        """dict 含 timestamp=None → None → True（当前时间）。"""
        result = await is_today(
            mock_bot, mock_event,
            timestamp={'timestamp': None},
        )
        assert result['result'] is True


# =============================================================================
# 字符串与类型兼容
# =============================================================================
class TestStringAndTypes:
    """验证字符串数字与各种类型兼容。"""

    @pytest.mark.asyncio
    async def test_string_current_timestamp(self, mock_bot, mock_event):
        """字符串数字时间戳（当前）→ True。"""
        now_str = str(int(time.time()))
        result = await is_today(mock_bot, mock_event, timestamp=now_str)
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_string_zero_timestamp(self, mock_bot, mock_event):
        """字符串 '0' → 1970 → False。"""
        result = await is_today(mock_bot, mock_event, timestamp='0')
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_float_timestamp_truncated(self, mock_bot, mock_event):
        """float 时间戳被 int() 截断。"""
        now_ts = float(int(time.time())) + 0.5
        result = await is_today(mock_bot, mock_event, timestamp=now_ts)
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_int_timestamp(self, mock_bot, mock_event):
        """int 时间戳正常处理。"""
        now_ts = int(time.time())
        result = await is_today(mock_bot, mock_event, timestamp=now_ts)
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_bool_true_is_epoch_plus_one(self, mock_bot, mock_event):
        """bool True → int(True)=1 → 1970-01-01 00:00:01 → False。"""
        result = await is_today(mock_bot, mock_event, timestamp=True)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_bool_false_is_epoch(self, mock_bot, mock_event):
        """bool False → int(False)=0 → 1970 → False。"""
        result = await is_today(mock_bot, mock_event, timestamp=False)
        assert result['result'] is False


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证非法输入的错误处理。"""

    @pytest.mark.asyncio
    async def test_invalid_string_returns_error(self, mock_bot, mock_event):
        """非数字字符串 → int() 失败 → error。"""
        result = await is_today(mock_bot, mock_event, timestamp='not a number')
        assert result['result'] is False
        assert result['error'] != ''
        assert '时间戳解析失败' in result['error']

    @pytest.mark.asyncio
    async def test_list_input_returns_error(self, mock_bot, mock_event):
        """list 类型 → int() 失败 → error。"""
        result = await is_today(mock_bot, mock_event, timestamp=[1, 2, 3])
        assert result['result'] is False
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_dict_with_invalid_timestamp_type(self, mock_bot, mock_event):
        """dict 中 timestamp 字段为非法类型 → error。"""
        result = await is_today(
            mock_bot, mock_event,
            timestamp={'timestamp': 'not a number'},
        )
        assert result['result'] is False
        assert result['error'] != ''
