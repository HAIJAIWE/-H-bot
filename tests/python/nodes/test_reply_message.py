import pytest
from unittest.mock import AsyncMock, MagicMock
from qqbat_nodes.builtin.reply_message import reply_message


@pytest.mark.asyncio
async def test_normal_mode_sends_text(mock_bot, mock_event):
    """normal 模式直接发固定文本"""
    await reply_message(mock_bot, mock_event, mode='normal', text='你好')
    mock_bot.send.assert_called_once_with(mock_event, '你好')


@pytest.mark.asyncio
async def test_normal_mode_converts_non_string(mock_bot, mock_event):
    """normal 模式把非字符串转字符串"""
    await reply_message(mock_bot, mock_event, mode='normal', text=12345)
    mock_bot.send.assert_called_once_with(mock_event, '12345')


@pytest.mark.asyncio
async def test_llm_mode_calls_llm_and_sends_response(mock_bot, mock_event):
    """llm 模式调用 llm_chat_fn 并发送返回值"""
    mock_llm = AsyncMock(return_value='AI 回复')
    await reply_message(
        mock_bot, mock_event,
        mode='llm', prompt='你好',
        llm_chat_fn=mock_llm
    )
    mock_llm.assert_called_once()
    # 验证 llm_chat_fn 收到正确的 prompt
    args, kwargs = mock_llm.call_args
    assert kwargs.get('prompt') == '你好'
    mock_bot.send.assert_called_with(mock_event, 'AI 回复')


@pytest.mark.asyncio
async def test_llm_mode_uses_event_message_when_prompt_empty(mock_bot, mock_event):
    """llm 模式 prompt 为空时用 event.get_message()"""
    mock_event.get_message.return_value = 'event message'
    mock_llm = AsyncMock(return_value='回复')
    await reply_message(
        mock_bot, mock_event,
        mode='llm', prompt='',
        llm_chat_fn=mock_llm
    )
    args, kwargs = mock_llm.call_args
    assert kwargs.get('prompt') == 'event message'


@pytest.mark.asyncio
async def test_llm_mode_handles_exception(mock_bot, mock_event):
    """llm 模式 LLM 抛异常时发送错误消息"""
    mock_llm = AsyncMock(side_effect=Exception('LLM down'))
    await reply_message(
        mock_bot, mock_event,
        mode='llm', prompt='你好',
        llm_chat_fn=mock_llm
    )
    # 验证发送了错误消息
    mock_bot.send.assert_called_once()
    args = mock_bot.send.call_args[0]
    assert '处理出错' in args[1]
    assert 'LLM down' in args[1]
