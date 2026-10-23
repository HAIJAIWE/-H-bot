"""Tests for flow_schema.py — Pydantic 校验 flow.json 结构。

Tests:
- test_validate_empty_dict: 空 dict 缺 nodes → 应报错
- test_validate_minimal_flow: 最简 {nodes, edges} → 通过
- test_validate_full_flow: 完整 flow.json 结构 → 通过
- test_validate_node_missing_id: nodes 中缺 id → 应报错
- test_validate_edge_missing_source: edges 中缺 source → 应报错
- test_validate_invalid_top_level: 顶层非 dict → 应报错
- test_validate_pydantic_unavailable: Pydantic 不可用时优雅降级
- test_load_flow_with_invalid_structure_still_returns_dict: flow_loader 集成 — 校验失败仍返回 dict
"""
import json
import os
import sys

import pytest

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from qqbat_nodes.runtime.flow_schema import validate_flow, _PYDANTIC_AVAILABLE
from qqbat_nodes.runtime.flow_loader import load_flow, invalidate


class TestValidateFlow:
    """validate_flow() 单元测试。"""

    def test_validate_empty_dict(self):
        """空 dict 缺 nodes 字段 → 应报错。"""
        errors = validate_flow({})
        assert len(errors) > 0
        assert any('nodes' in e for e in errors)

    def test_validate_minimal_flow(self):
        """最简 {nodes: [], edges: []} → 应通过。"""
        graph = {'nodes': [], 'edges': []}
        errors = validate_flow(graph)
        assert errors == []

    def test_validate_minimal_flow_without_edges(self):
        """只有 nodes，没有 edges → edges 默认空列表，应通过。"""
        graph = {'nodes': [{'id': 'n1'}]}
        errors = validate_flow(graph)
        assert errors == []

    def test_validate_full_flow(self):
        """完整 flow.json 结构（含 schemaVersion/metadata/systems）→ 应通过。"""
        graph = {
            'schemaVersion': '1.1',
            'metadata': {
                'name': '修仙修真',
                'version': '3.0',
                'runtime': 'nonebot2',
                'createdAt': '2026-07-11T08:30:00Z',
                'updatedAt': '2026-07-11T02:28:51.33Z',
            },
            'nodes': [
                {
                    'id': 'm1',
                    'type': 'trigger',
                    'position': {'x': 0, 'y': 0},
                    'data': {
                        'label': '收到消息',
                        'description': '/修仙 入口',
                        'nodeKind': 'on_message',
                        'config': {
                            'match': 'command',
                            'command': '修仙',
                            'prefix': '/',
                            'message_type': 'any',
                        },
                        'inputs': [],
                        'outputs': [],
                    },
                },
                {
                    'id': 'm2',
                    'type': 'action',
                    'position': {'x': 200, 'y': 0},
                    'data': {
                        'label': '发送消息',
                        'description': '/修仙 回复',
                        'nodeKind': 'send_message',
                        'config': {'text': '已签到'},
                        'inputs': [],
                        'outputs': [],
                    },
                },
            ],
            'edges': [
                {
                    'id': 'e1',
                    'source': 'm1',
                    'sourcePort': 'next',
                    'target': 'm2',
                    'targetPort': 'in',
                }
            ],
            'systems': [
                {
                    'id': 'sys-entry',
                    'name': '入口系统',
                    'icon': '🚪',
                    'description': '/修仙 入口',
                    'chainTriggerIds': ['m1'],
                }
            ],
            'variables': {'key': 'value'},
        }
        errors = validate_flow(graph)
        assert errors == [], f'校验失败: {errors}'

    def test_validate_node_missing_id(self):
        """node 缺 id → 应报错。"""
        graph = {'nodes': [{'type': 'trigger'}], 'edges': []}
        errors = validate_flow(graph)
        assert len(errors) > 0
        assert any('id' in e for e in errors)

    def test_validate_edge_missing_source(self):
        """edge 缺 source → 应报错。"""
        graph = {
            'nodes': [{'id': 'n1'}],
            'edges': [{'id': 'e1', 'target': 'n2', 'targetPort': 'in'}],
        }
        errors = validate_flow(graph)
        assert len(errors) > 0
        assert any('source' in e for e in errors)

    def test_validate_edge_missing_target(self):
        """edge 缺 target → 应报错。"""
        graph = {
            'nodes': [{'id': 'n1'}],
            'edges': [{'id': 'e1', 'source': 'n1', 'sourcePort': 'next'}],
        }
        errors = validate_flow(graph)
        assert len(errors) > 0
        assert any('target' in e for e in errors)

    def test_validate_invalid_top_level(self):
        """顶层非 dict（如 list）→ 应报错。"""
        errors = validate_flow([1, 2, 3])  # type: ignore[arg-type]
        assert len(errors) > 0
        assert any('对象' in e or 'dict' in e.lower() for e in errors)

    def test_validate_pydantic_unavailable(self, monkeypatch):
        """Pydantic 不可用时 validate_flow 应优雅降级（返回空列表）。

        validate_flow 在模块 import 时按 _PYDANTIC_AVAILABLE 标志绑定实现，
        因此先用 monkeypatch 把 sys.modules['pydantic'] 置为 None 阻断导入，
        再 importlib.reload 使模块在降级分支重新编译，从而真正覆盖降级路径。
        """
        import importlib

        import qqbat_nodes.runtime.flow_schema as schema_mod

        # 阻断 pydantic 导入 → reload → 模块以 _PYDANTIC_AVAILABLE=False 重新编译
        monkeypatch.setitem(sys.modules, 'pydantic', None)
        importlib.reload(schema_mod)
        try:
            # 降级分支直接返回空列表（视为通过），不抛异常
            errors = schema_mod.validate_flow({'nodes': [], 'edges': []})
            assert errors == []
            # 即使无效结构也不报错（跳过校验）
            errors = schema_mod.validate_flow({'nodes': []})
            assert errors == []
        finally:
            # 恢复 pydantic 并 reload，确保后续测试回到正式校验分支
            monkeypatch.undo()
            importlib.reload(schema_mod)

    def test_validate_node_with_partial_data(self):
        """node data 只有部分字段 → 应通过（字段全可选）。"""
        graph = {
            'nodes': [
                {'id': 'n1', 'type': 'trigger', 'data': {'nodeKind': 'on_message'}},
                {'id': 'n2', 'type': 'action', 'data': {'label': '发消息'}},
                {'id': 'n3'},  # 完全没有 data
            ],
            'edges': [],
        }
        errors = validate_flow(graph)
        assert errors == [], f'校验失败: {errors}'

    def test_validate_extra_fields_ignored(self):
        """flow.json 含未知字段 → 应通过（宽松校验，不报未知字段错）。"""
        graph = {
            'schemaVersion': '1.1',
            'nodes': [],
            'edges': [],
            'unknown_top_field': 'value',
            'custom_metadata': {'foo': 'bar'},
        }
        errors = validate_flow(graph)
        # Pydantic v2 默认 ignore extra，应通过
        assert errors == []

    def test_validate_edge_reference_intact(self):
        """edge.source/target 都指向已存在的 node → 应通过。"""
        graph = {
            'nodes': [{'id': 'n1'}, {'id': 'n2'}],
            'edges': [
                {'id': 'e1', 'source': 'n1', 'sourcePort': 'next', 'target': 'n2', 'targetPort': 'in'},
            ],
        }
        errors = validate_flow(graph)
        assert errors == []

    def test_validate_edge_dangling_source(self):
        """edge.source 指向不存在的 node → 应报错。"""
        graph = {
            'nodes': [{'id': 'n1'}],
            'edges': [
                {'id': 'e1', 'source': 'ghost', 'target': 'n1'},
            ],
        }
        errors = validate_flow(graph)
        assert len(errors) > 0
        assert any('source' in e and 'ghost' in e for e in errors)

    def test_validate_edge_dangling_target(self):
        """edge.target 指向不存在的 node → 应报错。"""
        graph = {
            'nodes': [{'id': 'n1'}],
            'edges': [
                {'id': 'e1', 'source': 'n1', 'target': 'missing'},
            ],
        }
        errors = validate_flow(graph)
        assert len(errors) > 0
        assert any('target' in e and 'missing' in e for e in errors)

    def test_validate_edge_empty_source_skipped(self):
        """edge.source 为空字符串 → 跳过该边检查（不报错，允许半成品边）。"""
        graph = {
            'nodes': [{'id': 'n1'}],
            'edges': [
                {'id': 'e1', 'source': '', 'target': 'n1'},
            ],
        }
        errors = validate_flow(graph)
        # 空 source 不校验（允许 UI 临时未连线状态）
        assert errors == []


class TestFlowLoaderIntegration:
    """flow_loader 集成测试 — 确认校验接入后不破坏现有行为。"""

    def test_load_flow_with_invalid_structure_still_returns_dict(self, tmp_path):
        """校验失败的 flow.json 仍应返回 dict（不阻塞加载）。"""
        flow_dir = tmp_path / '.qqbat'
        flow_dir.mkdir(parents=True)
        flow_path = flow_dir / 'flow.json'
        # 故意写一个缺 nodes 的无效结构
        flow_path.write_text(json.dumps({'edges': []}), encoding='utf-8')

        project_root = str(tmp_path)
        invalidate(project_root)
        result = load_flow(project_root)
        # 即使校验失败，load_flow 仍返回 dict（advisory 校验）
        assert result is not None
        assert isinstance(result, dict)
        assert 'edges' in result

    def test_load_flow_valid_structure_passes(self, tmp_path):
        """结构合法的 flow.json 正常加载。"""
        flow_dir = tmp_path / '.qqbat'
        flow_dir.mkdir(parents=True)
        flow_path = flow_dir / 'flow.json'
        graph = {'nodes': [{'id': 'n1'}], 'edges': []}
        flow_path.write_text(json.dumps(graph), encoding='utf-8')

        project_root = str(tmp_path)
        invalidate(project_root)
        result = load_flow(project_root)
        assert result is not None
        assert result['nodes'][0]['id'] == 'n1'

    def test_load_flow_full_structure_passes(self, tmp_path):
        """完整结构（含 systems/metadata）正常加载。"""
        flow_dir = tmp_path / '.qqbat'
        flow_dir.mkdir(parents=True)
        flow_path = flow_dir / 'flow.json'
        graph = {
            'schemaVersion': '1.1',
            'metadata': {'name': 'test', 'version': '1.0'},
            'nodes': [{'id': 'n1', 'type': 'trigger', 'data': {'nodeKind': 'on_message'}}],
            'edges': [],
            'systems': [{'id': 'sys-1', 'name': '系统1', 'chainTriggerIds': ['n1']}],
        }
        flow_path.write_text(json.dumps(graph), encoding='utf-8')

        project_root = str(tmp_path)
        invalidate(project_root)
        result = load_flow(project_root)
        assert result is not None
        assert result['schemaVersion'] == '1.1'
        assert result['systems'][0]['id'] == 'sys-1'
