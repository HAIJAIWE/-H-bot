// src/shared/nodes/controlPorts.ts
//
// **控制流端口的判定规则**（单一来源）。
//
// ## 为什么要有这个文件（2026-10-15 分歧探测器抓到）
//
// 主进程的「预览」与渲染层的「真应用」都要判断「这条边是不是控制流边」——
// 但规则原先**只写在渲染层**（lib/canvas/executionOrder.ts），主进程没法 import，
// 于是它在 pendingGraph 里自己抄了一份**正则白名单**：
//
//     /^(next|out|true|false|body|done|try|catch|finally)$/
//
// 两份规则一旦有一方加了口子（比如新节点引入新的控制出口名），预览与真应用就会
// 对同一次操作得出不同结论：一边认为「出口不许分叉」、另一边允许 —— 用户看到的就是
// 「预览里接对了，点应用之后画布上多了两条线，运行时只有一条生效」。
//
// 所以搬到这里：**两边都读这一份**。渲染层的 executionOrder.ts 保留同名再导出，
// 现有调用方不需要改。
import type { FlowNode } from '@shared/types/flow';

/** 控制流入口端口名（端口定义缺失时的回退推断用） */
export const CONTROL_INPUT_NAMES = new Set(['in']);

/** 控制流端口名集合。覆盖所有内置节点的控制出口：
 *  - next/out：通用顺序出口
 *  - true/false：branch_if 条件分支
 *  - body/done：loop 循环体/完成
 *  - try/catch/finally：try_catch 三分支
 *  注：branch_switch 的动态分支端口（case label）不在此列 —— 其 outputs 里只有 out 是 control。
 */
export const CONTROL_PORT_NAMES = new Set([
  'next',
  'out',
  'true',
  'false',
  'body',
  'done',
  'try',
  'catch',
  'finally',
]);

/** 端口名是不是控制流端口 */
export function isControlPortName(portName: string): boolean {
  return CONTROL_PORT_NAMES.has(portName);
}

/** 边是不是控制流边（任一端是控制口即算） */
export function isControlEdgeByName(edge: { sourcePort: string; targetPort: string }): boolean {
  return CONTROL_PORT_NAMES.has(edge.sourcePort) || CONTROL_PORT_NAMES.has(edge.targetPort);
}

/**
 * 取节点的控制流入口端口。大多数节点只有一个控制入口；触发器没有。
 * 端口定义缺失时（如模板节点）按端口名回退推断。
 */
export function getControlInput(node: FlowNode): { portId: string } | null {
  const port = node.data.inputs.find((p) => p.kind === 'control');
  if (port) return { portId: port.id };
  if (node.data.inputs.length === 0) return null;
  const fallback = node.data.inputs.find((p) => CONTROL_INPUT_NAMES.has(p.id));
  return fallback ? { portId: fallback.id } : null;
}
