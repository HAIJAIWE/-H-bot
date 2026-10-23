"""触发器节点注册自检模块单元测试。

被测源码：qqbat_nodes/runtime/_triggers_check.py

覆盖场景：
- collect_configured_triggers：正确识别触发器节点
- collect_configured_triggers：空图 / 无 nodes / nodes 非 list 返回空列表
- collect_configured_triggers：非触发器节点（type != 'trigger'）被过滤
- collect_configured_triggers：subflow_define 被过滤（与 interpreter._get_graph_meta 一致）
- collect_configured_triggers：timer 节点（type=='action'）被过滤
- collect_configured_triggers：label 缺失时回退到 nodeKind
- check_triggers_registered：全部已注册时返回空列表
- check_triggers_registered：缺失时返回 missing 列表并打印 [TRIGGER:missing]
- check_triggers_registered：空图返回空列表（不调用 collect_registered_matchers）
- check_triggers_registered：同一 nodeKind 多实例全部缺失时都进入 missing
- collect_registered_matchers：NoneBot 未安装时返回空集合（graceful degradation）
"""
import json
import os
import sys
from unittest.mock import patch

import pytest

# Ensure project root is on sys.path
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from qqbat_nodes.runtime._triggers_check import (
    TRIGGER_NODE_TYPES,
    check_triggers_registered,
    collect_configured_triggers,
    collect_registered_matchers,
)


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_trigger_node(node_id='trig1', node_kind='on_notice', label=''):
    """构造一个触发器节点 dict（type=='trigger'）。"""
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': node_kind,
            'label': label or node_kind,
            'config': {},
            'inputs': [],
            'outputs': [],
        },
    }


def make_action_node(node_id='act1', node_kind='send_message'):
    """构造一个普通动作节点 dict（type=='action'）。"""
    return {
        'id': node_id,
        'type': 'action',
        'data': {
            'nodeKind': node_kind,
            'label': node_kind,
            'config': {},
            'inputs': [],
            'outputs': [],
        },
    }


def make_subflow_define_node(node_id='sub1'):
    """构造一个 subflow_define 节点（type=='trigger' 但不是事件触发器）。"""
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'subflow_define',
            'label': '子流程定义',
            'config': {},
            'inputs': [],
            'outputs': [],
        },
    }


# =============================================================================
# collect_configured_triggers 测试
# =============================================================================
class TestCollectConfiguredTriggers:
    """验证从 flow.json 图中收集触发器节点的逻辑。"""

    def test_identifies_trigger_nodes(self):
        """正确识别多种触发器节点类型。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice', '入群通知'),
                make_trigger_node('t2', 'on_request', '加好友请求'),
                make_trigger_node('t3', 'on_startup', '初始化数据库'),
                make_trigger_node('t4', 'on_ready', '上线通知'),
                make_trigger_node('t5', 'schedule', '每日签到'),
                make_trigger_node('t6', 'on_message', '指令处理'),
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert len(result) == 6
        kinds = {t['node_type'] for t in result}
        assert kinds == {'on_notice', 'on_request', 'on_startup', 'on_ready', 'schedule', 'on_message'}

        # 验证字段完整性
        t1 = next(t for t in result if t['node_id'] == 't1')
        assert t1['node_type'] == 'on_notice'
        assert t1['label'] == '入群通知'

    def test_empty_graph_returns_empty(self):
        """空图（无 nodes 键）返回空列表。"""
        assert collect_configured_triggers({}) == []
        assert collect_configured_triggers(None) == []  # type: ignore[arg-type]

    def test_no_nodes_key_returns_empty(self):
        """有图但无 nodes 键返回空列表。"""
        assert collect_configured_triggers({'edges': []}) == []

    def test_empty_nodes_list_returns_empty(self):
        """nodes 为空列表返回空列表。"""
        assert collect_configured_triggers({'nodes': [], 'edges': []}) == []

    def test_nodes_not_list_returns_empty(self):
        """nodes 非 list 返回空列表。"""
        assert collect_configured_triggers({'nodes': 'not a list', 'edges': []}) == []  # type: ignore[arg-type]
        assert collect_configured_triggers({'nodes': None, 'edges': []}) == []

    def test_non_trigger_nodes_filtered(self):
        """非触发器节点（type != 'trigger'）被过滤掉。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice'),
                make_action_node('a1', 'send_message'),
                make_action_node('a2', 'timer'),  # timer 是 action 不是 trigger
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert len(result) == 1
        assert result[0]['node_id'] == 't1'
        assert result[0]['node_type'] == 'on_notice'

    def test_subflow_define_filtered(self):
        """subflow_define 节点被过滤（与 interpreter._get_graph_meta 一致）。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_message'),
                make_subflow_define_node('sub1'),
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert len(result) == 1
        assert result[0]['node_id'] == 't1'

    def test_timer_action_node_filtered(self):
        """timer 节点（type=='action'）被过滤，即使它在 TRIGGER_NODE_TYPES 中。

        这验证了 type=='trigger' 过滤优先于 TRIGGER_NODE_TYPES 集合检查。
        """
        graph = {
            'nodes': [
                make_action_node('timer1', 'timer'),  # type='action', nodeKind='timer'
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert result == []

    def test_unknown_node_kind_filtered(self):
        """未在 TRIGGER_NODE_TYPES 中的 nodeKind 被过滤。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice'),
                make_trigger_node('t2', 'unknown_trigger_kind'),
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert len(result) == 1
        assert result[0]['node_id'] == 't1'

    def test_label_fallback_to_node_kind(self):
        """label 缺失时回退到 nodeKind。"""
        node = {
            'id': 't1',
            'type': 'trigger',
            'data': {
                'nodeKind': 'on_notice',
                # 无 label 字段
                'config': {},
            },
        }
        result = collect_configured_triggers({'nodes': [node], 'edges': []})
        assert len(result) == 1
        assert result[0]['label'] == 'on_notice'

    def test_missing_node_id_handled(self):
        """节点缺少 id 字段时使用空字符串（不崩溃）。"""
        node = {
            'type': 'trigger',
            'data': {'nodeKind': 'on_notice', 'label': '通知'},
        }
        result = collect_configured_triggers({'nodes': [node], 'edges': []})
        assert len(result) == 1
        assert result[0]['node_id'] == ''

    def test_missing_data_handled(self):
        """节点缺少 data 字段时被跳过（不崩溃）。"""
        node = {'id': 't1', 'type': 'trigger'}  # 无 data
        result = collect_configured_triggers({'nodes': [node], 'edges': []})
        assert result == []

    def test_non_dict_node_skipped(self):
        """nodes 列表中的非 dict 元素被跳过（不崩溃）。"""
        graph = {
            'nodes': [
                'not a dict',
                None,
                123,
                make_trigger_node('t1', 'on_notice'),
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert len(result) == 1
        assert result[0]['node_id'] == 't1'

    def test_all_trigger_types_recognized(self):
        """TRIGGER_NODE_TYPES 中所有实际的触发器类型都能被识别。"""
        actual_triggers = {
            'on_message', 'on_notice', 'on_request',
            'on_button_click', 'on_startup', 'on_ready', 'schedule',
        }
        # 确保实际触发器类型都在 TRIGGER_NODE_TYPES 中
        assert actual_triggers.issubset(TRIGGER_NODE_TYPES)

        graph = {
            'nodes': [
                make_trigger_node(f't_{k}', k, k) for k in actual_triggers
            ],
            'edges': [],
        }
        result = collect_configured_triggers(graph)
        assert len(result) == len(actual_triggers)
        result_kinds = {t['node_type'] for t in result}
        assert result_kinds == actual_triggers


# =============================================================================
# check_triggers_registered 测试
# =============================================================================
class TestCheckTriggersRegistered:
    """验证触发器注册检测逻辑。"""

    def test_all_registered_returns_empty(self):
        """全部触发器已注册时返回空列表。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice'),
                make_trigger_node('t2', 'on_request'),
                make_trigger_node('t3', 'on_startup'),
            ],
            'edges': [],
        }
        # 模拟所有触发器类型都已注册
        all_registered = {
            'on_notice', 'on_request', 'on_startup',
            'on_ready', 'on_message', 'on_button_click', 'schedule',
        }
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value=all_registered
        ):
            result = check_triggers_registered(graph)
        assert result == []

    def test_missing_triggers_returned(self):
        """缺失的触发器返回在 missing 列表中。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice'),  # 已注册
                make_trigger_node('t2', 'on_request'),  # 未注册
                make_trigger_node('t3', 'on_startup'),  # 未注册
            ],
            'edges': [],
        }
        # 只注册了 on_notice
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value={'on_notice'}
        ):
            result = check_triggers_registered(graph)

        assert len(result) == 2
        missing_ids = {t['node_id'] for t in result}
        assert missing_ids == {'t2', 't3'}
        missing_kinds = {t['node_type'] for t in result}
        assert missing_kinds == {'on_request', 'on_startup'}

    def test_missing_triggers_prints_protocol(self, capsys):
        """缺失时打印 [TRIGGER:missing] 协议行。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice', '入群通知'),
                make_trigger_node('t2', 'on_request', '加好友'),  # 未注册
            ],
            'edges': [],
        }
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value={'on_notice'}
        ):
            result = check_triggers_registered(graph)

        assert len(result) == 1
        assert result[0]['node_id'] == 't2'

        # 验证 stdout 包含 [TRIGGER:missing] 协议行
        captured = capsys.readouterr()
        assert '[TRIGGER:missing]' in captured.out

        # 验证 JSON payload 结构
        # 格式：[TRIGGER:missing] {"missing": [...]}
        json_part = captured.out.split('[TRIGGER:missing]', 1)[1].strip()
        payload = json.loads(json_part)
        assert 'missing' in payload
        assert len(payload['missing']) == 1
        assert payload['missing'][0]['node_id'] == 't2'
        assert payload['missing'][0]['node_type'] == 'on_request'
        assert payload['missing'][0]['label'] == '加好友'

    def test_all_registered_no_print(self, capsys):
        """全部已注册时不打印 [TRIGGER:missing]。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice'),
            ],
            'edges': [],
        }
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value={'on_notice', 'on_message', 'on_request', 'on_startup',
                          'on_ready', 'on_button_click', 'schedule'}
        ):
            result = check_triggers_registered(graph)

        assert result == []
        captured = capsys.readouterr()
        assert '[TRIGGER:missing]' not in captured.out

    def test_empty_graph_returns_empty(self):
        """空图返回空列表（不调用 collect_registered_matchers）。"""
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers'
        ) as mock_collect:
            result = check_triggers_registered({})

        assert result == []
        # 空图时不应调用 collect_registered_matchers（提前返回优化）
        mock_collect.assert_not_called()

    def test_no_trigger_nodes_returns_empty(self):
        """图中无触发器节点时返回空列表。"""
        graph = {
            'nodes': [
                make_action_node('a1', 'send_message'),
                make_action_node('a2', 'timer'),
            ],
            'edges': [],
        }
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers'
        ) as mock_collect:
            result = check_triggers_registered(graph)

        assert result == []
        mock_collect.assert_not_called()

    def test_same_kind_multiple_instances_all_missing(self):
        """同一 nodeKind 的多个触发器实例全部缺失时都进入 missing。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice', '入群通知'),
                make_trigger_node('t2', 'on_notice', '退群通知'),
                make_trigger_node('t3', 'on_notice', '撤回通知'),
            ],
            'edges': [],
        }
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value=set()  # 全部未注册
        ):
            result = check_triggers_registered(graph)

        assert len(result) == 3
        # 三个 on_notice 实例都应进入 missing
        for item in result:
            assert item['node_type'] == 'on_notice'
        ids = {t['node_id'] for t in result}
        assert ids == {'t1', 't2', 't3'}

    def test_same_kind_multiple_instances_partial_missing(self):
        """同一 nodeKind 的多个实例：如果该 kind 已注册，则全部不算缺失。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_notice', '入群'),
                make_trigger_node('t2', 'on_notice', '退群'),
            ],
            'edges': [],
        }
        # on_notice 已注册 → 两个实例都不算缺失
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value={'on_notice'}
        ):
            result = check_triggers_registered(graph)
        assert result == []

    def test_protocol_payload_is_valid_json(self, capsys):
        """[TRIGGER:missing] 的 payload 是合法 JSON（含中文 ensure_ascii=False）。"""
        graph = {
            'nodes': [
                make_trigger_node('t1', 'on_startup', '初始化数据库'),
            ],
            'edges': [],
        }
        with patch(
            'qqbat_nodes.runtime._triggers_check.collect_registered_matchers',
            return_value=set()
        ):
            check_triggers_registered(graph)

        captured = capsys.readouterr()
        json_part = captured.out.split('[TRIGGER:missing]', 1)[1].strip()
        # 应该是合法 JSON
        payload = json.loads(json_part)
        assert isinstance(payload, dict)
        assert 'missing' in payload
        # 中文 label 应原样输出（ensure_ascii=False）
        assert payload['missing'][0]['label'] == '初始化数据库'


# =============================================================================
# collect_registered_matchers 测试
# =============================================================================
class TestCollectRegisteredMatchers:
    """验证已注册 matcher 收集逻辑。

    注意：测试环境未安装 NoneBot，collect_registered_matchers 应 graceful 降级。
    """

    def test_returns_empty_when_nonebot_not_installed(self):
        """NoneBot 未安装时返回空集合（不抛异常）。"""
        # 当前测试环境未安装 nonebot，直接调用应返回空集合
        result = collect_registered_matchers()
        # NoneBot 未安装时返回空集合
        assert isinstance(result, set)
        assert result == set()

    def test_returns_empty_when_nonebot_not_initialized(self):
        """NoneBot 已安装但未初始化时返回空集合。"""
        # 模拟 nonebot 已安装但 get_driver() 抛异常（未初始化）
        mock_nonebot = type('MockNoneBot', (), {})()
        mock_nonebot.get_driver = lambda: (_ for _ in ()).throw(Exception('not initialized'))
        mock_nonebot.get_matchers = lambda: []

        with patch.dict(sys.modules, {'nonebot': mock_nonebot}):
            result = collect_registered_matchers()

        assert result == set()

    def test_detects_registered_matchers(self):
        """检测已注册的 NoneBot matcher（on_message/on_notice/on_request）。"""
        # 构造 mock matcher 类
        class MockMatcherMessage:
            type = 'message'

        class MockMatcherNotice:
            type = 'notice'

        class MockMatcherRequest:
            type = 'request'

        mock_nonebot = type('MockNoneBot', (), {})()
        mock_nonebot.get_driver = lambda: None  # 已初始化
        mock_nonebot.get_matchers = lambda: [
            MockMatcherMessage, MockMatcherNotice, MockMatcherRequest
        ]

        # 确保 runtime.plugin 不在 sys.modules 中（避免 on_startup/on_ready 被误判为已注册）
        saved_modules = sys.modules.copy()
        sys.modules.pop('qqbat_nodes.runtime.plugin', None)

        try:
            with patch.dict(sys.modules, {'nonebot': mock_nonebot}):
                result = collect_registered_matchers()
        finally:
            sys.modules.clear()
            sys.modules.update(saved_modules)

        # 应检测到 on_message / on_notice / on_request
        assert 'on_message' in result
        assert 'on_notice' in result
        assert 'on_request' in result
        # on_button_click 跟随 on_message
        assert 'on_button_click' in result
        # schedule 总是标记为已注册
        assert 'schedule' in result
        # runtime.plugin 未加载，on_startup/on_ready 不在结果中
        assert 'on_startup' not in result
        assert 'on_ready' not in result

    def test_detects_driver_hooks_when_plugin_loaded(self):
        """runtime.plugin 模块已加载时检测到 on_startup/on_ready 钩子。"""
        class MockMatcherMessage:
            type = 'message'

        mock_nonebot = type('MockNoneBot', (), {})()
        mock_nonebot.get_driver = lambda: None
        mock_nonebot.get_matchers = lambda: [MockMatcherMessage]

        # 模拟 qqbat_nodes.runtime.plugin 已加载
        saved_modules = sys.modules.copy()
        sys.modules['qqbat_nodes.runtime.plugin'] = type('MockPlugin', (), {})()

        try:
            with patch.dict(sys.modules, {'nonebot': mock_nonebot}):
                result = collect_registered_matchers()
        finally:
            sys.modules.clear()
            sys.modules.update(saved_modules)

        assert 'on_startup' in result
        assert 'on_ready' in result
        assert 'on_message' in result
        assert 'on_button_click' in result
        assert 'schedule' in result

    def test_no_matchers_registered(self):
        """NoneBot 已初始化但无 matcher 时返回 schedule + driver hooks（如有）。"""
        mock_nonebot = type('MockNoneBot', (), {})()
        mock_nonebot.get_driver = lambda: None
        mock_nonebot.get_matchers = lambda: []

        saved_modules = sys.modules.copy()
        sys.modules.pop('qqbat_nodes.runtime.plugin', None)

        try:
            with patch.dict(sys.modules, {'nonebot': mock_nonebot}):
                result = collect_registered_matchers()
        finally:
            sys.modules.clear()
            sys.modules.update(saved_modules)

        # 无 matcher → on_message/on_notice/on_request 不在结果中
        assert 'on_message' not in result
        assert 'on_notice' not in result
        assert 'on_request' not in result
        assert 'on_button_click' not in result
        # schedule 总是标记为已注册
        assert 'schedule' in result

    def test_matcher_without_type_skipped(self):
        """matcher 无 type 属性时被跳过（不崩溃）。"""
        class MockMatcherNoType:
            pass  # 无 type 属性

        class MockMatcherMessage:
            type = 'message'

        mock_nonebot = type('MockNoneBot', (), {})()
        mock_nonebot.get_driver = lambda: None
        mock_nonebot.get_matchers = lambda: [MockMatcherNoType, MockMatcherMessage]

        saved_modules = sys.modules.copy()
        sys.modules.pop('qqbat_nodes.runtime.plugin', None)

        try:
            with patch.dict(sys.modules, {'nonebot': mock_nonebot}):
                result = collect_registered_matchers()
        finally:
            sys.modules.clear()
            sys.modules.update(saved_modules)

        # MockMatcherNoType 被跳过，MockMatcherMessage 被识别
        assert 'on_message' in result
