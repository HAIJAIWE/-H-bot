// src/renderer/src/services/connectionSuggester.ts
import type { FlowNode, FlowEdge, Port } from '@shared/types/flow';
import { getAllSpecs, findSpec } from '../lib/node/nodeCatalog';
import { t } from '../i18n';

/**
 * 一条"建议的连线"。
 *
 * ⚠️ 它看起来像 `suggestConnections` 的私有类型，其实**不是** ——
 * `stores/flow/types.ts` 拿它当 flow store 的公开状态类型（`suggestions: Suggestion[]`、
 * `setSuggestions / applySuggestion`）。2026-10-06 删死函数时误删过一次，tsc 当场抓出来。
 */
export interface Suggestion {
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string;
  targetHandle: string;
  confidence: number;
  label: string;
}

// ===== 阶段 7 Part D：AI 主动推荐下一步节点 =====

export interface NextNodeRecommendation {
  nodeKind: string; // 推荐的节点类型
  label: string; // 推荐节点显示名
  sourcePortId: string; // 当前节点的出口端口
  targetPortId: string; // 推荐节点的入口端口
  reason: string; // 推荐理由（如"触发器通常接动作节点"）
  confidence: number; // 0-1
}

/** 下一步推荐规则：基于当前节点 kind 决定推荐什么类型的下游节点 */
const NEXT_NODE_RULES: Record<string, { kind: string; reason: string; bonus: number }[]> = {
  // 触发器 → 通常接动作/逻辑/AI
  message_received: [
    {
      kind: 'message_send',
      get reason() {
        return t('suggest.reason.replyAfterMessage');
      },
      bonus: 0.4,
    },
    {
      kind: 'branch_if',
      get reason() {
        return t('suggest.reason.branchOnContent');
      },
      bonus: 0.3,
    },
    {
      kind: 'agent_chat',
      get reason() {
        return t('suggest.reason.handOffToAi');
      },
      bonus: 0.25,
    },
  ],
  on_command: [
    {
      kind: 'message_send',
      get reason() {
        return t('suggest.reason.replyAfterCommand');
      },
      bonus: 0.4,
    },
    {
      kind: 'branch_if',
      get reason() {
        return t('suggest.reason.branchOnArgs');
      },
      bonus: 0.3,
    },
  ],
  on_at_mention: [
    {
      kind: 'agent_chat',
      get reason() {
        return t('suggest.reason.atMeStartsAi');
      },
      bonus: 0.35,
    },
    {
      kind: 'message_send',
      get reason() {
        return t('suggest.reason.replyAfterAtMe');
      },
      bonus: 0.3,
    },
  ],
  // 分支 → 通常接动作
  branch_if: [
    {
      kind: 'message_send',
      get reason() {
        return t('suggest.reason.actionAfterBranch');
      },
      bonus: 0.35,
    },
  ],
  loop: [
    {
      kind: 'message_send',
      get reason() {
        return t('suggest.reason.actionInLoop');
      },
      bonus: 0.3,
    },
  ],
  // HTTP 请求 → 解析 JSON
  http_request: [
    {
      kind: 'json_op',
      get reason() {
        return t('suggest.reason.parseHttpResponse');
      },
      bonus: 0.4,
    },
  ],
  // AI 工具调用 → 发消息
  agent_chat: [
    {
      kind: 'message_send',
      get reason() {
        return t('suggest.reason.sendAiReply');
      },
      bonus: 0.4,
    },
  ],
};

/** 端口数据类型兼容性检查（简化版，不依赖 findCompatiblePortPairs 的 FlowNode 参数） */
function isPortCompatible(sourcePort: Port, targetPort: Port): boolean {
  // 控制流端口：control ↔ control
  if (sourcePort.kind === 'control' && targetPort.kind === 'control') return true;
  // 数据流端口：检查 dataType 兼容
  if (sourcePort.kind === 'data' && targetPort.kind === 'data') {
    const sdt = sourcePort.dataType ?? 'any';
    const tdt = targetPort.dataType ?? 'any';
    if (sdt === tdt) return true;
    if (tdt === 'any') return true;
    if (sdt === 'any') return true;
    if (sdt === 'number' && tdt === 'string') return true; // 自动转换
    return false;
  }
  return false;
}

/**
 * 阶段 7 Part D：基于当前节点上下文，推荐下一步应该接什么类型的节点。
 *
 * 算法：
 * 1. 读取当前节点的 spec.outputs（含 control + data 出口）
 * 2. 遍历 getAllSpecs() 中所有 spec（跳过自己），检查端口兼容性
 * 3. 应用 NEXT_NODE_RULES 加 confidence
 * 4. 跳过当前节点已连线的目标类型（避免重复推荐同类）
 * 5. 按 confidence 降序，返回前 5 个
 *
 * @param currentNode 当前节点
 * @param allNodes 画布所有节点（用于判断已有连线）
 * @param allEdges 画布所有边（用于判断已有连线）
 */
export function suggestNextNodes(
  currentNode: FlowNode,
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
): NextNodeRecommendation[] {
  const currentSpec = findSpec(currentNode.data.nodeKind);
  if (!currentSpec) return [];

  // 收集当前节点已连线的目标 nodeKind 集合（避免重复推荐同类）
  const connectedTargetKinds = new Set<string>();
  for (const edge of allEdges) {
    if (edge.source !== currentNode.id) continue;
    const targetNode = allNodes.find((n) => n.id === edge.target);
    if (targetNode) connectedTargetKinds.add(targetNode.data.nodeKind);
  }

  const allSpecs = getAllSpecs();
  const recommendations: NextNodeRecommendation[] = [];

  // 当前节点的出口端口
  const sourceOutputs = currentSpec.outputs ?? [];

  for (const targetSpec of allSpecs) {
    // 跳过自己
    if (targetSpec.kind === currentNode.data.nodeKind) continue;

    // 找最佳兼容端口对
    let bestSourcePort: Port | null = null;
    let bestTargetPort: Port | null = null;
    let bestScore = 0;

    for (const sourcePort of sourceOutputs) {
      for (const targetPort of targetSpec.inputs ?? []) {
        if (!isPortCompatible(sourcePort, targetPort)) continue;
        const sdt = sourcePort.dataType ?? 'any';
        const tdt = targetPort.dataType ?? 'any';
        let score = 1;
        if (sdt === tdt) score = 3;
        else if (tdt === 'any' || sdt === 'any') score = 2;
        else if (sdt === 'number' && tdt === 'string') score = 1;
        if (score > bestScore) {
          bestScore = score;
          bestSourcePort = sourcePort;
          bestTargetPort = targetPort;
        }
      }
    }

    if (!bestSourcePort || !bestTargetPort) continue;

    // 基础 confidence
    let confidence = 0.2;
    if (bestScore >= 3) confidence += 0.3;
    else if (bestScore === 2) confidence += 0.15;
    else confidence += 0.05;

    // 应用 NEXT_NODE_RULES 加成
    let reason = t('suggest.reason.portCompatible');
    const rules = NEXT_NODE_RULES[currentNode.data.nodeKind];
    if (rules) {
      const matchedRule = rules.find((r) => r.kind === targetSpec.kind);
      if (matchedRule) {
        confidence += matchedRule.bonus;
        reason = matchedRule.reason;
      }
    }

    // 已连线的目标类型降低 confidence（不阻止，但排到后面）
    if (connectedTargetKinds.has(targetSpec.kind)) {
      confidence -= 0.3;
    }

    // 限制范围
    confidence = Math.min(Math.max(confidence, 0), 1);

    recommendations.push({
      nodeKind: targetSpec.kind,
      label: targetSpec.label,
      sourcePortId: bestSourcePort.id,
      targetPortId: bestTargetPort.id,
      reason,
      confidence,
    });
  }

  // 按 confidence 降序，返回前 5 个
  return recommendations.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
