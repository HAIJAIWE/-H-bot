"""on_notice 触发器节点单元测试。

被测源码：qqbat_nodes/builtin/on_notice.py（占位文件，仅保留模块结构）。
实际触发匹配逻辑在 qqbat_nodes/runtime/interpreter.py 的 match_trigger() 中，
依据 trigger_node.data.nodeKind == 'on_notice' 分支判定：
- config.notice_type 默认 'any'，匹配任意通知事件
- 否则要求 event.notice_type（或 event.sub_type 兜底）等于 notice_type
- 返回 {'event', 'user_id', 'group_id', 'operator_id', 'notice_type', 'sub_type'} 或 None

本测试覆盖：
- notice_type='any' 通配
- 4 种具体 notice_type（group_increase/group_decrease/group_recall/group_admin）
- 类型不匹配
- event 属性缺失兜底
- 返回结构完整性
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.runtime.interpreter import match_trigger


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_on_notice_trigger(node_id='trig_not', notice_type='any'):
    """构造一个 on_notice 触发器节点 dict。"""
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


def make_notice_event(
    notice_type='group_increase', sub_type='',
    user_id='100', group_id='grp1', operator_id='200',
):
    """构造一个模拟通知事件对象。"""
    ev = MagicMock()
    ev.notice_type = notice_type
    ev.sub_type = sub_type
    ev.user_id = user_id
    ev.group_id = group_id
    ev.operator_id = operator_id
    return ev


# =============================================================================
# notice_type='any' 通配
# =============================================================================
class TestAnyNoticeType:
    """验证 notice_type='any' 匹配任意通知。"""

    def test_any_matches_group_increase(self):
        """any 匹配入群通知。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(notice_type='group_increase')
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['notice_type'] == 'group_increase'

    def test_any_matches_group_decrease(self):
        """any 匹配退群通知。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(notice_type='group_decrease')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_any_matches_group_recall(self):
        """any 匹配撤回通知。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(notice_type='group_recall')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_any_matches_group_admin(self):
        """any 匹配管理员变更通知。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(notice_type='group_admin')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_any_matches_unknown_type(self):
        """any 匹配未知 notice_type（任意字符串）。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(notice_type='some_new_type')
        result = match_trigger(trig, ev)
        assert result is not None


# =============================================================================
# 精确匹配 notice_type
# =============================================================================
class TestExactNoticeType:
    """验证 notice_type 为具体值时严格匹配。"""

    def test_group_increase_matches(self):
        """notice_type='group_increase' 匹配入群通知。"""
        trig = make_on_notice_trigger(notice_type='group_increase')
        ev = make_notice_event(notice_type='group_increase')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_group_decrease_matches(self):
        """notice_type='group_decrease' 匹配退群通知。"""
        trig = make_on_notice_trigger(notice_type='group_decrease')
        ev = make_notice_event(notice_type='group_decrease')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_group_recall_matches(self):
        """notice_type='group_recall' 匹配撤回通知。"""
        trig = make_on_notice_trigger(notice_type='group_recall')
        ev = make_notice_event(notice_type='group_recall')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_group_admin_matches(self):
        """notice_type='group_admin' 匹配管理员变更通知。"""
        trig = make_on_notice_trigger(notice_type='group_admin')
        ev = make_notice_event(notice_type='group_admin')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_mismatched_type_returns_none(self):
        """notice_type='group_increase' 不匹配退群通知。"""
        trig = make_on_notice_trigger(notice_type='group_increase')
        ev = make_notice_event(notice_type='group_decrease')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 默认 notice_type
# =============================================================================
class TestDefaultNoticeType:
    """验证 config 中无 notice_type 时默认 'any'。"""

    def test_missing_notice_type_defaults_any(self):
        """config 中无 notice_type 字段时，默认 'any' 匹配任意通知。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_notice',
                'config': {},  # 无 notice_type
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_notice_event(notice_type='group_increase')
        result = match_trigger(trig, ev)
        assert result is not None


# =============================================================================
# sub_type 兜底
# =============================================================================
class TestSubTypeFallback:
    """验证 event.notice_type 为空时回退到 event.sub_type。"""

    def test_empty_notice_type_uses_sub_type(self):
        """event.notice_type='' 时用 event.sub_type 比较。"""
        trig = make_on_notice_trigger(notice_type='approve')
        ev = make_notice_event(notice_type='', sub_type='approve')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_both_empty_no_match(self):
        """event.notice_type 和 sub_type 都为空时不匹配具体 notice_type。"""
        trig = make_on_notice_trigger(notice_type='group_increase')
        ev = make_notice_event(notice_type='', sub_type='')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 返回结构
# =============================================================================
class TestReturnStructure:
    """验证触发器返回 dict 字段完整性。"""

    def test_return_has_all_required_fields(self):
        """返回 dict 必含 event/user_id/group_id/operator_id/notice_type/sub_type 六个键。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(
            notice_type='group_increase', sub_type='approve',
            user_id='100', group_id='grp1', operator_id='200',
        )
        result = match_trigger(trig, ev)
        assert set(result.keys()) == {
            'event', 'user_id', 'group_id', 'operator_id',
            'notice_type', 'sub_type',
        }

    def test_user_id_is_string(self):
        """user_id 字段转换为字符串。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(user_id='100')
        result = match_trigger(trig, ev)
        assert result['user_id'] == '100'
        assert isinstance(result['user_id'], str)

    def test_group_id_is_string(self):
        """group_id 字段转换为字符串。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(group_id='grp1')
        result = match_trigger(trig, ev)
        assert result['group_id'] == 'grp1'

    def test_operator_id_is_string(self):
        """operator_id 字段转换为字符串。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event(operator_id='200')
        result = match_trigger(trig, ev)
        assert result['operator_id'] == '200'

    def test_event_field_is_same_object(self):
        """event 字段是传入的同一事件对象。"""
        trig = make_on_notice_trigger(notice_type='any')
        ev = make_notice_event()
        result = match_trigger(trig, ev)
        assert result['event'] is ev


# =============================================================================
# 异常容错
# =============================================================================
class TestExceptionHandling:
    """验证 event 属性访问抛异常时返回 None。"""

    def test_property_access_raises_returns_none(self):
        """event 属性访问抛异常 → 返回 None。"""
        trig = make_on_notice_trigger(notice_type='group_increase')
        ev = MagicMock()
        # 让 getattr(ev, 'notice_type') 抛异常
        type(ev).notice_type = property(lambda self: (_ for _ in ()).throw(RuntimeError('err')))
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 节点结构契约
# =============================================================================
class TestNodeContract:
    """验证 on_notice 触发器节点结构契约。"""

    def test_other_node_kind_returns_none(self):
        """nodeKind 不是 on_notice 时返回 None。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'unknown_kind',  # 不是 on_notice
                'config': {'notice_type': 'any'},
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_notice_event(notice_type='group_increase')
        result = match_trigger(trig, ev)
        assert result is None
