"""error_op 节点单元测试 — 统一错误操作（throw/assert 二合一）。

覆盖：
- 模块结构：BusinessError 类定义、handler 异步性
- throw 模式：抛出 BusinessError、默认/自定义/空消息、类型容错
- assert 模式：条件为 True/False、字符串条件规范化、非字符串条件 bool 转换
- 默认参数：mode='assert'、condition=False、message='断言失败'
- 返回结构完整性：passed/error 字段类型
- interpreter 集成契约：passed=False 严格 bool、无 _break/_return 信号

被测源码：qqbat_nodes/builtin/error_op.py
"""
import inspect

import pytest

from qqbat_nodes.builtin.error_op import BusinessError, error_op


# =============================================================================
# 模块结构
# =============================================================================
class TestModuleStructure:
    """验证 error_op 模块结构。"""

    def test_module_importable(self):
        """error_op 模块可正常导入。"""
        import qqbat_nodes.builtin.error_op as mod
        assert mod is not None

    def test_business_error_defined(self):
        """模块定义了 BusinessError 异常类。"""
        assert BusinessError is not None
        assert isinstance(BusinessError, type)

    def test_business_error_is_exception(self):
        """BusinessError 必须是 Exception 的子类。"""
        assert issubclass(BusinessError, Exception)

    def test_handler_is_async(self):
        """error_op handler 是协程函数。"""
        assert callable(error_op)
        assert inspect.iscoroutinefunction(error_op)


# =============================================================================
# throw 模式：抛出异常
# =============================================================================
class TestThrowMode:
    """验证 mode='throw' 抛出异常的行为。"""

    @pytest.mark.asyncio
    async def test_raises_business_error(self, mock_bot, mock_event):
        """mode='throw' 必须抛出 BusinessError。"""
        with pytest.raises(BusinessError):
            await error_op(mock_bot, mock_event, mode='throw', message='测试错误')

    @pytest.mark.asyncio
    async def test_default_message(self, mock_bot, mock_event):
        """不传 message 时使用函数签名默认值'断言失败'。"""
        with pytest.raises(BusinessError) as exc_info:
            await error_op(mock_bot, mock_event, mode='throw')
        assert str(exc_info.value) == '断言失败'

    @pytest.mark.asyncio
    async def test_custom_message(self, mock_bot, mock_event):
        """自定义 message 被原样传入异常。"""
        with pytest.raises(BusinessError) as exc_info:
            await error_op(mock_bot, mock_event, mode='throw', message='金币不足')
        assert str(exc_info.value) == '金币不足'

    @pytest.mark.asyncio
    async def test_empty_message_falls_back(self, mock_bot, mock_event):
        """空字符串 message 回退到默认值'业务异常'。"""
        with pytest.raises(BusinessError) as exc_info:
            await error_op(mock_bot, mock_event, mode='throw', message='')
        assert str(exc_info.value) == '业务异常'

    @pytest.mark.asyncio
    async def test_int_message_coerced(self, mock_bot, mock_event):
        """整数 message 被 str() 转为字符串。"""
        with pytest.raises(BusinessError) as exc_info:
            await error_op(mock_bot, mock_event, mode='throw', message=404)
        assert str(exc_info.value) == '404'

    @pytest.mark.asyncio
    async def test_none_message_falls_back(self, mock_bot, mock_event):
        """None message 回退到默认值（None 为 falsy）。"""
        with pytest.raises(BusinessError) as exc_info:
            await error_op(mock_bot, mock_event, mode='throw', message=None)
        assert str(exc_info.value) == '业务异常'


# =============================================================================
# assert 模式：布尔条件
# =============================================================================
class TestAssertBooleanCondition:
    """验证 assert 模式布尔类型 condition 的判断。"""

    @pytest.mark.asyncio
    async def test_true_condition_passes(self, mock_bot, mock_event):
        """condition=True → passed=True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=True)
        assert result['passed'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_false_condition_fails(self, mock_bot, mock_event):
        """condition=False → passed=False + 默认 message。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=False)
        assert result['passed'] is False
        assert result['error'] == '断言失败'

    @pytest.mark.asyncio
    async def test_false_condition_with_custom_message(self, mock_bot, mock_event):
        """condition=False + 自定义 message → error 含自定义消息。"""
        result = await error_op(
            mock_bot, mock_event, mode='assert', condition=False, message='金币不足',
        )
        assert result['passed'] is False
        assert result['error'] == '金币不足'


# =============================================================================
# assert 模式：字符串条件规范化
# =============================================================================
class TestAssertStringCondition:
    """验证 assert 模式字符串类型 condition 的规范化。"""

    @pytest.mark.asyncio
    async def test_string_true_passes(self, mock_bot, mock_event):
        """condition='true' → 规范化为 True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='true')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_true_uppercase_passes(self, mock_bot, mock_event):
        """condition='TRUE' → 大小写不敏感，规范化为 True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='TRUE')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_one_passes(self, mock_bot, mock_event):
        """condition='1' → 规范化为 True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='1')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_yes_passes(self, mock_bot, mock_event):
        """condition='yes' → 规范化为 True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='yes')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_y_passes(self, mock_bot, mock_event):
        """condition='y' → 规范化为 True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='y')
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_string_false_fails(self, mock_bot, mock_event):
        """condition='false' → 规范化为 False。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='false')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_string_zero_fails(self, mock_bot, mock_event):
        """condition='0' → 规范化为 False。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='0')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_string_arbitrary_text_fails(self, mock_bot, mock_event):
        """condition='任意文本' → 不在 true 集合中，规范化为 False。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='任意文本')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_string_with_whitespace_stripped(self, mock_bot, mock_event):
        """condition='  true  ' → strip 后 'true' → 规范化为 True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition='  true  ')
        assert result['passed'] is True


# =============================================================================
# assert 模式：非字符串条件（bool 转换）
# =============================================================================
class TestAssertNonStringCondition:
    """验证 assert 模式非字符串 condition 用 bool() 转换。"""

    @pytest.mark.asyncio
    async def test_int_one_passes(self, mock_bot, mock_event):
        """condition=1 → bool(1)=True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=1)
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_int_zero_fails(self, mock_bot, mock_event):
        """condition=0 → bool(0)=False。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=0)
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_non_empty_list_passes(self, mock_bot, mock_event):
        """condition=[1] → bool([1])=True。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=[1])
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_empty_list_fails(self, mock_bot, mock_event):
        """condition=[] → bool([])=False。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=[])
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_none_condition_fails(self, mock_bot, mock_event):
        """condition=None → bool(None)=False。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=None)
        assert result['passed'] is False


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaults:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_default_mode_is_assert(self, mock_bot, mock_event):
        """不传 mode 时默认为 'assert'。"""
        result = await error_op(mock_bot, mock_event, condition=True)
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_default_condition_is_false(self, mock_bot, mock_event):
        """不传 condition 时默认为 False → passed=False。"""
        result = await error_op(mock_bot, mock_event, mode='assert')
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_default_message_is_断言失败(self, mock_bot, mock_event):
        """不传 message 时默认为 '断言失败'。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=False)
        assert result['error'] == '断言失败'

    @pytest.mark.asyncio
    async def test_empty_message(self, mock_bot, mock_event):
        """message='' → error 为空字符串（但仍 passed=False）。"""
        result = await error_op(
            mock_bot, mock_event, mode='assert', condition=False, message='',
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
        result = await error_op(mock_bot, mock_event, mode='assert', condition=True)
        assert set(result.keys()) == {'passed', 'error'}

    @pytest.mark.asyncio
    async def test_passed_is_bool_type(self, mock_bot, mock_event):
        """passed 字段为 bool 类型。"""
        r1 = await error_op(mock_bot, mock_event, mode='assert', condition=True)
        assert isinstance(r1['passed'], bool)
        r2 = await error_op(mock_bot, mock_event, mode='assert', condition=False)
        assert isinstance(r2['passed'], bool)

    @pytest.mark.asyncio
    async def test_error_is_string_type(self, mock_bot, mock_event):
        """error 字段为 str 类型。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=False, message='x')
        assert isinstance(result['error'], str)


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 error_op 返回结构满足 interpreter 检测契约。

    interpreter._exec_normal_node 中的检测逻辑：
        if isinstance(result, dict) and result.get('passed') is False:
            error_msg = result.get('error', '断言失败')
            raise _ChainReturnSignal(None, error_msg)

    即：result 必须为 dict，且 result['passed'] 严格为 False（不是 falsy 值）。
    """

    @pytest.mark.asyncio
    async def test_passed_false_is_strict_bool(self, mock_bot, mock_event):
        """passed=False 时严格为 bool False（interpreter 用 is False 判断）。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=False)
        assert result['passed'] is False

    @pytest.mark.asyncio
    async def test_passed_true_not_trigger_chain_return(self, mock_bot, mock_event):
        """passed=True 时不会触发 interpreter 链中断。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=True)
        assert result['passed'] is not False
        assert result['passed'] is True

    @pytest.mark.asyncio
    async def test_no_break_or_return_signal(self, mock_bot, mock_event):
        """error_op(assert) 不应误设 _break 或 _return 信号。"""
        result = await error_op(mock_bot, mock_event, mode='assert', condition=False)
        assert '_break' not in result
        assert '_return' not in result
