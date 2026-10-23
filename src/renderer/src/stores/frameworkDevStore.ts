// src/renderer/src/stores/frameworkDevStore.ts
//
// # 框架开发模式的**界面侧**状态
//
// 这里**不是**权威来源：开关真正的主人在主进程（`file:setDevMode` / `file:getDevMode`）。
// 本 store 只是把主进程的状态拉回来给界面看 —— 所以每次打开对话框、每次切换之后
// 都**以主进程的返回为准**，而不是乐观地先改本地再等（乐观更新在这里特别危险：
// 界面显示"已关闭"、主进程还开着，用户会以为护栏回来了）。
//
// 另外两件事放在这里，因为它们都是"渲染层的当前项目"这件事的一部分：
//   · `enterWorkspace()`：把当前项目指向**框架根**（走 `project:getMeta` 那份合成 meta）
//   · `leaveWorkspace()`：退回一个**普通项目**（关掉模式时绝不能留在已失去授权的会话里）
//
// 2026-10-15 又多了两件与**创作模式**有关的（见 P1-8）：
//   · `creatorWorkspaceStatus()`：创作模式能不能写（三态，纯函数，界面照着它显示引导）；
//   · 关掉框架开发模式时**顺手把创作模式退回"跟页面"** —— 绝不把用户留在一个写不了东西的模式里。
import { create } from 'zustand';
import type { ProjectMeta } from '@shared/types/project';
import type {
  FrameworkDevRestoreResult,
  FrameworkDevRevision,
  FrameworkDevUsage,
  SecurityCriticalWriteInfo,
} from '../types/ipc';
import { useProjectStore } from './projectStore';
import { useBotStore } from './botStore';
import { useAiStore } from './aiStore';

/**
 * **创作模式能不能写** —— 三态，纯函数（组件只负责按它显示，不自己重算规则）。
 *
 * | 状态 | 条件 | 界面该做什么 |
 * |---|---|---|
 * | `need-enable` | 框架开发模式**没开** | 引导：先打开框架开发模式（那是总闸，得在对话框里带着警告开） |
 * | `need-enter`  | 开了但**没进框架工作区** | 引导 + 一个直达按钮（复用 `enterWorkspace`） |
 * | `ready`       | 开着且在框架工作区里 | 什么都不用说，可以干活了 |
 *
 * 为什么要单独一个函数而不是在 JSX 里写 `enabled && inWorkspace`：
 * 这条规则要能被测试钉住（「不在工作区时选创作模式」正是验收项之一），
 * 而且**将来加条件**（比如"模式开着但框架根不可写"）时只有一处要改。
 */
export function creatorWorkspaceStatus(
  enabled: boolean,
  inWorkspace: boolean,
): 'ready' | 'need-enter' | 'need-enable' {
  if (!enabled) return 'need-enable';
  return inWorkspace ? 'ready' : 'need-enter';
}

/**
 * 把**创作模式**退回"跟页面"（低代码页=流程助手 / 代码页=代码助手）。
 *
 * 只在"框架开发模式被关掉"时调用：那一刻创作模式**写不了任何东西**
 * （文件 IPC 立即拒绝框架根），留在那个模式里只会让用户以为还能干活。
 *
 * @returns 真的退回了（调用方据此决定要不要提示用户）
 */
function demoteCreatorMode(): boolean {
  const ai = useAiStore.getState();
  if (ai.agentModeOverride !== 'creator') return false;
  ai.setAgentModeOverride(null);
  return true;
}

interface FrameworkDevStoreState {
  /** 主进程当前是否开着（**默认 false**，与主进程的 fail-closed 对齐） */
  enabled: boolean;
  /** 框架根（"框架自己"的源码目录） */
  frameworkRoot: string;
  /** 现有回退点（新的在前） */
  backups: FrameworkDevRevision[];
  /** 回退点占用（界面要能看见，否则没人敢开这个模式） */
  usage: FrameworkDevUsage;
  /** 当前项目是不是**框架工作区**（框架根） */
  inWorkspace: boolean;
  /**
   * **本次会话动过的护栏文件**（禁区/备份/模式值域那一类，见
   * `@shared/files/securityCriticalPaths`）。改这些 = 改护栏本身。
   *
   * 界面上必须与普通写入区分开：顶栏给一个常驻提示，对话框里列出来 ——
   * 否则用户可能几轮之后才发现"禁区没了 / 备份不写了"。
   */
  securityCriticalWrites: SecurityCriticalWriteInfo[];
  /**
   * 「框架开发模式」对话框开着吗。
   *
   * 为什么放在 store 而不是某个组件的 useState：**有两个入口要开它** ——
   * 顶栏的徽标/帮助菜单，和创作模式提示条上那个「打开框架开发模式」按钮。
   * 对话框只应该有一个实例（它要 useToast，散在组件树里会各自要 Provider），
   * 所以：**实例挂在顶栏**，别处只改这个标志。
   */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  loading: boolean;
  /** 最近一次失败的原因（原文来自主进程，直接展示比翻译更不容易误导） */
  error: string | null;
  /** 从主进程拉一次全量状态 */
  refresh: () => Promise<void>;
  /**
   * 请求切换。返回主进程的结果：
   *   · `ok:false` = 没切成（**落盘失败，状态未变**，fail-closed）
   *   · `leftFrameworkWorkspace` = 主进程关掉时把"当前项目"从框架根上摘下来了
   *   · `resetCreatorMode` = 关掉时顺手把**创作模式**退回"跟页面"了（界面该提示一句）
   */
  setEnabled: (enabled: boolean) => Promise<{
    ok: boolean;
    persisted: boolean;
    leftFrameworkWorkspace: boolean;
    resetCreatorMode: boolean;
  }>;
  /** 从某个回退点恢复；返回 null 表示失败（原因在 error 里） */
  restore: (revisionId: string, relativePath?: string) => Promise<FrameworkDevRestoreResult | null>;
  /** 进入框架工作区：当前项目 → 框架根（**只改内存态，绝不落盘**） */
  enterWorkspace: () => Promise<boolean>;
  /** 退回一个普通项目；没有可选项目时退化为"未打开任何项目" */
  leaveWorkspace: () => Promise<boolean>;
}

const OFFLINE_MESSAGE = 'window.qqbat.file.getDevMode is not available';

/** 路径规范化：只用于界面上的"这是不是框架根下的路径"判断（权威判定在主进程） */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** target 是否在 root 之内（含 root 自身） */
function isInsidePath(root: string, target: string): boolean {
  const r = normalizePath(root);
  const t = normalizePath(target);
  if (!r || !t) return false;
  return t === r || t.startsWith(`${r}/`);
}

export const useFrameworkDevStore = create<FrameworkDevStoreState>((set, get) => ({
  enabled: false,
  frameworkRoot: '',
  backups: [],
  usage: { count: 0, bytes: 0, limit: 0 },
  inWorkspace: false,
  securityCriticalWrites: [],
  dialogOpen: false,
  setDialogOpen: (open) => set({ dialogOpen: open }),
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const res = await window.qqbat.file.getDevMode();
      if (res.ok && res.data) {
        const { enabled, frameworkRoot, backups, usage, securityCriticalWrites } = res.data;
        set({
          enabled,
          frameworkRoot,
          backups,
          usage,
          securityCriticalWrites: securityCriticalWrites ?? [],
          error: null,
          // 关着的时候不可能在框架工作区（主进程已不再放行那条路）
          inWorkspace: enabled && isInsidePath(frameworkRoot, currentProjectPath()),
        });
        // 主进程说"关着"（可能是别处关的/重启后读回来的）：创作模式立刻退回安全态
        if (!enabled) demoteCreatorMode();
      } else {
        set({ error: res.error ?? 'file:getDevMode failed' });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : OFFLINE_MESSAGE });
    } finally {
      set({ loading: false });
    }
  },

  setEnabled: async (enabled) => {
    try {
      const res = await window.qqbat.file.setDevMode(enabled);
      if (!res.ok || !res.data) {
        set({ error: res.error ?? 'file:setDevMode failed' });
        return {
          ok: false,
          persisted: false,
          leftFrameworkWorkspace: false,
          resetCreatorMode: false,
        };
      }
      // 以主进程返回为准（含失败时"状态未变"的语义：这里不会走到，失败已在上面的分支返回）
      const enabledNow = res.data.enabled;
      set({ enabled: enabledNow, error: null });
      /**
       * ★ 关掉框架开发模式 → **创作模式立刻退回"跟页面"**（P1-8 的要求④）。
       *
       * 为什么不留给用户自己发现：那一刻创作模式**已经写不了任何东西**了
       * （文件 IPC 立即拒绝框架根），留在那个模式里只会让他提要求、然后看一串失败。
       */
      const resetCreatorMode = enabledNow ? false : demoteCreatorMode();
      return {
        ok: true,
        persisted: res.data.persisted,
        leftFrameworkWorkspace: res.data.leftFrameworkWorkspace,
        resetCreatorMode,
      };
    } catch (e) {
      set({ error: e instanceof Error ? e.message : OFFLINE_MESSAGE });
      return {
        ok: false,
        persisted: false,
        leftFrameworkWorkspace: false,
        resetCreatorMode: false,
      };
    }
  },

  restore: async (revisionId, relativePath) => {
    try {
      const res = await window.qqbat.file.restoreDevBackup(revisionId, relativePath);
      if (!res.ok || !res.data) {
        set({ error: res.error ?? 'file:restoreDevBackup failed' });
        return null;
      }
      return res.data;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : OFFLINE_MESSAGE });
      return null;
    }
  },

  enterWorkspace: async () => {
    const state = get();
    if (!state.enabled || !state.frameworkRoot) {
      set({ error: 'framework dev mode is off' });
      return false;
    }
    try {
      // 主进程会合成一份 meta（框架根不是机器人项目，没有 .qqbat/project.json）
      const res = await window.qqbat.project.getMeta(state.frameworkRoot);
      if (!res.ok || !res.data) {
        set({ error: res.error ?? 'project:getMeta failed' });
        return false;
      }
      useProjectStore.getState().setCurrentProject(res.data as ProjectMeta);
      set({ inWorkspace: true, error: null });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : OFFLINE_MESSAGE });
      return false;
    }
  },

  leaveWorkspace: async () => {
    const root = get().frameworkRoot;
    /** 候选：先把"框架根自己"滤掉（它已经不该再被打开了） */
    const candidates: string[] = [];
    for (const bot of useBotStore.getState().bots) {
      if (bot.projectPath && !isInsidePath(root, bot.projectPath)) candidates.push(bot.projectPath);
    }
    if (candidates.length === 0) {
      try {
        const recent = await window.qqbat.project.listRecent();
        if (recent.ok && recent.data) {
          for (const p of recent.data) {
            if (p.path && !isInsidePath(root, p.path)) candidates.push(p.path);
          }
        }
      } catch {
        // 最近项目列表读不到就算了：下面退回"未打开任何项目"
      }
    }
    for (const path of candidates) {
      try {
        const meta = await window.qqbat.project.getMeta(path);
        if (meta.ok && meta.data) {
          useProjectStore.getState().setCurrentProject(meta.data as ProjectMeta);
          // 同步下拉框，避免"界面上写着 A、编辑器在框架根"那种自相矛盾
          useBotStore.getState().selectBot(path);
          set({ inWorkspace: false, error: null });
          return true;
        }
      } catch {
        // 试下一个候选
      }
    }
    // 一个普通项目都没有：明确退回"未打开任何项目"，**绝不留在框架工作区**
    useProjectStore.getState().setCurrentProject(null);
    set({ inWorkspace: false });
    return false;
  },
}));

/** 渲染层当前项目的路径（没有就是空串） */
function currentProjectPath(): string {
  return useProjectStore.getState().currentProject?.path ?? '';
}
