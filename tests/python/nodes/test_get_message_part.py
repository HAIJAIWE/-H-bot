"""get_message_part 节点单元测试。

被测源码：qqbat_nodes/builtin/get_message_part.py

覆盖：
- 7 种 mode（at/image/file/reply/record/video/json）的提取逻辑
- index 正向 / 负向索引
- 多个片段场景
- 空消息（无匹配片段）
- 未知 mode 入口校验
- event 无 message 属性
- 异常容错
- 返回结构完整性

返回 dict 结构：
- 成功: {"current": 当前项, "list": 全部列表, "count": 数量,
        "extra": JSON 字符串(特有字段), "error": ""}
- 未知 mode: {"success": False, ..., "error": 友好提示}
"""
import json
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.builtin.get_message_part import get_message_part, VALID_MODES


# =============================================================================
# 辅助构造函数
# =============================================================================
class MockSeg:
    """模拟 OneBot v11 MessageSegment 对象。"""

    def __init__(self, seg_type, data):
        self.type = seg_type
        self.data = data


def make_event_with_message(segments):
    """构造一个事件，event.message 为 segment 列表。"""
    ev = MagicMock()
    ev.message = segments
    return ev


# =============================================================================
# mode='at'
# =============================================================================
class TestAtMode:
    """验证 mode='at' 提取被 @ 对象的 QQ 号。"""

    @pytest.mark.asyncio
    async def test_extract_single_at(self, mock_bot, mock_event):
        """提取单个被 @ 对象的 QQ 号。"""
        segs = [MockSeg('at', {'qq': '12345'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['current'] == '12345'
        assert result['list'] == ['12345']
        assert result['count'] == 1
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_extract_multiple_at_default_index(self, mock_bot, mock_event):
        """多个 @ 时默认 index=0 取第一个。"""
        segs = [
            MockSeg('at', {'qq': '111'}),
            MockSeg('at', {'qq': '222'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['current'] == '111'
        assert result['count'] == 2

    @pytest.mark.asyncio
    async def test_extract_at_with_index(self, mock_bot, mock_event):
        """指定 index=1 取第二个 @。"""
        segs = [
            MockSeg('at', {'qq': '111'}),
            MockSeg('at', {'qq': '222'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at', index=1)
        assert result['current'] == '222'

    @pytest.mark.asyncio
    async def test_extract_at_negative_index(self, mock_bot, mock_event):
        """负向索引 index=-1 取最后一个 @。"""
        segs = [
            MockSeg('at', {'qq': '111'}),
            MockSeg('at', {'qq': '222'}),
            MockSeg('at', {'qq': '333'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at', index=-1)
        assert result['current'] == '333'

    @pytest.mark.asyncio
    async def test_at_all_excluded(self, mock_bot, mock_event):
        """@全体成员 (qq='all') 不计入列表。"""
        segs = [
            MockSeg('at', {'qq': 'all'}),
            MockSeg('at', {'qq': '12345'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['count'] == 1
        assert result['current'] == '12345'

    @pytest.mark.asyncio
    async def test_no_at_returns_empty(self, mock_bot, mock_event):
        """消息中无 @ 段 → 返回空。"""
        segs = [MockSeg('text', {'text': 'hello'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['current'] == ''
        assert result['count'] == 0
        assert result['list'] == []


# =============================================================================
# mode='image'
# =============================================================================
class TestImageMode:
    """验证 mode='image' 提取图片 URL 和文件名。"""

    @pytest.mark.asyncio
    async def test_extract_single_image(self, mock_bot, mock_event):
        """提取单个图片 URL。"""
        segs = [MockSeg('image', {'url': 'http://img/1.jpg', 'file': '1.jpg'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='image')
        assert result['current'] == 'http://img/1.jpg'
        assert result['count'] == 1
        assert result['list'] == ['http://img/1.jpg']
        # extra 为 JSON 字符串，含 file 字段
        extra = json.loads(result['extra'])
        assert extra == {'file': '1.jpg'}

    @pytest.mark.asyncio
    async def test_extract_multiple_images(self, mock_bot, mock_event):
        """多个图片按 index 取对应。"""
        segs = [
            MockSeg('image', {'url': 'http://img/1.jpg', 'file': '1.jpg'}),
            MockSeg('image', {'url': 'http://img/2.jpg', 'file': '2.jpg'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='image', index=1)
        assert result['current'] == 'http://img/2.jpg'
        extra = json.loads(result['extra'])
        assert extra == {'file': '2.jpg'}


# =============================================================================
# mode='file'
# =============================================================================
class TestFileMode:
    """验证 mode='file' 提取文件信息。"""

    @pytest.mark.asyncio
    async def test_extract_file_info(self, mock_bot, mock_event):
        """提取文件 url/name/size。"""
        segs = [MockSeg('file', {
            'name': 'doc.pdf', 'size': '1024', 'url': 'http://f/doc.pdf',
        })]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='file')
        assert result['current'] == 'http://f/doc.pdf'
        assert result['count'] == 1
        extra = json.loads(result['extra'])
        assert extra == {'name': 'doc.pdf', 'size': 1024}

    @pytest.mark.asyncio
    async def test_no_file_returns_empty(self, mock_bot, mock_event):
        """无文件段 → 返回空。"""
        segs = [MockSeg('text', {'text': 'hi'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='file')
        assert result['count'] == 0


# =============================================================================
# mode='reply'
# =============================================================================
class TestReplyMode:
    """验证 mode='reply' 提取引用回复的目标消息 ID。"""

    @pytest.mark.asyncio
    async def test_extract_reply_id(self, mock_bot, mock_event):
        """提取引用回复的目标消息 ID。"""
        segs = [MockSeg('reply', {'id': '99988'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='reply')
        assert result['current'] == '99988'
        assert result['count'] == 1
        assert result['list'] == ['99988']

    @pytest.mark.asyncio
    async def test_no_reply_returns_empty(self, mock_bot, mock_event):
        """无引用回复段 → 返回空。"""
        segs = [MockSeg('text', {'text': 'hi'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='reply')
        assert result['count'] == 0


# =============================================================================
# mode='record' / 'video'
# =============================================================================
class TestRecordAndVideoMode:
    """验证 mode='record' 和 mode='video' 提取媒体文件信息。"""

    @pytest.mark.asyncio
    async def test_extract_record(self, mock_bot, mock_event):
        """提取语音文件 url。"""
        segs = [MockSeg('record', {'file': 'r1.amr', 'url': 'http://r/1.amr'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='record')
        assert result['current'] == 'http://r/1.amr'
        assert result['count'] == 1
        extra = json.loads(result['extra'])
        assert extra == {'file': 'r1.amr'}

    @pytest.mark.asyncio
    async def test_extract_video(self, mock_bot, mock_event):
        """提取视频文件 url。"""
        segs = [MockSeg('video', {'file': 'v1.mp4', 'url': 'http://v/1.mp4'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='video')
        assert result['current'] == 'http://v/1.mp4'
        assert result['count'] == 1
        extra = json.loads(result['extra'])
        assert extra == {'file': 'v1.mp4'}

    @pytest.mark.asyncio
    async def test_record_url_empty_falls_back_to_file(self, mock_bot, mock_event):
        """语音 url 为空时回退到 file 字段。"""
        segs = [MockSeg('record', {'file': 'r1.amr', 'url': ''})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='record')
        assert result['current'] == 'r1.amr'


# =============================================================================
# mode='json'
# =============================================================================
class TestJsonMode:
    """验证 mode='json' 提取 JSON 消息段的原始 data。"""

    @pytest.mark.asyncio
    async def test_extract_json_data(self, mock_bot, mock_event):
        """提取 JSON 段的 data 字段（JSON 字符串）。"""
        json_str = '{"app":"com.tencent.struct"}'
        segs = [MockSeg('json', {'data': json_str})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='json')
        assert result['current'] == json_str
        assert result['count'] == 1
        assert result['list'] == [json_str]


# =============================================================================
# 未知 mode
# =============================================================================
class TestUnknownMode:
    """验证未知 mode 的入口校验。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode 返回 success=False + 友好错误信息。"""
        ev = make_event_with_message([])
        result = await get_message_part(mock_bot, ev, mode='unknown')
        assert result['success'] is False
        assert '未知模式' in result['error']
        assert 'unknown' in result['error']

    @pytest.mark.asyncio
    async def test_unknown_mode_for_get_message_part(self, mock_bot, mock_event):
        """未知 mode 返回 success=False + 友好错误信息。"""
        ev = make_event_with_message([])
        result = await get_message_part(mock_bot, ev, mode='unknown')
        assert result['success'] is False
        assert '未知模式' in result['error']
        assert 'unknown' in result['error']

    def test_valid_modes_set(self):
        """VALID_MODES 集合包含 7 种合法 mode。"""
        assert VALID_MODES == {
            'at', 'image', 'file', 'reply', 'record', 'video', 'json',
        }


# =============================================================================
# 边界条件
# =============================================================================
class TestBoundary:
    """验证边界条件。"""

    @pytest.mark.asyncio
    async def test_event_without_message_attr(self, mock_bot, mock_event):
        """event 无 message 属性 → 返回 error。"""
        ev = MagicMock()
        del ev.message
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['error'] == '消息无 message 属性'

    @pytest.mark.asyncio
    async def test_message_none_returns_error(self, mock_bot, mock_event):
        """event.message 为 None → 返回 error。"""
        ev = MagicMock()
        ev.message = None
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['error'] == '消息无 message 属性'

    @pytest.mark.asyncio
    async def test_index_out_of_range_clamped(self, mock_bot, mock_event):
        """index 超出范围时夹取到最后一个。"""
        segs = [
            MockSeg('at', {'qq': '111'}),
            MockSeg('at', {'qq': '222'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at', index=99)
        # index 超出 → 取 count-1 = 1 → '222'
        assert result['current'] == '222'

    @pytest.mark.asyncio
    async def test_negative_index_out_of_range_clamped(self, mock_bot, mock_event):
        """负向 index 超出范围时夹取到第一个。"""
        segs = [
            MockSeg('at', {'qq': '111'}),
            MockSeg('at', {'qq': '222'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at', index=-99)
        # max(0, 2 + (-99)) = max(0, -97) = 0 → '111'
        assert result['current'] == '111'


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaults:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_default_mode_is_at(self, mock_bot, mock_event):
        """不传 mode 时默认为 'at'。"""
        segs = [MockSeg('at', {'qq': '123'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev)
        assert result['current'] == '123'

    @pytest.mark.asyncio
    async def test_default_index_is_zero(self, mock_bot, mock_event):
        """不传 index 时默认为 0。"""
        segs = [
            MockSeg('at', {'qq': '111'}),
            MockSeg('at', {'qq': '222'}),
        ]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['current'] == '111'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 current/list/count/extra/error 五个字段。"""
        segs = [MockSeg('at', {'qq': '123'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert set(result.keys()) == {'current', 'list', 'count', 'extra', 'error'}

    @pytest.mark.asyncio
    async def test_extra_is_json_string_for_image(self, mock_bot, mock_event):
        """image 模式的 extra 字段为 JSON 字符串。"""
        segs = [MockSeg('image', {'url': 'u', 'file': 'f.jpg'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='image')
        assert isinstance(result['extra'], str)
        # 应为合法 JSON
        parsed = json.loads(result['extra'])
        assert isinstance(parsed, dict)

    @pytest.mark.asyncio
    async def test_extra_empty_for_at_mode(self, mock_bot, mock_event):
        """at 模式的 extra 字段为空字符串（无额外字段）。"""
        segs = [MockSeg('at', {'qq': '123'})]
        ev = make_event_with_message(segs)
        result = await get_message_part(mock_bot, ev, mode='at')
        assert result['extra'] == ''
