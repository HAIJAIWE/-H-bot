"""性能 profile 实测 — 验证 batch_persistent 批量事务优化的实际收益。

测试场景：
1. 循环 _save_value vs 单事务 _batch_save_values（N=10/50/100/500）
2. expression_eval 吞吐量
3. random 节点吞吐量

运行：python tests/python/perf/benchmark_persistent.py
"""
import asyncio
import os
import sys
import time
import statistics
from unittest.mock import MagicMock

# 确保项目根在 sys.path
# 本文件位于 tests/python/perf/benchmark_persistent.py
# 向上 4 级：perf → python → tests → 项目根
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, PROJECT_ROOT)

from qqbat_nodes.builtin.persistent_store import (
    _save_value, _batch_save_values, _load_value, _get_connection,
)
from qqbat_nodes.builtin.expression_eval import expression_eval
from qqbat_nodes.builtin.random import random as random_node


def make_mock_event(user_id: int = 10000):
    """构造带 user_id 的 mock event。"""
    ev = MagicMock()
    ev.user_id = user_id
    ev.group_id = None
    return ev


async def reset_db():
    """清空 _persistent 表，避免历史数据干扰。"""
    db = await _get_connection()
    await db.execute("DELETE FROM _persistent")
    await db.commit()


async def bench_loop_save(n: int, event) -> float:
    """循环调用 _save_value N 次，返回耗时（秒）。"""
    await reset_db()
    t0 = time.perf_counter()
    for i in range(n):
        await _save_value(f"k{i}", i, scope='user', event=event, ttl=0)
    return time.perf_counter() - t0


async def bench_batch_save(n: int, event) -> float:
    """单事务批量保存 N 个键，返回耗时（秒）。"""
    await reset_db()
    data = {f"k{i}": i for i in range(n)}
    t0 = time.perf_counter()
    await _batch_save_values(data, scope='user', event=event, ttl=0)
    return time.perf_counter() - t0


async def bench_load(n: int, event) -> float:
    """批量读取 N 个键，返回耗时（秒）。先写入再读取。"""
    await reset_db()
    # 先写入数据
    data = {f"k{i}": i for i in range(n)}
    await _batch_save_values(data, scope='user', event=event, ttl=0)
    # 计时读取
    t0 = time.perf_counter()
    for i in range(n):
        await _load_value(f"k{i}", scope='user', event=event)
    return time.perf_counter() - t0


async def bench_expression_eval(n: int) -> float:
    """expression_eval 吞吐量测试。"""
    expr = "atk - defense * 0.5 + clamp(hp, 0, 999)"
    variables_json = '{"atk": 100, "defense": 50, "hp": 200}'
    bot = MagicMock()
    event = MagicMock()
    t0 = time.perf_counter()
    for _ in range(n):
        await expression_eval(
            bot=bot, event=event,
            expression=expr,
            variables_json=variables_json,
        )
    return time.perf_counter() - t0


async def bench_random(n: int) -> float:
    """random 节点吞吐量测试。"""
    bot = MagicMock()
    event = MagicMock()
    t0 = time.perf_counter()
    for _ in range(n):
        await random_node(bot=bot, event=event, mode='int', min_value=1, max_value=10000)
    return time.perf_counter() - t0


async def run_benchmarks():
    """运行所有 benchmark 并输出报告。"""
    event = make_mock_event(user_id=99999)
    bot = MagicMock()

    print("=" * 72)
    print("性能 profile 实测报告")
    print("=" * 72)
    print()

    # =========================================================================
    # 1. 批量保存对比：循环 _save_value vs 单事务 _batch_save_values
    # =========================================================================
    print("【1】批量保存对比：循环 _save_value vs 单事务 _batch_save_values")
    print("-" * 72)
    print(f"{'N':>6} | {'循环 save (ms)':>15} | {'批量 batch (ms)':>16} | {'加速比':>8} | {'提升':>8}")
    print("-" * 72)

    for n in [10, 50, 100, 500, 1000]:
        # 跑 3 次取中位数
        loop_times = []
        batch_times = []
        for _ in range(3):
            loop_times.append(await bench_loop_save(n, event))
            batch_times.append(await bench_batch_save(n, event))
        loop_med = statistics.median(loop_times)
        batch_med = statistics.median(batch_times)
        speedup = loop_med / batch_med if batch_med > 0 else float('inf')
        reduction = (1 - batch_med / loop_med) * 100 if loop_med > 0 else 0
        print(f"{n:>6} | {loop_med*1000:>13.2f}ms | {batch_med*1000:>14.2f}ms | {speedup:>7.2f}x | {reduction:>6.1f}%")

    print()

    # =========================================================================
    # 2. 批量读取性能
    # =========================================================================
    print("【2】批量读取性能（循环 _load_value）")
    print("-" * 72)
    print(f"{'N':>6} | {'总耗时 (ms)':>12} | {'单次 (μs)':>12} | {'QPS':>10}")
    print("-" * 72)

    for n in [100, 500, 1000]:
        times = []
        for _ in range(3):
            times.append(await bench_load(n, event))
        med = statistics.median(times)
        per_op = med / n * 1_000_000  # μs
        qps = n / med if med > 0 else 0
        print(f"{n:>6} | {med*1000:>10.2f}ms | {per_op:>10.1f}μs | {qps:>8.0f}")

    print()

    # =========================================================================
    # 3. expression_eval 吞吐量
    # =========================================================================
    print("【3】expression_eval 吞吐量")
    print("-" * 72)
    n = 10000
    times = []
    for _ in range(3):
        times.append(await bench_expression_eval(n))
    med = statistics.median(times)
    per_op = med / n * 1_000_000
    qps = n / med if med > 0 else 0
    print(f"  N={n}, 表达式='atk - defense * 0.5 + clamp(hp, 0, 999)'")
    print(f"  总耗时: {med*1000:.2f}ms")
    print(f"  单次:   {per_op:.1f}μs")
    print(f"  QPS:    {qps:,.0f}")
    print()

    # =========================================================================
    # 4. random 节点吞吐量
    # =========================================================================
    print("【4】random 节点吞吐量")
    print("-" * 72)
    n = 10000
    times = []
    for _ in range(3):
        times.append(await bench_random(n))
    med = statistics.median(times)
    per_op = med / n * 1_000_000
    qps = n / med if med > 0 else 0
    print(f"  N={n}, mode=int, min=1, max=10000")
    print(f"  总耗时: {med*1000:.2f}ms")
    print(f"  单次:   {per_op:.1f}μs")
    print(f"  QPS:    {qps:,.0f}")
    print()

    print("=" * 72)
    print("结论：")
    print("  - 批量保存优化在 N>=50 时应有显著加速（预期 60-80% 延迟下降）")
    print("  - WAL + synchronous=NORMAL 配合下，写性能应比默认 FULL 模式快 2-3x")
    print("  - expression_eval 和 random 应在 μs 级别，不影响整体流程")
    print("=" * 72)


if __name__ == '__main__':
    asyncio.run(run_benchmarks())
