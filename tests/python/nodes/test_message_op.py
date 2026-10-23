"""message_op 节点单元测试 — 构造消息段（不发送）。

被测源码：qqbat_nodes/builtin/message_op.py
- _cq_escape: CQ 码值转义（& → &amp;，, → &#44;，] → &#93;）
- _to_bool: bool 字符串容错（"false"/"true"/"1"/"yes"）
- _construct_segment: 9 种段类型构造（at/image/face/record/share/music/poke/reply/forward）
  - 对象模式（默认）与 CQ 码模式（cq=True）
- message_op: handler 入口，转发到 _construct_segment

测试覆盖：
- at：at_all / 指定 user_id / 缺 user_id 报错 / CQ 转义
- image：file/url / 缺参数报错
- face：正常 / face_id=-1 报错 / 非法 face_id 回退 0
- record：file/url / magic 参数
- share：正常 / 缺 url 报错
- music：qq/163/custom / 非法平台报错
- poke / reply / forward：缺参数报错
- 未知 segment_type 报错
"""
import pytest

from qqbat_nodes.builtin.message_op import (
    message_op,
    _construct_segment,
    _cq_escape,
    _to_bool,
)


# ===========================================================================
# 辅助函数
# ===========================================================================

class TestCqEscape:
    """验证 CQ 码值转义顺序。"""

    def test_ampersand_escaped_first(self):
        """& 先被转义为 &amp;。"""
        assert _cq_escape('a&b') == 'a&amp;b'

    def test_comma_and_bracket_escaped(self):
        """, 和 ] 被转义。"""
        assert _cq_escape('a,b]c') == 'a&#44;b&#93;c'

    def test_all_escapes(self):
        """&,,] 全部被转义（replace 全局生效）。"""
        assert _cq_escape('&,],') == '&amp;&#44;&#93;&#44;'

    def test_non_string_coerced(self):
        """非字符串被转字符串。"""
        assert _cq_escape(123) == '123'


class TestToBool:
    """验证 bool 字符串容错。"""

    def test_truthy_strings(self):
        """true/1/yes/y → True。"""
        for v in ('true', 'True', '1', 'yes', 'y'):
            assert _to_bool(v) is True

    def test_falsy_strings(self):
        """false/0/no → False。"""
        for v in ('false', 'False', '0', 'no'):
            assert _to_bool(v) is False

    def test_bool_passthrough(self):
        """bool 原样返回。"""
        assert _to_bool(True) is True
        assert _to_bool(False) is False

    def test_other_values(self):
        """其他值用 bool() 转换。"""
        assert _to_bool(None) is False
        assert _to_bool(1) is True


# ===========================================================================
# at 段
# ===========================================================================

class TestAtSegment:
    """验证 at 消息段构造。"""

    @pytest.mark.asyncio
    async def test_at_user_id(self, mock_bot, mock_event):
        """指定 user_id 构造 at 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='at', user_id='12345')
        assert r['success'] is True
        assert r['segment'] == {'type': 'at', 'data': {'qq': '12345'}}

    @pytest.mark.asyncio
    async def test_at_all(self, mock_bot, mock_event):
        """at_all=True 构造全体 at。"""
        r = await message_op(mock_bot, mock_event, segment_type='at', at_all=True)
        assert r['segment'] == {'type': 'at', 'data': {'qq': 'all'}}

    @pytest.mark.asyncio
    async def test_at_missing_user_id_error(self, mock_bot, mock_event):
        """无 user_id 且非 at_all 时报错。"""
        ev = type('Ev', (), {'user_id': ''})()
        r = await message_op(mock_bot, ev, segment_type='at')
        assert r['success'] is False
        assert 'user_id' in r['error']

    @pytest.mark.asyncio
    async def test_at_cq_mode(self, mock_bot, mock_event):
        """CQ 码模式。"""
        r = await message_op(mock_bot, mock_event, segment_type='at', user_id='a,b]', cq=True)
        assert r['segment'] == '[CQ:at,qq=a&#44;b&#93;]'


# ===========================================================================
# image / face / record 段
# ===========================================================================

class TestImageFaceRecordSegments:
    """验证 image/face/record 消息段构造。"""

    @pytest.mark.asyncio
    async def test_image_by_file(self, mock_bot, mock_event):
        """file 参数构造 image 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='image', file='a.png')
        assert r['segment'] == {'type': 'image', 'data': {'file': 'a.png'}}

    @pytest.mark.asyncio
    async def test_image_by_url(self, mock_bot, mock_event):
        """url 参数构造 image 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='image', url='http://x/y.png')
        assert r['segment'] == {'type': 'image', 'data': {'file': 'http://x/y.png'}}

    @pytest.mark.asyncio
    async def test_image_missing_source_error(self, mock_bot, mock_event):
        """file/url 都为空时报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='image')
        assert r['success'] is False
        assert 'file/url' in r['error']

    @pytest.mark.asyncio
    async def test_face_normal(self, mock_bot, mock_event):
        """face_id 构造 face 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='face', face_id=14)
        assert r['segment'] == {'type': 'face', 'data': {'id': '14'}}

    @pytest.mark.asyncio
    async def test_face_minus_one_error(self, mock_bot, mock_event):
        """face_id=-1（未设置）时报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='face', face_id=-1)
        assert r['success'] is False
        assert 'face_id' in r['error']

    @pytest.mark.asyncio
    async def test_face_invalid_id_fallback(self, mock_bot, mock_event):
        """非法 face_id 回退为 0。"""
        r = await message_op(mock_bot, mock_event, segment_type='face', face_id='abc')
        assert r['segment'] == {'type': 'face', 'data': {'id': '0'}}

    @pytest.mark.asyncio
    async def test_record_with_magic(self, mock_bot, mock_event):
        """record 段带 magic 参数。"""
        r = await message_op(
            mock_bot, mock_event, segment_type='record', file='v.mp3', magic=True,
        )
        assert r['segment'] == {'type': 'record', 'data': {'file': 'v.mp3', 'magic': '1'}}

    @pytest.mark.asyncio
    async def test_record_missing_source_error(self, mock_bot, mock_event):
        """record 缺 file/url 时报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='record')
        assert r['success'] is False
        assert 'file/url' in r['error']


# ===========================================================================
# share / music 段
# ===========================================================================

class TestShareMusicSegments:
    """验证 share/music 消息段构造。"""

    @pytest.mark.asyncio
    async def test_share_full(self, mock_bot, mock_event):
        """share 段完整参数。"""
        r = await message_op(
            mock_bot, mock_event, segment_type='share',
            url='http://x', title='t', content='c', image_url='http://i',
        )
        assert r['segment'] == {
            'type': 'share',
            'data': {'url': 'http://x', 'title': 't', 'content': 'c', 'image': 'http://i'},
        }

    @pytest.mark.asyncio
    async def test_share_missing_url_error(self, mock_bot, mock_event):
        """share 缺 url 时生成空段并报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='share')
        assert r['success'] is False
        assert 'url' in r['error']

    @pytest.mark.asyncio
    async def test_music_qq_platform(self, mock_bot, mock_event):
        """qq 平台 music 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='music', music_type='qq', id='123')
        assert r['segment'] == {'type': 'music', 'data': {'type': 'qq', 'id': '123'}}

    @pytest.mark.asyncio
    async def test_music_custom(self, mock_bot, mock_event):
        """custom 平台 music 段。"""
        r = await message_op(
            mock_bot, mock_event, segment_type='music',
            music_type='custom', url='http://a', title='t', singer='s',
        )
        assert r['segment'] == {
            'type': 'music',
            'data': {'type': 'custom', 'url': 'http://a', 'title': 't', 'singer': 's'},
        }

    @pytest.mark.asyncio
    async def test_music_invalid_platform_error(self, mock_bot, mock_event):
        """非法 music_type 报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='music', music_type='xyz')
        assert r['success'] is False
        assert 'music_type' in r['error']


# ===========================================================================
# poke / reply / forward 段与未知类型
# ===========================================================================

class TestOtherSegments:
    """验证 poke/reply/forward 消息段与未知类型。"""

    @pytest.mark.asyncio
    async def test_poke(self, mock_bot, mock_event):
        """poke 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='poke', user_id='1')
        assert r['segment'] == {'type': 'poke', 'data': {'qq': '1'}}

    @pytest.mark.asyncio
    async def test_poke_missing_user_id_error(self, mock_bot, mock_event):
        """poke 缺 user_id 时报错。"""
        ev = type('Ev', (), {'user_id': ''})()
        r = await message_op(mock_bot, ev, segment_type='poke')
        assert r['success'] is False

    @pytest.mark.asyncio
    async def test_reply(self, mock_bot, mock_event):
        """reply 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='reply', message_id='m1')
        assert r['segment'] == {'type': 'reply', 'data': {'id': 'm1'}}

    @pytest.mark.asyncio
    async def test_reply_missing_id_error(self, mock_bot, mock_event):
        """reply 缺 message_id 时报错。"""
        ev = type('Ev', (), {'message_id': ''})()
        r = await message_op(mock_bot, ev, segment_type='reply')
        assert r['success'] is False

    @pytest.mark.asyncio
    async def test_forward(self, mock_bot, mock_event):
        """forward 段。"""
        r = await message_op(mock_bot, mock_event, segment_type='forward', forward_id='f1')
        assert r['segment'] == {'type': 'forward', 'data': {'id': 'f1'}}

    @pytest.mark.asyncio
    async def test_forward_missing_id_error(self, mock_bot, mock_event):
        """forward 缺 forward_id 时报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='forward')
        assert r['success'] is False

    @pytest.mark.asyncio
    async def test_unknown_segment_type_error(self, mock_bot, mock_event):
        """未知 segment_type 报错。"""
        r = await message_op(mock_bot, mock_event, segment_type='hologram')
        assert r['success'] is False
        assert '未知 segment_type' in r['error']
