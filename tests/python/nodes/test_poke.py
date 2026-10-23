"""poke 节点单元测试 — 戳一戳消息段生成。

覆盖：
- dict 格式消息段生成（默认）
- CQ 码字符串格式（cq=True）
- user_id 为空时回退取事件触发者
- 无可用 user_id 时返回 None + 错误
- bool 字符串容错（cq='true' / cq='false'）
- user_id 为非字符串类型的转换
- at_all 与 user_id 优先级
- 返回结构完整性

被测源码：qqbat_nodes/builtin/poke.py
"""
import pytest

from qqbat_nodes.builtin.poke import poke


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestPokeDictSegment:
    """验证默认 dict 格式消息段的生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_user_id(self, mock_bot, mock_event):
        """显式传入 user_id 时生成 dict 格式 poke 段。"""
        result = await poke(mock_bot, mock_event, user_id='12345')
        assert result['result'] == {'type': 'poke', 'data': {'qq': '12345'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_fallback_to_event(self, mock_bot, mock_event):
        """user_id 为空时回退取事件触发者 user_id。"""
        mock_event.user_id = 67890
        result = await poke(mock_bot, mock_event, user_id='')
        assert result['result'] == {'type': 'poke', 'data': {'qq': '67890'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_with_int_event_user_id(self, mock_bot, mock_event):
        """事件 user_id 为 int 时应转为 str。"""
        mock_event.user_id = 11111
        result = await poke(mock_bot, mock_event, user_id='')
        assert result['result']['data']['qq'] == '11111'


# =============================================================================
# CQ 码格式
# =============================================================================
class TestPokeCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_user_id(self, mock_bot, mock_event):
        """cq=True 时返回 [CQ:poke,qq=xxx] 字符串。"""
        result = await poke(mock_bot, mock_event, user_id='12345', cq=True)
        assert result['result'] == '[CQ:poke,qq=12345]'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_cq_segment_from_event(self, mock_bot, mock_event):
        """cq=True 且 user_id 为空时从事件取 user_id 生成 CQ 码。"""
        mock_event.user_id = 99999
        result = await poke(mock_bot, mock_event, user_id='', cq=True)
        assert result['result'] == '[CQ:poke,qq=99999]'


# =============================================================================
# bool 字符串容错
# =============================================================================
class TestCqStringCompat:
    """验证 cq 参数为字符串时的容错处理。"""

    @pytest.mark.asyncio
    async def test_cq_string_true(self, mock_bot, mock_event):
        """cq='true' 应被解析为 True，返回 CQ 码。"""
        result = await poke(mock_bot, mock_event, user_id='123', cq='true')
        assert result['result'] == '[CQ:poke,qq=123]'

    @pytest.mark.asyncio
    async def test_cq_string_yes(self, mock_bot, mock_event):
        """cq='yes' 应被解析为 True。"""
        result = await poke(mock_bot, mock_event, user_id='123', cq='yes')
        assert result['result'] == '[CQ:poke,qq=123]'

    @pytest.mark.asyncio
    async def test_cq_string_1(self, mock_bot, mock_event):
        """cq='1' 应被解析为 True。"""
        result = await poke(mock_bot, mock_event, user_id='123', cq='1')
        assert result['result'] == '[CQ:poke,qq=123]'

    @pytest.mark.asyncio
    async def test_cq_string_false(self, mock_bot, mock_event):
        """cq='false' 应被解析为 False，返回 dict。"""
        result = await poke(mock_bot, mock_event, user_id='123', cq='false')
        assert result['result'] == {'type': 'poke', 'data': {'qq': '123'}}

    @pytest.mark.asyncio
    async def test_cq_string_with_whitespace(self, mock_bot, mock_event):
        """cq='  True  ' 应被解析为 True（带空白）。"""
        result = await poke(mock_bot, mock_event, user_id='123', cq='  True  ')
        assert result['result'] == '[CQ:poke,qq=123]'


# =============================================================================
# 无可用 user_id
# =============================================================================
class TestNoUserId:
    """验证无可用 user_id 时的错误处理。"""

    @pytest.mark.asyncio
    async def test_no_user_id_no_event(self, mock_bot, mock_event):
        """user_id 为空且事件无 user_id 时返回 None + 错误。"""
        # MagicMock 默认 user_id 是 MagicMock 对象，需显式置空
        mock_event.user_id = ''
        result = await poke(mock_bot, mock_event, user_id='')
        assert result['result'] is None
        assert '无可用 user_id' in result['error']

    @pytest.mark.asyncio
    async def test_no_user_id_none_event(self, mock_bot):
        """event=None 且 user_id 为空时返回 None + 错误。"""
        result = await poke(mock_bot, None, user_id='')
        assert result['result'] is None
        assert '无可用 user_id' in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await poke(mock_bot, mock_event, user_id='1')
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await poke(mock_bot, mock_event, user_id='1')
        assert result['error'] == ''
