"""forward 节点单元测试。

被测源码：qqbat_nodes/builtin/forward.py

覆盖：
- cq=True 返回 CQ 码字符串 '[CQ:forward,id=xxx]'
- cq=False 返回 dict {'type': 'forward', 'data': {'id': 'xxx'}}
- id 为空时 cq=True 返回空串，cq=False 返回 None
- 默认参数（cq=False）
- 自定义 id
- 返回结构完整性
- CQ 码格式正确性

返回 dict 结构：
- {"result": str_or_dict, "error": ""}
"""
import pytest

from qqbat_nodes.builtin.forward import forward


# =============================================================================
# cq=False（默认）返回 dict
# =============================================================================
class TestCqFalse:
    """验证 cq=False 时返回 dict 形式的 forward 消息段。"""

    @pytest.mark.asyncio
    async def test_returns_dict_with_id(self, mock_bot, mock_event):
        """cq=False + id 非空 → 返回 dict {'type':'forward','data':{'id':...}}。"""
        result = await forward(mock_bot, mock_event, id='res123', cq=False)
        assert result['result'] == {'type': 'forward', 'data': {'id': 'res123'}}
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_dict_has_correct_type(self, mock_bot, mock_event):
        """返回的 dict 中 type 字段为 'forward'。"""
        result = await forward(mock_bot, mock_event, id='abc', cq=False)
        assert result['result']['type'] == 'forward'

    @pytest.mark.asyncio
    async def test_dict_has_correct_data(self, mock_bot, mock_event):
        """返回的 dict 中 data 字段含 id。"""
        result = await forward(mock_bot, mock_event, id='xyz', cq=False)
        assert result['result']['data'] == {'id': 'xyz'}

    @pytest.mark.asyncio
    async def test_empty_id_returns_none(self, mock_bot, mock_event):
        """cq=False + id 为空 → 返回 None（避免生成无效段）。"""
        result = await forward(mock_bot, mock_event, id='', cq=False)
        assert result['result'] is None
        assert result['error'] == ''


# =============================================================================
# cq=True 返回 CQ 码字符串
# =============================================================================
class TestCqTrue:
    """验证 cq=True 时返回 CQ 码字符串。"""

    @pytest.mark.asyncio
    async def test_returns_cq_string_with_id(self, mock_bot, mock_event):
        """cq=True + id 非空 → 返回 '[CQ:forward,id=xxx]'。"""
        result = await forward(mock_bot, mock_event, id='res123', cq=True)
        assert result['result'] == '[CQ:forward,id=res123]'
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_cq_string_format(self, mock_bot, mock_event):
        """CQ 码格式为 '[CQ:forward,id={id}]'。"""
        result = await forward(mock_bot, mock_event, id='test_id', cq=True)
        assert result['result'].startswith('[CQ:forward,id=')
        assert result['result'].endswith(']')
        assert 'test_id' in result['result']

    @pytest.mark.asyncio
    async def test_empty_id_returns_empty_string(self, mock_bot, mock_event):
        """cq=True + id 为空 → 返回空字符串。"""
        result = await forward(mock_bot, mock_event, id='', cq=True)
        assert result['result'] == ''
        assert result['error'] == ''


# =============================================================================
# 默认参数
# =============================================================================
class TestDefaults:
    """验证默认参数行为。"""

    @pytest.mark.asyncio
    async def test_default_cq_is_false(self, mock_bot, mock_event):
        """不传 cq 时默认为 False → 返回 dict。"""
        result = await forward(mock_bot, mock_event, id='abc')
        assert isinstance(result['result'], dict)

    @pytest.mark.asyncio
    async def test_default_id_is_empty(self, mock_bot, mock_event):
        """不传 id 时默认为空字符串 → cq=False 返回 None。"""
        result = await forward(mock_bot, mock_event)
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_default_id_empty_cq_true_returns_empty(self, mock_bot, mock_event):
        """不传 id + cq=True → 返回空字符串。"""
        result = await forward(mock_bot, mock_event, cq=True)
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_no_args_uses_defaults(self):
        """完全不传参数：bot/event/id/cq 全用默认值。"""
        result = await forward()
        assert result['result'] is None
        assert result['error'] == ''


# =============================================================================
# id 处理
# =============================================================================
class TestIdHandling:
    """验证 id 参数的处理逻辑。"""

    @pytest.mark.asyncio
    async def test_id_none_treated_as_empty(self, mock_bot, mock_event):
        """id=None → 视为空字符串。"""
        result = await forward(mock_bot, mock_event, id=None, cq=False)
        assert result['result'] is None

    @pytest.mark.asyncio
    async def test_id_none_cq_true_returns_empty(self, mock_bot, mock_event):
        """id=None + cq=True → 返回空字符串。"""
        result = await forward(mock_bot, mock_event, id=None, cq=True)
        assert result['result'] == ''

    @pytest.mark.asyncio
    async def test_id_with_special_chars(self, mock_bot, mock_event):
        """id 含特殊字符（如数字+字母混合）。"""
        result = await forward(mock_bot, mock_event, id='abc-123_def', cq=True)
        assert result['result'] == '[CQ:forward,id=abc-123_def]'

    @pytest.mark.asyncio
    async def test_id_numeric_string(self, mock_bot, mock_event):
        """id 为纯数字字符串。"""
        result = await forward(mock_bot, mock_event, id='99999', cq=True)
        assert result['result'] == '[CQ:forward,id=99999]'


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_result_and_error(self, mock_bot, mock_event):
        """返回 dict 必含 result 和 error 两个字段。"""
        result = await forward(mock_bot, mock_event, id='x', cq=False)
        assert set(result.keys()) == {'result', 'error'}

    @pytest.mark.asyncio
    async def test_error_always_empty(self, mock_bot, mock_event):
        """error 字段始终为空字符串（forward 不抛异常）。"""
        # 各种参数组合下 error 都应为空
        for cq in (True, False):
            for id_val in ('', 'x', None):
                result = await forward(mock_bot, mock_event, id=id_val, cq=cq)
                assert result['error'] == '', f'cq={cq}, id={id_val} 时 error 应为空'


# =============================================================================
# bot/event 可选性
# =============================================================================
class TestBotEventOptional:
    """验证 bot 和 event 参数可选（forward 不依赖它们）。"""

    @pytest.mark.asyncio
    async def test_bot_none_works(self, mock_event):
        """bot=None 也能正常工作。"""
        result = await forward(None, mock_event, id='x', cq=True)
        assert result['result'] == '[CQ:forward,id=x]'

    @pytest.mark.asyncio
    async def test_event_none_works(self, mock_bot):
        """event=None 也能正常工作。"""
        result = await forward(mock_bot, None, id='x', cq=True)
        assert result['result'] == '[CQ:forward,id=x]'

    @pytest.mark.asyncio
    async def test_both_none_works(self):
        """bot=event=None 也能正常工作。"""
        result = await forward(None, None, id='x', cq=True)
        assert result['result'] == '[CQ:forward,id=x]'
