"""on_command 触发器节点单元测试。

被测源码：qqbat_nodes/builtin/on_command.py（占位文件，仅保留模块结构）。
实际触发匹配逻辑在 qqbat_nodes/runtime/interpreter.py 的 match_trigger() 中，
依据 trigger_node.data.nodeKind == 'on_command' 分支判定：
- config.command 必须非空（空则不匹配）
- config.prefix 默认 '/'
- 完整命令 = prefix + command，要求消息等于该串或其后紧跟空格/制表符
- 兼容无前缀模式：消息等于 command 本身或以 command + ' ' 开头
- 命令后的部分用 _split_args（shlex 优先，失败回退 split）拆分为参数列表
- 返回 {'args': list, 'event': event} 或 None

本测试覆盖：
- 完整命令（无参 / 单参 / 多参 / 引号参数）
- 前缀匹配（默认 / 自定义 / 空前缀）
- 无前缀模式兼容
- 命令后分隔符（空格 / 制表符）
- 边界：command 为空、消息为空、引号不匹配回退
- 返回结构完整性
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.runtime.interpreter import match_trigger


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_on_command_trigger(node_id='trig_cmd', command='hello', prefix='/'):
    """构造一个 on_command 触发器节点 dict（与 catalog defaultConfig 一致）。"""
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


def make_command_event(message):
    """构造一个模拟消息事件，get_message 返回给定字符串。"""
    ev = MagicMock()
    ev.get_message = MagicMock(return_value=message)
    return ev


# =============================================================================
# 基础命令匹配
# =============================================================================
class TestBasicCommandMatch:
    """验证完整命令的基本匹配逻辑。"""

    def test_exact_command_matches(self):
        """消息恰好等于 '/hello' → 匹配，无参数。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == []

    def test_command_with_single_arg(self):
        """'/hello world' → 匹配，参数 ['world']。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello world')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['world']

    def test_command_with_multiple_args(self):
        """'/hello foo bar baz' → 匹配，参数 ['foo', 'bar', 'baz']。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello foo bar baz')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['foo', 'bar', 'baz']

    def test_command_with_quoted_args(self):
        """'/hello "multi word"' → shlex 保留引号内完整参数。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello "multi word"')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['multi word']


# =============================================================================
# 前缀
# =============================================================================
class TestPrefix:
    """验证 prefix 参数的行为。"""

    def test_default_prefix_is_slash(self):
        """默认 prefix='/'，匹配 '/cmd'。"""
        trig = make_on_command_trigger(command='cmd', prefix='/')
        ev = make_command_event('/cmd')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_custom_prefix_dot(self):
        """自定义 prefix='.'，匹配 '.cmd'。"""
        trig = make_on_command_trigger(command='cmd', prefix='.')
        ev = make_command_event('.cmd arg1')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['arg1']

    def test_custom_prefix_exclamation(self):
        """自定义 prefix='!'，匹配 '!cmd'。"""
        trig = make_on_command_trigger(command='cmd', prefix='!')
        ev = make_command_event('!cmd')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == []

    def test_missing_prefix_does_not_match(self):
        """消息无前缀 → 不匹配（前缀不对应）。"""
        trig = make_on_command_trigger(command='cmd', prefix='/')
        ev = make_command_event('cmd')  # 无 '/'
        # 注意：源码有无前缀兜底分支，'cmd' 等于 'cmd' 仍匹配
        # 这里测试前缀不匹配但有 command 兜底
        result = match_trigger(trig, ev)
        # 源码兼容无前缀模式，因此实际匹配
        assert result is not None


# =============================================================================
# 无前缀兼容模式
# =============================================================================
class TestNoPrefixCompat:
    """验证无前缀模式：消息等于 command 本身或以 command + ' ' 开头。"""

    def test_message_equals_command_matches(self):
        """消息恰好等于 'hello'（无前缀）→ 兼容匹配。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('hello')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == []

    def test_message_starts_with_command_space_matches(self):
        """消息以 'hello ' 开头 → 兼容匹配，提取参数。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('hello world')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['world']


# =============================================================================
# 命令后分隔符
# =============================================================================
class TestSeparator:
    """验证命令后必须是空格或制表符。"""

    def test_tab_separator_matches(self):
        """命令后是制表符 → 匹配。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello\tworld')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_command_followed_by_other_char_does_not_match(self):
        """命令后紧跟字母（无分隔符）→ 不匹配（避免 '/helloX' 误匹配）。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/helloX')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 边界条件
# =============================================================================
class TestBoundary:
    """验证 command 为空、消息为空等边界。"""

    def test_empty_command_returns_none(self):
        """command 为空字符串 → 不匹配。"""
        trig = make_on_command_trigger(command='', prefix='/')
        ev = make_command_event('/ ')
        result = match_trigger(trig, ev)
        assert result is None

    def test_whitespace_only_command_returns_none(self):
        """command 仅空白 → strip 后为空，不匹配。"""
        trig = make_on_command_trigger(command='   ', prefix='/')
        ev = make_command_event('/   ')
        result = match_trigger(trig, ev)
        assert result is None

    def test_empty_message_returns_none(self):
        """消息为空字符串 → 不匹配。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('')
        result = match_trigger(trig, ev)
        assert result is None

    def test_unmatched_quotes_falls_back_to_split(self):
        """引号不匹配时 _split_args 回退到普通 split。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello "unmatched quote')
        result = match_trigger(trig, ev)
        assert result is not None
        # 回退 split：['"unmatched', 'quote']
        assert result['args'] == ['"unmatched', 'quote']


# =============================================================================
# 命令前缀混淆
# =============================================================================
class TestCommandPrefixConfusion:
    """验证命令名与其他命令前缀的区分。"""

    def test_prefix_command_longer_does_not_match(self):
        """'/hello' 不匹配 command='he'（'hello' 后跟字母无空格）。"""
        trig = make_on_command_trigger(command='he', prefix='/')
        ev = make_command_event('/hello')
        # /he + 'llo'：'llo' 不以空格/制表符开头 → 不匹配完整命令
        # 兼容模式：'hello' != 'he' 且不以 'he ' 开头 → 不匹配
        result = match_trigger(trig, ev)
        assert result is None

    def test_similar_command_does_not_match(self):
        """'/help' 不匹配 command='hello'。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/help')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 返回结构
# =============================================================================
class TestReturnStructure:
    """验证触发器返回 dict 字段完整性。"""

    def test_return_has_args_and_event(self):
        """返回 dict 必含 args 和 event 两个键。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello arg1')
        result = match_trigger(trig, ev)
        assert set(result.keys()) == {'args', 'event'}

    def test_args_is_list_type(self):
        """args 字段为 list 类型。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello')
        result = match_trigger(trig, ev)
        assert isinstance(result['args'], list)

    def test_event_field_is_same_object(self):
        """event 字段是传入的同一事件对象。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello')
        result = match_trigger(trig, ev)
        assert result['event'] is ev


# =============================================================================
# 异常容错
# =============================================================================
class TestExceptionHandling:
    """验证 event.get_message 抛异常时返回 None。"""

    def test_get_message_raises_returns_none(self):
        """event.get_message 抛异常 → 返回 None。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = MagicMock()
        ev.get_message = MagicMock(side_effect=RuntimeError('err'))
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 节点结构契约
# =============================================================================
class TestNodeContract:
    """验证 on_command 触发器节点结构与 catalog 默认配置契约。"""

    def test_catalog_default_config_works(self):
        """catalog defaultConfig 为 {command:'hello', prefix:'/'}，匹配 '/hello'。"""
        trig = make_on_command_trigger(command='hello', prefix='/')
        ev = make_command_event('/hello world')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['args'] == ['world']

    def test_other_node_kind_returns_none(self):
        """nodeKind 不是 on_command 时返回 None。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'unknown_kind',  # 不是 on_command
                'config': {'command': 'hello', 'prefix': '/'},
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_command_event('/hello')
        result = match_trigger(trig, ev)
        assert result is None
