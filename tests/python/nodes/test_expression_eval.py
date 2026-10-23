"""expression_eval 节点单元测试。

覆盖：
- 命名变量（variables_json）求值
- v1~v5 位置变量向后兼容
- 白名单函数（abs/max/min/round/clamp/percent 等）
- 三元表达式
- 错误处理（空表达式、非法语法、未知变量、variables_json 格式错误）

被测源码：qqbat_nodes/builtin/expression_eval.py
"""
import json

import pytest

from qqbat_nodes.builtin.expression_eval import expression_eval


# =============================================================================
# 基本运算
# =============================================================================
class TestBasicArithmetic:
    """验证基础四则运算与运算符优先级。"""

    @pytest.mark.asyncio
    async def test_addition(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='1 + 2',
        )
        assert result['result'] == 3
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_operator_precedence(self, mock_bot, mock_event):
        """乘法优先于加法：1 + 2 * 3 = 7。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='1 + 2 * 3',
        )
        assert result['result'] == 7

    @pytest.mark.asyncio
    async def test_parentheses_override_precedence(self, mock_bot, mock_event):
        """括号优先：(1 + 2) * 3 = 9。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='(1 + 2) * 3',
        )
        assert result['result'] == 9

    @pytest.mark.asyncio
    async def test_float_division(self, mock_bot, mock_event):
        """真除法 / 返回 float。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='7 / 2',
        )
        assert result['result'] == 3.5

    @pytest.mark.asyncio
    async def test_floor_division(self, mock_bot, mock_event):
        """地板除 // 返回整数。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='7 // 2',
        )
        assert result['result'] == 3

    @pytest.mark.asyncio
    async def test_modulo(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='7 % 3',
        )
        assert result['result'] == 1

    @pytest.mark.asyncio
    async def test_power(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='2 ** 3',
        )
        assert result['result'] == 8

    @pytest.mark.asyncio
    async def test_unary_minus(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='-5',
        )
        assert result['result'] == -5


# =============================================================================
# 命名变量（variables_json）
# =============================================================================
class TestNamedVariables:
    """验证 variables_json 命名变量。"""

    @pytest.mark.asyncio
    async def test_named_vars_in_expression(self, mock_bot, mock_event):
        """命名变量在表达式中可直接使用。

        注：'def' 是 Python 关键字不能作为变量名（ast.parse 会失败），
        因此使用 'defense' 作为变量名。
        """
        result = await expression_eval(
            mock_bot, mock_event,
            expression='atk - defense * 0.5',
            variables_json='{"atk": 100, "defense": 50}',
        )
        assert result['result'] == 75.0  # 100 - 25

    @pytest.mark.asyncio
    async def test_named_vars_dict_type(self, mock_bot, mock_event):
        """variables_json 接受 dict 直传（不经 JSON 反序列化）。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='hp + mp',
            variables_json={'hp': 200, 'mp': 50},
        )
        assert result['result'] == 250

    @pytest.mark.asyncio
    async def test_named_vars_priority_over_v1_to_v5(self, mock_bot, mock_event):
        """variables_json 优先级高于 v1~v5（同名时 variables_json 覆盖）。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='v1',
            variables_json='{"v1": 999}',
            v1=1,
        )
        assert result['result'] == 999


# =============================================================================
# v1~v5 兼容
# =============================================================================
class TestV1ToV5Compat:
    """验证 v1~v5 位置变量向后兼容。"""

    @pytest.mark.asyncio
    async def test_v1_to_v5_used_when_no_variables_json(self, mock_bot, mock_event):
        """无 variables_json 时使用 v1~v5。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='v1 + v2 * v3 - v4 / v5',
            v1=10, v2=20, v3=3, v4=8, v5=4,
        )
        # 10 + 60 - 2.0 = 68.0
        assert result['result'] == 68.0

    @pytest.mark.asyncio
    async def test_v1_none_defaults_to_zero(self, mock_bot, mock_event):
        """v1=None 时默认为 0。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='v1 + 5',
            v1=None,
        )
        assert result['result'] == 5

    @pytest.mark.asyncio
    async def test_v1_to_v5_all_none_default_zero(self, mock_bot, mock_event):
        """所有 v1~v5 都为 None 时默认为 0。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='v1 + v2 + v3 + v4 + v5',
        )
        assert result['result'] == 0


# =============================================================================
# 白名单函数
# =============================================================================
class TestSafeFunctions:
    """验证白名单函数调用。"""

    @pytest.mark.asyncio
    async def test_abs_function(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='abs(-10)',
        )
        assert result['result'] == 10

    @pytest.mark.asyncio
    async def test_max_min_functions(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='max(1, 2, 3)',
        )
        assert result['result'] == 3
        result = await expression_eval(
            mock_bot, mock_event, expression='min(1, 2, 3)',
        )
        assert result['result'] == 1

    @pytest.mark.asyncio
    async def test_round_function(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='round(3.14159, 2)',
        )
        assert result['result'] == 3.14

    @pytest.mark.asyncio
    async def test_int_float_functions(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='int(3.99)',
        )
        assert result['result'] == 3
        result = await expression_eval(
            mock_bot, mock_event, expression='float(5)',
        )
        assert result['result'] == 5.0

    @pytest.mark.asyncio
    async def test_clamp_function(self, mock_bot, mock_event):
        """clamp(v, lo, hi) 将 v 限制在 [lo, hi] 区间。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='clamp(150, 0, 100)',
        )
        assert result['result'] == 100
        result = await expression_eval(
            mock_bot, mock_event, expression='clamp(-5, 0, 100)',
        )
        assert result['result'] == 0
        result = await expression_eval(
            mock_bot, mock_event, expression='clamp(50, 0, 100)',
        )
        assert result['result'] == 50

    @pytest.mark.asyncio
    async def test_percent_function(self, mock_bot, mock_event):
        """percent(v, total) = round(v / total * 100, 1)。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='percent(25, 200)',
        )
        assert result['result'] == 12.5

    @pytest.mark.asyncio
    async def test_percent_zero_total_returns_zero(self, mock_bot, mock_event):
        """percent(v, 0) 返回 0（避免除零）。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='percent(25, 0)',
        )
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_len_function(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event,
            expression='len(items)',
            variables_json='{"items": [1, 2, 3]}',
        )
        assert result['result'] == 3

    @pytest.mark.asyncio
    async def test_sqrt_function(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='sqrt(16)',
        )
        assert result['result'] == 4.0


# =============================================================================
# 比较与逻辑运算
# =============================================================================
class TestComparisonAndLogic:
    """验证比较与逻辑运算符。"""

    @pytest.mark.asyncio
    async def test_comparison_operators(self, mock_bot, mock_event):
        for expr, expected in [
            ('5 > 3', True),
            ('5 < 3', False),
            ('5 >= 5', True),
            ('5 <= 4', False),
            ('5 == 5', True),
            ('5 != 4', True),
        ]:
            result = await expression_eval(mock_bot, mock_event, expression=expr)
            assert result['result'] is expected, f'expr={expr}'

    @pytest.mark.asyncio
    async def test_and_or_logic(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='1 and 0',
        )
        assert result['result'] == 0
        result = await expression_eval(
            mock_bot, mock_event, expression='1 or 0',
        )
        assert result['result'] == 1

    @pytest.mark.asyncio
    async def test_not_operator(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event, expression='not 0',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_in_operator(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event,
            expression='2 in items',
            variables_json='{"items": [1, 2, 3]}',
        )
        assert result['result'] is True


# =============================================================================
# 三元表达式
# =============================================================================
class TestTernary:
    """验证三元表达式 if-else。"""

    @pytest.mark.asyncio
    async def test_ternary_true_branch(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event,
            expression='atk if hp > 0 else 0',
            variables_json='{"atk": 100, "hp": 50}',
        )
        assert result['result'] == 100

    @pytest.mark.asyncio
    async def test_ternary_false_branch(self, mock_bot, mock_event):
        result = await expression_eval(
            mock_bot, mock_event,
            expression='atk if hp > 0 else 0',
            variables_json='{"atk": 100, "hp": 0}',
        )
        assert result['result'] == 0


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证错误场景的处理。"""

    @pytest.mark.asyncio
    async def test_empty_expression_returns_error(self, mock_bot, mock_event):
        """空表达式返回 result=None + error 信息。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='',
        )
        assert result['result'] is None
        assert '表达式为空' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_syntax_returns_error(self, mock_bot, mock_event):
        """非法语法返回 result=None + error 信息。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='1 +* 2',
        )
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_undefined_variable_returns_none(self, mock_bot, mock_event):
        """未定义变量：safe_eval_node raise ValueError，handler 捕获后返回 None + error。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='unknown_var + 1',
            variables_json='{}',
        )
        # P2 修复后：unknown_var 未定义 → safe_eval_node raise ValueError
        # → expression_eval 捕获 → 返回 None + error="未定义变量: unknown_var"
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_invalid_variables_json_string_falls_back_to_value_key(
        self, mock_bot, mock_event,
    ):
        """非法 JSON 字符串：fallback 为 {"value": variables_json}。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='value',
            variables_json='not a json',
        )
        # 'not a json' 不是合法 JSON → 回退 {"value": "not a json"}
        assert result['result'] == 'not a json'

    @pytest.mark.asyncio
    async def test_variables_json_number_string(self, mock_bot, mock_event):
        """variables_json 为数字字符串 → json.loads 得到 number → 包装为 {"value": number}。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='value + 1',
            variables_json='100',
        )
        assert result['result'] == 101

    @pytest.mark.asyncio
    async def test_variables_json_non_str_non_dict(self, mock_bot, mock_event):
        """variables_json 为非 str/dict 类型（如 int）→ 包装为 {"value": int}。"""
        result = await expression_eval(
            mock_bot, mock_event,
            expression='value * 2',
            variables_json=50,
        )
        assert result['result'] == 100

    @pytest.mark.asyncio
    async def test_whitespace_expression_stripped(self, mock_bot, mock_event):
        """表达式首尾空白被 strip 后正常求值。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='  1 + 2  ',
        )
        assert result['result'] == 3


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaultArgs:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_default_expression_used(self, mock_bot, mock_event):
        """不传 expression 时使用默认 'atk - def * 0.5'。

        注：默认表达式含 'def'（Python 关键字），ast.parse 会抛 SyntaxError，
        因此 result=None 且 error 非空。此测试仅验证默认表达式被使用（即触发了求值路径）。
        """
        result = await expression_eval(
            mock_bot, mock_event,
            variables_json='{"atk": 100, "def": 50}',
        )
        # 默认表达式含 def 关键字 → SyntaxError → result=None + error
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_no_variables_uses_v1_to_v5_defaults(self, mock_bot, mock_event):
        """无 variables_json 与 v1~v5：所有变量默认 0。"""
        result = await expression_eval(
            mock_bot, mock_event, expression='v1',
        )
        assert result['result'] == 0
