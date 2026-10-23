"""parallel_exec 节点单元测试。

覆盖：
- parallel_exec handler 占位返回结构
- handler 参数兼容性（无业务参数，仅 bot/event）
- interpreter 中 parallel_exec 节点的注册与调度契约
- camelCase 命名兼容（parallelExec）
- 返回结构字段完整性
- interpreter._exec_parallel 实际行为契约说明

被测源码：
- qqbat_nodes/builtin/parallel_exec.py（占位 handler）
- qqbat_nodes/runtime/interpreter.py::_exec_parallel（实际逻辑）

设计说明：
- parallel_exec.py 提供占位 handler，返回 {"results": [], "count": 0, "error": ""}
- 实际并行执行逻辑由 interpreter._exec_parallel 实现
- 端到端集成测试在 tests/python/runtime/test_control_flow_extended.py
  中已覆盖，本测试文件聚焦占位 handler 与调度契约
"""
import pytest

import qqbat_nodes.builtin.parallel_exec as parallel_exec_module
from qqbat_nodes.builtin.parallel_exec import parallel_exec


# =============================================================================
# 模块占位结构
# =============================================================================
class TestModuleStructure:
    """验证 parallel_exec 模块的占位结构。"""

    def test_module_importable(self):
        """parallel_exec 模块可正常导入。"""
        assert parallel_exec_module is not None

    def test_module_has_docstring(self):
        """parallel_exec 模块包含 docstring 说明。"""
        assert parallel_exec_module.__doc__ is not None
        assert len(parallel_exec_module.__doc__) > 0

    def test_handler_docstring_mentions_placeholder(self):
        """parallel_exec handler 的 docstring 说明占位性质。"""
        doc = parallel_exec_module.parallel_exec.__doc__ or ''
        assert 'interpreter' in doc or '内联' in doc or '占位' in doc

    def test_module_has_async_handler(self):
        """parallel_exec 模块定义了 async handler parallel_exec。"""
        assert hasattr(parallel_exec_module, 'parallel_exec')
        assert callable(parallel_exec_module.parallel_exec)
        import inspect
        assert inspect.iscoroutinefunction(parallel_exec_module.parallel_exec)

    def test_module_imports_asyncio(self):
        """parallel_exec 模块导入 asyncio（实际逻辑用 asyncio.gather）。"""
        # 模块文件应包含 import asyncio
        import inspect
        src = inspect.getsource(parallel_exec_module)
        assert 'import asyncio' in src or 'from asyncio' in src


# =============================================================================
# handler 返回结构
# =============================================================================
class TestHandlerReturnStructure:
    """验证 parallel_exec handler 占位返回结构。"""

    @pytest.mark.asyncio
    async def test_default_return_structure(self, mock_bot, mock_event):
        """默认调用返回 {results: [], count: 0, error: ''}。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert isinstance(result, dict)
        assert result == {'results': [], 'count': 0, 'error': ''}

    @pytest.mark.asyncio
    async def test_return_has_required_fields(self, mock_bot, mock_event):
        """返回 dict 含 results/count/error 三个键。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert 'results' in result
        assert 'count' in result
        assert 'error' in result
        assert set(result.keys()) == {'results', 'count', 'error'}

    @pytest.mark.asyncio
    async def test_results_is_empty_list(self, mock_bot, mock_event):
        """results 字段为空列表。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert isinstance(result['results'], list)
        assert result['results'] == []

    @pytest.mark.asyncio
    async def test_count_is_int_zero(self, mock_bot, mock_event):
        """count 字段为 int 0。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert isinstance(result['count'], int)
        assert result['count'] == 0

    @pytest.mark.asyncio
    async def test_error_is_empty_string(self, mock_bot, mock_event):
        """error 字段为空字符串。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert isinstance(result['error'], str)
        assert result['error'] == ''


# =============================================================================
# 参数兼容性
# =============================================================================
class TestParameterCompatibility:
    """验证 parallel_exec handler 接受各种参数（占位 handler 不依赖参数值）。"""

    @pytest.mark.asyncio
    async def test_no_extra_params_required(self, mock_bot, mock_event):
        """parallel_exec 仅需 bot/event 两个固定参数（无业务参数）。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert result['count'] == 0

    @pytest.mark.asyncio
    async def test_ignores_none_bot(self, mock_event):
        """bot=None 不影响占位 handler 返回。"""
        result = await parallel_exec(None, mock_event)
        assert result['count'] == 0

    @pytest.mark.asyncio
    async def test_ignores_none_event(self, mock_bot):
        """event=None 不影响占位 handler 返回。"""
        result = await parallel_exec(mock_bot, None)
        assert result['count'] == 0

    @pytest.mark.asyncio
    async def test_both_none_args(self):
        """bot=event=None 也能正常返回。"""
        result = await parallel_exec(None, None)
        assert result['count'] == 0


# =============================================================================
# interpreter 调度契约
# =============================================================================
class TestInterpreterDispatchContract:
    """验证 parallel_exec 节点在 interpreter 中的调度注册。"""

    def test_parallel_exec_registered_in_terminating_handlers(self):
        """parallel_exec nodeKind 注册在 _CONTROL_FLOW_TERMINATING 映射中。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_TERMINATING
        assert 'parallel_exec' in _CONTROL_FLOW_TERMINATING
        assert _CONTROL_FLOW_TERMINATING['parallel_exec'] == '_exec_parallel'

    def test_parallel_exec_camel_case_compatible(self):
        """parallelExec (camelCase) 也注册以兼容旧 flow.json。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_TERMINATING
        assert 'parallelExec' in _CONTROL_FLOW_TERMINATING
        assert _CONTROL_FLOW_TERMINATING['parallelExec'] == '_exec_parallel'

    def test_parallel_exec_not_in_continuing_handlers(self):
        """parallel_exec 不在 _CONTROL_FLOW_CONTINUING 中。"""
        from qqbat_nodes.runtime.interpreter import _CONTROL_FLOW_CONTINUING
        assert 'parallel_exec' not in _CONTROL_FLOW_CONTINUING

    def test_parallel_exec_dispatched_to_exec_parallel_method(self):
        """parallel_exec 调度目标方法名 _exec_parallel 在 Interpreter 类中存在。"""
        from qqbat_nodes.runtime.interpreter import Interpreter
        assert hasattr(Interpreter, '_exec_parallel')
        assert callable(getattr(Interpreter, '_exec_parallel'))


# =============================================================================
# interpreter 行为契约
# =============================================================================
class TestInterpreterBehaviorContract:
    """验证 parallel_exec handler 返回结构满足 interpreter 期望。

    interpreter._exec_parallel 不直接调用 handler，而是：
    - 解析 config.branches（list of {chain_head, name}）
    - 对每个 chain_head 启动子任务并发执行
    - 用 asyncio.gather(*tasks, return_exceptions=True) 收集结果
    - 异常被捕获为 {"success": False, "error": str(e)}，
      正常为 {"success": True, "error": ""}
    - 输出：{results: [...], count: N, errors: [...], error: "..."}

    handler 仅提供占位返回结构（{results: [], count: 0, error: ''}）
    供 registry 注册。
    """

    @pytest.mark.asyncio
    async def test_handler_returns_empty_results_for_default(self, mock_bot, mock_event):
        """handler 默认返回 results=[]（占位）。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert result['results'] == []

    @pytest.mark.asyncio
    async def test_handler_returns_zero_count_for_default(self, mock_bot, mock_event):
        """handler 默认返回 count=0（占位）。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert result['count'] == 0

    @pytest.mark.asyncio
    async def test_handler_returns_empty_error_for_default(self, mock_bot, mock_event):
        """handler 默认返回 error=''（占位）。"""
        result = await parallel_exec(mock_bot, mock_event)
        assert result['error'] == ''


# =============================================================================
# 稳定性
# =============================================================================
class TestStability:
    """验证 parallel_exec handler 多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_multiple_calls_consistent(self, mock_bot, mock_event):
        """多次调用每次都返回相同占位结构。"""
        for _ in range(5):
            result = await parallel_exec(mock_bot, mock_event)
            assert result == {'results': [], 'count': 0, 'error': ''}

    @pytest.mark.asyncio
    async def test_independent_dict_instances(self, mock_bot, mock_event):
        """每次调用返回独立 dict 对象。"""
        r1 = await parallel_exec(mock_bot, mock_event)
        r2 = await parallel_exec(mock_bot, mock_event)
        assert r1 is not r2
        assert r1 == r2

    @pytest.mark.asyncio
    async def test_independent_results_list_instances(self, mock_bot, mock_event):
        """每次返回的 results 列表是独立对象。"""
        r1 = await parallel_exec(mock_bot, mock_event)
        r2 = await parallel_exec(mock_bot, mock_event)
        assert r1['results'] is not r2['results']


# =============================================================================
# 包结构契约
# =============================================================================
class TestPackageStructure:
    """验证 parallel_exec 模块在 qqbat_nodes.builtin 包中的位置。"""

    def test_module_in_builtin_package(self):
        """parallel_exec 模块属于 qqbat_nodes.builtin 包。"""
        assert parallel_exec_module.__name__ == 'qqbat_nodes.builtin.parallel_exec'

    def test_module_file_exists(self):
        """parallel_exec 模块对应文件存在。"""
        import os
        assert parallel_exec_module.__file__ is not None
        assert os.path.isfile(parallel_exec_module.__file__)
        assert parallel_exec_module.__file__.endswith('parallel_exec.py')

    def test_module_accessible_via_import(self):
        """通过 importlib.import_module 可访问。"""
        import importlib
        mod = importlib.import_module('qqbat_nodes.builtin.parallel_exec')
        assert mod is parallel_exec_module
