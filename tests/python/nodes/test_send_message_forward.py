"""send_message(mode='forward') 节点单元测试 — 合并转发发送。

被测源码：qqbat_nodes/builtin/send_message.py

覆盖：
- JSON 字符串形式的 messages 参数
- list 形式的 messages 参数
- 多条消息构造 forward node 列表
- 单条消息
- user_id 从 event 取（参数为空时）
- 每条消息的 name/uin/content 字段
- messages 格式错误（非字符串/非列表）
- messages 为空
- JSON 解析失败
- 缺少群聊目标返回错误
- 返回结构完整性

返回 dict 结构：
- 成功: {"success": True, "message_id": str, "error": ""}
- 失败: {"success": False, "message_id": "", "error": str}
"""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from qqbat_nodes.builtin.send_message import send_message


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_event(user_id='100', group_id='654321'):
    """构造一个模拟事件对象。"""
    ev = MagicMock()
    ev.user_id = user_id
    ev.group_id = group_id
    return ev


def make_bot_with_forward():
    """构造一个 mock bot，call_api 返回带 message_id 的响应。"""
    bot = AsyncMock()
    bot.send = AsyncMock()
    bot.call_api = AsyncMock(return_value={'message_id': 'mock-fwd-001'})
    return bot


# =============================================================================
# JSON 字符串形式 messages
# =============================================================================
class TestJsonStringMessages:
    """验证 messages 为 JSON 字符串时的构造。"""

    @pytest.mark.asyncio
    async def test_single_message_json(self):
        """单条消息 JSON 字符串构造 forward node 并发送。"""
        messages = json.dumps([{'content': 'hello', 'user_id': '100'}])
        ev = make_event(user_id='100')
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is True
        assert result['error'] == ''
        assert result['message_id'] == 'mock-fwd-001'
        # 验证 call_api 被调用
        bot.call_api.assert_called_once()
        call_args = bot.call_api.call_args
        assert call_args[0][0] == 'send_group_forward_msg'
        nodes = call_args[1]['messages']
        assert len(nodes) == 1
        assert nodes[0]['type'] == 'node'
        assert nodes[0]['data']['content'] == 'hello'
        assert nodes[0]['data']['uin'] == '100'

    @pytest.mark.asyncio
    async def test_multiple_messages_json(self):
        """多条消息 JSON 字符串构造多个 forward node。"""
        messages = json.dumps([
            {'content': 'msg1', 'user_id': '100'},
            {'content': 'msg2', 'user_id': '200'},
        ])
        ev = make_event(user_id='100')
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is True
        call_args = bot.call_api.call_args
        nodes = call_args[1]['messages']
        assert len(nodes) == 2
        assert nodes[0]['data']['content'] == 'msg1'
        assert nodes[1]['data']['content'] == 'msg2'


# =============================================================================
# list 形式 messages
# =============================================================================
class TestListMessages:
    """验证 messages 为 list 时的构造。"""

    @pytest.mark.asyncio
    async def test_single_message_list(self):
        """单条消息 list 构造 forward node。"""
        messages = [{'content': 'hi', 'user_id': '100'}]
        ev = make_event(user_id='100')
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is True
        call_args = bot.call_api.call_args
        nodes = call_args[1]['messages']
        assert len(nodes) == 1
        assert nodes[0]['data']['content'] == 'hi'

    @pytest.mark.asyncio
    async def test_multiple_messages_list(self):
        """多条消息 list 构造多个 forward node。"""
        messages = [
            {'content': 'a', 'user_id': '1'},
            {'content': 'b', 'user_id': '2'},
            {'content': 'c', 'user_id': '3'},
        ]
        ev = make_event(user_id='100')
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is True
        call_args = bot.call_api.call_args
        nodes = call_args[1]['messages']
        assert len(nodes) == 3
        assert nodes[0]['data']['uin'] == '1'
        assert nodes[1]['data']['uin'] == '2'
        assert nodes[2]['data']['uin'] == '3'


# =============================================================================
# user_id 处理
# =============================================================================
class TestUserIdHandling:
    """验证 user_id 参数的处理。"""

    @pytest.mark.asyncio
    async def test_user_id_from_event_when_empty(self):
        """user_id 参数为空时从 event.user_id 取。"""
        messages = [{'content': 'msg'}]  # 不含 user_id 字段
        ev = make_event(user_id='999')
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages, user_id='')
        assert result['success'] is True
        nodes = bot.call_api.call_args[1]['messages']
        # 消息无 user_id 字段 → 用 uid（从 event 取）
        assert nodes[0]['data']['uin'] == '999'

    @pytest.mark.asyncio
    async def test_explicit_user_id_overrides_event(self):
        """显式传入的 user_id 优先于 event.user_id。"""
        messages = [{'content': 'msg'}]
        ev = make_event(user_id='999')
        bot = make_bot_with_forward()
        result = await send_message(
            bot, ev, mode='forward', messages=messages, user_id='888',
        )
        assert result['success'] is True
        nodes = bot.call_api.call_args[1]['messages']
        assert nodes[0]['data']['uin'] == '888'

    @pytest.mark.asyncio
    async def test_message_user_id_overrides_param(self):
        """消息中的 user_id 字段优先于 user_id 参数。"""
        messages = [{'content': 'msg', 'user_id': '777'}]
        ev = make_event(user_id='999')
        bot = make_bot_with_forward()
        result = await send_message(
            bot, ev, mode='forward', messages=messages, user_id='888',
        )
        assert result['success'] is True
        nodes = bot.call_api.call_args[1]['messages']
        # 消息中的 user_id 优先
        assert nodes[0]['data']['uin'] == '777'


# =============================================================================
# node 字段完整性
# =============================================================================
class TestNodeFields:
    """验证构造的 forward node 字段完整性。"""

    @pytest.mark.asyncio
    async def test_node_has_type_field(self):
        """每个 node 含 type='node' 字段。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        bot = make_bot_with_forward()
        await send_message(bot, ev, mode='forward', messages=messages)
        nodes = bot.call_api.call_args[1]['messages']
        assert nodes[0]['type'] == 'node'

    @pytest.mark.asyncio
    async def test_node_has_data_field(self):
        """每个 node 含 data 字段。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        bot = make_bot_with_forward()
        await send_message(bot, ev, mode='forward', messages=messages)
        nodes = bot.call_api.call_args[1]['messages']
        assert 'data' in nodes[0]

    @pytest.mark.asyncio
    async def test_data_has_name_uin_content(self):
        """data 字段含 name/uin/content 三个子字段。"""
        messages = [{'content': 'c', 'user_id': '1', 'name': 'n'}]
        ev = make_event()
        bot = make_bot_with_forward()
        await send_message(bot, ev, mode='forward', messages=messages)
        data = bot.call_api.call_args[1]['messages'][0]['data']
        assert set(data.keys()) == {'name', 'uin', 'content'}
        assert data['name'] == 'n'
        assert data['uin'] == '1'
        assert data['content'] == 'c'

    @pytest.mark.asyncio
    async def test_name_field_optional(self):
        """消息无 name 字段时 data.name 为空字符串。"""
        messages = [{'content': 'c', 'user_id': '1'}]
        ev = make_event()
        bot = make_bot_with_forward()
        await send_message(bot, ev, mode='forward', messages=messages)
        data = bot.call_api.call_args[1]['messages'][0]['data']
        assert data['name'] == ''

    @pytest.mark.asyncio
    async def test_content_field_optional(self):
        """消息无 content 字段时 data.content 为空字符串。"""
        messages = [{'user_id': '1'}]
        ev = make_event()
        bot = make_bot_with_forward()
        await send_message(bot, ev, mode='forward', messages=messages)
        data = bot.call_api.call_args[1]['messages'][0]['data']
        assert data['content'] == ''


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证错误场景的处理。"""

    @pytest.mark.asyncio
    async def test_invalid_json_returns_error(self):
        """非法 JSON 字符串 → 返回 error。"""
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages='not json')
        assert result['success'] is False
        assert result['error'] != ''
        bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_messages_list_returns_error(self):
        """空 list messages → 返回 error。"""
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=[])
        assert result['success'] is False
        assert '为空' in result['error'] or '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_empty_json_array_returns_error(self):
        """空 JSON 数组 → 返回 error。"""
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages='[]')
        assert result['success'] is False
        assert '为空' in result['error'] or '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_messages_type_returns_error(self):
        """messages 为非字符串/非列表类型 → 返回 error。"""
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=12345)
        assert result['success'] is False
        assert '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_json_not_list_returns_error(self):
        """JSON 解析后非 list（如 JSON 对象）→ 返回 error。"""
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages='{"key": "value"}')
        assert result['success'] is False
        assert '为空' in result['error'] or '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_no_group_target_returns_error(self):
        """无群聊目标（event 无 group_id 且未设 target_type=group）→ 返回 error。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = MagicMock()
        ev.user_id = '100'
        ev.group_id = None  # 无群聊
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is False
        assert '群聊' in result['error']
        bot.call_api.assert_not_called()


# =============================================================================
# 默认参数与返回结构
# =============================================================================
class TestDefaultsAndStructure:
    """验证默认参数与返回结构完整性。"""

    @pytest.mark.asyncio
    async def test_default_messages_empty(self):
        """不传 messages 时默认为空字符串 → 解析为空 → 返回 error。"""
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward')
        assert result['success'] is False

    @pytest.mark.asyncio
    async def test_default_user_id_empty(self):
        """不传 user_id 时默认为空字符串（从 event 取）。"""
        messages = [{'content': 'x'}]
        ev = make_event(user_id='555')
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is True
        # user_id 为空 → 从 event.user_id 取
        assert bot.call_api.call_args[1]['messages'][0]['data']['uin'] == '555'

    @pytest.mark.asyncio
    async def test_return_has_success_message_id_error(self):
        """返回 dict 必含 success/message_id/error 三个字段。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        bot = make_bot_with_forward()
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert set(result.keys()) == {'success', 'message_id', 'error'}

    @pytest.mark.asyncio
    async def test_target_type_group_with_target_id(self):
        """通过 target_type=group + target_id 指定群聊目标。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = MagicMock()
        ev.user_id = '100'
        ev.group_id = None
        bot = make_bot_with_forward()
        result = await send_message(
            bot, ev, mode='forward', messages=messages,
            target_type='group', target_id='999888',
        )
        assert result['success'] is True
        call_args = bot.call_api.call_args
        assert call_args[1]['group_id'] == 999888


# =============================================================================
# 发送 API 调用验证
# =============================================================================
class TestSendApiCall:
    """验证 send_group_forward_msg API 调用参数。"""

    @pytest.mark.asyncio
    async def test_calls_send_group_forward_msg(self):
        """验证调用 send_group_forward_msg API。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        bot = make_bot_with_forward()
        await send_message(bot, ev, mode='forward', messages=messages)
        bot.call_api.assert_called_once_with(
            'send_group_forward_msg',
            group_id=654321,
            messages=bot.call_api.call_args[1]['messages'],
        )

    @pytest.mark.asyncio
    async def test_api_exception_returns_error(self):
        """bot.call_api 抛异常时返回错误。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        bot = AsyncMock()
        bot.call_api = AsyncMock(side_effect=RuntimeError('API 调用失败'))
        result = await send_message(bot, ev, mode='forward', messages=messages)
        assert result['success'] is False
        assert 'API 调用失败' in result['error']
