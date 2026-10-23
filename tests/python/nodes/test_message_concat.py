"""message_concat 节点单元测试 — 消息段拼接。

覆盖：
- list[dict] 拼接
- 单个 dict 包装为单元素列表
- JSON 字符串解析
- 空 segments 返回空列表 + 错误
- 非法 JSON 返回错误
- 非法格式（非 dict/list）返回错误
- 过滤无效项（非 dict 元素）
- count 字段正确性
- 返回结构完整性

被测源码：qqbat_nodes/builtin/message_concat.py
"""
import json

import pytest

from qqbat_nodes.builtin.message_concat import message_concat


# =============================================================================
# list 拼接
# =============================================================================
class TestListConcat:
    """验证 list[dict] 拼接逻辑。"""

    @pytest.mark.asyncio
    async def test_concat_multiple_segments(self, mock_bot, mock_event):
        """多个消息段拼接为列表。"""
        segs = [
            {'type': 'text', 'data': {'text': 'hello'}},
            {'type': 'at', 'data': {'qq': '123'}},
        ]
        result = await message_concat(mock_bot, mock_event, segments=segs)
        assert result['result'] == segs
        assert result['count'] == 2
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_concat_single_segment_list(self, mock_bot, mock_event):
        """单元素列表拼接。"""
        segs = [{'type': 'text', 'data': {'text': 'hi'}}]
        result = await message_concat(mock_bot, mock_event, segments=segs)
        assert result['count'] == 1
        assert result['result'] == segs


# =============================================================================
# 单个 dict 包装
# =============================================================================
class TestSingleDictWrap:
    """验证单个 dict 包装为单元素列表。"""

    @pytest.mark.asyncio
    async def test_single_dict_wrapped(self, mock_bot, mock_event):
        """单个 dict 被包装为 [dict]。"""
        seg = {'type': 'at', 'data': {'qq': '123'}}
        result = await message_concat(mock_bot, mock_event, segments=seg)
        assert result['result'] == [seg]
        assert result['count'] == 1


# =============================================================================
# JSON 字符串解析
# =============================================================================
class TestJsonStringParse:
    """验证 JSON 字符串解析。"""

    @pytest.mark.asyncio
    async def test_valid_json_string(self, mock_bot, mock_event):
        """合法 JSON 字符串解析为 list。"""
        segs = [
            {'type': 'text', 'data': {'text': 'a'}},
            {'type': 'text', 'data': {'text': 'b'}},
        ]
        result = await message_concat(
            mock_bot, mock_event, segments=json.dumps(segs)
        )
        assert result['result'] == segs
        assert result['count'] == 2

    @pytest.mark.asyncio
    async def test_empty_json_string(self, mock_bot, mock_event):
        """空字符串返回空列表 + 错误。"""
        result = await message_concat(mock_bot, mock_event, segments='')
        assert result['result'] == []
        assert result['count'] == 0
        assert '不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_whitespace_json_string(self, mock_bot, mock_event):
        """纯空白字符串返回空列表 + 错误。"""
        result = await message_concat(mock_bot, mock_event, segments='   ')
        assert result['result'] == []
        assert '不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_json_string(self, mock_bot, mock_event):
        """非法 JSON 字符串返回错误。"""
        result = await message_concat(mock_bot, mock_event, segments='not a json')
        assert result['result'] == []
        assert 'JSON 解析失败' in result['error']


# =============================================================================
# 空参数
# =============================================================================
class TestEmptySegments:
    """验证空 segments 的处理。"""

    @pytest.mark.asyncio
    async def test_none_segments(self, mock_bot, mock_event):
        """segments=None 返回空列表 + 错误。"""
        result = await message_concat(mock_bot, mock_event, segments=None)
        assert result['result'] == []
        assert result['count'] == 0
        assert '不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_list(self, mock_bot, mock_event):
        """空列表返回空列表 + 错误。"""
        result = await message_concat(mock_bot, mock_event, segments=[])
        assert result['result'] == []
        assert '不能为空' in result['error']


# =============================================================================
# 非法格式
# =============================================================================
class TestInvalidFormat:
    """验证非法格式的处理。"""

    @pytest.mark.asyncio
    async def test_int_segments(self, mock_bot, mock_event):
        """segments 为 int 时返回格式错误。"""
        result = await message_concat(mock_bot, mock_event, segments=12345)
        assert result['result'] == []
        assert '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_string_segments(self, mock_bot, mock_event):
        """segments 为非 JSON 字符串（经 JSON 解析后是 str）时返回格式错误。"""
        result = await message_concat(mock_bot, mock_event, segments='"just a string"')
        assert result['result'] == []
        assert '格式错误' in result['error']


# =============================================================================
# 过滤无效项
# =============================================================================
class TestFilterInvalidItems:
    """验证列表中非 dict 元素的过滤。"""

    @pytest.mark.asyncio
    async def test_filter_non_dict_items(self, mock_bot, mock_event):
        """列表中的非 dict 元素被过滤。"""
        segs = [
            {'type': 'text', 'data': {'text': 'a'}},
            'invalid_string',
            123,
            {'type': 'at', 'data': {'qq': '1'}},
        ]
        result = await message_concat(mock_bot, mock_event, segments=segs)
        assert result['count'] == 2
        assert result['result'] == [
            {'type': 'text', 'data': {'text': 'a'}},
            {'type': 'at', 'data': {'qq': '1'}},
        ]

    @pytest.mark.asyncio
    async def test_all_invalid_items(self, mock_bot, mock_event):
        """列表中全是非 dict 元素时 count=0。"""
        result = await message_concat(
            mock_bot, mock_event, segments=['a', 1, 2, None]
        )
        assert result['count'] == 0
        assert result['result'] == []


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_fields(self, mock_bot, mock_event):
        """返回 dict 必含 result/count/error 字段。"""
        result = await message_concat(
            mock_bot, mock_event, segments=[{'type': 'text', 'data': {}}]
        )
        assert set(result.keys()) == {'result', 'count', 'error'}

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await message_concat(
            mock_bot, mock_event, segments=[{'type': 'text', 'data': {}}]
        )
        assert result['error'] == ''
