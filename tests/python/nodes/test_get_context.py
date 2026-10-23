"""get_context 统一上下文节点单元测试。

覆盖：
- 基础上下文（user_id/group_id/message_text/self_id/operator_id/message_id/raw_message/sub_type）
- 指令参数（command_args）
- 群成员列表（group_members：成功/超时/数量上限截断/非法群号/bot 缺失/群号缺失）
- 消息片段（message_part 各 part_mode：at/image/file/reply/record/video/json）
- 名称查询（user_name：群名片/昵称/陌生人；group_name）
- 未知 mode / event 缺失等错误路径

被测源码：qqbat_nodes/builtin/get_context.py
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from qqbat_nodes.builtin._int_id import safe_int_id
from qqbat_nodes.builtin.get_context import (
    _MAX_GROUP_MEMBERS,
    get_context,
)


class _Seg:
    """模拟消息段（type + data）。"""

    def __init__(self, type_, data):
        self.type = type_
        self.data = data


class _FakeMsg(list):
    """模拟消息对象：可迭代 segment，并提供 extract_plain_text。

    含纯文本但无 segment 时仍为 truthy（NoneBot 中非空文本消息不应判空）。
    """

    def __init__(self, segments=(), text=''):
        super().__init__(segments)
        self._text = text

    def __bool__(self):
        return bool(self._text) or bool(list.__len__(self))

    def extract_plain_text(self):
        return self._text


def _base_event(text=''):
    """构造包含完整基础属性的模拟事件。"""
    return SimpleNamespace(
        user_id=10001,
        group_id=20002,
        self_id=30003,
        operator_id=40004,
        message_id='m-001',
        raw_message='原始消息',
        sub_type='group',
        message=_FakeMsg(text=text),
    )


# =============================================================================
# safe_int_id 单元函数（来自 qqbat_nodes/builtin/_int_id.py）
# =============================================================================
class TestSafeIntId:
    def test_int_passthrough(self):
        assert safe_int_id(123) == 123

    def test_numeric_string(self):
        assert safe_int_id('123') == 123
        assert safe_int_id('-5') == -5

    def test_none_or_empty_raises(self):
        with pytest.raises(ValueError):
            safe_int_id(None)
        with pytest.raises(ValueError):
            safe_int_id('')

    def test_non_numeric_raises(self):
        with pytest.raises(ValueError):
            safe_int_id('abc')


# =============================================================================
# 基础上下文
# =============================================================================
class TestBasicContext:
    @pytest.mark.parametrize('mode,expected', [
        ('user_id', '10001'),
        ('group_id', '20002'),
        ('self_id', '30003'),
        ('operator_id', '40004'),
        ('message_id', 'm-001'),
        ('raw_message', '原始消息'),
        ('sub_type', 'group'),
    ])
    @pytest.mark.asyncio
    async def test_basic_modes(self, mode, expected):
        """基础上下文各模式从 event 属性提取并转 str。"""
        result = await get_context(event=_base_event(), mode=mode)
        assert result['result'] == expected
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_message_text(self):
        """message_text 提取纯文本。"""
        result = await get_context(event=_base_event(text='你好 世界'), mode='message_text')
        assert result['result'] == '你好 世界'

    @pytest.mark.asyncio
    async def test_message_text_without_message(self):
        """event 无 message 时返回空串。"""
        event = SimpleNamespace(user_id=1)
        result = await get_context(event=event, mode='message_text')
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_event_none(self):
        """event 为 None 时基础模式返回错误。"""
        result = await get_context(event=None, mode='user_id')
        assert result['error'] == 'event 为空'

    @pytest.mark.asyncio
    async def test_missing_attr_defaults_empty(self):
        """event 缺少某属性时返回空串而非崩溃。"""
        result = await get_context(event=SimpleNamespace(user_id=1), mode='group_id')
        assert result['result'] == ''


# =============================================================================
# command_args 模式
# =============================================================================
class TestCommandArgs:
    @pytest.mark.asyncio
    async def test_args_list_and_index(self):
        """返回完整参数列表与指定序号参数。"""
        event = SimpleNamespace(message=_FakeMsg(text='run task fast'))
        result = await get_context(event=event, mode='command_args', index=1)
        assert result['args_list'] == ['run', 'task', 'fast']
        assert result['result'] == 'task'

    @pytest.mark.asyncio
    async def test_index_out_of_range_empty(self):
        """序号越界返回空串。"""
        event = SimpleNamespace(message=_FakeMsg(text='a b'))
        result = await get_context(event=event, mode='command_args', index=5)
        assert result['result'] == ''
        result = await get_context(event=event, mode='command_args', index=-1)
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_no_message_empty_args(self):
        """无消息时 args_list 为空列表。"""
        event = SimpleNamespace(user_id=1)
        result = await get_context(event=event, mode='command_args')
        assert result['args_list'] == []
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_event_none(self):
        """event 为 None 返回错误。"""
        result = await get_context(event=None, mode='command_args')
        assert result['error'] == 'event 为空'


# =============================================================================
# group_members 模式
# =============================================================================
class TestGroupMembers:
    @pytest.mark.asyncio
    async def test_success(self):
        """成功获取成员列表，并透传 int 群号。"""
        bot = AsyncMock()
        bot.get_group_member_list = AsyncMock(
            return_value=[{'user_id': 1}, {'user_id': 2}]
        )
        event = SimpleNamespace(group_id=20002)
        result = await get_context(bot=bot, event=event, mode='group_members')
        assert result['success'] is True
        assert result['members'] == [{'user_id': 1}, {'user_id': 2}]
        assert result['result'] == [{'user_id': 1}, {'user_id': 2}]
        bot.get_group_member_list.assert_awaited_once_with(group_id=20002)

    @pytest.mark.asyncio
    async def test_group_id_param_overrides_event(self):
        """显式 group_id 参数优先于事件中的群号。"""
        bot = AsyncMock()
        bot.get_group_member_list = AsyncMock(return_value=[])
        result = await get_context(
            bot=bot, event=None, mode='group_members', group_id='30001'
        )
        assert result['success'] is True
        bot.get_group_member_list.assert_awaited_once_with(group_id=30001)

    @pytest.mark.asyncio
    async def test_truncated_to_max(self):
        """成员数超过上限时截断，防止下游 OOM。"""
        bot = AsyncMock()
        bot.get_group_member_list = AsyncMock(
            return_value=[{'i': i} for i in range(_MAX_GROUP_MEMBERS + 100)]
        )
        event = SimpleNamespace(group_id=20002)
        result = await get_context(bot=bot, event=event, mode='group_members')
        assert result['success'] is True
        assert len(result['members']) == _MAX_GROUP_MEMBERS

    @pytest.mark.asyncio
    async def test_timeout(self):
        """API 调用超时返回友好错误。"""
        bot = AsyncMock()
        bot.get_group_member_list = AsyncMock(side_effect=asyncio.TimeoutError())
        event = SimpleNamespace(group_id=20002)
        result = await get_context(bot=bot, event=event, mode='group_members')
        assert result['error'] == '获取群成员超时'

    @pytest.mark.asyncio
    async def test_invalid_group_id(self):
        """非数字群号返回可读错误。"""
        bot = AsyncMock()
        event = SimpleNamespace(group_id='abc')
        result = await get_context(bot=bot, event=event, mode='group_members')
        assert '必须为数字' in result['error']

    @pytest.mark.asyncio
    async def test_bot_none(self):
        """bot 缺失返回错误。"""
        result = await get_context(bot=None, event=SimpleNamespace(group_id=1), mode='group_members')
        assert result['error'] == 'bot 为空'

    @pytest.mark.asyncio
    async def test_group_id_empty(self):
        """群号缺失返回错误。"""
        result = await get_context(
            bot=AsyncMock(), event=SimpleNamespace(group_id=''), mode='group_members'
        )
        assert result['error'] == 'group_id 为空'


# =============================================================================
# message_part 模式
# =============================================================================
class TestMessagePart:
    @pytest.mark.asyncio
    async def test_at_mode(self):
        """at 片段提取 qq 列表。"""
        msg = _FakeMsg(segments=[
            _Seg('at', {'qq': '10001'}),
            _Seg('at', {'qq': '10002'}),
            _Seg('text', {'text': 'hi'}),
        ])
        event = SimpleNamespace(message=msg)
        result = await get_context(event=event, mode='message_part', part_mode='at')
        assert result['part_list'] == ['10001', '10002']
        assert result['part_count'] == 2
        assert result['result'] == '10001'

    @pytest.mark.asyncio
    async def test_image_mode(self):
        """image 片段优先取 url，缺省回退 file。"""
        msg = _FakeMsg(segments=[
            _Seg('image', {'url': 'http://x/img.png'}),
            _Seg('image', {'file': 'img2.png'}),
        ])
        event = SimpleNamespace(message=msg)
        result = await get_context(event=event, mode='message_part', part_mode='image')
        assert result['part_list'] == ['http://x/img.png', 'img2.png']

    @pytest.mark.parametrize('part_mode,segs,expected', [
        ('file', [_Seg('file', {'file': 'f1.zip'})], ['f1.zip']),
        ('reply', [_Seg('reply', {'id': 999})], ['999']),
        ('record', [_Seg('record', {'file': 'r.mp3'})], ['r.mp3']),
        ('video', [_Seg('video', {'file': 'v.mp4'})], ['v.mp4']),
    ])
    @pytest.mark.asyncio
    async def test_other_part_modes(self, part_mode, segs, expected):
        """file/reply/record/video 片段提取。"""
        event = SimpleNamespace(message=_FakeMsg(segments=segs))
        result = await get_context(event=event, mode='message_part', part_mode=part_mode)
        assert result['part_list'] == expected
        assert result['part_count'] == 1

    @pytest.mark.asyncio
    async def test_json_mode(self):
        """json 模式返回段类型 + 数据字典。"""
        msg = _FakeMsg(segments=[
            _Seg('face', {'id': '1'}),
            _Seg('text', {'text': 'hi'}),
        ])
        event = SimpleNamespace(message=msg)
        result = await get_context(event=event, mode='message_part', part_mode='json')
        assert result['part_list'] == [
            {'type': 'face', 'data': {'id': '1'}},
            {'type': 'text', 'data': {'text': 'hi'}},
        ]

    @pytest.mark.asyncio
    async def test_index_last(self):
        """index=-1 返回最后一个片段。"""
        msg = _FakeMsg(segments=[_Seg('at', {'qq': '1'}), _Seg('at', {'qq': '2'})])
        event = SimpleNamespace(message=msg)
        result = await get_context(event=event, mode='message_part', part_mode='at', index=-1)
        assert result['result'] == '2'

    @pytest.mark.asyncio
    async def test_index_out_of_range_none(self):
        """序号越界时 result 为 None。"""
        msg = _FakeMsg(segments=[_Seg('at', {'qq': '1'})])
        event = SimpleNamespace(message=msg)
        result = await get_context(event=event, mode='message_part', part_mode='at', index=3)
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_no_match_mode_parts_empty(self):
        """part_mode 无匹配段时列表为空。"""
        msg = _FakeMsg(segments=[_Seg('text', {'text': 'hi'})])
        event = SimpleNamespace(message=msg)
        result = await get_context(event=event, mode='message_part', part_mode='at')
        assert result['part_list'] == []
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_message_empty(self):
        """message 为空返回错误。"""
        result = await get_context(event=SimpleNamespace(message=None), mode='message_part')
        assert result['error'] == 'message 为空'


# =============================================================================
# user_name / group_name 模式
# =============================================================================
class TestNameQuery:
    @pytest.mark.asyncio
    async def test_user_name_prefers_card(self):
        """群内查询优先返回群名片，缺省回退昵称。"""
        bot = AsyncMock()
        bot.get_group_member_info = AsyncMock(
            return_value={'nickname': '张三', 'card': '李四'}
        )
        event = SimpleNamespace(user_id=10001, group_id=20002)
        result = await get_context(bot=bot, event=event, mode='user_name')
        assert result['card'] == '李四'
        assert result['nickname'] == '张三'
        assert result['result'] == '李四'

    @pytest.mark.asyncio
    async def test_user_name_card_empty_fallback_nickname(self):
        """无群名片时回退昵称。"""
        bot = AsyncMock()
        bot.get_group_member_info = AsyncMock(
            return_value={'nickname': '张三', 'card': ''}
        )
        event = SimpleNamespace(user_id=10001, group_id=20002)
        result = await get_context(bot=bot, event=event, mode='user_name')
        assert result['result'] == '张三'

    @pytest.mark.asyncio
    async def test_user_name_stranger(self):
        """无群号时查询陌生人信息。"""
        bot = AsyncMock()
        bot.get_stranger_info = AsyncMock(return_value={'nickname': '王五'})
        event = SimpleNamespace(user_id=10001, group_id='')
        result = await get_context(bot=bot, event=event, mode='user_name')
        bot.get_stranger_info.assert_awaited_once_with(user_id=10001)
        assert result['result'] == '王五'

    @pytest.mark.asyncio
    async def test_user_name_invalid_uid(self):
        """非数字 user_id 返回可读错误。"""
        bot = AsyncMock()
        event = SimpleNamespace(user_id='abc', group_id='20002')
        result = await get_context(bot=bot, event=event, mode='user_name')
        assert '必须为数字' in result['error']

    @pytest.mark.asyncio
    async def test_user_name_uid_empty(self):
        """user_id 缺失返回错误。"""
        result = await get_context(bot=AsyncMock(), event=SimpleNamespace(user_id=''), mode='user_name')
        assert result['error'] == 'user_id 为空'

    @pytest.mark.asyncio
    async def test_group_name(self):
        """group_name 查询群名。"""
        bot = AsyncMock()
        bot.get_group_info = AsyncMock(return_value={'group_name': '测试群'})
        result = await get_context(bot=bot, event=SimpleNamespace(group_id=20002), mode='group_name')
        assert result['result'] == '测试群'

    @pytest.mark.asyncio
    async def test_group_name_gid_empty(self):
        """群号缺失返回错误。"""
        result = await get_context(bot=AsyncMock(), event=SimpleNamespace(group_id=''), mode='group_name')
        assert result['error'] == 'group_id 为空'

    @pytest.mark.asyncio
    async def test_bot_none(self):
        """bot 缺失返回错误。"""
        result = await get_context(bot=None, event=SimpleNamespace(user_id=1), mode='user_name')
        assert result['error'] == 'bot 为空'


# =============================================================================
# 未知模式
# =============================================================================
class TestUnknownMode:
    @pytest.mark.asyncio
    async def test_unknown_mode(self):
        """未知 mode 返回错误。"""
        result = await get_context(mode='nope')
        assert result['error'] == '未知 mode: nope'
