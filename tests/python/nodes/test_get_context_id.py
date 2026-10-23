"""get_context_id 节点单元测试。

被测源码：qqbat_nodes/builtin/get_context_id.py

覆盖：
- 8 种 mode（user_id/group_id/message_text/self_id/operator_id/message_id/raw_message/sub_type）
- 未知 mode 入口校验
- event 为 None
- message_text / raw_message 模式的异常容错
- 缺失属性兜底（getattr 默认空字符串）
- 返回结构完整性

返回 dict 结构：
- 成功: {"result": 值, "error": ""}
- 未知 mode: {"success": False, "result": "", "error": 友好提示}
- event 为 None: {"result": "", "error": "event 为空"}
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.builtin.get_context_id import get_context_id, VALID_MODES


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_event(**kwargs):
    """构造一个模拟事件对象，按 kwargs 设置属性。"""
    ev = MagicMock()
    for k, v in kwargs.items():
        setattr(ev, k, v)
    return ev


# =============================================================================
# mode='user_id'
# =============================================================================
class TestUserIdMode:
    """验证 mode='user_id' 提取发送者 QQ 号。"""

    @pytest.mark.asyncio
    async def test_extract_user_id_string(self, mock_bot, mock_event):
        """提取字符串 user_id。"""
        ev = make_event(user_id='12345')
        result = await get_context_id(mock_bot, ev, mode='user_id')
        assert result['result'] == '12345'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_extract_user_id_int_converted_to_string(self, mock_bot, mock_event):
        """int 类型 user_id 转换为字符串。"""
        ev = make_event(user_id=12345)
        result = await get_context_id(mock_bot, ev, mode='user_id')
        assert result['result'] == '12345'

    @pytest.mark.asyncio
    async def test_user_id_missing_returns_empty(self, mock_bot, mock_event):
        """event 无 user_id 属性 → 返回空字符串。"""
        ev = MagicMock()
        del ev.user_id
        result = await get_context_id(mock_bot, ev, mode='user_id')
        assert result['result'] == ''


# =============================================================================
# mode='group_id'
# =============================================================================
class TestGroupIdMode:
    """验证 mode='group_id' 提取群号。"""

    @pytest.mark.asyncio
    async def test_extract_group_id(self, mock_bot, mock_event):
        """提取群号。"""
        ev = make_event(group_id='grp1')
        result = await get_context_id(mock_bot, ev, mode='group_id')
        assert result['result'] == 'grp1'

    @pytest.mark.asyncio
    async def test_private_chat_returns_empty(self, mock_bot, mock_event):
        """私聊场景 group_id 为空 → 返回空字符串。"""
        ev = make_event(group_id='')
        result = await get_context_id(mock_bot, ev, mode='group_id')
        assert result['result'] == ''


# =============================================================================
# mode='message_text'
# =============================================================================
class TestMessageTextMode:
    """验证 mode='message_text' 提取消息纯文本。"""

    @pytest.mark.asyncio
    async def test_extract_via_get_plaintext(self, mock_bot, mock_event):
        """event 有 get_plaintext 方法时优先调用。"""
        ev = make_event()
        ev.get_plaintext = MagicMock(return_value='纯文本')
        result = await get_context_id(mock_bot, ev, mode='message_text')
        assert result['result'] == '纯文本'

    @pytest.mark.asyncio
    async def test_extract_via_get_message_fallback(self, mock_bot, mock_event):
        """event 无 get_plaintext 时回退到 str(get_message())。"""
        ev = make_event()
        del ev.get_plaintext
        ev.get_message = MagicMock(return_value='fallback msg')
        result = await get_context_id(mock_bot, ev, mode='message_text')
        assert result['result'] == 'fallback msg'

    @pytest.mark.asyncio
    async def test_get_plaintext_raises_returns_error(self, mock_bot, mock_event):
        """get_plaintext 抛异常 → 返回 error。"""
        ev = make_event()
        ev.get_plaintext = MagicMock(side_effect=RuntimeError('err'))
        result = await get_context_id(mock_bot, ev, mode='message_text')
        assert result['result'] == ''
        assert 'err' in result['error']


# =============================================================================
# mode='self_id'
# =============================================================================
class TestSelfIdMode:
    """验证 mode='self_id' 提取机器人自身 QQ 号。"""

    @pytest.mark.asyncio
    async def test_extract_self_id(self, mock_bot, mock_event):
        """提取机器人自身 QQ 号。"""
        ev = make_event(self_id='99999')
        result = await get_context_id(mock_bot, ev, mode='self_id')
        assert result['result'] == '99999'

    @pytest.mark.asyncio
    async def test_self_id_missing_returns_empty(self, mock_bot, mock_event):
        """event 无 self_id 属性 → 返回空字符串。"""
        ev = MagicMock()
        del ev.self_id
        result = await get_context_id(mock_bot, ev, mode='self_id')
        assert result['result'] == ''


# =============================================================================
# mode='operator_id'
# =============================================================================
class TestOperatorIdMode:
    """验证 mode='operator_id' 提取操作者 QQ 号。"""

    @pytest.mark.asyncio
    async def test_extract_operator_id(self, mock_bot, mock_event):
        """提取操作者 QQ 号（通知事件）。"""
        ev = make_event(operator_id='88888')
        result = await get_context_id(mock_bot, ev, mode='operator_id')
        assert result['result'] == '88888'

    @pytest.mark.asyncio
    async def test_operator_id_missing_returns_empty(self, mock_bot, mock_event):
        """event 无 operator_id 属性 → 返回空字符串。"""
        ev = MagicMock()
        del ev.operator_id
        result = await get_context_id(mock_bot, ev, mode='operator_id')
        assert result['result'] == ''


# =============================================================================
# mode='message_id'
# =============================================================================
class TestMessageIdMode:
    """验证 mode='message_id' 提取当前消息 ID。"""

    @pytest.mark.asyncio
    async def test_extract_message_id(self, mock_bot, mock_event):
        """提取消息 ID。"""
        ev = make_event(message_id=12345)
        result = await get_context_id(mock_bot, ev, mode='message_id')
        assert result['result'] == '12345'

    @pytest.mark.asyncio
    async def test_message_id_missing_returns_empty(self, mock_bot, mock_event):
        """event 无 message_id 属性 → 返回空字符串。"""
        ev = MagicMock()
        del ev.message_id
        result = await get_context_id(mock_bot, ev, mode='message_id')
        assert result['result'] == ''


# =============================================================================
# mode='raw_message'
# =============================================================================
class TestRawMessageMode:
    """验证 mode='raw_message' 提取原始消息字符串。"""

    @pytest.mark.asyncio
    async def test_extract_raw_message_attr(self, mock_bot, mock_event):
        """event 有 raw_message 属性时直接取。"""
        ev = make_event(raw_message='[CQ:at,qq=1] 原始')
        result = await get_context_id(mock_bot, ev, mode='raw_message')
        assert result['result'] == '[CQ:at,qq=1] 原始'

    @pytest.mark.asyncio
    async def test_raw_message_falls_back_to_get_message(self, mock_bot, mock_event):
        """event 无 raw_message 时回退到 str(get_message())。"""
        ev = make_event()
        del ev.raw_message
        ev.get_message = MagicMock(return_value='fallback')
        result = await get_context_id(mock_bot, ev, mode='raw_message')
        assert result['result'] == 'fallback'

    @pytest.mark.asyncio
    async def test_raw_message_none_returns_empty(self, mock_bot, mock_event):
        """raw_message 为 None 且无 get_message → 返回空字符串。"""
        ev = make_event()
        del ev.raw_message
        del ev.get_message
        result = await get_context_id(mock_bot, ev, mode='raw_message')
        assert result['result'] == ''


# =============================================================================
# mode='sub_type'
# =============================================================================
class TestSubTypeMode:
    """验证 mode='sub_type' 提取事件子类型。"""

    @pytest.mark.asyncio
    async def test_extract_sub_type(self, mock_bot, mock_event):
        """提取事件子类型（如 approve/leave/kick）。"""
        ev = make_event(sub_type='approve')
        result = await get_context_id(mock_bot, ev, mode='sub_type')
        assert result['result'] == 'approve'

    @pytest.mark.asyncio
    async def test_sub_type_missing_returns_empty(self, mock_bot, mock_event):
        """event 无 sub_type 属性 → 返回空字符串。"""
        ev = MagicMock()
        del ev.sub_type
        result = await get_context_id(mock_bot, ev, mode='sub_type')
        assert result['result'] == ''


# =============================================================================
# 未知 mode
# =============================================================================
class TestUnknownMode:
    """验证未知 mode 的入口校验。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode 返回 success=False + 友好错误信息。"""
        ev = make_event()
        result = await get_context_id(mock_bot, ev, mode='unknown')
        assert result['success'] is False
        assert '未知模式' in result['error']
        assert 'unknown' in result['error']

    def test_valid_modes_set(self):
        """VALID_MODES 集合包含 8 种合法 mode。"""
        assert VALID_MODES == {
            'user_id', 'group_id', 'message_text', 'self_id',
            'operator_id', 'message_id', 'raw_message', 'sub_type',
        }


# =============================================================================
# event 为 None
# =============================================================================
class TestNoneEvent:
    """验证 event 为 None 时的处理。"""

    @pytest.mark.asyncio
    async def test_none_event_returns_error(self, mock_bot):
        """event=None → 返回 'event 为空' 错误。"""
        result = await get_context_id(mock_bot, None, mode='user_id')
        assert result['result'] == ''
        assert result['error'] == 'event 为空'

    @pytest.mark.asyncio
    async def test_none_event_with_unknown_mode_returns_mode_error(self, mock_bot):
        """event=None 且 mode 未知 → 优先返回 mode 错误（mode 校验在前）。"""
        result = await get_context_id(mock_bot, None, mode='unknown')
        assert result['success'] is False
        assert '未知模式' in result['error']


# =============================================================================
# 默认参数与返回结构
# =============================================================================
class TestDefaultsAndStructure:
    """验证默认参数与返回结构完整性。"""

    @pytest.mark.asyncio
    async def test_default_mode_is_user_id(self, mock_bot, mock_event):
        """不传 mode 时默认为 'user_id'。"""
        ev = make_event(user_id='100')
        result = await get_context_id(mock_bot, ev)
        assert result['result'] == '100'

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 和 error 两个字段。"""
        ev = make_event(user_id='100')
        result = await get_context_id(mock_bot, ev, mode='user_id')
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_result_always_string(self, mock_bot, mock_event):
        """result 字段始终为字符串类型。"""
        ev = make_event(user_id=12345, group_id=99999)
        for mode in ('user_id', 'group_id', 'self_id', 'operator_id', 'message_id'):
            ev.self_id = 11111
            ev.operator_id = 22222
            ev.message_id = 33333
            result = await get_context_id(mock_bot, ev, mode=mode)
            assert isinstance(result['result'], str), f'mode={mode} result 应为 str'
