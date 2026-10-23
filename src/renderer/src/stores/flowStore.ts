// src/renderer/src/stores/flowStore.ts
//
// flowStore 的**唯一对外出口**（barrel）。
//
// 2026-10-01 结构债 P3-2：原来这里是一个 2,185 行、横跨 14 类职责的上帝 store。
// 现在按域拆到 `./flow/*` 的 zustand slices，本文件只做三件事：
//   1. 把切片组装成同一个 store（`create<FlowState>`）；
//   2. re-export 组件与测试依赖的公开符号（hook 与纯函数）；
//   3. 安装/卸载自动保存。
//
// **对外 API 完全不变**：组件仍然 `import { useFlowStore, parseErrorFieldKey } from '.../stores/flowStore'`，
// selector 形状逐字段不变（tests/renderer/zustandSelectorShape.test.ts 盯着），因此组件一行都不用改。
// 模块级可变状态（撤销栈 `_past/_future`、运行时错误账本、自动保存定时器）全部保持**单例**：
// 它们只在 ./flow 下的对应模块里存在一份，切片只是 import 引用。
import { create } from 'zustand';
import type { FlowNode } from '@shared/types/flow';
import { findSpec } from '../lib/node/nodeCatalog';
import { findFieldKeyByLabel } from '../i18n/fieldLabels';
import { createGraphSlice } from './flow/graphSlice';
import { createNodeSlice } from './flow/nodeSlice';
import { createSystemSlice } from './flow/systemSlice';
import { createSelectionSlice } from './flow/selectionSlice';
import { createHistorySlice } from './flow/historySlice';
import { createPersistenceSlice } from './flow/persistenceSlice';
import { createValidationSlice } from './flow/validationSlice';
import { createRuntimeSlice } from './flow/runtimeSlice';
import { createSuggestionSlice } from './flow/suggestionSlice';
import { createNodeGroupSlice } from './flow/nodeGroupSlice';
import { createClipboardSlice } from './flow/clipboardSlice';
import { createTemplateSlice } from './flow/templateSlice';
import { createSubflowSlice } from './flow/subflowSlice';
import { createLayoutSlice } from './flow/layoutSlice';
import { createAiRequestSlice } from './flow/aiRequestSlice';
import { setHistorySync } from './flow/historyStack';
import {
  bindFlowStoreForPersistence,
  cancelPendingAutoSaveForTesting,
  installFlowPersistence as installFlowPersistenceImpl,
} from './flow/persistence';
import type { FlowState } from './flow/types';

// 历史批量抑制的入口由调用方（BlockEditor / PropertyDrawer / ExpressionVarHelper）与测试使用，
// 这里原样 re-export，保证 import 路径不变。
export { beginHistoryBatch, endHistoryBatch, pushHistoryPoint } from './flow/historyStack';
export type { FlowSnapshot } from './flow/types';

/**
 * 解析错误消息里的**字段显示名**，还原成 config key。
 *
 * 文案形如 `「{字段名}」为必填` / `主动推送时需填写「{字段名}」或绑定上游数据`。
 * 阶段 7 Part A：用于错误节点一键修复 → 跳转 PropertyDrawer 对应字段。
 */
export function parseErrorFieldKey(
  errorMessage: string,
  preferKeys?: readonly string[],
): string | null {
  // 只取**第一个「」引号内的片段**，因此规则与语言无关：中英文译文只要保留
  // `「{field}」` 这个占位（周围散文随便翻）就能正确反解。早期这里还额外匹配
  // 中文短语「需填写「…」」，英文界面下会失配 → 静默丢掉「点错误条跳字段」。
  // 该不变量由 tests/renderer/i18n/validationFieldParse.test.ts 在两种语言下断言。
  const match = errorMessage.match(/「([^」]+)」/);
  if (match) return findFieldKeyByLabel(match[1], preferKeys);
  return null;
}

/** 返回节点首个错误的字段 key（用于跳转 PropertyDrawer 高亮）。
 *  阶段 7 Part A。 */
export function getFirstErrorField(
  nodeId: string,
  nodes: FlowNode[],
  nodeErrors: Record<string, string[]>,
): string | null {
  const errors = nodeErrors[nodeId];
  if (!errors || errors.length === 0) return null;
  // 用「该节点真实拥有的字段」消歧：有几个不同字段共用同一显示名
  // （「条件」= condition/expression、「表名」= table/tableName 等），
  // 不传的话可能跳到该节点上并不存在的字段。
  const node = nodes.find((n) => n.id === nodeId);
  return parseErrorFieldKey(errors[0], node ? nodeFieldKeys(node) : undefined);
}

/** 节点真实拥有的配置字段：目录里的数据输入端口 id + config 里已有的键 */
function nodeFieldKeys(node: FlowNode): string[] {
  const spec = findSpec(node.data.nodeKind);
  const fromSpec = (spec?.inputs ?? []).filter((p) => p.kind === 'data').map((p) => p.id);
  return [...new Set([...fromSpec, ...Object.keys(node.data.config ?? {})])];
}

// 组装：每个切片只声明自己拥有的字段，全部 spread 进来后由 TS 校验 FlowState 完整性
// （漏拆一个域会编译失败，而不是静默 undefined）。所有切片共享同一个 set/get。
export const useFlowStore = create<FlowState>((set, get, store) => ({
  ...createGraphSlice(set, get, store),
  ...createNodeSlice(set, get, store),
  ...createSystemSlice(set, get, store),
  ...createSelectionSlice(set, get, store),
  ...createHistorySlice(set, get, store),
  ...createPersistenceSlice(set, get, store),
  ...createValidationSlice(set, get, store),
  ...createRuntimeSlice(set, get, store),
  ...createSuggestionSlice(set, get, store),
  ...createNodeGroupSlice(set, get, store),
  ...createClipboardSlice(set, get, store),
  ...createTemplateSlice(set, get, store),
  ...createSubflowSlice(set, get, store),
  ...createLayoutSlice(set, get, store),
  ...createAiRequestSlice(set, get, store),
}));

// 创建之后立刻接线：历史深度镜像 + 自动保存的 store 引用。
// 两者都只操作模块级单例，必须在任何方法被调用前完成。
setHistorySync((undoDepth, redoDepth) => useFlowStore.setState({ undoDepth, redoDepth }));
bindFlowStoreForPersistence(useFlowStore);

/** 安装自动保存 + Ctrl+S（应用入口调用一次）；返回卸载函数。实现见 ./flow/persistence。 */
export function installFlowPersistence(): () => void {
  return installFlowPersistenceImpl();
}

/** 测试用：清掉待执行的自动保存定时器与加载静默窗口 */
export function _cancelAutoSaveForTesting(): void {
  cancelPendingAutoSaveForTesting();
}
