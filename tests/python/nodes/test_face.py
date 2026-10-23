"""face 节点单元测试 — QQ 表情消息段生成。

覆盖：
- dict 格式消息段（默认）
- CQ 码字符串（cq=True）
- id=0（合法表情：惊讶）应正确生成
- id=-1（未设置）返回 None + 错误
- id 非法类型回退为 '0'
- id 字符串/浮点数转换
- 返回结构完整性

被测源码：qqbat_nodes/builtin/face.py
"""
import pytest

from qqbat_nodes.builtin.face import face


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestFaceDictSegment:
    """验证默认 dict 格式表情消息段生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_id(self, mock_bot, mock_event):
        """传入合法 id 时生成 dict 格式 face 段。"""
        result = await face(mock_bot, mock_event, id=14)
        assert result['result'] == {'type': 'face', 'data': {'id': '14'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_id_zero(self, mock_bot, mock_event):
        """id=0（惊讶表情）应正确生成，不与 -1（未设置）歧义。"""
        result = await face(mock_bot, mock_event, id=0)
        assert result['result'] == {'type': 'face', 'data': {'id': '0'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_id_string(self, mock_bot, mock_event):
        """id 为字符串 '21' 时应转为 int 再转 str。"""
        result = await face(mock_bot, mock_event, id='21')
        assert result['result'] == {'type': 'face', 'data': {'id': '21'}}


# =============================================================================
# CQ 码格式
# =============================================================================
class TestFaceCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_id(self, mock_bot, mock_event):
        """cq=True 返回 [CQ:face,id=xxx] 字符串。"""
        result = await face(mock_bot, mock_event, id=14, cq=True)
        assert result['result'] == '[CQ:face,id=14]'

    @pytest.mark.asyncio
    async def test_cq_segment_id_zero(self, mock_bot, mock_event):
        """cq=True 且 id=0 时返回 [CQ:face,id=0]。"""
        result = await face(mock_bot, mock_event, id=0, cq=True)
        assert result['result'] == '[CQ:face,id=0]'


# =============================================================================
# id 未设置（-1）
# =============================================================================
class TestIdNotSet:
    """验证 id=-1（未设置）时的错误处理。"""

    @pytest.mark.asyncio
    async def test_id_minus_one_returns_none(self, mock_bot, mock_event):
        """id=-1 时返回 None + 错误。"""
        result = await face(mock_bot, mock_event, id=-1)
        assert result['result'] is None
        assert 'id 未设置' in result['error']
        assert '-1' in result['error']

    @pytest.mark.asyncio
    async def test_id_minus_one_cq_returns_none(self, mock_bot, mock_event):
        """id=-1 且 cq=True 时也返回 None。"""
        result = await face(mock_bot, mock_event, id=-1, cq=True)
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_default_id_is_minus_one(self, mock_bot, mock_event):
        """不传 id 时默认 -1，返回 None。"""
        result = await face(mock_bot, mock_event)
        assert result['result'] is None
        assert 'id 未设置' in result['error']


# =============================================================================
# id 非法类型容错
# =============================================================================
class TestIdInvalidType:
    """验证 id 非法类型时的容错处理。"""

    @pytest.mark.asyncio
    async def test_id_non_numeric_string(self, mock_bot, mock_event):
        """id='abc' 无法转 int 时回退为 '0'。"""
        result = await face(mock_bot, mock_event, id='abc')
        assert result['result'] == {'type': 'face', 'data': {'id': '0'}}

    @pytest.mark.asyncio
    async def test_id_none(self, mock_bot, mock_event):
        """id=None 无法转 int 时回退为 '0'。"""
        result = await face(mock_bot, mock_event, id=None)
        assert result['result'] == {'type': 'face', 'data': {'id': '0'}}

    @pytest.mark.asyncio
    async def test_id_float(self, mock_bot, mock_event):
        """id=14.9 浮点数应转为 '14'。"""
        result = await face(mock_bot, mock_event, id=14.9)
        assert result['result'] == {'type': 'face', 'data': {'id': '14'}}


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await face(mock_bot, mock_event, id=14)
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await face(mock_bot, mock_event, id=14)
        assert result['error'] == ''
