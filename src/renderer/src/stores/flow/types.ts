// src/renderer/src/stores/flow/types.ts
//
// 恢复说明（2026-10-23）：本模块是**纯类型**文件，Vite 转换时类型被擦除、dev 缓存里没有留下
// sourcesContent（其余 ./flow/* 切片都已从 dev 缓存按原始 TS 还原）。参考 slices 与
// stores/flowStore.ts 的实际用法重建：FlowState 用宽索引签名兜住尚未逐个核对的字段，
// FlowSlice 按 zustand 切片的真实调用形状定义。逐字段收紧留待 renderer 类型化阶段
// （见 _recovery/RESTORE-NOTES.md）。
import type { FlowEdge, FlowNode, NodeGroup } from '@shared/types/flow';

/** 撤销重做快照：只含**拓扑**，分组不参与历史（见 nodeGroupSlice 头注释）。 */
export interface FlowSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 快照产生时的撤销栈深度：rollback 用它作废之后的撤销单元（见 historySlice）。 */
  historyDepth?: number;
}

/** zustand 切片的统一签名：每个切片只拿到 compose 出来的 set/get。 */
export type FlowSlice<T> = (
  set: (partial: Partial<FlowState> | ((state: FlowState) => Partial<FlowState>)) => void,
  get: () => FlowState,
  /** zustand 组合时会把 store 本体作为第三参传入；切片实现可选择不用。 */
  store?: unknown,
) => T;

/**
 * 画布 store 的完整形状。
 *
 * 字段/方法由 17 个切片合并而来；这里先保留最核心的拓扑字段并放开索引签名，
 * 让 `Pick<FlowState, 'x'>` 与跨切片读写都能编译，同时不臆造具体类型。
 */
export interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 画布上的分组框（nodeGroupSlice 所有）。注意字段名是 nodeGroups，不是 groups。 */
  nodeGroups: NodeGroup[];
  [key: string]: any;
}
