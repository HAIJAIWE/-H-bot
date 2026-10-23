"""list_op 节点单元测试。

覆盖 12 种 mode：append/remove/contains/size/get/sort/reverse/unique/merge/
slice/insert/index_of/pop，以及未知 mode、边界、异常路径。

被测源码：qqbat_nodes/builtin/list_op.py
"""
import pytest

from qqbat_nodes.builtin.list_op import list_op, _make_result


# =============================================================================
# 辅助函数 _make_result
# =============================================================================
class TestMakeResult:
    """验证返回结构构造函数。"""

    def test_make_result_structure(self):
        result = _make_result([1, 2], changed=True, count=2, total=1)
        assert result['result'] == [1, 2]
        assert result['changed'] is True
        assert result['count'] == 2
        assert result['total'] == 1
        assert result['error'] == ''

    def test_make_result_with_error(self):
        result = _make_result(None, changed=False, count=0, total=0, error='失败')
        assert result['error'] == '失败'


# =============================================================================
# 增删类 mode
# =============================================================================
class TestAppendRemove:
    """验证 append / remove / insert / pop。"""

    @pytest.mark.asyncio
    async def test_append(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='append',
            source_list=[1, 2], item=3,
        )
        assert result['result'] == [1, 2, 3]
        assert result['changed'] is True
        assert result['count'] == 3
        assert result['total'] == 2

    @pytest.mark.asyncio
    async def test_remove_existing(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='remove',
            source_list=[1, 2, 3], item=2,
        )
        assert result['result'] == [1, 3]
        assert result['changed'] is True

    @pytest.mark.asyncio
    async def test_remove_non_existing_no_change(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='remove',
            source_list=[1, 2, 3], item=99,
        )
        assert result['result'] == [1, 2, 3]
        assert result['changed'] is False

    @pytest.mark.asyncio
    async def test_insert_at_index(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='insert',
            source_list=[1, 3], item=2, index=1,
        )
        assert result['result'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_insert_default_at_head(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='insert',
            source_list=[2, 3], item=1,
        )
        assert result['result'] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_insert_negative_index_clamped(self, mock_bot, mock_event):
        """负索引被夹紧到合法范围。"""
        result = await list_op(
            mock_bot, mock_event, mode='insert',
            source_list=[1, 2], item=99, index=-10,
        )
        # max(0, 2 + -10) = max(0, -8) = 0
        assert result['result'] == [99, 1, 2]

    @pytest.mark.asyncio
    async def test_insert_out_of_range_clamped_to_end(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='insert',
            source_list=[1, 2], item=99, index=100,
        )
        assert result['result'] == [1, 2, 99]

    @pytest.mark.asyncio
    async def test_pop_default_last(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='pop',
            source_list=[1, 2, 3],
        )
        assert result['result'] == 3
        assert result['changed'] is True

    @pytest.mark.asyncio
    async def test_pop_at_index(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='pop',
            source_list=[1, 2, 3], index=0,
        )
        assert result['result'] == 1

    @pytest.mark.asyncio
    async def test_pop_empty_list_returns_error(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='pop',
            source_list=[],
        )
        assert result['result'] is None
        assert result['changed'] is False
        assert '列表为空' in result['error']

    @pytest.mark.asyncio
    async def test_pop_out_of_range_returns_error(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='pop',
            source_list=[1, 2], index=10,
        )
        assert result['result'] is None
        assert '索引越界' in result['error']


# =============================================================================
# 查询类 mode
# =============================================================================
class TestQueryModes:
    """验证 contains / size / get / index_of。"""

    @pytest.mark.asyncio
    async def test_contains_true(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='contains',
            source_list=[1, 2, 3], item=2,
        )
        assert result['result'] is True
        assert result['count'] == 1

    @pytest.mark.asyncio
    async def test_contains_false(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='contains',
            source_list=[1, 2, 3], item=99,
        )
        assert result['result'] is False
        assert result['count'] == 0

    @pytest.mark.asyncio
    async def test_size(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='size',
            source_list=[1, 2, 3],
        )
        assert result['result'] == 3
        assert result['count'] == 3

    @pytest.mark.asyncio
    async def test_size_empty_list(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='size',
            source_list=[],
        )
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_get_valid_index(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='get',
            source_list=['a', 'b', 'c'], index=1,
        )
        assert result['result'] == 'b'

    @pytest.mark.asyncio
    async def test_get_default_index_zero(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='get',
            source_list=['a', 'b', 'c'],
        )
        assert result['result'] == 'a'

    @pytest.mark.asyncio
    async def test_get_negative_index(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='get',
            source_list=['a', 'b', 'c'], index=-1,
        )
        assert result['result'] == 'c'

    @pytest.mark.asyncio
    async def test_get_out_of_range_returns_error(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='get',
            source_list=['a', 'b'], index=10,
        )
        assert result['result'] is None
        assert '索引越界' in result['error']

    @pytest.mark.asyncio
    async def test_index_of_found(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='index_of',
            source_list=[1, 2, 3], item=2,
        )
        assert result['result'] == 1

    @pytest.mark.asyncio
    async def test_index_of_not_found_returns_minus_one(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='index_of',
            source_list=[1, 2, 3], item=99,
        )
        assert result['result'] == -1


# =============================================================================
# 变换类 mode
# =============================================================================
class TestTransformModes:
    """验证 sort / reverse / unique / merge / slice。"""

    @pytest.mark.asyncio
    async def test_sort(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='sort',
            source_list=[3, 1, 2],
        )
        assert result['result'] == [1, 2, 3]
        assert result['changed'] is True

    @pytest.mark.asyncio
    async def test_reverse(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='reverse',
            source_list=[1, 2, 3],
        )
        assert result['result'] == [3, 2, 1]

    @pytest.mark.asyncio
    async def test_unique_with_duplicates(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='unique',
            source_list=[1, 2, 2, 3, 3, 3],
        )
        assert result['result'] == [1, 2, 3]
        assert result['changed'] is True

    @pytest.mark.asyncio
    async def test_unique_no_duplicates(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='unique',
            source_list=[1, 2, 3],
        )
        assert result['result'] == [1, 2, 3]
        assert result['changed'] is False

    @pytest.mark.asyncio
    async def test_merge_two_lists(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='merge',
            source_list=[1, 2], item=[3, 4],
        )
        assert result['result'] == [1, 2, 3, 4]

    @pytest.mark.asyncio
    async def test_merge_with_non_list_item(self, mock_bot, mock_event):
        """merge 时 item 非 list 视为空 list。"""
        result = await list_op(
            mock_bot, mock_event, mode='merge',
            source_list=[1, 2], item='not a list',
        )
        assert result['result'] == [1, 2]

    @pytest.mark.asyncio
    async def test_slice(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='slice',
            source_list=[1, 2, 3, 4, 5], start=1, end=4,
        )
        assert result['result'] == [2, 3, 4]
        assert result['count'] == 3
        assert result['total'] == 5

    @pytest.mark.asyncio
    async def test_slice_out_of_range(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='slice',
            source_list=[1, 2, 3], start=0, end=100,
        )
        assert result['result'] == [1, 2, 3]


# =============================================================================
# 边界与异常
# =============================================================================
class TestEdgeCases:
    """验证边界条件与异常处理。"""

    @pytest.mark.asyncio
    async def test_non_list_source_treated_as_empty(self, mock_bot, mock_event):
        """source_list 非 list 时回退为空 list。"""
        result = await list_op(
            mock_bot, mock_event, mode='size',
            source_list='not a list',
        )
        assert result['result'] == 0
        assert result['total'] == 0

    @pytest.mark.asyncio
    async def test_none_source_treated_as_empty(self, mock_bot, mock_event):
        """source_list=None 时回退为空 list。"""
        result = await list_op(
            mock_bot, mock_event, mode='append',
            source_list=None, item=1,
        )
        assert result['result'] == [1]
        assert result['total'] == 0  # 原 list 长度为 0

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event, mode='unknown_mode',
            source_list=[1, 2],
        )
        assert result['result'] == [1, 2]
        assert '未知模式' in result['error']
        assert 'unknown_mode' in result['error']

    @pytest.mark.asyncio
    async def test_default_mode_is_append(self, mock_bot, mock_event):
        result = await list_op(
            mock_bot, mock_event,
            source_list=[1], item=2,
        )
        assert result['result'] == [1, 2]
