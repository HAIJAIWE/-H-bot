"""json_process 节点单元测试。

覆盖：
- 点号路径查找：$.前缀 / $前缀 / 无前缀 / 嵌套路径 / 列表索引
- _jsonpath_lookup：jsonpath_ng 未安装时抛 ImportError（fallback 路径覆盖）
- json_process 主入口：JSON 字符串/dict 源、空表达式、默认表达式、非法 JSON
- 高级 JSONPath 表达式（$..name、$.items[*]）的 fallback 行为
- 类型兼容：dict / list / 标量源

被测源码：qqbat_nodes/builtin/json_process.py
"""
import json

import pytest

from qqbat_nodes.builtin.json_process import (
    _dot_path_lookup,
    _jsonpath_lookup,
    json_process,
)


# =============================================================================
# _dot_path_lookup 辅助函数
# =============================================================================
class TestDotPathLookup:
    """验证点号路径查找逻辑（去除 $. / $ 前缀后的简单路径解析）。"""

    def test_simple_key_lookup(self):
        """单层 key 查找成功。"""
        assert _dot_path_lookup({"a": 1}, "a") == 1

    def test_dollar_prefix_key(self):
        """$. 前缀被正确剥离。"""
        assert _dot_path_lookup({"a": 1}, "$.a") == 1

    def test_dollar_only_prefix(self):
        """仅有 $ 前缀（无点号）被剥离。"""
        assert _dot_path_lookup({"a": 1}, "$a") == 1

    def test_nested_path_lookup(self):
        """嵌套路径 a.b.c 查找成功。"""
        data = {"a": {"b": {"c": 42}}}
        assert _dot_path_lookup(data, "a.b.c") == 42

    def test_nested_path_with_dollar_prefix(self):
        """$.a.b.c 嵌套路径查找成功。"""
        data = {"a": {"b": {"c": 42}}}
        assert _dot_path_lookup(data, "$.a.b.c") == 42

    def test_list_index_lookup(self):
        """列表数字索引查找成功。"""
        data = {"items": [10, 20, 30]}
        assert _dot_path_lookup(data, "items.1") == 20

    def test_list_index_out_of_range_returns_none(self):
        """列表索引超出范围返回 None。"""
        data = {"items": [10, 20]}
        assert _dot_path_lookup(data, "items.5") is None

    def test_missing_key_returns_none(self):
        """不存在的 key 返回 None。"""
        assert _dot_path_lookup({"a": 1}, "b") is None

    def test_lookup_on_non_dict_non_list_returns_none(self):
        """在标量上查找返回 None。"""
        assert _dot_path_lookup(42, "a") is None

    def test_empty_string_key(self):
        """空字符串路径返回整个对象（无 parts 循环）。"""
        # 表达式 '' split('.') 得到 ['']，在 dict 上 .get('') 返回 None
        assert _dot_path_lookup({"a": 1}, "") is None


# =============================================================================
# _jsonpath_lookup 辅助函数
# =============================================================================
class TestJsonPathLookup:
    """验证 jsonpath_ng 调用逻辑（未安装时抛 ImportError）。"""

    def test_raises_import_error_when_not_installed(self):
        """jsonpath_ng 未安装时抛 ImportError。

        本环境未安装 jsonpath_ng，因此调用 _jsonpath_lookup 应抛 ImportError。
        若环境后续安装了 jsonpath_ng，此测试可能失败（届时改为测试正常路径）。
        """
        try:
            import jsonpath_ng  # noqa: F401
            pytest.skip("jsonpath_ng 已安装，跳过 ImportError 测试")
        except ImportError:
            pass

        with pytest.raises(ImportError):
            _jsonpath_lookup({"a": 1}, "$.a")


# =============================================================================
# json_process 主入口：基础路径
# =============================================================================
class TestJsonProcessBasic:
    """验证 json_process 的基础点号路径提取。"""

    @pytest.mark.asyncio
    async def test_json_string_source(self, mock_bot, mock_event):
        """JSON 字符串源被 json.loads 解析后提取字段。"""
        result = await json_process(
            mock_bot, mock_event, source='{"name": "alice"}', expression='name',
        )
        assert result['result'] == 'alice'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_source_direct(self, mock_bot, mock_event):
        """dict 源直接使用（不经过 json.loads）。"""
        result = await json_process(
            mock_bot, mock_event, source={"age": 18}, expression='age',
        )
        assert result['result'] == 18
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_nested_path_extraction(self, mock_bot, mock_event):
        """嵌套路径 a.b.c 提取成功。"""
        source = json.dumps({"a": {"b": {"c": "deep"}}})
        result = await json_process(
            mock_bot, mock_event, source=source, expression='a.b.c',
        )
        assert result['result'] == 'deep'

    @pytest.mark.asyncio
    async def test_dollar_prefix_expression(self, mock_bot, mock_event):
        """$. 前缀表达式正常工作。"""
        result = await json_process(
            mock_bot, mock_event, source='{"x": 99}', expression='$.x',
        )
        assert result['result'] == 99

    @pytest.mark.asyncio
    async def test_missing_key_returns_none(self, mock_bot, mock_event):
        """查找不存在的 key 返回 None，不报错。"""
        result = await json_process(
            mock_bot, mock_event, source='{"a": 1}', expression='b',
        )
        assert result['result'] is None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_list_index_extraction(self, mock_bot, mock_event):
        """列表索引通过点号路径提取。"""
        source = json.dumps({"items": ["first", "second", "third"]})
        result = await json_process(
            mock_bot, mock_event, source=source, expression='items.0',
        )
        assert result['result'] == 'first'


# =============================================================================
# json_process：空表达式与默认值
# =============================================================================
class TestEmptyAndDefaultExpression:
    """验证空表达式与默认 expression 行为。"""

    @pytest.mark.asyncio
    async def test_empty_expression_returns_parsed(self, mock_bot, mock_event):
        """空 expression 跳过提取，返回整个解析后的 JSON。"""
        result = await json_process(
            mock_bot, mock_event, source='{"a": 1, "b": 2}', expression='',
        )
        assert result['result'] == {"a": 1, "b": 2}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_expression_is_dollar_key(self, mock_bot, mock_event):
        """不传 expression 时使用默认值 '$.key'。"""
        result = await json_process(
            mock_bot, mock_event, source='{"key": "default_value"}',
        )
        assert result['result'] == 'default_value'

    @pytest.mark.asyncio
    async def test_default_expression_missing_key(self, mock_bot, mock_event):
        """默认 expression '$.key' 在源无 key 字段时返回 None。"""
        result = await json_process(
            mock_bot, mock_event, source='{"other": 1}',
        )
        assert result['result'] is None


# =============================================================================
# json_process：高级 JSONPath（fallback 路径）
# =============================================================================
class TestAdvancedJsonPathFallback:
    """验证 jsonpath_ng 未安装时高级表达式的 fallback 行为。

    当 is_advanced=True 但 jsonpath_ng 未安装时，_jsonpath_lookup 抛 ImportError，
    外层捕获后回退到 _dot_path_lookup。_dot_path_lookup 对含 [*] / .. 等语法
    的表达式无法正确解析，通常返回 None。
    """

    @pytest.mark.asyncio
    async def test_advanced_expression_returns_no_error(self, mock_bot, mock_event):
        """高级表达式在 jsonpath_ng 未安装时不报错（fallback 到 dot_path）。"""
        try:
            import jsonpath_ng  # noqa: F401
            pytest.skip("jsonpath_ng 已安装，跳过 fallback 测试")
        except ImportError:
            pass

        source = json.dumps({"items": [{"id": 1}, {"id": 2}]})
        result = await json_process(
            mock_bot, mock_event, source=source, expression='$.items[*].id',
        )
        # fallback 到 _dot_path_lookup，无法解析 [*] 语法 → 返回 None
        assert result['error'] == ''
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_recursive_descent_fallback(self, mock_bot, mock_event):
        """$..name 递归下降表达式在未安装时 fallback。"""
        try:
            import jsonpath_ng  # noqa: F401
            pytest.skip("jsonpath_ng 已安装，跳过 fallback 测试")
        except ImportError:
            pass

        source = json.dumps({"a": {"name": "x"}, "b": {"name": "y"}})
        result = await json_process(
            mock_bot, mock_event, source=source, expression='$..name',
        )
        # fallback 后表达式被裁剪为 '..name'，split('.')=['','','name']，第一段空 key → None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_bracket_index_fallback(self, mock_bot, mock_event):
        """$.store.book[0] 带方括号索引的表达式 fallback。"""
        try:
            import jsonpath_ng  # noqa: F401
            pytest.skip("jsonpath_ng 已安装，跳过 fallback 测试")
        except ImportError:
            pass

        source = json.dumps({"store": {"book": ["a", "b"]}})
        result = await json_process(
            mock_bot, mock_event, source=source, expression='$.store.book[0]',
        )
        # fallback 后 'store.book[0]' 不是合法 dict key → None
        assert result['error'] == ''


# =============================================================================
# json_process：错误处理与边界
# =============================================================================
class TestErrorHandling:
    """验证异常捕获与边界条件。"""

    @pytest.mark.asyncio
    async def test_invalid_json_string_returns_error(self, mock_bot, mock_event):
        """非法 JSON 字符串返回 error 信息。"""
        result = await json_process(
            mock_bot, mock_event, source='not a json', expression='a',
        )
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_none_source_returns_none_result(self, mock_bot, mock_event):
        """source=None 不抛异常，parsed=None，在 None 上查找返回 None。

        源码逻辑：json.loads(source) if isinstance(source, str) else source
        None 不是 str → parsed=None → _dot_path_lookup(None, 'a') 在非 dict/list
        上直接返回 None。
        """
        result = await json_process(
            mock_bot, mock_event, source=None, expression='a',
        )
        assert result['result'] is None
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_list_source_with_path(self, mock_bot, mock_event):
        """list 源通过点号路径提取（数字索引）。"""
        result = await json_process(
            mock_bot, mock_event, source='[10, 20, 30]', expression='1',
        )
        # _dot_path_lookup 在 list 上若 key.isdigit() 则索引访问
        assert result['result'] == 20
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_list_source_direct(self, mock_bot, mock_event):
        """list 源 + 空表达式返回整个 list。"""
        result = await json_process(
            mock_bot, mock_event, source=[1, 2, 3], expression='',
        )
        assert result['result'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_scalar_source_with_empty_expression(self, mock_bot, mock_event):
        """标量源 + 空表达式返回标量本身。"""
        result = await json_process(
            mock_bot, mock_event, source=42, expression='',
        )
        assert result['result'] == 42
