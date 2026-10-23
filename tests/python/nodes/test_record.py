"""record 节点单元测试 — 语音消息段生成。

覆盖：
- dict 格式消息段（默认）
- CQ 码字符串（cq=True）
- magic 变声标记
- file 为空时返回 None + 错误
- file 为 URL / 本地路径
- 返回结构完整性

被测源码：qqbat_nodes/builtin/record.py
"""
import pytest

from qqbat_nodes.builtin.record import record


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestRecordDictSegment:
    """验证默认 dict 格式语音消息段生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_file(self, mock_bot, mock_event):
        """传入 file 时生成 dict 格式 record 段。"""
        result = await record(mock_bot, mock_event, file='1.mp3')
        assert result['result'] == {'type': 'record', 'data': {'file': '1.mp3'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_with_url(self, mock_bot, mock_event):
        """file 为 URL 时正确生成。"""
        url = 'https://example.com/audio.mp3'
        result = await record(mock_bot, mock_event, file=url)
        assert result['result'] == {'type': 'record', 'data': {'file': url}}

    @pytest.mark.asyncio
    async def test_dict_segment_with_file_uri(self, mock_bot, mock_event):
        """file 为 file:// URI 时正确生成。"""
        result = await record(mock_bot, mock_event, file='file:///C:/1.silk')
        assert result['result'] == {'type': 'record', 'data': {'file': 'file:///C:/1.silk'}}


# =============================================================================
# CQ 码格式
# =============================================================================
class TestRecordCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_file(self, mock_bot, mock_event):
        """cq=True 返回 [CQ:record,file=xxx] 字符串。"""
        result = await record(mock_bot, mock_event, file='1.mp3', cq=True)
        assert result['result'] == '[CQ:record,file=1.mp3]'

    @pytest.mark.asyncio
    async def test_cq_segment_with_url(self, mock_bot, mock_event):
        """cq=True 且 file 为 URL 时正确生成。"""
        result = await record(
            mock_bot, mock_event, file='https://example.com/a.mp3', cq=True
        )
        assert result['result'] == '[CQ:record,file=https://example.com/a.mp3]'


# =============================================================================
# magic 变声
# =============================================================================
class TestMagicFlag:
    """验证 magic 变声标记处理。"""

    @pytest.mark.asyncio
    async def test_magic_dict(self, mock_bot, mock_event):
        """magic=True 时 dict 段含 magic='1'。"""
        result = await record(mock_bot, mock_event, file='1.mp3', magic=True)
        assert result['result'] == {'type': 'record', 'data': {'file': '1.mp3', 'magic': '1'}}

    @pytest.mark.asyncio
    async def test_magic_cq(self, mock_bot, mock_event):
        """magic=True 且 cq=True 时 CQ 码含 magic=1。"""
        result = await record(mock_bot, mock_event, file='1.mp3', magic=True, cq=True)
        assert result['result'] == '[CQ:record,file=1.mp3,magic=1]'

    @pytest.mark.asyncio
    async def test_no_magic_dict(self, mock_bot, mock_event):
        """magic=False 时 dict 段不含 magic 键。"""
        result = await record(mock_bot, mock_event, file='1.mp3', magic=False)
        assert 'magic' not in result['result']['data']

    @pytest.mark.asyncio
    async def test_no_magic_cq(self, mock_bot, mock_event):
        """magic=False 时 CQ 码不含 magic=1。"""
        result = await record(mock_bot, mock_event, file='1.mp3', magic=False, cq=True)
        assert 'magic' not in result['result']


# =============================================================================
# file 为空
# =============================================================================
class TestEmptyFile:
    """验证 file 为空时的错误处理。"""

    @pytest.mark.asyncio
    async def test_empty_file_returns_none(self, mock_bot, mock_event):
        """file 为空时返回 None + 错误。"""
        result = await record(mock_bot, mock_event, file='')
        assert result['result'] is None
        assert 'file 为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_file_cq_returns_none(self, mock_bot, mock_event):
        """file 为空且 cq=True 时也返回 None。"""
        result = await record(mock_bot, mock_event, file='', cq=True)
        assert result['result'] is None


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await record(mock_bot, mock_event, file='1.mp3')
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await record(mock_bot, mock_event, file='1.mp3')
        assert result['error'] == ''
