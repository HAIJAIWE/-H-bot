// src/renderer/src/stores/debugStore.ts
import { create } from 'zustand';
import type { Breakpoint, DebugState } from '@shared/types/debug';
import { t } from '../i18n';

interface DebugStoreState {
  /** 断点列表 */
  breakpoints: Breakpoint[];
  /** 当前调试状态 */
  debugState: DebugState;
  /** 调试是否活跃 */
  isDebugging: boolean;
  /** 调试错误信息（startDebug 失败时设置，UI 层应读取并 toast 显示） */
  error: string | null;

  // 动作
  setBreakpoints: (bps: Breakpoint[]) => void;
  addBreakpoint: (nodeId: string) => void;
  removeBreakpoint: (nodeId: string) => void;
  toggleBreakpoint: (nodeId: string) => void;
  hasBreakpoint: (nodeId: string) => boolean;
  setDebugState: (state: DebugState) => void;
  clearError: () => void;

  // IPC 操作
  startDebug: (projectPath: string) => Promise<void>;
  stepOver: () => Promise<void>;
  stepInto: () => Promise<void>;
  stepOut: () => Promise<void>;
  continue: () => Promise<void>;
  pause: () => Promise<void>;
  stopDebug: () => Promise<void>;
  syncBreakpoints: () => Promise<void>;

  // 事件订阅
  initDebugListener: () => () => void;
}

export const useDebugStore = create<DebugStoreState>((set, get) => ({
  breakpoints: [],
  debugState: { status: 'idle', variables: [], callStack: [] },
  isDebugging: false,
  error: null,

  setBreakpoints: (bps) => set({ breakpoints: bps }),

  addBreakpoint: (nodeId) => {
    const { breakpoints } = get();
    if (breakpoints.some((bp) => bp.nodeId === nodeId)) return;
    const newBp: Breakpoint = { nodeId, enabled: true };
    set({ breakpoints: [...breakpoints, newBp] });
    get().syncBreakpoints();
  },

  removeBreakpoint: (nodeId) => {
    set((s) => ({
      breakpoints: s.breakpoints.filter((bp) => bp.nodeId !== nodeId),
    }));
    get().syncBreakpoints();
  },

  toggleBreakpoint: (nodeId) => {
    set((s) => {
      const existing = s.breakpoints.find((bp) => bp.nodeId === nodeId);
      if (existing) {
        return {
          breakpoints: s.breakpoints.map((bp) =>
            bp.nodeId === nodeId ? { ...bp, enabled: !bp.enabled } : bp,
          ),
        };
      }
      return { breakpoints: [...s.breakpoints, { nodeId, enabled: true }] };
    });
    get().syncBreakpoints();
  },

  hasBreakpoint: (nodeId) => {
    return get().breakpoints.some((bp) => bp.nodeId === nodeId && bp.enabled);
  },

  setDebugState: (debugState) => {
    set({
      debugState,
      isDebugging: debugState.status !== 'idle',
    });
  },

  clearError: () => set({ error: null }),

  startDebug: async (projectPath: string) => {
    // 原实现失败时静默返回，用户无反馈；且后续步骤异常会导致 isDebugging:true 但实际未启动
    set({ error: null });
    let result;
    try {
      result = await window.qqbat.debug.start();
    } catch (e) {
      set({ isDebugging: false, error: e instanceof Error ? e.message : String(e) });
      console.error('[debugStore] startDebug IPC 异常:', e);
      return;
    }
    if (!result.ok) {
      set({ isDebugging: false, error: result.error || t('debug.startFailed') });
      console.error('[debugStore] startDebug 失败:', result.error);
      return;
    }
    set({ isDebugging: true });
    try {
      await get().syncBreakpoints();
      // 生成带调试钩子的代码（由调用方传入 projectPath，避免 store 间耦合）
      const { useFlowStore } = await import('./flowStore');
      const ok = await useFlowStore.getState().generateCode(projectPath, true);
      if (!ok) {
        // 代码生成失败：回滚调试状态，避免 isDebugging:true 但实际未启动
        await window.qqbat.debug.stop().catch(() => {});
        set({
          isDebugging: false,
          error: t('debug.codegenFailed'),
          debugState: { status: 'idle', variables: [], callStack: [] },
        });
      }
    } catch (e) {
      // 后续步骤失败：回滚调试状态
      await window.qqbat.debug.stop().catch(() => {});
      set({
        isDebugging: false,
        error: e instanceof Error ? e.message : String(e),
        debugState: { status: 'idle', variables: [], callStack: [] },
      });
    }
  },

  stepOver: async () => {
    await window.qqbat.debug.stepOver();
  },

  stepInto: async () => {
    await window.qqbat.debug.stepInto();
  },

  stepOut: async () => {
    await window.qqbat.debug.stepOut();
  },

  continue: async () => {
    await window.qqbat.debug.continue();
  },

  pause: async () => {
    await window.qqbat.debug.pause();
  },

  stopDebug: async () => {
    await window.qqbat.debug.stop();
    set({ isDebugging: false, debugState: { status: 'idle', variables: [], callStack: [] } });
  },

  syncBreakpoints: async () => {
    const { breakpoints } = get();
    await window.qqbat.debug.setBreakpoints(breakpoints);
  },

  initDebugListener: () => {
    const cleanup = window.qqbat.debug.onStateChanged((state) => {
      set({
        debugState: state,
        isDebugging: state.status !== 'idle',
      });
    });
    return cleanup;
  },
}));
