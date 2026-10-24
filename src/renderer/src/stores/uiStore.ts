// src/renderer/src/stores/uiStore.ts
import { create } from 'zustand';
import { STORAGE_KEYS } from '../lib/infra/storageKeys';
import { persist } from 'zustand/middleware';

export type CenterTab = 'blocks' | 'code' | 'panels' | 'logs' | 'metrics';
export type BottomTab = 'output' | 'test' | 'terminal' | 'ports';
/** 右侧面板 Tab：AI 智能体 / 变量管理 / 源码调试器（高代码模式专用） */
export type RightTab = 'ai' | 'debugger' | 'variables';
export type AppMode = 'launch' | 'dev' | 'browser';
export type LaunchTab =
  | 'home'
  | 'dashboard'
  | 'logs'
  | 'console'
  | 'dataview'
  | 'config'
  | (string & {});

interface UiState {
  centerTab: CenterTab;
  setCenterTab: (tab: CenterTab) => void;
  leftPanelCollapsed: boolean;
  toggleLeftPanel: () => void;
  rightPanelCollapsed: boolean;
  toggleRightPanel: () => void;
  terminalOpen: boolean;
  terminalHeight: number;
  toggleTerminal: () => void;
  setTerminalHeight: (h: number) => void;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  rightTab: RightTab;
  setRightTab: (tab: RightTab) => void;
  mode: AppMode;
  setMode: (m: AppMode) => void;
  launchTab: LaunchTab;
  setLaunchTab: (t: LaunchTab) => void;
  leftPanelWidth: number;
  setLeftPanelWidth: (w: number) => void;
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      centerTab: 'blocks' as CenterTab,
      /** 切换中心区域 Tab（blocks/code/panels/logs/metrics） */
      setCenterTab: (tab: CenterTab) => set({ centerTab: tab }),
      leftPanelCollapsed: false,
      /** 切换左侧面板折叠/展开 */
      toggleLeftPanel: () => set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),
      rightPanelCollapsed: false,
      /** 切换右侧面板折叠/展开 */
      toggleRightPanel: () => set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),
      terminalOpen: true,
      terminalHeight: 200,
      /** 切换终端面板显示/隐藏 */
      toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
      setTerminalHeight: (h: number) => set({ terminalHeight: Math.max(100, Math.min(500, h)) }),
      bottomTab: 'output' as BottomTab,
      setBottomTab: (tab: BottomTab) => set({ bottomTab: tab }),
      rightTab: 'ai' as RightTab,
      setRightTab: (tab: RightTab) => set({ rightTab: tab }),
      mode: 'launch' as AppMode,
      /** 切换应用模式（launch/dev/browser） */
      setMode: (m: AppMode) => set({ mode: m }),
      launchTab: 'home' as LaunchTab,
      setLaunchTab: (t: LaunchTab) => set({ launchTab: t }),
      leftPanelWidth: 240,
      setLeftPanelWidth: (w: number) => set({ leftPanelWidth: Math.max(160, Math.min(500, w)) }),
      rightPanelWidth: 320,
      setRightPanelWidth: (w: number) => set({ rightPanelWidth: Math.max(200, Math.min(600, w)) }),
    }),
    {
      name: STORAGE_KEYS.ui,
      version: 2,
      /**
       * v1：主页面（home）成为默认落点。旧存档里存的是 'dashboard' 或用户最后停的页签，
       * 不迁移的话升级后根本看不到新主页面 —— 所以 v0/v1 → v2 一次性强制落到 home，
       * 之后按用户自己的选择记住（再进仪表盘也不会被改回来）。
       */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<UiState>;
        if (version < 2) return { ...state, launchTab: 'home' } as UiState;
        return state as UiState;
      },
      // 仅持久化布局偏好，不持久化临时状态（terminalOpen、bottomTab）
      partialize: (state) => ({
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        leftPanelCollapsed: state.leftPanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        terminalHeight: state.terminalHeight,
        mode: state.mode,
        launchTab: state.launchTab,
        centerTab: state.centerTab,
      }),
    },
  ),
);
