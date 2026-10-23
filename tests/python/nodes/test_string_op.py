"""string_op 节点单元测试。

覆盖 12 种 mode：length/upper/lower/contains/replace/substring/split/
starts_with/ends_with/trim/count/index_of/find，以及未知 mode 与异常路径。

被测源码：qqbat_nodes/builtin/string_op.py
"""
import pytest

from qqbat_nodes.builtin.string_op import string_op


# =============================================================================
# 基础变换 mode
# =============================================================================
class TestBasicModes:
    """验证 length / upper / lower / trim。"""

    @pytest.mark.asyncio
    async def test_length(self, mock_bot, mock_event):
        result = await string_op(mock_bot, mock_event, mode='length', text='hello')
        assert result['result'] == 5
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_length_empty_string(self, mock_bot, mock_event):
        result = await string_op(mock_bot, mock_event, mode='length', text='')
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_length_unicode(self, mock_bot, mock_event):
        """中文字符每个算 1 个长度（Python len 按 code point）。"""
        result = await string_op(mock_bot, mock_event, mode='length', text='你好世界')
        assert result['result'] == 4

    @pytest.mark.asyncio
    async def test_upper(self, mock_bot, mock_event):
        result = await string_op(mock_bot, mock_event, mode='upper', text='hello WORLD')
        assert result['result'] == 'HELLO WORLD'

    @pytest.mark.asyncio
    async def test_lower(self, mock_bot, mock_event):
        result = await string_op(mock_bot, mock_event, mode='lower', text='Hello WORLD')
        assert result['result'] == 'hello world'

    @pytest.mark.asyncio
    async def test_trim(self, mock_bot, mock_event):
        result = await string_op(mock_bot, mock_event, mode='trim', text='  hello  \n\t')
        assert result['result'] == 'hello'


# =============================================================================
# contains / starts_with / ends_with / count / find / index_of
# =============================================================================
class TestSearchModes:
    """验证子串查找类 mode。"""

    @pytest.mark.asyncio
    async def test_contains_true(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='contains', text='hello world', arg1='world',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_contains_false(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='contains', text='hello world', arg1='xyz',
        )
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_starts_with_true(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='starts_with', text='hello', arg1='he',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_starts_with_false(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='starts_with', text='hello', arg1='lo',
        )
        assert result['result'] is False

    @pytest.mark.asyncio
    async def test_ends_with_true(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='ends_with', text='hello', arg1='lo',
        )
        assert result['result'] is True

    @pytest.mark.asyncio
    async def test_count(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='count', text='hello world', arg1='l',
        )
        assert result['result'] == 3

    @pytest.mark.asyncio
    async def test_count_zero(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='count', text='hello', arg1='z',
        )
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_find_found(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='find', text='hello world', arg1='world',
        )
        assert result['result'] == 6

    @pytest.mark.asyncio
    async def test_find_not_found_returns_minus_one(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='find', text='hello', arg1='z',
        )
        assert result['result'] == -1

    @pytest.mark.asyncio
    async def test_index_of_found(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='index_of', text='hello', arg1='l',
        )
        assert result['result'] == 2

    @pytest.mark.asyncio
    async def test_index_of_not_found_raises_error(self, mock_bot, mock_event):
        """index_of 未找到子串时抛 ValueError，被外层捕获为 error。"""
        result = await string_op(
            mock_bot, mock_event, mode='index_of', text='hello', arg1='z',
        )
        assert result['result'] is None
        assert result['error'] != ''


# =============================================================================
# replace / substring / split
# =============================================================================
class TestTransformModes:
    """验证 replace / substring / split。"""

    @pytest.mark.asyncio
    async def test_replace(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='replace',
            text='hello world', arg1='world', arg2='python',
        )
        assert result['result'] == 'hello python'

    @pytest.mark.asyncio
    async def test_replace_no_match(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='replace',
            text='hello', arg1='xyz', arg2='abc',
        )
        assert result['result'] == 'hello'

    @pytest.mark.asyncio
    async def test_substring_with_indices(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='substring',
            text='hello world', arg1='0', arg2='5',
        )
        assert result['result'] == 'hello'

    @pytest.mark.asyncio
    async def test_substring_invalid_indices_fallback(self, mock_bot, mock_event):
        """非数字索引回退到 0 / 末尾。"""
        result = await string_op(
            mock_bot, mock_event, mode='substring',
            text='hello', arg1='abc', arg2='xyz',
        )
        assert result['result'] == 'hello'

    @pytest.mark.asyncio
    async def test_substring_negative_index(self, mock_bot, mock_event):
        """负索引切片（Python 切片语义）。"""
        result = await string_op(
            mock_bot, mock_event, mode='substring',
            text='hello', arg1='-3', arg2='5',
        )
        # 'hello'[-3:5] = 'llo'
        assert result['result'] == 'llo'

    @pytest.mark.asyncio
    async def test_split_with_separator(self, mock_bot, mock_event):
        result = await string_op(
            mock_bot, mock_event, mode='split',
            text='a,b,c', arg1=',',
        )
        assert result['result'] == ['a', 'b', 'c']

    @pytest.mark.asyncio
    async def test_split_no_separator_whitespace(self, mock_bot, mock_event):
        """arg1 为空时按空白拆分。"""
        result = await string_op(
            mock_bot, mock_event, mode='split',
            text='  hello   world  ', arg1='',
        )
        assert result['result'] == ['hello', 'world']


# =============================================================================
# 边界与异常
# =============================================================================
class TestEdgeCases:
    """验证边界条件与异常处理。"""

    @pytest.mark.asyncio
    async def test_non_string_text_converted(self, mock_bot, mock_event):
        """text 为非字符串（如 int）时被 str() 转换。"""
        result = await string_op(mock_bot, mock_event, mode='length', text=12345)
        assert result['result'] == 5

    @pytest.mark.asyncio
    async def test_none_text_treated_as_empty(self, mock_bot, mock_event):
        """text=None 时回退为空字符串。"""
        result = await string_op(mock_bot, mock_event, mode='length', text=None)
        assert result['result'] == 0

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode：返回 result=原文 + error 信息。"""
        result = await string_op(
            mock_bot, mock_event, mode='unknown_op', text='hello',
        )
        assert result['result'] == 'hello'
        assert '未知模式' in result['error']
        assert 'unknown_op' in result['error']

    @pytest.mark.asyncio
    async def test_default_mode_is_length(self, mock_bot, mock_event):
        """不传 mode 时默认 length。"""
        result = await string_op(mock_bot, mock_event, text='hello')
        assert result['result'] == 5
