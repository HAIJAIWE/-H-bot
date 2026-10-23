// src/renderer/src/lib/canvas/portMatcher.ts
import type { Port, FlowNode, FlowEdge } from '@shared/types/flow';
import { canConnect } from './flowValidation';

export interface MatchedPortPair {
  sourcePort: Port;
  targetPort: Port;
  score: number;
}

export interface NodeMatchResult {
  node: FlowNode;
  matchedPorts: MatchedPortPair[];
  bestScore: number;
}

// Compatibility map: source dataType → compatible target dataTypes
const COMPATIBILITY_MAP: Record<string, string[]> = {
  string: ['string', 'any'],
  number: ['number', 'any', 'string'], // number → string auto-convert
  boolean: ['boolean', 'any'],
  object: ['object', 'any'],
  any: ['any', 'string', 'number', 'boolean', 'object'],
  event: ['event', 'any'],
  list: ['list', 'any'],
  datetime: ['datetime', 'any'],
};

function getScore(sourceDt: string, targetDt: string): number {
  if (sourceDt === targetDt) return 3; // exact match
  if (targetDt === 'any') return 2; // target accepts anything
  if (sourceDt === 'number' && targetDt === 'string') return 1; // auto-convert
  return 0; // incompatible
}

function getDataType(port: Port): string {
  return port.dataType ?? 'any';
}

/**
 * Find all compatible data port pairs between a source node's outputs and a target node's inputs.
 * Returns results sorted by match score (best first).
 */
export function findCompatiblePortPairs(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  existingEdges: FlowEdge[],
): MatchedPortPair[] {
  const results: MatchedPortPair[] = [];

  for (const outPort of sourceNode.data.outputs) {
    if (outPort.kind !== 'data') continue;

    for (const inPort of targetNode.data.inputs) {
      if (inPort.kind !== 'data') continue;

      const sourceDt = getDataType(outPort);
      const targetDt = getDataType(inPort);
      const compatible = COMPATIBILITY_MAP[sourceDt];

      if (!compatible?.includes(targetDt)) continue;

      if (
        !canConnect(
          { nodeId: sourceNode.id, port: outPort },
          { nodeId: targetNode.id, port: inPort },
          existingEdges,
        )
      )
        continue;

      const score = getScore(sourceDt, targetDt);
      if (score > 0) {
        results.push({
          sourcePort: outPort,
          targetPort: inPort,
          score,
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Find all nodes that can receive a connection from the given source node.
 */
export function findCompatibleTargets(
  sourceNode: FlowNode,
  allNodes: FlowNode[],
  existingEdges: FlowEdge[],
): NodeMatchResult[] {
  const results: NodeMatchResult[] = [];

  for (const targetNode of allNodes) {
    if (targetNode.id === sourceNode.id) continue;

    const matchedPorts = findCompatiblePortPairs(sourceNode, targetNode, existingEdges);
    if (matchedPorts.length > 0) {
      results.push({
        node: targetNode,
        matchedPorts,
        bestScore: matchedPorts[0].score,
      });
    }
  }

  return results.sort((a, b) => b.bestScore - a.bestScore);
}

/**
 * Find all nodes that can connect into the given target node.
 */
export function findCompatibleSources(
  targetNode: FlowNode,
  allNodes: FlowNode[],
  existingEdges: FlowEdge[],
): NodeMatchResult[] {
  const results: NodeMatchResult[] = [];

  for (const sourceNode of allNodes) {
    if (sourceNode.id === targetNode.id) continue;

    const matchedPorts = findCompatiblePortPairs(sourceNode, targetNode, existingEdges);
    if (matchedPorts.length > 0) {
      results.push({
        node: sourceNode,
        matchedPorts,
        bestScore: matchedPorts[0].score,
      });
    }
  }

  return results.sort((a, b) => b.bestScore - a.bestScore);
}

// `findAutoSuggestions` 已删除（2026-10-06）：它只服务于「连线建议」浮层，
// 那个浮层会给画布上每一对可接端口列一条、铺满屏幕（用户："太影响了，而且也不需要这个"）。
// 需要时从 git 历史取回，不要在库里留僵尸导出。
