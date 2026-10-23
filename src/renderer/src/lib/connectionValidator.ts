// src/renderer/src/lib/connectionValidator.ts
//
// 连线校验的**渲染层入口** —— 规则实现已合并到 `@shared/nodes/connectionIssues`，这里只做形状适配。
//
// 事故（本轮合并的原因）：这里原来是第二套独立引擎，规则集与主进程的 `flowNormalize.validateFlow`
// **互不包含**：主侧查 kind/端口/必填配置/可达性，这里查 重复边/控制环/必填端口未连/孤立节点。
// 同一份 246 节点的流程，画布右下角显示「61 个警告 + 1 个提示」，工具栏却显示「43 个提醒」——
// 用户看到哪个数字取决于看哪里。现在两侧都调同一个引擎，数字必然一致。
import type { FlowNode, FlowEdge, Port } from '@shared/types/flow';
import { validateFlow } from '@shared/nodes/flowNormalize';
import { t } from '../i18n';
import {
  CONNECTION_ERROR_CODES,
  isDataTypeCompatible,
  wouldCreateControlLoop,
  edgePortId,
  type ConnectionIssueLevel,
} from '@shared/nodes/connectionIssues';

export interface ValidationIssue {
  level: ConnectionIssueLevel;
  code: string;
  message: string;
  nodeId?: string;
  fixHint?: string;
  autoFix?: () => void;
}

export interface ConnectionValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  sourceNode?: FlowNode;
  targetNode?: FlowNode;
  sourcePort?: Port;
  targetPort?: Port;
}

const ERROR_CODES = CONNECTION_ERROR_CODES;

/**
 * 拖一条线时的**实时**校验（只看这一条候选边，不扫全图）。
 *
 * 与 `validateGraph` 共用同一套规则常量与判定函数，避免"拖的时候说能连、校验的时候说有问题"。
 */
export function validateConnection(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  sourcePort: Port,
  targetPort: Port,
  existingEdges: FlowEdge[],
): ConnectionValidationResult {
  const issues: ValidationIssue[] = [];

  if (sourceNode.id === targetNode.id) {
    issues.push({
      level: 'error',
      code: ERROR_CODES.SAME_NODE,
      message: t('validation.sameNode'),
      fixHint: t('validation.sameNodeHint'),
    });
  }

  if (sourcePort.kind !== targetPort.kind) {
    issues.push({
      level: 'error',
      code: ERROR_CODES.WRONG_PORT_KIND,
      message: t('validation.portKindMismatch', { source: sourcePort.kind, target: targetPort.kind }),
      fixHint: t('validation.portKindHint'),
    });
  }

  if (targetNode.type === 'trigger') {
    issues.push({
      level: 'error',
      code: ERROR_CODES.TRIGGER_CANNOT_BE_TARGET,
      message: t('validation.triggerAsTarget'),
      fixHint: t('validation.triggerAsTargetHint'),
    });
  }

  if (sourcePort.kind === 'data' && targetPort.kind === 'data') {
    const sourceDt = sourcePort.dataType ?? 'any';
    const targetDt = targetPort.dataType ?? 'any';
    if (!isDataTypeCompatible(sourceDt, targetDt)) {
      issues.push({
        level: 'error',
        code: ERROR_CODES.DATA_TYPE_MISMATCH,
        message: t('validation.dataTypeMismatch', { source: sourceDt, target: targetDt }),
        fixHint: t('validation.dataTypeMismatchHint', { source: sourceDt, target: targetDt }),
      });
    }
  }

  const duplicate = existingEdges.some(
    (e) =>
      e.source === sourceNode.id &&
      e.target === targetNode.id &&
      edgePortId(e, 'source') === sourcePort.id &&
      edgePortId(e, 'target') === targetPort.id,
  );
  if (duplicate) {
    issues.push({
      level: 'warning',
      code: ERROR_CODES.DUPLICATE_EDGE,
      message: t('validation.duplicateEdge'),
      fixHint: t('validation.duplicateEdgeHint'),
    });
  }

  if (sourcePort.kind === 'control' && targetPort.kind === 'control') {
    const nodesById = new Map<string, FlowNode>([
      [sourceNode.id, sourceNode],
      [targetNode.id, targetNode],
    ]);
    if (wouldCreateControlLoop(sourceNode, targetNode, existingEdges, nodesById)) {
      issues.push({
        level: 'warning',
        code: ERROR_CODES.CONTROL_LOOP,
        message: t('validation.controlLoop'),
        fixHint: t('validation.controlLoopHint'),
      });
    }
  }

  if (targetPort.kind === 'data' && targetPort.required) {
    const hasIncoming = existingEdges.some(
      (e) => e.target === targetNode.id && edgePortId(e, 'target') === targetPort.id,
    );
    if (!hasIncoming) {
      issues.push({
        level: 'warning',
        code: ERROR_CODES.MISSING_REQUIRED_INPUT,
        message: t('validation.missingRequiredInput', { name: targetPort.name }),
        fixHint: t('validation.missingRequiredInputHint'),
      });
    }
  }

  return {
    valid: !issues.some((i) => i.level === 'error'),
    issues,
    sourceNode,
    targetNode,
    sourcePort,
    targetPort,
  };
}

/**
 * 扫全图：**直接复用主进程那套统一规则**（结构 + 连线），因此与工具栏「问题」按钮同源同数。
 */
export function validateGraph(nodes: FlowNode[], edges: FlowEdge[]): ValidationIssue[] {
  const issues = validateFlow({ nodes, edges } as unknown as Parameters<typeof validateFlow>[0]);
  return issues.map((i) => ({
    level: i.severity,
    code: i.code,
    message: i.message,
    nodeId: i.nodeId,
    fixHint: i.fixHint,
  }));
}

export function getValidationSummary(issues: ValidationIssue[]): string {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  const infos = issues.filter((i) => i.level === 'info').length;

  const parts: string[] = [];
  if (errors) parts.push(t('validation.summaryErrors', { count: errors }));
  if (warnings) parts.push(t('validation.summaryWarnings', { count: warnings }));
  if (infos) parts.push(t('validation.summaryInfos', { count: infos }));

  return parts.join(' · ') || t('blocks.editor.noIssues');
}
