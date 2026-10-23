"""扩展控制流节点测试 — 补充节点的单元测试。

覆盖：
- try_catch: try 成功 / try 异常 → catch / finally 总执行
- loop_while: 条件 true/false / max_iter 限制
- break_loop: 循环内 break 信号传播
- return_chain: 提前返回链
- assert_node: 断言通过 / 断言失败中断（已合并为 error_op）

注：call_command 节点已移除（与 subflow_call 功能重叠），相关测试已删除。
注：wait_reply 节点已合并到 wait_input（新增 expected_pattern 校验），相关测试已删除。
注：parallel_exec 节点已在节点系统重写中移除，相关测试已删除。
"""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


# =========================================================================
# Mock handlers
# =========================================================================
async def mock_send_message(bot, event, text=''):
    if text is None:
        text = ''
    await bot.send(event, str(text))
    return {"success": True, "error": ""}


async def mock_error_op(bot, event, mode='assert', condition=False, message='断言失败'):
    """error_op handler mock（throw/assert 二合一）。"""
    if mode == 'throw':
        from qqbat_nodes.builtin.error_op import BusinessError
        raise BusinessError(str(message) if message else '业务异常')
    if condition:
        return {"passed": True, "error": ""}
    return {"passed": False, "error": message}


async def mock_flow_control(bot, event, mode='break', value=None):
    """flow_control handler mock（break/return 二合一）。"""
    if mode == 'return':
        return {"_return": True, "result": value}
    return {"_break": True}


async def mock_raise_handler(bot, event, **kwargs):
    """始终抛出异常的 handler，用于测试 try_catch。"""
    raise RuntimeError("模拟执行失败")


# =========================================================================
# Helper builders
# =========================================================================
def make_trigger_node(node_id='trig', command='test', prefix='/'):
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_command',
            'config': {'command': command, 'prefix': prefix},
            'inputs': [],
            'outputs': [],
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


def make_try_catch_node(node_id):
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'try_catch',
            'config': {},
            'inputs': [{'id': 'in', 'kind': 'control'}],
            'outputs': [
                {'id': 'try', 'kind': 'control'},
                {'id': 'catch', 'kind': 'control'},
                {'id': 'finally', 'kind': 'control'},
                {'id': 'error_message', 'kind': 'data', 'dataType': 'string'},
                {'id': 'result', 'kind': 'data', 'dataType': 'string'},
            ],
        },
    }


def make_loop_while_node(node_id, expression='value == True', max_iterations=100):
    """构造 loop(mode='while') 节点（原 loop_while 已合并到 loop）。"""
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'loop',
            'config': {
                'mode': 'while',
                'expression': expression,
                'max_iterations': max_iterations,
            },
            'inputs': [
                {'id': 'in', 'kind': 'control'},
                {'id': 'expression', 'kind': 'data', 'dataType': 'string'},
                {'id': 'max_iterations', 'kind': 'data', 'dataType': 'number'},
            ],
            'outputs': [
                {'id': 'body', 'kind': 'control'},
                {'id': 'done', 'kind': 'control'},
                {'id': 'index', 'kind': 'data', 'dataType': 'number'},
                {'id': 'result', 'kind': 'data', 'dataType': 'number'},
            ],
        },
    }


def make_break_loop_node(node_id):
    """构造 flow_control(mode='break') 节点（原 break_loop 已合并）。"""
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'flow_control',
            'config': {'mode': 'break'},
            'inputs': [{'id': 'in', 'kind': 'control'}],
            'outputs': [{'id': 'out', 'kind': 'control'}],
        },
    }


def make_return_chain_node(node_id, value=None):
    """构造 flow_control(mode='return') 节点（原 return_chain 已合并）。"""
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'flow_control',
            'config': {'mode': 'return', 'value': value},
            'inputs': [
                {'id': 'in', 'kind': 'control'},
                {'id': 'value', 'kind': 'data', 'dataType': 'any'},
            ],
            'outputs': [{'id': 'out', 'kind': 'control'}],
        },
    }


def make_error_op_node(node_id, mode='assert', condition=True, message='断言失败'):
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'error_op',
            'config': {'mode': mode, 'condition': condition, 'message': message},
            'inputs': [
                {'id': 'in', 'kind': 'control'},
                {'id': 'condition', 'kind': 'data', 'dataType': 'boolean'},
                {'id': 'message', 'kind': 'data', 'dataType': 'string'},
            ],
            'outputs': [
                {'id': 'out', 'kind': 'control'},
                {'id': 'passed', 'kind': 'data', 'dataType': 'boolean'},
                {'id': 'error', 'kind': 'data', 'dataType': 'string'},
            ],
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
# try_catch 测试
# =========================================================================
class TestTryCatch:
    @pytest.mark.asyncio
    async def test_try_success_path(self, make_interpreter, mock_bot, make_event):
        """try 子链正常 → result=ok，不执行 catch。"""
        graph = {
            'nodes': [
                make_trigger_node(),
                make_try_catch_node('tc1'),
                make_send_node('try_send', 'try_ok'),
                make_send_node('catch_send', 'catch_hit'),
                make_send_node('finally_send', 'finally_done'),
            ],
            'edges': [
                make_edge('trig', 'tc1'),
                {'source': 'tc1', 'sourcePort': 'try', 'target': 'try_send', 'targetPort': 'in'},
                {'source': 'tc1', 'sourcePort': 'catch', 'target': 'catch_send', 'targetPort': 'in'},
                {'source': 'tc1', 'sourcePort': 'finally', 'target': 'finally_send', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': mock_send_message,
            'try_catch': AsyncMock(return_value={"result": "ok", "error": ""}),
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # try 分支与 finally 分支各执行一次，catch 不应执行
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'try_ok' in sent_texts
        assert 'finally_done' in sent_texts
        assert 'catch_hit' not in sent_texts

    @pytest.mark.asyncio
    async def test_try_exception_goes_to_catch(self, make_interpreter, mock_bot, make_event):
        """try 子链抛出 _ChainReturnSignal（如 return_chain）→ 走 catch 分支，finally 仍执行。

        注：普通 handler 异常被 _exec_normal_node 内部 catch，不会传播到 try_catch。
        只有 _ChainReturnSignal（return_chain/error_op(assert) 失败）才会传播。
        """
        # 在 try 子链中放 return_chain 节点，它会抛出 _ChainReturnSignal
        graph = {
            'nodes': [
                make_trigger_node(),
                make_try_catch_node('tc1'),
                make_return_chain_node('rc_in_try', value='early_return'),
                make_send_node('catch_send', 'catch_handled'),
                make_send_node('finally_send', 'finally_done'),
            ],
            'edges': [
                make_edge('trig', 'tc1'),
                {'source': 'tc1', 'sourcePort': 'try', 'target': 'rc_in_try', 'targetPort': 'in'},
                {'source': 'tc1', 'sourcePort': 'catch', 'target': 'catch_send', 'targetPort': 'in'},
                {'source': 'tc1', 'sourcePort': 'finally', 'target': 'finally_send', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': mock_send_message,
            'try_catch': AsyncMock(return_value={"result": "ok", "error": ""}),
            'flow_control': AsyncMock(return_value={"_return": True, "result": "early_return"}),
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        # return_chain 信号被 try_catch 捕获 → 走 catch 分支
        assert 'catch_handled' in sent_texts
        # finally 仍应执行
        assert 'finally_done' in sent_texts

    @pytest.mark.asyncio
    async def test_finally_always_executes(self, make_interpreter, mock_bot, make_event):
        """无论 try 成功或失败，finally 子链都应执行。"""
        graph = {
            'nodes': [
                make_trigger_node(),
                make_try_catch_node('tc1'),
                make_send_node('try_send', 'try_ok'),
                make_send_node('finally_send', 'finally_done'),
            ],
            'edges': [
                make_edge('trig', 'tc1'),
                {'source': 'tc1', 'sourcePort': 'try', 'target': 'try_send', 'targetPort': 'in'},
                {'source': 'tc1', 'sourcePort': 'finally', 'target': 'finally_send', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': mock_send_message,
            'try_catch': AsyncMock(return_value={"result": "ok", "error": ""}),
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'try_ok' in sent_texts
        assert 'finally_done' in sent_texts


# =========================================================================
# loop_while 测试
# =========================================================================
class TestLoopWhile:
    @pytest.mark.asyncio
    async def test_loop_while_condition_false_initially(self, make_interpreter, mock_bot, make_event):
        """初始条件为 False → 不执行 body，直接走 done。"""
        graph = {
            'nodes': [
                make_trigger_node(),
                make_loop_while_node('lw1', expression='False', max_iterations=10),
                make_send_node('body', 'body_iter'),
                make_send_node('done', 'done_ok'),
            ],
            'edges': [
                make_edge('trig', 'lw1'),
                {'source': 'lw1', 'sourcePort': 'body', 'target': 'body', 'targetPort': 'in'},
                {'source': 'lw1', 'sourcePort': 'done', 'target': 'done', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'body_iter' not in sent_texts
        assert 'done_ok' in sent_texts

    @pytest.mark.asyncio
    async def test_loop_while_max_iterations(self, make_interpreter, mock_bot, make_event):
        """条件恒为 True 但 max_iterations=3 → body 执行 3 次后走 done。"""
        iter_count = [0]

        async def count_send(bot, event, text=''):
            if text == 'body_iter':
                iter_count[0] += 1
            await bot.send(event, str(text))
            return {"success": True, "error": ""}

        graph = {
            'nodes': [
                make_trigger_node(),
                make_loop_while_node('lw1', expression='True', max_iterations=3),
                make_send_node('body', 'body_iter'),
                make_send_node('done', 'done_ok'),
            ],
            'edges': [
                make_edge('trig', 'lw1'),
                {'source': 'lw1', 'sourcePort': 'body', 'target': 'body', 'targetPort': 'in'},
                {'source': 'lw1', 'sourcePort': 'done', 'target': 'done', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': count_send})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        assert iter_count[0] == 3
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'done_ok' in sent_texts


# =========================================================================
# break_loop 测试
# =========================================================================
class TestBreakLoop:
    @pytest.mark.asyncio
    async def test_break_loop_exits_loop(self, make_interpreter, mock_bot, make_event):
        """break_loop 节点在 loop 中执行 → 立即跳出，执行 done。

        body 链：send_message（计数）→ break_loop（在第 2 次迭代时触发）
        """
        iter_count = [0]

        async def count_send(bot, event, text=''):
            if text == 'body_iter':
                iter_count[0] += 1
            await bot.send(event, str(text))
            return {"success": True, "error": ""}

        # body 中串联：send_message → break_loop（break_loop 总是立即触发）
        # 所以每次迭代只会执行到 break_loop 就跳出
        graph = {
            'nodes': [
                make_trigger_node(),
                {
                    'id': 'loop1',
                    'type': 'logic',
                    'data': {
                        'nodeKind': 'loop',
                        'config': {'mode': 'times', 'count': 10},
                        'inputs': [],
                        'outputs': [
                            {'id': 'body', 'kind': 'control'},
                            {'id': 'done', 'kind': 'control'},
                        ],
                    },
                },
                make_send_node('body_send', 'body_iter'),
                make_break_loop_node('brk1'),
                make_send_node('done', 'done_ok'),
            ],
            'edges': [
                make_edge('trig', 'loop1'),
                {'source': 'loop1', 'sourcePort': 'body', 'target': 'body_send', 'targetPort': 'in'},
                {'source': 'body_send', 'sourcePort': 'next', 'target': 'brk1', 'targetPort': 'in'},
                {'source': 'loop1', 'sourcePort': 'done', 'target': 'done', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': count_send,
            'flow_control': mock_flow_control,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # 第一次迭代：body_send 执行 → break_loop 触发 → 跳出循环
        # 所以 body_send 只执行 1 次（不是 10 次）
        assert iter_count[0] == 1
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'done_ok' in sent_texts


# =========================================================================
# return_chain 测试
# =========================================================================
class TestReturnChain:
    @pytest.mark.asyncio
    async def test_return_chain_stops_execution(self, make_interpreter, mock_bot, make_event):
        """return_chain 应立即结束链，后续节点不执行。"""
        call_count = [0]

        async def track_send(bot, event, text=''):
            call_count[0] += 1
            if text == 'after_return':
                # 不应执行到此处
                raise AssertionError("return_chain 后的节点不应被执行")
            await bot.send(event, str(text))
            return {"success": True, "error": ""}

        graph = {
            'nodes': [
                make_trigger_node(),
                make_return_chain_node('rc1', value='final_value'),
                make_send_node('after_return', 'after_return'),
            ],
            'edges': [
                make_edge('trig', 'rc1'),
                {'source': 'rc1', 'sourcePort': 'out', 'target': 'after_return', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': track_send,
            'flow_control': AsyncMock(return_value={"_return": True, "result": "final_value"}),
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # after_return 不应被调用
        assert call_count[0] == 0


# =========================================================================
# error_op 测试（原 assert_node，已合并 throw/assert 二合一）
# =========================================================================
class TestErrorOp:
    @pytest.mark.asyncio
    async def test_assert_passes(self, make_interpreter, mock_bot, make_event):
        """断言条件为 True → 流程继续。"""
        graph = {
            'nodes': [
                make_trigger_node(),
                make_error_op_node('as1', mode='assert', condition=True, message='不应失败'),
                make_send_node('after', 'after_assert'),
            ],
            'edges': [
                make_edge('trig', 'as1'),
                {'source': 'as1', 'sourcePort': 'out', 'target': 'after', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': mock_send_message,
            'error_op': mock_error_op,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'after_assert' in sent_texts

    @pytest.mark.asyncio
    async def test_assert_fails_interrupts(self, make_interpreter, mock_bot, make_event):
        """断言条件为 False → 流程中断，后续节点不执行。"""
        call_count = [0]

        async def track_send(bot, event, text=''):
            call_count[0] += 1
            if text == 'after_assert':
                raise AssertionError("断言失败后不应执行后续节点")
            await bot.send(event, str(text))
            return {"success": True, "error": ""}

        graph = {
            'nodes': [
                make_trigger_node(),
                make_error_op_node('as1', mode='assert', condition=False, message='校验失败'),
                make_send_node('after', 'after_assert'),
            ],
            'edges': [
                make_edge('trig', 'as1'),
                {'source': 'as1', 'sourcePort': 'out', 'target': 'after', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': track_send,
            'error_op': mock_error_op,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # after_assert 不应被调用
        assert call_count[0] == 0


# =========================================================================
# 导入真实 handlers 用于集成测试
# =========================================================================
from qqbat_nodes.builtin.set_variable import set_variable as real_set_variable
from qqbat_nodes.builtin.expression_eval import expression_eval as real_expression_eval


# =========================================================================
# 辅助 builder（集成测试专用）
# =========================================================================
def make_set_variable_node(node_id, var_name, value):
    return {
        'id': node_id,
        'type': 'action',
        'data': {
            'nodeKind': 'set_variable',
            'config': {'var_name': var_name, 'value': value},
            'inputs': [
                {'id': 'value', 'kind': 'data', 'dataType': 'any'},
                {'id': 'var_name', 'kind': 'data', 'dataType': 'string'},
            ],
            'outputs': [
                {'id': 'result', 'kind': 'data', 'dataType': 'any'},
                {'id': 'var_name', 'kind': 'data', 'dataType': 'string'},
            ],
        },
    }


def make_expression_eval_node(node_id, expression, variables_json=''):
    return {
        'id': node_id,
        'type': 'action',
        'data': {
            'nodeKind': 'expression_eval',
            'config': {'expression': expression, 'variables_json': variables_json},
            'inputs': [
                {'id': 'expression', 'kind': 'data', 'dataType': 'string'},
                {'id': 'variables_json', 'kind': 'data', 'dataType': 'object'},
            ],
            'outputs': [
                {'id': 'result', 'kind': 'data', 'dataType': 'any'},
                {'id': 'error', 'kind': 'data', 'dataType': 'string'},
            ],
        },
    }


def make_if_branch_node(node_id, expression):
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'if_branch',
            'config': {'expression': expression},
            'inputs': [{'id': 'value', 'kind': 'data'}],
            'outputs': [
                {'id': 'true', 'kind': 'control'},
                {'id': 'false', 'kind': 'control'},
            ],
        },
    }


# =========================================================================
# P1-1: set_variable + if_branch/expression_eval 集成测试
# 验证 collect_global_vars 辅助方法的注入路径
# =========================================================================
class TestGlobalVarInjection:
    """集成测试：set_variable 设置的全局变量应在 if_branch / expression_eval 中可见。

    验证 collect_global_vars(exclude=...) 重构后行为等价。
    """

    @pytest.mark.asyncio
    async def test_set_variable_visible_in_if_branch(
        self, make_interpreter, mock_bot, make_event
    ):
        """set_variable(count=10) → if_branch(expression="count > 5") 应走 true 分支。

        验证 _exec_if_branch 中的 collect_global_vars(exclude={'value'}) 注入路径。
        """
        graph = {
            'nodes': [
                make_trigger_node(),
                make_set_variable_node('sv1', 'count', 10),
                make_if_branch_node('if1', 'count > 5'),
                make_send_node('yes', 'count_gt_5'),
                make_send_node('no', 'count_le_5'),
            ],
            'edges': [
                make_edge('trig', 'sv1'),
                make_edge('sv1', 'if1'),
                {'source': 'if1', 'sourcePort': 'true', 'target': 'yes', 'targetPort': 'in'},
                {'source': 'if1', 'sourcePort': 'false', 'target': 'no', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'set_variable': real_set_variable,
            'send_message': mock_send_message,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'count_gt_5' in sent_texts, f"应走 true 分支，实际发送: {sent_texts}"
        assert 'count_le_5' not in sent_texts

    @pytest.mark.asyncio
    async def test_set_variable_visible_in_expression_eval(
        self, make_interpreter, mock_bot, make_event
    ):
        """set_variable(x=5) → expression_eval("x * 2") → result=10 → send_message。

        验证 _resolve_input_kwargs 中的 collect_global_vars() 注入路径
        （variables_json 为空时直接用全局变量填充）。
        """
        graph = {
            'nodes': [
                make_trigger_node(),
                make_set_variable_node('sv1', 'x', 5),
                make_expression_eval_node('ee1', expression='x * 2', variables_json=''),
                make_send_node('result_send', 'placeholder'),
            ],
            'edges': [
                make_edge('trig', 'sv1'),
                make_edge('sv1', 'ee1'),
                # expression_eval:result → send_message:text
                make_edge('ee1', 'result_send', source_port='result', target_port='text'),
            ],
        }
        interp = make_interpreter(graph, handlers={
            'set_variable': real_set_variable,
            'expression_eval': real_expression_eval,
            'send_message': mock_send_message,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        # x=5 → x*2=10，send_message 应收到 10
        assert any('10' in str(t) for t in sent_texts), (
            f"expression_eval 应计算出 x*2=10，实际发送: {sent_texts}"
        )

    @pytest.mark.asyncio
    async def test_set_variable_merge_with_user_variables_json(
        self, make_interpreter, mock_bot, make_event
    ):
        """set_variable(x=5) + variables_json='{"x": 100, "y": 7}' → expression_eval("x + y")。

        验证 _resolve_input_kwargs 中 collect_global_vars() 与用户显式 variables_json 合并：
        用户显式传的优先（x=100），全局变量补充未覆盖的（y 不在 global_vars，用 variables_json 的 7）。
        结果应为 100 + 7 = 107。
        """
        graph = {
            'nodes': [
                make_trigger_node(),
                make_set_variable_node('sv1', 'x', 5),
                make_expression_eval_node(
                    'ee1', expression='x + y', variables_json='{"x": 100, "y": 7}'
                ),
                make_send_node('result_send', 'placeholder'),
            ],
            'edges': [
                make_edge('trig', 'sv1'),
                make_edge('sv1', 'ee1'),
                make_edge('ee1', 'result_send', source_port='result', target_port='text'),
            ],
        }
        interp = make_interpreter(graph, handlers={
            'set_variable': real_set_variable,
            'expression_eval': real_expression_eval,
            'send_message': mock_send_message,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        # 用户 variables_json 优先：x=100, y=7 → x+y=107
        assert any('107' in str(t) for t in sent_texts), (
            f"用户 variables_json 应优先，x=100+y=7=107，实际发送: {sent_texts}"
        )


# =========================================================================
# P1-2: loop_while + break_loop 集成测试
# 验证 break_loop 信号在 loop_while 中的传播路径
# =========================================================================
class TestBreakLoopWhile:
    """集成测试：break_loop 节点在 loop_while 中应立即跳出循环。"""

    @pytest.mark.asyncio
    async def test_break_loop_exits_loop_while(
        self, make_interpreter, mock_bot, make_event
    ):
        """loop_while(expression="True") + body 中 break_loop → body 仅执行 1 次后走 done。

        验证 _exec_loop_while 中的 __break_loop__ 信号检测路径
        （与 _exec_loop 的检测路径独立，需单独覆盖）。
        """
        iter_count = [0]

        async def count_send(bot, event, text=''):
            if text == 'body_iter':
                iter_count[0] += 1
            await bot.send(event, str(text))
            return {"success": True, "error": ""}

        graph = {
            'nodes': [
                make_trigger_node(),
                make_loop_while_node('lw1', expression='True', max_iterations=10),
                make_send_node('body_send', 'body_iter'),
                make_break_loop_node('brk1'),
                make_send_node('done', 'done_ok'),
            ],
            'edges': [
                make_edge('trig', 'lw1'),
                {'source': 'lw1', 'sourcePort': 'body', 'target': 'body_send', 'targetPort': 'in'},
                {'source': 'body_send', 'sourcePort': 'next', 'target': 'brk1', 'targetPort': 'in'},
                {'source': 'lw1', 'sourcePort': 'done', 'target': 'done', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': count_send,
            'flow_control': mock_flow_control,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # 第一次迭代：body_send 执行 → break_loop 触发 → 跳出循环
        assert iter_count[0] == 1, (
            f"break_loop 应在第一次迭代即跳出，body 应只执行 1 次，实际: {iter_count[0]}"
        )
        sent_texts = [call.args[1] for call in mock_bot.send.call_args_list]
        assert 'done_ok' in sent_texts
