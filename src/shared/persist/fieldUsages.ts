// src/shared/persist/fieldUsages.ts
//
// 从流程里收集 `variable_persist` 声明的持久化字段 —— **主进程与渲染层共用这一份**。
//
// 为什么挪到 shared：玩家字段的"存在性"依据必须只有一个来源。
// 原先这段逻辑只活在渲染层（`playerFieldsModel`），主进程要推导玩家 schema 只能再写一份，
// 两份迟早会漂（这个仓库已经在 `FieldCategory` 上吃过"同义类型写三份"的亏）。
import type { FlowGraph } from '@shared/types/flow';
import { isPersistenceKind } from '@shared/nodes/kindSets';
import { parseKey } from './persistentKey';

/** 流程里某个持久化字段的用法 */
export interface FieldUsage {
  key: string;
  /** 出现过的读写模式（`save` / `load` / `increment` / `load_or_default` …） */
  modes: Set<string>;
  /** 流程里出现次数 */
  nodeCount: number;
  /** 存储作用域（取最后一次见到的值；同一 key 在不同节点上一般一致） */
  scope: string;
  /** 流程里其中一处的中文节点名（用作字段标签的最佳来源） */
  label?: string;
}

/**
 * 从流程里收集**持久化节点**声明的全部持久化字段。
 *
 * ⚠️ 2026-10-03：原来只看 `variable_persist`（注释写着"它是持久化的唯一写入/读取节点"）
 * —— 那个前提在拆分后**不成立了**：读写拆成 7 个节点（load_variable / save_variable /
 * incr_variable / …）。只认老 kind 会让字段清单**静默少掉**（与 dataTemplateService 同款问题，
 * 由 deprecatedKindUsage 闸门抓出来）。现在按目录的 resource === 'player_data' 派生。
 */
export function collectFieldUsages(graph: FlowGraph | null | undefined): Map<string, FieldUsage> {
  const out = new Map<string, FieldUsage>();
  if (!graph) return out;
  for (const node of graph.nodes ?? []) {
    if (!isPersistenceKind(node.data?.nodeKind)) continue;
    const cfg = (node.data as { config?: Record<string, unknown> }).config;
    if (!cfg) continue;
    const key = typeof cfg.key === 'string' ? cfg.key.trim() : '';
    if (!key) continue;
    const prev = out.get(key);
    const usage: FieldUsage = prev ?? {
      key,
      modes: new Set<string>(),
      nodeCount: 0,
      scope: 'user',
    };
    usage.nodeCount++;
    usage.modes.add(String(cfg.mode ?? 'save'));
    usage.scope = String(cfg.scope ?? usage.scope ?? 'user');
    // 节点名通常是作者给这个字段起的中文名（如「读取当前HP」）—— 比通用名字表准确
    if (!usage.label && typeof node.data.label === 'string' && node.data.label.trim()) {
      usage.label = node.data.label.trim();
    }
    out.set(key, usage);
  }
  return out;
}

/**
 * 从 `_persistent` 的完整 key（`user_70001:hp` / `group_123:foo`）里切出字段名。
 *
 * ⚠️ 2026-10-03：改用 `parseKey`（key 格式的唯一真相）。原来的实现是"按**第一个冒号**切" ✗ ——
 * 对 **global** 且字段名自带冒号的 key（`"a:b"`）会把字段名切错，而且它等于**又实现了一遍**
 * 前缀规则（前缀格式一改，这里不会跟着改）。
 */
export function fieldKeyOf(fullKey: string): string {
  return parseKey(fullKey).key;
}
