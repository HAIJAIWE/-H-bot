"""switch_case 节点单元测试。

覆盖：
- 精确匹配 / 通配符 * / 数值比较匹配（>=/<=/==/!=/>/<）
- 包含匹配（逗号分隔多值）
- 默认分支（无匹配）
- 非法 cases JSON / 非 list 类型
- 空值与边界

被测源码：qqbat_nodes/builtin/switch_case.py
"""
import json

import pytest

from qqbat_nodes.builtin.switch_case import switch_case


# =============================================================================
# 精确匹配
# =============================================================================
class TestExactMatch:
    """验证精确字符串匹配。"""

    @pytest.mark.asyncio
    async def test_exact_match_string(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "admin", "label": "管理员"},
            {"match": "member", "label": "成员"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='admin', cases=cases,
        )
        assert result['matched'] == '管理员'
        assert result['matched_value'] == 'admin'
        assert result['index'] == 0
        assert result['is_default'] is False

    @pytest.mark.asyncio
    async def test_exact_match_number_as_string(self, mock_bot, mock_event):
        """数值匹配按字符串比较（'10' == '10'）。"""
        cases = json.dumps([
            {"match": "10", "label": "ten"},
            {"match": "20", "label": "twenty"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value=10, cases=cases,
        )
        assert result['matched'] == 'ten'
        assert result['index'] == 0

    @pytest.mark.asyncio
    async def test_value_whitespace_stripped(self, mock_bot, mock_event):
        """value 首尾空白被 strip 后匹配。"""
        cases = json.dumps([{"match": "admin", "label": "管理员"}])
        result = await switch_case(
            mock_bot, mock_event, value='  admin  ', cases=cases,
        )
        assert result['matched'] == '管理员'

    @pytest.mark.asyncio
    async def test_match_value_whitespace_stripped(self, mock_bot, mock_event):
        """case 的 match 字段首尾空白被 strip。"""
        cases = json.dumps([{"match": "  admin  ", "label": "管理员"}])
        result = await switch_case(
            mock_bot, mock_event, value='admin', cases=cases,
        )
        assert result['matched'] == '管理员'


# =============================================================================
# 通配符
# =============================================================================
class TestWildcardMatch:
    """验证通配符 * 匹配。"""

    @pytest.mark.asyncio
    async def test_wildcard_matches_any_value(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "admin", "label": "管理员"},
            {"match": "*", "label": "其他"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='unknown', cases=cases,
        )
        assert result['matched'] == '其他'
        assert result['matched_value'] == '*'

    @pytest.mark.asyncio
    async def test_exact_match_takes_priority_over_wildcard(self, mock_bot, mock_event):
        """精确匹配优先于通配符（顺序优先）。"""
        cases = json.dumps([
            {"match": "*", "label": "通配"},
            {"match": "admin", "label": "管理员"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='admin', cases=cases,
        )
        # * 在前面，先匹配上通配符
        assert result['matched'] == '通配'


# =============================================================================
# 数值比较匹配
# =============================================================================
class TestNumericComparison:
    """验证数值比较类 match 字段。"""

    @pytest.mark.asyncio
    async def test_greater_equal_match(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": ">=100", "label": "高等级"},
            {"match": ">=50", "label": "中等级"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='120', cases=cases,
        )
        assert result['matched'] == '高等级'

    @pytest.mark.asyncio
    async def test_less_equal_match(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "<=10", "label": "新手"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='5', cases=cases,
        )
        assert result['matched'] == '新手'

    @pytest.mark.asyncio
    async def test_equal_numeric_match(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "==100", "label": "满级"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='100', cases=cases,
        )
        assert result['matched'] == '满级'

    @pytest.mark.asyncio
    async def test_not_equal_numeric_match(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "!=0", "label": "非零"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='5', cases=cases,
        )
        assert result['matched'] == '非零'

    @pytest.mark.asyncio
    async def test_greater_than_match(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": ">10", "label": "进阶"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='15', cases=cases,
        )
        assert result['matched'] == '进阶'

    @pytest.mark.asyncio
    async def test_less_than_match(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "<10", "label": "新手"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='5', cases=cases,
        )
        assert result['matched'] == '新手'

    @pytest.mark.asyncio
    async def test_numeric_match_with_non_numeric_value_falls_through(
        self, mock_bot, mock_event,
    ):
        """value 非数字时，数值比较分支跳过（ValueError 被捕获）。"""
        cases = json.dumps([
            {"match": ">=10", "label": "高数值"},
            {"match": "*", "label": "通配"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='abc', cases=cases,
        )
        # abc 无法转 float → 数值比较分支抛 ValueError 被捕获 → 继续匹配 *
        assert result['matched'] == '通配'


# =============================================================================
# 包含匹配（逗号分隔多值）
# =============================================================================
class TestContainsMatch:
    """验证逗号分隔的多值匹配。"""

    @pytest.mark.asyncio
    async def test_multi_value_match_first(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "admin,vip,super", "label": "特权用户"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='vip', cases=cases,
        )
        assert result['matched'] == '特权用户'

    @pytest.mark.asyncio
    async def test_multi_value_match_with_whitespace(self, mock_bot, mock_event):
        """逗号分隔的每个值会 strip 首尾空白。"""
        cases = json.dumps([
            {"match": "admin, vip, super", "label": "特权用户"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='vip', cases=cases,
        )
        assert result['matched'] == '特权用户'

    @pytest.mark.asyncio
    async def test_multi_value_no_match_falls_through(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "admin,vip", "label": "特权用户"},
            {"match": "*", "label": "其他"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='guest', cases=cases,
        )
        assert result['matched'] == '其他'


# =============================================================================
# 默认分支
# =============================================================================
class TestDefaultBranch:
    """验证无匹配时返回 default。"""

    @pytest.mark.asyncio
    async def test_no_match_returns_default(self, mock_bot, mock_event):
        cases = json.dumps([
            {"match": "admin", "label": "管理员"},
            {"match": "vip", "label": "VIP"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='guest', cases=cases, default='普通用户',
        )
        assert result['matched'] == '普通用户'
        assert result['matched_value'] == '普通用户'
        assert result['index'] == -1
        assert result['is_default'] is True

    @pytest.mark.asyncio
    async def test_default_default_value(self, mock_bot, mock_event):
        """不传 default 时默认 'default'。"""
        cases = json.dumps([{"match": "x", "label": "x"}])
        result = await switch_case(
            mock_bot, mock_event, value='y', cases=cases,
        )
        assert result['matched'] == 'default'


# =============================================================================
# 异常与边界
# =============================================================================
class TestErrorAndEdgeCases:
    """验证异常路径与边界条件。"""

    @pytest.mark.asyncio
    async def test_invalid_json_cases_returns_default(self, mock_bot, mock_event):
        """非法 JSON cases 返回默认分支。"""
        result = await switch_case(
            mock_bot, mock_event, value='x', cases='not json', default='d',
        )
        assert result['matched'] == 'd'
        assert result['is_default'] is True

    @pytest.mark.asyncio
    async def test_cases_not_list_returns_default(self, mock_bot, mock_event):
        """cases 解析后非 list 返回默认分支。"""
        result = await switch_case(
            mock_bot, mock_event, value='x', cases='{"k":"v"}', default='d',
        )
        assert result['matched'] == 'd'
        assert result['is_default'] is True

    @pytest.mark.asyncio
    async def test_cases_as_list_type_directly(self, mock_bot, mock_event):
        """cases 直接传 list 类型（不经 JSON 序列化）。"""
        result = await switch_case(
            mock_bot, mock_event,
            value='admin',
            cases=[{"match": "admin", "label": "管理员"}],
        )
        assert result['matched'] == '管理员'

    @pytest.mark.asyncio
    async def test_empty_cases_returns_default(self, mock_bot, mock_event):
        """空 cases 列表返回默认分支。"""
        result = await switch_case(
            mock_bot, mock_event, value='x', cases='[]', default='d',
        )
        assert result['matched'] == 'd'
        assert result['is_default'] is True

    @pytest.mark.asyncio
    async def test_non_dict_case_item_skipped(self, mock_bot, mock_event):
        """cases 中含非 dict 项：被跳过。"""
        cases = json.dumps([123, "str", {"match": "x", "label": "matched"}])
        result = await switch_case(
            mock_bot, mock_event, value='x', cases=cases,
        )
        assert result['matched'] == 'matched'
        assert result['index'] == 2  # 第三项才匹配

    @pytest.mark.asyncio
    async def test_case_missing_label_defaults_to_case_n(self, mock_bot, mock_event):
        """case 项无 label：默认为 'case_{i}'。"""
        cases = json.dumps([{"match": "x"}])
        result = await switch_case(
            mock_bot, mock_event, value='x', cases=cases,
        )
        assert result['matched'] == 'case_0'

    @pytest.mark.asyncio
    async def test_empty_value_no_match_returns_default(self, mock_bot, mock_event):
        """空 value 不匹配任何非通配分支 → 返回 default。"""
        cases = json.dumps([{"match": "admin", "label": "管理员"}])
        result = await switch_case(
            mock_bot, mock_event, value='', cases=cases, default='匿名',
        )
        assert result['matched'] == '匿名'

    @pytest.mark.asyncio
    async def test_numeric_match_invalid_number_falls_through(self, mock_bot, mock_event):
        """>=abc 这种非法比较值：ValueError 被捕获，继续匹配后续分支。"""
        cases = json.dumps([
            {"match": ">=abc", "label": "坏分支"},
            {"match": "*", "label": "通配"},
        ])
        result = await switch_case(
            mock_bot, mock_event, value='10', cases=cases,
        )
        # >=abc 中 abc 无法 float() → 跳过 → 匹配 *
        assert result['matched'] == '通配'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        cases = json.dumps([{"match": "x", "label": "matched"}])
        result = await switch_case(
            mock_bot, mock_event, value='x', cases=cases,
        )
        assert set(result.keys()) == {'matched', 'matched_value', 'index', 'is_default'}
