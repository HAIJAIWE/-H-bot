"""music 节点单元测试 — 音乐分享消息段生成。

覆盖：
- qq 平台（QQ 音乐）
- 163 平台（网易云）
- custom 平台（自定义链接）
- 非法平台返回 None + 错误
- dict 格式 / CQ 码格式
- id=0 时输出空串
- custom 模式可选字段（content/image/singer）
- bool 字符串容错
- 返回结构完整性

被测源码：qqbat_nodes/builtin/music.py
"""
import pytest

from qqbat_nodes.builtin.music import music


# =============================================================================
# qq 平台
# =============================================================================
class TestQQPlatform:
    """验证 qq 平台音乐分享。"""

    @pytest.mark.asyncio
    async def test_qq_dict_segment(self, mock_bot, mock_event):
        """qq 平台默认返回 dict 格式。"""
        result = await music(mock_bot, mock_event, platform='qq', id=12345)
        assert result['result'] == {'type': 'music', 'data': {'type': 'qq', 'id': '12345'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_qq_cq_segment(self, mock_bot, mock_event):
        """qq 平台 cq=True 返回 CQ 码。"""
        result = await music(mock_bot, mock_event, platform='qq', id=12345, cq=True)
        assert result['result'] == '[CQ:music,type=qq,id=12345]'

    @pytest.mark.asyncio
    async def test_qq_id_zero_outputs_empty(self, mock_bot, mock_event):
        """qq 平台 id=0 时输出空串。"""
        result = await music(mock_bot, mock_event, platform='qq', id=0)
        assert result['result']['data']['id'] == ''


# =============================================================================
# 163 平台
# =============================================================================
class TestNeteasePlatform:
    """验证 163 平台音乐分享。"""

    @pytest.mark.asyncio
    async def test_163_dict_segment(self, mock_bot, mock_event):
        """163 平台默认返回 dict 格式。"""
        result = await music(mock_bot, mock_event, platform='163', id=67890)
        assert result['result'] == {'type': 'music', 'data': {'type': '163', 'id': '67890'}}

    @pytest.mark.asyncio
    async def test_163_cq_segment(self, mock_bot, mock_event):
        """163 平台 cq=True 返回 CQ 码。"""
        result = await music(mock_bot, mock_event, platform='163', id=67890, cq=True)
        assert result['result'] == '[CQ:music,type=163,id=67890]'


# =============================================================================
# custom 平台
# =============================================================================
class TestCustomPlatform:
    """验证 custom 平台音乐分享。"""

    @pytest.mark.asyncio
    async def test_custom_dict_segment(self, mock_bot, mock_event):
        """custom 平台默认返回 dict 格式，含 url 与 title。"""
        result = await music(
            mock_bot, mock_event, platform='custom',
            url='https://example.com', title='测试歌曲',
        )
        assert result['result'] == {
            'type': 'music',
            'data': {'type': 'custom', 'url': 'https://example.com', 'title': '测试歌曲'},
        }

    @pytest.mark.asyncio
    async def test_custom_cq_segment(self, mock_bot, mock_event):
        """custom 平台 cq=True 返回 CQ 码。"""
        result = await music(
            mock_bot, mock_event, platform='custom',
            url='https://example.com', title='测试', cq=True,
        )
        assert 'type=custom' in result['result']
        assert 'url=https://example.com' in result['result']
        assert 'title=测试' in result['result']

    @pytest.mark.asyncio
    async def test_custom_with_optional_fields(self, mock_bot, mock_event):
        """custom 模式含 content/image/singer 可选字段。"""
        result = await music(
            mock_bot, mock_event, platform='custom',
            url='https://example.com', title='歌',
            content='描述', image='https://img.com/1.png', singer='歌手',
        )
        data = result['result']['data']
        assert data['content'] == '描述'
        assert data['image'] == 'https://img.com/1.png'
        assert data['singer'] == '歌手'

    @pytest.mark.asyncio
    async def test_custom_cq_with_optional_fields(self, mock_bot, mock_event):
        """custom 模式 cq=True 含可选字段。"""
        result = await music(
            mock_bot, mock_event, platform='custom',
            url='https://example.com', title='歌',
            content='描述', image='https://img.com/1.png', singer='歌手',
            cq=True,
        )
        assert 'content=描述' in result['result']
        assert 'image=https://img.com/1.png' in result['result']
        assert 'singer=歌手' in result['result']

    @pytest.mark.asyncio
    async def test_custom_empty_url_title(self, mock_bot, mock_event):
        """custom 模式 url/title 为空时输出空串。"""
        result = await music(mock_bot, mock_event, platform='custom', url='', title='')
        assert result['result']['data']['url'] == ''
        assert result['result']['data']['title'] == ''


# =============================================================================
# 非法平台
# =============================================================================
class TestInvalidPlatform:
    """验证非法平台的错误处理。"""

    @pytest.mark.asyncio
    async def test_invalid_platform_returns_none(self, mock_bot, mock_event):
        """非法平台返回 None + 错误。"""
        result = await music(mock_bot, mock_event, platform='spotify', id=1)
        assert result['result'] is None
        assert '非法平台' in result['error']
        assert 'qq/163/custom' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_platform_cq_returns_none(self, mock_bot, mock_event):
        """非法平台 cq=True 也返回 None。"""
        result = await music(mock_bot, mock_event, platform='apple', id=1, cq=True)
        assert result['result'] is None


# =============================================================================
# 默认值与容错
# =============================================================================
class TestDefaultsAndCompat:
    """验证默认值与字符串容错。"""

    @pytest.mark.asyncio
    async def test_default_platform_is_qq(self, mock_bot, mock_event):
        """不传 platform 时默认 qq。"""
        result = await music(mock_bot, mock_event, id=1)
        assert result['result']['data']['type'] == 'qq'

    @pytest.mark.asyncio
    async def test_cq_string_true(self, mock_bot, mock_event):
        """cq='true' 解析为 True。"""
        result = await music(mock_bot, mock_event, platform='qq', id=1, cq='true')
        assert result['result'] == '[CQ:music,type=qq,id=1]'

    @pytest.mark.asyncio
    async def test_cq_string_false(self, mock_bot, mock_event):
        """cq='false' 解析为 False。"""
        result = await music(mock_bot, mock_event, platform='qq', id=1, cq='false')
        assert result['result'] == {'type': 'music', 'data': {'type': 'qq', 'id': '1'}}

    @pytest.mark.asyncio
    async def test_platform_none_defaults_to_qq(self, mock_bot, mock_event):
        """platform=None 时默认 qq。"""
        result = await music(mock_bot, mock_event, platform=None, id=1)
        assert result['result']['data']['type'] == 'qq'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 与 error 字段。"""
        result = await music(mock_bot, mock_event, platform='qq', id=1)
        assert 'result' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 为空字符串。"""
        result = await music(mock_bot, mock_event, platform='qq', id=1)
        assert result['error'] == ''
