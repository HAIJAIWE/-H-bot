"""reply_segment 节点单元测试 — 引用回复消息段生成。

覆盖：
- dict 格式消息段（默认）
- CQ 码字符串（cq=True）
- message_id 为空时回退取事件消息 ID
- 无可用 message_id 时返回 None + 错误
- bool 字符串容错
- message_id int/str 类型转换
- 返回结构完整性

被测源码：qqbat_nodes/builtin/reply_segment.py
"""
import pytest

from qqbat_nodes.builtin.reply_segment import reply_segment


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestReplyDictSegment:
    """验证默认 dict 格式引用回复消息段生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_message_id(self, mock_bot, mock_event):
        """显式传入 message_id 时生成 dict 格式 reply 段。"""
        result = await reply_segment(mock_bot, mock_event, message_id='12345')
        assert result['result'] == {'type': 'reply', 'data': {'id': '12345'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_fallback_to_event(self, mock_bot, mock_event):
        """message_id 为空时回退取事件 message_id。"""
        mock_event.message_id = 99999
        result = await reply_segment(mock_bot, mock_event, message_id='')
        assert result['result'] == {'type': 'reply', 'data': {'id': '99999'}}

    @pytest.mark.asyncio
    async def test_dict_segment_int_event_message_id(self, mock_bot, mock_event):
        """事件 message_id 为 int 时应转为 str。"""
        mock_event.message_id = 88888
        result = await reply_segment(mock_bot, mock_event, message_id='')
        assert result['result']['data']['id'] == '88888'


# =============================================================================
# CQ 码格式
# =============================================================================
class TestReplyCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_message_id(self, mock_bot, mock_event):
        """cq=True 返回 [CQ:reply,id=xxx] 字符串。"""
        result = await reply_segment(mock_bot, mock_event, message_id='12345', cq=True)
        assert result['result'] == '[CQ:reply,id=12345]'

    @pytest.mark.asyncio
    async def test_cq_segment_from_event(self, mock_bot, mock_event):
        """cq=True 且 message_id 为空时从事件取 message_id。"""
        mock_event.message_id = 77777
        result = await reply_segment(mock_bot, mock_event, message_id='', cq=True)
        assert result['result'] == '[CQ:reply,id=77777]'


# =============================================================================
# 无可用 message_id
# =============================================================================
class TestNoMessageId:
    """验证无可用 message_id 时的错误处理。"""

    @pytest.mark.asyncio
    async def test_no_message_id_no_event(self, mock_bot, mock_event):
        """message_id 为空且事件无 message_id 时返回 None + 错误。"""
        mock_event.message_id = ''
        result = await reply_segment(mock_bot, mock_event, message_id='')
        assert result['result'] is None
        assert '无可用 message_id' in result['error']

    @pytest.mark.asyncio
    async def test_no_message_id_none_event(self, mock_bot):
        """event=None 且 message_id 为空时返回 None。"""
        result = await reply_segment(mock_bot, None, message_id='')
        assert result['result'] is None
        assert '无可用 message_id' in result['error']


# =============================================================================
# bool 字符串容错
# =============================================================================
class TestCqStringCompat:
    """验证 cq 参数为字符串时的容错处理。"""

    @pytest.mark.asyncio
    async def test_cq_string_true(self, mock_bot, mock_event):
        """cq='true' 应被解析为 True。"""
        result = await reply_segment(
            mock_bot, mock_event, message_id='123', cq='true'
        )
        assert result['result'] == '[CQ:reply,id=123]'

    @pytest.mark.asyncio
    async def test_cq_string_false(self, mock_bot, mock_event):
        """cq='false' 应被解析为 False。"""
        result = await reply_segment(
            mock_bot, mock_event, message_id='123', cq='false'
        )
        assert result['result'] == {'type': 'reply', 'data': {'id': '123'}}

    @pytest.mark.asyncio
    async def test_cq_string_yes(self, mock_bot, mock_event):
        """cq='yes' 应被解析为 True。"""
        result = await reply_segment(
            mock_bot, mock_event, message_id='123', cq='yes'
        )
        assert result['result'] == '[CQ:reply,id=123]'

    @pytest.mark.asyncio
    async def test_cq_string_with_whitespace(self, mock_bot, mock_event):
        """cq='  True  ' 应被解析为 True（带空白）。"""
        result = await reply_segment(
            mock_bot, mock_event, message_id='123', cq='  True  '
        )
        assert result['result'] == '[CQ:reply,id=123]'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await reply_segment(mock_bot, mock_event, message_id='1')
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await reply_segment(mock_bot, mock_event, message_id='1')
        assert result['error'] == ''
