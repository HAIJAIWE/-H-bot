"""on_message 触发器节点单元测试 — 统一消息触发器（4 种 match 模式）。

被测源码：qqbat_nodes/runtime/interpreter.py 的 match_trigger()，
依据 trigger_node.data.nodeKind == 'on_message' 分支判定。
合并了原 on_message / on_at_me / on_command 三个节点的逻辑，通过 config.match 切换：
- match='any'：收到任意消息即触发（原 on_message）
- match='at_me'：被@机器人时触发（原 on_at_me）
- match='command'：匹配指令前缀+指令名（原 on_command）
- match='keyword'：消息包含 keywords 列表中任一关键词即触发

message_type 过滤与 match 正交，可叠加（any/both 通配，否则要求严格相等）。
返回 dict 含 event / raw_message / args 三个键；匹配失败返回 None。
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.runtime.interpreter import match_trigger


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_on_message_trigger(match='any', message_type='any', command='',
                            prefix='/', keywords=None):
    """构造一个 on_message 触发器节点 dict。"""
    config = {'match': match, 'message_type': message_type}
    if command:
        config['command'] = command
    if prefix != '/':
        config['prefix'] = prefix
    if keywords is not None:
        config['keywords'] = keywords
    return {
        'id': 'trig_msg',
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_message',
            'config': config,
            'inputs': [],
            'outputs': [],
        },
    }


def make_event(message='hello', message_type='private', is_tome=None):
    """构造模拟事件。

    Args:
        message: get_message() 返回值。
        message_type: 事件消息类型。
        is_tome: None 表示事件无 is_tome 方法；否则该方法返回该值。
    """
    ev = MagicMock()
    ev.message_type = message_type
    ev.get_message = MagicMock(return_value=message)
    if is_tome is None:
        del ev.is_tome
    else:
        ev.is_tome = MagicMock(return_value=is_tome)
    return ev


# =============================================================================
# match='any'：任意消息触发
# =============================================================================
class TestMatchAny:
    """验证 match='any' 时匹配任意消息。"""

    def test_any_matches_private(self):
        """any 模式匹配私聊消息。"""
        trig = make_on_message_trigger(match='any')
        ev = make_event(message='hi', message_type='private')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['event'] is ev
        assert result['raw_message'] == 'hi'
        assert result['args'] == []

    def test_any_matches_group(self):
        """any 模式匹配群聊消息。"""
        trig = make_on_message_trigger(match='any')
        ev = make_event(message='group msg', message_type='group')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_any_matches_empty_message(self):
        """any 模式匹配空消息字符串。"""
        trig = make_on_message_trigger(match='any')
        ev = make_event(message='', message_type='private')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['raw_message'] == ''

    def test_default_match_is_any(self):
        """config 中无 match 字段时默认 'any'。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_message',
                'config': {'message_type': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_event(message_type='private')
        result = match_trigger(trig, ev)
        assert result is not None


# =============================================================================
# match='at_me'：被@机器人时触发（原 on_at_me 逻辑）
# =============================================================================
class TestMatchAtMe:
    """验证 match='at_me' 的匹配逻辑。"""

    def test_is_tome_true_matches(self):
        """is_tome() 返回 True → 匹配。"""
        trig = make_on_message_trigger(match='at_me')
        ev = make_event(is_tome=True, message='hi')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == []

    def test_is_tome_false_no_match(self):
        """is_tome() 返回 False → 不匹配（不回退 CQ 检测）。"""
        trig = make_on_message_trigger(match='at_me')
        ev = make_event(is_tome=False, message='[CQ:at,qq=1] hi')
        result = match_trigger(trig, ev)
        assert result is None

    def test_no_is_tome_with_cq_matches(self):
        """事件无 is_tome 方法但消息含 '[CQ:at,' → 匹配。"""
        trig = make_on_message_trigger(match='at_me')
        ev = make_event(is_tome=None, message='[CQ:at,qq=99999] 在吗')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_no_is_tome_without_cq_no_match(self):
        """事件无 is_tome 方法且消息不含 '[CQ:at,' → 不匹配。"""
        trig = make_on_message_trigger(match='at_me')
        ev = make_event(is_tome=None, message='机器人你好')
        result = match_trigger(trig, ev)
        assert result is None

    def test_cq_partial_does_not_match(self):
        """'[CQ:at' 缺少逗号不匹配（必须 '[CQ:at,'）。"""
        trig = make_on_message_trigger(match='at_me')
        ev = make_event(is_tome=None, message='[CQ:at] 不含逗号')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# match='command'：匹配指令前缀+指令名（原 on_command 逻辑）
# =============================================================================
class TestMatchCommand:
    """验证 match='command' 的指令匹配逻辑。"""

    def test_exact_command_matches(self):
        """消息恰好等于 '/hello' → 匹配，无参数。"""
        trig = make_on_message_trigger(match='command', command='hello', prefix='/')
        ev = make_event(message='/hello')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == []

    def test_command_with_args(self):
        """'/hello world' → 匹配，参数 ['world']。"""
        trig = make_on_message_trigger(match='command', command='hello', prefix='/')
        ev = make_event(message='/hello world')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['world']

    def test_command_with_quoted_arg(self):
        """'/hello "multi word"' → shlex 保留引号内完整参数。"""
        trig = make_on_message_trigger(match='command', command='hello', prefix='/')
        ev = make_event(message='/hello "multi word"')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['multi word']

    def test_custom_prefix(self):
        """自定义 prefix='.'，匹配 '.cmd arg'。"""
        trig = make_on_message_trigger(match='command', command='cmd', prefix='.')
        ev = make_event(message='.cmd arg1')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['arg1']

    def test_no_prefix_compat(self):
        """无前缀兼容模式：消息以 'hello ' 开头 → 匹配。"""
        trig = make_on_message_trigger(match='command', command='hello', prefix='/')
        ev = make_event(message='hello world')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['world']

    def test_empty_command_no_match(self):
        """command 为空 → 不匹配。"""
        trig = make_on_message_trigger(match='command', command='', prefix='/')
        ev = make_event(message='/hello')
        result = match_trigger(trig, ev)
        assert result is None

    def test_command_followed_by_letter_no_match(self):
        """'/helloX' 不匹配 command='hello'（命令后需空格/制表符）。"""
        trig = make_on_message_trigger(match='command', command='hello', prefix='/')
        ev = make_event(message='/helloX')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# match='keyword'：消息包含任一关键词即触发
# =============================================================================
class TestMatchKeyword:
    """验证 match='keyword' 的关键词匹配逻辑。"""

    def test_keyword_in_message_matches(self):
        """消息包含关键词 → 匹配。"""
        trig = make_on_message_trigger(match='keyword', keywords=['你好', 'hello'])
        ev = make_event(message='你好啊')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == []

    def test_keyword_not_in_message_no_match(self):
        """消息不含任何关键词 → 不匹配。"""
        trig = make_on_message_trigger(match='keyword', keywords=['你好', 'hello'])
        ev = make_event(message='今天天气不错')
        result = match_trigger(trig, ev)
        assert result is None

    def test_json_string_keywords_parsed(self):
        """JSON 字符串 keywords 被解析为 list。"""
        trig = make_on_message_trigger(match='keyword', keywords='["签到", "sign"]')
        ev = make_event(message='我要签到')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_empty_keywords_no_match(self):
        """空 keywords 列表 → 不匹配。"""
        trig = make_on_message_trigger(match='keyword', keywords=[])
        ev = make_event(message='任意消息')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# message_type 过滤（与 match 正交）
# =============================================================================
class TestMessageTypeFilter:
    """验证 message_type 过滤与 match 模式正交叠加。"""

    def test_private_filter_matches_private(self):
        """message_type='private' 匹配私聊事件。"""
        trig = make_on_message_trigger(match='any', message_type='private')
        ev = make_event(message_type='private')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_private_filter_rejects_group(self):
        """message_type='private' 不匹配群聊事件。"""
        trig = make_on_message_trigger(match='any', message_type='private')
        ev = make_event(message_type='group')
        result = match_trigger(trig, ev)
        assert result is None

    def test_both_matches_group(self):
        """message_type='both' 匹配群聊事件。"""
        trig = make_on_message_trigger(match='any', message_type='both')
        ev = make_event(message_type='group')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_message_type_with_command_match(self):
        """message_type 过滤与 command 模式叠加。"""
        trig = make_on_message_trigger(
            match='command', message_type='group', command='hello', prefix='/',
        )
        # 群聊 + 正确指令 → 匹配
        ev_group = make_event(message='/hello', message_type='group')
        assert match_trigger(trig, ev_group) is not None
        # 私聊 + 正确指令 → 不匹配（message_type 过滤拦截）
        ev_private = make_event(message='/hello', message_type='private')
        assert match_trigger(trig, ev_private) is None


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    def test_any_return_fields(self):
        """match='any' 返回 {event, raw_message, args, matched, groups} 五个键。"""
        trig = make_on_message_trigger(match='any')
        ev = make_event(message='payload', message_type='private')
        result = match_trigger(trig, ev)
        assert set(result.keys()) == {'event', 'raw_message', 'args', 'matched', 'groups'}

    def test_command_return_fields(self):
        """match='command' 返回 {event, raw_message, args, matched, groups} 五个键。"""
        trig = make_on_message_trigger(match='command', command='hello', prefix='/')
        ev = make_event(message='/hello arg')
        result = match_trigger(trig, ev)
        assert set(result.keys()) == {'event', 'raw_message', 'args', 'matched', 'groups'}

    def test_args_is_list(self):
        """args 字段始终为 list 类型。"""
        trig = make_on_message_trigger(match='any')
        ev = make_event(message_type='private')
        result = match_trigger(trig, ev)
        assert isinstance(result['args'], list)

    def test_event_is_same_object(self):
        """event 字段是传入的同一事件对象。"""
        trig = make_on_message_trigger(match='any')
        ev = make_event(message_type='private')
        result = match_trigger(trig, ev)
        assert result['event'] is ev


# =============================================================================
# 节点结构契约
# =============================================================================
class TestNodeContract:
    """验证 on_message 触发器节点结构契约。"""

    def test_other_node_kind_returns_none(self):
        """nodeKind 不是 on_message 时返回 None。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'unknown_kind',
                'config': {'match': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_event(message_type='private')
        result = match_trigger(trig, ev)
        assert result is None
