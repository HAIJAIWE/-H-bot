"""retry_exec 节点单元测试 — 重试执行占位节点。

retry_exec 是控制流节点，由 interpreter 内联处理（无独立 handler）。
实际逻辑在 runtime/interpreter.py::_exec_retry_exec 中：
- 执行 body 子链
- 异常时等待 delay 秒后重试
- 最多 max_retries 次
- 全部失败走 failed 分支，成功走 success 分支

本测试聚焦：
- 模块占位结构（importable / docstring 说明）
- interpreter 注册契约（INLINE_HANDLERS 包含 retry_exec）
- 端到端行为在 tests/python/runtime/test_control_flow_extended.py 中覆盖

被测源码：
- qqbat_nodes/builtin/retry_exec.py（占位模块）
- qqbat_nodes/runtime/interpreter.py::_exec_retry_exec（实际逻辑）
"""
import inspect

import pytest

import qqbat_nodes.builtin.retry_exec as retry_exec_module


# =============================================================================
# 模块占位结构
# =============================================================================
class TestModuleStructure:
    """验证 retry_exec 模块的占位结构。"""

    def test_module_importable(self):
        """retry_exec 模块可正常导入。"""
        assert retry_exec_module is not None

    def test_module_has_docstring(self):
        """retry_exec 模块包含 docstring 说明占位性质。"""
        assert retry_exec_module.__doc__ is not None
        assert len(retry_exec_module.__doc__) > 0

    def test_docstring_mentions_interpreter(self):
        """docstring 应说明实际逻辑由 interpreter 处理。"""
        doc = retry_exec_module.__doc__ or ''
        assert 'interpreter' in doc or '内联' in doc or '占位' in doc

    def test_module_has_no_async_handler(self):
        """retry_exec 是纯占位模块，不应定义独立 async handler。

        实际逻辑在 interpreter._exec_retry_exec 中内联处理。
        """
        # 模块中不应有 async def 函数（占位模块只有 docstring）
        for name in dir(retry_exec_module):
            obj = getattr(retry_exec_module, name, None)
            if callable(obj) and inspect.iscoroutinefunction(obj):
                # 如果有 async 函数，它应该明确标注为占位（如 try_catch 那样）
                # retry_exec 是纯占位，不应有 handler
                pytest.fail(f"retry_exec 占位模块不应有 async handler: {name}")


# =============================================================================
# interpreter 注册契约
# =============================================================================
class TestInterpreterRegistration:
    """验证 retry_exec 在 interpreter 中的注册。"""

    def test_retry_exec_in_control_flow_terminating(self):
        """interpreter 的 _CONTROL_FLOW_TERMINATING 应包含 retry_exec。"""
        from qqbat_nodes.runtime import interpreter
        assert hasattr(interpreter, '_CONTROL_FLOW_TERMINATING')
        assert isinstance(interpreter._CONTROL_FLOW_TERMINATING, dict)
        assert 'retry_exec' in interpreter._CONTROL_FLOW_TERMINATING

    def test_retry_exec_maps_to_exec_method(self):
        """retry_exec 应映射到 _exec_retry_exec 方法。"""
        from qqbat_nodes.runtime import interpreter
        assert interpreter._CONTROL_FLOW_TERMINATING['retry_exec'] == '_exec_retry_exec'

    def test_interpreter_has_exec_retry_exec_method(self):
        """Interpreter 类应定义 _exec_retry_exec 方法。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        assert hasattr(Interpreter, '_exec_retry_exec')
        assert callable(getattr(Interpreter, '_exec_retry_exec'))

    def test_exec_retry_exec_is_async(self):
        """_exec_retry_exec 应为协程方法。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        assert inspect.iscoroutinefunction(Interpreter._exec_retry_exec)

    def test_exec_retry_exec_docstring(self):
        """_exec_retry_exec 的 docstring 应描述重试语义。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        doc = Interpreter._exec_retry_exec.__doc__ or ''
        assert len(doc) > 0
        # 应提到关键概念：重试 / body / success / failed
        assert '重试' in doc or 'retry' in doc.lower()
        assert 'body' in doc.lower() or '子链' in doc
