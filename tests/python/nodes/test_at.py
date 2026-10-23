"""at 节点单元测试 — @提及消息段生成。

覆盖：
- dict 格式消息段（默认）
- CQ 码字符串（cq=True）
- at_all 模式（@全体成员）
- user_id 为空时回退取事件触发者
- 无可用 user_id 且未 at_all 时返回 None
- CQ 码转义（&, , ]）
- bool 字符串容错
- 返回结构完整性

被测源码：qqbat_nodes/builtin/at.py
"""
import pytest

from qqbat_nodes.builtin.at import at, _cq_escape


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestAtDictSegment:
    """验证默认 dict 格式 @消息段生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_user_id(self, mock_bot, mock_event):
        """显式传入 user_id 时生成 dict 格式 at 段。"""
        result = await at(mock_bot, mock_event, user_id='12345')
        assert result['result'] == {'type': 'at', 'data': {'qq': '12345'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_fallback_to_event(self, mock_bot, mock_event):
        """user_id 为空时回退取事件触发者 user_id。"""
        mock_event.user_id = 67890
        result = await at(mock_bot, mock_event, user_id='')
        assert result['result'] == {'type': 'at', 'data': {'qq': '67890'}}

    @pytest.mark.asyncio
    async def test_dict_segment_int_event_user_id(self, mock_bot, mock_event):
        """事件 user_id 为 int 时应转为 str。"""
        mock_event.user_id = 11111
        result = await at(mock_bot, mock_event, user_id='')
        assert result['result']['data']['qq'] == '11111'


# =============================================================================
# CQ 码格式
# =============================================================================
class TestAtCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_user_id(self, mock_bot, mock_event):
        """cq=True 返回 [CQ:at,qq=xxx] 字符串。"""
        result = await at(mock_bot, mock_event, user_id='12345', cq=True)
        assert result['result'] == '[CQ:at,qq=12345]'

    @pytest.mark.asyncio
    async def test_cq_segment_from_event(self, mock_bot, mock_event):
        """cq=True 且 user_id 为空时从事件取 user_id。"""
        mock_event.user_id = 99999
        result = await at(mock_bot, mock_event, user_id='', cq=True)
        assert result['result'] == '[CQ:at,qq=99999]'


# =============================================================================
# at_all 模式
# =============================================================================
class TestAtAll:
    """验证 @全体成员模式。"""

    @pytest.mark.asyncio
    async def test_at_all_dict(self, mock_bot, mock_event):
        """at_all=True 返回 qq=all 的 dict 段。"""
        result = await at(mock_bot, mock_event, at_all=True)
        assert result['result'] == {'type': 'at', 'data': {'qq': 'all'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_at_all_cq(self, mock_bot, mock_event):
        """at_all=True + cq=True 返回 [CQ:at,qq=all]。"""
        result = await at(mock_bot, mock_event, at_all=True, cq=True)
        assert result['result'] == '[CQ:at,qq=all]'

    @pytest.mark.asyncio
    async def test_at_all_overrides_user_id(self, mock_bot, mock_event):
        """at_all=True 时忽略 user_id 参数。"""
        result = await at(mock_bot, mock_event, user_id='12345', at_all=True)
        assert result['result'] == {'type': 'at', 'data': {'qq': 'all'}}


# =============================================================================
# 无可用 user_id
# =============================================================================
class TestNoUserId:
    """验证无可用 user_id 且未 at_all 时的错误处理。"""

    @pytest.mark.asyncio
    async def test_no_user_id_no_at_all(self, mock_bot, mock_event):
        """user_id 为空且未 at_all 时返回 None + 错误，避免误 @全体。"""
        mock_event.user_id = ''
        result = await at(mock_bot, mock_event, user_id='')
        assert result['result'] is None
        assert '无可用 user_id' in result['error']
        assert 'at_all' in result['error']

    @pytest.mark.asyncio
    async def test_no_user_id_none_event(self, mock_bot):
        """event=None 且 user_id 为空且未 at_all 时返回 None。"""
        result = await at(mock_bot, None, user_id='')
        assert result['result'] is None


# =============================================================================
# CQ 码转义
# =============================================================================
class TestCqEscape:
    """验证 CQ 码值转义逻辑。"""

    def test_escape_ampersand(self):
        """& 应转义为 &amp;。"""
        assert _cq_escape('a&b') == 'a&amp;b'

    def test_escape_comma(self):
        """, 应转义为 &#44;。"""
        assert _cq_escape('a,b') == 'a&#44;b'

    def test_escape_bracket(self):
        """] 应转义为 &#93;。"""
        assert _cq_escape('a]b') == 'a&#93;b'

    def test_escape_order(self):
        """转义顺序：先 & 再 , 再 ]，避免二次转义。"""
        # 'a&,]' → '&' 先转义为 '&amp;'，再 ',' 转义，再 ']' 转义
        # 结果应为 'a&amp;&#44;&#93;'
        assert _cq_escape('a&,]') == 'a&amp;&#44;&#93;'

    def test_escape_non_string(self):
        """非字符串输入应先转为 str。"""
        assert _cq_escape(123) == '123'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await at(mock_bot, mock_event, user_id='1')
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await at(mock_bot, mock_event, user_id='1')
        assert result['error'] == ''
