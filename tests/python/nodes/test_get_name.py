"""get_name 节点单元测试。

被测源码：qqbat_nodes/builtin/get_name.py

覆盖：
- mode='user': 群成员查询（card 优先 / nickname 兜底）
- mode='user': 陌生人查询（私聊场景）
- mode='user': group_id 为空时走陌生人查询
- mode='group': 群名称查询
- 未知 mode 入口校验
- user_id / group_id 缺失
- API 异常容错（get_group_member_info 失败回退陌生人查询）
- 返回结构完整性

返回 dict 结构：
- 成功: {"result": 名称, "card": 群昵称, "nickname": 用户昵称, "error": ""}
- 未知 mode: {"success": False, "result": "", "card": "", "nickname": "", "error": 友好提示}
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from qqbat_nodes.builtin.get_name import get_name, VALID_MODES


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_event(user_id='100', group_id=''):
    """构造一个模拟事件对象。"""
    ev = MagicMock()
    ev.user_id = user_id
    ev.group_id = group_id
    return ev


def make_bot_with_group_member_info(info):
    """构造 bot，call_api('get_group_member_info', ...) 返回 info。"""
    bot = AsyncMock()
    bot.call_api = AsyncMock(return_value=info)
    return bot


# =============================================================================
# mode='user' 群成员查询
# =============================================================================
class TestUserModeGroupMember:
    """验证 mode='user' 在群聊场景下的用户昵称查询。"""

    @pytest.mark.asyncio
    async def test_card_present_returns_card(self, mock_bot, mock_event):
        """群成员有群名片时返回群名片（card 优先）。"""
        mock_bot.call_api = AsyncMock(return_value={
            'card': '群名片', 'nickname': '原始昵称',
        })
        ev = make_event(user_id='100', group_id='999')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == '群名片'
        assert result['card'] == '群名片'
        assert result['nickname'] == '原始昵称'
        assert result['error'] == ''
        mock_bot.call_api.assert_called_with(
            'get_group_member_info', group_id=999, user_id=100,
        )

    @pytest.mark.asyncio
    async def test_card_empty_returns_nickname(self, mock_bot, mock_event):
        """群成员无群名片时回退到 nickname（card 字段也回退为 nickname）。

        源码：card = info.get('card', '') or info.get('nickname', '')
        当 card='' 时为 falsy，card 变量也取 nickname 值。
        """
        mock_bot.call_api = AsyncMock(return_value={
            'card': '', 'nickname': '原始昵称',
        })
        ev = make_event(user_id='100', group_id='999')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == '原始昵称'
        # 源码 card = '' or '原始昵称' → '原始昵称'
        assert result['card'] == '原始昵称'

    @pytest.mark.asyncio
    async def test_card_none_returns_nickname(self, mock_bot, mock_event):
        """群成员 card 为 None 时回退到 nickname。"""
        mock_bot.call_api = AsyncMock(return_value={
            'card': None, 'nickname': '昵称',
        })
        ev = make_event(user_id='100', group_id='999')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == '昵称'

    @pytest.mark.asyncio
    async def test_group_member_info_falls_back_to_stranger(self, mock_bot, mock_event):
        """get_group_member_info 失败时回退到 get_stranger_info。"""
        call_count = [0]

        async def side_effect(api, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError('not in group')
            return {'nickname': '陌生人昵称'}

        mock_bot.call_api = AsyncMock(side_effect=side_effect)
        ev = make_event(user_id='100', group_id='999')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == '陌生人昵称'
        assert result['card'] == ''
        assert result['nickname'] == '陌生人昵称'


# =============================================================================
# mode='user' 陌生人查询（私聊场景）
# =============================================================================
class TestUserModeStranger:
    """验证 mode='user' 在私聊场景下的陌生人查询。"""

    @pytest.mark.asyncio
    async def test_no_group_id_calls_stranger_info(self, mock_bot, mock_event):
        """group_id 为空时直接走 get_stranger_info。"""
        mock_bot.call_api = AsyncMock(return_value={'nickname': '陌生人'})
        ev = make_event(user_id='100', group_id='')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == '陌生人'
        assert result['nickname'] == '陌生人'
        assert result['card'] == ''
        mock_bot.call_api.assert_called_with('get_stranger_info', user_id=100)

    @pytest.mark.asyncio
    async def test_stranger_info_failure_returns_error(self, mock_bot, mock_event):
        """get_stranger_info 失败时返回 error。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('api down'))
        ev = make_event(user_id='100', group_id='')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == ''
        assert 'api down' in result['error']


# =============================================================================
# mode='group' 群名称查询
# =============================================================================
class TestGroupMode:
    """验证 mode='group' 的群名称查询。"""

    @pytest.mark.asyncio
    async def test_group_mode_returns_group_name(self, mock_bot, mock_event):
        """group 模式返回群名称。"""
        mock_bot.call_api = AsyncMock(return_value={'group_name': '测试群'})
        ev = make_event(group_id='999')
        result = await get_name(mock_bot, ev, mode='group')
        assert result['result'] == '测试群'
        assert result['error'] == ''
        mock_bot.call_api.assert_called_with('get_group_info', group_id=999)

    @pytest.mark.asyncio
    async def test_group_mode_empty_group_id_returns_error(self, mock_bot, mock_event):
        """group 模式下 group_id 为空 → 返回 error。"""
        ev = make_event(group_id='')
        result = await get_name(mock_bot, ev, mode='group')
        assert result['result'] == ''
        assert 'group_id 为空' in result['error']

    @pytest.mark.asyncio
    async def test_group_mode_api_failure_returns_error(self, mock_bot, mock_event):
        """group 模式 API 失败 → 返回 error。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('not in group'))
        ev = make_event(group_id='999')
        result = await get_name(mock_bot, ev, mode='group')
        assert result['result'] == ''
        assert 'not in group' in result['error']


# =============================================================================
# 未知 mode
# =============================================================================
class TestUnknownMode:
    """验证未知 mode 的入口校验。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode 返回 success=False + 友好错误信息。"""
        result = await get_name(mock_bot, mock_event, mode='unknown')
        assert result['success'] is False
        assert '未知模式' in result['error']
        assert 'unknown' in result['error']

    @pytest.mark.asyncio
    async def test_unknown_mode_includes_valid_modes(self, mock_bot, mock_event):
        """未知 mode 错误信息中列出合法 mode 集合。"""
        result = await get_name(mock_bot, mock_event, mode='xyz')
        # VALID_MODES = {'user', 'group'}，sorted 后为 ['group', 'user']
        assert 'group' in result['error']
        assert 'user' in result['error']

    def test_valid_modes_set(self):
        """VALID_MODES 集合包含 user 和 group。"""
        assert VALID_MODES == {'user', 'group'}


# =============================================================================
# 参数缺失
# =============================================================================
class TestMissingParameters:
    """验证 user_id / group_id 缺失时的行为。"""

    @pytest.mark.asyncio
    async def test_user_mode_empty_user_id_returns_error(self, mock_bot, mock_event):
        """user 模式下 user_id 为空 → 返回 error。"""
        ev = make_event(user_id='', group_id='')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == ''
        assert 'user_id 为空' in result['error']

    @pytest.mark.asyncio
    async def test_user_mode_user_id_from_event(self, mock_bot, mock_event):
        """user_id 参数为空时从 event.user_id 取。"""
        mock_bot.call_api = AsyncMock(return_value={'nickname': '从事件取'})
        ev = make_event(user_id='999', group_id='')
        result = await get_name(mock_bot, ev, mode='user', user_id='', group_id='')
        assert result['result'] == '从事件取'
        mock_bot.call_api.assert_called_with('get_stranger_info', user_id=999)

    @pytest.mark.asyncio
    async def test_explicit_user_id_overrides_event(self, mock_bot, mock_event):
        """显式传入的 user_id 优先于 event.user_id。"""
        mock_bot.call_api = AsyncMock(return_value={'nickname': '显式'})
        ev = make_event(user_id='999', group_id='')
        result = await get_name(mock_bot, ev, mode='user', user_id='888')
        assert result['result'] == '显式'
        mock_bot.call_api.assert_called_with('get_stranger_info', user_id=888)


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_user_mode_return_has_all_fields(self, mock_bot, mock_event):
        """user 模式返回 dict 含 result/card/nickname/error 四个字段。"""
        mock_bot.call_api = AsyncMock(return_value={
            'card': 'c', 'nickname': 'n',
        })
        ev = make_event(user_id='100', group_id='999')
        result = await get_name(mock_bot, ev, mode='user')
        assert set(result.keys()) == {'result', 'card', 'nickname', 'error'}

    @pytest.mark.asyncio
    async def test_group_mode_return_has_all_fields(self, mock_bot, mock_event):
        """group 模式返回 dict 含 result/card/nickname/error 四个字段。"""
        mock_bot.call_api = AsyncMock(return_value={'group_name': '群名'})
        ev = make_event(group_id='999')
        result = await get_name(mock_bot, ev, mode='group')
        assert set(result.keys()) == {'result', 'card', 'nickname', 'error'}
        # group 模式 card/nickname 为空字符串
        assert result['card'] == ''
        assert result['nickname'] == ''


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaults:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_default_mode_is_user(self, mock_bot, mock_event):
        """不传 mode 时默认为 'user'。"""
        mock_bot.call_api = AsyncMock(return_value={'nickname': '默认'})
        ev = make_event(user_id='100', group_id='')
        result = await get_name(mock_bot, ev)
        assert result['result'] == '默认'
        # 应调用 get_stranger_info（user 模式 + 无 group_id）
        mock_bot.call_api.assert_called_with('get_stranger_info', user_id=100)

    @pytest.mark.asyncio
    async def test_default_user_id_and_group_id_empty(self, mock_bot, mock_event):
        """不传 user_id/group_id 时默认为空字符串，从 event 取。"""
        mock_bot.call_api = AsyncMock(return_value={'nickname': 'x'})
        ev = make_event(user_id='555', group_id='')
        result = await get_name(mock_bot, ev, mode='user')
        assert result['result'] == 'x'
        mock_bot.call_api.assert_called_with('get_stranger_info', user_id=555)


# =============================================================================
# 类型转换
# =============================================================================
class TestTypeConversion:
    """验证 user_id / group_id 字符串到 int 的转换。"""

    @pytest.mark.asyncio
    async def test_string_user_id_converted_to_int(self, mock_bot, mock_event):
        """字符串 user_id='100' 转换为 int 100 传给 call_api。"""
        mock_bot.call_api = AsyncMock(return_value={'nickname': 'n'})
        ev = make_event(user_id='', group_id='')
        await get_name(mock_bot, ev, mode='user', user_id='100', group_id='')
        # call_api 的 user_id 参数应为 int(100)
        call_kwargs = mock_bot.call_api.call_args.kwargs
        assert call_kwargs['user_id'] == 100
        assert isinstance(call_kwargs['user_id'], int)

    @pytest.mark.asyncio
    async def test_string_group_id_converted_to_int(self, mock_bot, mock_event):
        """字符串 group_id='999' 转换为 int 999 传给 call_api。"""
        mock_bot.call_api = AsyncMock(return_value={
            'card': 'c', 'nickname': 'n',
        })
        ev = make_event(user_id='100', group_id='')
        await get_name(
            mock_bot, ev, mode='user', user_id='100', group_id='999',
        )
        call_kwargs = mock_bot.call_api.call_args.kwargs
        assert call_kwargs['group_id'] == 999
        assert isinstance(call_kwargs['group_id'], int)
