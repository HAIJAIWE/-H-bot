"""image 节点单元测试 — 图片消息段生成。

覆盖：
- dict 格式消息段（默认）
- CQ 码字符串（cq=True）
- file 为 URL / 本地路径 / file:// URI
- file 为空时返回 None + 错误
- CQ 码转义特殊字符
- 返回结构完整性

被测源码：qqbat_nodes/builtin/image.py
"""
import pytest

from qqbat_nodes.builtin.image import image, _cq_escape


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestImageDictSegment:
    """验证默认 dict 格式图片消息段生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_filename(self, mock_bot, mock_event):
        """传入文件名时生成 dict 格式 image 段。"""
        result = await image(mock_bot, mock_event, file='1.png')
        assert result['result'] == {'type': 'image', 'data': {'file': '1.png'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_with_url(self, mock_bot, mock_event):
        """file 为 URL 时正确生成。"""
        url = 'https://example.com/img.png'
        result = await image(mock_bot, mock_event, file=url)
        assert result['result'] == {'type': 'image', 'data': {'file': url}}

    @pytest.mark.asyncio
    async def test_dict_segment_with_file_uri(self, mock_bot, mock_event):
        """file 为 file:// URI 时正确生成。"""
        result = await image(mock_bot, mock_event, file='file:///C:/1.png')
        assert result['result'] == {'type': 'image', 'data': {'file': 'file:///C:/1.png'}}

    @pytest.mark.asyncio
    async def test_dict_segment_with_base64(self, mock_bot, mock_event):
        """file 为 base64 编码时正确生成。"""
        result = await image(mock_bot, mock_event, file='base64://xxxx')
        assert result['result'] == {'type': 'image', 'data': {'file': 'base64://xxxx'}}


# =============================================================================
# CQ 码格式
# =============================================================================
class TestImageCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_filename(self, mock_bot, mock_event):
        """cq=True 返回 [CQ:image,file=xxx] 字符串。"""
        result = await image(mock_bot, mock_event, file='1.png', cq=True)
        assert result['result'] == '[CQ:image,file=1.png]'

    @pytest.mark.asyncio
    async def test_cq_segment_with_url(self, mock_bot, mock_event):
        """cq=True 且 file 为 URL 时正确生成。"""
        result = await image(
            mock_bot, mock_event, file='https://example.com/x.png', cq=True
        )
        assert result['result'] == '[CQ:image,file=https://example.com/x.png]'


# =============================================================================
# file 为空
# =============================================================================
class TestEmptyFile:
    """验证 file 为空时的错误处理。"""

    @pytest.mark.asyncio
    async def test_empty_file_returns_none(self, mock_bot, mock_event):
        """file 为空时返回 None + 错误。"""
        result = await image(mock_bot, mock_event, file='')
        assert result['result'] is None
        assert 'file 为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_file_cq_returns_none(self, mock_bot, mock_event):
        """file 为空且 cq=True 时也返回 None。"""
        result = await image(mock_bot, mock_event, file='', cq=True)
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

    def test_escape_url_with_query(self):
        """含查询参数的 URL 应正确转义 & 与 =。"""
        url = 'https://example.com/img?a=1&b=2'
        escaped = _cq_escape(url)
        assert '&amp;' in escaped
        assert '&' not in escaped.replace('&amp;', '')

    @pytest.mark.asyncio
    async def test_cq_segment_with_special_chars(self, mock_bot, mock_event):
        """file 含特殊字符时 CQ 码应正确转义。"""
        result = await image(
            mock_bot, mock_event, file='https://example.com/img?a=1&b=2', cq=True
        )
        assert '&amp;' in result['result']
        # 不应出现未转义的 &
        assert '&amp;' in result['result']
        # 原始 & 不应单独存在（&amp; 中的 & 除外）
        inner = result['result'].replace('&amp;', '')
        assert '&' not in inner


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await image(mock_bot, mock_event, file='1.png')
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await image(mock_bot, mock_event, file='1.png')
        assert result['error'] == ''
