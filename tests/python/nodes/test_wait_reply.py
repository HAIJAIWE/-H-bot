"""wait_reply 节点单元测试。

wait_reply 节点的 builtin handler 是占位实现（由 interpreter 内联处理），
实际逻辑在 Interpreter._exec_wait_reply 中：
- 发送 prompt 提示消息给用户
- 创建 asyncio.Future 等待用户下一条消息
- 超时返回 timeout_message，收到回复则继续执行后续链

测试覆盖：
- 占位 handler 返回结构验证
- _exec_wait_reply：发送提示（群/私聊）、超时、收到回复、Future 清理、参数解析
- wait_reply Future 路由：用户回复时消费 Future、已完成 Future 清理、多 Future 排队

被测源码：qqbat_nodes/builtin/wait_reply.py + qqbat_nodes/runtime/interpreter.py
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.wait_reply import wait_reply
from qqbat_nodes.runtime.interpreter import Interpreter, _ExecContext


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _make_wait_reply_node(node_id='wr1', prompt='请回复', timeout=60,
                          timeout_message='回复超时'):
    """构造一个 wait_reply 节点。"""
    return {
        'id': node_id,
        'type': 'control',
        'data': {
            'nodeKind': 'wait_reply',
            'config': {
                'prompt': prompt,
                'timeout': timeout,
                'timeout_message': timeout_message,
            },
            'inputs': [],
            'outputs': [],
        },
    }


def _make_ctx(node):
    """构造一个最小 _ExecContext，variables 为空字典。"""
    graph = {'nodes': [node], 'edges': []}
    nodes_by_id = {node['id']: node}
    return _ExecContext(
        graph=graph,
        nodes_by_id=nodes_by_id,
        edges=[],
        variables={},
        trace_id='test',
    )


def _make_event(user_id='123', group_id=''):
    """构造一个 mock event 对象。"""
    event = MagicMock()
    event.user_id = user_id
    event.group_id = group_id
    return event


# ---------------------------------------------------------------------------
# Interpreter 工厂 fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def make_interp():
    """构造带 mock registry 的 Interpreter。"""
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
    p2.start()
    patches.append(p2)
    interp = Interpreter('.')
    yield interp
    for p in patches:
        try:
            p.stop()
        except RuntimeError:
            pass


# ===========================================================================
# 占位 handler 测试
# ===========================================================================

class TestWaitReplyPlaceholder:
    """测试 builtin/wait_reply.py 占位 handler 的返回结构。"""

    @pytest.mark.asyncio
    async def test_default_return_structure(self, mock_bot, mock_event):
        """占位 handler 返回包含 result/is_timeout/error 三个字段。"""
        result = await wait_reply(mock_bot, mock_event)
        assert set(result.keys()) == {'result', 'is_timeout', 'error'}

    @pytest.mark.asyncio
    async def test_returns_result_empty_string(self, mock_bot, mock_event):
        """result 字段默认为空字符串。"""
        result = await wait_reply(mock_bot, mock_event)
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_returns_is_timeout_false(self, mock_bot, mock_event):
        """is_timeout 字段默认为 False。"""
        result = await wait_reply(mock_bot, mock_event)
        assert result['is_timeout'] is False

    @pytest.mark.asyncio
    async def test_returns_error_empty_string(self, mock_bot, mock_event):
        """error 字段默认为空字符串。"""
        result = await wait_reply(mock_bot, mock_event)
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_accepts_all_params(self, mock_bot, mock_event):
        """占位 handler 接受 prompt/timeout/timeout_message 参数不报错。"""
        result = await wait_reply(
            mock_bot, mock_event,
            prompt='请输入', timeout=30, timeout_message='超时了',
        )
        assert isinstance(result, dict)


# ===========================================================================
# _exec_wait_reply 发送提示消息测试
# ===========================================================================

class TestExecWaitReplyPrompt:
    """测试 _exec_wait_reply 发送提示消息的逻辑。"""

    @pytest.mark.asyncio
    async def test_sends_prompt_to_group(self, make_interp):
        """group_id 存在时调用 send_group_msg 发送提示。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='456')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 5, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(return_value='ok')):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        bot.call_api.assert_any_call('send_group_msg', group_id=456, message='请回复')

    @pytest.mark.asyncio
    async def test_sends_prompt_to_private(self, make_interp):
        """仅有 user_id（无 group_id）时调用 send_private_msg。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 5, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(return_value='ok')):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        bot.call_api.assert_any_call('send_private_msg', user_id=123, message='请回复')

    @pytest.mark.asyncio
    async def test_empty_prompt_not_sent(self, make_interp):
        """prompt 为空时不调用 bot.call_api 发送消息。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='456')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '', 'timeout': 5, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(return_value='ok')):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_prompt_send_failure_swallowed(self, make_interp):
        """发送提示消息失败时不影响后续等待逻辑（异常被吞）。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        bot.call_api = AsyncMock(side_effect=RuntimeError('send failed'))
        event = _make_event(user_id='123', group_id='456')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 5, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(return_value='ok')):
                # 不应抛异常
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        # 即使发送失败，后续 wait_for 仍然执行
        assert ctx.variables.get('wr1:result') == 'ok'


# ===========================================================================
# _exec_wait_reply 超时与回复测试
# ===========================================================================

class TestExecWaitReplyTimeout:
    """测试 _exec_wait_reply 的超时与回复接收逻辑。"""

    @pytest.mark.asyncio
    async def test_timeout_sets_timeout_message(self, make_interp):
        """超时后 result 设为 timeout_message，is_timeout=True。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复', timeout_message='已超时')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 5, 'timeout_message': '已超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(side_effect=asyncio.TimeoutError())):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        assert ctx.variables['wr1:result'] == '已超时'
        assert ctx.variables['wr1:is_timeout'] is True
        assert ctx.variables['wr1:error'] == ''

    @pytest.mark.asyncio
    async def test_reply_received_sets_result(self, make_interp):
        """收到回复后 result 设为回复内容，is_timeout=False。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 60, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(return_value='用户回复了')):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        assert ctx.variables['wr1:result'] == '用户回复了'
        assert ctx.variables['wr1:is_timeout'] is False
        assert ctx.variables['wr1:error'] == ''

    @pytest.mark.asyncio
    async def test_future_removed_after_resolve(self, make_interp):
        """收到回复后 Future 从 _wait_reply_futures 列表中移除。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 60, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(return_value='ok')):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        # Future 已被清理
        wait_key = ('123', '')
        assert wait_key not in interp._wait_reply_futures or \
               len(interp._wait_reply_futures[wait_key]) == 0

    @pytest.mark.asyncio
    async def test_future_removed_after_timeout(self, make_interp):
        """超时后 Future 也从 _wait_reply_futures 列表中移除。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 5, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(side_effect=asyncio.TimeoutError())):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        wait_key = ('123', '')
        assert wait_key not in interp._wait_reply_futures or \
               len(interp._wait_reply_futures[wait_key]) == 0

    @pytest.mark.asyncio
    async def test_custom_timeout_value_used(self, make_interp):
        """自定义 timeout 值被传递给 asyncio.wait_for。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        mock_wait = AsyncMock(return_value='ok')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 42, 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for', new=mock_wait):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        # wait_for 的 timeout 作为关键字参数传递
        assert mock_wait.call_args.kwargs['timeout'] == 42

    @pytest.mark.asyncio
    async def test_default_timeout_when_not_specified(self, make_interp):
        """kwargs 中无 timeout 时使用 config 中的默认值 60。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复', timeout=60)
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        mock_wait = AsyncMock(return_value='ok')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout_message': '超时'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for', new=mock_wait):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        assert mock_wait.call_args.kwargs['timeout'] == 60

    @pytest.mark.asyncio
    async def test_custom_timeout_message_on_timeout(self, make_interp):
        """超时时使用自定义 timeout_message。"""
        interp = make_interp
        node = _make_wait_reply_node('wr1', prompt='请回复', timeout_message='时间到啦')
        ctx = _make_ctx(node)
        ctx.find_control_next = MagicMock(return_value=None)
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')

        with patch.object(interp, '_resolve_input_kwargs', new=AsyncMock(
                return_value={'prompt': '请回复', 'timeout': 5, 'timeout_message': '时间到啦'})):
            with patch('qqbat_nodes.runtime.interpreter.asyncio.wait_for',
                       new=AsyncMock(side_effect=asyncio.TimeoutError())):
                await interp._exec_wait_reply(node, ctx, bot, event, set())

        assert ctx.variables['wr1:result'] == '时间到啦'


# ===========================================================================
# Future 路由测试（handle_event 中消费 wait_reply Future）
# ===========================================================================

class TestWaitReplyFutureRouting:
    """测试 handle_event 中 wait_reply Future 的路由与消费逻辑。"""

    @pytest.mark.asyncio
    async def test_no_future_falls_through(self, make_interp):
        """无 wait_reply Future 时 handle_event 正常往下走（返回 False）。"""
        interp = make_interp
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        event.get_message = MagicMock(return_value='hello')

        result = await interp.handle_event(bot, event)
        # load_flow 返回 None → False
        assert result is False

    @pytest.mark.asyncio
    async def test_future_consumed_returns_true(self, make_interp):
        """存在 Future 时用户回复被消费，handle_event 返回 True。"""
        interp = make_interp
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        event.get_message = MagicMock(return_value='用户回复')

        # 预置一个 pending Future
        future = asyncio.Future()
        interp._wait_reply_futures[('123', '')] = [future]

        result = await interp.handle_event(bot, event)
        assert result is True
        assert future.result() == '用户回复'

    @pytest.mark.asyncio
    async def test_done_future_cleaned_up(self, make_interp):
        """已完成的 Future 被清理，继续检查后续 Future。"""
        interp = make_interp
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        event.get_message = MagicMock(return_value='回复2')

        done_future = asyncio.Future()
        done_future.set_result('旧回复')
        pending_future = asyncio.Future()
        interp._wait_reply_futures[('123', '')] = [done_future, pending_future]

        result = await interp.handle_event(bot, event)
        assert result is True
        assert pending_future.result() == '回复2'

    @pytest.mark.asyncio
    async def test_multiple_futures_consumed_in_order(self, make_interp):
        """多个 Future 按顺序消费：第一条回复消费第一个 Future。"""
        interp = make_interp
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        event.get_message = MagicMock(return_value='第一条回复')

        f1 = asyncio.Future()
        f2 = asyncio.Future()
        interp._wait_reply_futures[('123', '')] = [f1, f2]

        result = await interp.handle_event(bot, event)
        assert result is True
        assert f1.result() == '第一条回复'
        assert not f2.done()
        # f2 仍在队列中
        assert len(interp._wait_reply_futures[('123', '')]) == 1

    @pytest.mark.asyncio
    async def test_empty_future_list_cleaned_up(self, make_interp):
        """Future 列表为空时 key 被清理（避免内存泄漏）。"""
        interp = make_interp
        bot = AsyncMock()
        event = _make_event(user_id='123', group_id='')
        event.get_message = MagicMock(return_value='回复')

        future = asyncio.Future()
        future.set_result('已 done')
        interp._wait_reply_futures[('123', '')] = [future]

        await interp.handle_event(bot, event)
        # 唯一的 Future 已 done → 被清理 → 列表空 → key 被删除
        assert ('123', '') not in interp._wait_reply_futures

    @pytest.mark.asyncio
    async def test_different_user_key_isolated(self, make_interp):
        """不同 (user_id, group_id) 的 Future 互不干扰。"""
        interp = make_interp
        bot = AsyncMock()
        event = _make_event(user_id='999', group_id='')
        event.get_message = MagicMock(return_value='用户999的回复')

        future_123 = asyncio.Future()
        interp._wait_reply_futures[('123', '')] = [future_123]

        result = await interp.handle_event(bot, event)
        # user 999 没有 wait_reply Future，往下走 → load_flow=None → False
        assert result is False
        assert not future_123.done()
