"""increment_persistent 节点单元测试。

覆盖：
- _incr_value 原子路径（默认）：自增、自减、默认值、整数保持
- 三步组合回退路径（_incr_value 不可用 / 报错时）：load+eval+save
- key 校验、scope 隔离、异常捕获

被测源码：qqbat_nodes/builtin/increment_persistent.py
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.increment_persistent import increment_persistent


# ---------------------------------------------------------------------------
# key 校验
# ---------------------------------------------------------------------------
class TestKeyValidation:
    """验证 key 为空时的快速失败。"""

    @pytest.mark.asyncio
    async def test_empty_key_returns_default(self, mock_bot, mock_event):
        """key 为空：直接返回 default，不调用任何持久化操作。"""
        result = await increment_persistent(
            mock_bot, mock_event, key='', amount=5, default=10,
        )
        assert result['result'] == 10
        assert result['old_value'] == 10
        assert result['error'] == 'key 为空'


# =============================================================================
# _incr_value 原子路径（默认）
# =============================================================================
class TestIncrValuePath:
    """验证优先调用 persistent_store._incr_value 的原子自增路径。"""

    @pytest.mark.asyncio
    async def test_incr_uses_atomic_path(self, mock_bot, mock_event):
        """默认走 _incr_value 原子路径，返回其结果。"""
        incr_mock = AsyncMock(return_value={
            "result": 11, "old_value": 10, "error": "",
        })
        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='sign_days', amount=1, default=0,
            )
        assert result['result'] == 11
        assert result['old_value'] == 10
        assert result['error'] == ''
        incr_mock.assert_awaited_once()
        # 验证透传参数
        call_kwargs = incr_mock.call_args.kwargs
        assert call_kwargs['key'] == 'sign_days'
        assert call_kwargs['amount'] == 1
        assert call_kwargs['default'] == 0
        assert call_kwargs['scope'] == 'user'

    @pytest.mark.asyncio
    async def test_incr_negative_amount_for_decrement(self, mock_bot, mock_event):
        """amount 为负数实现减法。"""
        incr_mock = AsyncMock(return_value={
            "result": 5, "old_value": 10, "error": "",
        })
        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='hp', amount=-5, default=10,
            )
        assert result['result'] == 5
        call_kwargs = incr_mock.call_args.kwargs
        assert call_kwargs['amount'] == -5

    @pytest.mark.asyncio
    async def test_incr_scope_passed_through(self, mock_bot, mock_event):
        """scope 参数正确透传给 _incr_value。"""
        incr_mock = AsyncMock(return_value={
            "result": 1, "old_value": 0, "error": "",
        })
        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock):
            await increment_persistent(
                mock_bot, mock_event, key='k', amount=1, scope='group',
            )
        assert incr_mock.call_args.kwargs['scope'] == 'group'


# =============================================================================
# 三步组合回退路径
# =============================================================================
class TestFallbackThreeStepPath:
    """验证 _incr_value 报错或不可用时回退到 load+eval+save 三步组合。"""

    @pytest.mark.asyncio
    async def test_fallback_when_incr_returns_error(self, mock_bot, mock_event):
        """_incr_value 返回 error 时回退到三步组合。"""
        incr_mock = AsyncMock(return_value={
            "result": 0, "old_value": 0, "error": "_incr_value 不可用",
        })
        load_mock = AsyncMock(return_value={"result": 10, "error": ""})
        eval_mock = AsyncMock(return_value={"result": 15, "error": ""})
        save_mock = AsyncMock(return_value={"success": True, "value_out": None, "error": ""})

        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock), \
             patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=eval_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='cnt', amount=5, default=0,
            )
        assert result['result'] == 15
        assert result['old_value'] == 10
        assert result['error'] == ''
        load_mock.assert_awaited_once()
        eval_mock.assert_awaited_once()
        save_mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_fallback_when_incr_raises_exception(self, mock_bot, mock_event):
        """_incr_value 抛异常时回退到三步组合。"""
        incr_mock = AsyncMock(side_effect=RuntimeError("atomic not available"))
        load_mock = AsyncMock(return_value={"result": None, "error": ""})  # 不存在
        eval_mock = AsyncMock(return_value={"result": 5, "error": ""})
        save_mock = AsyncMock(return_value={"success": True, "value_out": None, "error": ""})

        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock), \
             patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=eval_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='cnt', amount=5, default=0,
            )
        # load 返回 None → old_value=default=0
        assert result['old_value'] == 0
        assert result['result'] == 5

    @pytest.mark.asyncio
    async def test_fallback_when_incr_attribute_missing(self, mock_bot, mock_event):
        """persistent_store 无 _incr_value 属性时回退到三步组合。

        通过 patch.hasattr 让 hasattr 返回 False。
        """
        load_mock = AsyncMock(return_value={"result": 20, "error": ""})
        eval_mock = AsyncMock(return_value={"result": 25, "error": ""})
        save_mock = AsyncMock(return_value={"success": True, "value_out": None, "error": ""})

        # 移除 _incr_value 属性，使 hasattr 返回 False
        with patch('qqbat_nodes.builtin.persistent_store') as ps_mock:
            ps_mock._incr_value = None  # hasattr 仍为 True，但调用会失败
            # 改用直接删除属性的方式：通过配置 side_effect
            ps_mock.configure_mock(**{
                '_incr_value': None,
            })
            # 由于 hasattr(None) 为 True（属性存在但值为 None），
            # 这里用另一种方式：让 _incr_value 调用抛 AttributeError
            async def _raise_attr_error(**kwargs):
                raise AttributeError("not callable")
            ps_mock._incr_value = _raise_attr_error

            with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                       new=load_mock), \
                 patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                       new=eval_mock), \
                 patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                       new=save_mock):
                result = await increment_persistent(
                    mock_bot, mock_event, key='cnt', amount=5, default=0,
                )
        assert result['result'] == 25
        assert result['old_value'] == 20

    @pytest.mark.asyncio
    async def test_fallback_eval_failure_uses_direct_addition(self, mock_bot, mock_event):
        """回退路径中 expression_eval 失败时，用直接加法 old_value + amount。"""
        incr_mock = AsyncMock(return_value={
            "result": 0, "old_value": 0, "error": "fail",
        })
        load_mock = AsyncMock(return_value={"result": 10, "error": ""})
        eval_mock = AsyncMock(return_value={"result": None, "error": "eval fail"})
        save_mock = AsyncMock(return_value={"success": True, "value_out": None, "error": ""})

        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock), \
             patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=eval_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='cnt', amount=5, default=0,
            )
        # eval 返回 None → 回退 old_value + amount = 10 + 5 = 15
        assert result['result'] == 15

    @pytest.mark.asyncio
    async def test_fallback_save_failure_returns_error(self, mock_bot, mock_event):
        """回退路径中 save_persistent 失败：返回 result=new_val, error='保存失败'。"""
        incr_mock = AsyncMock(return_value={
            "result": 0, "old_value": 0, "error": "fail",
        })
        load_mock = AsyncMock(return_value={"result": 10, "error": ""})
        eval_mock = AsyncMock(return_value={"result": 15, "error": ""})
        save_mock = AsyncMock(return_value={"success": False, "value_out": None, "error": "DB"})

        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock), \
             patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=eval_mock), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=save_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='cnt', amount=5, default=0,
            )
        assert result['result'] == 15
        assert result['old_value'] == 10
        assert result['error'] == '保存失败'


# =============================================================================
# 异常捕获
# =============================================================================
class TestExceptionHandling:
    """验证顶层 try-except 捕获异常时返回 default。"""

    @pytest.mark.asyncio
    async def test_load_persistent_raises_returns_default(self, mock_bot, mock_event):
        """load_persistent 抛异常时回退到 default，不向上抛。"""
        incr_mock = AsyncMock(return_value={
            "result": 0, "old_value": 0, "error": "fail",
        })
        load_mock = AsyncMock(side_effect=RuntimeError("DB connection lost"))

        with patch('qqbat_nodes.builtin.persistent_store._incr_value',
                   new=incr_mock), \
             patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=load_mock):
            result = await increment_persistent(
                mock_bot, mock_event, key='cnt', amount=5, default=42,
            )
        assert result['result'] == 42
        assert result['old_value'] == 42
        assert 'DB connection lost' in result['error']
