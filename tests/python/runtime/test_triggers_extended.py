"""扩展触发器测试 — 补充 on_request/on_notice/schedule 三个触发器的单元测试。

覆盖：
- on_request: 加好友请求匹配 / 加群请求匹配 / 类型不匹配
- on_notice: 入群通知匹配 / 退群通知匹配 / any 通配 / 类型不匹配
- schedule: register_schedules 扫描 cron/interval / handle_schedule 执行链 / 不存在的触发器
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from qqbat_nodes.runtime.interpreter import Interpreter, match_trigger


# =========================================================================
# Mock handlers
# =========================================================================
async def mock_send_message(bot, event, text=''):
    if text is None:
        text = ''
    await bot.send(event, str(text))
    return {"success": True, "error": ""}


# =========================================================================
# Mock event classes
# =========================================================================
class MockRequestEvent:
    """模拟 NoneBot FriendRequestEvent / GroupRequestEvent。"""

    def __init__(self, request_type='friend', sub_type='', user_id='100',
                 group_id='', comment='请加我', flag='flag123'):
        self.request_type = request_type
        self.sub_type = sub_type
        self.user_id = user_id
        self.group_id = group_id
        self.comment = comment
        self.flag = flag

    def get_message(self):
        return ''


class MockNoticeEvent:
    """模拟 NoneBot NoticeEvent。"""

    def __init__(self, notice_type='group_increase', sub_type='',
                 user_id='200', group_id='group1', operator_id='300'):
        self.notice_type = notice_type
        self.sub_type = sub_type
        self.user_id = user_id
        self.group_id = group_id
        self.operator_id = operator_id

    def get_message(self):
        return ''


# =========================================================================
# Trigger node builders
# =========================================================================
def make_on_request_trigger(node_id='trig_req', request_type='friend'):
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_request',
            'config': {'request_type': request_type},
            'inputs': [],
            'outputs': [],
        },
    }


def make_on_notice_trigger(node_id='trig_not', notice_type='any'):
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_notice',
            'config': {'notice_type': notice_type},
            'inputs': [],
            'outputs': [],
        },
    }


def make_schedule_trigger(node_id='trig_sched', cron='', interval_seconds=0):
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'schedule',
            'config': {
                'cron': cron,
                'interval_seconds': interval_seconds,
            },
            'inputs': [],
            'outputs': [
                {'id': 'next', 'kind': 'control'},
                {'id': 'time', 'kind': 'data', 'dataType': 'datetime'},
            ],
        },
    }


def make_send_node(node_id, text):
    return {
        'id': node_id,
        'type': 'action',
        'data': {
            'nodeKind': 'send_message',
            'config': {'text': text},
            'inputs': [],
            'outputs': [],
        },
    }


def make_edge(source, target, source_port='next', target_port='in'):
    return {
        'source': source,
        'sourcePort': source_port,
        'target': target,
        'targetPort': target_port,
    }


# =========================================================================
# on_request 触发器测试
# =========================================================================
class TestOnRequestTrigger:
    def test_friend_request_matches(self):
        """加好友请求匹配 request_type=friend。"""
        trigger = make_on_request_trigger('trig', request_type='friend')
        event = MockRequestEvent(request_type='friend', user_id='100')
        result = match_trigger(trigger, event)
        assert result is not None
        assert result['request_type'] == 'friend'
        assert result['user_id'] == '100'
        assert result['comment'] == '请加我'
        assert result['flag'] == 'flag123'

    def test_group_request_matches(self):
        """加群请求匹配 request_type=group。"""
        trigger = make_on_request_trigger('trig', request_type='group')
        event = MockRequestEvent(
            request_type='group', sub_type='add',
            user_id='100', group_id='group1'
        )
        result = match_trigger(trigger, event)
        assert result is not None
        assert result['request_type'] == 'group'

    def test_any_request_type_matches_all(self):
        """request_type=any 匹配任意请求。"""
        trigger = make_on_request_trigger('trig', request_type='any')
        event = MockRequestEvent(request_type='friend')
        result = match_trigger(trigger, event)
        assert result is not None

        event2 = MockRequestEvent(request_type='group')
        result2 = match_trigger(trigger, event2)
        assert result2 is not None

    def test_request_type_mismatch_returns_none(self):
        """类型不匹配返回 None。"""
        trigger = make_on_request_trigger('trig', request_type='friend')
        event = MockRequestEvent(request_type='group')
        result = match_trigger(trigger, event)
        assert result is None

    @pytest.mark.asyncio
    async def test_handle_request_event_executes_chain(self, make_interpreter, mock_bot):
        """handle_request_event 应执行匹配的 on_request 链。"""
        graph = {
            'nodes': [
                make_on_request_trigger('trig_req', request_type='friend'),
                make_send_node('send_welcome', '欢迎加好友'),
            ],
            'edges': [
                make_edge('trig_req', 'send_welcome'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = MockRequestEvent(request_type='friend', user_id='100')
        result = await interp.handle_request_event(mock_bot, event)
        assert result is True
        # send_message 应被调用
        assert mock_bot.send.call_count == 1
        sent_text = mock_bot.send.call_args.args[1]
        assert sent_text == '欢迎加好友'

    @pytest.mark.asyncio
    async def test_handle_request_event_no_match(self, make_interpreter, mock_bot):
        """无匹配触发器时返回 False。"""
        graph = {
            'nodes': [
                make_on_request_trigger('trig_req', request_type='friend'),
                make_send_node('send_welcome', '欢迎'),
            ],
            'edges': [
                make_edge('trig_req', 'send_welcome'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        # group 请求不匹配 friend 触发器
        event = MockRequestEvent(request_type='group')
        result = await interp.handle_request_event(mock_bot, event)
        assert result is False
        assert mock_bot.send.call_count == 0


# =========================================================================
# on_notice 触发器测试
# =========================================================================
class TestOnNoticeTrigger:
    def test_group_increase_notice_matches(self):
        """入群通知匹配 notice_type=group_increase。"""
        trigger = make_on_notice_trigger('trig', notice_type='group_increase')
        event = MockNoticeEvent(notice_type='group_increase', user_id='200')
        result = match_trigger(trigger, event)
        assert result is not None
        assert result['notice_type'] == 'group_increase'
        assert result['user_id'] == '200'
        assert result['group_id'] == 'group1'
        assert result['operator_id'] == '300'

    def test_group_decrease_notice_matches(self):
        """退群通知匹配 notice_type=group_decrease。"""
        trigger = make_on_notice_trigger('trig', notice_type='group_decrease')
        event = MockNoticeEvent(notice_type='group_decrease')
        result = match_trigger(trigger, event)
        assert result is not None

    def test_any_notice_type_matches_all(self):
        """notice_type=any 匹配任意通知。"""
        trigger = make_on_notice_trigger('trig', notice_type='any')
        event = MockNoticeEvent(notice_type='group_increase')
        result = match_trigger(trigger, event)
        assert result is not None

        event2 = MockNoticeEvent(notice_type='group_recall')
        result2 = match_trigger(trigger, event2)
        assert result2 is not None

    def test_notice_type_mismatch_returns_none(self):
        """类型不匹配返回 None。"""
        trigger = make_on_notice_trigger('trig', notice_type='group_increase')
        event = MockNoticeEvent(notice_type='group_decrease')
        result = match_trigger(trigger, event)
        assert result is None

    @pytest.mark.asyncio
    async def test_handle_notice_event_executes_chain(self, make_interpreter, mock_bot):
        """handle_notice_event 应执行匹配的 on_notice 链。"""
        graph = {
            'nodes': [
                make_on_notice_trigger('trig_not', notice_type='group_increase'),
                make_send_node('send_welcome', '欢迎入群'),
            ],
            'edges': [
                make_edge('trig_not', 'send_welcome'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = MockNoticeEvent(notice_type='group_increase', user_id='200')
        result = await interp.handle_notice_event(mock_bot, event)
        assert result is True
        assert mock_bot.send.call_count == 1
        sent_text = mock_bot.send.call_args.args[1]
        assert sent_text == '欢迎入群'

    @pytest.mark.asyncio
    async def test_handle_notice_event_no_match(self, make_interpreter, mock_bot):
        """无匹配触发器时返回 False。"""
        graph = {
            'nodes': [
                make_on_notice_trigger('trig_not', notice_type='group_increase'),
                make_send_node('send_welcome', '欢迎'),
            ],
            'edges': [
                make_edge('trig_not', 'send_welcome'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = MockNoticeEvent(notice_type='group_decrease')
        result = await interp.handle_notice_event(mock_bot, event)
        assert result is False
        assert mock_bot.send.call_count == 0


# =========================================================================
# schedule 触发器测试
# =========================================================================
class TestScheduleTrigger:
    def test_register_schedules_cron(self, make_interpreter):
        """register_schedules 扫描 cron 类型的 schedule 触发器。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='0 * * * *'),
                make_send_node('send1', 'cron_task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['trigger_id'] == 'sched1'
        assert tasks[0]['type'] == 'cron'
        assert tasks[0]['config'] == '0 * * * *'

    def test_register_schedules_interval(self, make_interpreter):
        """register_schedules 扫描 interval 类型的 schedule 触发器。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', interval_seconds=60),
                make_send_node('send1', 'interval_task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        tasks = interp.register_schedules()
        assert len(tasks) == 1
        assert tasks[0]['trigger_id'] == 'sched1'
        assert tasks[0]['type'] == 'interval'
        assert tasks[0]['config'] == 60

    def test_register_schedules_empty_when_no_config(self, make_interpreter):
        """无 cron 且 interval=0 的 schedule 触发器不注册任务。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='', interval_seconds=0),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        tasks = interp.register_schedules()
        assert len(tasks) == 0

    def test_register_schedules_multiple(self, make_interpreter):
        """多个 schedule 触发器都应被扫描。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched_cron', cron='0 0 * * *'),
                make_schedule_trigger('sched_interval', interval_seconds=120),
                make_schedule_trigger('sched_empty', cron='', interval_seconds=0),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('sched_cron', 'send1'),
                make_edge('sched_interval', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        tasks = interp.register_schedules()
        assert len(tasks) == 2
        trigger_ids = [t['trigger_id'] for t in tasks]
        assert 'sched_cron' in trigger_ids
        assert 'sched_interval' in trigger_ids
        assert 'sched_empty' not in trigger_ids

    @pytest.mark.asyncio
    async def test_handle_schedule_executes_chain(self, make_interpreter, mock_bot):
        """handle_schedule 应执行 schedule 触发器的链。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='0 * * * *'),
                make_send_node('send1', 'scheduled_task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        result = await interp.handle_schedule('sched1', mock_bot)
        assert result is True
        assert mock_bot.send.call_count == 1

    @pytest.mark.asyncio
    async def test_handle_schedule_trigger_not_found(self, make_interpreter, mock_bot):
        """handle_schedule 触发器不存在时返回 False。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='0 * * * *'),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        result = await interp.handle_schedule('nonexistent', mock_bot)
        assert result is False
        assert mock_bot.send.call_count == 0

    @pytest.mark.asyncio
    async def test_handle_schedule_with_none_bot(self, make_interpreter, mock_bot):
        """handle_schedule bot=None 时仍应执行（仅警告）。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='0 * * * *'),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        # bot=None 应不抛异常（链中 send_message 可能失败但不影响 schedule 执行）
        result = await interp.handle_schedule('sched1', None)
        assert result is True


# =========================================================================
# on_ready 触发器测试
# =========================================================================
def make_on_ready_trigger(node_id='trig_ready'):
    """构造 on_ready 触发器节点。"""
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_ready',
            'config': {},
            'inputs': [],
            'outputs': [
                {'id': 'next', 'kind': 'control'},
                {'id': 'event', 'kind': 'data', 'dataType': 'event'},
                {'id': 'ready_at', 'kind': 'data', 'dataType': 'number'},
            ],
        },
    }


class TestOnReadyTrigger:
    def test_match_trigger_returns_none(self):
        """on_ready 非事件驱动，match_trigger 应返回 None。"""
        trigger = make_on_ready_trigger()
        event = MockNoticeEvent()  # 任意事件都应返回 None
        result = match_trigger(trigger, event)
        assert result is None

    @pytest.mark.asyncio
    async def test_handle_ready_executes_chain(self, make_interpreter, mock_bot):
        """handle_ready 应执行所有 on_ready 触发器的链。"""
        graph = {
            'nodes': [
                make_on_ready_trigger('ready1'),
                make_send_node('send1', 'bot_online'),
            ],
            'edges': [
                make_edge('ready1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        executed = await interp.handle_ready(mock_bot)
        assert executed == 1
        assert mock_bot.send.call_count == 1

    @pytest.mark.asyncio
    async def test_handle_ready_multiple_triggers(self, make_interpreter, mock_bot):
        """多个 on_ready 触发器都应被执行。"""
        graph = {
            'nodes': [
                make_on_ready_trigger('ready1'),
                make_on_ready_trigger('ready2'),
                make_send_node('send1', 'msg1'),
                make_send_node('send2', 'msg2'),
            ],
            'edges': [
                make_edge('ready1', 'send1'),
                make_edge('ready2', 'send2'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        executed = await interp.handle_ready(mock_bot)
        assert executed == 2
        assert mock_bot.send.call_count == 2

    @pytest.mark.asyncio
    async def test_handle_ready_no_triggers(self, make_interpreter, mock_bot):
        """无 on_ready 触发器时返回 0。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='0 * * * *'),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        executed = await interp.handle_ready(mock_bot)
        assert executed == 0
        assert mock_bot.send.call_count == 0

    @pytest.mark.asyncio
    async def test_handle_ready_with_none_bot(self, make_interpreter, mock_bot):
        """handle_ready bot=None 时仍应执行（仅警告）。"""
        graph = {
            'nodes': [
                make_on_ready_trigger('ready1'),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('ready1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        # bot=None 应不抛异常（链中 send_message 可能失败但不影响 on_ready 执行计数）
        executed = await interp.handle_ready(None)
        assert executed == 1

    @pytest.mark.asyncio
    async def test_handle_ready_empty_graph(self, make_interpreter, mock_bot):
        """空 graph 时返回 0。"""
        graph = {'nodes': [], 'edges': []}
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        executed = await interp.handle_ready(mock_bot)
        assert executed == 0


# =========================================================================
# on_startup 触发器测试
# =========================================================================
def make_on_startup_trigger(node_id='trig_startup'):
    """构造 on_startup 触发器节点。"""
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_startup',
            'config': {},
            'inputs': [],
            'outputs': [
                {'id': 'next', 'kind': 'control'},
                {'id': 'event', 'kind': 'data', 'dataType': 'event'},
                {'id': 'started_at', 'kind': 'data', 'dataType': 'number'},
            ],
        },
    }


class TestOnStartupTrigger:
    def test_match_trigger_returns_none(self):
        """on_startup 非事件驱动，match_trigger 应返回 None。"""
        trigger = make_on_startup_trigger()
        event = MockNoticeEvent()
        result = match_trigger(trigger, event)
        assert result is None

    @pytest.mark.asyncio
    async def test_handle_startup_executes_chain(self, make_interpreter):
        """handle_startup 应执行所有 on_startup 触发器的链（bot=None）。"""
        # on_startup 使用 set_variable 节点验证链执行（不依赖 bot）
        async def mock_set_variable(bot, event, name='', value=''):
            return {'name': name, 'value': value}

        graph = {
            'nodes': [
                make_on_startup_trigger('startup1'),
                {
                    'id': 'setvar1',
                    'type': 'action',
                    'data': {
                        'nodeKind': 'set_variable',
                        'config': {'name': 'init', 'value': 'done'},
                        'inputs': [],
                        'outputs': [],
                    },
                },
            ],
            'edges': [
                make_edge('startup1', 'setvar1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'set_variable': mock_set_variable})
        executed = await interp.handle_startup()
        assert executed == 1

    @pytest.mark.asyncio
    async def test_handle_startup_multiple_triggers(self, make_interpreter):
        """多个 on_startup 触发器都应被执行。"""
        async def mock_set_variable(bot, event, name='', value=''):
            return {'name': name, 'value': value}

        graph = {
            'nodes': [
                make_on_startup_trigger('startup1'),
                make_on_startup_trigger('startup2'),
                {
                    'id': 'setvar1',
                    'type': 'action',
                    'data': {
                        'nodeKind': 'set_variable',
                        'config': {'name': 'a', 'value': '1'},
                        'inputs': [],
                        'outputs': [],
                    },
                },
                {
                    'id': 'setvar2',
                    'type': 'action',
                    'data': {
                        'nodeKind': 'set_variable',
                        'config': {'name': 'b', 'value': '2'},
                        'inputs': [],
                        'outputs': [],
                    },
                },
            ],
            'edges': [
                make_edge('startup1', 'setvar1'),
                make_edge('startup2', 'setvar2'),
            ],
        }
        interp = make_interpreter(graph, handlers={'set_variable': mock_set_variable})
        executed = await interp.handle_startup()
        assert executed == 2

    @pytest.mark.asyncio
    async def test_handle_startup_no_triggers(self, make_interpreter):
        """无 on_startup 触发器时返回 0。"""
        graph = {
            'nodes': [
                make_schedule_trigger('sched1', cron='0 * * * *'),
                make_send_node('send1', 'task'),
            ],
            'edges': [
                make_edge('sched1', 'send1'),
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        executed = await interp.handle_startup()
        assert executed == 0

    @pytest.mark.asyncio
    async def test_handle_startup_empty_graph(self, make_interpreter):
        """空 graph 时返回 0。"""
        graph = {'nodes': [], 'edges': []}
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        executed = await interp.handle_startup()
        assert executed == 0
