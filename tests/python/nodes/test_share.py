"""share 节点单元测试 — 链接分享消息段生成。

覆盖：
- dict 格式消息段（默认）
- CQ 码字符串（cq=True）
- 含 title/content/image 完整字段
- url 为空时返回空 share 段 + 错误提示
- CQ 码转义特殊字符
- bool 字符串容错
- 可选字段省略
- 返回结构完整性

被测源码：qqbat_nodes/builtin/share.py
"""
import pytest

from qqbat_nodes.builtin.share import share, _cq_escape


# =============================================================================
# dict 格式消息段
# =============================================================================
class TestShareDictSegment:
    """验证默认 dict 格式链接分享消息段生成。"""

    @pytest.mark.asyncio
    async def test_dict_segment_with_url(self, mock_bot, mock_event):
        """传入 url 时生成 dict 格式 share 段。"""
        result = await share(mock_bot, mock_event, url='https://example.com')
        assert result['result'] == {'type': 'share', 'data': {'url': 'https://example.com'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_segment_with_all_fields(self, mock_bot, mock_event):
        """传入完整字段时生成含 title/content/image 的 dict 段。"""
        result = await share(
            mock_bot, mock_event,
            url='https://example.com', title='标题',
            content='描述', image='https://img.com/1.png',
        )
        data = result['result']['data']
        assert data['url'] == 'https://example.com'
        assert data['title'] == '标题'
        assert data['content'] == '描述'
        assert data['image'] == 'https://img.com/1.png'

    @pytest.mark.asyncio
    async def test_dict_segment_only_url(self, mock_bot, mock_event):
        """只传 url 时 dict 段不含 title/content/image 键。"""
        result = await share(mock_bot, mock_event, url='https://example.com')
        data = result['result']['data']
        assert 'title' not in data
        assert 'content' not in data
        assert 'image' not in data


# =============================================================================
# CQ 码格式
# =============================================================================
class TestShareCqSegment:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_cq_segment_with_url(self, mock_bot, mock_event):
        """cq=True 返回 [CQ:share,url=xxx] 字符串。"""
        result = await share(mock_bot, mock_event, url='https://example.com', cq=True)
        assert result['result'] == '[CQ:share,url=https://example.com]'

    @pytest.mark.asyncio
    async def test_cq_segment_with_all_fields(self, mock_bot, mock_event):
        """cq=True 含完整字段。"""
        result = await share(
            mock_bot, mock_event,
            url='https://example.com', title='标题',
            content='描述', image='https://img.com/1.png', cq=True,
        )
        assert 'url=https://example.com' in result['result']
        assert 'title=标题' in result['result']
        assert 'content=描述' in result['result']
        assert 'image=https://img.com/1.png' in result['result']


# =============================================================================
# url 为空
# =============================================================================
class TestEmptyUrl:
    """验证 url 为空时的处理。"""

    @pytest.mark.asyncio
    async def test_empty_url_dict_returns_empty_segment(self, mock_bot, mock_event):
        """url 为空时返回空 share 段 + 错误提示。"""
        result = await share(mock_bot, mock_event, url='')
        assert result['result'] == {'type': 'share', 'data': {'url': ''}}
        assert 'url 为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_url_cq_returns_empty_string(self, mock_bot, mock_event):
        """url 为空且 cq=True 时返回空字符串。"""
        result = await share(mock_bot, mock_event, url='', cq=True)
        assert result['result'] == ''
        assert 'url 为空' in result['error']


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

    @pytest.mark.asyncio
    async def test_cq_segment_url_with_special_chars(self, mock_bot, mock_event):
        """url 含 & 与 , 时 CQ 码应正确转义。"""
        result = await share(
            mock_bot, mock_event,
            url='https://example.com?a=1&b=2,3', cq=True,
        )
        assert '&amp;' in result['result']
        assert '&#44;' in result['result']


# =============================================================================
# bool 字符串容错
# =============================================================================
class TestCqStringCompat:
    """验证 cq 参数为字符串时的容错处理。"""

    @pytest.mark.asyncio
    async def test_cq_string_true(self, mock_bot, mock_event):
        """cq='true' 应被解析为 True。"""
        result = await share(mock_bot, mock_event, url='https://x.com', cq='true')
        assert result['result'] == '[CQ:share,url=https://x.com]'

    @pytest.mark.asyncio
    async def test_cq_string_false(self, mock_bot, mock_event):
        """cq='false' 应被解析为 False。"""
        result = await share(mock_bot, mock_event, url='https://x.com', cq='false')
        assert result['result'] == {'type': 'share', 'data': {'url': 'https://x.com'}}

    @pytest.mark.asyncio
    async def test_cq_string_yes(self, mock_bot, mock_event):
        """cq='yes' 应被解析为 True。"""
        result = await share(mock_bot, mock_event, url='https://x.com', cq='yes')
        assert result['result'] == '[CQ:share,url=https://x.com]'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await share(mock_bot, mock_event, url='https://x.com')
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await share(mock_bot, mock_event, url='https://x.com')
        assert result['error'] == ''
