"""return_chain 节点单元测试。

覆盖：
- 默认 value=None 返回 _return=True + result=None
- 各种 value 类型（int/str/dict/list/bool/None）
- 返回结构字段完整性
- interpreter 捕获 _return 信号的契约验证
- 不接受额外参数时的兼容性
- 多次调用稳定性

被测源码：qqbat_nodes/builtin/return_chain.py

设计说明：
- return_chain 是一个「信号节点」，返回 {"_return": True, "result": value}
- interpreter._exec_normal_node 检测 result['_return'] 后
  raise _ChainReturnSignal(result.get('result')) 提前结束链
- 测试重点验证信号契约（_return 必须为 True）和 value 透传
"""
import pytest

from qqbat_nodes.builtin.return_chain import return_chain


# =============================================================================
# 信号契约
# =============================================================================
class TestReturnSignal:
    """验证 return_chain 返回的 _return 信号字段。"""

    @pytest.mark.asyncio
    async def test_default_returns_return_signal(self, mock_bot, mock_event):
        """不传 value 时返回 _return=True + result=None。"""
        result = await return_chain(mock_bot, mock_event)
        assert result.get('_return') is True
        assert result.get('result') is None

    @pytest.mark.asyncio
    async def test_return_field_is_bool_true(self, mock_bot, mock_event):
        """_return 字段为 bool 类型且值为 True。"""
        result = await return_chain(mock_bot, mock_event)
        assert result['_return'] is True
        assert isinstance(result['_return'], bool)

    @pytest.mark.asyncio
    async def test_return_signal_not_false(self, mock_bot, mock_event):
        """_return 字段不为 False / None / 缺失。"""
        result = await return_chain(mock_bot, mock_event)
        assert result['_return'] is not False
        assert result['_return'] is not None
        assert '_return' in result


# =============================================================================
# value 透传（各类型）
# =============================================================================
class TestValuePassthrough:
    """验证 return_chain 透传 value 字段到 result。"""

    @pytest.mark.asyncio
    async def test_int_value(self, mock_bot, mock_event):
        """整数值正确透传。"""
        result = await return_chain(mock_bot, mock_event, value=42)
        assert result['result'] == 42
        assert isinstance(result['result'], int)

    @pytest.mark.asyncio
    async def test_string_value(self, mock_bot, mock_event):
        """字符串值正确透传。"""
        result = await return_chain(mock_bot, mock_event, value='hello')
        assert result['result'] == 'hello'

    @pytest.mark.asyncio
    async def test_dict_value(self, mock_bot, mock_event):
        """dict 值正确透传（引用保持）。"""
        val = {'code': 200, 'msg': 'ok'}
        result = await return_chain(mock_bot, mock_event, value=val)
        assert result['result'] is val
        assert result['result']['code'] == 200

    @pytest.mark.asyncio
    async def test_list_value(self, mock_bot, mock_event):
        """list 值正确透传。"""
        val = [1, 2, 3]
        result = await return_chain(mock_bot, mock_event, value=val)
        assert result['result'] is val
        assert result['result'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_bool_true_value(self, mock_bot, mock_event):
        """bool True 值正确透传（区分于 _return=True）。"""
        result = await return_chain(mock_bot, mock_event, value=True)
        assert result['result'] is True
        assert result['_return'] is True  # 两者独立

    @pytest.mark.asyncio
    async def test_bool_false_value(self, mock_bot, mock_event):
        """bool False 值正确透传（不能被误解为无返回值）。"""
        result = await return_chain(mock_bot, mock_event, value=False)
        assert result['result'] is False
        assert result['_return'] is True  # 信号仍然为 True

    @pytest.mark.asyncio
    async def test_zero_value(self, mock_bot, mock_event):
        """0 值正确透传（区分于 None）。"""
        result = await return_chain(mock_bot, mock_event, value=0)
        assert result['result'] == 0
        assert result['result'] is not None

    @pytest.mark.asyncio
    async def test_empty_string_value(self, mock_bot, mock_event):
        """空字符串值正确透传。"""
        result = await return_chain(mock_bot, mock_event, value='')
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_none_value_explicit(self, mock_bot, mock_event):
        """显式传 value=None 等价于默认值。"""
        result = await return_chain(mock_bot, mock_event, value=None)
        assert result['result'] is None
        assert result['_return'] is True

    @pytest.mark.asyncio
    async def test_nested_complex_value(self, mock_bot, mock_event):
        """嵌套复杂结构正确透传。"""
        val = {'users': [{'id': 1, 'name': 'a'}, {'id': 2, 'name': 'b'}], 'total': 2}
        result = await return_chain(mock_bot, mock_event, value=val)
        assert result['result'] == val
        assert result['result']['users'][0]['id'] == 1


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_required_fields(self, mock_bot, mock_event):
        """返回 dict 含 _return 与 result 两个键。"""
        result = await return_chain(mock_bot, mock_event, value=1)
        assert set(result.keys()) == {'_return', 'result'}

    @pytest.mark.asyncio
    async def test_return_is_dict(self, mock_bot, mock_event):
        """返回值必须为 dict。"""
        result = await return_chain(mock_bot, mock_event)
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_default_structure(self, mock_bot, mock_event):
        """无 value 时返回 {_return: True, result: None}。"""
        result = await return_chain(mock_bot, mock_event)
        assert result == {'_return': True, 'result': None}


# =============================================================================
# 参数兼容性
# =============================================================================
class TestParameterCompatibility:
    """验证 return_chain 对参数的兼容性。"""

    @pytest.mark.asyncio
    async def test_ignores_none_event(self, mock_bot):
        """event=None 也能正常返回信号。"""
        result = await return_chain(mock_bot, None, value='ok')
        assert result['_return'] is True
        assert result['result'] == 'ok'

    @pytest.mark.asyncio
    async def test_ignores_none_bot(self, mock_event):
        """bot=None 也能正常返回信号。"""
        result = await return_chain(None, mock_event, value='ok')
        assert result['_return'] is True

    @pytest.mark.asyncio
    async def test_both_none_args(self):
        """bot=event=None 也能正常返回信号。"""
        result = await return_chain(None, None)
        assert result['_return'] is True


# =============================================================================
# 稳定性
# =============================================================================
class TestStability:
    """验证 return_chain 多次调用行为一致。"""

    @pytest.mark.asyncio
    async def test_multiple_calls_consistent(self, mock_bot, mock_event):
        """多次调用每次都返回 _return=True。"""
        for i in range(5):
            result = await return_chain(mock_bot, mock_event, value=i)
            assert result['_return'] is True
            assert result['result'] == i

    @pytest.mark.asyncio
    async def test_independent_dict_instances(self, mock_bot, mock_event):
        """每次调用返回独立 dict 对象。"""
        r1 = await return_chain(mock_bot, mock_event, value=1)
        r2 = await return_chain(mock_bot, mock_event, value=2)
        assert r1 is not r2
        assert r1['result'] == 1
        assert r2['result'] == 2


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 return_chain 返回结构满足 interpreter 检测契约。

    interpreter._exec_normal_node 中的检测逻辑：
        if isinstance(result, dict) and result.get('_return'):
            ctx.variables["__chain_return__"] = result.get('result')
            raise _ChainReturnSignal(result.get('result'))

    即：result 必须为 dict，_return 真 truthy，result 字段透传给信号。
    """

    @pytest.mark.asyncio
    async def test_meets_interpreter_signal_contract(self, mock_bot, mock_event):
        """返回值满足 interpreter 的 _return 信号检测契约。"""
        result = await return_chain(mock_bot, mock_event, value='done')
        assert isinstance(result, dict)
        assert bool(result.get('_return')) is True
        assert 'result' in result

    @pytest.mark.asyncio
    async def test_does_not_set_break_signal(self, mock_bot, mock_event):
        """return_chain 不应误设 _break 信号（与 break_loop 区分）。"""
        result = await return_chain(mock_bot, mock_event, value='done')
        assert '_break' not in result or result.get('_break') is not True
