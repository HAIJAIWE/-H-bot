"""llm_chat 节点单元测试。

llm_chat 节点调用大语言模型，实际 LLM 调用委托给 plugins.custom.llm_chat。
builtin handler 负责参数校验（空 prompt 拒绝）、异常捕获、可重试错误重试。

测试覆盖：
- 空 prompt 前置拒绝
- 正常调用：response/error/attempts 字段、参数透传（prompt/system_prompt/temperature/history）
- 错误处理：各种异常被捕获并转为 error 字段
- 重试机制：可重试错误重试、不可重试错误立即返回、指数退避延迟、重试耗尽
- 返回结构完整性

被测源码：qqbat_nodes/builtin/llm_chat.py
测试策略：通过 patch.dict('sys.modules', ...) 注入 mock 的 plugins.custom 模块，
避免真实 LLM API 调用。
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.llm_chat import llm_chat


# ---------------------------------------------------------------------------
# mock plugins.custom.llm_chat fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_custom_llm():
    """Mock plugins.custom.llm_chat 函数，避免真实 LLM 调用。

    通过 patch.dict('sys.modules', ...) 注入 mock 模块，使 builtin handler 内的
    ``from plugins.custom import llm_chat as custom_llm`` 获取到 mock 函数。

    用法：
        mock = mock_custom_llm
        mock.return_value = 'LLM 回复内容'
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
    """
    mock_fn = AsyncMock()
    mock_module = MagicMock()
    mock_module.llm_chat = mock_fn
    # 同时注入 plugins 和 plugins.custom，使 from plugins.custom import ... 生效
    with patch.dict('sys.modules', {
        'plugins': MagicMock(),
        'plugins.custom': mock_module,
    }):
        yield mock_fn


# ===========================================================================
# 空 prompt 前置拒绝
# ===========================================================================

class TestEmptyPrompt:
    """测试空 prompt 的前置拒绝逻辑。"""

    @pytest.mark.asyncio
    async def test_empty_prompt_returns_error(self, mock_bot, mock_event):
        """空字符串 prompt 直接返回错误，不调用 LLM。"""
        result = await llm_chat(mock_bot, mock_event, prompt='')
        assert result['response'] == ''
        assert 'prompt 不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_none_prompt_returns_error(self, mock_bot, mock_event):
        """None prompt 直接返回错误。"""
        result = await llm_chat(mock_bot, mock_event, prompt=None)
        assert result['response'] == ''
        assert 'prompt 不能为空' in result['error']

    @pytest.mark.asyncio
    async def test_empty_prompt_does_not_call_llm(self, mock_bot, mock_event, mock_custom_llm):
        """空 prompt 时不调用 custom_llm。"""
        await llm_chat(mock_bot, mock_event, prompt='')
        mock_custom_llm.assert_not_called()


# ===========================================================================
# 正常调用
# ===========================================================================

class TestSuccessfulCall:
    """测试 LLM 正常调用时的返回结构与参数透传。"""

    @pytest.mark.asyncio
    async def test_successful_call_returns_response(self, mock_bot, mock_event, mock_custom_llm):
        """正常调用返回 LLM 回复内容。"""
        mock_custom_llm.return_value = '你好，我是 AI 助手'
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == '你好，我是 AI 助手'
        assert result['attempts'] == 1
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event, mock_custom_llm):
        """成功时 error 字段为空字符串。"""
        mock_custom_llm.return_value = '回复'
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_prompt_passed_to_custom_llm(self, mock_bot, mock_event, mock_custom_llm):
        """prompt 参数被透传给 custom_llm。"""
        mock_custom_llm.return_value = 'ok'
        await llm_chat(mock_bot, mock_event, prompt='翻译这句话')
        mock_custom_llm.assert_awaited_once_with(
            prompt='翻译这句话', system_prompt='', temperature=0.7, history=[],
        )

    @pytest.mark.asyncio
    async def test_system_prompt_passed(self, mock_bot, mock_event, mock_custom_llm):
        """system_prompt 参数被透传给 custom_llm。"""
        mock_custom_llm.return_value = 'ok'
        await llm_chat(mock_bot, mock_event, prompt='你好', system_prompt='你是客服')
        mock_custom_llm.assert_awaited_once()
        assert mock_custom_llm.call_args.kwargs['system_prompt'] == '你是客服'

    @pytest.mark.asyncio
    async def test_temperature_passed(self, mock_bot, mock_event, mock_custom_llm):
        """temperature 参数被透传给 custom_llm。"""
        mock_custom_llm.return_value = 'ok'
        await llm_chat(mock_bot, mock_event, prompt='你好', temperature=0.1)
        assert mock_custom_llm.call_args.kwargs['temperature'] == 0.1

    @pytest.mark.asyncio
    async def test_history_passed(self, mock_bot, mock_event, mock_custom_llm):
        """history 参数被透传给 custom_llm。"""
        mock_custom_llm.return_value = 'ok'
        history = [{'role': 'user', 'content': '之前的问题'}]
        await llm_chat(mock_bot, mock_event, prompt='继续', history=history)
        assert mock_custom_llm.call_args.kwargs['history'] == history

    @pytest.mark.asyncio
    async def test_default_temperature_07(self, mock_bot, mock_event, mock_custom_llm):
        """不传 temperature 时默认 0.7。"""
        mock_custom_llm.return_value = 'ok'
        await llm_chat(mock_bot, mock_event, prompt='你好')
        assert mock_custom_llm.call_args.kwargs['temperature'] == 0.7

    @pytest.mark.asyncio
    async def test_default_history_empty_list(self, mock_bot, mock_event, mock_custom_llm):
        """不传 history 时默认空列表 []（避免可变默认参数陷阱）。"""
        mock_custom_llm.return_value = 'ok'
        await llm_chat(mock_bot, mock_event, prompt='你好')
        assert mock_custom_llm.call_args.kwargs['history'] == []

    @pytest.mark.asyncio
    async def test_default_system_prompt_empty(self, mock_bot, mock_event, mock_custom_llm):
        """不传 system_prompt 时默认空字符串。"""
        mock_custom_llm.return_value = 'ok'
        await llm_chat(mock_bot, mock_event, prompt='你好')
        assert mock_custom_llm.call_args.kwargs['system_prompt'] == ''

    @pytest.mark.asyncio
    async def test_empty_string_response_handled(self, mock_bot, mock_event, mock_custom_llm):
        """LLM 返回空字符串时也视为成功（error 为空）。"""
        mock_custom_llm.return_value = ''
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''
        assert result['error'] == ''


# ===========================================================================
# 错误处理
# ===========================================================================

class TestErrorHandling:
    """测试 LLM 调用异常时的错误捕获与返回。"""

    @pytest.mark.asyncio
    async def test_runtime_error_caught(self, mock_bot, mock_event, mock_custom_llm):
        """custom_llm 抛 RuntimeError 时被捕获，返回 error 字段。"""
        mock_custom_llm.side_effect = RuntimeError('未配置 AI API Key')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''
        assert '未配置 AI API Key' in result['error']

    @pytest.mark.asyncio
    async def test_value_error_caught(self, mock_bot, mock_event, mock_custom_llm):
        """custom_llm 抛 ValueError 时被捕获。"""
        mock_custom_llm.side_effect = ValueError('temperature 超出范围')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''
        assert 'temperature 超出范围' in result['error']

    @pytest.mark.asyncio
    async def test_generic_exception_caught(self, mock_bot, mock_event, mock_custom_llm):
        """custom_llm 抛任意 Exception 时被捕获。"""
        mock_custom_llm.side_effect = Exception('未知错误')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''
        assert '未知错误' in result['error']

    @pytest.mark.asyncio
    async def test_connection_error_caught(self, mock_bot, mock_event, mock_custom_llm):
        """custom_llm 抛 ConnectionError 时被捕获。"""
        mock_custom_llm.side_effect = ConnectionError('网络不可达')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''
        assert '网络不可达' in result['error']

    @pytest.mark.asyncio
    async def test_response_empty_on_error(self, mock_bot, mock_event, mock_custom_llm):
        """错误时 response 字段始终为空字符串。"""
        mock_custom_llm.side_effect = RuntimeError('fail')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''

    @pytest.mark.asyncio
    async def test_error_message_is_string(self, mock_bot, mock_event, mock_custom_llm):
        """error 字段始终为字符串类型。"""
        mock_custom_llm.side_effect = Exception(12345)
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert isinstance(result['error'], str)
        assert '12345' in result['error']


# ===========================================================================
# 返回结构完整性
# ===========================================================================

class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_success_return_fields(self, mock_bot, mock_event, mock_custom_llm):
        """成功路径返回 {response, error, attempts} 三个键。"""
        mock_custom_llm.return_value = 'ok'
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert set(result.keys()) == {'response', 'error', 'attempts'}

    @pytest.mark.asyncio
    async def test_error_return_fields(self, mock_bot, mock_event, mock_custom_llm):
        """错误路径返回 {response, error, attempts, retryable} 四个键。"""
        mock_custom_llm.side_effect = RuntimeError('fail')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert set(result.keys()) == {'response', 'error', 'attempts', 'retryable'}

    @pytest.mark.asyncio
    async def test_empty_prompt_return_fields(self, mock_bot, mock_event):
        """空 prompt 路径返回 {response, error, attempts} 三个键（attempts=0）。"""
        result = await llm_chat(mock_bot, mock_event, prompt='')
        assert set(result.keys()) == {'response', 'error', 'attempts'}
        assert result['attempts'] == 0

    @pytest.mark.asyncio
    async def test_response_is_string_on_success(self, mock_bot, mock_event, mock_custom_llm):
        """成功时 response 为字符串类型。"""
        mock_custom_llm.return_value = '回复文本'
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert isinstance(result['response'], str)

    @pytest.mark.asyncio
    async def test_error_is_string_type(self, mock_bot, mock_event, mock_custom_llm):
        """error 字段始终为字符串类型。"""
        mock_custom_llm.return_value = 'ok'
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert isinstance(result['error'], str)


# ===========================================================================
# 重试机制
# ===========================================================================

class TestRetryMechanism:
    """测试可重试错误的重试机制。

    llm_chat 内置重试策略：
    - 可重试错误关键字：timeout、connection、5xx、429 等
    - 不可重试错误：参数错误、API Key 错误、内容违规等
    - 默认 max_retries=2（共 3 次尝试），指数退避 0.5s → 1s
    """

    @pytest.mark.asyncio
    async def test_non_retryable_error_returns_immediately(self, mock_bot, mock_event, mock_custom_llm):
        """不可重试错误（如 ValueError）立即返回，不重试。"""
        mock_custom_llm.side_effect = ValueError('invalid parameter')
        result = await llm_chat(mock_bot, mock_event, prompt='你好')
        assert result['response'] == ''
        assert 'invalid parameter' in result['error']
        assert result['attempts'] == 1
        assert result['retryable'] is False
        assert mock_custom_llm.await_count == 1

    @pytest.mark.asyncio
    async def test_retryable_error_retries_and_exhausts(self, mock_bot, mock_event, mock_custom_llm):
        """可重试错误持续抛出，重试 max_retries 次后返回错误。"""
        mock_custom_llm.side_effect = ConnectionError('connection timeout')
        result = await llm_chat(
            mock_bot, mock_event, prompt='你好',
            max_retries=2, retry_base_delay=0,
        )
        assert result['response'] == ''
        assert 'connection timeout' in result['error']
        assert result['attempts'] == 3  # 1 次初始 + 2 次重试
        assert result['retryable'] is True
        assert mock_custom_llm.await_count == 3

    @pytest.mark.asyncio
    async def test_retry_succeeds_on_second_attempt(self, mock_bot, mock_event, mock_custom_llm):
        """第一次失败（可重试），第二次成功。"""
        mock_custom_llm.side_effect = [
            ConnectionError('timeout'),
            '恢复成功',
        ]
        result = await llm_chat(
            mock_bot, mock_event, prompt='你好',
            max_retries=2, retry_base_delay=0,
        )
        assert result['response'] == '恢复成功'
        assert result['error'] == ''
        assert result['attempts'] == 2
        assert mock_custom_llm.await_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_success(self, mock_bot, mock_event, mock_custom_llm):
        """成功时 attempts=1，不重试。"""
        mock_custom_llm.return_value = 'ok'
        result = await llm_chat(mock_bot, mock_event, prompt='你好', max_retries=3)
        assert result['attempts'] == 1
        assert mock_custom_llm.await_count == 1

    @pytest.mark.asyncio
    async def test_max_retries_zero(self, mock_bot, mock_event, mock_custom_llm):
        """max_retries=0 时不重试，可重试错误也立即返回。"""
        mock_custom_llm.side_effect = ConnectionError('timeout')
        result = await llm_chat(
            mock_bot, mock_event, prompt='你好',
            max_retries=0,
        )
        assert result['attempts'] == 1
        assert result['retryable'] is True
        assert mock_custom_llm.await_count == 1

    @pytest.mark.asyncio
    async def test_exponential_backoff_delay_applied(
        self, mock_bot, mock_event, mock_custom_llm, monkeypatch,
    ):
        """指数退避延迟：0.5s → 1.0s（base=0.5, 2 次重试）。"""
        mock_custom_llm.side_effect = ConnectionError('timeout')

        sleep_calls: list[float] = []
        async def fake_sleep(delay: float) -> None:
            sleep_calls.append(delay)

        # patch asyncio.sleep 必须在 llm_chat 模块内生效
        import qqbat_nodes.builtin.llm_chat as llm_module
        monkeypatch.setattr(llm_module.asyncio, 'sleep', fake_sleep)

        await llm_chat(
            mock_bot, mock_event, prompt='你好',
            max_retries=2, retry_base_delay=0.5,
        )

        # 两次重试的延迟：0.5 * 2^0 = 0.5, 0.5 * 2^1 = 1.0
        assert sleep_calls == [0.5, 1.0]
        assert mock_custom_llm.await_count == 3

    @pytest.mark.asyncio
    async def test_retryable_keywords_detection(self, mock_bot, mock_event, mock_custom_llm):
        """覆盖各类可重试关键字检测。"""
        from qqbat_nodes.builtin.llm_chat import _is_retryable_error

        # 可重试
        assert _is_retryable_error(ConnectionError('connection refused')) is True
        assert _is_retryable_error(TimeoutError('operation timed out')) is True
        assert _is_retryable_error(Exception('HTTP 503 service unavailable')) is True
        assert _is_retryable_error(Exception('rate limit exceeded')) is True
        assert _is_retryable_error(Exception('429 too many requests')) is True

        # 不可重试
        assert _is_retryable_error(ValueError('invalid parameter')) is False
        assert _is_retryable_error(KeyError('api_key')) is False
        assert _is_retryable_error(Exception('content policy violation')) is False
