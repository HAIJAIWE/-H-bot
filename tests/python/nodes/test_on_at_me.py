"""on_at_me 触发器节点单元测试。

被测源码：qqbat_nodes/builtin/on_at_me.py（占位文件，仅保留模块结构）。
实际触发匹配逻辑在 qqbat_nodes/runtime/interpreter.py 的 match_trigger() 中，
依据 trigger_node.data.nodeKind == 'on_at_me' 分支判定：
- 优先调用 event.is_tome()，返回 True 即匹配
- is_tome 不存在或不可调用时，回退检查消息文本是否包含 '[CQ:at,'
- 匹配成功返回 {'event': event}，否则返回 None

本测试覆盖：
- is_tome() 返回 True / False
- is_tome 不存在时回退到 CQ 码检测
- is_tome 不可调用时回退
- is_tome 抛异常时回退
- CQ 码检测命中（含 / 不含 [CQ:at,）
- get_message 抛异常的兜底
- 返回结构完整性（仅含 event 字段）
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.runtime.interpreter import match_trigger


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_on_at_me_trigger(node_id='trig_at'):
    """构造一个 on_at_me 触发器节点 dict（catalog defaultConfig 为空 dict）。"""
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_at_me',
            'config': {},
            'inputs': [],
            'outputs': [],
        },
    }


def make_at_event(is_tome=None, message='hello'):
    """构造模拟事件。

    Args:
        is_tome: None 表示事件无 is_tome 方法；否则该方法返回该值。
        message: get_message() 返回值。
    """
    ev = MagicMock()
    ev.get_message = MagicMock(return_value=message)
    if is_tome is None:
        # 删除 is_tome 属性，模拟事件对象没有此方法
        del ev.is_tome
    else:
        ev.is_tome = MagicMock(return_value=is_tome)
    return ev


# =============================================================================
# is_tome 返回 True
# =============================================================================
class TestIsTomeTrue:
    """验证 is_tome() 返回 True 时触发匹配。"""

    def test_is_tome_true_matches(self):
        """is_tome() 返回 True → 触发器匹配。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=True)
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['event'] is ev

    def test_is_tome_true_ignores_message_content(self):
        """is_tome() 返回 True 时不再检查消息内容。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=True, message='任意内容不含 CQ 码')
        result = match_trigger(trig, ev)
        assert result is not None


# =============================================================================
# is_tome 返回 False
# =============================================================================
class TestIsTomeFalse:
    """验证 is_tome() 返回 False 时不匹配（不回退 CQ 码检测）。

    源码逻辑：is_tome 存在且可调用时，仅依据 is_tome() 返回值判断；
    is_tome()=False → 直接返回 None，不会进入 else 分支检查 CQ 码。
    """

    def test_is_tome_false_no_cq_returns_none(self):
        """is_tome()=False 且消息无 [CQ:at, → 不匹配。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=False, message='你好机器人')
        result = match_trigger(trig, ev)
        assert result is None

    def test_is_tome_false_with_cq_still_returns_none(self):
        """is_tome()=False 时即使消息含 '[CQ:at,' 也不匹配（不回退 CQ 检测）。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=False, message='[CQ:at,qq=12345] 你好')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# is_tome 不存在时回退 CQ 码检测
# =============================================================================
class TestIsTomeMissing:
    """验证事件无 is_tome 方法时回退到 CQ 码检测。"""

    def test_no_is_tome_with_cq_matches(self):
        """事件无 is_tome 方法但消息含 '[CQ:at,' → 匹配。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=None, message='[CQ:at,qq=99999] 在吗')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_no_is_tome_without_cq_returns_none(self):
        """事件无 is_tome 方法且消息不含 '[CQ:at,' → 不匹配。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=None, message='机器人你好')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# is_tome 不可调用 / 抛异常
# =============================================================================
class TestIsTomeException:
    """验证 is_tome 不可调用或抛异常时的行为。"""

    def test_is_tome_not_callable_falls_back(self):
        """is_tome 属性存在但不是可调用对象 → 回退 CQ 码检测。"""
        trig = make_on_at_me_trigger()
        ev = MagicMock()
        ev.is_tome = 'not a callable'  # 不可调用
        ev.get_message = MagicMock(return_value='[CQ:at,qq=1] 嗨')
        # hasattr + callable 检查：is_tome 不是 callable → 进入 else 分支检查 CQ 码
        result = match_trigger(trig, ev)
        assert result is not None

    def test_is_tome_raises_returns_none(self):
        """is_tome() 抛异常时外层 try/except 捕获，返回 None（不回退 CQ 检测）。"""
        trig = make_on_at_me_trigger()
        ev = MagicMock()
        ev.is_tome = MagicMock(side_effect=RuntimeError('not available'))
        ev.get_message = MagicMock(return_value='[CQ:at,qq=2] 抛异常也匹配')
        # is_tome 抛异常被外层 try/except 捕获 → 直接 return None
        result = match_trigger(trig, ev)
        assert result is None

    def test_is_tome_raises_and_no_cq_returns_none(self):
        """is_tome() 抛异常且消息无 CQ 码 → 不匹配。"""
        trig = make_on_at_me_trigger()
        ev = MagicMock()
        ev.is_tome = MagicMock(side_effect=RuntimeError('err'))
        ev.get_message = MagicMock(return_value='没有 CQ 码')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# CQ 码边界
# =============================================================================
class TestCQCodeBoundary:
    """验证 CQ 码检测的边界条件。"""

    def test_cq_at_at_start_matches(self):
        """'[CQ:at,' 在消息开头 → 匹配。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=None, message='[CQ:at,qq=1] 你好')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_cq_at_in_middle_matches(self):
        """'[CQ:at,' 在消息中间 → 匹配。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=None, message='前缀 [CQ:at,qq=1] 后缀')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_cq_at_partial_does_not_match(self):
        """'[CQ:at' 缺少逗号不匹配（必须 '[CQ:at,'）。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=None, message='[CQ:at] 不含逗号')
        result = match_trigger(trig, ev)
        assert result is None

    def test_cq_at_uppercase_does_not_match(self):
        """'[cq:at,' 小写不匹配（区分大小写）。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=None, message='[cq:at,qq=1] 小写')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# get_message 异常
# =============================================================================
class TestGetMessageException:
    """验证 is_tome()=False 时 get_message 抛异常的兜底。"""

    def test_get_message_raises_returns_none(self):
        """is_tome()=False 且 get_message 抛异常 → 不匹配（兜底 None）。"""
        trig = make_on_at_me_trigger()
        ev = MagicMock()
        ev.is_tome = MagicMock(return_value=False)
        ev.get_message = MagicMock(side_effect=RuntimeError('msg err'))
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 返回结构
# =============================================================================
class TestReturnStructure:
    """验证触发器返回 dict 字段完整性。"""

    def test_return_has_only_event_field(self):
        """返回 dict 仅含 event 字段。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=True)
        result = match_trigger(trig, ev)
        assert set(result.keys()) == {'event'}

    def test_event_field_is_same_object(self):
        """event 字段是传入的同一事件对象。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=True)
        result = match_trigger(trig, ev)
        assert result['event'] is ev


# =============================================================================
# 节点结构契约
# =============================================================================
class TestNodeContract:
    """验证 on_at_me 触发器节点结构与 catalog 默认配置契约。"""

    def test_empty_config_supported(self):
        """catalog defaultConfig 为 {} → 触发器仍能正常工作。"""
        trig = make_on_at_me_trigger()
        ev = make_at_event(is_tome=True)
        result = match_trigger(trig, ev)
        assert result is not None

    def test_other_node_kind_returns_none(self):
        """nodeKind 不是 on_at_me 时返回 None。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'unknown_kind',  # 不是 on_at_me
                'config': {},
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_at_event(is_tome=True)
        result = match_trigger(trig, ev)
        assert result is None
