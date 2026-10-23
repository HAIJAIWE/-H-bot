"""check_condition 节点单元测试。

覆盖：
- AND 逻辑：所有满足 / 任一不满足 / 空条件
- OR 逻辑：任一满足 / 全部不满足 / 空条件
- 6 种比较运算符（==/!=/>/>=/</<=）
- 数值比较与字符串比较
- 未知运算符、未知 logic 回退、异常捕获

被测源码：qqbat_nodes/builtin/check_condition.py
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.check_condition import check_condition


def _mock_load(value):
    """构造 load_persistent mock，返回 {"result": value, "error": ""}。"""
    return AsyncMock(return_value={"result": value, "error": ""})


def _mock_load_dynamic(value_map):
    """根据 key 返回不同值的 load_persistent mock。"""
    async def _load(*args, **kwargs):
        key = kwargs.get('key', '')
        return {"result": value_map.get(key), "error": ""}
    return _load


# =============================================================================
# AND 逻辑
# =============================================================================
class TestAndLogic:
    """验证 logic='and' 的条件检查。"""

    @pytest.mark.asyncio
    async def test_all_conditions_met_returns_true(self, mock_bot, mock_event):
        """AND：所有条件都满足 → result=True。"""
        load_mock = _mock_load_dynamic({"level": 50, "gold": 200})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='['
                '{"label":"等级","key":"level","op":">=","value":10},'
                '{"label":"金币","key":"gold","op":">=","value":100}'
                ']',
                logic='and',
            )
        assert result['result'] is True
        assert result['failed'] == ''
        assert result['failed_key'] == ''
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_first_condition_fails_returns_false(self, mock_bot, mock_event):
        """AND：第一个条件不满足立即返回 False，failed 含 label。"""
        load_mock = _mock_load_dynamic({"level": 5})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='['
                '{"label":"等级","key":"level","op":">=","value":10},'
                '{"label":"金币","key":"gold","op":">=","value":100}'
                ']',
                logic='and',
            )
        assert result['result'] is False
        assert result['failed_key'] == 'level'
        assert '等级不足' in result['failed']
        assert '需要' in result['failed']
        assert '当前' in result['failed']

    @pytest.mark.asyncio
    async def test_empty_conditions_returns_true(self, mock_bot, mock_event):
        """AND：空条件视为全部满足（vacuous truth）。"""
        result = await check_condition(
            mock_bot, mock_event, conditions='[]', logic='and',
        )
        assert result['result'] is True


# =============================================================================
# OR 逻辑
# =============================================================================
class TestOrLogic:
    """验证 logic='or' 的条件检查。"""

    @pytest.mark.asyncio
    async def test_any_condition_met_returns_true(self, mock_bot, mock_event):
        """OR：任一条件满足立即返回 True。"""
        load_mock = _mock_load_dynamic({"level": 5, "vip": 1})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='['
                '{"label":"等级","key":"level","op":">=","value":10},'
                '{"label":"VIP","key":"vip","op":"==","value":1}'
                ']',
                logic='or',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_all_conditions_fail_returns_false(self, mock_bot, mock_event):
        """OR：全部不满足 → 返回最后一个不满足条件的 failed 信息。"""
        load_mock = _mock_load_dynamic({"level": 5, "vip": 0})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='['
                '{"label":"等级","key":"level","op":">=","value":10},'
                '{"label":"VIP","key":"vip","op":"==","value":1}'
                ']',
                logic='or',
            )
        assert result['result'] is False
        # 返回最后一个不满足的条件
        assert result['failed_key'] == 'vip'
        assert 'VIP不足' in result['failed']

    @pytest.mark.asyncio
    async def test_empty_conditions_returns_false(self, mock_bot, mock_event):
        """OR：空条件无任一可满足 → False。"""
        result = await check_condition(
            mock_bot, mock_event, conditions='[]', logic='or',
        )
        assert result['result'] is False


# =============================================================================
# 比较运算符
# =============================================================================
class TestComparators:
    """验证 6 种比较运算符。"""

    @pytest.mark.asyncio
    async def test_equal_operator(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(10)):
            r1 = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":"==","value":10}]',
            )
            assert r1['result'] is True
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(11)):
            r2 = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":"==","value":10}]',
            )
            assert r2['result'] is False

    @pytest.mark.asyncio
    async def test_not_equal_operator(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(11)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":"!=","value":10}]',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_greater_than_operator(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(15)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">","value":10}]',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_greater_equal_operator(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(10)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":10}]',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_less_than_operator(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(5)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":"<","value":10}]',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_less_equal_operator(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(10)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":"<=","value":10}]',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_unknown_operator_returns_false(self, mock_bot, mock_event):
        """未知运算符：返回 result=False + '未知运算符'。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(10)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":"~=","value":10}]',
            )
        assert result['result'] is False
        assert '未知运算符' in result['failed']
        assert result['failed_key'] == 'k'


# =============================================================================
# 字符串比较
# =============================================================================
class TestStringComparison:
    """验证当 value 不是数字时回退到字符串比较。"""

    @pytest.mark.asyncio
    async def test_string_equality(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load("admin")):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"角色","key":"role","op":"==","value":"admin"}]',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_string_inequality(self, mock_bot, mock_event):
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load("member")):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"角色","key":"role","op":"==","value":"admin"}]',
            )
        assert result['result'] is False


# =============================================================================
# 参数解析与默认值
# =============================================================================
class TestArgumentParsing:
    """验证 conditions 多种格式、logic 容错。"""

    @pytest.mark.asyncio
    async def test_conditions_as_list_type(self, mock_bot, mock_event):
        """conditions 直接传 list 类型。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions=[{"label": "x", "key": "k", "op": ">=", "value": 50}],
                logic='and',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_invalid_json_conditions_treated_as_empty(self, mock_bot, mock_event):
        """非法 JSON conditions 回退为空列表（AND → True）。"""
        result = await check_condition(
            mock_bot, mock_event, conditions='not json', logic='and',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_empty_string_conditions_treated_as_empty(self, mock_bot, mock_event):
        """空字符串 conditions → 空列表。"""
        result = await check_condition(
            mock_bot, mock_event, conditions='', logic='and',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_invalid_logic_falls_back_to_and(self, mock_bot, mock_event):
        """非法 logic 回退为 'and'。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":50}]',
                logic='invalid',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_logic_case_insensitive(self, mock_bot, mock_event):
        """logic 大小写不敏感。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":50}]',
                logic='AND',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_none_logic_falls_back_to_and(self, mock_bot, mock_event):
        """logic=None 回退为 'and'。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":50}]',
                logic=None,
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_none_value_treated_as_zero(self, mock_bot, mock_event):
        """load 返回 None（键不存在）→ current_value=0。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(None)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":0}]',
                logic='and',
            )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_missing_key_in_condition_skipped(self, mock_bot, mock_event):
        """条件项缺少 key：被跳过（continue）。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","op":">=","value":50}]',
                logic='and',
            )
        # 跳过空 key 项 → 空列表等价 → AND 返回 True
        assert result['result'] is True


# =============================================================================
# 异常捕获
# =============================================================================
class TestExceptionHandling:
    """验证顶层异常捕获。"""

    @pytest.mark.asyncio
    async def test_load_raises_returns_false_with_error(self, mock_bot, mock_event):
        """load_persistent 抛异常 → result=False + error 信息，不向上抛。"""
        load_mock = AsyncMock(side_effect=RuntimeError("DB down"))
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":50}]',
            )
        assert result['result'] is False
        assert 'DB down' in result['error']

    @pytest.mark.asyncio
    async def test_scope_passed_to_load(self, mock_bot, mock_event):
        """scope 参数透传给 load_persistent。"""
        load_mock = _mock_load(100)
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            await check_condition(
                mock_bot, mock_event,
                conditions='[{"label":"x","key":"k","op":">=","value":50}]',
                scope='group',
            )
        assert load_mock.call_args.kwargs['scope'] == 'group'
