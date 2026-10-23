"""try_catch 节点单元测试。

覆盖：
- try_catch handler 占位返回结构
- handler 参数解析（error_message 默认值）
- interpreter 中 try_catch 节点的注册与调度契约
- error_message 各种类型/边界值
- 返回结构字段完整性
- interpreter._exec_try_catch 实际行为契约说明

被测源码：
- qqbat_nodes/builtin/try_catch.py（占位 handler）
- qqbat_nodes/runtime/interpreter.py::_exec_try_catch（实际逻辑）

设计说明：
- try_catch.py 提供占位 handler，返回 {"result": "ok", "error": ""}
- 实际异常捕获逻辑由 interpreter._exec_try_catch 实现
- 端到端集成测试在 tests/python/runtime/test_control_flow_extended.py
  中已覆盖，本测试文件聚焦占位 handler 与调度契约
"""
import pytest

import qqbat_nodes.builtin.try_catch as try_catch_module
from qqbat_nodes.builtin.try_catch import try_catch


# =============================================================================
# 模块占位结构
# =============================================================================
class TestModuleStructure:
    """验证 try_catch 模块的占位结构。"""

    def test_module_importable(self):
        """try_catch 模块可正常导入。"""
        assert try_catch_module is not None

    def test_module_has_docstring(self):
        """try_catch 模块包含 docstring 说明。"""
        assert try_catch_module.__doc__ is not None
        assert len(try_catch_module.__doc__) > 0

    def test_handler_docstring_mentions_placeholder(self):
        """try_catch handler 的 docstring 说明占位性质。"""
        doc = try_catch_module.try_catch.__doc__ or ''
        assert 'interpreter' in doc or '内联' in doc or '占位' in doc

    def test_module_has_async_handler(self):
        """try_catch 模块定义了 async handler try_catch。"""
        assert hasattr(try_catch_module, 'try_catch')
        assert callable(try_catch_module.try_catch)
        import inspect
        assert inspect.iscoroutinefunction(try_catch_module.try_catch)


# =============================================================================
# handler 返回结构
# =============================================================================
class TestHandlerReturnStructure:
    """验证 try_catch handler 占位返回结构。"""

    @pytest.mark.asyncio
    async def test_default_return_structure(self, mock_bot, mock_event):
        """默认调用返回 {result: 'ok', error: ''}。"""
        result = await try_catch(mock_bot, mock_event)
        assert isinstance(result, dict)
        assert result == {'result': 'ok', 'error': ''}

    @pytest.mark.asyncio
    async def test_return_has_required_fields(self, mock_bot, mock_event):
        """返回 dict 含 result 与 error 两个键。"""
        result = await try_catch(mock_bot, mock_event)
        assert 'result' in result
        assert 'error' in result
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_result_is_string_ok(self, mock_bot, mock_event):
        """result 字段为字符串 'ok'（占位默认值，表示 try 成功）。"""
        result = await try_catch(mock_bot, mock_event)
        assert isinstance(result['result'], str)
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_error_is_empty_string(self, mock_bot, mock_event):
        """error 字段为空字符串。"""
        result = await try_catch(mock_bot, mock_event)
        assert isinstance(result['error'], str)
        assert result['error'] == ''


# =============================================================================
# 参数兼容性
# =============================================================================
class TestParameterCompatibility:
    """验证 try_catch handler 接受各种参数（占位 handler 不依赖参数值）。"""

    @pytest.mark.asyncio
    async def test_with_error_message_param(self, mock_bot, mock_event):
        """传入 error_message 参数时不抛异常。"""
        result = await try_catch(mock_bot, mock_event, error_message='test error')
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_default_error_message_empty(self, mock_bot, mock_event):
        """不传 error_message 时默认值为空字符串。"""
        # 占位 handler 不依赖 error_message 值，调用不抛异常即可
        result = await try_catch(mock_bot, mock_event)
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_ignores_none_bot(self, mock_event):
        """bot=None 不影响占位 handler 返回。"""
        result = await try_catch(None, mock_event)
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_ignores_none_event(self, mock_bot):
        """event=None 不影响占位 handler 返回。"""
        result = await try_catch(mock_bot, None)
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_both_none_args(self):
        """bot=event=None 也能正常返回信号。"""
        result = await try_catch(None, None)
        assert result['result'] == 'ok'


# =============================================================================
# 边界值
# =============================================================================
class TestBoundaryValues:
    """验证 try_catch handler 对边界参数的处理。"""

    @pytest.mark.asyncio
    async def test_empty_error_message(self, mock_bot, mock_event):
        """空字符串 error_message 不抛异常。"""
        result = await try_catch(mock_bot, mock_event, error_message='')
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_long_error_message(self, mock_bot, mock_event):
        """超长 error_message 不抛异常。"""
        long_msg = 'x' * 10000
        result = await try_catch(mock_bot, mock_event, error_message=long_msg)
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_none_error_message(self, mock_bot, mock_event):
        """error_message=None 不抛异常。"""
        result = await try_catch(mock_bot, mock_event, error_message=None)
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_unicode_error_message(self, mock_bot, mock_event):
        """Unicode error_message 不抛异常。"""
        result = await try_catch(
            mock_bot, mock_event, error_message='异常：连接数据库失败',
        )
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_multiline_error_message(self, mock_bot, mock_event):
        """多行 error_message 不抛异常。"""
        result = await try_catch(
            mock_bot, mock_event,
            error_message='Line1: error\nLine2: detail\nLine3: stack',
        )
        assert result['result'] == 'ok'


# =============================================================================
# interpreter 调度契约
# =============================================================================
class TestInterpreterDispatchContract:
    """验证 try_catch 节点在 interpreter 中的调度注册。"""

    def test_try_catch_registered_in_terminating_handlers(self):
        """try_catch nodeKind 注册在 _CONTROL_FLOW_TERMINATING 映射中。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_TERMINATING
        assert 'try_catch' in _CONTROL_FLOW_TERMINATING
        assert _CONTROL_FLOW_TERMINATING['try_catch'] == '_exec_try_catch'

    def test_try_catch_not_in_continuing_handlers(self):
        """try_catch 不在 _CONTROL_FLOW_CONTINUING 中（它是 TERMINATING 类型）。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_CONTINUING
        assert 'try_catch' not in _CONTROL_FLOW_CONTINUING

    def test_try_catch_dispatched_to_exec_try_catch_method(self):
        """try_catch 调度目标方法名 _exec_try_catch 在 Interpreter 类中存在。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        assert hasattr(Interpreter, '_exec_try_catch')
        assert callable(getattr(Interpreter, '_exec_try_catch'))


# =============================================================================
# interpreter 行为契约
# =============================================================================
class TestInterpreterBehaviorContract:
    """验证 try_catch handler 返回结构满足 interpreter 期望。

    interpreter._exec_try_catch 不调用 handler（直接内联 try/except/finally），
    但 handler 仍提供 result 字段供 registry 注册与文档化。

    实际行为：
    - try 子链正常 → ctx.variables[node_id:result] = 'ok'
    - try 子链抛异常 → ctx.variables[node_id:result] = 'error'，
                       ctx.variables[node_id:error_message] = str(e)
    - 无论是否异常，finally 子链都执行
    """

    @pytest.mark.asyncio
    async def test_handler_returns_ok_for_default(self, mock_bot, mock_event):
        """handler 默认返回 result='ok'（对应 try 成功路径）。"""
        result = await try_catch(mock_bot, mock_event)
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_handler_returns_empty_error_for_default(self, mock_bot, mock_event):
        """handler 默认返回 error=''（对应无异常路径）。"""
        result = await try_catch(mock_bot, mock_event)
        assert result['error'] == ''


# =============================================================================
# 稳定性
# =============================================================================
class TestStability:
    """验证 try_catch handler 多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_multiple_calls_consistent(self, mock_bot, mock_event):
        """多次调用每次都返回相同占位结构。"""
        for _ in range(5):
            result = await try_catch(mock_bot, mock_event)
            assert result == {'result': 'ok', 'error': ''}

    @pytest.mark.asyncio
    async def test_independent_dict_instances(self, mock_bot, mock_event):
        """每次调用返回独立 dict 对象。"""
        r1 = await try_catch(mock_bot, mock_event)
        r2 = await try_catch(mock_bot, mock_event)
        assert r1 is not r2
        assert r1 == r2


# =============================================================================
# 包结构契约
# =============================================================================
class TestPackageStructure:
    """验证 try_catch 模块在 qqbat_nodes.builtin 包中的位置。"""

    def test_module_in_builtin_package(self):
        """try_catch 模块属于 qqbat_nodes.builtin 包。"""
        assert try_catch_module.__name__ == 'qqbat_nodes.builtin.try_catch'

    def test_module_file_exists(self):
        """try_catch 模块对应文件存在。"""
        import os
        assert try_catch_module.__file__ is not None
        assert os.path.isfile(try_catch_module.__file__)
        assert try_catch_module.__file__.endswith('try_catch.py')

    def test_module_accessible_via_import(self):
        """通过 importlib.import_module 可访问。"""
        import importlib
        mod = importlib.import_module('qqbat_nodes.builtin.try_catch')
        assert mod is try_catch_module
