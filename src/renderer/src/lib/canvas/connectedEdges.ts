// src/renderer/src/lib/canvas/connectedEdges.ts
//
// 找"连到这个节点的这个端口"的边 —— 画布上悬停端口时那一栏「谁连到这里 / 连到谁」用它。
//
// ## 为什么按「节点 + 端口」找，而不是按 handle（2026-09-26 修）
//
// 这个功能原来比的是 `edge.targetHandle === `${节点id}__${端口id}``。而画布上真正渲染的
// handle id 是 `encodeHandleId` 那一套：`${端口类型}__${端口id}`（`control__in`、`data__var1`）。
// **两套约定永远不相等** —— 于是这一栏**对所有边都不显示**（不是只对某几条）。
//
// 磁盘上的 handle 数据还有三种状态：正确、写成了节点 id（早期脚本）、压根没有
// （真机 357 条里有 212 条没有）。所以这里彻底不看 handle，只按 `source/target + 端口` 匹配 ——
// 任何历史数据、任何项目都能显示。
//
// `edge.sourceHandle/targetHandle` 因此降级为**仅供参考**（渲染时由 `toReactFlowEdges`
// 按端口类型重新算），不要再有逻辑建立在它们上面。
export interface EdgeLike {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

/** 连到 `nodeId` 的 `portId` 上的边（`isInput` 决定看入边还是出边） */
export function findEdgesOnPort<T extends EdgeLike>(
  edges: T[],
  nodeId: string,
  portId: string,
  isInput: boolean,
): T[] {
  return edges.filter((e) =>
    isInput
      ? e.target === nodeId && e.targetPort === portId
      : e.source === nodeId && e.sourcePort === portId,
  );
}
