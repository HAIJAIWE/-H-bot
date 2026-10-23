"""format_text 节点单元测试。

覆盖：
- 命名变量替换：JSON 字符串 / dict 直传 / 多变量
- var1~var8 兼容：位置变量 / variables_json 优先级覆盖
- 占位符行为：未绑定保留原文 / None 值保留原文
- 边界：空模板 / 无模板 / 无占位符 / 嵌套大括号
- variables_json 类型兼容：number/boolean/非 JSON 字符串/非 dict JSON

被测源码：qqbat_nodes/builtin/format_text.py
"""
import pytest

from qqbat_nodes.builtin.format_text import format_text


# =============================================================================
# 命名变量替换
# =============================================================================
class TestNamedVariables:
    """验证 variables_json 命名变量替换。"""

    @pytest.mark.asyncio
    async def test_single_named_var_json_string(self, mock_bot, mock_event):
        """JSON 字符串 variables_json 替换单个命名占位符。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{name} 你好',
            variables_json='{"name": "alice"}',
        )
        assert result['result'] == 'alice 你好'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_multiple_named_vars(self, mock_bot, mock_event):
        """多个命名变量同时替换。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{a} 和 {b} 是朋友',
            variables_json='{"a": "张三", "b": "李四"}',
        )
        assert result['result'] == '张三 和 李四 是朋友'

    @pytest.mark.asyncio
    async def test_dict_variables_direct(self, mock_bot, mock_event):
        """dict 类型 variables_json 直传。"""
        result = await format_text(
            mock_bot, mock_event,
            template='HP: {hp}',
            variables_json={'hp': 100},
        )
        assert result['result'] == 'HP: 100'

    @pytest.mark.asyncio
    async def test_int_value_converted_to_string(self, mock_bot, mock_event):
        """int 值被 str() 转换为字符串。"""
        result = await format_text(
            mock_bot, mock_event,
            template='伤害 {dmg} 点',
            variables_json='{"dmg": 25}',
        )
        assert result['result'] == '伤害 25 点'

    @pytest.mark.asyncio
    async def test_bool_value_converted_to_string(self, mock_bot, mock_event):
        """bool 值被 str() 转换为 'True'/'False'。"""
        result = await format_text(
            mock_bot, mock_event,
            template='获胜: {win}',
            variables_json='{"win": true}',
        )
        assert result['result'] == '获胜: True'


# =============================================================================
# var1~var8 兼容
# =============================================================================
class TestLegacyVarArgs:
    """验证 var1~var8 位置变量兼容。"""

    @pytest.mark.asyncio
    async def test_var1_replacement(self, mock_bot, mock_event):
        """var1 占位符替换。"""
        result = await format_text(
            mock_bot, mock_event,
            template='你好 {var1}',
            var1='世界',
        )
        assert result['result'] == '你好 世界'

    @pytest.mark.asyncio
    async def test_multiple_var_args(self, mock_bot, mock_event):
        """var1/var2/var3 同时替换。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{var1}{var2}{var3}',
            var1='A', var2='B', var3='C',
        )
        assert result['result'] == 'ABC'

    @pytest.mark.asyncio
    async def test_variables_json_overrides_var_args(self, mock_bot, mock_event):
        """variables_json 优先级高于 var1~var8。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{var1}',
            var1='legacy',
            variables_json='{"var1": "named"}',
        )
        assert result['result'] == 'named'

    @pytest.mark.asyncio
    async def test_var_arg_none_kept_original(self, mock_bot, mock_event):
        """var1=None 时占位符保留原文。"""
        result = await format_text(
            mock_bot, mock_event,
            template='value: {var1}',
            var1=None,
        )
        assert result['result'] == 'value: {var1}'


# =============================================================================
# 占位符行为
# =============================================================================
class TestPlaceholderBehavior:
    """验证占位符替换的边界行为。"""

    @pytest.mark.asyncio
    async def test_unbound_placeholder_kept(self, mock_bot, mock_event):
        """未在 vars 中的占位符保留原文。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{a} and {b}',
            variables_json='{"a": "x"}',
        )
        assert result['result'] == 'x and {b}'

    @pytest.mark.asyncio
    async def test_none_value_kept_original(self, mock_bot, mock_event):
        """vars 中值为 None 时占位符保留原文。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{a}',
            variables_json='{"a": null}',
        )
        assert result['result'] == '{a}'

    @pytest.mark.asyncio
    async def test_no_placeholder_text_unchanged(self, mock_bot, mock_event):
        """无占位符的模板原样返回。"""
        result = await format_text(
            mock_bot, mock_event,
            template='just plain text',
            variables_json='{"a": 1}',
        )
        assert result['result'] == 'just plain text'

    @pytest.mark.asyncio
    async def test_nested_braces_preserved(self, mock_bot, mock_event):
        """非变量大括号（如函数调用）保留。

        注：re.sub(r'\\{(\\w+)\\}', ...) 只匹配 {单词字符}，
        function() 等不含 {单词} 的部分不受影响。
        """
        result = await format_text(
            mock_bot, mock_event,
            template='call({name})',
            variables_json='{"name": "x"}',
        )
        assert result['result'] == 'call(x)'

    @pytest.mark.asyncio
    async def test_repeated_placeholder(self, mock_bot, mock_event):
        """同一占位符多次出现全部替换。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{x} + {x} = 2*{x}',
            variables_json='{"x": 5}',
        )
        assert result['result'] == '5 + 5 = 2*5'


# =============================================================================
# 模板边界
# =============================================================================
class TestTemplateBoundary:
    """验证模板边界条件。"""

    @pytest.mark.asyncio
    async def test_empty_template_returns_empty(self, mock_bot, mock_event):
        """空模板返回空字符串。"""
        result = await format_text(
            mock_bot, mock_event, template='',
            variables_json='{"a": 1}',
        )
        assert result['result'] == ''
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_no_template_arg_returns_empty(self, mock_bot, mock_event):
        """不传 template 时返回空字符串（默认值 ''）。"""
        result = await format_text(mock_bot, mock_event)
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_empty_variables_json_uses_var_args(self, mock_bot, mock_event):
        """variables_json 为空字符串时仅用 var1~var8。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{var1}',
            variables_json='',
            var1='hello',
        )
        assert result['result'] == 'hello'

    @pytest.mark.asyncio
    async def test_none_variables_json_uses_var_args(self, mock_bot, mock_event):
        """variables_json=None 时仅用 var1~var8。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{var1}',
            variables_json=None,
            var1='hi',
        )
        assert result['result'] == 'hi'


# =============================================================================
# variables_json 类型兼容
# =============================================================================
class TestVariablesJsonTypes:
    """验证 variables_json 多种输入类型的兼容处理。"""

    @pytest.mark.asyncio
    async def test_non_dict_json_string_wrapped_as_value(self, mock_bot, mock_event):
        """非 dict 的 JSON 字符串（如 "text"）包装为 {"value": ...}。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{value}',
            variables_json='"wrapped"',
        )
        assert result['result'] == 'wrapped'

    @pytest.mark.asyncio
    async def test_number_variables_json_wrapped_as_value(self, mock_bot, mock_event):
        """number 类型 variables_json 包装为 {"value": number}。"""
        result = await format_text(
            mock_bot, mock_event,
            template='count={value}',
            variables_json=42,
        )
        assert result['result'] == 'count=42'

    @pytest.mark.asyncio
    async def test_non_json_string_treated_as_value(self, mock_bot, mock_event):
        """非合法 JSON 的普通字符串包装为 {"value": 字符串}。"""
        result = await format_text(
            mock_bot, mock_event,
            template='data={value}',
            variables_json='hello world',
        )
        assert result['result'] == 'data=hello world'

    @pytest.mark.asyncio
    async def test_json_number_literal_wrapped(self, mock_bot, mock_event):
        """JSON 数字字面量字符串包装为 {"value": number}。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{value}',
            variables_json='123',
        )
        assert result['result'] == '123'

    @pytest.mark.asyncio
    async def test_json_bool_literal_wrapped(self, mock_bot, mock_event):
        """JSON 布尔字面量字符串包装为 {"value": bool}。"""
        result = await format_text(
            mock_bot, mock_event,
            template='{value}',
            variables_json='true',
        )
        assert result['result'] == 'True'
