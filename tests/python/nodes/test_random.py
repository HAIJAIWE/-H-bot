"""random 节点单元测试。

覆盖：
- int 模式：范围随机数（默认值 / 自定义范围 / patch randint 固定结果）
- choice 模式：均匀选择（JSON 字符串 / list 类型 / 空列表）
- weighted 模式：加权选择（正常 / 空列表 / patch choices）
- 向后兼容：min/max/list kwargs 映射
- 未知模式、非法 JSON、异常捕获、返回结构完整性

被测源码：qqbat_nodes/builtin/random.py

注：源码 `import random as _random`，因此 patch 路径为
    qqbat_nodes.builtin.random._random.randint / .choice / .choices。
"""
import json
from unittest.mock import patch

import pytest

from qqbat_nodes.builtin.random import random


# =============================================================================
# int 模式
# =============================================================================
class TestIntMode:
    """验证 mode=int 的范围随机数生成。"""

    @pytest.mark.asyncio
    async def test_int_mode_default_range(self, mock_bot, mock_event):
        """int 模式默认范围 1-100。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=50):
            result = await random(mock_bot, mock_event, mode='int')
        assert result['result'] == 50
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_int_mode_custom_range(self, mock_bot, mock_event):
        """int 模式自定义范围 10-20。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=15) as m:
            result = await random(
                mock_bot, mock_event, mode='int', min_value=10, max_value=20,
            )
        assert result['result'] == 15
        m.assert_called_once_with(10, 20)

    @pytest.mark.asyncio
    async def test_int_mode_same_min_max(self, mock_bot, mock_event):
        """int 模式 min=max：结果必为该值。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=7) as m:
            result = await random(
                mock_bot, mock_event, mode='int', min_value=7, max_value=7,
            )
        assert result['result'] == 7
        m.assert_called_once_with(7, 7)

    @pytest.mark.asyncio
    async def test_int_mode_string_inputs_converted_to_int(self, mock_bot, mock_event):
        """int 模式接受字符串形式的数字（int() 转换）。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=10) as m:
            result = await random(
                mock_bot, mock_event, mode='int', min_value='5', max_value='15',
            )
        assert result['result'] == 10
        m.assert_called_once_with(5, 15)

    @pytest.mark.asyncio
    async def test_int_mode_backward_compat_min_max_kwargs(self, mock_bot, mock_event):
        """向后兼容：min/max kwargs 覆盖 min_value/max_value。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=25) as m:
            result = await random(
                mock_bot, mock_event, mode='int',
                min_value=1, max_value=100, min=20, max=30,
            )
        assert result['result'] == 25
        m.assert_called_once_with(20, 30)

    @pytest.mark.asyncio
    async def test_int_mode_only_min_kwarg(self, mock_bot, mock_event):
        """只传 min kwargs：min 覆盖 min_value，max_value 用默认。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=50) as m:
            result = await random(
                mock_bot, mock_event, mode='int', min=10,
            )
        assert result['result'] == 50
        m.assert_called_once_with(10, 100)  # max_value 默认 100

    @pytest.mark.asyncio
    async def test_int_mode_only_max_kwarg(self, mock_bot, mock_event):
        """只传 max kwargs：max 覆盖 max_value，min_value 用默认。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=5) as m:
            result = await random(
                mock_bot, mock_event, mode='int', max=10,
            )
        assert result['result'] == 5
        m.assert_called_once_with(1, 10)  # min_value 默认 1

    @pytest.mark.asyncio
    async def test_int_mode_result_in_range(self, mock_bot, mock_event):
        """int 模式结果在 [min, max] 范围内。"""
        # 不 patch，使用真实随机数，验证范围
        result = await random(
            mock_bot, mock_event, mode='int', min_value=1, max_value=6,
        )
        assert 1 <= result['result'] <= 6
        assert result['error'] == ''


# =============================================================================
# choice 模式
# =============================================================================
class TestChoiceMode:
    """验证 mode=choice 的均匀选择。"""

    @pytest.mark.asyncio
    async def test_choice_mode_json_string(self, mock_bot, mock_event):
        """choice 模式：JSON 字符串列表。"""
        with patch('qqbat_nodes.builtin.random._random.choice', return_value='b') as m:
            result = await random(
                mock_bot, mock_event, mode='choice', items='["a", "b", "c"]',
            )
        assert result['result'] == 'b'
        assert result['error'] == ''
        m.assert_called_once_with(['a', 'b', 'c'])

    @pytest.mark.asyncio
    async def test_choice_mode_list_type(self, mock_bot, mock_event):
        """choice 模式：直接传 list 类型。"""
        with patch('qqbat_nodes.builtin.random._random.choice', return_value=2):
            result = await random(
                mock_bot, mock_event, mode='choice', items=[1, 2, 3],
            )
        assert result['result'] == 2

    @pytest.mark.asyncio
    async def test_choice_mode_backward_compat_list_kwarg(self, mock_bot, mock_event):
        """向后兼容：list kwargs 覆盖 items。"""
        with patch('qqbat_nodes.builtin.random._random.choice', return_value='x') as m:
            result = await random(
                mock_bot, mock_event, mode='choice',
                items='["default"]', list=['x', 'y', 'z'],
            )
        assert result['result'] == 'x'
        m.assert_called_once_with(['x', 'y', 'z'])

    @pytest.mark.asyncio
    async def test_choice_mode_empty_list_returns_error(self, mock_bot, mock_event):
        """choice 模式：空列表返回 '列表为空' 错误。"""
        result = await random(
            mock_bot, mock_event, mode='choice', items='[]',
        )
        assert result['result'] is None
        assert result['error'] == '列表为空'

    @pytest.mark.asyncio
    async def test_choice_mode_empty_list_type(self, mock_bot, mock_event):
        """choice 模式：空 list 类型返回错误。"""
        result = await random(
            mock_bot, mock_event, mode='choice', items=[],
        )
        assert result['result'] is None
        assert result['error'] == '列表为空'

    @pytest.mark.asyncio
    async def test_choice_mode_mixed_types(self, mock_bot, mock_event):
        """choice 模式：混合类型列表。"""
        with patch('qqbat_nodes.builtin.random._random.choice', return_value=42):
            result = await random(
                mock_bot, mock_event, mode='choice', items='[1, "a", true, null]',
            )
        assert result['result'] == 42

    @pytest.mark.asyncio
    async def test_choice_mode_invalid_json_returns_error(self, mock_bot, mock_event):
        """choice 模式：非法 JSON 字符串返回错误。"""
        result = await random(
            mock_bot, mock_event, mode='choice', items='not json',
        )
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_choice_mode_single_element(self, mock_bot, mock_event):
        """choice 模式：单元素列表。"""
        with patch('qqbat_nodes.builtin.random._random.choice', return_value='only'):
            result = await random(
                mock_bot, mock_event, mode='choice', items='["only"]',
            )
        assert result['result'] == 'only'


# =============================================================================
# weighted 模式
# =============================================================================
class TestWeightedMode:
    """验证 mode=weighted 的加权选择。"""

    @pytest.mark.asyncio
    async def test_weighted_mode_normal(self, mock_bot, mock_event):
        """weighted 模式：正常加权选择。"""
        items = json.dumps([
            {"value": "common", "weight": 70},
            {"value": "rare", "weight": 20},
            {"value": "legendary", "weight": 10},
        ])
        with patch('qqbat_nodes.builtin.random._random.choices', return_value=['rare']) as m:
            result = await random(
                mock_bot, mock_event, mode='weighted', items=items,
            )
        assert result['result'] == 'rare'
        assert result['error'] == ''
        # 验证传给 choices 的参数
        call_args = m.call_args
        assert call_args.args[0] == ['common', 'rare', 'legendary']
        assert call_args.kwargs['weights'] == [70, 20, 10]
        assert call_args.kwargs['k'] == 1

    @pytest.mark.asyncio
    async def test_weighted_mode_dict_items(self, mock_bot, mock_event):
        """weighted 模式：直接传 list 类型。"""
        items = [
            {"value": 1, "weight": 1},
            {"value": 2, "weight": 1},
        ]
        with patch('qqbat_nodes.builtin.random._random.choices', return_value=[2]):
            result = await random(
                mock_bot, mock_event, mode='weighted', items=items,
            )
        assert result['result'] == 2

    @pytest.mark.asyncio
    async def test_weighted_mode_empty_list_returns_error(self, mock_bot, mock_event):
        """weighted 模式：空列表返回错误。"""
        result = await random(
            mock_bot, mock_event, mode='weighted', items='[]',
        )
        assert result['result'] is None
        assert result['error'] == '列表为空'

    @pytest.mark.asyncio
    async def test_weighted_mode_default_weight(self, mock_bot, mock_event):
        """weighted 模式：缺少 weight 字段时默认为 1。"""
        items = json.dumps([
            {"value": "a"},
            {"value": "b", "weight": 5},
        ])
        with patch('qqbat_nodes.builtin.random._random.choices', return_value=['b']) as m:
            result = await random(
                mock_bot, mock_event, mode='weighted', items=items,
            )
        assert result['result'] == 'b'
        # 第一个元素 weight 默认为 1
        assert m.call_args.kwargs['weights'] == [1, 5]

    @pytest.mark.asyncio
    async def test_weighted_mode_invalid_json(self, mock_bot, mock_event):
        """weighted 模式：非法 JSON 返回错误。"""
        result = await random(
            mock_bot, mock_event, mode='weighted', items='{invalid',
        )
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_weighted_mode_single_item(self, mock_bot, mock_event):
        """weighted 模式：单元素列表。"""
        items = json.dumps([{"value": "only", "weight": 100}])
        with patch('qqbat_nodes.builtin.random._random.choices', return_value=['only']):
            result = await random(
                mock_bot, mock_event, mode='weighted', items=items,
            )
        assert result['result'] == 'only'


# =============================================================================
# 未知模式与异常
# =============================================================================
class TestUnknownModeAndErrors:
    """验证未知模式和异常处理。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知模式返回 '未知模式' 错误。"""
        result = await random(mock_bot, mock_event, mode='unknown')
        assert result['result'] is None
        assert '未知模式' in result['error']
        assert 'unknown' in result['error']

    @pytest.mark.asyncio
    async def test_empty_mode_defaults_to_int(self, mock_bot, mock_event):
        """空 mode 字符串：不匹配任何分支 → 返回未知模式错误。

        注：源码用 if/elif/else，空字符串不等于 'int'/'choice'/'weighted'，
            走 else 分支返回 '未知模式: '。
        """
        result = await random(mock_bot, mock_event, mode='')
        assert result['result'] is None
        assert '未知模式' in result['error']

    @pytest.mark.asyncio
    async def test_int_mode_invalid_string_number(self, mock_bot, mock_event):
        """int 模式：min_value 非数字字符串 → int() 抛 ValueError 被捕获。"""
        result = await random(
            mock_bot, mock_event, mode='int', min_value='abc', max_value='10',
        )
        assert result['result'] is None
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_choice_mode_items_not_json_nor_list(self, mock_bot, mock_event):
        """choice 模式：items 既非 JSON 字符串也非 list（如 int）。"""
        result = await random(
            mock_bot, mock_event, mode='choice', items=12345,
        )
        assert result['result'] is None
        assert result['error'] != ''


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 result/error 两个字段。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=1):
            result = await random(mock_bot, mock_event, mode='int')
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=50):
            result = await random(mock_bot, mock_event, mode='int')
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_mode_is_int(self, mock_bot, mock_event):
        """不传 mode 时默认为 'int'。"""
        with patch('qqbat_nodes.builtin.random._random.randint', return_value=42) as m:
            result = await random(mock_bot, mock_event)
        assert result['result'] == 42
        m.assert_called_once_with(1, 100)  # 默认 min=1, max=100
