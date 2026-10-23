"""wait_input 节点单元测试 — asyncio.Future 等待机制 + notify_reply 唤醒。

被测源码：qqbat_nodes/builtin/wait_input.py
- wait_input: 暂停当前流程，注册 Future 等待用户回复，超时返回 timed_out=True
- notify_reply: 同步函数，收到新消息时唤醒最早注册的等待 Future（FIFO）

测试覆盖：
- notify_reply 基本行为（无等待者/唤醒/多等待者/清理失效 Future）
- wait_input 超时、正常唤醒、返回结构
- 不同 scope（user_id / group_id）隔离
- 并发安全（asyncio.gather 多等待者）
- prompt 发送（成功/失败/空 prompt）
- timeout 规范化（非法值回退默认 60）
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from qqbat_nodes.builtin.wait_input import _waiting, notify_reply, wait_input


# ---------------------------------------------------------------------------
# 辅助函数与 fixture
# ---------------------------------------------------------------------------

def make_event(user_id='123', group_id=''):
    """构造 mock event，显式设置 user_id / group_id。"""
    ev = MagicMock()
    ev.user_id = user_id
    ev.group_id = group_id
    return ev


@pytest.fixture
def clean_waiting():
    """每个测试前后清空全局 _waiting 注册表，避免跨测试串扰。"""
    _waiting.clear()
    yield
    _waiting.clear()


# ===========================================================================
# notify_reply 基本行为
# ===========================================================================

class TestNotifyReplyBasic:
    """验证 notify_reply 的基本返回值与唤醒行为。"""

    def test_no_waiters_returns_false(self, clean_waiting):
        """无等待者时 notify_reply 返回 False。"""
        assert notify_reply('123', 'hello', '') is False

    @pytest.mark.asyncio
    async def test_wakes_waiter_returns_true(self, clean_waiting):
        """有等待者时唤醒并返回 True。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        task = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)  # 等 wait_input 注册 Future

        ok = notify_reply('123', 'reply1', '')
        assert ok is True

        r = await asyncio.wait_for(task, timeout=1)
        assert r['reply'] == 'reply1'
        assert r['timed_out'] is False

    @pytest.mark.asyncio
    async def test_user_id_str_conversion(self, clean_waiting):
        """notify_reply 的 user_id 参数被转为字符串匹配。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        task = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)

        # 传 int 123，应匹配字符串 '123'
        ok = notify_reply(123, 'hi', '')
        assert ok is True

        r = await asyncio.wait_for(task, timeout=1)
        assert r['reply'] == 'hi'


# ===========================================================================
# notify_reply 多等待者（FIFO）
# ===========================================================================

class TestNotifyReplyMultipleWaiters:
    """验证同一 (user_id, group_id) 多个等待者的 FIFO 唤醒。"""

    @pytest.mark.asyncio
    async def test_wakes_first_waiter_only(self, clean_waiting):
        """多个等待者时 notify_reply 唤醒最早注册的一个（FIFO）。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        task1 = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.02)
        task2 = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)

        # 第一次 notify 唤醒 task1
        ok = notify_reply('123', 'first', '')
        assert ok is True

        r1 = await asyncio.wait_for(task1, timeout=1)
        assert r1['reply'] == 'first'
        # task2 仍在等待
        assert not task2.done()

        # 第二次 notify 唤醒 task2
        ok = notify_reply('123', 'second', '')
        assert ok is True
        r2 = await asyncio.wait_for(task2, timeout=1)
        assert r2['reply'] == 'second'

    @pytest.mark.asyncio
    async def test_second_notify_wakes_next(self, clean_waiting):
        """第二次 notify 唤醒第二个等待者。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        t1 = asyncio.create_task(wait_input(bot, event, prompt='', timeout=5))
        t2 = asyncio.create_task(wait_input(bot, event, prompt='', timeout=5))
        await asyncio.sleep(0.05)

        notify_reply('123', 'r1', '')
        notify_reply('123', 'r2', '')

        r1 = await asyncio.wait_for(t1, timeout=1)
        r2 = await asyncio.wait_for(t2, timeout=1)
        assert r1['reply'] == 'r1'
        assert r2['reply'] == 'r2'


# ===========================================================================
# notify_reply 清理失效 Future
# ===========================================================================

class TestNotifyReplyCleanup:
    """验证 notify_reply 清理已 done/cancelled 的失效 Future。"""

    @pytest.mark.asyncio
    async def test_cleans_done_futures(self, clean_waiting):
        """已 done 的 Future 被清理，notify 命中 pending 的那个。"""
        loop = asyncio.get_running_loop()
        done_fut = loop.create_future()
        done_fut.set_result('old')
        pending_fut = loop.create_future()
        _waiting[('123', '')] = [done_fut, pending_fut]

        ok = notify_reply('123', 'newreply', '')

        assert ok is True
        # notify_reply 设置的 result 是字典 {'text':..., 'user_id':...}
        assert pending_fut.result()['text'] == 'newreply'
        # done_fut 已从列表移除
        assert done_fut not in _waiting[('123', '')]

    @pytest.mark.asyncio
    async def test_cleans_cancelled_futures(self, clean_waiting):
        """已 cancelled 的 Future 被清理。"""
        loop = asyncio.get_running_loop()
        cancelled_fut = loop.create_future()
        cancelled_fut.cancel()
        pending_fut = loop.create_future()
        _waiting[('123', '')] = [cancelled_fut, pending_fut]

        ok = notify_reply('123', 'reply', '')

        assert ok is True
        assert pending_fut.result()['text'] == 'reply'
        assert cancelled_fut not in _waiting[('123', '')]

    @pytest.mark.asyncio
    async def test_all_done_returns_false(self, clean_waiting):
        """队列中全部 Future 已 done 时返回 False，并移除空 key。"""
        loop = asyncio.get_running_loop()
        done_fut = loop.create_future()
        done_fut.set_result('old')
        _waiting[('123', '')] = [done_fut]

        ok = notify_reply('123', 'reply', '')

        assert ok is False
        # done Future 被清理后列表空，key 被移除
        assert ('123', '') not in _waiting

    @pytest.mark.asyncio
    async def test_empty_list_returns_false(self, clean_waiting):
        """空 Future 列表返回 False（falsy 直接返回，不进入清理逻辑）。"""
        _waiting[('123', '')] = []

        ok = notify_reply('123', 'reply', '')

        assert ok is False


# ===========================================================================
# wait_input 超时
# ===========================================================================

class TestWaitInputTimeout:
    """验证 wait_input 超时行为。

    用 mock 模拟 asyncio.wait_for 抛 TimeoutError，避免 sandbox 环境 asyncio
    定时器异常导致的长时间等待（sandbox 中 timeout=0.1 实际可能等 ~60s）。
    """

    @pytest.mark.asyncio
    async def test_timeout_returns_timed_out(self, clean_waiting):
        """超时后返回 timed_out=True。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            r = await wait_input(bot, event, prompt='', timeout=0.1)

        assert r['timed_out'] is True
        assert r['reply'] == ''
        assert r['error'] == ''

    @pytest.mark.asyncio
    async def test_timeout_preserves_user_id(self, clean_waiting):
        """超时返回的 user_id 为事件 user_id。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            r = await wait_input(bot, event, prompt='', timeout=0.1)

        assert r['user_id'] == '123'

    @pytest.mark.asyncio
    async def test_cleans_up_after_timeout(self, clean_waiting):
        """超时后 _waiting 中不残留该 Future。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            await wait_input(bot, event, prompt='', timeout=0.1)

        assert ('123', '') not in _waiting or len(_waiting[('123', '')]) == 0

    @pytest.mark.asyncio
    async def test_return_structure_on_timeout(self, clean_waiting):
        """超时返回结构含 reply/user_id/timed_out/is_valid/error 五个键。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            r = await wait_input(bot, event, prompt='', timeout=0.1)

        assert set(r.keys()) == {'reply', 'user_id', 'timed_out', 'is_valid', 'error'}


# ===========================================================================
# wait_input 正常唤醒
# ===========================================================================

class TestWaitInputWake:
    """验证 wait_input 被 notify_reply 唤醒后的返回。"""

    @pytest.mark.asyncio
    async def test_woken_returns_reply(self, clean_waiting):
        """wait_input 等待中被 notify_reply 唤醒，返回 reply。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        async def waiter():
            return await wait_input(bot, event, prompt='', timeout=5)

        async def notifier():
            await asyncio.sleep(0.05)
            return notify_reply('123', 'wakeup', '')

        results = await asyncio.gather(waiter(), notifier())

        assert results[0]['reply'] == 'wakeup'
        assert results[0]['timed_out'] is False

    @pytest.mark.asyncio
    async def test_woken_preserves_user_id(self, clean_waiting):
        """唤醒后 user_id 为 notify_reply 传入的 user_id。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        task = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)
        notify_reply('123', 'reply', '')

        r = await asyncio.wait_for(task, timeout=1)
        assert r['user_id'] == '123'

    @pytest.mark.asyncio
    async def test_cleans_up_after_wake(self, clean_waiting):
        """唤醒后 _waiting 中不残留该 Future。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        task = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)
        notify_reply('123', 'reply', '')
        await asyncio.wait_for(task, timeout=1)

        assert ('123', '') not in _waiting or len(_waiting[('123', '')]) == 0

    @pytest.mark.asyncio
    async def test_return_structure_on_wake(self, clean_waiting):
        """唤醒返回结构含 reply/user_id/timed_out/is_valid/error 五个键。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        task = asyncio.create_task(
            wait_input(bot, event, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)
        notify_reply('123', 'reply', '')
        r = await asyncio.wait_for(task, timeout=1)

        assert set(r.keys()) == {'reply', 'user_id', 'timed_out', 'is_valid', 'error'}
        assert r['timed_out'] is False
        assert r['error'] == ''


# ===========================================================================
# 不同 scope 隔离
# ===========================================================================

class TestScopeIsolation:
    """验证不同 user_id / group_id 的等待互不干扰。"""

    @pytest.mark.asyncio
    async def test_different_user_isolated(self, clean_waiting):
        """user A 的 notify 不影响 user B 的等待。"""
        ev1 = make_event(user_id='123', group_id='')
        ev2 = make_event(user_id='456', group_id='')
        bot = AsyncMock()

        task1 = asyncio.create_task(
            wait_input(bot, ev1, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)

        # user 456 notify 不应影响 user 123
        ok = notify_reply('456', 'hello456', '')
        assert ok is False
        assert not task1.done()

        # user 123 notify 唤醒
        ok = notify_reply('123', 'hello123', '')
        assert ok is True
        r = await asyncio.wait_for(task1, timeout=1)
        assert r['reply'] == 'hello123'

    @pytest.mark.asyncio
    async def test_different_group_isolated(self, clean_waiting):
        """不同 group_id 的等待互不干扰。"""
        ev1 = make_event(user_id='123', group_id='g1')
        ev2 = make_event(user_id='123', group_id='g2')
        bot = AsyncMock()

        task1 = asyncio.create_task(
            wait_input(bot, ev1, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)

        # g2 的 notify 不影响 g1
        ok = notify_reply('123', 'msg_g2', 'g2')
        assert ok is False
        assert not task1.done()

        # g1 的 notify 唤醒
        ok = notify_reply('123', 'msg_g1', 'g1')
        assert ok is True
        r = await asyncio.wait_for(task1, timeout=1)
        assert r['reply'] == 'msg_g1'

    @pytest.mark.asyncio
    async def test_private_vs_group_isolated(self, clean_waiting):
        """私聊（group_id=''）与群聊（group_id='g1'）即使用户相同也隔离。"""
        ev_private = make_event(user_id='123', group_id='')
        ev_group = make_event(user_id='123', group_id='g1')
        bot = AsyncMock()

        t_priv = asyncio.create_task(
            wait_input(bot, ev_private, prompt='', timeout=5)
        )
        t_grp = asyncio.create_task(
            wait_input(bot, ev_group, prompt='', timeout=5)
        )
        await asyncio.sleep(0.05)

        # 群聊 notify 不影响私聊等待
        notify_reply('123', 'grp_msg', 'g1')
        assert not t_priv.done()

        r_grp = await asyncio.wait_for(t_grp, timeout=1)
        assert r_grp['reply'] == 'grp_msg'

        # 私聊 notify 唤醒私聊等待
        notify_reply('123', 'priv_msg', '')
        r_priv = await asyncio.wait_for(t_priv, timeout=1)
        assert r_priv['reply'] == 'priv_msg'


# ===========================================================================
# 并发安全
# ===========================================================================

class TestConcurrent:
    """验证多个 wait_input 并发等待的并发安全性。"""

    @pytest.mark.asyncio
    async def test_concurrent_different_users(self, clean_waiting):
        """不同用户并发等待，各自被独立唤醒。"""
        ev1 = make_event(user_id='111', group_id='')
        ev2 = make_event(user_id='222', group_id='')
        bot = AsyncMock()

        t1 = asyncio.create_task(wait_input(bot, ev1, prompt='', timeout=5))
        t2 = asyncio.create_task(wait_input(bot, ev2, prompt='', timeout=5))
        await asyncio.sleep(0.05)

        notify_reply('111', 'r1', '')
        notify_reply('222', 'r2', '')

        r1 = await asyncio.wait_for(t1, timeout=1)
        r2 = await asyncio.wait_for(t2, timeout=1)
        assert r1['reply'] == 'r1'
        assert r2['reply'] == 'r2'

    @pytest.mark.asyncio
    async def test_concurrent_gather_same_user(self, clean_waiting):
        """同一用户并发等待，notify 逐个唤醒（asyncio.gather）。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        async def waiter(idx):
            r = await wait_input(bot, event, prompt='', timeout=5)
            return idx, r

        async def notifier():
            await asyncio.sleep(0.05)
            results = []
            for i in range(3):
                ok = notify_reply('123', f'msg{i}', '')
                results.append(ok)
            return results

        waiters = [waiter(i) for i in range(3)]
        all_results = await asyncio.gather(*waiters, notifier())

        notify_results = all_results[-1]
        wait_results = all_results[:-1]
        # 3 次 notify 都成功
        assert all(notify_results)
        # 3 个等待者都被唤醒
        replies = {idx: r['reply'] for idx, r in wait_results}
        assert len(replies) == 3
        assert set(replies.values()) == {'msg0', 'msg1', 'msg2'}

    @pytest.mark.asyncio
    async def test_concurrent_no_cross_talk(self, clean_waiting):
        """并发场景下不同 key 不串扰。"""
        users = ['a', 'b', 'c', 'd']
        bot = AsyncMock()
        tasks = {}
        for u in users:
            ev = make_event(user_id=u, group_id='')
            tasks[u] = asyncio.create_task(
                wait_input(bot, ev, prompt='', timeout=5)
            )
        await asyncio.sleep(0.05)

        for u in users:
            notify_reply(u, f'reply_{u}', '')

        for u in users:
            r = await asyncio.wait_for(tasks[u], timeout=1)
            assert r['reply'] == f'reply_{u}'


# ===========================================================================
# prompt 发送
# ===========================================================================

class TestPrompt:
    """验证 prompt 提示消息的发送逻辑。

    用 mock 模拟 asyncio.wait_for 抛 TimeoutError，避免 sandbox 环境 asyncio
    定时器异常导致的长时间等待。
    """

    @pytest.mark.asyncio
    async def test_prompt_sent_via_bot_send(self, clean_waiting):
        """有 prompt 时调用 bot.send 发送提示。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()
        bot.send = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            await wait_input(bot, event, prompt='请输入', timeout=5)

        bot.send.assert_called_once_with(event, '请输入')

    @pytest.mark.asyncio
    async def test_empty_prompt_not_sent(self, clean_waiting):
        """prompt 为空时不调用 bot.send。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            r = await wait_input(bot, event, prompt='', timeout=0.1)

        bot.send.assert_not_called()
        assert r['timed_out'] is True

    @pytest.mark.asyncio
    async def test_prompt_send_failure_swallowed(self, clean_waiting):
        """bot.send 失败时异常被吞，仍继续等待。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()
        bot.send = AsyncMock(side_effect=RuntimeError('send failed'))

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            r = await wait_input(bot, event, prompt='hi', timeout=0.1)

        # 不应抛异常，仍正常超时
        assert r['timed_out'] is True
        assert r['error'] == ''

    @pytest.mark.asyncio
    async def test_no_bot_not_send(self, clean_waiting):
        """bot=None 时不发送提示，仍正常等待。"""
        event = make_event(user_id='123', group_id='')

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            r = await wait_input(None, event, prompt='hi', timeout=0.1)

        assert r['timed_out'] is True

    @pytest.mark.asyncio
    async def test_no_event_not_send(self, clean_waiting):
        """event=None 时不发送提示。"""
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            # event=None 时 user_id='' group_id=''，仍能等待
            r = await wait_input(bot, None, prompt='hi', timeout=0.1)

        assert r['timed_out'] is True
        bot.send.assert_not_called()


# ===========================================================================
# timeout 规范化
# ===========================================================================

class TestTimeoutNormalization:
    """验证 timeout 参数的规范化逻辑。"""

    @pytest.mark.asyncio
    async def test_invalid_timeout_falls_back_to_default(self, clean_waiting):
        """timeout 为非数值字符串回退默认 60。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'r', 'user_id': '123'}),
        ) as mock_wf:
            await wait_input(bot, event, prompt='', timeout='abc')
            assert mock_wf.call_args.kwargs['timeout'] == 60

    @pytest.mark.asyncio
    async def test_zero_timeout_falls_back_to_default(self, clean_waiting):
        """timeout=0 回退默认 60。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'r', 'user_id': '123'}),
        ) as mock_wf:
            await wait_input(bot, event, prompt='', timeout=0)
            assert mock_wf.call_args.kwargs['timeout'] == 60

    @pytest.mark.asyncio
    async def test_negative_timeout_falls_back_to_default(self, clean_waiting):
        """timeout=-1 回退默认 60。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'r', 'user_id': '123'}),
        ) as mock_wf:
            await wait_input(bot, event, prompt='', timeout=-1)
            assert mock_wf.call_args.kwargs['timeout'] == 60

    @pytest.mark.asyncio
    async def test_none_timeout_falls_back_to_default(self, clean_waiting):
        """timeout=None 回退默认 60。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'r', 'user_id': '123'}),
        ) as mock_wf:
            await wait_input(bot, event, prompt='', timeout=None)
            assert mock_wf.call_args.kwargs['timeout'] == 60

    @pytest.mark.asyncio
    async def test_default_timeout_is_60(self, clean_waiting):
        """不传 timeout 时默认 60。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'r', 'user_id': '123'}),
        ) as mock_wf:
            await wait_input(bot, event, prompt='')
            assert mock_wf.call_args.kwargs['timeout'] == 60

    @pytest.mark.asyncio
    async def test_custom_timeout_used(self, clean_waiting):
        """自定义 timeout 值被传递给 asyncio.wait_for。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'r', 'user_id': '123'}),
        ) as mock_wf:
            await wait_input(bot, event, prompt='', timeout=42)
            assert mock_wf.call_args.kwargs['timeout'] == 42


# ===========================================================================
# expected_pattern 校验 + ReDoS 防护（P2 修复回归测试）
# ===========================================================================

class TestExpectedPattern:
    """验证 expected_pattern 正则校验路径与 ReDoS 防护。

    覆盖 P2 修复点：
    - 正常匹配 / 不匹配重试
    - pattern 长度超限 → 跳过校验
    - reply_text 长度超限 → 视为不匹配
    - 正则编译失败 → 跳过校验
    """

    @pytest.mark.asyncio
    async def test_pattern_matches_returns_valid(self, clean_waiting):
        """回复匹配 expected_pattern 时返回 is_valid=True。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'hello123', 'user_id': '123'}),
        ):
            r = await wait_input(bot, event, prompt='', timeout=5,
                                  expected_pattern=r'hello\d+')

        assert r['is_valid'] is True
        assert r['reply'] == 'hello123'
        assert r['timed_out'] is False

    @pytest.mark.asyncio
    async def test_pattern_no_match_retries_then_invalid(self, clean_waiting):
        """回复不匹配 pattern 时重试，max_retries 耗尽后 is_valid=False。

        每次回复都不匹配 → 重试 max_retries 次后返回空回复 + is_valid=False。
        """
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        # 每次回复都不匹配 pattern（回复是 "nomatch"，要求 \d+）
        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'nomatch', 'user_id': '123'}),
        ) as mock_wf:
            r = await wait_input(bot, event, prompt='', timeout=5,
                                  expected_pattern=r'\d+', max_retries=2)

        assert r['is_valid'] is False
        assert r['reply'] == ''
        # 重试 2 次后耗尽（共调用 wait_for 3 次：1 初次 + 2 重试）
        assert mock_wf.await_count == 3

    @pytest.mark.asyncio
    async def test_oversized_pattern_skips_validation(self, clean_waiting):
        """pattern 超过 _MAX_PATTERN_LEN 时跳过校验，任意回复都 is_valid=True。"""
        from qqbat_nodes.builtin.wait_input import _MAX_PATTERN_LEN
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        # 构造超长 pattern（超过 1000 字符上限）
        oversized_pattern = 'a' * (_MAX_PATTERN_LEN + 1)

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'any_reply', 'user_id': '123'}),
        ):
            r = await wait_input(bot, event, prompt='', timeout=5,
                                  expected_pattern=oversized_pattern)

        # 超长 pattern 被跳过 → 视为无校验 → is_valid=True
        assert r['is_valid'] is True
        assert r['reply'] == 'any_reply'

    @pytest.mark.asyncio
    async def test_oversized_reply_text_treated_as_non_match(self, clean_waiting):
        """reply_text 超过 _MAX_TEXT_LEN 时视为不匹配，进入重试。"""
        from qqbat_nodes.builtin.wait_input import _MAX_TEXT_LEN
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        # 构造超长回复（超过 100000 字符上限）
        oversized_reply = 'x' * (_MAX_TEXT_LEN + 1)

        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': oversized_reply, 'user_id': '123'}),
        ) as mock_wf:
            r = await wait_input(bot, event, prompt='', timeout=5,
                                  expected_pattern=r'x+', max_retries=1)

        # 超长文本视为不匹配 → 重试 1 次耗尽 → is_valid=False
        assert r['is_valid'] is False
        assert r['reply'] == ''
        # 重试 1 次后耗尽（共调用 wait_for 2 次：1 初次 + 1 重试）
        assert mock_wf.await_count == 2

    @pytest.mark.asyncio
    async def test_pattern_compile_failure_skips_validation(self, clean_waiting):
        """expected_pattern 编译失败时跳过校验，任意回复 is_valid=True。"""
        event = make_event(user_id='123', group_id='')
        bot = AsyncMock()

        # 非法正则（未闭合的分组）
        with patch(
            'qqbat_nodes.builtin.wait_input.asyncio.wait_for',
            new=AsyncMock(return_value={'text': 'reply', 'user_id': '123'}),
        ):
            r = await wait_input(bot, event, prompt='', timeout=5,
                                  expected_pattern='(unclosed')

        # 编译失败 → pattern=None → 视为无校验 → is_valid=True
        assert r['is_valid'] is True
        assert r['reply'] == 'reply'
