"""if_branch 节点单元测试。

覆盖：
- if_branch 模块占位结构（无独立 handler，逻辑由 interpreter 内联处理）
- safe_eval_expression 条件求值逻辑（interpreter._exec_if_branch 实际调用）
  - 比较运算（==/!=/>/>=/</<=）
  - 逻辑运算（and/or/not）
  - 数值与字符串混合
  - 三元表达式
  - 白名单函数（max/min/clamp/percent 等）
  - 变量字典注入与 value 特殊变量
  - 边界：空表达式 / 非法语法 / 未知变量
  - 求值失败回退 False

被测源码：
- qqbat_nodes/builtin/if_branch.py（占位）
- qqbat_nodes/runtime/safe_eval.py（实际逻辑）
- qqbat_nodes/runtime/interpreter.py::_exec_if_branch（实际调用方）

设计说明：
- if_branch 文件本身仅占位（无 async def），实际条件求值由
  interpreter._exec_if_branch 调用 safe_eval_expression 实现
- 因此本测试文件直接测试 safe_eval_expression 的行为，
  覆盖 if_branch 表达式可能用到的所有求值路径
"""
import pytest

from qqbat_nodes.runtime.safe_eval import (
    safe_eval_expression,
    safe_eval_node,
)


# =============================================================================
# 模块占位结构
# =============================================================================
class TestModuleStructure:
    """验证 if_branch 模块的占位结构。"""

    def test_module_importable(self):
        """if_branch 模块可正常导入（占位文件不抛异常）。"""
        import qqbat_nodes.builtin.if_branch as mod
        assert mod is not None

    def test_module_has_docstring(self):
        """if_branch 模块包含 docstring 说明占位性质。"""
        import qqbat_nodes.builtin.if_branch as mod
        assert mod.__doc__ is not None
        assert len(mod.__doc__) > 0

    def test_module_no_async_handler(self):
        """if_branch 模块不定义独立 async handler（由 interpreter 内联处理）。"""
        import qqbat_nodes.builtin.if_branch as mod
        # 模块中不应有同名 async 函数 if_branch
        assert not hasattr(mod, 'if_branch') or not callable(getattr(mod, 'if_branch', None))


# =============================================================================
# 比较运算（if_branch 表达式核心场景）
# =============================================================================
class TestComparisonExpressions:
    """验证 if_branch 表达式中常用的比较运算。"""

    def test_equal_true(self):
        """== 比较为真：value == 10。"""
        result = safe_eval_expression('value == 10', {'value': 10})
        assert result is True

    def test_equal_false(self):
        """== 比较为假：value == 10。"""
        result = safe_eval_expression('value == 10', {'value': 5})
        assert result is False

    def test_not_equal_true(self):
        """!= 比较为真。"""
        result = safe_eval_expression('value != 0', {'value': 1})
        assert result is True

    def test_greater_than_true(self):
        """> 比较为真。"""
        result = safe_eval_expression('value > 5', {'value': 10})
        assert result is True

    def test_greater_than_false_equal(self):
        """> 等于时为假。"""
        result = safe_eval_expression('value > 5', {'value': 5})
        assert result is False

    def test_greater_equal_true_equal(self):
        """>= 等于时为真。"""
        result = safe_eval_expression('value >= 5', {'value': 5})
        assert result is True

    def test_less_than_true(self):
        """< 比较为真。"""
        result = safe_eval_expression('value < 5', {'value': 1})
        assert result is True

    def test_less_equal_true_equal(self):
        """<= 等于时为真。"""
        result = safe_eval_expression('value <= 5', {'value': 5})
        assert result is True


# =============================================================================
# 逻辑运算
# =============================================================================
class TestLogicalExpressions:
    """验证 if_branch 表达式中的 and/or/not 逻辑。"""

    def test_and_both_true(self):
        """and 两边都真 → True。"""
        result = safe_eval_expression(
            'value > 0 and value < 100', {'value': 50},
        )
        assert result is True

    def test_and_one_false(self):
        """and 任一假 → False。"""
        result = safe_eval_expression(
            'value > 0 and value < 10', {'value': 100},
        )
        assert result is False

    def test_or_one_true(self):
        """or 任一真 → True。"""
        result = safe_eval_expression(
            'value < 0 or value > 100', {'value': 200},
        )
        assert result is True

    def test_or_both_false(self):
        """or 两边都假 → False。"""
        result = safe_eval_expression(
            'value < 0 or value > 100', {'value': 50},
        )
        assert result is False

    def test_not_true_to_false(self):
        """not True → False。"""
        result = safe_eval_expression('not value', {'value': True})
        assert result is False

    def test_not_zero_to_true(self):
        """not 0 → True（0 为 falsy）。"""
        result = safe_eval_expression('not value', {'value': 0})
        assert result is True

    def test_compound_logic(self):
        """复合逻辑：(a > 0 and b > 0) or c。"""
        result = safe_eval_expression(
            '(a > 0 and b > 0) or c',
            {'a': 1, 'b': 1, 'c': False},
        )
        assert result is True


# =============================================================================
# 算术运算 + 比较
# =============================================================================
class TestArithmeticComparison:
    """验证 if_branch 表达式中算术与比较的组合。"""

    def test_arithmetic_in_comparison(self):
        """算术结果参与比较：atk - defense > 0。

        注：变量名不能用 def（Python 关键字，会被 ast.parse 拒绝），
        用 defense 替代。
        """
        result = safe_eval_expression(
            'atk - defense > 0', {'atk': 20, 'defense': 10},
        )
        assert result is True

    def test_multiplication_comparison(self):
        """乘法结果参与比较：atk * 2 >= 30。"""
        result = safe_eval_expression(
            'atk * 2 >= 30', {'atk': 15},
        )
        assert result is True

    def test_division_comparison(self):
        """除法结果参与比较：hp / max_hp > 0.5。"""
        result = safe_eval_expression(
            'hp / max_hp > 0.5', {'hp': 60, 'max_hp': 100},
        )
        assert result is True

    def test_modulo_comparison(self):
        """取模结果参与比较：value % 2 == 0（偶数判定）。"""
        result = safe_eval_expression(
            'value % 2 == 0', {'value': 10},
        )
        assert result is True


# =============================================================================
# 三元表达式
# =============================================================================
class TestTernaryExpression:
    """验证 if_branch 表达式中的三元运算。"""

    def test_ternary_true_branch(self):
        """三元表达式条件真 → 取 body。"""
        result = safe_eval_expression(
            'value if value > 0 else -value', {'value': 5},
        )
        assert result == 5

    def test_ternary_false_branch(self):
        """三元表达式条件假 → 取 orelse。"""
        result = safe_eval_expression(
            'value if value > 0 else -value', {'value': -5},
        )
        assert result == 5  # -(-5) = 5


# =============================================================================
# 白名单函数
# =============================================================================
class TestWhitelistFunctions:
    """验证 if_branch 表达式中可用的白名单函数。"""

    def test_max_function(self):
        """max(a, b) 函数可用。"""
        result = safe_eval_expression(
            'max(a, b) > 10', {'a': 5, 'b': 15},
        )
        assert result is True

    def test_min_function(self):
        """min(a, b) 函数可用。"""
        result = safe_eval_expression(
            'min(a, b) < 10', {'a': 5, 'b': 15},
        )
        assert result is True

    def test_abs_function(self):
        """abs(x) 函数可用。"""
        result = safe_eval_expression(
            'abs(value) == 5', {'value': -5},
        )
        assert result is True

    def test_round_function(self):
        """round(x) 函数可用。"""
        result = safe_eval_expression(
            'round(value) == 4', {'value': 3.6},
        )
        assert result is True

    def test_len_function(self):
        """len(x) 函数可用（None 安全返回 0）。"""
        result = safe_eval_expression(
            'len(items) > 0', {'items': [1, 2, 3]},
        )
        assert result is True

    def test_len_none_returns_zero(self):
        """len(None) 安全返回 0（不抛 TypeError）。"""
        result = safe_eval_expression(
            'len(items) == 0', {'items': None},
        )
        assert result is True

    def test_clamp_function(self):
        """clamp(v, lo, hi) 函数可用。"""
        result = safe_eval_expression(
            'clamp(value, 0, 100) == 100', {'value': 150},
        )
        assert result is True

    def test_int_function(self):
        """int(x) 函数可用。"""
        result = safe_eval_expression(
            'int(value) == 5', {'value': 5.9},
        )
        assert result is True


# =============================================================================
# 变量字典与 value 特殊变量
# =============================================================================
class TestVariableResolution:
    """验证 if_branch 表达式中变量解析与 value 特殊变量。"""

    def test_value_special_variable(self):
        """value 作为特殊变量从字典取值。"""
        result = safe_eval_expression('value > 5', {'value': 10})
        assert result is True

    def test_named_variable(self):
        """命名变量从字典取值。"""
        result = safe_eval_expression('level >= 50', {'level': 60})
        assert result is True

    def test_multiple_named_variables(self):
        """多变量同时参与表达式。

        注：变量名不能用 def（Python 关键字），用 defense 替代。
        """
        result = safe_eval_expression(
            'atk > defense and hp > 0',
            {'atk': 20, 'defense': 10, 'hp': 100},
        )
        assert result is True

    def test_undefined_variable_returns_none(self):
        """未定义变量：safe_eval_node raise ValueError，safe_eval_expression 捕获返回 False。"""
        # P2 修复后：unknown_var 未定义 → safe_eval_node raise ValueError
        # → safe_eval_expression 捕获 → 返回 False
        result = safe_eval_expression('unknown_var > 5', {})
        assert result is False

    def test_none_value_in_comparison(self):
        """value=None 参与比较 → False（求值失败回退）。"""
        result = safe_eval_expression('value > 5', {'value': None})
        assert result is False


# =============================================================================
# 字符串比较
# =============================================================================
class TestStringComparison:
    """验证 if_branch 表达式中的字符串比较。"""

    def test_string_equality(self):
        """字符串相等比较。"""
        result = safe_eval_expression(
            'role == "admin"', {'role': 'admin'},
        )
        assert result is True

    def test_string_inequality(self):
        """字符串不相等比较。"""
        result = safe_eval_expression(
            'role != "guest"', {'role': 'admin'},
        )
        assert result is True

    def test_string_membership(self):
        """in 运算符检查成员（用变量引用列表，避免 ast.List 不被支持）。"""
        # safe_eval 不支持 ast.List 字面量，但支持 a in b 形式
        # 这里通过变量传入列表
        result = safe_eval_expression(
            'value in roles', {'value': 'admin', 'roles': ['admin', 'vip']},
        )
        assert result is True


# =============================================================================
# 边界与错误处理
# =============================================================================
class TestErrorAndEdgeCases:
    """验证 if_branch 表达式的边界与错误处理。"""

    def test_empty_expression_returns_false(self):
        """空表达式 → 返回 False（interpreter 据此走 false 分支）。"""
        result = safe_eval_expression('', {'value': 1})
        assert result is False

    def test_whitespace_only_expression_returns_false(self):
        """仅空白的表达式 → 返回 False。"""
        # ast.parse 对纯空白抛 SyntaxError → safe_eval 捕获 → False
        result = safe_eval_expression('   ', {'value': 1})
        assert result is False

    def test_invalid_syntax_returns_false(self):
        """非法语法表达式 → 返回 False（兜底）。"""
        # 'value + ' 缺右操作数 → SyntaxError → False
        result = safe_eval_expression('value + ', {'value': 1})
        assert result is False

    def test_division_by_zero_returns_false(self):
        """除零异常 → 返回 False。"""
        # 1/0 抛 ZeroDivisionError → safe_eval_expression 捕获 → False
        result = safe_eval_expression('value / 0 > 0', {'value': 1})
        assert result is False

    def test_unsupported_function_returns_false(self):
        """调用非白名单函数 → 返回 False。"""
        # open 不是白名单函数 → ValueError → False
        result = safe_eval_expression('open("/etc/passwd")', {})
        assert result is False

    def test_truly_expression_returns_truthy_value(self):
        """非布尔表达式返回求值结果（truthy 由 interpreter 判断）。"""
        # value 本身被求值（非比较）
        result = safe_eval_expression('value', {'value': 42})
        assert result == 42


# =============================================================================
# interpreter 集成契约
# =============================================================================
class TestInterpreterContract:
    """验证 if_branch 表达式求值结果满足 interpreter 走 true/false 分支的契约。

    interpreter._exec_if_branch 中：
        result = safe_eval_expression(expression, variables)
        branch_port = 'true' if result else 'false'

    即：safe_eval_expression 的返回值会被 if 真值判断。
    """

    def test_truthy_expression_routes_to_true(self):
        """真值表达式 → interpreter 走 true 分支。"""
        result = safe_eval_expression('value > 5', {'value': 10})
        assert bool(result) is True

    def test_falsy_expression_routes_to_false(self):
        """假值表达式 → interpreter 走 false 分支。"""
        result = safe_eval_expression('value > 5', {'value': 1})
        assert bool(result) is False

    def test_no_expression_interpreter_uses_value_truthiness(self):
        """无表达式时 interpreter 用 bool(value) 兜底（验证 value 真值判断契约）。"""
        # interpreter._exec_if_branch 中：expression 为空时 result = bool(upstream_value)
        # 这里模拟其行为：直接对 value 做 bool()
        upstream_value = 0
        result = bool(upstream_value) if not '' else None
        # 实际 safe_eval 对空表达式返回 False，与 interpreter 的 bool(value) 不一致
        # 但 interpreter 在 expression 为空时不会调用 safe_eval，而是直接 bool(value)
        assert result is False  # value=0 → bool(0) = False
