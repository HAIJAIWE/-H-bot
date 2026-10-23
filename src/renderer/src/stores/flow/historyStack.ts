// src/renderer/src/stores/flow/historyStack.ts
//
// 撤销/重做的**模块级历史栈**（从 flowStore.ts 原样搬出）。
//
// 关键不变量：这仍然是**同一个实例**。拆分只是换了文件，`_past/_future/_batchDepth`
// 依然只有这一份；undo、pushHistory、snapshot、rollback 全部读写这两个数组。
// 复制成两份会让"压历史"和"撤销"各说各话，所以这里**只导出引用，不做任何包装拷贝**。
//
// 历史语义（与拆分前逐字一致）：
// - 快照仅含 nodes/edges（分组/系统/选择态不进历史，约定：撤销不还原分组归属）。
// - 大图快照体积大，按节点数动态缩减历史深度。
// - `_batchDepth`：批量操作期间抑制逐条 pushHistory，成功后再整体压一次。
import type { FlowNode, FlowEdge } from '@shared/types/flow';
import type { FlowSnapshot } from './types';

export const _past: FlowSnapshot[] = [];
export const _future: FlowSnapshot[] = [];
const MAX_HISTORY = 50;
let _batchDepth = 0;

/**
 * 把模块级历史栈深度同步进 store 状态（响应式驱动撤销/重做按钮 disabled）。
 *
 * 为什么用注入回调而不是直接 import useFlowStore：flowStore.ts 要 import 本模块来组装
 * store，本模块再反向 import 会形成循环。`_sync` 在 flowStore.ts 创建 store 后立刻绑定，
 * 历史操作都发生在绑定之后。
 *
 * 为什么 queueMicrotask：pushHistory 会在外层 set() 更新器内被调用，此时直接 setState
 * 会被尚未完成的外层 set 覆盖，故延迟到当前同步流程结束后再写。
 */
type HistorySync = (undoDepth: number, redoDepth: number) => void;
// ⚠️ 2026-10-02 审查发现：默认值原来是 `() => {}`（静默 no-op）。
// 一旦绑定没发生，undoDepth/redoDepth 就永远不更新 → **撤销/重做按钮永久 disabled**，
// 而且没有任何报错可查 —— 典型的"静默失效"。改成 null + 显式告警。
let _sync: HistorySync | null = null;
/** 只告警一次：本函数在每次历史操作后都会跑，不能刷屏 */
let syncUnboundWarned = false;

/** 由 flowStore.ts 在 create() 之后调用，把深度镜像写回 store。 */
export function setHistorySync(fn: HistorySync): void {
  _sync = fn;
}

/** 供 undo/redo/pushHistory 等调用（等价于原来的 `_syncHistoryState`）。 */
export function _syncHistoryState(): void {
  queueMicrotask(() => {
    if (!_sync) {
      // 这里用 console.error 而不是 throw：本函数是在外层 set() 的 microtask 里跑的，
      // 抛出去会变成"未捕获的异步错误"，现场离真正的原因（绑定顺序）很远。
      if (!syncUnboundWarned) {
        syncUnboundWarned = true;
        // 开发者诊断信息（不是界面文案）：按 i18n 闸门要求，本目录内不写中文串
        console.error(
          '[flowStore] history sync callback is not bound (setHistorySync never ran): ' +
            'undo/redo availability will never update',
        );
      }
      return;
    }
    _sync(_past.length, _future.length);
  });
}

/**
 * 撤销历史的深拷贝。
 *
 * `structuredClone` 无法克隆函数 —— 曾经因为端口对象里带了 `showWhen` 函数，
 * 每次加节点/连线都抛 `DataCloneError: … could not be cloned`（整块画布不能操作）。
 * 端口脱函数已在 `@shared/nodes/portUtils` 统一处理；这里再兜一层：真出了不可克隆
 * 的东西也只降级为"历史少了函数字段"，而不是让编辑操作直接失败（同时留一条告警便于定位）。
 */
function cloneForHistory<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (e) {
    console.warn('[flowStore] 撤销历史快照含不可克隆内容，已降级为 JSON 深拷贝:', e);
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

/**
 * 压入一个撤销点。
 *
 * @returns **是否真的压入了**：批量抑制段内（`_batchDepth > 0`）会静默跳过并返回 false。
 *   调用方若需要"配对的回退"（如 beginDragHistory/cancelDragHistory），必须依据这个返回值，
 *   否则会 pop 掉更早的一个合法撤销点（2026-10-02 审查发现）。
 */
export function pushHistory(nodes: FlowNode[], edges: FlowEdge[]): boolean {
  if (_batchDepth > 0) return false;
  _past.push({ nodes: cloneForHistory(nodes), edges: cloneForHistory(edges) });
  const limit = nodes.length > 200 ? 20 : nodes.length > 80 ? 30 : MAX_HISTORY;
  if (_past.length > limit) _past.shift();
  _future.length = 0;
  _syncHistoryState();
  return true;
}

/** 进入批量抑制段（可嵌套）。批量期间所有 pushHistory 被跳过。 */
export function beginHistoryBatch(): void {
  _batchDepth++;
}

/** 退出批量抑制段。调用方应在退出后手动压入批前快照作为整体撤销单元。 */
export function endHistoryBatch(): void {
  if (_batchDepth > 0) _batchDepth--;
}

/** 显式压入一个撤销点（批量成功后把批前快照作为单一撤销单元）。 */
export function pushHistoryPoint(nodes: FlowNode[], edges: FlowEdge[]): void {
  pushHistory(nodes, edges);
}

export function clearHistory(): void {
  _past.length = 0;
  _future.length = 0;
  _syncHistoryState();
}
