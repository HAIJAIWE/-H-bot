// src/renderer/src/stores/gitStore.ts
import { create } from 'zustand';

/** Git 状态刷新间隔（毫秒） */
const GIT_FETCH_INTERVAL_MS = 10000;

export interface GitLogEntry {
  hash: string;
  message: string;
  timestamp: string;
}

export interface GitDiffResult {
  files: string[];
  patch: string;
}

/** 版本标签（tag）：与"提交"是两件事 —— 提交自动记每一步，标签是人为的里程碑 */
export interface VersionTagInfo {
  name: string;
  hash: string;
  message: string;
  timestamp: string;
}

interface GitState {
  branch: string;
  commitCount: number;
  clean: boolean;
  loaded: boolean;
  logEntries: GitLogEntry[];
  logLoading: boolean;
  /** 提交历史读取失败的原因（null = 没出错）。界面**必须**把它显示出来，
   *  否则「读不出来」和「没有提交」长得一模一样——见 fetchLog 里的注释。 */
  logError: string | null;
  diffCache: Record<string, GitDiffResult>;
  /** 按 hash 记录 diff 读取失败的原因（成功时该键被删除），供提交行显示。 */
  diffErrors: Record<string, string>;
  diffLoading: string | null;
  /** 正在读档的提交 hash（null = 没有进行中的读档） */
  restoreLoading: string | null;
  /** 读档失败原因。与 logError/diffErrors 同理：**必须让界面显示得出来** ——
   *  读档会覆盖当前 flow.json，失败却不说明原因是最糟的组合。 */
  restoreError: string | null;
  /** 上面那条失败属于哪个提交（界面据此只在该行显示，不要每行都挂一遍） */
  restoreErrorHash: string | null;
  clearLoading: boolean;
  clearError: string | null;
  /** 正在改写历史（删除/重命名）：非空时界面禁用这些按钮 */
  rewriteLoading: boolean;
  /** 改写失败原因（null = 没出错）。与 clearError 同理：**必须让界面显示得出来**。 */
  rewriteError: string | null;
  /** 最近一次改写的备份 ref —— 界面据此告诉用户"出问题怎么回滚" */
  lastBackupRef: string | null;
  /** 改写后工作区是否因此与新 tip 不一致（删掉最新一条时会出现） */
  lastWorktreeDirty: boolean;
  /** 版本标签列表（tag → 提交的映射由界面按 hash 建） */
  versionTags: VersionTagInfo[];
  /** 下一个建议版本号（v1.0 → v1.1），由主进程按已有标签算出 */
  versionNext: string;
  /** 当前 HEAD 的 hash（界面据此判断"这个提交是否已经有版本"） */
  versionHeadHash: string | null;
  versionLoading: boolean;
  /** 版本操作失败原因（null = 没出错）。与 clearError 同理：必须让界面显示得出来 */
  versionError: string | null;
  init: (projectPath: string) => () => void;
  fetchLog: (projectPath: string, maxCount?: number) => Promise<void>;
  fetchDiff: (projectPath: string, hash: string) => Promise<GitDiffResult | null>;
  /** 读档：成功后会自动刷新日志（服务层会追加一条 restore 提交） */
  restoreFlow: (projectPath: string, hash: string) => Promise<boolean>;
  /** 清空历史：成功后会自动刷新状态与日志 */
  clearHistory: (projectPath: string) => Promise<boolean>;
  /** 删除若干条提交（可单条、可多条）；成功后自动刷新状态与日志 */
  deleteCommits: (projectPath: string, hashes: string[]) => Promise<boolean>;
  /** 重命名一条提交的说明；成功后自动刷新状态与日志 */
  rewordCommit: (projectPath: string, hash: string, message: string) => Promise<boolean>;
  /** 拉取版本标签列表 */
  fetchVersions: (projectPath: string) => Promise<void>;
  /** 把 HEAD 标记为版本（name 省略时用建议的下一个版本号） */
  tagVersionNow: (projectPath: string, name?: string) => Promise<boolean>;
  /** 给版本改名 */
  renameVersion: (projectPath: string, oldName: string, newName: string) => Promise<boolean>;
  /** 删除版本（只删标签，提交不动） */
  deleteVersion: (projectPath: string, name: string) => Promise<boolean>;
}

/**
 * 改写成功后的公共收尾：日志与仓库状态都变了（提交数、干净度）。
 *
 * 抽出来是因为"删除"和"重命名"的收尾完全一样，而这套收尾漏一步就会出现
 * "界面说成功、列表还是旧的"这种不一致。
 */
async function refreshAfterRewrite(
  set: (partial: Partial<GitState>) => void,
  get: () => GitState,
  projectPath: string,
): Promise<void> {
  await get().fetchLog(projectPath);
  try {
    const st = await window.qqbat.git.status(projectPath);
    if (st.ok && st.data) {
      set({ branch: st.data.branch, commitCount: st.data.commitCount, clean: st.data.clean });
    }
  } catch {
    // 状态刷新失败不影响"改写已成功"这个事实
  }
}

export const useGitStore = create<GitState>((set, get) => ({
  branch: '',
  commitCount: 0,
  clean: true,
  loaded: false,
  logEntries: [],
  logLoading: false,
  logError: null,
  diffCache: {},
  diffErrors: {},
  diffLoading: null,
  restoreLoading: null,
  restoreError: null,
  restoreErrorHash: null,
  clearLoading: false,
  clearError: null,
  rewriteLoading: false,
  rewriteError: null,
  lastBackupRef: null,
  lastWorktreeDirty: false,
  versionTags: [],
  versionNext: 'v1.0',
  versionHeadHash: null,
  versionLoading: false,
  versionError: null,

  init: (projectPath: string) => {
    let cancelled = false;
    if (!window.qqbat?.git) {
      set({ loaded: true });
      return () => {};
    }

    const fetch = async () => {
      if (!projectPath) {
        set({ branch: '', commitCount: 0, clean: true, loaded: false });
        return;
      }
      try {
        const result = await window.qqbat.git.status(projectPath);
        if (cancelled) return;
        if (result.ok && result.data) {
          set({
            branch: result.data.branch,
            commitCount: result.data.commitCount,
            clean: result.data.clean,
            loaded: true,
          });
        } else {
          set({ branch: '', commitCount: 0, clean: true, loaded: true });
        }
      } catch {
        // git 操作失败时重置为默认状态
        if (!cancelled) {
          set({ branch: '', commitCount: 0, clean: true, loaded: true });
        }
      }
    };

    fetch();

    // 每 10 秒刷新一次状态
    const timer = setInterval(fetch, GIT_FETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  },

  fetchLog: async (projectPath: string, maxCount: number = 50) => {
    if (!window.qqbat?.git || !projectPath) {
      set({ logEntries: [] });
      return;
    }
    set({ logLoading: true });
    try {
      const result = await window.qqbat.git.log(projectPath, maxCount);
      if (result.ok && Array.isArray(result.data)) {
        set({ logEntries: result.data as GitLogEntry[], logLoading: false, logError: null });
      } else {
        // 这里原本只清空列表、不留任何原因。主进程那侧的 catch 又把故障也变成空数组，
        // 两道吞掉之后，「git 读不出来」与「仓库没有提交」在界面上完全同形 ——
        // 用户看到空列表，无从判断，只能说"不能读"（2026-09-21 实测反馈）。
        // 主进程现在会把真实故障抛上来（空仓库仍然安静返回 []），这里原样留住并交给界面显示。
        set({
          logEntries: [],
          logLoading: false,
          logError: result.ok ? null : result.error || null,
        });
      }
    } catch (e) {
      set({
        logEntries: [],
        logLoading: false,
        logError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  fetchDiff: async (projectPath: string, hash: string) => {
    if (!window.qqbat?.git || !projectPath || !hash) return null;
    // 命中缓存直接返回
    const cached = get().diffCache[hash];
    if (cached) return cached;
    set({ diffLoading: hash });
    /** 记下失败原因。
     *  原来这里只 `return null`，界面于是只能显示一句笼统的
     *  「无法获取 diff（可能为首次提交或 git 异常）」—— 把两种完全不同的情况混在一起，
     *  真正的原因（不是 git 仓库 / hash 不存在 / PATH 上没有 git）一个字都传不出去。 */
    const fail = (msg: string) => {
      set((s) => ({ diffLoading: null, diffErrors: { ...s.diffErrors, [hash]: msg } }));
      return null;
    };
    try {
      const result = await window.qqbat.git.diff(projectPath, hash);
      if (result.ok && result.data) {
        const diff = result.data as GitDiffResult;
        set((s) => {
          const rest = { ...s.diffErrors };
          delete rest[hash];
          return {
            diffCache: { ...s.diffCache, [hash]: diff },
            diffErrors: rest,
            diffLoading: null,
          };
        });
        return diff;
      }
      return fail(result.ok ? '' : result.error || '');
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },

  restoreFlow: async (projectPath: string, hash: string) => {
    if (!window.qqbat?.git || !projectPath || !hash) return false;
    set({ restoreLoading: hash, restoreError: null, restoreErrorHash: null });
    try {
      const result = await window.qqbat.git.restoreFlow(projectPath, hash);
      if (result.ok) {
        set({ restoreLoading: null, restoreError: null, restoreErrorHash: null });
        // 服务层会追加一条 `restore: flow.json @ <hash>` 提交，所以刷新日志能立刻看到
        await get().fetchLog(projectPath);
        return true;
      }
      // 与 fetchLog 同一套写法：拿不到原因时留 null，由界面用自己的文案兜底，
      // 不在 store 里写死中文（会让 noHardcodedCopy 闸门变红）。
      set({
        restoreLoading: null,
        restoreError: result.ok ? null : result.error || null,
        restoreErrorHash: hash,
      });
      return false;
    } catch (e) {
      set({
        restoreLoading: null,
        restoreError: e instanceof Error ? e.message : String(e),
        restoreErrorHash: hash,
      });
      return false;
    }
  },

  clearHistory: async (projectPath: string) => {
    if (!window.qqbat?.git || !projectPath) return false;
    set({ clearLoading: true, clearError: null });
    try {
      const result = await window.qqbat.git.clearHistory(projectPath);
      if (result.ok) {
        set({ clearLoading: false, clearError: null });
        // 清空后历史为空、状态也变了（新仓库），两边都刷一次
        await get().fetchLog(projectPath);
        return true;
      }
      set({ clearLoading: false, clearError: result.ok ? null : result.error || null });
      return false;
    } catch (e) {
      set({
        clearLoading: false,
        clearError: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  },

  deleteCommits: async (projectPath: string, hashes: string[]) => {
    if (!window.qqbat?.git || !projectPath || hashes.length === 0) return false;
    set({ rewriteLoading: true, rewriteError: null, lastBackupRef: null });
    try {
      const result = await window.qqbat.git.deleteCommits(projectPath, hashes);
      if (result.ok && result.data) {
        set({
          rewriteLoading: false,
          rewriteError: null,
          lastBackupRef: result.data.backupRef,
          lastWorktreeDirty: result.data.worktreeDirty,
        });
        await refreshAfterRewrite(set, get, projectPath);
        return true;
      }
      // 与 fetchLog 同一套写法：拿不到原因时留 null，由界面用自己的文案兜底，
      // 不在 store 里写死中文（会让 noHardcodedCopy 闸门变红）。
      set({ rewriteLoading: false, rewriteError: result.ok ? null : result.error || null });
      return false;
    } catch (e) {
      set({ rewriteLoading: false, rewriteError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  rewordCommit: async (projectPath: string, hash: string, message: string) => {
    if (!window.qqbat?.git || !projectPath || !hash) return false;
    set({ rewriteLoading: true, rewriteError: null, lastBackupRef: null });
    try {
      const result = await window.qqbat.git.rewordCommit(projectPath, hash, message);
      if (result.ok && result.data) {
        set({
          rewriteLoading: false,
          rewriteError: null,
          lastBackupRef: result.data.backupRef,
          lastWorktreeDirty: result.data.worktreeDirty,
        });
        await refreshAfterRewrite(set, get, projectPath);
        return true;
      }
      set({ rewriteLoading: false, rewriteError: result.ok ? null : result.error || null });
      return false;
    } catch (e) {
      set({ rewriteLoading: false, rewriteError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  fetchVersions: async (projectPath: string) => {
    if (!window.qqbat?.git?.listVersionTags || !projectPath) {
      set({ versionTags: [] });
      return;
    }
    set({ versionLoading: true });
    try {
      const res = await window.qqbat.git.listVersionTags(projectPath);
      if (res.ok && res.data) {
        set({
          versionTags: res.data.tags ?? [],
          versionNext: res.data.next || 'v1.0',
          versionHeadHash: res.data.headHash ?? null,
          versionLoading: false,
          versionError: null,
        });
      } else {
        set({
          versionTags: [],
          versionLoading: false,
          versionError: res.ok ? null : res.error || null,
        });
      }
    } catch (e) {
      set({
        versionTags: [],
        versionLoading: false,
        versionError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  tagVersionNow: async (projectPath: string, name?: string) => {
    if (!window.qqbat?.git?.tagVersion || !projectPath) return false;
    set({ versionLoading: true, versionError: null });
    try {
      const res = await window.qqbat.git.tagVersion(projectPath, name);
      if (res.ok) {
        set({ versionLoading: false, versionError: null });
        await get().fetchVersions(projectPath);
        return true;
      }
      set({ versionLoading: false, versionError: res.ok ? null : res.error || null });
      return false;
    } catch (e) {
      set({ versionLoading: false, versionError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  renameVersion: async (projectPath: string, oldName: string, newName: string) => {
    if (!window.qqbat?.git?.renameVersionTag || !projectPath) return false;
    set({ versionLoading: true, versionError: null });
    try {
      const res = await window.qqbat.git.renameVersionTag(projectPath, oldName, newName);
      if (res.ok) {
        set({ versionLoading: false, versionError: null });
        await get().fetchVersions(projectPath);
        return true;
      }
      set({ versionLoading: false, versionError: res.ok ? null : res.error || null });
      return false;
    } catch (e) {
      set({ versionLoading: false, versionError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  deleteVersion: async (projectPath: string, name: string) => {
    if (!window.qqbat?.git?.deleteVersionTag || !projectPath) return false;
    set({ versionLoading: true, versionError: null });
    try {
      const res = await window.qqbat.git.deleteVersionTag(projectPath, name);
      if (res.ok) {
        set({ versionLoading: false, versionError: null });
        await get().fetchVersions(projectPath);
        return true;
      }
      set({ versionLoading: false, versionError: res.ok ? null : res.error || null });
      return false;
    } catch (e) {
      set({ versionLoading: false, versionError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
