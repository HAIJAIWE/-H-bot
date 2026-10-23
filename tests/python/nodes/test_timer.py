"""timer 节点单元测试 — 计时器 start/stop/elapsed 三种模式。

覆盖：
- start 模式：返回 0 elapsed，记录起始时间戳
- stop 模式：返回正数耗时，清除计时器状态
- elapsed 模式：返回正数耗时但不停止
- 未启动即 stop/elapsed：返回 error
- 未知 mode：返回 error
- 多 timer_id 独立性
- 默认 timer_id='default'

被测源码：qqbat_nodes/builtin/timer.py
"""
import time

import pytest

from qqbat_nodes.builtin import timer as timer_module
from qqbat_nodes.builtin.timer import timer


@pytest.fixture(autouse=True)
def reset_timer_state_and_bot(mock_bot):
    """每个用例前清空计时器状态，并把 mock_bot.self_id 固定为字符串。"""
    timer_module._timers.clear()
    mock_bot.self_id = 'mock_bot_self'
    yield


# =============================================================================
# 模块结构
# =============================================================================
class TestModuleStructure:
    """验证 timer 模块结构。"""

    def test_module_importable(self):
        """timer 模块可正常导入。"""
        assert timer_module is not None

    def test_module_has_timers_dict(self):
        """模块包含模块级 _timers 字典（内存状态）。"""
        assert hasattr(timer_module, '_timers')
        assert isinstance(timer_module._timers, dict)

    def test_handler_is_async(self):
        """timer handler 是协程函数。"""
        import inspect
        assert callable(timer)
        assert inspect.iscoroutinefunction(timer)


# =============================================================================
# start 模式
# =============================================================================
class TestStartMode:
    """验证 start 模式行为。"""

    @pytest.mark.asyncio
    async def test_start_returns_zero_elapsed(self, mock_bot, mock_event):
        """start 模式返回 elapsed=0, elapsed_ms=0, error=''。"""
        result = await timer(mock_bot, mock_event, mode='start', timer_id='test1')
        assert result['elapsed'] == 0
        assert result['elapsed_ms'] == 0
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_start_records_timestamp(self, mock_bot, mock_event):
        """start 后 _timers 中应存在该 timer_id。"""
        await timer(mock_bot, mock_event, mode='start', timer_id='test_record')
        assert ('mock_bot_self', 'test_record') in timer_module._timers

    @pytest.mark.asyncio
    async def test_start_default_timer_id(self, mock_bot, mock_event):
        """不传 timer_id 时使用默认值'default'。"""
        await timer(mock_bot, mock_event, mode='start')
        assert ('mock_bot_self', 'default') in timer_module._timers


# =============================================================================
# stop 模式
# =============================================================================
class TestStopMode:
    """验证 stop 模式行为。"""

    @pytest.mark.asyncio
    async def test_stop_after_start_returns_positive(self, mock_bot, mock_event):
        """start 后 stop 返回正数耗时。"""
        await timer(mock_bot, mock_event, mode='start', timer_id='stop1')
        time.sleep(0.05)  # 50ms 确保有可测的耗时（Windows timer 分辨率约 15ms）
        result = await timer(mock_bot, mock_event, mode='stop', timer_id='stop1')
        assert result['error'] == ''
        assert result['elapsed'] > 0
        assert result['elapsed_ms'] > 0

    @pytest.mark.asyncio
    async def test_stop_clears_timer_state(self, mock_bot, mock_event):
        """stop 后 _timers 中不再存在该 timer_id。"""
        await timer(mock_bot, mock_event, mode='start', timer_id='stop_clear')
        await timer(mock_bot, mock_event, mode='stop', timer_id='stop_clear')
        assert ('mock_bot_self', 'stop_clear') not in timer_module._timers

    @pytest.mark.asyncio
    async def test_stop_without_start_returns_error(self, mock_bot, mock_event):
        """未启动即 stop 返回 error 提示。"""
        result = await timer(mock_bot, mock_event, mode='stop', timer_id='not_started')
        assert result['elapsed'] == 0
        assert result['elapsed_ms'] == 0
        assert '未启动' in result['error']


# =============================================================================
# elapsed 模式
# =============================================================================
class TestElapsedMode:
    """验证 elapsed 模式行为。"""

    @pytest.mark.asyncio
    async def test_elapsed_without_stopping(self, mock_bot, mock_event):
        """elapsed 返回正数耗时但不清除计时器。"""
        await timer(mock_bot, mock_event, mode='start', timer_id='el1')
        time.sleep(0.05)  # 50ms 确保有可测的耗时（Windows timer 分辨率约 15ms）
        result = await timer(mock_bot, mock_event, mode='elapsed', timer_id='el1')
        assert result['error'] == ''
        assert result['elapsed'] > 0
        # 计时器仍然存在（未停止）
        assert ('mock_bot_self', 'el1') in timer_module._timers

    @pytest.mark.asyncio
    async def test_elapsed_without_start_returns_error(self, mock_bot, mock_event):
        """未启动即 elapsed 返回 error。"""
        result = await timer(mock_bot, mock_event, mode='elapsed', timer_id='not_started_el')
        assert result['elapsed'] == 0
        assert '未启动' in result['error']


# =============================================================================
# 多计时器独立性 & 边界
# =============================================================================
class TestMultipleTimers:
    """验证多 timer_id 独立性与边界场景。"""

    @pytest.mark.asyncio
    async def test_multiple_timers_independent(self, mock_bot, mock_event):
        """两个不同 timer_id 互不影响。"""
        await timer(mock_bot, mock_event, mode='start', timer_id='a')
        time.sleep(0.05)
        await timer(mock_bot, mock_event, mode='start', timer_id='b')
        # a 应该比 b 耗时长
        res_a = await timer(mock_bot, mock_event, mode='elapsed', timer_id='a')
        res_b = await timer(mock_bot, mock_event, mode='elapsed', timer_id='b')
        assert res_a['elapsed'] > res_b['elapsed']

    @pytest.mark.asyncio
    async def test_empty_timer_id_uses_default(self, mock_bot, mock_event):
        """空字符串 timer_id 回退到'default'。"""
        await timer(mock_bot, mock_event, mode='start', timer_id='')
        assert ('mock_bot_self', 'default') in timer_module._timers

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode 返回 error 提示。"""
        result = await timer(mock_bot, mock_event, mode='pause', timer_id='unknown')
        assert result['elapsed'] == 0
        assert result['elapsed_ms'] == 0
        assert '未知 mode' in result['error']
