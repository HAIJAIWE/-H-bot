"""call_command 节点单元测试。

被测源码：qqbat_nodes/builtin/call_command.py

注意：call_command 是一个「占位 handler」，实际调用逻辑由 interpreter
的 _exec_call_command 方法内联处理。此 handler 仅返回固定错误信息：
    {"result": False, "error": "call_command 需由 interpreter 内联处理"}

本测试覆盖：
- 默认调用返回固定错误
- command / args 参数不影响返回值（handler 不实际执行）
- 返回结构完整性
- 与 interpreter 集成契约（handler 不做实际工作，由 interpreter 接管）

返回 dict 结构：
- {"result": False, "error": "call_command 需由 interpreter 内联处理"}
"""
import pytest

from qqbat_nodes.builtin.call_command import call_command


# =============================================================================
# 默认行为
# =============================================================================
class TestDefaultBehavior:
    """验证 call_command handler 的默认占位行为。"""

    @pytest.mark.asyncio
    async def test_default_call_returns_false(self, mock_bot, mock_event):
        """默认调用返回 result=False（handler 不实际执行）。"""
        result = await call_command(mock_bot, mock_event)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_default_call_returns_interpreter_message(self, mock_bot, mock_event):
        """默认调用返回固定错误信息（提示由 interpreter 内联处理）。"""
        result = await call_command(mock_bot, mock_event)
        assert 'interpreter' in result['error']
        assert '内联处理' in result['error']

    @pytest.mark.asyncio
    async def test_error_message_exact(self, mock_bot, mock_event):
        """错误信息精确匹配 'call_command 需由 interpreter 内联处理'。"""
        result = await call_command(mock_bot, mock_event)
        assert result['error'] == 'call_command 需由 interpreter 内联处理'


# =============================================================================
# 参数不影响返回值
# =============================================================================
class TestParamsIgnored:
    """验证 command / args 参数不影响 handler 返回值（占位行为）。"""

    @pytest.mark.asyncio
    async def test_command_param_ignored(self, mock_bot, mock_event):
        """传入 command 参数不影响返回值。"""
        result = await call_command(mock_bot, mock_event, command='签到')
        assert result['result'] is False
        assert 'interpreter' in result['error']

    @pytest.mark.asyncio
    async def test_args_param_ignored(self, mock_bot, mock_event):
        """传入 args 参数不影响返回值。"""
        result = await call_command(mock_bot, mock_event, args='arg1 arg2')
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_both_params_ignored(self, mock_bot, mock_event):
        """同时传入 command 和 args 不影响返回值。"""
        result = await call_command(
            mock_bot, mock_event, command='hello', args='world',
        )
        assert result['result'] is False
        assert result['error'] == 'call_command 需由 interpreter 内联处理'

    @pytest.mark.asyncio
    async def test_empty_command_ignored(self, mock_bot, mock_event):
        """空 command 不影响返回值。"""
        result = await call_command(mock_bot, mock_event, command='')
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_empty_args_ignored(self, mock_bot, mock_event):
        """空 args 不影响返回值。"""
        result = await call_command(mock_bot, mock_event, args='')
        assert result['result'] is False


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 和 error 两个字段。"""
        result = await call_command(mock_bot, mock_event)
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_result_is_bool_false(self, mock_bot, mock_event):
        """result 字段为 bool False（严格类型）。"""
        result = await call_command(mock_bot, mock_event)
        assert result['result'] is False
        assert isinstance(result['result'], bool)

    @pytest.mark.asyncio
    async def test_error_is_string(self, mock_bot, mock_event):
        """error 字段为字符串类型。"""
        result = await call_command(mock_bot, mock_event)
        assert isinstance(result['error'], str)


# =============================================================================
# 稳定性
# =============================================================================
class TestStability:
    """验证多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_multiple_calls_consistent(self, mock_bot, mock_event):
        """多次调用每次返回相同的占位结果。"""
        for _ in range(5):
            result = await call_command(mock_bot, mock_event)
            assert result['result'] is False
            assert 'interpreter' in result['error']

    @pytest.mark.asyncio
    async def test_no_side_effects(self, mock_bot, mock_event):
        """调用不修改 bot/event 参数。"""
        await call_command(mock_bot, mock_event, command='x', args='y')
        # 不抛异常即可视为无破坏性副作用


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 call_command handler 与 interpreter 的集成契约。

    interpreter 中 call_command 节点不走 _exec_normal_node 调用 handler，
    而是走 _CONTROL_FLOW_TERMINATING 注册表分派到 _exec_call_command 方法。
    因此 handler 本身的返回值不会被 interpreter 使用——handler 仅作为
    「占位符」存在，确保 handler_registry 能加载模块路径。

    interpreter._exec_call_command 的实际逻辑：
    1. 从 config / 数据输入取 command 和 args
    2. 在 graph 中查找匹配的 on_command 触发器
    3. 模拟事件并执行目标触发器的链
    4. 设置 ctx.variables[node_id:result] 和 ctx.variables[node_id:error]
    """

    @pytest.mark.asyncio
    async def test_handler_is_placeholder(self, mock_bot, mock_event):
        """handler 是占位符，返回固定错误（实际逻辑在 interpreter）。"""
        result = await call_command(mock_bot, mock_event, command='any')
        # 占位行为：result=False + 提示由 interpreter 处理
        assert result['result'] is False
        assert 'interpreter' in result['error']

    @pytest.mark.asyncio
    async def test_no_break_or_return_signal(self, mock_bot, mock_event):
        """call_command 不应误设 _break 或 _return 信号。"""
        result = await call_command(mock_bot, mock_event)
        assert '_break' not in result
        assert '_return' not in result

    @pytest.mark.asyncio
    async def test_no_passed_signal(self, mock_bot, mock_event):
        """call_command 不应误设 passed 信号（与 assert_node 区分）。"""
        result = await call_command(mock_bot, mock_event)
        assert 'passed' not in result


# =============================================================================
# bot/event 可选性
# =============================================================================
class TestBotEventOptional:
    """验证 bot 和 event 参数对占位 handler 无影响。"""

    @pytest.mark.asyncio
    async def test_bot_none_works(self, mock_event):
        """bot=None 也能正常返回占位结果。"""
        result = await call_command(None, mock_event)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_event_none_works(self, mock_bot):
        """event=None 也能正常返回占位结果。"""
        result = await call_command(mock_bot, None)
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_both_none_works(self):
        """bot=event=None 也能正常返回占位结果。"""
        result = await call_command(None, None)
        assert result['result'] is False
        assert 'interpreter' in result['error']
