"""on_request 触发器节点单元测试。

被测源码：qqbat_nodes/builtin/on_request.py（占位文件，仅保留模块结构）。
实际触发匹配逻辑在 qqbat_nodes/runtime/interpreter.py 的 match_trigger() 中，
依据 trigger_node.data.nodeKind == 'on_request' 分支判定：
- config.request_type 默认 'friend'，可选 'friend'/'group'/'any'
- 取 event.request_type（或 event.sub_type 兜底）与 request_type 比较
- 匹配成功返回 {event, user_id, group_id, request_type, comment, flag} 或 None

本测试覆盖：
- friend / group / any 三种 request_type
- sub_type 兜底
- 类型不匹配
- 默认 request_type
- 返回结构完整性
- 异常容错
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.runtime.interpreter import match_trigger


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_on_request_trigger(node_id='trig_req', request_type='friend'):
    """构造一个 on_request 触发器节点 dict。"""
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


def make_request_event(
    request_type='friend', sub_type='',
    user_id='100', group_id='', comment='请加我', flag='flag_1',
):
    """构造一个模拟请求事件对象。"""
    ev = MagicMock()
    ev.request_type = request_type
    ev.sub_type = sub_type
    ev.user_id = user_id
    ev.group_id = group_id
    ev.comment = comment
    ev.flag = flag
    return ev


# =============================================================================
# request_type='friend' 加好友请求
# =============================================================================
class TestFriendRequest:
    """验证 request_type='friend' 匹配加好友请求。"""

    def test_friend_request_matches(self):
        """加好友请求匹配 request_type=friend。"""
        trig = make_on_request_trigger(request_type='friend')
        ev = make_request_event(
            request_type='friend', user_id='100',
            comment='请加我', flag='f1',
        )
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['request_type'] == 'friend'
        assert result['user_id'] == '100'
        assert result['comment'] == '请加我'
        assert result['flag'] == 'f1'

    def test_friend_request_does_not_match_group(self):
        """request_type=friend 不匹配加群请求。"""
        trig = make_on_request_trigger(request_type='friend')
        ev = make_request_event(request_type='group')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# request_type='group' 加群请求
# =============================================================================
class TestGroupRequest:
    """验证 request_type='group' 匹配加群请求。"""

    def test_group_request_matches(self):
        """加群请求匹配 request_type=group。"""
        trig = make_on_request_trigger(request_type='group')
        ev = make_request_event(
            request_type='group', sub_type='add',
            user_id='100', group_id='grp1',
        )
        result = match_trigger(trig, ev)
        assert result is not None
        assert result['request_type'] == 'group'
        assert result['group_id'] == 'grp1'

    def test_group_request_does_not_match_friend(self):
        """request_type=group 不匹配加好友请求。"""
        trig = make_on_request_trigger(request_type='group')
        ev = make_request_event(request_type='friend')
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# request_type='any' 通配
# =============================================================================
class TestAnyRequestType:
    """验证 request_type='any' 匹配任意请求。"""

    def test_any_matches_friend(self):
        """any 匹配加好友请求。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(request_type='friend')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_any_matches_group(self):
        """any 匹配加群请求。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(request_type='group')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_any_matches_unknown_type(self):
        """any 匹配任意未知 request_type。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(request_type='other_kind')
        result = match_trigger(trig, ev)
        assert result is not None


# =============================================================================
# 默认 request_type
# =============================================================================
class TestDefaultRequestType:
    """验证 config 中无 request_type 时默认 'friend'。"""

    def test_missing_request_type_defaults_friend(self):
        """config 中无 request_type 字段时，match_trigger 用 .get('request_type', 'friend')。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_request',
                'config': {},  # 无 request_type
                'inputs': [],
                'outputs': [],
            },
        }
        # 默认 friend → 匹配 friend 请求
        ev_friend = make_request_event(request_type='friend')
        assert match_trigger(trig, ev_friend) is not None
        # 默认 friend → 不匹配 group 请求
        ev_group = make_request_event(request_type='group')
        assert match_trigger(trig, ev_group) is None


# =============================================================================
# sub_type 兜底
# =============================================================================
class TestSubTypeFallback:
    """验证 event.request_type 为空时回退到 event.sub_type。"""

    def test_empty_request_type_uses_sub_type(self):
        """event.request_type='' 时用 event.sub_type 比较。"""
        trig = make_on_request_trigger(request_type='add')
        ev = make_request_event(request_type='', sub_type='add')
        result = match_trigger(trig, ev)
        assert result is not None

    def test_both_empty_no_match(self):
        """event.request_type 和 sub_type 都为空时不匹配具体 request_type。"""
        trig = make_on_request_trigger(request_type='friend')
        ev = make_request_event(request_type='', sub_type='')
        result = match_trigger(trig, ev)
        assert result is None

    def test_both_empty_matches_any(self):
        """event.request_type 和 sub_type 都为空时 any 仍匹配。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(request_type='', sub_type='')
        result = match_trigger(trig, ev)
        assert result is not None


# =============================================================================
# 返回结构
# =============================================================================
class TestReturnStructure:
    """验证触发器返回 dict 字段完整性。"""

    def test_return_has_all_required_fields(self):
        """返回 dict 必含 event/user_id/group_id/request_type/comment/flag 六个键。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(
            request_type='friend', user_id='100', group_id='grp1',
            comment='hi', flag='f1',
        )
        result = match_trigger(trig, ev)
        assert set(result.keys()) == {
            'event', 'user_id', 'group_id',
            'request_type', 'comment', 'flag',
        }

    def test_user_id_is_string(self):
        """user_id 字段转换为字符串。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(user_id='12345')
        result = match_trigger(trig, ev)
        assert result['user_id'] == '12345'
        assert isinstance(result['user_id'], str)

    def test_group_id_is_string(self):
        """group_id 字段转换为字符串。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(group_id='grp1')
        result = match_trigger(trig, ev)
        assert result['group_id'] == 'grp1'

    def test_event_field_is_same_object(self):
        """event 字段是传入的同一事件对象。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event()
        result = match_trigger(trig, ev)
        assert result['event'] is ev

    def test_request_type_preserved(self):
        """request_type 字段保留事件原值（不强制转换）。"""
        trig = make_on_request_trigger(request_type='any')
        ev = make_request_event(request_type='friend')
        result = match_trigger(trig, ev)
        assert result['request_type'] == 'friend'


# =============================================================================
# 异常容错
# =============================================================================
class TestExceptionHandling:
    """验证 event 属性访问抛异常时返回 None。"""

    def test_property_access_raises_returns_none(self):
        """event 属性访问抛异常 → 返回 None。"""
        trig = make_on_request_trigger(request_type='friend')
        ev = MagicMock()
        type(ev).request_type = property(lambda self: (_ for _ in ()).throw(RuntimeError('err')))
        result = match_trigger(trig, ev)
        assert result is None


# =============================================================================
# 节点结构契约
# =============================================================================
class TestNodeContract:
    """验证 on_request 触发器节点结构契约。"""

    def test_other_node_kind_returns_none(self):
        """nodeKind 不是 on_request 时返回 None。"""
        trig = {
            'id': 'trig',
            'type': 'trigger',
            'data': {
                'nodeKind': 'unknown_kind',  # 不是 on_request
                'config': {'request_type': 'friend'},
                'inputs': [],
                'outputs': [],
            },
        }
        ev = make_request_event(request_type='friend')
        result = match_trigger(trig, ev)
        assert result is None
