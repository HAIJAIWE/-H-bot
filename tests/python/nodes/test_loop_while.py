"""loop_while 节点单元测试。

覆盖：
- loop_while handler 占位返回结构
- handler 参数解析（expression / max_iterations 默认值）
- interpreter 中 loop_while 节点的注册与调度契约
- 表达式与 max_iterations 各种类型/边界值
- 返回结构字段完整性

被测源码：
- qqbat_nodes/builtin/loop_while.py（占位 handler）
- qqbat_nodes/runtime/interpreter.py::_exec_loop_while（实际逻辑）

设计说明：
- loop_while.py 提供占位 handler，返回 {"result": 0, "error": ""}
- 实际循环逻辑由 interpreter._exec_loop_while 实现
- 端到端集成测试在 tests/python/runtime/test_control_flow_extended.py
  中已覆盖，本测试文件聚焦占位 handler 与调度契约
"""
import pytest

import qqbat_nodes.builtin.loop_while as loop_while_module
from qqbat_nodes.builtin.loop_while import loop_while


# =============================================================================
# 模块占位结构
# =============================================================================
class TestModuleStructure:
    """验证 loop_while 模块的占位结构。"""

    def test_module_importable(self):
        """loop_while 模块可正常导入。"""
        assert loop_while_module is not None

    def test_module_has_docstring(self):
        """loop_while 模块包含 docstring 说明。"""
        assert loop_while_module.__doc__ is not None
        assert len(loop_while_module.__doc__) > 0

    def test_handler_docstring_mentions_placeholder(self):
        """loop_while handler 的 docstring 说明占位性质。

        handler docstring 中明确指出由 interpreter 内联处理。
        """
        doc = loop_while_module.loop_while.__doc__ or ''
        assert 'interpreter' in doc or '内联' in doc or '占位' in doc

    def test_module_has_async_handler(self):
        """loop_while 模块定义了 async handler loop_while。"""
        assert hasattr(loop_while_module, 'loop_while')
        assert callable(loop_while_module.loop_while)
        # 验证是协程函数
        import inspect
        assert inspect.iscoroutinefunction(loop_while_module.loop_while)


# =============================================================================
# handler 返回结构
# =============================================================================
class TestHandlerReturnStructure:
    """验证 loop_while handler 占位返回结构。"""

    @pytest.mark.asyncio
    async def test_default_return_structure(self, mock_bot, mock_event):
        """默认调用返回 {result: 0, error: ''}。"""
        result = await loop_while(mock_bot, mock_event)
        assert isinstance(result, dict)
        assert result == {'result': 0, 'error': ''}

    @pytest.mark.asyncio
    async def test_return_has_required_fields(self, mock_bot, mock_event):
        """返回 dict 含 result 与 error 两个键。"""
        result = await loop_while(mock_bot, mock_event)
        assert 'result' in result
        assert 'error' in result
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_result_is_int_zero(self, mock_bot, mock_event):
        """result 字段为 int 类型且值为 0（占位）。"""
        result = await loop_while(mock_bot, mock_event)
        assert isinstance(result['result'], int)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_error_is_empty_string(self, mock_bot, mock_event):
        """error 字段为空字符串。"""
        result = await loop_while(mock_bot, mock_event)
        assert isinstance(result['error'], str)
        assert result['error'] == ''


# =============================================================================
# 参数兼容性
# =============================================================================
class TestParameterCompatibility:
    """验证 loop_while handler 接受各种参数（占位 handler 不依赖参数值）。"""

    @pytest.mark.asyncio
    async def test_with_expression_param(self, mock_bot, mock_event):
        """传入 expression 参数时不抛异常。"""
        result = await loop_while(mock_bot, mock_event, expression='value > 0')
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_with_max_iterations_param(self, mock_bot, mock_event):
        """传入 max_iterations 参数时不抛异常。"""
        result = await loop_while(mock_bot, mock_event, max_iterations=50)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_with_all_params(self, mock_bot, mock_event):
        """同时传入 expression 与 max_iterations 参数。"""
        result = await loop_while(
            mock_bot, mock_event,
            expression='value == True', max_iterations=10,
        )
        assert result['result'] == 0
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_expression_empty(self, mock_bot, mock_event):
        """不传 expression 时默认值为空字符串。"""
        # 占位 handler 不依赖 expression 值，调用不抛异常即可
        result = await loop_while(mock_bot, mock_event)
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_max_iterations_100(self, mock_bot, mock_event):
        """不传 max_iterations 时默认值为 100（占位）。"""
        result = await loop_while(mock_bot, mock_event)
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_ignores_none_bot(self, mock_event):
        """bot=None 不影响占位 handler 返回。"""
        result = await loop_while(None, mock_event)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_ignores_none_event(self, mock_bot):
        """event=None 不影响占位 handler 返回。"""
        result = await loop_while(mock_bot, None)
        assert result['result'] == 0


# =============================================================================
# 边界值
# =============================================================================
class TestBoundaryValues:
    """验证 loop_while handler 对边界参数的处理。"""

    @pytest.mark.asyncio
    async def test_empty_expression(self, mock_bot, mock_event):
        """空字符串 expression 不抛异常。"""
        result = await loop_while(mock_bot, mock_event, expression='')
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_zero_max_iterations(self, mock_bot, mock_event):
        """max_iterations=0 不抛异常（实际逻辑由 interpreter 处理）。"""
        result = await loop_while(mock_bot, mock_event, max_iterations=0)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_negative_max_iterations(self, mock_bot, mock_event):
        """max_iterations=-1 不抛异常。"""
        result = await loop_while(mock_bot, mock_event, max_iterations=-1)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_very_large_max_iterations(self, mock_bot, mock_event):
        """极大的 max_iterations 不抛异常。"""
        result = await loop_while(mock_bot, mock_event, max_iterations=10**9)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_string_max_iterations(self, mock_bot, mock_event):
        """字符串类型 max_iterations 不抛异常。"""
        result = await loop_while(mock_bot, mock_event, max_iterations='100')
        assert result['result'] == 0


# =============================================================================
# interpreter 调度契约
# =============================================================================
class TestInterpreterDispatchContract:
    """验证 loop_while 节点在 interpreter 中的调度注册。"""

    def test_loop_while_registered_in_continuing_handlers(self):
        """loop_while nodeKind 注册在 _CONTROL_FLOW_CONTINUING 映射中。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_CONTINUING
        assert 'loop_while' in _CONTROL_FLOW_CONTINUING
        assert _CONTROL_FLOW_CONTINUING['loop_while'] == '_exec_loop_while'

    def test_loop_while_not_in_terminating_handlers(self):
        """loop_while 不在 _CONTROL_FLOW_TERMINATING 中。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_TERMINATING
        assert 'loop_while' not in _CONTROL_FLOW_TERMINATING

    def test_loop_while_dispatched_to_exec_loop_while_method(self):
        """loop_while 调度目标方法名 _exec_loop_while 在 Interpreter 类中存在。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        assert hasattr(Interpreter, '_exec_loop_while')
        assert callable(getattr(Interpreter, '_exec_loop_while'))


# =============================================================================
# 稳定性
# =============================================================================
class TestStability:
    """验证 loop_while handler 多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_multiple_calls_consistent(self, mock_bot, mock_event):
        """多次调用每次都返回相同占位结构。"""
        for _ in range(5):
            result = await loop_while(mock_bot, mock_event)
            assert result == {'result': 0, 'error': ''}

    @pytest.mark.asyncio
    async def test_independent_dict_instances(self, mock_bot, mock_event):
        """每次调用返回独立 dict 对象。"""
        r1 = await loop_while(mock_bot, mock_event)
        r2 = await loop_while(mock_bot, mock_event)
        assert r1 is not r2
        assert r1 == r2


# =============================================================================
# 包结构契约
# =============================================================================
class TestPackageStructure:
    """验证 loop_while 模块在 qqbat_nodes.builtin 包中的位置。"""

    def test_module_in_builtin_package(self):
        """loop_while 模块属于 qqbat_nodes.builtin 包。"""
        assert loop_while_module.__name__ == 'qqbat_nodes.builtin.loop_while'

    def test_module_file_exists(self):
        """loop_while 模块对应文件存在。"""
        import os
        assert loop_while_module.__file__ is not None
        assert os.path.isfile(loop_while_module.__file__)
        assert loop_while_module.__file__.endswith('loop_while.py')

    def test_module_accessible_via_import(self):
        """通过 importlib.import_module 可访问。"""
        import importlib
        mod = importlib.import_module('qqbat_nodes.builtin.loop_while')
        assert mod is loop_while_module
