"""loop 节点单元测试。

覆盖：
- loop 模块占位结构（无独立 handler，逻辑由 interpreter 内联处理）
- interpreter 中 loop 节点的注册与调度契约
- DEFAULT_LOOP_MAX_ITERATIONS 常量值
- 控制流调度映射（_CONTROL_FLOW_CONTINUING）

被测源码：
- qqbat_nodes/builtin/loop.py（占位）
- qqbat_nodes/runtime/interpreter.py::_exec_loop（实际逻辑）

设计说明：
- loop.py 文件本身仅占位（无 async def handler），实际循环逻辑由
  interpreter._exec_loop 实现
- 端到端 interpreter 集成测试在 tests/python/runtime/test_control_flow_extended.py
  中已覆盖，本测试文件聚焦占位结构与调度契约
"""
import pytest

import qqbat_nodes.builtin.loop as loop_module


# =============================================================================
# 模块占位结构
# =============================================================================
class TestModuleStructure:
    """验证 loop 模块的占位结构。"""

    def test_module_importable(self):
        """loop 模块可正常导入（占位文件不抛异常）。"""
        assert loop_module is not None

    def test_module_has_docstring(self):
        """loop 模块包含 docstring 说明占位性质。"""
        assert loop_module.__doc__ is not None
        # docstring 提及 interpreter 内联处理
        doc = loop_module.__doc__
        assert 'interpreter' in doc or '内联' in doc or 'runtime' in doc.lower()

    def test_module_no_async_handler(self):
        """loop 模块不定义独立 async handler。

        loop 节点的实际逻辑在 interpreter._exec_loop 中，
        loop.py 仅保留以保持包结构完整。
        """
        # 模块中不应有同名 async 函数 loop
        assert not hasattr(loop_module, 'loop') or not callable(
            getattr(loop_module, 'loop', None)
        )

    def test_module_no_callables(self):
        """loop 模块不定义业务可调用对象（仅占位）。"""
        # 收集模块级非下划线开头的可调用对象
        callables = [
            name for name in dir(loop_module)
            if not name.startswith('_') and callable(getattr(loop_module, name))
        ]
        # 排除内置/导入的（如 __builtins__）
        business_callables = [
            name for name in callables
            if getattr(loop_module, name).__module__ == loop_module.__name__
        ]
        assert len(business_callables) == 0


# =============================================================================
# interpreter 调度契约
# =============================================================================
class TestInterpreterDispatchContract:
    """验证 loop 节点在 interpreter 中的调度注册。"""

    def test_loop_registered_in_continuing_handlers(self):
        """loop nodeKind 注册在 _CONTROL_FLOW_CONTINUING 映射中。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_CONTINUING
        assert 'loop' in _CONTROL_FLOW_CONTINUING
        assert _CONTROL_FLOW_CONTINUING['loop'] == '_exec_loop'

    def test_loop_not_in_terminating_handlers(self):
        """loop 不在 _CONTROL_FLOW_TERMINATING 中（它是 CONTINUING 类型）。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_TERMINATING
        assert 'loop' not in _CONTROL_FLOW_TERMINATING

    def test_loop_dispatched_to_exec_loop_method(self):
        """loop 调度目标方法名 _exec_loop 在 Interpreter 类中存在。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        assert hasattr(Interpreter, '_exec_loop')
        assert callable(getattr(Interpreter, '_exec_loop'))

    def test_default_loop_max_iterations_value(self):
        """DEFAULT_LOOP_MAX_ITERATIONS 常量值为 1000（防死循环默认上限）。"""
        from qqbat_nodes.runtime.interpreter import DEFAULT_LOOP_MAX_ITERATIONS
        assert DEFAULT_LOOP_MAX_ITERATIONS == 1000


# =============================================================================
# 模块可重复导入
# =============================================================================
class TestModuleImportStability:
    """验证 loop 模块的导入稳定性。"""

    def test_multiple_imports_consistent(self):
        """多次导入 loop 模块返回同一对象。"""
        import qqbat_nodes.builtin.loop as mod1
        import qqbat_nodes.builtin.loop as mod2
        assert mod1 is mod2

    def test_importlib_reload_consistent(self):
        """importlib.reload 后模块仍可用。"""
        import importlib
        import qqbat_nodes.builtin.loop as mod
        reloaded = importlib.reload(mod)
        assert reloaded is mod
        assert reloaded.__doc__ is not None


# =============================================================================
# 包结构契约
# =============================================================================
class TestPackageStructure:
    """验证 loop 模块在 qqbat_nodes.builtin 包中的位置。"""

    def test_module_in_builtin_package(self):
        """loop 模块属于 qqbat_nodes.builtin 包。"""
        assert loop_module.__name__ == 'qqbat_nodes.builtin.loop'

    def test_module_file_exists(self):
        """loop 模块对应文件存在。"""
        import os
        assert loop_module.__file__ is not None
        assert os.path.isfile(loop_module.__file__)
        assert loop_module.__file__.endswith('loop.py')

    def test_module_accessible_via_import(self):
        """通过 import qqbat_nodes.builtin.loop 可访问。"""
        # importlib.import_module 不抛异常
        import importlib
        mod = importlib.import_module('qqbat_nodes.builtin.loop')
        assert mod is loop_module
