"""set_variable 节点单元测试。

覆盖：
- 各种类型的值赋值（int/str/float/bool/list/dict/None）
- 变量名默认值与自定义
- 返回结构字段完整性（result/var_name/error）
- 跨节点共享语义验证（返回值由 interpreter 注入上下文）

被测源码：qqbat_nodes/builtin/set_variable.py

注：set_variable 是纯函数式节点，无副作用、无持久化调用，
    所有逻辑只是把入参打包成返回结构，由 interpreter 注入到 ctx.variables。
"""
import pytest

from qqbat_nodes.builtin.set_variable import set_variable


# =============================================================================
# 基础赋值
# =============================================================================
class TestBasicAssignment:
    """验证各种类型值的赋值。"""

    @pytest.mark.asyncio
    async def test_assign_integer(self, mock_bot, mock_event):
        """整数赋值：result=100, var_name='x'。"""
        result = await set_variable(mock_bot, mock_event, value=100, var_name='x')
        assert result['result'] == 100
        assert result['var_name'] == 'x'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_assign_string(self, mock_bot, mock_event):
        """字符串赋值。"""
        result = await set_variable(
            mock_bot, mock_event, value='hello world', var_name='msg',
        )
        assert result['result'] == 'hello world'
        assert result['var_name'] == 'msg'

    @pytest.mark.asyncio
    async def test_assign_float(self, mock_bot, mock_event):
        """浮点数赋值。"""
        result = await set_variable(
            mock_bot, mock_event, value=3.14159, var_name='pi',
        )
        assert result['result'] == 3.14159
        assert result['var_name'] == 'pi'

    @pytest.mark.asyncio
    async def test_assign_boolean_true(self, mock_bot, mock_event):
        """布尔 True 赋值。"""
        result = await set_variable(
            mock_bot, mock_event, value=True, var_name='flag',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_assign_boolean_false(self, mock_bot, mock_event):
        """布尔 False 赋值。"""
        result = await set_variable(
            mock_bot, mock_event, value=False, var_name='flag',
        )
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_assign_none(self, mock_bot, mock_event):
        """None 赋值（显式传 None）。"""
        result = await set_variable(
            mock_bot, mock_event, value=None, var_name='empty',
        )
        assert result['result'] is None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_assign_list(self, mock_bot, mock_event):
        """列表赋值。"""
        val = [1, 2, 3, 'four']
        result = await set_variable(
            mock_bot, mock_event, value=val, var_name='items',
        )
        assert result['result'] == [1, 2, 3, 'four']
        assert result['result'] is val  # 应为同一对象引用

    @pytest.mark.asyncio
    async def test_assign_dict(self, mock_bot, mock_event):
        """字典赋值。"""
        val = {'hp': 100, 'mp': 50}
        result = await set_variable(
            mock_bot, mock_event, value=val, var_name='stats',
        )
        assert result['result'] == {'hp': 100, 'mp': 50}

    @pytest.mark.asyncio
    async def test_assign_nested_structure(self, mock_bot, mock_event):
        """嵌套结构赋值（list 内含 dict）。"""
        val = [{'name': 'a'}, {'name': 'b'}]
        result = await set_variable(
            mock_bot, mock_event, value=val, var_name='complex',
        )
        assert result['result'] == [{'name': 'a'}, {'name': 'b'}]

    @pytest.mark.asyncio
    async def test_assign_zero(self, mock_bot, mock_event):
        """0 赋值（边界值，确保不被当作 falsy 误处理）。"""
        result = await set_variable(
            mock_bot, mock_event, value=0, var_name='zero',
        )
        assert result['result'] == 0
        assert result['result'] is not None

    @pytest.mark.asyncio
    async def test_assign_empty_string(self, mock_bot, mock_event):
        """空字符串赋值（边界值）。"""
        result = await set_variable(
            mock_bot, mock_event, value='', var_name='empty_str',
        )
        assert result['result'] == ''
        assert result['error'] == ''


# =============================================================================
# 变量名
# =============================================================================
class TestVariableName:
    """验证变量名的默认值与自定义。"""

    @pytest.mark.asyncio
    async def test_default_var_name_is_x(self, mock_bot, mock_event):
        """不传 var_name 时默认为 'x'。"""
        result = await set_variable(mock_bot, mock_event, value=42)
        assert result['var_name'] == 'x'
        assert result['result'] == 42

    @pytest.mark.asyncio
    async def test_custom_var_name(self, mock_bot, mock_event):
        """自定义变量名。"""
        result = await set_variable(
            mock_bot, mock_event, value=99, var_name='player_hp',
        )
        assert result['var_name'] == 'player_hp'

    @pytest.mark.asyncio
    async def test_var_name_with_underscore(self, mock_bot, mock_event):
        """下划线变量名。"""
        result = await set_variable(
            mock_bot, mock_event, value=1, var_name='_private_var',
        )
        assert result['var_name'] == '_private_var'

    @pytest.mark.asyncio
    async def test_var_name_with_numbers(self, mock_bot, mock_event):
        """含数字的变量名。"""
        result = await set_variable(
            mock_bot, mock_event, value=1, var_name='var123',
        )
        assert result['var_name'] == 'var123'

    @pytest.mark.asyncio
    async def test_empty_var_name(self, mock_bot, mock_event):
        """空变量名属于非法变量名，应返回 error 提示。"""
        result = await set_variable(
            mock_bot, mock_event, value=1, var_name='',
        )
        assert result['var_name'] == ''
        assert '非法变量名' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_var_name_rejected(self, mock_bot, mock_event):
        """以数字开头或含特殊字符的变量名应被拒绝。"""
        result = await set_variable(
            mock_bot, mock_event, value=1, var_name='123bad',
        )
        assert '非法变量名' in result['error']


# =============================================================================
# 默认值与参数缺失
# =============================================================================
class TestDefaults:
    """验证参数缺失时的默认值行为。"""

    @pytest.mark.asyncio
    async def test_no_args_uses_defaults(self, mock_bot, mock_event):
        """完全不传 value 和 var_name：result=None, var_name='x'。"""
        result = await set_variable(mock_bot, mock_event)
        assert result['result'] is None
        assert result['var_name'] == 'x'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_only_value_provided(self, mock_bot, mock_event):
        """只传 value，var_name 用默认 'x'。"""
        result = await set_variable(mock_bot, mock_event, value='test')
        assert result['result'] == 'test'
        assert result['var_name'] == 'x'

    @pytest.mark.asyncio
    async def test_only_var_name_provided(self, mock_bot, mock_event):
        """只传 var_name，value 用默认 None。"""
        result = await set_variable(mock_bot, mock_event, var_name='my_var')
        assert result['result'] is None
        assert result['var_name'] == 'my_var'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 result/var_name/error 三个字段。"""
        result = await set_variable(mock_bot, mock_event, value=1, var_name='v')
        assert set(result.keys()) == {'result', 'var_name', 'error'}

    @pytest.mark.asyncio
    async def test_error_always_empty(self, mock_bot, mock_event):
        """set_variable 永不失败，error 始终为空字符串。"""
        # 各种值都应返回空 error
        for val in [0, '', None, [], {}, False, [1, 2], {'a': 1}]:
            result = await set_variable(
                mock_bot, mock_event, value=val, var_name='v',
            )
            assert result['error'] == '', f"value={val!r} 时 error 应为空"

    @pytest.mark.asyncio
    async def test_result_is_exact_value_passed(self, mock_bot, mock_event):
        """result 字段精确等于传入的 value（无类型转换）。"""
        result = await set_variable(
            mock_bot, mock_event, value='123', var_name='v',
        )
        assert result['result'] == '123'  # 字符串，非数字
        assert isinstance(result['result'], str)

    @pytest.mark.asyncio
    async def test_var_name_is_exact_string_passed(self, mock_bot, mock_event):
        """var_name 字段精确等于传入的字符串（无处理）。"""
        result = await set_variable(
            mock_bot, mock_event, value=1, var_name='  spaced  ',
        )
        assert result['var_name'] == '  spaced  '
