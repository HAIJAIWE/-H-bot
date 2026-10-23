"""ConfigApiBinding 解释执行模式测试。

验证"代码生成模式 → 解释执行模式"迁移修复：
ConfigApiBinding（__config_api__ 边）：配置 API 绑定数据注入

该功能原由代码生成模式（dataflow.ts __config_api__）实现，
迁移到解释执行模式后在 interpreter.py 中重新实现。

注：subflow_call/subflow_define 相关测试已在节点系统重写中移除
（subflow_call/subflow_define 节点已废弃）。
"""
import os
import sys

import pytest

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


# =========================================================================
# 辅助函数：构建图节点
# =========================================================================
def make_trigger_node(node_id='trig', match='any'):
    """构建 on_message(match=any) 触发器节点。"""
    return {
        'id': node_id,
        'type': 'trigger',
        'data': {
            'nodeKind': 'on_message',
            'config': {'match': match},
            'inputs': [],
            'outputs': [{'id': 'next', 'name': '下一步', 'kind': 'control'}],
        },
    }


def make_send_node(node_id, text=''):
    """构建 send_message 节点。

    outputs 留空以走 find_control_next 兜底逻辑（与 test_control_flow_extended.py 一致），
    这样从 send_message 出发的边不需要显式指定 source_port。
    """
    return {
        'id': node_id,
        'type': 'action',
        'data': {
            'nodeKind': 'send_message',
            'config': {'text': text},
            'inputs': [
                {'id': 'in', 'name': '入口', 'kind': 'control'},
                {'id': 'text', 'name': '文本', 'kind': 'data', 'dataType': 'string'},
            ],
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


def make_config_api_edge(target_node_id, target_port_id, config_api):
    """构建 __config_api__ 绑定边。"""
    return {
        'source': '__config_api__',
        'sourcePort': '',
        'target': target_node_id,
        'targetPort': target_port_id,
        'configApi': config_api,
    }


# =========================================================================
# ConfigApiBinding 测试
# =========================================================================
class TestConfigApiBinding:
    """ConfigApiBinding（__config_api__ 边）在解释执行模式下的行为测试。"""

    @pytest.mark.asyncio
    async def test_config_api_query_single_value(
        self, make_interpreter, mock_bot, make_event
    ):
        """config API 边 query 模式：调用 db_write select 查询单值，注入到节点输入端口。"""
        # 图结构：
        # trig → send_message（text 端口通过 __config_api__ 边绑定到配置表）
        config_api = {
            'table': 'realms',
            'field': 'name',
            'dbPath': 'data/config/realms.db',
            'where': 'level = ?',
            'whereParamRef': {'literalValue': 1},
            'mode': 'query',
        }

        graph = {
            'nodes': [
                make_trigger_node(),
                make_send_node('send1', ''),
            ],
            'edges': [
                make_edge('trig', 'send1'),
                # __config_api__ 边绑定到 send1 的 text 端口
                make_config_api_edge('send1', 'text', config_api),
            ],
        }

        sent_texts = []

        async def track_send(bot, event, text=''):
            sent_texts.append(text)
            return {"success": True, "error": ""}

        # mock db_write handler
        async def mock_db_write(bot, event, mode='insert', table='', data=None,
                                condition='', db_path='data.db',
                                where_params=None, result_field=''):
            assert mode == 'select'
            assert table == 'realms'
            assert db_path == 'data/config/realms.db'
            assert condition == 'level = ?'
            assert where_params == [1]
            assert result_field == 'name'
            return {
                'success': True,
                'rows': [{'level': 1, 'name': '炼气期'}],
                'rows_count': 1,
                'value': '炼气期',
                'found': True,
                'error': '',
            }

        interp = make_interpreter(graph, handlers={
            'send_message': track_send,
            'db_write': mock_db_write,
        })
        event = make_event(message_text='任意消息')
        await interp.handle_event(mock_bot, event)

        # send_message 应收到配置 API 查询的单值
        assert len(sent_texts) == 1
        assert sent_texts[0] == '炼气期'

    @pytest.mark.asyncio
    async def test_config_api_query_all_returns_rows(
        self, make_interpreter, mock_bot, make_event
    ):
        """config API 边 query_all 模式：返回行列表（直接注入到 send_message 的 text 端口）。"""
        config_api = {
            'table': 'realms',
            'field': '',
            'dbPath': 'data/config/realms.db',
            'mode': 'query_all',
        }

        graph = {
            'nodes': [
                make_trigger_node(),
                make_send_node('send1', ''),
            ],
            'edges': [
                make_edge('trig', 'send1'),
                make_config_api_edge('send1', 'text', config_api),
            ],
        }

        sent_texts = []

        async def track_send(bot, event, text=''):
            sent_texts.append(text)
            return {"success": True, "error": ""}

        async def mock_db_write(bot, event, mode='insert', table='', data=None,
                                condition='', db_path='data.db',
                                where_params=None, result_field=''):
            assert mode == 'select'
            assert result_field == ''  # query_all 模式不提取单字段
            return {
                'success': True,
                'rows': [{'level': 1, 'name': '炼气'}, {'level': 2, 'name': '筑基'}, {'level': 3, 'name': '金丹'}],
                'rows_count': 3,
                'value': None,
                'found': True,
                'error': '',
            }

        interp = make_interpreter(graph, handlers={
            'send_message': track_send,
            'db_write': mock_db_write,
        })
        event = make_event(message_text='任意消息')
        await interp.handle_event(mock_bot, event)

        # send_message 应收到行列表（query_all 模式返回 rows）
        assert len(sent_texts) == 1
        assert isinstance(sent_texts[0], list)
        assert len(sent_texts[0]) == 3
        assert sent_texts[0][0]['name'] == '炼气'

    @pytest.mark.asyncio
    async def test_config_api_with_where_param_ref(
        self, make_interpreter, mock_bot, make_event
    ):
        """config API 边 whereParamRef 引用上游节点输出端口。"""
        # 图结构：
        # trig → set_variable(level=2) → send_message（text 通过 config API 查询 level=? 的 name）
        set_var_node = {
            'id': 'set_var',
            'type': 'action',
            'data': {
                'nodeKind': 'set_variable',
                'config': {'var_name': 'level', 'var_value': 2},
                # 显式定义 data 输入端口，确保 _resolve_input_kwargs 从 config 取 var_name/var_value
                'inputs': [
                    {'id': 'in', 'name': '入口', 'kind': 'control'},
                    {'id': 'var_name', 'name': '变量名', 'kind': 'data', 'dataType': 'string'},
                    {'id': 'var_value', 'name': '变量值', 'kind': 'data', 'dataType': 'any'},
                ],
                # outputs 留空以走 _assign_outputs 智能赋值：
                # result dict 的每个 key 被存为端口变量，set_var:result = 2（而非整个 dict）
                'outputs': [],
            },
        }

        config_api = {
            'table': 'realms',
            'field': 'name',
            'dbPath': 'data/config/realms.db',
            'where': 'level = ?',
            'whereParamRef': {'nodeId': 'set_var', 'portId': 'result'},
            'mode': 'query',
        }

        graph = {
            'nodes': [
                make_trigger_node(),
                set_var_node,
                make_send_node('send1', ''),
            ],
            'edges': [
                make_edge('trig', 'set_var'),
                make_edge('set_var', 'send1'),
                make_config_api_edge('send1', 'text', config_api),
            ],
        }

        sent_texts = []

        async def track_send(bot, event, text=''):
            sent_texts.append(text)
            return {"success": True, "error": ""}

        captured_params = []

        async def mock_db_write(bot, event, mode='insert', table='', data=None,
                                condition='', db_path='data.db',
                                where_params=None, result_field=''):
            captured_params.append(where_params)
            return {
                'success': True,
                'rows': [{'level': 2, 'name': '筑基期'}],
                'rows_count': 1,
                'value': '筑基期',
                'found': True,
                'error': '',
            }

        async def mock_set_variable(bot, event, var_name='', var_value=None, **kwargs):
            return {'result': var_value, 'var_name': var_name, 'error': ''}

        interp = make_interpreter(graph, handlers={
            'send_message': track_send,
            'db_write': mock_db_write,
            'set_variable': mock_set_variable,
        })
        event = make_event(message_text='任意消息')
        await interp.handle_event(mock_bot, event)

        # db_write 应收到 where_params=[2]（来自 set_var 节点的 result 端口）
        assert len(captured_params) == 1
        assert captured_params[0] == [2]
        assert sent_texts[0] == '筑基期'

    @pytest.mark.asyncio
    async def test_config_api_query_failure_returns_none(
        self, make_interpreter, mock_bot, make_event
    ):
        """config API 查询失败时，query 模式返回 None。

        注：track_send 的 text 默认值设为 None（而非 ''），以避免
        _resolve_input_kwargs 的默认值回退机制把 None 覆盖成 ''。
        这样能正确反映 config API 返回 None 的语义。
        """
        config_api = {
            'table': 'nonexistent_table',
            'field': 'name',
            'dbPath': 'data/config/nonexistent.db',
            'mode': 'query',
        }

        graph = {
            'nodes': [
                make_trigger_node(),
                make_send_node('send1', ''),
            ],
            'edges': [
                make_edge('trig', 'send1'),
                make_config_api_edge('send1', 'text', config_api),
            ],
        }

        sent_texts = []

        async def track_send(bot, event, text=None):
            sent_texts.append(text)
            return {"success": True, "error": ""}

        async def mock_db_write(bot, event, **kwargs):
            return {'success': False, 'error': 'table not found', 'rows': [], 'value': None}

        interp = make_interpreter(graph, handlers={
            'send_message': track_send,
            'db_write': mock_db_write,
        })
        event = make_event(message_text='任意消息')
        await interp.handle_event(mock_bot, event)

        # 查询失败，text 应为 None
        assert len(sent_texts) == 1
        assert sent_texts[0] is None

    @pytest.mark.asyncio
    async def test_config_api_missing_db_write_handler(
        self, make_interpreter, mock_bot, make_event
    ):
        """registry 中没有 db_write handler 时，config API 返回 None（不崩溃）。"""
        config_api = {
            'table': 'realms',
            'field': 'name',
            'dbPath': 'data/config/realms.db',
            'mode': 'query',
        }

        graph = {
            'nodes': [
                make_trigger_node(),
                make_send_node('send1', ''),
            ],
            'edges': [
                make_edge('trig', 'send1'),
                make_config_api_edge('send1', 'text', config_api),
            ],
        }

        sent_texts = []

        async def track_send(bot, event, text=None):
            sent_texts.append(text)
            return {"success": True, "error": ""}

        # 不注册 db_write handler
        interp = make_interpreter(graph, handlers={'send_message': track_send})
        event = make_event(message_text='任意消息')
        await interp.handle_event(mock_bot, event)

        # 应优雅降级，text 为 None
        assert len(sent_texts) == 1
        assert sent_texts[0] is None
