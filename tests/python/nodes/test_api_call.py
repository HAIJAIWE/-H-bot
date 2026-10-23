"""api_call 节点单元测试。

api_call 节点调用 OneBot API（通过 bot.call_api），支持 action 名称和 params 参数。
参数 params 支持 dict / JSON 字符串两种形式，非法类型会被拒绝。

测试覆盖：
- 正常调用：默认 action、自定义 action、params 透传、返回结构
- params 解析：JSON 字符串解析、空字符串、非法 JSON、非 dict 类型拒绝
- 错误处理：call_api 异常被捕获、各种异常类型
- 返回结构完整性

被测源码：qqbat_nodes/builtin/api_call.py
测试策略：使用 conftest 的 mock_bot（AsyncMock），其 call_api 为 AsyncMock，
可配置 return_value / side_effect 模拟 OneBot API 响应。
"""
from unittest.mock import AsyncMock

import pytest

from qqbat_nodes.builtin.api_call import api_call


# ---------------------------------------------------------------------------
# 正常调用
# ---------------------------------------------------------------------------

class TestSuccessfulCall:
    """测试 api_call 正常调用时的行为。"""

    @pytest.mark.asyncio
    async def test_default_action_get_group_list(self, mock_bot, mock_event):
        """不传 action 时默认调用 get_group_list。"""
        mock_bot.call_api = AsyncMock(return_value=[{'group_id': 1}])
        await api_call(mock_bot, mock_event)
        mock_bot.call_api.assert_awaited_once_with('get_group_list')

    @pytest.mark.asyncio
    async def test_custom_action(self, mock_bot, mock_event):
        """自定义 action 名称被正确传递。"""
        mock_bot.call_api = AsyncMock(return_value={'ok': True})
        await api_call(mock_bot, mock_event, action='send_msg')
        mock_bot.call_api.assert_awaited_once_with('send_msg')

    @pytest.mark.asyncio
    async def test_params_passed_as_kwargs(self, mock_bot, mock_event):
        """dict params 被解包为关键字参数传递给 call_api。"""
        mock_bot.call_api = AsyncMock(return_value=True)
        await api_call(mock_bot, mock_event, action='send_group_msg',
                       params={'group_id': 123, 'message': 'hello'})
        mock_bot.call_api.assert_awaited_once_with(
            'send_group_msg', group_id=123, message='hello',
        )

    @pytest.mark.asyncio
    async def test_none_params_empty_dict(self, mock_bot, mock_event):
        """params=None 时作为空 dict 处理，call_api 仅传 action。"""
        mock_bot.call_api = AsyncMock(return_value=None)
        await api_call(mock_bot, mock_event, action='get_login_info', params=None)
        mock_bot.call_api.assert_awaited_once_with('get_login_info')

    @pytest.mark.asyncio
    async def test_success_true_on_success(self, mock_bot, mock_event):
        """成功时 success=True。"""
        mock_bot.call_api = AsyncMock(return_value={'user_id': 123})
        result = await api_call(mock_bot, mock_event, action='get_login_info')
        assert result['success'] is True

    @pytest.mark.asyncio
    async def test_result_field_populated(self, mock_bot, mock_event):
        """result 字段包含 call_api 返回值。"""
        data = {'user_id': 123, 'nickname': 'test'}
        mock_bot.call_api = AsyncMock(return_value=data)
        result = await api_call(mock_bot, mock_event, action='get_login_info')
        assert result['result'] == data

    @pytest.mark.asyncio
    async def test_data_field_same_as_result(self, mock_bot, mock_event):
        """data 字段与 result 字段值相同。"""
        data = [1, 2, 3]
        mock_bot.call_api = AsyncMock(return_value=data)
        result = await api_call(mock_bot, mock_event, action='get_group_list')
        assert result['data'] == result['result'] == data

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event):
        """成功时 error 字段为空字符串。"""
        mock_bot.call_api = AsyncMock(return_value='ok')
        result = await api_call(mock_bot, mock_event, action='test')
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_params_dict(self, mock_bot, mock_event):
        """空 dict params 等同于 None，call_api 仅传 action。"""
        mock_bot.call_api = AsyncMock(return_value=None)
        await api_call(mock_bot, mock_event, action='test', params={})
        mock_bot.call_api.assert_awaited_once_with('test')


# ---------------------------------------------------------------------------
# params 类型解析
# ---------------------------------------------------------------------------

class TestParamsParsing:
    """测试 params 参数的类型解析与校验。"""

    @pytest.mark.asyncio
    async def test_string_params_json_parsed(self, mock_bot, mock_event):
        """JSON 字符串 params 被解析为 dict 并解包为 kwargs。"""
        mock_bot.call_api = AsyncMock(return_value=True)
        await api_call(mock_bot, mock_event, action='send_msg',
                       params='{"user_id": 1, "message": "hi"}')
        mock_bot.call_api.assert_awaited_once_with(
            'send_msg', user_id=1, message='hi',
        )

    @pytest.mark.asyncio
    async def test_empty_string_params_becomes_empty_dict(self, mock_bot, mock_event):
        """空字符串 params 被当作空 dict 处理。"""
        mock_bot.call_api = AsyncMock(return_value=None)
        await api_call(mock_bot, mock_event, action='test', params='')
        mock_bot.call_api.assert_awaited_once_with('test')

    @pytest.mark.asyncio
    async def test_invalid_json_string_params_becomes_empty_dict(self, mock_bot, mock_event):
        """非法 JSON 字符串 params 被当作空 dict 处理（不抛异常）。"""
        mock_bot.call_api = AsyncMock(return_value=None)
        await api_call(mock_bot, mock_event, action='test', params='{invalid json}')
        mock_bot.call_api.assert_awaited_once_with('test')

    @pytest.mark.asyncio
    async def test_list_params_rejected(self, mock_bot, mock_event):
        """list 类型 params 被拒绝，返回 success=False。"""
        result = await api_call(mock_bot, mock_event, action='test', params=[1, 2])
        assert result['success'] is False
        assert 'dict' in result['error']

    @pytest.mark.asyncio
    async def test_int_params_rejected(self, mock_bot, mock_event):
        """int 类型 params 被拒绝。"""
        result = await api_call(mock_bot, mock_event, action='test', params=123)
        assert result['success'] is False
        assert 'dict' in result['error']

    @pytest.mark.asyncio
    async def test_non_dict_does_not_call_api(self, mock_bot, mock_event):
        """非 dict params 被拒绝时不调用 bot.call_api。"""
        mock_bot.call_api = AsyncMock()
        await api_call(mock_bot, mock_event, action='test', params=[1, 2])
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_params_with_none_value(self, mock_bot, mock_event):
        """params 中包含 None 值时正常传递。"""
        mock_bot.call_api = AsyncMock(return_value=None)
        await api_call(mock_bot, mock_event, action='test',
                       params={'key': None})
        mock_bot.call_api.assert_awaited_once_with('test', key=None)


# ---------------------------------------------------------------------------
# 错误处理
# ---------------------------------------------------------------------------

class TestErrorHandling:
    """测试 call_api 抛异常时的错误捕获。"""

    @pytest.mark.asyncio
    async def test_call_api_exception_returns_error(self, mock_bot, mock_event):
        """call_api 抛异常时返回 success=False + error 信息。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('api error'))
        result = await api_call(mock_bot, mock_event, action='test')
        assert result['success'] is False
        assert 'api error' in result['error']

    @pytest.mark.asyncio
    async def test_value_error_caught(self, mock_bot, mock_event):
        """call_api 抛 ValueError 时被捕获。"""
        mock_bot.call_api = AsyncMock(side_effect=ValueError('bad value'))
        result = await api_call(mock_bot, mock_event, action='test')
        assert result['success'] is False
        assert 'bad value' in result['error']

    @pytest.mark.asyncio
    async def test_connection_error_caught(self, mock_bot, mock_event):
        """call_api 抛 ConnectionError 时被捕获。"""
        mock_bot.call_api = AsyncMock(side_effect=ConnectionError('disconnected'))
        result = await api_call(mock_bot, mock_event, action='test')
        assert result['success'] is False
        assert 'disconnected' in result['error']

    @pytest.mark.asyncio
    async def test_result_none_on_error(self, mock_bot, mock_event):
        """错误时 result 字段为 None。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('fail'))
        result = await api_call(mock_bot, mock_event, action='test')
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_data_none_on_error(self, mock_bot, mock_event):
        """错误时 data 字段为 None。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('fail'))
        result = await api_call(mock_bot, mock_event, action='test')
        assert result['data'] is None

    @pytest.mark.asyncio
    async def test_error_is_string_type(self, mock_bot, mock_event):
        """error 字段始终为字符串类型。"""
        mock_bot.call_api = AsyncMock(side_effect=Exception(12345))
        result = await api_call(mock_bot, mock_event, action='test')
        assert isinstance(result['error'], str)
        assert '12345' in result['error']


# ---------------------------------------------------------------------------
# 返回结构完整性
# ---------------------------------------------------------------------------

class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_success_return_fields(self, mock_bot, mock_event):
        """成功路径返回 {success, result, data, error} 四个键。"""
        mock_bot.call_api = AsyncMock(return_value='ok')
        result = await api_call(mock_bot, mock_event, action='test')
        assert set(result.keys()) == {'success', 'result', 'data', 'error'}

    @pytest.mark.asyncio
    async def test_error_return_fields(self, mock_bot, mock_event):
        """错误路径同样返回 {success, result, data, error} 四个键。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('fail'))
        result = await api_call(mock_bot, mock_event, action='test')
        assert set(result.keys()) == {'success', 'result', 'data', 'error'}

    @pytest.mark.asyncio
    async def test_params_type_error_fields(self, mock_bot, mock_event):
        """params 类型错误路径返回 {success, result, data, error} 四个键。"""
        result = await api_call(mock_bot, mock_event, action='test', params=[1])
        assert set(result.keys()) == {'success', 'result', 'data', 'error'}

    @pytest.mark.asyncio
    async def test_success_is_bool_type(self, mock_bot, mock_event):
        """success 字段始终为 bool 类型。"""
        mock_bot.call_api = AsyncMock(return_value='ok')
        result = await api_call(mock_bot, mock_event, action='test')
        assert isinstance(result['success'], bool)


# ---------------------------------------------------------------------------
# P0-3: 高危 API 黑名单拦截
# ---------------------------------------------------------------------------
class TestHighRiskActionBlocklist:
    """验证 _HIGH_RISK_ACTIONS 黑名单拦截高危 API 调用。

    黑名单成员（来自 qqbat_nodes.builtin.api_call）：
    set_group_ban / set_group_kick / delete_friend /
    set_group_admin / set_group_special_title

    这些操作对群组/好友造成不可逆影响，需专用节点或显式确认。
    """

    @pytest.mark.asyncio
    async def test_set_group_ban_blocked(self, mock_bot, mock_event):
        """set_group_ban（群禁言）被拦截，不调用 call_api。"""
        result = await api_call(
            mock_bot, mock_event, action='set_group_ban',
            params={'group_id': 1, 'user_id': 2, 'duration': 60},
        )
        assert result['success'] is False
        assert 'set_group_ban' in result['error']
        assert '安全策略' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_set_group_kick_blocked(self, mock_bot, mock_event):
        """set_group_kick（踢出群成员）被拦截。"""
        result = await api_call(
            mock_bot, mock_event, action='set_group_kick',
            params={'group_id': 1, 'user_id': 2},
        )
        assert result['success'] is False
        assert 'set_group_kick' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_friend_blocked(self, mock_bot, mock_event):
        """delete_friend（删除好友）被拦截。"""
        result = await api_call(
            mock_bot, mock_event, action='delete_friend',
            params={'user_id': 2},
        )
        assert result['success'] is False
        assert 'delete_friend' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_set_group_admin_blocked(self, mock_bot, mock_event):
        """set_group_admin（设置/取消管理员）被拦截。"""
        result = await api_call(
            mock_bot, mock_event, action='set_group_admin',
            params={'group_id': 1, 'user_id': 2, 'enable': True},
        )
        assert result['success'] is False
        assert 'set_group_admin' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_set_group_special_title_blocked(self, mock_bot, mock_event):
        """set_group_special_title（设置群头衔）被拦截。"""
        result = await api_call(
            mock_bot, mock_event, action='set_group_special_title',
            params={'group_id': 1, 'user_id': 2, 'special_title': '大佬'},
        )
        assert result['success'] is False
        assert 'set_group_special_title' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_blocklist_return_structure(self, mock_bot, mock_event):
        """拦截时返回结构完整：{success, result, data, error} 四个键。"""
        result = await api_call(
            mock_bot, mock_event, action='set_group_ban',
            params={'group_id': 1, 'user_id': 2},
        )
        assert set(result.keys()) == {'success', 'result', 'data', 'error'}
        assert result['result'] is None
        assert result['data'] is None
        assert isinstance(result['error'], str)

    @pytest.mark.asyncio
    async def test_similar_action_not_blocked(self, mock_bot, mock_event):
        """名称相近但不在黑名单的 action 正常放行。

        set_group_ban 的变体（如 set_group_ban_view）不应被误拦。
        """
        mock_bot.call_api = AsyncMock(return_value={'ok': True})
        result = await api_call(
            mock_bot, mock_event, action='set_group_ban_view',
            params={'group_id': 1},
        )
        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with('set_group_ban_view', group_id=1)

    @pytest.mark.asyncio
    async def test_case_sensitive_blocklist(self, mock_bot, mock_event):
        """黑名单大小写敏感：SET_GROUP_BAN 不被拦截（与 set_group_ban 不同）。"""
        # 大写变体不在黑名单中，应正常调用（即使实际 API 不存在）
        mock_bot.call_api = AsyncMock(return_value='ok')
        result = await api_call(
            mock_bot, mock_event, action='SET_GROUP_BAN',
            params={'group_id': 1},
        )
        assert result['success'] is True
        # 大写变体未拦截，且透传了原始 action 与 params
        mock_bot.call_api.assert_awaited_once_with('SET_GROUP_BAN', group_id=1)

    @pytest.mark.asyncio
    async def test_blocklist_takes_priority_over_invalid_params(self, mock_bot, mock_event):
        """黑名单拦截优先于 params 类型校验。

        即使 params 类型非法，高危 action 也应被拦截而非报 params 错误。
        """
        result = await api_call(
            mock_bot, mock_event, action='set_group_ban',
            params=[1, 2],  # 非法 params 类型
        )
        # 应被黑名单拦截（而非 params 错误）
        assert result['success'] is False
        assert 'set_group_ban' in result['error']
        assert '安全策略' in result['error']
        mock_bot.call_api.assert_not_called()
