"""flow_control 节点单元测试（break/return 二合一）。

覆盖：
- break 模式：返回 _break=True 信号
- return 模式：返回 _return=True + result=value 信号
- value 透传（各类型）
- 返回结构字段完整性
- interpreter 捕获信号的契约验证
- 参数兼容性与稳定性

被测源码：qqbat_nodes/builtin/flow_control.py

设计说明：
- flow_control 是一个「信号节点」，通过 mode 参数切换行为：
  - mode='break'：返回 {"_break": True}（原 break_loop）
  - mode='return'：返回 {"_return": True, "result": value}（原 return_chain）
- interpreter._exec_normal_node 检测信号字段：
  - _break → 设置 __break_loop__ 变量，循环检测后跳出
  - _return → 抛出 _ChainReturnSignal 异常，链执行器捕获后结束
"""
import pytest

from qqbat_nodes.builtin.flow_control import flow_control


# =============================================================================
# break 模式信号契约
# =============================================================================
class TestBreakSignal:
    """验证 flow_control(mode='break') 返回的 _break 信号字段。"""

    @pytest.mark.asyncio
    async def test_break_returns_break_signal(self, mock_bot, mock_event):
        """break 模式默认调用返回 _break=True 信号。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert result.get('_break') is True

    @pytest.mark.asyncio
    async def test_break_field_is_bool_true(self, mock_bot, mock_event):
        """_break 字段为 bool 类型且值为 True。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert result['_break'] is True
        assert isinstance(result['_break'], bool)

    @pytest.mark.asyncio
    async def test_break_signal_not_false(self, mock_bot, mock_event):
        """_break 字段不为 False / None / 缺失。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert result['_break'] is not False
        assert result['_break'] is not None
        assert '_break' in result

    @pytest.mark.asyncio
    async def test_break_default_mode(self, mock_bot, mock_event):
        """不传 mode 时默认为 break 模式。"""
        result = await flow_control(mock_bot, mock_event)
        assert result.get('_break') is True

    @pytest.mark.asyncio
    async def test_break_does_not_set_return_signal(self, mock_bot, mock_event):
        """break 模式不应误设 _return 信号。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert '_return' not in result or result.get('_return') is not True


# =============================================================================
# return 模式信号契约
# =============================================================================
class TestReturnSignal:
    """验证 flow_control(mode='return') 返回的 _return 信号字段。"""

    @pytest.mark.asyncio
    async def test_return_default_returns_signal(self, mock_bot, mock_event):
        """不传 value 时返回 _return=True + result=None。"""
        result = await flow_control(mock_bot, mock_event, mode='return')
        assert result.get('_return') is True
        assert result.get('result') is None

    @pytest.mark.asyncio
    async def test_return_field_is_bool_true(self, mock_bot, mock_event):
        """_return 字段为 bool 类型且值为 True。"""
        result = await flow_control(mock_bot, mock_event, mode='return')
        assert result['_return'] is True
        assert isinstance(result['_return'], bool)

    @pytest.mark.asyncio
    async def test_return_signal_not_false(self, mock_bot, mock_event):
        """_return 字段不为 False / None / 缺失。"""
        result = await flow_control(mock_bot, mock_event, mode='return')
        assert result['_return'] is not False
        assert result['_return'] is not None
        assert '_return' in result

    @pytest.mark.asyncio
    async def test_return_does_not_set_break_signal(self, mock_bot, mock_event):
        """return 模式不应误设 _break 信号。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value='done')
        assert '_break' not in result or result.get('_break') is not True


# =============================================================================
# value 透传（return 模式）
# =============================================================================
class TestValuePassthrough:
    """验证 return 模式透传 value 字段到 result。"""

    @pytest.mark.asyncio
    async def test_int_value(self, mock_bot, mock_event):
        """整数值正确透传。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value=42)
        assert result['result'] == 42
        assert isinstance(result['result'], int)

    @pytest.mark.asyncio
    async def test_string_value(self, mock_bot, mock_event):
        """字符串值正确透传。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value='hello')
        assert result['result'] == 'hello'

    @pytest.mark.asyncio
    async def test_dict_value(self, mock_bot, mock_event):
        """dict 值正确透传（引用保持）。"""
        val = {'code': 200, 'msg': 'ok'}
        result = await flow_control(mock_bot, mock_event, mode='return', value=val)
        assert result['result'] is val
        assert result['result']['code'] == 200

    @pytest.mark.asyncio
    async def test_list_value(self, mock_bot, mock_event):
        """list 值正确透传。"""
        val = [1, 2, 3]
        result = await flow_control(mock_bot, mock_event, mode='return', value=val)
        assert result['result'] is val
        assert result['result'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_bool_true_value(self, mock_bot, mock_event):
        """bool True 值正确透传（区分于 _return=True）。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value=True)
        assert result['result'] is True
        assert result['_return'] is True

    @pytest.mark.asyncio
    async def test_bool_false_value(self, mock_bot, mock_event):
        """bool False 值正确透传（不能被误解为无返回值）。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value=False)
        assert result['result'] is False
        assert result['_return'] is True

    @pytest.mark.asyncio
    async def test_zero_value(self, mock_bot, mock_event):
        """0 值正确透传（区分于 None）。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value=0)
        assert result['result'] == 0
        assert result['result'] is not None

    @pytest.mark.asyncio
    async def test_none_value_explicit(self, mock_bot, mock_event):
        """显式传 value=None 等价于默认值。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value=None)
        assert result['result'] is None
        assert result['_return'] is True


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_break_has_break_field_only(self, mock_bot, mock_event):
        """break 模式返回 dict 仅含 _break 字段。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert set(result.keys()) == {'_break'}

    @pytest.mark.asyncio
    async def test_return_has_required_fields(self, mock_bot, mock_event):
        """return 模式返回 dict 含 _return 与 result 两个键。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value=1)
        assert set(result.keys()) == {'_return', 'result'}

    @pytest.mark.asyncio
    async def test_return_is_dict(self, mock_bot, mock_event):
        """返回值必须为 dict。"""
        result = await flow_control(mock_bot, mock_event, mode='return')
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_break_is_dict(self, mock_bot, mock_event):
        """返回值必须为 dict。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert isinstance(result, dict)


# =============================================================================
# 参数兼容性
# =============================================================================
class TestParameterCompatibility:
    """验证 flow_control 对参数的兼容性。"""

    @pytest.mark.asyncio
    async def test_break_ignores_none_event(self, mock_bot):
        """break 模式 event=None 也能正常返回信号。"""
        result = await flow_control(mock_bot, None, mode='break')
        assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_break_ignores_none_bot(self, mock_event):
        """break 模式 bot=None 也能正常返回信号。"""
        result = await flow_control(None, mock_event, mode='break')
        assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_return_ignores_none_event(self, mock_bot):
        """return 模式 event=None 也能正常返回信号。"""
        result = await flow_control(mock_bot, None, mode='return', value='ok')
        assert result['_return'] is True
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_return_ignores_none_bot(self, mock_event):
        """return 模式 bot=None 也能正常返回信号。"""
        result = await flow_control(None, mock_event, mode='return', value='ok')
        assert result['_return'] is True

    @pytest.mark.asyncio
    async def test_both_none_args_break(self):
        """break 模式 bot=event=None 也能正常返回信号。"""
        result = await flow_control(None, None, mode='break')
        assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_both_none_args_return(self):
        """return 模式 bot=event=None 也能正常返回信号。"""
        result = await flow_control(None, None, mode='return')
        assert result['_return'] is True


# =============================================================================
# 稳定性
# =============================================================================
class TestStability:
    """验证 flow_control 多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_break_multiple_calls_consistent(self, mock_bot, mock_event):
        """break 模式多次调用每次都返回 _break=True。"""
        for _ in range(5):
            result = await flow_control(mock_bot, mock_event, mode='break')
            assert result['_break'] is True

    @pytest.mark.asyncio
    async def test_return_multiple_calls_consistent(self, mock_bot, mock_event):
        """return 模式多次调用每次都返回 _return=True。"""
        for i in range(5):
            result = await flow_control(mock_bot, mock_event, mode='return', value=i)
            assert result['_return'] is True
            assert result['result'] == i

    @pytest.mark.asyncio
    async def test_independent_dict_instances(self, mock_bot, mock_event):
        """每次调用返回独立 dict 对象。"""
        r1 = await flow_control(mock_bot, mock_event, mode='break')
        r2 = await flow_control(mock_bot, mock_event, mode='break')
        assert r1 is not r2
        assert r1 == r2


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 flow_control 返回结构满足 interpreter 检测契约。

    interpreter._exec_normal_node 中的检测逻辑：
        if isinstance(result, dict) and result.get('_break'):
            ctx.variables["__break_loop__"] = True
            return
        if isinstance(result, dict) and result.get('_return'):
            raise _ChainReturnSignal(result.get('result'))
    """

    @pytest.mark.asyncio
    async def test_break_meets_interpreter_contract(self, mock_bot, mock_event):
        """break 模式返回值满足 interpreter 的 _break 信号检测契约。"""
        result = await flow_control(mock_bot, mock_event, mode='break')
        assert isinstance(result, dict)
        assert bool(result.get('_break')) is True

    @pytest.mark.asyncio
    async def test_return_meets_interpreter_contract(self, mock_bot, mock_event):
        """return 模式返回值满足 interpreter 的 _return 信号检测契约。"""
        result = await flow_control(mock_bot, mock_event, mode='return', value='done')
        assert isinstance(result, dict)
        assert bool(result.get('_return')) is True
        assert 'result' in result
