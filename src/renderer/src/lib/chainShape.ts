// src/renderer/src/lib/chainShape.ts
//
// 「链形状」签名与重复检测：找出"结构完全相同、只有配置值不同"的链，提示可以抽成子流程。
//
// 为什么需要它（见 docs/architecture/large-project-design.md 一、二）：
// 实测用户的 20 条指令链只有 **6 种形状**，且 20/20 共用同一个尾巴 —— 节点数的增长
// 来自"同一个形状抄了 N 遍"，不是"逻辑变复杂"。所以去重的第一步是**让重复能被看见**，
// 否则"抽子流程"永远只是专家的个人习惯。
//
// 为什么形状必须比对"数据接线"而不只是节点类型序列：
// `持久化 → 文本模板 → 发消息` 这种链，`result` 接 `var1` 和 `old_value` 接 `var1`
// 是**两种**形状 —— 只比 kind 会给出假阳性，让用户按提示抽了子流程才发现行为变了。
import type { FlowNode, FlowEdge } from '@shared/types/flow';
import {
  getExecutionChains,
  isControlEdge,
  isSubflowDefine,
  type ExecutionChain,
} from './executionOrder';
import { triggerDisplayName } from './commandList';
import { findSpec } from './nodeCatalog';

/** 一组形状完全相同的链 */
export interface ShapeGroup {
  /** 形状签名（稳定字符串；同一签名的链结构一致，配置值可不同） */
  signature: string;
  /** 形状的可读描述，如「收到消息 → 持久化操作 → 文本模板 → 发消息」 */
  shapeText: string;
  /** 组内所有链的触发器 ID（按图中先后顺序） */
  triggerIds: string[];
  /** 组内各链在界面上的叫法（`/签到` 或节点名），与顺序同上 */
  labels: string[];
}

/** 达到几条才算"值得抽"：2 条抽子流程反而更啰嗦（调用点 + 定义体），3 条起才有净收益 */
export const DUPLICATE_SHAPE_THRESHOLD = 3;

/** 配置 API 绑定边的伪源标识（与 dataflow.ts / DataBindingSelect.tsx 保持一致） */
const CONFIG_API_SOURCE = '__config_api__';

/**
 * 计算一条链的形状签名。
 *
 * 三段拼起来，缺一不可：
 * 1. **节点类型序列**（按控制流顺序，含触发器）
 * 2. **链内数据接线**：`源下标:源端口 → 目标下标:目标端口`（用下标而非节点 ID，
 *    这样"结构相同、ID 不同"的链才能对上）
 * 3. **配置绑定端口**：只记"哪个端口绑了配置表"，不记表名字段名 ——
 *    绑 skills 和绑 items 是同一个形状（表名是参数），但"绑了"和"没绑"不是
 */
function signatureOf(chain: ExecutionChain, edges: FlowEdge[], allNodes: FlowNode[]): string {
  const index = new Map(chain.sequence.map((n, i) => [n.id, i] as const));
  const kinds = chain.sequence.map((n) => n.data.nodeKind).join('>');
  const dataWires: string[] = [];
  const configPorts: string[] = [];

  for (const edge of edges) {
    if (edge.source === CONFIG_API_SOURCE && edge.configApi) {
      const target = index.get(edge.target);
      if (target !== undefined) configPorts.push(`${target}:${edge.targetPort}`);
      continue;
    }
    const source = index.get(edge.source);
    const target = index.get(edge.target);
    // 两端都在链内才算这条链的结构；跨链的边是"链之间"的关系，不是形状
    if (source === undefined || target === undefined) continue;
    if (isControlEdge(edge, allNodes)) continue;
    dataWires.push(`${source}:${edge.sourcePort}->${target}:${edge.targetPort}`);
  }

  return [kinds, dataWires.sort().join(','), configPorts.sort().join(',')].join('|');
}

/** 形状的可读描述（用节点目录里的中文名，而不是 kind） */
export function describeShape(chain: ExecutionChain): string {
  return chain.sequence.map((n) => findSpec(n.data.nodeKind)?.label ?? n.data.nodeKind).join(' → ');
}

/**
 * 找出"形状相同且达到阈值"的链。
 *
 * - 子流程定义（`subflow_defined`）不参与：它本身就是被调用方，不存在"再抽一层"
 * - 返回按组内条数从多到少排序（先看最值得抽的那一组）
 * - 阈值默认 3：见 `DUPLICATE_SHAPE_THRESHOLD`
 */
export function findDuplicateShapes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  threshold: number = DUPLICATE_SHAPE_THRESHOLD,
): ShapeGroup[] {
  const chains = getExecutionChains(nodes, edges).filter((c) => !isSubflowDefine(c.trigger));

  const buckets = new Map<string, ExecutionChain[]>();
  for (const chain of chains) {
    const signature = signatureOf(chain, edges, nodes);
    const bucket = buckets.get(signature);
    if (bucket) bucket.push(chain);
    else buckets.set(signature, [chain]);
  }

  const groups: ShapeGroup[] = [];
  for (const [signature, bucket] of buckets) {
    if (bucket.length < threshold) continue;
    groups.push({
      signature,
      shapeText: describeShape(bucket[0]),
      triggerIds: bucket.map((c) => c.trigger.id),
      labels: bucket.map((c) => triggerDisplayName(c.trigger)),
    });
  }

  return groups.sort((a, b) => b.triggerIds.length - a.triggerIds.length);
}

/** 触发器 ID → 它所在的重复形状组（清单里给每行挂标记用） */
export function mapShapesByTrigger(groups: ShapeGroup[]): Map<string, ShapeGroup> {
  const map = new Map<string, ShapeGroup>();
  for (const group of groups) {
    for (const triggerId of group.triggerIds) map.set(triggerId, group);
  }
  return map;
}
