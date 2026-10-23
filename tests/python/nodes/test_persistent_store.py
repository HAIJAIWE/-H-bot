"""persistent_store 模块单元测试 — 覆盖 P0-B1 / P0-B2 修复。

测试目标：
- P0-B1: _db_pool 跨 event loop 重建（懒初始化 lock + loop 切换检测）
- P0-B2: _incr_value 自增保留原 TTL（不再覆盖为 None）

被测源码：qqbat_nodes/builtin/persistent_store.py
"""
import asyncio
import json
import os
import threading
from unittest.mock import MagicMock

import pytest

from qqbat_nodes.builtin import persistent_store
from qqbat_nodes.builtin._db_pool import (
    _DB_CONN_LOOP_IDS,
    _DB_LOCKS,
    _DB_LOCK_LOOP_IDS,
    _DB_POOL,
)
from qqbat_nodes.builtin.persistent_store import (
    _db_path_for_pool,
    _get_connection,
    _incr_value,
    _list_append_value,
    _load_value,
    _save_value,
)


@pytest.fixture(autouse=True)
async def _cleanup_db_pool():
    """每个测试结束后关闭所有连接并清空 _db_pool 全局状态，避免跨测试污染。

    本文件测试直接操控 _DB_LOCKS/_DB_LOCK_LOOP_IDS/_DB_POOL/_DB_CONN_LOOP_IDS
    等模块级全局（模拟 event loop 切换），残留连接和锁会污染后续测试，
    因此每个测试后统一走 _db_pool.close_all() 清理。
    """
    yield
    from qqbat_nodes.builtin import _db_pool

    await _db_pool.close_all()


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """使用临时数据库路径，不污染正式 db。"""
    db_path = tmp_path / "test_persistent.db"
    # 统一连接池按项目根校验路径，需将项目根指向临时目录
    monkeypatch.setenv('QQ_BOT_PROJECT_ROOT', str(tmp_path))
    monkeypatch.setattr(persistent_store, "_DB_PATH", str(db_path))
    yield db_path


@pytest.fixture
def mock_event():
    e = MagicMock()
    e.user_id = 12345
    e.group_id = None
    return e


def _abs_db_path() -> str:
    """获取当前测试数据库的绝对路径（用于访问 _db_pool 内部状态）。"""
    return os.path.abspath(_db_path_for_pool())


# =============================================================================
# P0-B1: 跨 event loop 修复
# =============================================================================
class TestEventLoopSwitch:
    """验证 _get_connection 在 event loop 切换时正确重建连接和 lock。"""

    @pytest.mark.asyncio
    async def test_lock_lazy_initialized(self, temp_db, mock_event):
        """lock 不在模块加载时创建，首次写操作时才创建。"""
        abs_path = _abs_db_path()
        assert _DB_LOCKS.get(abs_path) is None
        # 连接在 _get_connection 时建立；写锁在首次写操作时建立
        await _save_value("k1", "v1", "user", mock_event)
        assert _DB_LOCKS.get(abs_path) is not None
        assert _DB_CONN_LOOP_IDS.get(abs_path) is not None

    @pytest.mark.asyncio
    async def test_lock_survives_same_loop(self, temp_db, mock_event):
        """同一 event loop 中多次写操作，lock 复用。"""
        abs_path = _abs_db_path()
        await _save_value("k1", "v1", "user", mock_event)
        first_lock = _DB_LOCKS.get(abs_path)
        first_conn_loop_id = _DB_CONN_LOOP_IDS.get(abs_path)
        first_lock_loop_id = _DB_LOCK_LOOP_IDS.get(abs_path)
        await _save_value("k2", "v2", "user", mock_event)
        assert _DB_LOCKS.get(abs_path) is first_lock
        assert _DB_CONN_LOOP_IDS.get(abs_path) == first_conn_loop_id
        assert _DB_LOCK_LOOP_IDS.get(abs_path) == first_lock_loop_id

    @pytest.mark.asyncio
    async def test_event_loop_switch_rebuilds_lock(self, temp_db, mock_event):
        """event loop 切换后，旧 lock 被丢弃并重建（不再 bound to a different loop）。"""
        abs_path = _abs_db_path()
        # 第一次写操作建立连接和 lock
        await _save_value("k1", "v1", "user", mock_event)
        old_lock = _DB_LOCKS.get(abs_path)
        old_lock_loop_id = _DB_LOCK_LOOP_IDS.get(abs_path)

        # 模拟 NoneBot 热重载：将 lock 的 loop id 改成不一致的值
        # 下次写操作会检测到不一致并重建
        _DB_LOCK_LOOP_IDS[abs_path] = old_lock_loop_id - 999
        await _save_value("k2", "v2", "user", mock_event)
        # 新 lock 已创建，且 _DB_LOCK_LOOP_IDS 更新为新 loop id
        assert _DB_LOCKS.get(abs_path) is not None
        assert _DB_LOCKS.get(abs_path) is not old_lock
        assert _DB_LOCK_LOOP_IDS[abs_path] == old_lock_loop_id  # 重新等于真实 loop id

    @pytest.mark.asyncio
    async def test_operations_work_after_loop_switch(self, temp_db, mock_event):
        """跨 loop 切换后，业务操作仍能正常工作（无 RuntimeError）。"""
        abs_path = _abs_db_path()
        # 第一次操作
        await _save_value("k1", "v1", "user", mock_event)
        # 模拟 loop 切换：让 _db_pool 认为 lock 绑定到了不同 loop
        _DB_LOCK_LOOP_IDS[abs_path] = -999
        # 再次操作应正常完成（会重建 lock；连接若未切换则复用）
        ok = await _save_value("k2", "v2", "user", mock_event)
        assert ok is True
        val = await _load_value("k1", "user", mock_event)
        assert val == "v1"

    @pytest.mark.asyncio
    async def test_real_loop_switch_in_separate_thread(self, temp_db, mock_event):
        """通过独立线程+新 event loop 模拟 NoneBot 热重载，验证不再抛 RuntimeError。

        旧实现：模块加载时 _db_lock = asyncio.Lock() 绑定到导入时的 loop，
        线程中新 loop 中 await 旧 lock 会抛 RuntimeError: bound to a different event loop。
        新实现：_db_pool 检测到 loop 切换后重建 lock，不再报错。

        pytest-asyncio 已在事件循环中，不能嵌套 asyncio.run，
        因此用独立线程跑新 event loop 模拟 NoneBot 热重载。
        """
        abs_path = _abs_db_path()
        # 主 loop 中建立连接和 lock（通过一次写操作）
        await _save_value("k1", "v1", "user", mock_event)
        main_loop_lock = _DB_LOCKS.get(abs_path)
        main_lock_loop_id = _DB_LOCK_LOOP_IDS.get(abs_path)
        assert main_loop_lock is not None

        # 在独立线程中创建全新 event loop 并运行协程
        result_box: dict = {}
        error_box: dict = {}

        def _runner():
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            try:
                async def _in_new_loop():
                    # 新 loop 中执行一次写操作，触发 lock 创建
                    # 旧实现这里会 raise RuntimeError: bound to a different event loop
                    await _save_value("k2", "v2", "user", mock_event)
                    return _DB_LOCKS.get(abs_path), _DB_LOCK_LOOP_IDS.get(abs_path)
                result_box['value'] = new_loop.run_until_complete(_in_new_loop())
            except Exception as e:
                error_box['error'] = e
            finally:
                try:
                    new_loop.close()
                except Exception:
                    pass
                asyncio.set_event_loop(None)

        t = threading.Thread(target=_runner)
        t.start()
        t.join()

        # 旧实现这里会 raise RuntimeError: bound to a different event loop
        assert 'error' not in error_box, f"新 loop 中调用失败: {error_box.get('error')}"
        new_lock, new_loop_id = result_box['value']
        # lock 已重建，与旧 lock 不同
        assert new_lock is not None
        assert new_lock is not main_loop_lock
        # lock 的 loop id 已更新为新 loop
        assert new_loop_id != main_lock_loop_id


# =============================================================================
# P0-B2: _incr_value 保留 TTL
# =============================================================================
class TestIncrValuePreservesTtl:
    """验证 _incr_value 自增不丢失原 TTL。"""

    @pytest.mark.asyncio
    async def test_incr_preserves_ttl(self, temp_db, mock_event):
        """原 ttl=300 的键自增后保持 ttl=300（不变成永不过期）。"""
        # 保存一个 ttl=300 的计数器
        await _save_value("counter", 10, "user", mock_event, ttl=300)
        # 读取数据库直接验证 ttl 已设置
        db = await _get_connection()
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:counter",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        original_expire_at = data['expire_at']
        assert original_expire_at is not None

        # 自增 1
        result = await _incr_value(
            bot=None, event=mock_event, key="counter", amount=1, default=0,
            scope='user',
        )
        assert result['error'] == ''
        assert result['result'] == 11
        assert result['old_value'] == 10

        # 验证 TTL 保留：expire_at 不应被覆盖为 None
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:counter",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        assert data['expire_at'] is not None
        # expire_at 数值应保持不变（保留原 TTL）
        assert abs(data['expire_at'] - original_expire_at) < 0.001

    @pytest.mark.asyncio
    async def test_incr_no_ttl_stays_no_ttl(self, temp_db, mock_event):
        """无 ttl（永不过期）的键自增后保持永不过期。"""
        # 保存一个无 ttl 的计数器
        await _save_value("counter", 5, "user", mock_event, ttl=0)
        # 自增
        result = await _incr_value(
            bot=None, event=mock_event, key="counter", amount=2, default=0,
            scope='user',
        )
        assert result['result'] == 7
        # 验证 expire_at 仍为 None
        db = await _get_connection()
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:counter",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        assert data['expire_at'] is None

    @pytest.mark.asyncio
    async def test_incr_expired_key_resets_ttl(self, temp_db, mock_event):
        """已过期的键自增时，不继承旧过期时间（否则刚写入又立即过期）。"""
        # 保存一个 ttl=1 秒的键
        await _save_value("counter", 100, "user", mock_event, ttl=1)
        # 等待过期
        await asyncio.sleep(1.1)
        # 自增
        result = await _incr_value(
            bot=None, event=mock_event, key="counter", amount=1, default=0,
            scope='user',
        )
        # 已过期按 default 处理：old=default=0, new=0+1=1
        assert result['old_value'] == 0
        assert result['result'] == 1
        # 新写入的值不应继承旧过期时间（否则会立即过期）
        db = await _get_connection()
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:counter",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        assert data['expire_at'] is None

    @pytest.mark.asyncio
    async def test_incr_new_key_uses_default(self, temp_db, mock_event):
        """新键自增时使用 default 作为基线，expire_at=None。"""
        result = await _incr_value(
            bot=None, event=mock_event, key="new_counter", amount=5, default=10,
            scope='user',
        )
        assert result['result'] == 15  # default + amount
        assert result['old_value'] == 10
        assert result['error'] == ''
        # 验证 expire_at 为 None（新键无 TTL）
        db = await _get_connection()
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:new_counter",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        assert data['expire_at'] is None


# =============================================================================
# P1-3: _list_append_value 原子追加
# =============================================================================
class TestListAppendValue:
    """验证 _list_append_value 原子追加的正确性与 TTL 保留。"""

    @pytest.mark.asyncio
    async def test_append_to_new_key(self, temp_db, mock_event):
        """键不存在时新建列表并追加，new=True。"""
        result = await _list_append_value(
            bot=None, event=mock_event, key="history", item="a", scope='user',
        )
        assert result['error'] == ''
        assert result['new'] is True
        assert result['length'] == 1
        assert result['result'] == ["a"]

    @pytest.mark.asyncio
    async def test_append_to_existing_list(self, temp_db, mock_event):
        """已有列表追加元素，new=False。"""
        await _list_append_value(
            bot=None, event=mock_event, key="history", item="a", scope='user',
        )
        result = await _list_append_value(
            bot=None, event=mock_event, key="history", item="b", scope='user',
        )
        assert result['new'] is False
        assert result['length'] == 2
        assert result['result'] == ["a", "b"]

    @pytest.mark.asyncio
    async def test_append_to_scalar_wraps_in_list(self, temp_db, mock_event):
        """原值为标量（旧格式）时包成单元素列表再追加。"""
        await _save_value("scalar_key", "first", "user", mock_event)
        result = await _list_append_value(
            bot=None, event=mock_event, key="scalar_key", item="second", scope='user',
        )
        assert result['new'] is False
        assert result['length'] == 2
        assert result['result'] == ["first", "second"]

    @pytest.mark.asyncio
    async def test_max_length_trims_oldest(self, temp_db, mock_event):
        """max_length 超限时保留最后 N 个元素（丢弃最早的）。"""
        for ch in ["a", "b", "c", "d", "e"]:
            await _list_append_value(
                bot=None, event=mock_event, key="recent", item=ch,
                scope='user', max_length=3,
            )
        result = await _list_append_value(
            bot=None, event=mock_event, key="recent", item="f",
            scope='user', max_length=3,
        )
        assert result['length'] == 3
        # 保留最后 3 个：d, e, f
        assert result['result'] == ["d", "e", "f"]

    @pytest.mark.asyncio
    async def test_append_preserves_ttl(self, temp_db, mock_event):
        """原 ttl=300 的键追加后保持 ttl=300（不变成永不过期）。"""
        await _save_value("hist", ["x"], "user", mock_event, ttl=300)
        db = await _get_connection()
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:hist",)
        )
        row = await cursor.fetchone()
        original_expire_at = json.loads(row['value'])['expire_at']
        assert original_expire_at is not None

        result = await _list_append_value(
            bot=None, event=mock_event, key="hist", item="y", scope='user',
        )
        assert result['error'] == ''

        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:hist",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        assert data['expire_at'] is not None
        # TTL 保留：expire_at 数值不变
        assert abs(data['expire_at'] - original_expire_at) < 0.001

    @pytest.mark.asyncio
    async def test_append_expired_key_resets_ttl(self, temp_db, mock_event):
        """已过期的键追加时按新建处理，不继承旧过期时间。"""
        await _save_value("hist", ["old"], "user", mock_event, ttl=1)
        await asyncio.sleep(1.1)
        result = await _list_append_value(
            bot=None, event=mock_event, key="hist", item="new", scope='user',
        )
        assert result['new'] is True
        assert result['result'] == ["new"]
        # 不继承旧过期时间
        db = await _get_connection()
        cursor = await db.execute(
            "SELECT value FROM _persistent WHERE key = ?", ("user_12345:hist",)
        )
        row = await cursor.fetchone()
        data = json.loads(row['value'])
        assert data['expire_at'] is None

    @pytest.mark.asyncio
    async def test_empty_key_returns_error(self, temp_db, mock_event):
        """空 key 返回错误，不写库。"""
        result = await _list_append_value(
            bot=None, event=mock_event, key="", item="x", scope='user',
        )
        assert result['error'] == 'key 为空'
        assert result['result'] == []

    @pytest.mark.asyncio
    async def test_concurrent_appends_no_loss(self, temp_db, mock_event):
        """并发追加不丢元素（验证原子性，回归 P1-3 修复点）。

        旧实现：load → append → save 非原子，并发追加会丢元素。
        新实现：load+append+save 都在 write_lock 内，并发安全。
        """
        import asyncio as _aio
        # 20 个并发任务各追加一个元素到同一 key
        await asyncio.gather(*[
            _list_append_value(
                bot=None, event=mock_event, key="concurrent_hist", item=i,
                scope='user',
            )
            for i in range(20)
        ])
        # 所有元素都应保留（无丢失）
        val = await _load_value("concurrent_hist", "user", mock_event)
        assert isinstance(val, list)
        assert len(val) == 20, f"并发追加丢失元素: 期望 20, 实际 {len(val)}"
        assert sorted(val) == list(range(20))
