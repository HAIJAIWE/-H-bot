// src/renderer/src/lib/nodeFactory.ts
import type { FlowNode, FlowEdge } from '@shared/types/flow';
import { toPlainPorts } from '@shared/nodes/portUtils';
import { getCanonicalNodeLabel } from '@shared/nodes/catalog/registry';
import { findSpec } from './nodeCatalog';
import { t } from '../i18n';

let nodeCounter = 0;

/**
 * 根据已有节点 ID 计算下一个可用 ID（避免刷新后新节点 ID 与已加载节点冲突）。
 * 形如 `n12` 的 ID 解析数字部分，取最大值 +1 作为新计数起点。
 */
function syncCounterFromExisting(nodes: FlowNode[]): void {
  let maxNum = 0;
  for (const n of nodes) {
    const m = n.id?.match(/^n(\d+)$/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  if (maxNum >= nodeCounter) nodeCounter = maxNum;
}

export function createNode(
  kind: string,
  position: { x: number; y: number },
  /** 已有节点列表（可选）：用于同步计数器，避免新节点 ID 与已加载节点冲突 */
  existingNodes?: FlowNode[],
): FlowNode {
  const spec = findSpec(kind);
  if (!spec) throw new Error(t('lib.unknownNodeKind', { kind }));

  // 若调用方提供了已有节点列表，先同步计数器（防止打开旧流程图后新建 n1 与已存在 n1 冲突）
  if (existingNodes && existingNodes.length > 0) {
    syncCounterFromExisting(existingNodes);
  }

  nodeCounter += 1;
  const id = `n${nodeCounter}`;

  return {
    id,
    type: spec.type,
    position,
    data: {
      // 落盘用**规范名（恒 zh-CN）**，不用 spec.label（那是当前语言）：
      // 否则英文界面下新建节点会把英文写进用户的 flow.json，同一份流程中英混杂，
      // 生成代码注释的语言还会随"建节点时的界面语言"漂移。
      // 界面显示走 nodeDisplayLabel()（按当前语言取），见 lib/nodeCatalog.ts。
      label: getCanonicalNodeLabel(kind) ?? spec.label,
      nodeKind: spec.kind,
      // 深拷贝 defaultConfig：避免嵌套对象（如 message_send 的 keyboard、message_received 的 keywords）
      // 被多个节点共享引用，导致修改一个节点时影响其他节点
      config: JSON.parse(JSON.stringify(spec.defaultConfig)),
      // 端口必须脱函数（showWhen）：节点会进撤销历史的 structuredClone，
      // 带函数会直接抛 DataCloneError，导致"加节点/连线即崩"（实测踩到过）
      inputs: toPlainPorts(spec.inputs),
      outputs: toPlainPorts(spec.outputs),
    },
  };
}

/**
 * 显式同步全局节点计数器（在加载已有流程图后调用一次即可）。
 * 后续 createNode 不必每次传 existingNodes。
 */
export function syncNodeCounter(nodes: FlowNode[]): void {
  syncCounterFromExisting(nodes);
}

export function createEdge(
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): FlowEdge {
  const id = `edge_${sourceNodeId}_${sourcePortId}__${targetNodeId}_${targetPortId}`;
  return {
    id,
    source: sourceNodeId,
    sourcePort: sourcePortId,
    target: targetNodeId,
    targetPort: targetPortId,
    sourceHandle: `${sourceNodeId}__${sourcePortId}`,
    targetHandle: `${targetNodeId}__${targetPortId}`,
  };
}
