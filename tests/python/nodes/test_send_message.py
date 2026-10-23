import pytest
from unittest.mock import AsyncMock
from qqbat_nodes.builtin.send_message import send_message


@pytest.mark.asyncio
async def test_send_message_calls_bot_send(mock_bot, mock_event):
    await send_message(mock_bot, mock_event, text='你好')
    mock_bot.send.assert_called_once_with(mock_event, '你好')


@pytest.mark.asyncio
async def test_send_message_converts_non_string(mock_bot, mock_event):
    await send_message(mock_bot, mock_event, text=12345)
    mock_bot.send.assert_called_once_with(mock_event, '12345')


@pytest.mark.asyncio
async def test_send_message_empty_text(mock_bot, mock_event):
    """空文本应被拒绝（返回 error，不调用 bot.send）。"""
    result = await send_message(mock_bot, mock_event, text='')
    assert result['success'] is False
    assert 'text 不能为空' in result['error']
    mock_bot.send.assert_not_called()


# =========================================================================
# 异常路径补齐（P1 测试盲点）
# =========================================================================
@pytest.mark.asyncio
async def test_send_message_none_text_rejected(mock_bot, mock_event):
    """text=None 应被拒绝（与空字符串同等处理）。"""
    result = await send_message(mock_bot, mock_event, text=None)
    assert result['success'] is False
    assert 'text 不能为空' in result['error']
    mock_bot.send.assert_not_called()


@pytest.mark.asyncio
async def test_send_message_bot_send_raises_returns_error(mock_bot, mock_event):
    """bot.send 抛异常时，handler 应捕获并写入 error 字段，不向上抛。"""
    mock_bot.send = AsyncMock(side_effect=RuntimeError('网络断开'))
    result = await send_message(mock_bot, mock_event, text='hello')
    assert result['success'] is False
    assert '网络断开' in result['error']


@pytest.mark.asyncio
async def test_send_message_bot_send_raises_timeout(mock_bot, mock_event):
    """bot.send 抛 asyncio.TimeoutError 时也应被捕获，不向上抛。"""
    import asyncio
    mock_bot.send = AsyncMock(side_effect=asyncio.TimeoutError())
    result = await send_message(mock_bot, mock_event, text='hello')
    assert result['success'] is False
    # asyncio.TimeoutError 的 str() 为空字符串，但 success=False 表明异常已被捕获


@pytest.mark.asyncio
async def test_send_message_dict_text_converted_to_str(mock_bot, mock_event):
    """dict 类型 text 应被 str() 转换后发送（不会按消息段语义解析）。"""
    await send_message(mock_bot, mock_event, text={'key': 'value'})
    mock_bot.send.assert_called_once()
    args, _ = mock_bot.send.call_args
    assert args[0] == mock_event
    assert args[1] == "{'key': 'value'}"


@pytest.mark.asyncio
async def test_send_message_list_text_converted_to_str(mock_bot, mock_event):
    """list 类型 text 应被 str() 转换后发送。"""
    await send_message(mock_bot, mock_event, text=[1, 2, 3])
    mock_bot.send.assert_called_once_with(mock_event, '[1, 2, 3]')


@pytest.mark.asyncio
async def test_send_message_zero_text_sent(mock_bot, mock_event):
    """text=0 应被发送为 '0'（0 != '' 为 True，故不被拒绝）。"""
    await send_message(mock_bot, mock_event, text=0)
    mock_bot.send.assert_called_once_with(mock_event, '0')


@pytest.mark.asyncio
async def test_send_message_false_text_sent(mock_bot, mock_event):
    """text=False 应被发送为 'False'（False != '' 为 True，故不被拒绝）。"""
    await send_message(mock_bot, mock_event, text=False)
    mock_bot.send.assert_called_once_with(mock_event, 'False')
