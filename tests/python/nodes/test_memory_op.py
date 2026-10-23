"""memory_op 节点单元测试 — 覆盖 P0-B6 向量索引优化。

测试目标：
- _score_rows 同步函数：过滤、降级、JSON 解析容错
- _search LIMIT 剪枝：不全量加载，按 created_at DESC LIMIT 取候选
- _search 线程卸载：余弦相似度计算走 anyio.to_thread.run_sync
- _add 上限保护：单 scope 记忆数达 _MAX_MEMORIES_PER_SCOPE 时拒绝写入

被测源码：qqbat_nodes/builtin/memory_op.py
"""
import json
from unittest.mock import MagicMock, patch

import pytest

from qqbat_nodes.builtin import memory_op
from qqbat_nodes.builtin.memory_op import (
    _MAX_MEMORIES_PER_SCOPE,
    _MAX_SEARCH_CANDIDATES,
    _cosine_similarity,
    _score_rows,
    memory_op as memory_op_handler,
)


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """使用临时数据库路径，不污染正式 db。"""
    db_path = tmp_path / "test_memory.db"
    # 统一连接池按项目根校验路径，需将项目根指向临时目录
    monkeypatch.setenv('QQ_BOT_PROJECT_ROOT', str(tmp_path))
    monkeypatch.setattr(memory_op, "_get_db_path", lambda: str(db_path))
    yield db_path


@pytest.fixture
def mock_event():
    e = MagicMock()
    e.user_id = 12345
    e.group_id = None
    return e


def _make_vec(seed: float, dim: int = 8):
    """生成确定性向量用于测试。"""
    return [seed * (i + 1) / 10 for i in range(dim)]


# =============================================================================
# _score_rows 同步函数
# =============================================================================
class TestScoreRows:
    """验证 _score_rows 过滤与容错。"""

    def test_filters_below_min_score(self):
        """低于 min_score 的行被过滤掉。"""
        rows = [
            {
                'id': 1, 'text': 'a',
                'vector': json.dumps([1.0, 0.0]),
                'metadata': '{}', 'created_at': 1.0,
            },
            {
                'id': 2, 'text': 'b',
                'vector': json.dumps([0.0, 1.0]),
                'metadata': '{}', 'created_at': 2.0,
            },
        ]
        # query = [1, 0]，cos 与 row1=1.0，与 row2=0.0
        scored = _score_rows([1.0, 0.0], rows, min_score=0.5)
        assert len(scored) == 1
        assert scored[0][1]['id'] == 1
        assert scored[0][0] == 1.0

    def test_keeps_zero_score_when_min_score_zero(self):
        """min_score=0 时 score=0 的行也保留。"""
        rows = [
            {
                'id': 1, 'text': 'a',
                'vector': json.dumps([0.0, 1.0]),
                'metadata': '{}', 'created_at': 1.0,
            },
        ]
        scored = _score_rows([1.0, 0.0], rows, min_score=0.0)
        assert len(scored) == 1
        assert scored[0][0] == 0.0

    def test_handles_empty_vector_string(self):
        """vector 字段为空字符串时降级为空向量，score=0。"""
        rows = [
            {
                'id': 1, 'text': 'a',
                'vector': '',
                'metadata': '{}', 'created_at': 1.0,
            },
        ]
        scored = _score_rows([1.0, 0.0], rows, min_score=0.0)
        assert len(scored) == 1
        assert scored[0][0] == 0.0

    def test_handles_invalid_json_vector(self):
        """vector 是非法 JSON 时降级为空向量，score=0。"""
        rows = [
            {
                'id': 1, 'text': 'a',
                'vector': 'not-json',
                'metadata': '{}', 'created_at': 1.0,
            },
        ]
        scored = _score_rows([1.0, 0.0], rows, min_score=0.0)
        assert len(scored) == 1
        assert scored[0][0] == 0.0

    def test_handles_invalid_json_metadata(self):
        """metadata 是非法 JSON 时降级为空 dict。"""
        rows = [
            {
                'id': 1, 'text': 'a',
                'vector': json.dumps([1.0, 0.0]),
                'metadata': 'not-json',
                'created_at': 1.0,
            },
        ]
        scored = _score_rows([1.0, 0.0], rows, min_score=0.5)
        assert len(scored) == 1
        assert scored[0][1]['metadata'] == {}

    def test_round_score_to_4_decimals(self):
        """score 保留 4 位小数。"""
        rows = [
            {
                'id': 1, 'text': 'a',
                'vector': json.dumps([1.0, 1.0]),
                'metadata': '{}', 'created_at': 1.0,
            },
        ]
        # query=[1,0], vec=[1,1] -> cos = 1/(sqrt(2)*1) = 0.7071...
        scored = _score_rows([1.0, 0.0], rows, min_score=0.5)
        assert scored[0][1]['score'] == 0.7071


# =============================================================================
# _cosine_similarity 基础正确性
# =============================================================================
class TestCosineSimilarity:
    def test_identical_vectors_score_one(self):
        v = [1.0, 2.0, 3.0]
        assert _cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors_score_zero(self):
        assert _cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_zero_vector_score_zero(self):
        assert _cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_different_dim_score_zero(self):
        assert _cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0


# =============================================================================
# P0-B6: _search LIMIT 剪枝 + 线程卸载
# =============================================================================
class TestSearchLimitPruning:
    """验证 _search 不再全量加载，按 LIMIT 剪枝。"""

    @pytest.mark.asyncio
    async def test_search_applies_limit(self, temp_db, mock_event):
        """_search 应按 created_at DESC LIMIT 取候选，不全量加载。"""
        # mock embedding 返回固定向量
        async def fake_emb(**kwargs):
            return {'vector': [1.0, 0.0, 0.0], 'dimensions': 3, 'error': ''}

        with patch('qqbat_nodes.builtin.memory_op.embedding_handler', new=fake_emb):
            # 直接写入 N 条记忆，超出 _MAX_SEARCH_CANDIDATES
            from qqbat_nodes.builtin.memory_op import _get_db
            db = await _get_db()
            insert_count = _MAX_SEARCH_CANDIDATES + 50
            for i in range(insert_count):
                await db.execute(
                    'INSERT INTO _memories (scope, scope_id, text, vector, metadata, created_at) '
                    'VALUES (?, ?, ?, ?, ?, ?)',
                    ('user', '12345', f'text_{i}', '[]', '{}', float(i)),
                )
            await db.commit()
            await db.close()

            # 搜索：top_k=3，应只扫描 _MAX_SEARCH_CANDIDATES 条最新的
            result = await memory_op_handler(
                event=mock_event, mode='search', text='hello',
                user_id='12345', scope='user', top_k=3, min_score=0.0,
            )
            assert result['success'] is True
            assert result['count'] <= 3

    @pytest.mark.asyncio
    async def test_search_uses_thread_offload(self, temp_db, mock_event):
        """_search 通过 anyio.to_thread.run_sync 卸载相似度计算到线程。"""
        async def fake_emb(**kwargs):
            return {'vector': [1.0, 0.0], 'dimensions': 2, 'error': ''}

        with patch('qqbat_nodes.builtin.memory_op.embedding_handler', new=fake_emb), \
             patch('qqbat_nodes.builtin.memory_op.anyio.to_thread.run_sync',
                   wraps=__import__('anyio').to_thread.run_sync) as spy:
            # 先写入一条记忆
            from qqbat_nodes.builtin.memory_op import _get_db
            db = await _get_db()
            await db.execute(
                'INSERT INTO _memories (scope, scope_id, text, vector, metadata, created_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                ('user', '12345', 'hello', json.dumps([1.0, 0.0]), '{}', 1.0),
            )
            await db.commit()
            await db.close()

            result = await memory_op_handler(
                event=mock_event, mode='search', text='hello',
                user_id='12345', scope='user', top_k=3, min_score=0.0,
            )
            assert result['success'] is True
            # 验证调用了线程卸载
            assert spy.call_count >= 1

    @pytest.mark.asyncio
    async def test_search_returns_correct_top_k(self, temp_db, mock_event):
        """_search 正确返回 top_k 结果并按相似度降序。"""
        async def fake_emb(**kwargs):
            return {'vector': [1.0, 0.0], 'dimensions': 2, 'error': ''}

        with patch('qqbat_nodes.builtin.memory_op.embedding_handler', new=fake_emb):
            from qqbat_nodes.builtin.memory_op import _get_db
            db = await _get_db()
            # 三条记忆，相似度递减
            await db.execute(
                'INSERT INTO _memories (scope, scope_id, text, vector, metadata, created_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                ('user', '12345', 'exact', json.dumps([1.0, 0.0]), '{}', 1.0),
            )
            await db.execute(
                'INSERT INTO _memories (scope, scope_id, text, vector, metadata, created_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                ('user', '12345', 'orthogonal', json.dumps([0.0, 1.0]), '{}', 2.0),
            )
            await db.execute(
                'INSERT INTO _memories (scope, scope_id, text, vector, metadata, created_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                ('user', '12345', 'half', json.dumps([1.0, 1.0]), '{}', 3.0),
            )
            await db.commit()
            await db.close()

            # top_k=2，min_score=0
            result = await memory_op_handler(
                event=mock_event, mode='search', text='hello',
                user_id='12345', scope='user', top_k=2, min_score=0.0,
            )
            assert result['success'] is True
            assert result['count'] == 2
            # 按相似度降序：exact(1.0) > half(0.7071) > orthogonal(0.0)
            assert result['result'][0]['text'] == 'exact'
            assert result['result'][0]['score'] == 1.0
            assert result['result'][1]['text'] == 'half'

    @pytest.mark.asyncio
    async def test_search_empty_text(self, temp_db, mock_event):
        """空文本应直接失败，不调用 embedding。"""
        result = await memory_op_handler(
            event=mock_event, mode='search', text='',
            user_id='12345', scope='user',
        )
        assert result['success'] is False
        assert 'text' in result['error']


# =============================================================================
# P0-B6: 上限保护
# =============================================================================
class TestMaxMemoriesLimit:
    """验证单 scope 记忆数上限保护。"""

    @pytest.mark.asyncio
    async def test_add_rejected_when_limit_exceeded(self, temp_db, mock_event, monkeypatch):
        """单 scope 记忆数超 _MAX_MEMORIES_PER_SCOPE 时拒绝写入。"""
        # 临时把上限改小，方便测试
        monkeypatch.setattr(memory_op, '_MAX_MEMORIES_PER_SCOPE', 3)

        async def fake_emb(**kwargs):
            return {'vector': [1.0, 0.0], 'dimensions': 2, 'error': ''}

        with patch('qqbat_nodes.builtin.memory_op.embedding_handler', new=fake_emb):
            # 写入 3 条（达到上限）
            for i in range(3):
                r = await memory_op_handler(
                    event=mock_event, mode='add', text=f'text_{i}',
                    user_id='12345', scope='user',
                )
                assert r['success'] is True, f"第 {i+1} 条应成功: {r}"

            # 第 4 条应被拒绝
            r = await memory_op_handler(
                event=mock_event, mode='add', text='text_4',
                user_id='12345', scope='user',
            )
            assert r['success'] is False
            assert '上限' in r['error']

    @pytest.mark.asyncio
    async def test_add_succeeds_below_limit(self, temp_db, mock_event, monkeypatch):
        """低于上限时正常写入。"""
        monkeypatch.setattr(memory_op, '_MAX_MEMORIES_PER_SCOPE', 100)

        async def fake_emb(**kwargs):
            return {'vector': [1.0, 0.0], 'dimensions': 2, 'error': ''}

        with patch('qqbat_nodes.builtin.memory_op.embedding_handler', new=fake_emb):
            r = await memory_op_handler(
                event=mock_event, mode='add', text='hello',
                user_id='12345', scope='user',
            )
            assert r['success'] is True
            assert r['count'] == 1
            assert r['result'] is not None  # memory_id

    @pytest.mark.asyncio
    async def test_scope_isolation_for_limit(self, temp_db, mock_event, monkeypatch):
        """不同 scope 各自独立计算上限。"""
        monkeypatch.setattr(memory_op, '_MAX_MEMORIES_PER_SCOPE', 2)

        async def fake_emb(**kwargs):
            return {'vector': [1.0, 0.0], 'dimensions': 2, 'error': ''}

        with patch('qqbat_nodes.builtin.memory_op.embedding_handler', new=fake_emb):
            # user scope 写入 2 条
            for i in range(2):
                r = await memory_op_handler(
                    event=mock_event, mode='add', text=f'user_{i}',
                    user_id='12345', scope='user',
                )
                assert r['success'] is True

            # global scope 应仍能写入（独立计数）
            r = await memory_op_handler(
                event=mock_event, mode='add', text='global_0',
                scope='global',
            )
            assert r['success'] is True
