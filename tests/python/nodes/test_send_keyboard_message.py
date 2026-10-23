import pytest
from unittest.mock import AsyncMock, MagicMock

from qqbat_nodes.builtin.send_keyboard_message import send_keyboard_message


@pytest.mark.asyncio
async def test_empty_markdown_rejected(mock_bot, mock_event):
    """空 markdown 应被拒绝。"""
    result = await send_keyboard_message(mock_bot, mock_event, markdown='', keyboard={'rows': []})
    assert result['success'] is False
    assert 'markdown 不能为空' in result['error']
    mock_bot.call_api.assert_not_called()


@pytest.mark.asyncio
async def test_empty_keyboard_rejected(mock_bot, mock_event):
    """空 keyboard 应被拒绝。"""
    result = await send_keyboard_message(mock_bot, mock_event, markdown='hello', keyboard={})
    assert result['success'] is False
    assert 'keyboard' in result['error']
    mock_bot.call_api.assert_not_called()


@pytest.mark.asyncio
async def test_none_keyboard_rejected(mock_bot, mock_event):
    """keyboard=None 应被拒绝。"""
    result = await send_keyboard_message(mock_bot, mock_event, markdown='hello', keyboard=None)
    assert result['success'] is False
    assert 'keyboard' in result['error']


@pytest.mark.asyncio
async def test_group_message_extracts_group_id(mock_bot, mock_event):
    """群消息事件应提取 group_id 并传入 message_type='group'。"""
    mock_event.group_id = 123456
    mock_event.user_id = 100
    mock_event.get_message_id = MagicMock(return_value='msg123')
    mock_bot.call_api = AsyncMock(return_value={'message_id': 'sent_id_1'})

    keyboard = {'rows': [{'buttons': [{'id': '1', 'render_data': {'label': 'OK'}, 'action': {'type': 2, 'permission': {'type': 2}, 'data': '/ok'}}]}]}
    result = await send_keyboard_message(mock_bot, mock_event, markdown='## 标题', keyboard=keyboard)

    assert result['success'] is True
    assert result['message_id'] == 'sent_id_1'
    mock_bot.call_api.assert_called_once()
    call_args = mock_bot.call_api.call_args
    assert call_args[0][0] == 'send_keyboard_msg'
    assert call_args[1]['message_type'] == 'group'
    assert call_args[1]['group_id'] == '123456'
    assert call_args[1]['markdown'] == '## 标题'
    assert call_args[1]['keyboard'] == keyboard
    assert call_args[1]['msg_id'] == 'msg123'


@pytest.mark.asyncio
async def test_private_message_extracts_user_id(mock_bot, mock_event):
    """私聊消息事件（无 group_id）应提取 user_id 并传入 message_type='private'。"""
    mock_event.group_id = None
    mock_event.user_id = 88888
    mock_event.get_message_id = MagicMock(return_value=None)
    mock_bot.call_api = AsyncMock(return_value={'message_id': 'sent_id_2'})

    keyboard = {'rows': []}
    result = await send_keyboard_message(mock_bot, mock_event, markdown='hi', keyboard=keyboard)

    assert result['success'] is True
    assert result['message_id'] == 'sent_id_2'
    call_args = mock_bot.call_api.call_args
    assert call_args[1]['message_type'] == 'private'
    assert call_args[1]['user_id'] == '88888'
    assert 'msg_id' not in call_args[1]


@pytest.mark.asyncio
async def test_no_target_in_event_returns_error(mock_bot, mock_event):
    """事件中无 group_id 和 user_id 时应报错。"""
    mock_event.group_id = None
    mock_event.user_id = None
    result = await send_keyboard_message(mock_bot, mock_event, markdown='hi', keyboard={'rows': []})
    assert result['success'] is False
    assert '回复目标' in result['error']


@pytest.mark.asyncio
async def test_call_api_failure_returns_error(mock_bot, mock_event):
    """bot.call_api 抛异常时应捕获并返回错误。"""
    mock_event.group_id = 123
    mock_event.user_id = 100
    mock_event.get_message_id = MagicMock(return_value=None)
    mock_bot.call_api = AsyncMock(side_effect=RuntimeError('Action not found: send_keyboard_msg'))

    result = await send_keyboard_message(mock_bot, mock_event, markdown='hi', keyboard={'rows': []})
    assert result['success'] is False
    assert '不支持按钮消息' in result['error'] or 'Action not found' in result['error']


@pytest.mark.asyncio
async def test_non_dict_response_handled(mock_bot, mock_event):
    """bot.call_api 返回非 dict 时应正常处理（message_id 为空）。"""
    mock_event.group_id = 123
    mock_event.user_id = 100
    mock_event.get_message_id = MagicMock(return_value=None)
    mock_bot.call_api = AsyncMock(return_value=None)

    result = await send_keyboard_message(mock_bot, mock_event, markdown='hi', keyboard={'rows': []})
    assert result['success'] is True
    assert result['message_id'] == ''
