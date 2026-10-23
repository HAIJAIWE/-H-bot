"""regex_extract 节点单元测试。

覆盖：
- 基础匹配：单个匹配 / 捕获组 / 默认 group=0
- as_list 模式：返回所有匹配 / 无匹配空列表
- 边界：空 text / 空 pattern / 无匹配 / 中文文本
- 错误处理：非法正则 / 捕获组索引越界
- 类型兼容：数字 text / 默认参数

被测源码：qqbat_nodes/builtin/regex_extract.py
"""
import pytest

from qqbat_nodes.builtin.regex_extract import regex_extract


# =============================================================================
# 基础匹配
# =============================================================================
class TestBasicMatch:
    """验证基础正则匹配与捕获组提取。"""

    @pytest.mark.asyncio
    async def test_simple_match(self, mock_bot, mock_event):
        """简单数字匹配返回整个匹配文本。"""
        result = await regex_extract(
            mock_bot, mock_event, text='hello 123 world', pattern=r'\d+',
        )
        assert result['result'] == '123'
        assert result['matched'] is True
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_group_zero(self, mock_bot, mock_event):
        """默认 group=0 返回整个匹配。"""
        result = await regex_extract(
            mock_bot, mock_event, text='2024-01-15', pattern=r'(\d+)-(\d+)-(\d+)',
        )
        assert result['result'] == '2024-01-15'
        assert result['matched'] is True

    @pytest.mark.asyncio
    async def test_group_one(self, mock_bot, mock_event):
        """group=1 返回第一个捕获组。"""
        result = await regex_extract(
            mock_bot, mock_event, text='2024-01-15',
            pattern=r'(\d+)-(\d+)-(\d+)', group=1,
        )
        assert result['result'] == '2024'

    @pytest.mark.asyncio
    async def test_group_two(self, mock_bot, mock_event):
        """group=2 返回第二个捕获组。"""
        result = await regex_extract(
            mock_bot, mock_event, text='2024-01-15',
            pattern=r'(\d+)-(\d+)-(\d+)', group=2,
        )
        assert result['result'] == '01'

    @pytest.mark.asyncio
    async def test_group_three(self, mock_bot, mock_event):
        """group=3 返回第三个捕获组。"""
        result = await regex_extract(
            mock_bot, mock_event, text='2024-01-15',
            pattern=r'(\d+)-(\d+)-(\d+)', group=3,
        )
        assert result['result'] == '15'

    @pytest.mark.asyncio
    async def test_match_at_start(self, mock_bot, mock_event):
        """匹配在文本开头。"""
        result = await regex_extract(
            mock_bot, mock_event, text='123abc', pattern=r'\d+',
        )
        assert result['result'] == '123'

    @pytest.mark.asyncio
    async def test_chinese_text_match(self, mock_bot, mock_event):
        """中文文本中的数字匹配。"""
        result = await regex_extract(
            mock_bot, mock_event, text='等级 25 经验 9900', pattern=r'\d+',
        )
        assert result['result'] == '25'

    @pytest.mark.asyncio
    async def test_word_pattern(self, mock_bot, mock_event):
        """单词模式匹配。"""
        result = await regex_extract(
            mock_bot, mock_event, text='hello world', pattern=r'\w+',
        )
        assert result['result'] == 'hello'


# =============================================================================
# as_list 模式
# =============================================================================
class TestAsListMode:
    """验证 as_list=True 时返回所有匹配。"""

    @pytest.mark.asyncio
    async def test_as_list_returns_all_matches(self, mock_bot, mock_event):
        """as_list=True 返回所有匹配列表。"""
        result = await regex_extract(
            mock_bot, mock_event, text='a1b2c3', pattern=r'\d', as_list=True,
        )
        assert result['result'] == ['1', '2', '3']
        assert result['matched'] is True

    @pytest.mark.asyncio
    async def test_as_list_no_match_returns_empty(self, mock_bot, mock_event):
        """as_list=True 无匹配返回空列表 + matched=False。"""
        result = await regex_extract(
            mock_bot, mock_event, text='abc', pattern=r'\d', as_list=True,
        )
        assert result['result'] == []
        assert result['matched'] is False

    @pytest.mark.asyncio
    async def test_as_list_with_capture_group(self, mock_bot, mock_event):
        """as_list=True 配合 group=1 提取所有捕获组。"""
        result = await regex_extract(
            mock_bot, mock_event,
            text='key1=val1&key2=val2',
            pattern=r'(\w+)=(\w+)', group=1, as_list=True,
        )
        assert result['result'] == ['key1', 'key2']

    @pytest.mark.asyncio
    async def test_as_list_single_match(self, mock_bot, mock_event):
        """as_list=True 单个匹配返回单元素列表。"""
        result = await regex_extract(
            mock_bot, mock_event, text='only 1 number', pattern=r'\d+', as_list=True,
        )
        assert result['result'] == ['1']


# =============================================================================
# 边界与无匹配
# =============================================================================
class TestEdgeCases:
    """验证边界条件与无匹配场景。"""

    @pytest.mark.asyncio
    async def test_no_match_returns_empty(self, mock_bot, mock_event):
        """无匹配返回 result='' + matched=False。"""
        result = await regex_extract(
            mock_bot, mock_event, text='hello', pattern=r'\d+',
        )
        assert result['result'] == ''
        assert result['matched'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_text_returns_empty(self, mock_bot, mock_event):
        """空 text 返回空结果，不报错。"""
        result = await regex_extract(
            mock_bot, mock_event, text='', pattern=r'\d+',
        )
        assert result['result'] == ''
        assert result['matched'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_pattern_returns_empty(self, mock_bot, mock_event):
        """空 pattern 返回空结果，不报错。"""
        result = await regex_extract(
            mock_bot, mock_event, text='hello', pattern='',
        )
        assert result['result'] == ''
        assert result['matched'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_both_empty_returns_empty(self, mock_bot, mock_event):
        """text 和 pattern 都为空返回空结果。"""
        result = await regex_extract(
            mock_bot, mock_event, text='', pattern='',
        )
        assert result['matched'] is False
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_default_args_no_match(self, mock_bot, mock_event):
        """默认参数（text='' pattern=''）返回 matched=False。"""
        result = await regex_extract(mock_bot, mock_event)
        assert result['matched'] is False
        assert result['result'] == ''


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证异常捕获。"""

    @pytest.mark.asyncio
    async def test_invalid_pattern_returns_error(self, mock_bot, mock_event):
        """非法正则表达式返回 error 信息。"""
        result = await regex_extract(
            mock_bot, mock_event, text='hello', pattern='[',
        )
        assert result['matched'] is False
        assert result['result'] == ''
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_group_index_out_of_range_returns_error(self, mock_bot, mock_event):
        """捕获组索引越界返回 error（IndexError 被捕获）。"""
        result = await regex_extract(
            mock_bot, mock_event, text='2024-01-15',
            pattern=r'(\d+)-(\d+)-(\d+)', group=5,
        )
        assert result['matched'] is False
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_group_index_out_of_range_as_list(self, mock_bot, mock_event):
        """as_list 模式下捕获组越界返回 error。"""
        result = await regex_extract(
            mock_bot, mock_event, text='key=val',
            pattern=r'(\w+)=(\w+)', group=5, as_list=True,
        )
        assert result['matched'] is False
        assert result['error'] != ''
