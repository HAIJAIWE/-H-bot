"""intent_classify 节点单元测试 — LLM 意图分类。

被测源码：qqbat_nodes/builtin/intent_classify.py
- 前置校验（user_message 为空 / 意图列表为空或非法）
- _parse_intents: JSON 字符串/列表解析
- _build_user_prompt: 提示词构造
- _parse_llm_response: markdown 清理 / JSON 解析 / intent 校验与模糊匹配
- handler 主流程：调用 custom_llm（mock sys.modules 注入假 plugins 模块），重试与错误返回

测试覆盖：
- 前置校验（空消息/空意图/非法意图 JSON）
- custom_llm 未实现（plugins.custom 不存在）→ 返回错误
- 正常分类（mock custom_llm 返回合法 JSON）
- LLM 返回 markdown 包裹的 JSON
- 重试：瞬时异常重试耗尽返回错误
- 非瞬时异常直接返回
"""
import json
import sys
import types
from unittest.mock import patch

import pytest

from qqbat_nodes.builtin.intent_classify import (
    intent_classify,
    _parse_intents,
    _build_user_prompt,
    _parse_llm_response,
)


# ===========================================================================
# _parse_intents 辅助函数
# ===========================================================================

class TestParseIntents:
    """验证意图列表解析。"""

    def test_parses_list(self):
        """直接传入列表。"""
        result = _parse_intents([{'label': '闲聊', 'desc': '日常对话'}])
        assert result == [{'label': '闲聊', 'desc': '日常对话'}]

    def test_parses_json_string(self):
        """JSON 字符串被解析。"""
        result = _parse_intents('[{"label": "查天气", "desc": ""}]')
        assert result == [{'label': '查天气', 'desc': ''}]

    def test_parses_invalid_json_raises(self):
        """非法 JSON 抛 ValueError。"""
        with pytest.raises(ValueError):
            _parse_intents('not json')

    def test_empty_returns_empty_list(self):
        """空值返回空列表。"""
        assert _parse_intents(None) == []
        assert _parse_intents('') == []

    def test_filters_invalid_items(self):
        """跳过非 dict / 无 label 项，label 去空白。"""
        result = _parse_intents([
            {'label': ' 查天气 ', 'desc': 'x'},
            {'desc': '无标签'},
            'not-a-dict',
            42,
        ])
        assert result == [{'label': '查天气', 'desc': 'x'}]


# ===========================================================================
# _build_user_prompt 辅助函数
# ===========================================================================

class TestBuildUserPrompt:
    """验证提示词构造。"""

    def test_contains_message_and_intents(self):
        """提示词包含用户消息与意图列表。"""
        prompt = _build_user_prompt('今天天气如何', [
            {'label': '查天气', 'desc': '查询天气'},
            {'label': '闲聊', 'desc': ''},
        ])
        assert '今天天气如何' in prompt
        assert '1. 查天气（查询天气）' in prompt
        assert '2. 闲聊' in prompt


# ===========================================================================
# _parse_llm_response 辅助函数
# ===========================================================================

class TestParseLlmResponse:
    """验证 LLM 返回解析。"""

    def test_parses_plain_json(self):
        """普通 JSON 直接解析。"""
        intents = [{'label': 'a', 'desc': ''}]
        result = _parse_llm_response(
            '{"intent": "a", "confidence": 0.9, "scores": [{"label": "a", "score": 0.9}]}',
            intents,
        )
        assert result['intent'] == 'a'
        assert result['confidence'] == 0.9

    def test_strips_markdown_codeblock(self):
        """markdown 代码块包裹的 JSON 被清理。"""
        intents = [{'label': 'a', 'desc': ''}]
        text = '```json\n{"intent": "a", "confidence": 0.8, "scores": []}\n```'
        result = _parse_llm_response(text, intents)
        assert result['intent'] == 'a'
        assert result['confidence'] == 0.8

    def test_invalid_json_raises(self):
        """非法 JSON 抛 ValueError。"""
        with pytest.raises(ValueError):
            _parse_llm_response('not json', [])

    def test_confidence_clamped(self):
        """confidence 被钳制到 0-1。"""
        intents = [{'label': 'a', 'desc': ''}]
        high = _parse_llm_response('{"intent": "a", "confidence": 5.0, "scores": []}', intents)
        low = _parse_llm_response('{"intent": "a", "confidence": -2.0, "scores": []}', intents)
        assert high['confidence'] == 1.0
        assert low['confidence'] == 0.0

    def test_intent_fuzzy_match(self):
        """intent 大小写/空格模糊匹配到列表标签。"""
        intents = [{'label': '查天气', 'desc': ''}]
        result = _parse_llm_response(
            '{"intent": "查 天气", "confidence": 0.7, "scores": [{"label": "查天气", "score": 0.7}]}',
            intents,
        )
        assert result['intent'] == '查天气'

    def test_intent_falls_back_to_highest_score(self):
        """intent 不匹配时回退到分数最高的意图。"""
        intents = [{'label': 'a', 'desc': ''}, {'label': 'b', 'desc': ''}]
        result = _parse_llm_response(
            '{"intent": "zzz", "confidence": 0.5, "scores": [{"label": "a", "score": 0.2}, {"label": "b", "score": 0.8}]}',
            intents,
        )
        assert result['intent'] == 'b'


# ===========================================================================
# 前置校验
# ===========================================================================

class TestPreValidation:
    """验证 handler 的前置校验。"""

    @pytest.mark.asyncio
    async def test_empty_user_message_rejected(self, mock_bot, mock_event):
        """user_message 为空时前置拒绝。"""
        result = await intent_classify(mock_bot, mock_event, user_message='')
        assert result['error']
        assert result['intent'] == ''

    @pytest.mark.asyncio
    async def test_invalid_intents_json_rejected(self, mock_bot, mock_event):
        """意图列表不是合法 JSON 时返回错误。"""
        result = await intent_classify(
            mock_bot, mock_event, user_message='hello', intents='not-json',
        )
        assert '不是合法 JSON' in result['error']

    @pytest.mark.asyncio
    async def test_empty_intents_rejected(self, mock_bot, mock_event):
        """意图列表为空时返回错误。"""
        result = await intent_classify(
            mock_bot, mock_event, user_message='hello', intents='[]',
        )
        assert '不能为空' in result['error']


# ===========================================================================
# 主流程（mock custom_llm）
# ===========================================================================

class TestMainFlow:
    """验证 handler 主流程。"""

    @pytest.fixture(autouse=True)
    def patch_custom_llm(self, monkeypatch):
        """向 sys.modules 注入假 plugins.custom 模块，mock llm_chat。

        intent_classify 内部执行 ``from plugins.custom import llm_chat``
        延迟导入；测试环境不存在 plugins 包，需构造假模块注入。
        """
        fake_plugin = types.ModuleType('plugins')
        fake_custom = types.ModuleType('plugins.custom')

        async def _fake_llm(prompt='', system_prompt='', temperature=0.3, history=None):
            return '{"intent": "查天气", "confidence": 0.9, "scores": [{"label": "查天气", "score": 0.9}]}'

        fake_custom.llm_chat = _fake_llm
        monkeypatch.setitem(sys.modules, 'plugins', fake_plugin)
        monkeypatch.setitem(sys.modules, 'plugins.custom', fake_custom)
        yield

    @pytest.mark.asyncio
    async def test_success(self, mock_bot, mock_event):
        """正常分类成功。"""
        result = await intent_classify(
            mock_bot, mock_event,
            user_message='今天天气如何',
            intents='[{"label": "查天气", "desc": "查询天气"}]',
        )
        assert result['error'] == ''
        assert result['intent'] == '查天气'
        assert result['confidence'] == 0.9

    @pytest.mark.asyncio
    async def test_custom_llm_missing(self, monkeypatch, mock_bot, mock_event):
        """plugins.custom 不存在时返回 custom_llm 未实现错误。"""
        # 移除 plugins.custom，仅保留 plugins 包 → 延迟导入抛 ModuleNotFoundError
        fake_plugin = types.ModuleType('plugins')
        monkeypatch.setitem(sys.modules, 'plugins', fake_plugin)
        monkeypatch.delitem(sys.modules, 'plugins.custom', raising=False)
        result = await intent_classify(
            mock_bot, mock_event, user_message='hi', intents='[{"label": "a"}]',
        )
        assert 'custom_llm 未实现' in result['error']

    @pytest.mark.asyncio
    async def test_transient_error_retries_then_fails(self, monkeypatch, mock_bot, mock_event):
        """瞬时异常重试耗尽后返回错误。"""
        async def _always_fail(prompt='', system_prompt='', temperature=0.3, history=None):
            raise TimeoutError('timeout')
        monkeypatch.setattr(sys.modules['plugins.custom'], 'llm_chat', _always_fail)
        result = await intent_classify(
            mock_bot, mock_event,
            user_message='hi', intents='[{"label": "a"}]',
        )
        assert '重试' in result['error']
        assert 'TimeoutError' in result['error']

    @pytest.mark.asyncio
    async def test_non_transient_error_returns_immediately(self, monkeypatch, mock_bot, mock_event):
        """非瞬时异常不重试，立即返回。"""
        async def _boom(prompt='', system_prompt='', temperature=0.3, history=None):
            raise RuntimeError('boom')
        monkeypatch.setattr(sys.modules['plugins.custom'], 'llm_chat', _boom)
        result = await intent_classify(
            mock_bot, mock_event,
            user_message='hi', intents='[{"label": "a"}]',
        )
        assert 'boom' in result['error']
