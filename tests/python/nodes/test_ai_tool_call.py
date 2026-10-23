import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from qqbat_nodes.builtin.ai_tool_call import ai_tool_call, build_tool_prompt, parse_llm_response


def test_build_tool_prompt_contains_tools():
    tools = [
        {'kind': 'send_message', 'toolName': '发消息', 'summary': '发送文本消息', 'toolArgs': ['text']},
        {'kind': 'http_request', 'toolName': 'HTTP 请求', 'summary': '发起 HTTP 请求', 'toolArgs': ['url']},
    ]
    prompt = build_tool_prompt('今天天气', tools)
    assert '发消息' in prompt
    assert 'HTTP 请求' in prompt
    assert '今天天气' in prompt


def test_build_tool_prompt_empty_tools():
    prompt = build_tool_prompt('你好', [])
    assert '没有可用的工具' in prompt or '可用工具:' in prompt


def test_parse_llm_response_valid_json():
    resp = '{"calls": [{"node": "send_message", "args": {"text": "你好"}}]}'
    parsed = parse_llm_response(resp)
    assert parsed is not None
    assert parsed['calls'][0]['node'] == 'send_message'


def test_parse_llm_response_invalid_json():
    resp = '这不是 JSON'
    parsed = parse_llm_response(resp)
    assert parsed is None


def test_parse_llm_response_empty():
    parsed = parse_llm_response('')
    assert parsed is None


@pytest.mark.asyncio
async def test_ai_tool_call_no_tools(mock_bot, mock_event):
    result = await ai_tool_call(
        mock_bot, mock_event,
        user_message='你好',
        max_rounds=3,
        confirm_high_risk=False,
        system_prompt='test',
        available_tools=[]
    )
    mock_bot.send.assert_called()
    assert '没有可用' in result['response'] or '没有可用的工具' in result['response']
    assert result['rounds_used'] == 0
    assert result['tool_calls'] == []
    assert result['skipped_confirmations'] == []


@pytest.mark.asyncio
async def test_ai_tool_call_with_valid_plan(mock_bot, mock_event):
    with patch('qqbat_nodes.builtin.ai_tool_call.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = '{"calls": [{"node": "send_message", "args": {"text": "你好"}}]}'
        # mock execute_tool 避免真的调 send_message
        with patch('qqbat_nodes.builtin.ai_tool_call.execute_tool', new_callable=AsyncMock):
            result = await ai_tool_call(
                mock_bot, mock_event,
                user_message='你好',
                max_rounds=1,
                confirm_high_risk=False,
                system_prompt='test',
                available_tools=[
                    {'kind': 'send_message', 'toolName': '发消息', 'summary': '发消息', 'toolArgs': ['text'], 'sideEffects': ['send_message']}
                ]
            )
            assert isinstance(result, dict)
            assert 'response' in result
            assert 'error' in result
            assert 'rounds_used' in result
            assert 'tool_calls' in result
            assert 'skipped_confirmations' in result
            assert result['rounds_used'] == 1


@pytest.mark.asyncio
async def test_ai_tool_call_invalid_llm_response(mock_bot, mock_event):
    with patch('qqbat_nodes.builtin.ai_tool_call.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = '这不是 JSON'
        result = await ai_tool_call(
            mock_bot, mock_event,
            user_message='你好',
            max_rounds=1,
            confirm_high_risk=False,
            system_prompt='test',
            available_tools=[
                {'kind': 'send_message', 'toolName': '发消息', 'summary': '发消息', 'toolArgs': ['text'], 'sideEffects': ['send_message']}
            ]
        )
        # 非法 JSON 应该当作普通回复发送
        mock_bot.send.assert_called()
        assert isinstance(result, dict)
        assert 'response' in result
        assert 'error' in result
        assert 'rounds_used' in result
        assert 'tool_calls' in result
        assert 'skipped_confirmations' in result
        assert result['response'] == '这不是 JSON'
        assert result['rounds_used'] == 1
