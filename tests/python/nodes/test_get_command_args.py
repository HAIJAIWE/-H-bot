"""get_command_args 节点单元测试。

被测源码：qqbat_nodes/builtin/get_command_args.py

覆盖：
- 单参数 / 多参数 / 引号参数（shlex）解析
- index 正向取指定位置参数
- index 超出范围返回空字符串
- 无参数场景（仅指令本身）
- get_plaintext / get_message 两种文本获取方式
- event 无 get_plaintext 时回退到 get_message
- 异常容错（get_plaintext 抛异常）
- 返回结构完整性

返回 dict 结构：
- 成功: {"result": 指定位置参数, "args_list": 全部参数列表, "error": ""}
- 异常: {"result": '', "args_list": [], "error": str(e)}
"""
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.builtin.get_command_args import get_command_args


# =============================================================================
# 辅助构造函数
# =============================================================================
def make_event_with_plaintext(text):
    """构造一个有 get_plaintext 方法的事件。"""
    ev = MagicMock()
    ev.get_plaintext = MagicMock(return_value=text)
    return ev


def make_event_with_get_message(text):
    """构造一个无 get_plaintext 但有 get_message 的事件。"""
    ev = MagicMock()
    del ev.get_plaintext
    ev.get_message = MagicMock(return_value=text)
    return ev


# =============================================================================
# 参数解析
# =============================================================================
class TestArgumentParsing:
    """验证指令参数解析逻辑。"""

    @pytest.mark.asyncio
    async def test_single_arg(self, mock_bot, mock_event):
        """'/sign' 单参数：args_list=['arg1']，index=0 返回 'arg1'。"""
        ev = make_event_with_plaintext('/sign arg1')
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == 'arg1'
        assert result['args_list'] == ['arg1']
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_multiple_args(self, mock_bot, mock_event):
        """多个参数：args_list 完整保留。"""
        ev = make_event_with_plaintext('/sign foo bar baz')
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == 'foo'  # 默认 index=0
        assert result['args_list'] == ['foo', 'bar', 'baz']

    @pytest.mark.asyncio
    async def test_quoted_args_split_by_whitespace(self):
        """引号参数按空格分割（源码用 .split()，不解析引号）。

        '/sign "multi word" arg2' → ['"multi', 'word"', 'arg2']
        """
        ev = make_event_with_plaintext('/sign "multi word" arg2')
        result = await get_command_args(None, ev)
        # 源码用 .split()，引号不特殊处理
        assert result['args_list'] == ['"multi', 'word"', 'arg2']

    @pytest.mark.asyncio
    async def test_no_args_returns_empty(self, mock_bot, mock_event):
        """仅指令本身无参数：args_list=[]，result=''。"""
        ev = make_event_with_plaintext('/sign')
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == ''
        assert result['args_list'] == []

    @pytest.mark.asyncio
    async def test_empty_message_returns_empty(self, mock_bot, mock_event):
        """空消息：args_list=[]，result=''。"""
        ev = make_event_with_plaintext('')
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == ''
        assert result['args_list'] == []


# =============================================================================
# index 参数
# =============================================================================
class TestIndex:
    """验证 index 参数取指定位置参数。"""

    @pytest.mark.asyncio
    async def test_index_zero_returns_first_arg(self, mock_bot, mock_event):
        """index=0 取第一个参数。"""
        ev = make_event_with_plaintext('/cmd a b c')
        result = await get_command_args(mock_bot, ev, index=0)
        assert result['result'] == 'a'

    @pytest.mark.asyncio
    async def test_index_one_returns_second_arg(self, mock_bot, mock_event):
        """index=1 取第二个参数。"""
        ev = make_event_with_plaintext('/cmd a b c')
        result = await get_command_args(mock_bot, ev, index=1)
        assert result['result'] == 'b'

    @pytest.mark.asyncio
    async def test_index_two_returns_third_arg(self, mock_bot, mock_event):
        """index=2 取第三个参数。"""
        ev = make_event_with_plaintext('/cmd a b c')
        result = await get_command_args(mock_bot, ev, index=2)
        assert result['result'] == 'c'

    @pytest.mark.asyncio
    async def test_index_out_of_range_returns_empty(self, mock_bot, mock_event):
        """index 超出范围 → 返回空字符串。"""
        ev = make_event_with_plaintext('/cmd a b')
        result = await get_command_args(mock_bot, ev, index=99)
        assert result['result'] == ''


# =============================================================================
# 文本获取方式
# =============================================================================
class TestTextRetrieval:
    """验证从 event 获取消息文本的方式。"""

    @pytest.mark.asyncio
    async def test_uses_get_plaintext_when_available(self, mock_bot, mock_event):
        """event 有 get_plaintext 时优先调用。"""
        ev = make_event_with_plaintext('/cmd arg')
        await get_command_args(mock_bot, ev)
        ev.get_plaintext.assert_called_once()

    @pytest.mark.asyncio
    async def test_falls_back_to_get_message(self, mock_bot, mock_event):
        """event 无 get_plaintext 时回退到 str(get_message())。"""
        ev = make_event_with_get_message('/cmd arg')
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == 'arg'
        ev.get_message.assert_called_once()


# =============================================================================
# 异常容错
# =============================================================================
class TestExceptionHandling:
    """验证异常容错行为。"""

    @pytest.mark.asyncio
    async def test_get_plaintext_raises_returns_error(self, mock_bot, mock_event):
        """get_plaintext 抛异常 → 返回 error 信息，不向上抛。"""
        ev = MagicMock()
        ev.get_plaintext = MagicMock(side_effect=RuntimeError('boom'))
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == ''
        assert result['args_list'] == []
        assert 'boom' in result['error']

    @pytest.mark.asyncio
    async def test_get_message_raises_returns_error(self, mock_bot, mock_event):
        """无 get_plaintext 且 get_message 抛异常 → 返回 error。"""
        ev = MagicMock()
        del ev.get_plaintext
        ev.get_message = MagicMock(side_effect=RuntimeError('msg err'))
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == ''
        assert 'msg err' in result['error']


# =============================================================================
# 默认参数与返回结构
# =============================================================================
class TestDefaultsAndStructure:
    """验证默认参数与返回结构完整性。"""

    @pytest.mark.asyncio
    async def test_default_index_is_zero(self, mock_bot, mock_event):
        """不传 index 时默认为 0。"""
        ev = make_event_with_plaintext('/cmd first second')
        result = await get_command_args(mock_bot, ev)
        assert result['result'] == 'first'

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 result/args_list/error 三个字段。"""
        ev = make_event_with_plaintext('/cmd arg')
        result = await get_command_args(mock_bot, ev)
        assert set(result.keys()) == {'result', 'args_list', 'error'}

    @pytest.mark.asyncio
    async def test_args_list_is_list_type(self, mock_bot, mock_event):
        """args_list 字段为 list 类型。"""
        ev = make_event_with_plaintext('/cmd a b')
        result = await get_command_args(mock_bot, ev)
        assert isinstance(result['args_list'], list)

    @pytest.mark.asyncio
    async def test_result_is_string_type(self, mock_bot, mock_event):
        """result 字段为 str 类型。"""
        ev = make_event_with_plaintext('/cmd arg')
        result = await get_command_args(mock_bot, ev)
        assert isinstance(result['result'], str)

    @pytest.mark.asyncio
    async def test_strips_leading_whitespace(self, mock_bot, mock_event):
        """消息前后空白被 strip。"""
        ev = make_event_with_plaintext('  /cmd   arg1   arg2  ')
        result = await get_command_args(mock_bot, ev)
        assert result['args_list'] == ['arg1', 'arg2']
        assert result['result'] == 'arg1'
