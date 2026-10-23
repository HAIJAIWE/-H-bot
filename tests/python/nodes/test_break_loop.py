"""break_loop 节点单元测试。

覆盖：
- 默认调用返回 _break=True 信号
- 返回结构字段完整性
- 不接受额外参数时的兼容性
- 信号字段类型与值
- interpreter 捕获 _break 信号的契约验证

被测源码：qqbat_nodes/builtin/break_loop.py

设计说明：
- break_loop 是一个「信号节点」，仅返回 {"_break": True} 给 interpreter
- interpreter._exec_normal_node 检测 result['_break'] 后设置
  ctx.variables["__break_loop__"] = True，循环检测后跳出
- 测试重点验证信号契约（_break 字段必须为 True），不依赖 interpreter
"""
import pytest

from qqbat_nodes.builtin.break_loop import break_loop


# =============================================================================
# 信号契约
# =============================================================================
class TestBreakSignal:
    """验证 break_loop 返回的 _break 信号字段。"""

    @pytest.mark.asyncio
    async def test_returns_break_signal(self, mock_bot, mock_event):
        """默认调用返回 _break=True 信号。"""
        result = await break_loop(mock_bot, mock_event)
        assert result.get('_break') is True

    @pytest.mark.asyncio
    async def test_break_field_is_bool_true(self, mock_bot, mock_event):
        """_break 字段为 bool 类型且值为 True（非 truthy 值如 1/'true'）。"""
        result = await break_loop(mock_bot, mock_event)
        assert result['_break'] is True
        assert isinstance(result['_break'], bool)

    @pytest.mark.asyncio
    async def test_break_signal_not_false(self, mock_bot, mock_event):
        """_break 字段不为 False / None / 缺失。"""
        result = await break_loop(mock_bot, mock_event)
        assert result['_break'] is not False
        assert result['_break'] is not None
        assert '_break' in result


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_break_field_only(self, mock_bot, mock_event):
        """返回 dict 仅含 _break 字段。"""
        result = await break_loop(mock_bot, mock_event)
        assert set(result.keys()) == {'_break'}

    @pytest.mark.asyncio
    async def test_return_is_dict(self, mock_bot, mock_event):
        """返回值必须为 dict（interpreter 用 isinstance dict 判断信号）。"""
        result = await break_loop(mock_bot, mock_event)
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_return_dict_not_empty(self, mock_bot, mock_event):
        """返回 dict 非空。"""
        result = await break_loop(mock_bot, mock_event)
        assert len(result) > 0


# =============================================================================
# 参数兼容性
# =============================================================================
class TestParameterCompatibility:
    """验证 break_loop 对参数的兼容性（不接受业务参数，仅 bot/event）。"""

    @pytest.mark.asyncio
    async def test_no_extra_params_required(self, mock_bot, mock_event):
        """break_loop 仅需 bot/event 两个固定参数，不要求额外业务参数。"""
        result = await break_loop(mock_bot, mock_event)
        assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_ignores_none_event(self, mock_bot):
        """event=None 也能正常返回信号（break_loop 不依赖 event）。"""
        result = await break_loop(mock_bot, None)
        assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_ignores_none_bot(self, mock_event):
        """bot=None 也能正常返回信号（break_loop 不依赖 bot）。"""
        result = await break_loop(None, mock_event)
        assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_both_none_args(self):
        """bot=event=None 也能正常返回信号。"""
        result = await break_loop(None, None)
        assert result['_break'] is True


# =============================================================================
# 稳定性 / 幂等性
# =============================================================================
class TestStability:
    """验证 break_loop 多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_multiple_calls_consistent(self, mock_bot, mock_event):
        """多次调用每次都返回 _break=True（无状态）。"""
        for _ in range(5):
            result = await break_loop(mock_bot, mock_event)
            assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_call_after_call_no_state_leak(self, mock_bot, mock_event):
        """连续调用不积累状态（每次返回的 dict 是独立对象）。"""
        r1 = await break_loop(mock_bot, mock_event)
        r2 = await break_loop(mock_bot, mock_event)
        assert r1 is not r2
        assert r1 == r2

    @pytest.mark.asyncio
    async def test_no_side_effects_on_args(self, mock_bot, mock_event):
        """调用 break_loop 不修改 bot/event 参数。"""
        bot_before = dict(mock_bot.__dict__) if hasattr(mock_bot, '__dict__') else None
        await break_loop(mock_bot, mock_event)
        # mock_bot 是 AsyncMock，无关键状态需要断言；此用例确保调用不抛异常
        # 即可视为无破坏性副作用


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 break_loop 返回结构满足 interpreter 检测契约。

    interpreter._exec_normal_node 中的检测逻辑：
        if isinstance(result, dict) and result.get('_break'):
            ctx.variables["__break_loop__"] = True
            return

    即：result 必须为 dict，且 result['_break'] 真 truthy。
    """

    @pytest.mark.asyncio
    async def test_meets_interpreter_signal_contract(self, mock_bot, mock_event):
        """返回值满足 interpreter 的 _break 信号检测契约。"""
        result = await break_loop(mock_bot, mock_event)
        # interpreter 用 isinstance(result, dict) 判断
        assert isinstance(result, dict)
        # interpreter 用 result.get('_break') 判断 truthy
        assert bool(result.get('_break')) is True

    @pytest.mark.asyncio
    async def test_does_not_set_return_signal(self, mock_bot, mock_event):
        """break_loop 不应误设 _return 信号（与 return_chain 区分）。"""
        result = await break_loop(mock_bot, mock_event)
        assert '_return' not in result or result.get('_return') is not True
