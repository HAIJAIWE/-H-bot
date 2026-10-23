"""message_op(mode='forward') 节点单元测试。

被测源码：qqbat_nodes/builtin/message_op.py

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
- 返回结构完整性

返回 dict 结构：
- 成功: {"result": {"messages": [...]}, "message_id": "", "error": ""}
- 失败: {"result": {}, "message_id": "", "error": str(e)}
"""
import json
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.builtin.message_op import message_op


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_event(user_id='100'):
    """构造一个模拟事件对象。"""
    ev = MagicMock()
    ev.user_id = user_id
    return ev


# =============================================================================
# JSON 字符串形式 messages
# =============================================================================
class TestJsonStringMessages:
    """验证 messages 为 JSON 字符串时的构造。"""

    @pytest.mark.asyncio
    async def test_single_message_json(self, mock_bot, mock_event):
        """单条消息 JSON 字符串构造 forward node。"""
        messages = json.dumps([{'content': 'hello', 'user_id': '100'}])
        ev = make_event(user_id='100')
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert result['error'] == ''
        assert 'messages' in result['result']
        nodes = result['result']['messages']
        assert len(nodes) == 1
        assert nodes[0]['type'] == 'node'
        assert nodes[0]['data']['content'] == 'hello'
        assert nodes[0]['data']['uin'] == '100'

    @pytest.mark.asyncio
    async def test_multiple_messages_json(self, mock_bot, mock_event):
        """多条消息 JSON 字符串构造多个 forward node。"""
        messages = json.dumps([
            {'content': 'msg1', 'user_id': '100'},
            {'content': 'msg2', 'user_id': '200'},
        ])
        ev = make_event(user_id='100')
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert result['error'] == ''
        nodes = result['result']['messages']
        assert len(nodes) == 2
        assert nodes[0]['data']['content'] == 'msg1'
        assert nodes[1]['data']['content'] == 'msg2'


# =============================================================================
# list 形式 messages
# =============================================================================
class TestListMessages:
    """验证 messages 为 list 时的构造。"""

    @pytest.mark.asyncio
    async def test_single_message_list(self, mock_bot, mock_event):
        """单条消息 list 构造 forward node。"""
        messages = [{'content': 'hi', 'user_id': '100'}]
        ev = make_event(user_id='100')
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert result['error'] == ''
        nodes = result['result']['messages']
        assert len(nodes) == 1
        assert nodes[0]['data']['content'] == 'hi'

    @pytest.mark.asyncio
    async def test_multiple_messages_list(self, mock_bot, mock_event):
        """多条消息 list 构造多个 forward node。"""
        messages = [
            {'content': 'a', 'user_id': '1'},
            {'content': 'b', 'user_id': '2'},
            {'content': 'c', 'user_id': '3'},
        ]
        ev = make_event(user_id='100')
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert result['error'] == ''
        nodes = result['result']['messages']
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
    async def test_user_id_from_event_when_empty(self, mock_bot, mock_event):
        """user_id 参数为空时从 event.user_id 取。"""
        messages = [{'content': 'msg'}]  # 不含 user_id 字段
        ev = make_event(user_id='999')
        result = await message_op(mock_bot, ev, mode='forward', messages=messages, user_id='')
        nodes = result['result']['messages']
        # 消息无 user_id 字段 → 用 uid（从 event 取）
        assert nodes[0]['data']['uin'] == '999'

    @pytest.mark.asyncio
    async def test_explicit_user_id_overrides_event(self, mock_bot, mock_event):
        """显式传入的 user_id 优先于 event.user_id。"""
        messages = [{'content': 'msg'}]
        ev = make_event(user_id='999')
        result = await message_op(
            mock_bot, ev, mode='forward', messages=messages, user_id='888',
        )
        nodes = result['result']['messages']
        assert nodes[0]['data']['uin'] == '888'

    @pytest.mark.asyncio
    async def test_message_user_id_overrides_param(self, mock_bot, mock_event):
        """消息中的 user_id 字段优先于 user_id 参数。"""
        messages = [{'content': 'msg', 'user_id': '777'}]
        ev = make_event(user_id='999')
        result = await message_op(
            mock_bot, ev, mode='forward', messages=messages, user_id='888',
        )
        nodes = result['result']['messages']
        # 消息中的 user_id 优先
        assert nodes[0]['data']['uin'] == '777'


# =============================================================================
# node 字段完整性
# =============================================================================
class TestNodeFields:
    """验证构造的 forward node 字段完整性。"""

    @pytest.mark.asyncio
    async def test_node_has_type_field(self, mock_bot, mock_event):
        """每个 node 含 type='node' 字段。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        nodes = result['result']['messages']
        assert nodes[0]['type'] == 'node'

    @pytest.mark.asyncio
    async def test_node_has_data_field(self, mock_bot, mock_event):
        """每个 node 含 data 字段。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        nodes = result['result']['messages']
        assert 'data' in nodes[0]

    @pytest.mark.asyncio
    async def test_data_has_name_uin_content(self, mock_bot, mock_event):
        """data 字段含 name/uin/content 三个子字段。"""
        messages = [{'content': 'c', 'user_id': '1', 'name': 'n'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        data = result['result']['messages'][0]['data']
        assert set(data.keys()) == {'name', 'uin', 'content'}
        assert data['name'] == 'n'
        assert data['uin'] == '1'
        assert data['content'] == 'c'

    @pytest.mark.asyncio
    async def test_name_field_optional(self, mock_bot, mock_event):
        """消息无 name 字段时 data.name 为空字符串。"""
        messages = [{'content': 'c', 'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        data = result['result']['messages'][0]['data']
        assert data['name'] == ''

    @pytest.mark.asyncio
    async def test_content_field_optional(self, mock_bot, mock_event):
        """消息无 content 字段时 data.content 为空字符串。"""
        messages = [{'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        data = result['result']['messages'][0]['data']
        assert data['content'] == ''


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证错误场景的处理。"""

    @pytest.mark.asyncio
    async def test_invalid_json_returns_error(self, mock_bot, mock_event):
        """非法 JSON 字符串 → 返回 error。"""
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages='not json')
        assert result['result'] == {}
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_empty_messages_list_returns_error(self, mock_bot, mock_event):
        """空 list messages → 返回 error。"""
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=[])
        assert result['result'] == {}
        assert '为空' in result['error'] or '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_empty_json_array_returns_error(self, mock_bot, mock_event):
        """空 JSON 数组 → 返回 error。"""
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages='[]')
        assert result['result'] == {}
        assert '为空' in result['error'] or '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_invalid_messages_type_returns_error(self, mock_bot, mock_event):
        """messages 为非字符串/非列表类型 → 返回 error。"""
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=12345)
        assert result['result'] == {}
        assert '格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_json_not_list_returns_error(self, mock_bot, mock_event):
        """JSON 解析后非 list（如 JSON 对象）→ 返回 error。"""
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages='{"key": "value"}')
        assert result['result'] == {}
        assert '为空' in result['error'] or '格式错误' in result['error']


# =============================================================================
# 默认参数与返回结构
# =============================================================================
class TestDefaultsAndStructure:
    """验证默认参数与返回结构完整性。"""

    @pytest.mark.asyncio
    async def test_default_messages_empty(self, mock_bot, mock_event):
        """不传 messages 时默认为空字符串 → 解析为空 → 返回 error。"""
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward')
        assert result['result'] == {}

    @pytest.mark.asyncio
    async def test_default_user_id_empty(self, mock_bot, mock_event):
        """不传 user_id 时默认为空字符串（从 event 取）。"""
        messages = [{'content': 'x'}]
        ev = make_event(user_id='555')
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        # user_id 为空 → 从 event.user_id 取
        assert result['result']['messages'][0]['data']['uin'] == '555'

    @pytest.mark.asyncio
    async def test_return_has_result_message_id_error(self, mock_bot, mock_event):
        """返回 dict 必含 segment/result/message_id/success/error 五个字段。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert set(result.keys()) == {'segment', 'result', 'message_id', 'success', 'error'}

    @pytest.mark.asyncio
    async def test_message_id_always_empty(self, mock_bot, mock_event):
        """message_id 字段始终为空字符串（forward_construct 不发送消息）。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert result['message_id'] == ''

    @pytest.mark.asyncio
    async def test_result_contains_messages_key(self, mock_bot, mock_event):
        """成功时 result 字段含 messages key。"""
        messages = [{'content': 'x', 'user_id': '1'}]
        ev = make_event()
        result = await message_op(mock_bot, ev, mode='forward', messages=messages)
        assert 'messages' in result['result']
        assert isinstance(result['result']['messages'], list)
