"""assert_node 节点单元测试。

被测源码：qqbat_nodes/builtin/assert_node.py

覆盖：
- 条件为 True：返回 passed=True
- 条件为 False：返回 passed=False + 自定义 message
- 字符串条件规范化（'true'/'1'/'yes'/'y' 为 True，其他为 False）
- 非字符串条件用 bool() 转换
- 默认 message='断言失败'
- 默认 condition=False
- 异常容错（condition 规范化抛异常）
- 返回结构完整性
- interpreter 集成契约（passed=False 时中断流程）

返回 dict 结构：
- True: {"passed": True, "error": ""}
- False: {"passed": False, "error": message}
- 异常: {"passed": False, "error": "断言节点异常: {e}"}
"""
import pytest

from qqbat_nodes.builtin.assert_node import assert_node


# =============================================================================
# 布尔条件
# =============================================================================
class TestBooleanCondition:
    """验证布尔类型 condition 的判断。"""

    @pytest.mark.asyncio
    async def test_true_condition_passes(self, mock_bot, mock_event):
        """condition=True → passed=True。"""
        result = await assert_node(mock_bot, mock_event, condition=True)
        assert result['passed'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_false_condition_fails(self, mock_bot, mock_event):
        """condition=False → passed=False + 默认 message。"""
        result = await assert_node(mock_bot, mock_event, condition=False)
        assert result['passed'] is False
        assert result['error'] == '断言失败'

    @pytest.mark.asyncio
    async def test_false_condition_with_custom_message(self, mock_bot, mock_event):
        """condition=False + 自定义 message → error 含自定义消息。"""
        result = await assert_node(
            mock_bot, mock_event, condition=False, message='金币不足',
        )
        assert result['passed'] is False
        assert result['error'] == '金币不足'


# =============================================================================
# 字符串条件规范化
# =============================================================================
class TestStringCondition:
    """验证字符串类型 condition 的规范化（'true'/'1'/'yes'/'y' 为 True）。"""

    @pytest.mark.asyncio
    async def test_string_true_passes(self, mock_bot, mock_event):
        """condition='true' → 规范化为 True。"""
        result = await assert_node(mock_bot, mock_event, condition='true')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_true_uppercase_passes(self, mock_bot, mock_event):
        """condition='TRUE' → 大小写不敏感，规范化为 True。"""
        result = await assert_node(mock_bot, mock_event, condition='TRUE')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_one_passes(self, mock_bot, mock_event):
        """condition='1' → 规范化为 True。"""
        result = await assert_node(mock_bot, mock_event, condition='1')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_yes_passes(self, mock_bot, mock_event):
        """condition='yes' → 规范化为 True。"""
        result = await assert_node(mock_bot, mock_event, condition='yes')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_y_passes(self, mock_bot, mock_event):
        """condition='y' → 规范化为 True。"""
        result = await assert_node(mock_bot, mock_event, condition='y')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_false_fails(self, mock_bot, mock_event):
        """condition='false' → 规范化为 False。"""
        result = await assert_node(mock_bot, mock_event, condition='false')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_string_zero_fails(self, mock_bot, mock_event):
        """condition='0' → 规范化为 False。"""
        result = await assert_node(mock_bot, mock_event, condition='0')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_string_arbitrary_text_fails(self, mock_bot, mock_event):
        """condition='任意文本' → 不在 true 集合中，规范化为 False。"""
        result = await assert_node(mock_bot, mock_event, condition='任意文本')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_string_with_whitespace_stripped(self, mock_bot, mock_event):
        """condition='  true  ' → strip 后 'true' → 规范化为 True。"""
        result = await assert_node(mock_bot, mock_event, condition='  true  ')
        assert result['passed'] is True


# =============================================================================
# 非字符串条件（bool 转换）
# =============================================================================
class TestNonStringCondition:
    """验证非字符串 condition 用 bool() 转换。"""

    @pytest.mark.asyncio
    async def test_int_one_passes(self, mock_bot, mock_event):
        """condition=1 → bool(1)=True。"""
        result = await assert_node(mock_bot, mock_event, condition=1)
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_int_zero_fails(self, mock_bot, mock_event):
        """condition=0 → bool(0)=False。"""
        result = await assert_node(mock_bot, mock_event, condition=0)
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_non_empty_list_passes(self, mock_bot, mock_event):
        """condition=[1] → bool([1])=True。"""
        result = await assert_node(mock_bot, mock_event, condition=[1])
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_empty_list_fails(self, mock_bot, mock_event):
        """condition=[] → bool([])=False。"""
        result = await assert_node(mock_bot, mock_event, condition=[])
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_none_condition_fails(self, mock_bot, mock_event):
        """condition=None → bool(None)=False。"""
        result = await assert_node(mock_bot, mock_event, condition=None)
        assert result['passed'] is False


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaults:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_default_condition_is_false(self, mock_bot, mock_event):
        """不传 condition 时默认为 False → passed=False。"""
        result = await assert_node(mock_bot, mock_event)
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_default_message_is_断言失败(self, mock_bot, mock_event):
        """不传 message 时默认为 '断言失败'。"""
        result = await assert_node(mock_bot, mock_event, condition=False)
        assert result['error'] == '断言失败'

    @pytest.mark.asyncio
    async def test_empty_message(self, mock_bot, mock_event):
        """message='' → error 为空字符串（但仍 passed=False）。"""
        result = await assert_node(
            mock_bot, mock_event, condition=False, message='',
        )
        assert result['passed'] is False
        assert result['error'] == ''


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_passed_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 passed 和 error 两个字段。"""
        result = await assert_node(mock_bot, mock_event, condition=True)
        assert set(result.keys()) == {'passed', 'error'}

    @pytest.mark.asyncio
    async def test_passed_is_bool_type(self, mock_bot, mock_event):
        """passed 字段为 bool 类型。"""
        r1 = await assert_node(mock_bot, mock_event, condition=True)
        assert isinstance(r1['passed'], bool)
        r2 = await assert_node(mock_bot, mock_event, condition=False)
        assert isinstance(r2['passed'], bool)

    @pytest.mark.asyncio
    async def test_error_is_string_type(self, mock_bot, mock_event):
        """error 字段为 str 类型。"""
        result = await assert_node(mock_bot, mock_event, condition=False, message='x')
        assert isinstance(result['error'], str)


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 assert_node 返回结构满足 interpreter 检测契约。

    interpreter._exec_normal_node 中的检测逻辑：
        if isinstance(result, dict) and result.get('passed') is False:
            error_msg = result.get('error', '断言失败')
            raise _ChainReturnSignal(None, error_msg)

    即：result 必须为 dict，且 result['passed'] 严格为 False（不是 falsy 值）。
    """

    @pytest.mark.asyncio
    async def test_passed_false_is_strict_bool(self, mock_bot, mock_event):
        """passed=False 时严格为 bool False（interpreter 用 is False 判断）。"""
        result = await assert_node(mock_bot, mock_event, condition=False)
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_passed_true_not_trigger_chain_return(self, mock_bot, mock_event):
        """passed=True 时不会触发 interpreter 链中断。"""
        result = await assert_node(mock_bot, mock_event, condition=True)
        # interpreter 仅在 passed is False 时中断，True 时继续执行
        assert result['passed'] is not False
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_no_break_or_return_signal(self, mock_bot, mock_event):
        """assert_node 不应误设 _break 或 _return 信号。"""
        result = await assert_node(mock_bot, mock_event, condition=False)
        assert '_break' not in result
        assert '_return' not in result
