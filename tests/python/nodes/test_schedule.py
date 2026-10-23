"""schedule 节点单元测试。

schedule 节点的 builtin handler 仅是 docstring 占位，实际定时逻辑由
Interpreter 的 register_schedules（扫描 flow.json 中的 schedule 触发器）
和 handle_schedule（执行定时任务链）实现。

测试覆盖：
- register_schedules：cron 表达式解析、间隔秒数解析、参数缺失、无效值、优先级、多触发器
- handle_schedule：触发器查找、bot 为 None、链执行异常、提前返回信号

被测源码：qqbat_nodes/builtin/schedule.py + qqbat_nodes/runtime/interpreter.py
"""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.runtime.interpreter import Interpreter, _ChainReturnSignal


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _make_schedule_trigger(trigger_id, cron='', interval_seconds=0):
    """构造一个 schedule 触发器节点。"""
    config = {}
    if cron:
        config['cron'] = cron
    if interval_seconds:
        config['interval_seconds'] = interval_seconds
    return {
        'id': trigger_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'schedule',
            'config': config,
            'label': f'schedule_{trigger_id}',
            'inputs': [],
            'outputs': [],
        },
    }


def _make_other_trigger(trigger_id, kind='on_command'):
    """构造一个非 schedule 触发器节点。"""
    return {
        'id': trigger_id,
        'type': 'trigger',
        'data': {
            'nodeKind': kind,
            'config': {'command': 'test'},
            'inputs': [],
            'outputs': [],
        },
    }


# ---------------------------------------------------------------------------
# Interpreter 工厂 fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def make_interp():
    """构造带 mock registry 的 Interpreter，并 patch load_flow。

    返回 (interpreter, load_flow_mock)，测试可通过 load_flow_mock.return_value
    控制返回的 flow 图。
    """
    patches = []

    p1 = patch('qqbat_nodes.runtime.interpreter.get_handler_registry')
    mock_get = p1.start()
    patches.append(p1)

    mock_reg = MagicMock()
    mock_reg.scan_builtin = MagicMock()
    mock_reg.scan_custom = MagicMock()
    mock_reg.find = MagicMock(return_value=None)
    mock_get.return_value = mock_reg

    p2 = patch('qqbat_nodes.runtime.interpreter.load_flow', return_value=None)
    mock_load = p2.start()
    patches.append(p2)

    interp = Interpreter('.')

    yield interp, mock_load

    for p in patches:
        try:
            p.stop()
        except RuntimeError:
            pass


# ---------------------------------------------------------------------------
# register_schedules 测试
# ---------------------------------------------------------------------------

class TestRegisterSchedules:
    """测试 register_schedules 对 schedule 触发器的扫描与参数解析。"""

    def test_empty_graph_returns_empty(self, make_interp):
        """空 graph（无 nodes）返回空任务列表。"""
        interp, mock_load = make_interp
        mock_load.return_value = {'nodes': [], 'edges': []}
        assert interp.register_schedules() == []

    def test_no_flow_returns_empty(self, make_interp):
        """flow.json 不存在（load_flow 返回 None）返回空列表。"""
        interp, mock_load = make_interp
        mock_load.return_value = None
        assert interp.register_schedules() == []

    def test_cron_trigger_parsed(self, make_interp):
        """cron 表达式触发器被正确解析为 type=cron 任务。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t1', cron='0 9 * * *')],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['trigger_id'] == 't1'
        assert tasks[0]['type'] == 'cron'
        assert tasks[0]['config'] == '0 9 * * *'

    def test_interval_trigger_parsed(self, make_interp):
        """interval_seconds 触发器被正确解析为 type=interval 任务。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t2', interval_seconds=300)],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['trigger_id'] == 't2'
        assert tasks[0]['type'] == 'interval'
        assert tasks[0]['config'] == 300

    def test_cron_takes_priority_over_interval(self, make_interp):
        """同时配置 cron 和 interval 时，cron 优先。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t3', cron='0 0 * * *', interval_seconds=60)],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['type'] == 'cron'

    def test_interval_zero_skipped(self, make_interp):
        """interval_seconds=0 且无 cron 时跳过（不生成任务）。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t4', interval_seconds=0)],
            'edges': [],
        }
        assert interp.register_schedules() == []

    def test_interval_negative_skipped(self, make_interp):
        """interval_seconds 为负数时跳过。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t5', interval_seconds=-10)],
            'edges': [],
        }
        assert interp.register_schedules() == []

    def test_interval_invalid_string_skipped(self, make_interp):
        """interval_seconds 为非法字符串时跳过（不抛异常）。"""
        interp, mock_load = make_interp
        trig = _make_schedule_trigger('t6')
        trig['data']['config']['interval_seconds'] = 'abc'
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        assert interp.register_schedules() == []

    def test_empty_cron_skipped(self, make_interp):
        """cron 为空字符串且无 interval 时跳过。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t7', cron='')],
            'edges': [],
        }
        assert interp.register_schedules() == []

    def test_cron_whitespace_stripped(self, make_interp):
        """cron 表达式前后空白被 strip 后保留。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t8', cron='  0 9 * * *  ')],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['config'] == '0 9 * * *'

    def test_multiple_schedule_triggers(self, make_interp):
        """多个 schedule 触发器都被扫描到，顺序保留。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [
                _make_schedule_trigger('a', cron='0 9 * * *'),
                _make_schedule_trigger('b', interval_seconds=60),
                _make_schedule_trigger('c', cron='0 10 * * *'),
            ],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert len(tasks) == 3
        ids = [t['trigger_id'] for t in tasks]
        assert ids == ['a', 'b', 'c']

    def test_no_schedule_triggers_returns_empty(self, make_interp):
        """flow 中无 schedule 触发器时返回空列表。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_other_trigger('t1', 'on_command')],
            'edges': [],
        }
        assert interp.register_schedules() == []

    def test_non_schedule_triggers_filtered(self, make_interp):
        """非 schedule 触发器（on_command/on_message 等）被过滤掉。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [
                _make_other_trigger('cmd', 'on_command'),
                _make_schedule_trigger('sch', cron='0 9 * * *'),
                _make_other_trigger('msg', 'on_message'),
            ],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['trigger_id'] == 'sch'

    def test_missing_config_field(self, make_interp):
        """触发器无 config 字段时跳过（不抛异常）。"""
        interp, mock_load = make_interp
        trig = {
            'id': 't9',
            'type': 'trigger',
            'data': {'nodeKind': 'schedule'},
        }
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        assert interp.register_schedules() == []

    def test_task_config_fields_complete(self, make_interp):
        """每个任务配置包含 trigger_id/type/config 三个字段。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('t10', cron='0 9 * * *')],
            'edges': [],
        }
        tasks = interp.register_schedules()
        assert set(tasks[0].keys()) == {'trigger_id', 'type', 'config'}


# ---------------------------------------------------------------------------
# handle_schedule 测试
# ---------------------------------------------------------------------------

class TestHandleSchedule:
    """测试 handle_schedule 对定时任务链的执行与错误处理。"""

    @pytest.mark.asyncio
    async def test_no_flow_returns_false(self, make_interp):
        """flow.json 不存在时返回 False。"""
        interp, mock_load = make_interp
        mock_load.return_value = None
        result = await interp.handle_schedule('t1', bot=AsyncMock())
        assert result is False

    @pytest.mark.asyncio
    async def test_trigger_not_found_returns_false(self, make_interp):
        """触发器 ID 不存在时返回 False。"""
        interp, mock_load = make_interp
        mock_load.return_value = {'nodes': [], 'edges': []}
        result = await interp.handle_schedule('ghost', bot=AsyncMock())
        assert result is False

    @pytest.mark.asyncio
    async def test_trigger_found_returns_true(self, make_interp):
        """找到触发器并执行链后返回 True。"""
        interp, mock_load = make_interp
        trig = _make_schedule_trigger('t1', cron='0 9 * * *')
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        with patch.object(interp, '_exec_chain', new=AsyncMock()):
            result = await interp.handle_schedule('t1', bot=AsyncMock())
        assert result is True

    @pytest.mark.asyncio
    async def test_bot_none_returns_true(self, make_interp):
        """bot=None 时仍执行并返回 True（仅记录警告）。"""
        interp, mock_load = make_interp
        trig = _make_schedule_trigger('t1', cron='0 9 * * *')
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        with patch.object(interp, '_exec_chain', new=AsyncMock()):
            result = await interp.handle_schedule('t1', bot=None)
        assert result is True

    @pytest.mark.asyncio
    async def test_chain_exception_swallowed(self, make_interp):
        """链执行抛普通异常时被捕获，仍返回 True。"""
        interp, mock_load = make_interp
        trig = _make_schedule_trigger('t1', cron='0 9 * * *')
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        with patch.object(interp, '_exec_chain',
                          new=AsyncMock(side_effect=RuntimeError('boom'))):
            result = await interp.handle_schedule('t1', bot=AsyncMock())
        assert result is True

    @pytest.mark.asyncio
    async def test_chain_return_signal_caught(self, make_interp):
        """链执行抛 _ChainReturnSignal（提前返回）时被捕获，返回 True。"""
        interp, mock_load = make_interp
        trig = _make_schedule_trigger('t1', cron='0 9 * * *')
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        with patch.object(interp, '_exec_chain',
                          new=AsyncMock(side_effect=_ChainReturnSignal(value='early'))):
            result = await interp.handle_schedule('t1', bot=AsyncMock())
        assert result is True

    @pytest.mark.asyncio
    async def test_exec_chain_called_with_trigger(self, make_interp):
        """handle_schedule 调用 _exec_chain 时传入正确的触发器节点。"""
        interp, mock_load = make_interp
        trig = _make_schedule_trigger('t1', cron='0 9 * * *')
        mock_load.return_value = {'nodes': [trig], 'edges': []}
        mock_exec = AsyncMock()
        with patch.object(interp, '_exec_chain', new=mock_exec):
            await interp.handle_schedule('t1', bot=AsyncMock())
        mock_exec.assert_awaited_once()
        # 第一个位置参数是 trigger 节点
        assert mock_exec.call_args.args[0]['id'] == 't1'

    @pytest.mark.asyncio
    async def test_handle_schedule_with_empty_graph(self, make_interp):
        """flow 图有 nodes 但无目标触发器时返回 False。"""
        interp, mock_load = make_interp
        mock_load.return_value = {
            'nodes': [_make_schedule_trigger('other', cron='0 9 * * *')],
            'edges': [],
        }
        result = await interp.handle_schedule('not_exist', bot=AsyncMock())
        assert result is False
