// src/renderer/src/stores/panelDriftStore.ts
//
// 「指令面板和图上不一致」的条数 —— 供**工具栏按钮上的角标**读取。
//
// ## 为什么需要跨组件存这一份
//
// 漂移（面板是远端副本，图改了它不会自己变）原本只在**打开指令面板时**才看得到。
// 但用户改完图就关掉了，不会为看一眼差异再打开一次 —— 于是"图改了、面板没跟上"
// 仍然是**静默**的（这正是本项目反复在防的那类）。
//
// 所以：打开面板时算一次漂移，把结果**留在这里**；工具栏按钮读它显示角标。
// 之后用户在图里增删改指令，角标不会自己更新（那需要每次改图都去问远端，
// 而"问远端"是要凭据和网络的）—— 它表示的是**上一次核对的结果**，不是实时状态。
// 这一点必须体现在文案里（悬浮提示写明"上次核对"），否则角标会变成一个骗人的实时指标。
import { create } from 'zustand';

interface PanelDriftState {
  /** 与图上不一致的场景数（0 = 上次核对时两边一致，或还没核对过） */
  staleScopes: number;
  /** 面板里有、图里已经没有的条目数（那种点了没反应） */
  staleItems: number;
  /** 是否核对过（false 时角标不该显示 —— "没查过"和"查过没问题"是两件事） */
  checked: boolean;
  setDrift: (staleScopes: number, staleItems: number) => void;
}

export const usePanelDriftStore = create<PanelDriftState>((set) => ({
  staleScopes: 0,
  staleItems: 0,
  checked: false,
  setDrift: (staleScopes, staleItems) => set({ staleScopes, staleItems, checked: true }),
}));
