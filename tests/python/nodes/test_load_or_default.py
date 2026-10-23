"""load_or_default 节点单元测试。

覆盖：
- 已存在值：直接返回，is_default=False，不调用 save
- 不存在值：返回 default，is_default=True，auto_save=True 时调用 save
- auto_save=False：不写回
- key 为空、异常捕获

被测源码：qqbat_nodes/builtin/load_or_default.py
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.load_or_default import load_or_default


# =============================================================================
# key 校验
# =============================================================================
class TestKeyValidation:
    """key 为空时快速失败。"""

    @pytest.mark.asyncio
    async def test_empty_key_returns_default(self, mock_bot, mock_event):
        """key 为空：返回 default，is_default=True，不调用 load/save。"""
        result = await load_or_default(
            mock_bot, mock_event, key='', default=99,
        )
        assert result['result'] == 99
        assert result['is_default'] is True
        assert result['error'] == 'key 为空'


# =============================================================================
# 已存在值
# =============================================================================
class TestExistingValue:
    """验证读取到已存在值时的行为。"""

    @pytest.mark.asyncio
    async def test_existing_value_returned(self, mock_bot, mock_event):
        """已存在值：返回该值，is_default=False。"""
        load_mock = AsyncMock(return_value={"result": 100, "error": ""})
        save_mock = AsyncMock()
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='rpg_level', default=0,
            )
        assert result['result'] == 100
        assert result['is_default'] is False
        assert result['error'] == ''
        # 已存在值不应触发 save
        save_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_existing_value_string_type(self, mock_bot, mock_event):
        """已存在字符串值：原样返回（不强制类型转换）。"""
        load_mock = AsyncMock(return_value={"result": "hello", "error": ""})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='name', default='',
            )
        assert result['result'] == 'hello'
        assert result['is_default'] is False

    @pytest.mark.asyncio
    async def test_existing_value_zero_treated_as_existing(self, mock_bot, mock_event):
        """已存在值为 0：不是 None，is_default=False（边界值）。"""
        load_mock = AsyncMock(return_value={"result": 0, "error": ""})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='cnt', default=99,
            )
        assert result['result'] == 0
        assert result['is_default'] is False


# =============================================================================
# 不存在值 → 使用 default
# =============================================================================
class TestDefaultValue:
    """验证读取到 None（不存在）时返回 default 并 auto_save。"""

    @pytest.mark.asyncio
    async def test_none_value_returns_default_and_saves(self, mock_bot, mock_event):
        """值为 None：返回 default，is_default=True，auto_save 触发 save。"""
        load_mock = AsyncMock(return_value={"result": None, "error": ""})
        save_mock = AsyncMock(return_value={"success": True, "value_out": None, "error": ""})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='rpg_level', default=1,
            )
        assert result['result'] == 1
        assert result['is_default'] is True
        assert result['error'] == ''
        # auto_save=True 默认开启 → 调用 save_persistent 写入 default
        save_mock.assert_awaited_once()
        save_call_kwargs = save_mock.call_args.kwargs
        assert save_call_kwargs['key'] == 'rpg_level'
        assert save_call_kwargs['value'] == 1
        assert save_call_kwargs['scope'] == 'user'

    @pytest.mark.asyncio
    async def test_auto_save_false_skips_save(self, mock_bot, mock_event):
        """auto_save=False：返回 default 但不调用 save。"""
        load_mock = AsyncMock(return_value={"result": None, "error": ""})
        save_mock = AsyncMock()
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='rpg_level', default=5, auto_save=False,
            )
        assert result['result'] == 5
        assert result['is_default'] is True
        save_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_default_complex_object(self, mock_bot, mock_event):
        """default 为复杂对象（dict/list）：原样返回。"""
        default_obj = {"hp": 100, "mp": 50}
        load_mock = AsyncMock(return_value={"result": None, "error": ""})
        save_mock = AsyncMock(return_value={"success": True, "value_out": None, "error": ""})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='stats', default=default_obj,
            )
        assert result['result'] == default_obj
        assert result['is_default'] is True

    @pytest.mark.asyncio
    async def test_scope_passed_to_load(self, mock_bot, mock_event):
        """scope 参数透传给 load_persistent。"""
        load_mock = AsyncMock(return_value={"result": 1, "error": ""})
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            await load_or_default(
                mock_bot, mock_event, key='k', default=0, scope='global',
            )
        assert load_mock.call_args.kwargs['scope'] == 'global'


# =============================================================================
# 异常捕获
# =============================================================================
class TestExceptionHandling:
    """验证顶层异常捕获。"""

    @pytest.mark.asyncio
    async def test_load_raises_returns_default_with_error(self, mock_bot, mock_event):
        """load_persistent 抛异常时返回 default + error 信息，不向上抛。"""
        load_mock = AsyncMock(side_effect=RuntimeError("DB down"))
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='k', default=42,
            )
        assert result['result'] == 42
        assert result['is_default'] is True
        assert 'DB down' in result['error']

    @pytest.mark.asyncio
    async def test_save_failure_does_not_break_return(self, mock_bot, mock_event):
        """save_persistent 抛异常时被捕获，仍返回 default + error。"""
        load_mock = AsyncMock(return_value={"result": None, "error": ""})
        save_mock = AsyncMock(side_effect=RuntimeError("disk full"))
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await load_or_default(
                mock_bot, mock_event, key='k', default=99,
            )
        # save 抛异常被顶层捕获 → 返回 default + error
        assert result['result'] == 99
        assert 'disk full' in result['error']
