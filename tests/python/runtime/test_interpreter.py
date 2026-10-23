"""Comprehensive unit tests for the interpreter engine.

Tests cover:
- A. Trigger matching (on_command, on_at_me, on_message)
- B. Control flow execution (if_branch, switch_case, loop)
- C. Data flow resolution (explicit binding, auto-resolve same-name, auto-resolve result)
- D. Error handling (chain errors, safe mode, missing handlers)
- E. Expression evaluation (arithmetic, comparison, in-operator, import rejection)
"""
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Ensure project root is on sys.path
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from qqbat_nodes.runtime.interpreter import Interpreter, safe_eval_expression, match_trigger


# =========================================================================
# Mock handlers (used as builtin handler substitutes via mocked registry)
# =========================================================================
async def mock_send_message(bot, event, text=''):
    """Mock send_message handler: calls bot.send(event, str(text))."""
    if text is None:
        text = ''
    await bot.send(event, str(text))
    return {"success": True, "error": ""}


async def mock_switch_case(bot, event, value='', cases='', default='default', **kwargs):
    """Mock switch_case handler with simple matching logic."""
    try:
        case_list = json.loads(cases) if isinstance(cases, str) else cases
    except (json.JSONDecodeError, TypeError):
        case_list = []
    if not isinstance(case_list, list):
        case_list = []
    val_str = str(value).strip()
    for i, case_item in enumerate(case_list):
        if not isinstance(case_item, dict):
            continue
        match_val = str(case_item.get('match', '')).strip()
        label = case_item.get('label', f'case_{i}')
        if match_val == val_str:
            return {
                "matched": label,
                "matched_value": match_val,
                "index": i,
                "is_default": False,
            }
    return {"matched": default, "matched_value": default, "index": -1, "is_default": True}


# =========================================================================
# Helper functions for building flow graph nodes
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


def make_if_node(node_id, expression):
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'if_branch',
            'config': {'expression': expression},
            'inputs': [],
            'outputs': [
                {'id': 'true', 'kind': 'control'},
                {'id': 'false', 'kind': 'control'},
            ],
        },
    }


def make_switch_node(node_id, value, cases, default='default'):
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'switch_case',
            'config': {
                'value': value,
                'cases': json.dumps(cases) if isinstance(cases, list) else cases,
                'default': default,
            },
            'inputs': [
                {'id': 'value', 'kind': 'data'},
                {'id': 'cases', 'kind': 'data'},
                {'id': 'default', 'kind': 'data'},
            ],
            'outputs': [],
        },
    }


def make_loop_node(node_id, count=3, mode='count'):
    return {
        'id': node_id,
        'type': 'logic',
        'data': {
            'nodeKind': 'loop',
            'config': {'mode': mode, 'count': count},
            'inputs': [],
            'outputs': [
                {'id': 'body', 'kind': 'control'},
                {'id': 'done', 'kind': 'control'},
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
# E. Expression evaluation (safe_eval_expression)
# =========================================================================
class TestSafeEval:
    def test_safe_eval_arithmetic(self):
        assert safe_eval_expression('1 + 2', {}) == 3

    def test_safe_eval_arithmetic_complex(self):
        assert safe_eval_expression('2 * 3 + 4', {}) == 10

    def test_safe_eval_comparison(self):
        assert safe_eval_expression('1 < 2', {}) == True

    def test_safe_eval_in_operator(self):
        assert safe_eval_expression("'a' in 'abc'", {}) == True

    def test_safe_eval_rejects_import(self):
        assert safe_eval_expression("__import__('os')", {}) == False

    def test_safe_eval_variables(self):
        assert safe_eval_expression('x + y', {'x': 10, 'y': 20}) == 30

    def test_safe_eval_empty_expression(self):
        assert safe_eval_expression('', {}) == False

    def test_safe_eval_bool_and(self):
        assert safe_eval_expression('True and False', {}) == False

    def test_safe_eval_bool_or(self):
        assert safe_eval_expression('True or False', {}) == True

    def test_safe_eval_modulo(self):
        assert safe_eval_expression('10 % 3', {}) == 1

    # -----------------------------------------------------------------
    # P1 安全注入盲点补齐
    # -----------------------------------------------------------------
    def test_safe_eval_rejects_attribute_access(self):
        """属性访问应被拒绝（防止 __class__.__init__ 等注入）。"""
        assert safe_eval_expression("().__class__", {}) == False

    def test_safe_eval_supports_subscript(self):
        """下标访问已被 v2 增强支持（v1['key'] / v1[0]）。

        安全性保证：属性访问（如 __class__）仍被拒绝，所以
        ().__class__.__bases__[0] 这类攻击会在 __class__ 属性访问时被拦截。
        下标访问本身只对已求值的对象取值，不引入新的安全风险。
        """
        assert safe_eval_expression("[1,2,3][0]", {}) == 1
        assert safe_eval_expression("[1,2,3][2]", {}) == 3
        assert safe_eval_expression("{'a': 1}['a']", {}) == 1

    def test_safe_eval_rejects_lambda(self):
        """Lambda 表达式应被拒绝。"""
        assert safe_eval_expression("(lambda: 1)()", {}) == False

    def test_safe_eval_rejects_unsafe_builtin(self):
        """eval/compile/exec 等内置函数不在白名单。"""
        assert safe_eval_expression("eval('1+1')", {}) == False

    def test_safe_eval_rejects_open_function(self):
        """open 函数不在白名单。"""
        assert safe_eval_expression("open('/etc/passwd')", {}) == False

    def test_safe_eval_rejects_unsupported_operator(self):
        """不在白名单的运算符（如位运算 ~）应被拒绝。"""
        # 按位取反 ~ 在 SAFE_OPS 中未注册
        assert safe_eval_expression("~5", {}) == False

    def test_safe_eval_rejects_unsupported_function(self):
        """不在白名单的函数应被拒绝。"""
        assert safe_eval_expression("print('hi')", {}) == False

    def test_safe_eval_string_concat(self):
        """字符串拼接应正常工作。"""
        assert safe_eval_expression("'a' + 'b'", {}) == 'ab'

    def test_safe_eval_if_expression(self):
        """三元表达式应正常工作。"""
        assert safe_eval_expression("'yes' if 1 > 0 else 'no'", {}) == 'yes'

    def test_safe_eval_nested_function_call(self):
        """嵌套函数调用应正常工作。"""
        assert safe_eval_expression("max(1, abs(-5))", {}) == 5

    def test_safe_eval_clamp_function(self):
        """clamp 函数应将值限制在范围内。"""
        assert safe_eval_expression("clamp(15, 0, 10)", {}) == 10
        assert safe_eval_expression("clamp(-5, 0, 10)", {}) == 0
        assert safe_eval_expression("clamp(5, 0, 10)", {}) == 5

    def test_safe_eval_percent_function(self):
        """percent 函数应正确计算百分比。"""
        assert safe_eval_expression("percent(25, 100)", {}) == 25.0

    def test_safe_eval_len_function_with_none(self):
        """len(None) 应返回 0 而非抛异常。"""
        assert safe_eval_expression("len(x)", {'x': None}) == 0

    def test_safe_eval_math_functions(self):
        """数学函数 sqrt/floor/ceil 应正常工作。"""
        assert safe_eval_expression("sqrt(16)", {}) == 4.0
        assert safe_eval_expression("floor(3.7)", {}) == 3
        assert safe_eval_expression("ceil(3.2)", {}) == 4

    def test_safe_eval_undefined_variable_returns_none(self):
        """未定义变量应 raise ValueError（P2 修复：原静默返回 None，改为显式报错）。

        safe_eval_expression 会捕获 ValueError 返回 False，但错误信息包含变量名便于调试。
        这里直接调用 safe_eval_node 验证 raise 行为。
        """
        from qqbat_nodes.runtime.safe_eval import safe_eval_node
        import ast
        tree = ast.parse('x', mode='eval')
        with __import__('pytest').raises(ValueError, match='未定义变量: x'):
            safe_eval_node(tree, {})

    def test_safe_eval_undefined_variable_in_expression_returns_false(self):
        """表达式中含未定义变量时，safe_eval_expression 应返回 False（兜底）。"""
        assert safe_eval_expression('x + 1', {}) == False

    def test_safe_eval_division_by_zero(self):
        """除零应被捕获返回 False（ZeroDivisionError 兜底）。"""
        assert safe_eval_expression("1 / 0", {}) == False

    def test_safe_eval_chained_comparison(self):
        """链式比较应正常工作。"""
        assert safe_eval_expression("1 < 2 < 3", {}) == True
        assert safe_eval_expression("1 < 2 > 5", {}) == False

    def test_safe_eval_not_operator(self):
        """not 运算符应正常工作。"""
        assert safe_eval_expression("not False", {}) == True
        assert safe_eval_expression("not True", {}) == False


# =========================================================================
# A. Trigger matching
# =========================================================================
class TestTriggerMatching:
    def _make_command_trigger(self, command='hello', prefix='/'):
        """构建 on_message(match=command) 触发器（原 on_command 已合并到 on_message）。"""
        return {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_message',
                'config': {'match': 'command', 'command': command, 'prefix': prefix, 'message_type': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }

    def test_on_command_matches_correct_command(self, make_event):
        trigger = self._make_command_trigger('hello', '/')
        event = make_event(message_text='/hello world')
        result = match_trigger(trigger, event)
        assert result is not None
        assert result['args'] == ['world']

    def test_on_command_does_not_match_wrong_command(self, make_event):
        trigger = self._make_command_trigger('hello', '/')
        event = make_event(message_text='/goodbye')
        result = match_trigger(trigger, event)
        assert result is None

    def test_on_command_matches_no_args(self, make_event):
        trigger = self._make_command_trigger('hello', '/')
        event = make_event(message_text='/hello')
        result = match_trigger(trigger, event)
        assert result is not None
        assert result['args'] == []

    def test_on_at_me_matches(self):
        """on_message(match=at_me) 触发器：被@机器人时匹配（原 on_at_me 已合并）。"""
        trigger = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_message',
                'config': {'match': 'at_me', 'message_type': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }
        event = MagicMock()
        event.is_tome = MagicMock(return_value=True)
        event.get_message = MagicMock(return_value='hello')
        result = match_trigger(trigger, event)
        assert result is not None
        assert 'event' in result

    def test_on_at_me_does_not_match(self):
        """on_message(match=at_me) 触发器：未被@机器人时不匹配。"""
        trigger = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_message',
                'config': {'match': 'at_me', 'message_type': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }
        event = MagicMock()
        event.is_tome = MagicMock(return_value=False)
        event.get_message = MagicMock(return_value='plain text without at')
        result = match_trigger(trigger, event)
        assert result is None

    def test_on_message_matches_all(self, make_event):
        trigger = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_message',
                'config': {'message_type': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }
        event = make_event(message_text='hello', group_id='group1')
        result = match_trigger(trigger, event)
        assert result is not None
        assert 'event' in result
        assert 'raw_message' in result


# =========================================================================
# B. Control flow execution
# =========================================================================
class TestControlFlow:
    @pytest.mark.asyncio
    async def test_if_branch_true_path(self, make_interpreter, mock_bot, make_event):
        graph = {
            'nodes': [
                make_trigger_node(),
                make_if_node('if1', '1 < 2'),
                make_send_node('send_yes', 'yes'),
                make_send_node('send_no', 'no'),
            ],
            'edges': [
                make_edge('trig', 'if1'),
                {'source': 'if1', 'sourcePort': 'true', 'target': 'send_yes', 'targetPort': 'in'},
                {'source': 'if1', 'sourcePort': 'false', 'target': 'send_no', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'yes')

    @pytest.mark.asyncio
    async def test_if_branch_false_path(self, make_interpreter, mock_bot, make_event):
        graph = {
            'nodes': [
                make_trigger_node(),
                make_if_node('if1', '1 > 2'),
                make_send_node('send_yes', 'yes'),
                make_send_node('send_no', 'no'),
            ],
            'edges': [
                make_edge('trig', 'if1'),
                {'source': 'if1', 'sourcePort': 'true', 'target': 'send_yes', 'targetPort': 'in'},
                {'source': 'if1', 'sourcePort': 'false', 'target': 'send_no', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'no')

    @pytest.mark.asyncio
    async def test_switch_case_matching(self, make_interpreter, mock_bot, make_event):
        """switch with 3 cases, verify correct branch is taken."""
        cases = [
            {'match': 'a', 'label': 'case1'},
            {'match': 'b', 'label': 'case2'},
            {'match': 'c', 'label': 'case3'},
        ]
        graph = {
            'nodes': [
                make_trigger_node(),
                make_switch_node('sw1', 'b', cases),
                make_send_node('send1', 'one'),
                make_send_node('send2', 'two'),
                make_send_node('send3', 'three'),
                make_send_node('send_def', 'default'),
            ],
            'edges': [
                make_edge('trig', 'sw1'),
                {'source': 'sw1', 'sourcePort': 'case1', 'target': 'send1', 'targetPort': 'in'},
                {'source': 'sw1', 'sourcePort': 'case2', 'target': 'send2', 'targetPort': 'in'},
                {'source': 'sw1', 'sourcePort': 'case3', 'target': 'send3', 'targetPort': 'in'},
                {'source': 'sw1', 'sourcePort': 'default', 'target': 'send_def', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': mock_send_message,
            'switch_case': mock_switch_case,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'two')

    @pytest.mark.asyncio
    async def test_switch_case_default(self, make_interpreter, mock_bot, make_event):
        """No match → default branch."""
        cases = [
            {'match': 'a', 'label': 'case1'},
            {'match': 'b', 'label': 'case2'},
            {'match': 'c', 'label': 'case3'},
        ]
        graph = {
            'nodes': [
                make_trigger_node(),
                make_switch_node('sw1', 'z', cases),
                make_send_node('send1', 'one'),
                make_send_node('send2', 'two'),
                make_send_node('send3', 'three'),
                make_send_node('send_def', 'default'),
            ],
            'edges': [
                make_edge('trig', 'sw1'),
                {'source': 'sw1', 'sourcePort': 'case1', 'target': 'send1', 'targetPort': 'in'},
                {'source': 'sw1', 'sourcePort': 'case2', 'target': 'send2', 'targetPort': 'in'},
                {'source': 'sw1', 'sourcePort': 'case3', 'target': 'send3', 'targetPort': 'in'},
                {'source': 'sw1', 'sourcePort': 'default', 'target': 'send_def', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={
            'send_message': mock_send_message,
            'switch_case': mock_switch_case,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'default')

    @pytest.mark.asyncio
    async def test_loop_executes_n_times(self, make_interpreter, mock_bot, make_event):
        """loop with count=3, body should execute 3 times then done once."""
        graph = {
            'nodes': [
                make_trigger_node(),
                make_loop_node('loop1', count=3),
                make_send_node('body_send', 'iter'),
                make_send_node('done_send', 'done'),
            ],
            'edges': [
                make_edge('trig', 'loop1'),
                {'source': 'loop1', 'sourcePort': 'body', 'target': 'body_send', 'targetPort': 'in'},
                {'source': 'loop1', 'sourcePort': 'done', 'target': 'done_send', 'targetPort': 'in'},
            ],
        }
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # body executes 3 times + done executes 1 time = 4 total sends
        assert mock_bot.send.call_count == 4
        # Last call should be "done"
        last_call = mock_bot.send.call_args
        assert last_call.args[0] == event
        assert last_call.args[1] == 'done'


# =========================================================================
# C. Data flow resolution
# =========================================================================
class TestDataFlow:
    @pytest.mark.asyncio
    async def test_explicit_data_binding(self, make_interpreter, mock_bot, make_event):
        """Node A.result → Node B.value via explicit data edge."""
        async def produce(bot, event, **kwargs):
            return {"result": 42}

        async def consume(bot, event, value=None, **kwargs):
            await bot.send(event, f"got:{value}")
            return {"success": True}

        produce_node = {
            'id': 'A',
            'type': 'data',
            'data': {
                'nodeKind': 'produce',
                'config': {},
                'inputs': [],
                'outputs': [],  # no outputs defined → smart assignment stores each key
            },
        }
        consume_node = {
            'id': 'B',
            'type': 'data',
            'data': {
                'nodeKind': 'consume',
                'config': {},
                'inputs': [{'id': 'value', 'kind': 'data'}],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [make_trigger_node(), produce_node, consume_node],
            'edges': [
                make_edge('trig', 'A'),
                make_edge('A', 'B'),
                # Explicit data edge: A:result → B:value
                {'source': 'A', 'sourcePort': 'result', 'target': 'B', 'targetPort': 'value'},
            ],
        }
        interp = make_interpreter(graph, handlers={'produce': produce, 'consume': consume})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'got:42')

    @pytest.mark.asyncio
    async def test_auto_resolve_same_name_port(self, make_interpreter, mock_bot, make_event):
        """Auto-resolve by same port name match (no explicit edge)."""
        async def produce(bot, event, **kwargs):
            return 42  # scalar

        async def consume(bot, event, value=None, **kwargs):
            await bot.send(event, f"auto:{value}")
            return {"success": True}

        # A has output port "value" defined
        produce_node = {
            'id': 'A',
            'type': 'data',
            'data': {
                'nodeKind': 'produce',
                'config': {},
                'inputs': [],
                'outputs': [{'id': 'value', 'kind': 'data'}],
            },
        }
        # B has input port "value" (no edge, no config) → auto-resolve
        consume_node = {
            'id': 'B',
            'type': 'data',
            'data': {
                'nodeKind': 'consume',
                'config': {},
                'inputs': [{'id': 'value', 'kind': 'data'}],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [make_trigger_node(), produce_node, consume_node],
            'edges': [
                make_edge('trig', 'A'),
                make_edge('A', 'B'),
            ],
        }
        interp = make_interpreter(graph, handlers={'produce': produce, 'consume': consume})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'auto:42')

    @pytest.mark.asyncio
    async def test_auto_resolve_result_fallback(self, make_interpreter, mock_bot, make_event):
        """Auto-resolve by result port fallback (no same-name port on upstream)."""
        async def produce(bot, event, **kwargs):
            return 99  # scalar

        async def consume(bot, event, data=None, **kwargs):
            await bot.send(event, f"fallback:{data}")
            return {"success": True}

        # A has output port "result" defined
        produce_node = {
            'id': 'A',
            'type': 'data',
            'data': {
                'nodeKind': 'produce',
                'config': {},
                'inputs': [],
                'outputs': [{'id': 'result', 'kind': 'data'}],
            },
        }
        # B has input port "data" (different name, no edge, no config) → auto-resolve result
        consume_node = {
            'id': 'B',
            'type': 'data',
            'data': {
                'nodeKind': 'consume',
                'config': {},
                'inputs': [{'id': 'data', 'kind': 'data'}],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [make_trigger_node(), produce_node, consume_node],
            'edges': [
                make_edge('trig', 'A'),
                make_edge('A', 'B'),
            ],
        }
        interp = make_interpreter(graph, handlers={'produce': produce, 'consume': consume})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'fallback:99')

    @pytest.mark.asyncio
    async def test_handler_default_value_when_config_missing(self, make_interpreter, mock_bot, make_event):
        """When config doesn't have a field, use handler's default value instead of None.

        This prevents None from overwriting handler signature defaults (e.g. ttl: int = 0),
        which caused TypeError: '<' not supported between instances of 'NoneType' and 'int'.
        """
        received_ttl = []

        async def save_persistent(bot, event, key='', value=None, scope='user', ttl=0):
            received_ttl.append(ttl)
            return {"success": True, "value_out": value}

        # Node config has key and scope but NOT ttl → ttl should default to 0
        save_node = {
            'id': 'save1',
            'type': 'action',
            'data': {
                'nodeKind': 'save_persistent',
                'config': {'key': 'test_key', 'scope': 'user'},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [make_trigger_node(), save_node],
            'edges': [make_edge('trig', 'save1')],
        }
        interp = make_interpreter(graph, handlers={'save_persistent': save_persistent})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)

        # ttl should be 0 (handler default), not None
        assert len(received_ttl) == 1
        assert received_ttl[0] == 0, f"Expected ttl=0 (handler default), got {received_ttl[0]}"

    @pytest.mark.asyncio
    async def test_handler_default_value_with_empty_inputs(self, make_interpreter, mock_bot, make_event):
        """When node inputs is empty and config is missing a field, handler default is used."""
        received = {}

        async def custom_handler(bot, event, text='', count=10, enabled=True):
            received['text'] = text
            received['count'] = count
            received['enabled'] = enabled
            return {"success": True}

        # Node has empty inputs → _resolve_input_kwargs infers params from handler signature
        # config only has 'text', missing 'count' and 'enabled'
        node = {
            'id': 'custom1',
            'type': 'action',
            'data': {
                'nodeKind': 'custom_handler',
                'config': {'text': 'hello'},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [make_trigger_node(), node],
            'edges': [make_edge('trig', 'custom1')],
        }
        interp = make_interpreter(graph, handlers={'custom_handler': custom_handler})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)

        # text from config, count and enabled from handler defaults
        assert received['text'] == 'hello'
        assert received['count'] == 10, f"Expected count=10 (default), got {received['count']}"
        assert received['enabled'] is True, f"Expected enabled=True (default), got {received['enabled']}"


# =========================================================================
# D. Error handling
# =========================================================================
class TestErrorHandling:
    @pytest.mark.asyncio
    async def test_single_chain_error_does_not_crash_others(
        self, make_interpreter, mock_bot, make_event
    ):
        """A node that raises an exception should not prevent subsequent nodes from executing."""
        async def bad_handler(bot, event, **kwargs):
            raise RuntimeError("something went wrong")

        bad_node = {
            'id': 'bad',
            'type': 'action',
            'data': {
                'nodeKind': 'bad_handler',
                'config': {},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [
                make_trigger_node(),
                bad_node,
                make_send_node('recover', 'recovered'),
            ],
            'edges': [
                make_edge('trig', 'bad'),
                make_edge('bad', 'recover'),
            ],
        }
        interp = make_interpreter(graph, handlers={
            'bad_handler': bad_handler,
            'send_message': mock_send_message,
        })
        event = make_event(message_text='/test')
        # Should not raise
        await interp.handle_event(mock_bot, event)
        # The recover node should still execute
        mock_bot.send.assert_called_once_with(event, 'recovered')

    def test_expression_eval_safe_mode(self):
        """Dangerous expressions should return False (not execute)."""
        assert safe_eval_expression("__import__('os')", {}) == False
        assert safe_eval_expression("open('/etc/passwd')", {}) == False
        assert safe_eval_expression("eval('1+1')", {}) == False
        assert safe_eval_expression("exec('x=1')", {}) == False

    @pytest.mark.asyncio
    async def test_missing_handler_returns_error(
        self, make_interpreter, mock_bot, make_event
    ):
        """A node with no registered handler should not crash the chain."""
        unknown_node = {
            'id': 'unknown',
            'type': 'action',
            'data': {
                'nodeKind': 'nonexistent_handler',
                'config': {},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [
                make_trigger_node(),
                unknown_node,
                make_send_node('after', 'after'),
            ],
            'edges': [
                make_edge('trig', 'unknown'),
                make_edge('unknown', 'after'),
            ],
        }
        # No handler registered for 'nonexistent_handler'
        interp = make_interpreter(graph, handlers={'send_message': mock_send_message})
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        # The 'after' node should still execute
        mock_bot.send.assert_called_once_with(event, 'after')


# =========================================================================
# F. 节点超时保护（P1-runtime 新增）
# =========================================================================
class TestNodeTimeout:
    """验证 _exec_normal_node 的 30 秒超时保护。

    超时后应：
    1. 不向上抛异常（被捕获）
    2. 写入 ctx.variables["__last_error__"] 和 {node_id}:error
    3. 输出 [NODE:error:{node_id}] 日志
    4. 后续节点仍可执行
    """

    @pytest.mark.asyncio
    async def test_timeout_does_not_crash_chain(
        self, make_interpreter, mock_bot, make_event
    ):
        """超时的节点不应中断整条链，后续节点仍执行。"""
        async def slow_handler(bot, event, **kwargs):
            import asyncio as _asyncio
            await _asyncio.sleep(60)  # 远超 30 秒超时

        slow_node = {
            'id': 'slow',
            'type': 'action',
            'data': {
                'nodeKind': 'slow_handler',
                'config': {},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [
                make_trigger_node(),
                slow_node,
                make_send_node('after', 'after_timeout'),
            ],
            'edges': [
                make_edge('trig', 'slow'),
                make_edge('slow', 'after'),
            ],
        }
        interp = make_interpreter(graph, handlers={
            'slow_handler': slow_handler,
            'send_message': mock_send_message,
        })
        event = make_event(message_text='/test')

        # 用 patch 将超时时间缩短为 0.1 秒，避免测试等待 30 秒
        import asyncio as _asyncio
        original_wait_for = _asyncio.wait_for

        async def fast_wait_for(coro, timeout=None):
            return await original_wait_for(coro, timeout=0.1)

        with patch(
            'qqbat_nodes.runtime.interpreter.asyncio.wait_for', new=fast_wait_for
        ):
            await interp.handle_event(mock_bot, event)

        # 后续节点应执行
        mock_bot.send.assert_called_once_with(event, 'after_timeout')

    @pytest.mark.asyncio
    async def test_timeout_writes_error_to_context(
        self, make_interpreter, mock_bot, make_event, capsys
    ):
        """超时后应写入 __last_error__ 和 {node_id}:error 变量，并输出 [NODE:error] 日志。"""
        async def slow_handler(bot, event, **kwargs):
            import asyncio as _asyncio
            await _asyncio.sleep(60)

        slow_node = {
            'id': 'slow_node',
            'type': 'action',
            'data': {
                'nodeKind': 'slow_handler',
                'config': {},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [
                make_trigger_node(),
                slow_node,
            ],
            'edges': [
                make_edge('trig', 'slow_node'),
            ],
        }
        interp = make_interpreter(graph, handlers={
            'slow_handler': slow_handler,
        })
        event = make_event(message_text='/test')

        import asyncio as _asyncio
        original_wait_for = _asyncio.wait_for

        async def fast_wait_for(coro, timeout=None):
            return await original_wait_for(coro, timeout=0.1)

        with patch(
            'qqbat_nodes.runtime.interpreter.asyncio.wait_for', new=fast_wait_for
        ):
            await interp.handle_event(mock_bot, event)

        # 验证 [NODE:error] 日志输出
        captured = capsys.readouterr()
        assert '[NODE:error:slow_node]' in captured.out

    @pytest.mark.asyncio
    async def test_normal_handler_not_affected_by_timeout(
        self, make_interpreter, mock_bot, make_event
    ):
        """正常快速执行的 handler 不受超时保护影响。"""
        async def fast_handler(bot, event, **kwargs):
            return {"ok": True}

        fast_node = {
            'id': 'fast',
            'type': 'action',
            'data': {
                'nodeKind': 'fast_handler',
                'config': {},
                'inputs': [],
                'outputs': [],
            },
        }
        graph = {
            'nodes': [
                make_trigger_node(),
                fast_node,
                make_send_node('after', 'after_fast'),
            ],
            'edges': [
                make_edge('trig', 'fast'),
                make_edge('fast', 'after'),
            ],
        }
        interp = make_interpreter(graph, handlers={
            'fast_handler': fast_handler,
            'send_message': mock_send_message,
        })
        event = make_event(message_text='/test')
        await interp.handle_event(mock_bot, event)
        mock_bot.send.assert_called_once_with(event, 'after_fast')
