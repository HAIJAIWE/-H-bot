// src/renderer/src/stores/flow/persistence.ts
//
// 自动保存（落盘时机）的**模块级状态与安装逻辑**。
//
// 背景（本轮实测确认）：低代码里拖节点、改配置都只存在内存里，磁盘上的
// `.qqbat/flow.json` 只有点「生成代码」时才会被写。于是：
//   ① 搭完流程直接关窗口 = 全白干；
//   ② 改完直接点「运行」= 解释器读的还是旧文件。
//
// 这里做三件事：改动后 1.5 秒防抖自动保存；Ctrl+S 立即保存；启动机器人前兜底保存（见 botStore）。
// 自动保存只在真正 Electron 环境安装（应用入口调用 installFlowPersistence），
// 测试环境不调用就没有定时器，不会影响既有用例。
//
// 为什么用"绑定 store"而不是 import useFlowStore：flowStore.ts 要 import 本模块，
// 反向 import 会形成循环。flowStore.ts 在 create() 之后立刻 bindFlowStoreForPersistence，
// 所有安装/加载标记都发生在绑定之后。定时器、抑制窗口、revision 都是**单例**：
// 只有这一份，不能复制。
import type { FlowState } from './types';

/** flowStore 的最小 API 面（只用到订阅/读状态/写状态，避免整包类型耦合）。 */
interface FlowStoreApi {
  getState: () => FlowState;
  setState: (partial: Partial<FlowState>) => void;
  subscribe: (listener: (state: FlowState, prev: FlowState) => void) => () => void;
}

// ⚠️ 2026-10-02 审查发现：这里原来是 `let store!: FlowStoreApi`（definite assignment）。
// 它把"绑定顺序"变成一个**没有任何运行时保障**的隐式约定：一旦有人让 markGraphLoaded() /
// installFlowPersistence() 早于 bind 执行，前者会在 setState 上抛 TypeError、
// 后者是 `subscribe of undefined`，而错误现场离真正的原因（绑定没做/顺序错了）很远。
// 换成显式判空 + 指名错误。
let store: FlowStoreApi | null = null;

/** 由 flowStore.ts 在创建 store 后调用一次。 */
export function bindFlowStoreForPersistence(api: FlowStoreApi): void {
  store = api;
}

/** 取已绑定的 store；未绑定即抛出指出原因的错误（而不是 undefined 上的 TypeError） */
function requireStore(): FlowStoreApi {
  if (!store) {
    // 开发者诊断信息（不是界面文案）：按 i18n 闸门要求，本目录内不写中文串
    throw new Error(
      'flowStore persistence is not bound: bindFlowStoreForPersistence() has not run, ' +
        'or ran after this call',
    );
  }
  return store;
}

/** 图修订号：每次 nodes/edges/nodeGroups/systems 变化 +1（模块内，不进 UI 状态） */
let flowRevision = 0;
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let persistenceInstalled = false;
/**
 * 加载/重置项目后的静默窗口：这期间的图变化（补全端口、清理无效边）都不算用户改动。
 * 3 秒足够覆盖加载 + 首帧布局，又远小于"用户打开项目后动手改"的间隔。
 */
let suppressEditUntil = 0;

/** 防抖时长：太短会边拖边写盘，太长会丢掉最后几步 */
const AUTO_SAVE_DEBOUNCE_MS = 1500;
const LOAD_SUPPRESS_MS = 3000;

/** saveNow 需要读修订号判断"保存期间是否又有改动"，因此只暴露读。 */
export function getFlowRevision(): number {
  return flowRevision;
}

/**
 * 标记"图刚被整体换过"（加载/重置项目）。
 *
 * 调用后一小段时间内的图变化不计入"用户改动"，并把脏标记清掉 —— 防止打开项目就触发写盘。
 */
export function markGraphLoaded(): void {
  suppressEditUntil = Date.now() + LOAD_SUPPRESS_MS;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (persistenceInstalled) requireStore().setState({ dirty: false, lastSavedAt: 0 });
}

/** 安装自动保存 + Ctrl+S（应用入口调用一次）；返回卸载函数 */
export function installFlowPersistence(): () => void {
  if (persistenceInstalled || typeof window === 'undefined') return () => {};
  persistenceInstalled = true;
  const api = requireStore();

  const unsubscribe = api.subscribe((state, prev) => {
    if (
      state.nodes === prev.nodes &&
      state.edges === prev.edges &&
      state.nodeGroups === prev.nodeGroups &&
      state.systems === prev.systems
    ) {
      return; // 只有选择/日志等非图状态变化，不算"改动"
    }
    // 加载/重置项目引起的图变化：不算用户改动，也不写盘
    if (Date.now() < suppressEditUntil) {
      if (state.dirty) api.setState({ dirty: false });
      return;
    }
    flowRevision++;
    if (!state.dirty) api.setState({ dirty: true });
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void api.getState().saveNow(undefined, { reason: 'auto' });
    }, AUTO_SAVE_DEBOUNCE_MS);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      void api.getState().saveNow(undefined, { reason: 'manual' });
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKeyDown);
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    persistenceInstalled = false;
  };
}

/** 测试用核心：清掉待执行的自动保存定时器与加载静默窗口（flowStore.ts 的
 *  `_cancelAutoSaveForTesting` 直接转调它，保证那个出口仍在 flowStore 上）。 */
export function cancelPendingAutoSaveForTesting(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  suppressEditUntil = 0;
}
