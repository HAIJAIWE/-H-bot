import { create } from 'zustand';
import type { BotStatusInfo } from '../types/ipc';
import { toast } from '../components/ui/Toast';
import { t } from '../i18n';
import { useFlowStore } from './flowStore';

interface BotStore {
  bots: BotStatusInfo[];
  selectedBotPath: string | null;
  loading: boolean;
  error: string | null;

  loadBots: () => Promise<void>;
  selectBot: (projectPath: string) => void;
  startBot: (projectPath: string) => Promise<void>;
  stopBot: (projectPath: string) => Promise<void>;
  restartBot: (projectPath: string) => Promise<void>;
  init: () => () => void;
}

export const useBotStore = create<BotStore>((set, get) => ({
  bots: [],
  selectedBotPath: null,
  // ⚠️ 初始必须是 true：Workspace 里"无项目就弹新建对话框"的 effect 在**首次渲染**的闭包里
  // 读到的是初始值 —— 若为 false，就会把"列表还没加载"当成"用户没有任何项目"，
  // 于是每次启动都自动弹出「新建 Bot 项目」挡住画布（真应用实测踩到）。
  loading: true,
  error: null,

  loadBots: async () => {
    if (!window.qqbat?.botManager) {
      set({ loading: false });
      return;
    }
    set({ loading: true, error: null });
    try {
      const res = await window.qqbat.botManager.list();
      if (res.ok && res.data) {
        set({ bots: res.data as BotStatusInfo[], loading: false });
      } else {
        set({ error: res.error ?? t('bot.loadFailed'), loading: false });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  selectBot: (projectPath) => {
    set({ selectedBotPath: projectPath });
  },

  startBot: async (projectPath) => {
    if (!window.qqbat?.botManager) return;
    // 启动前先把编辑器里的改动落盘：解释器读的是磁盘上的 .qqbat/flow.json，
    // 不保存就会出现"我明明改了流程，机器人跑的还是老的"（实测踩到过）。
    // force=true：即使没有"未保存"标记也写一次，保证磁盘 == 内存。
    // 落盘失败（含"flow.json 加载失败 → 保护性禁止保存"）就不要启动了：
    // 解释器只认磁盘文件，启动等于跑一份和画布不一致的旧流程。
    if (!(await useFlowStore.getState().saveNow(projectPath, { force: true }))) {
      toast.error(t('bot.startCancelledNotSaved'));
      return;
    }
    const res = await window.qqbat.botManager.start(projectPath);
    if (res.ok) {
      set((s) => ({
        bots: s.bots.map((b) =>
          b.projectPath === projectPath ? { ...b, status: 'starting' as const } : b,
        ),
      }));
    } else {
      toast.error(res.error || t('bot.startFailed'));
    }
  },

  stopBot: async (projectPath) => {
    if (!window.qqbat?.botManager) return;
    const res = await window.qqbat.botManager.stop(projectPath);
    if (!res.ok) {
      toast.error(res.error || t('bot.stopFailed'));
    }
  },

  restartBot: async (projectPath) => {
    if (!window.qqbat?.botManager) return;
    // 同上：重启是"把当前流程跑起来"的意图，先落盘再重启；落盘失败则不重启
    if (!(await useFlowStore.getState().saveNow(projectPath, { force: true }))) {
      toast.error(t('bot.restartCancelledNotSaved'));
      return;
    }
    // 调用主进程 restart：内部会先 stop 再 start，避免端口冲突/幽灵进程
    // （原实现仅 startBot 不 stop，旧进程可能仍占用端口导致新启动失败）
    const res = await window.qqbat.botManager.restart(projectPath);
    if (res.ok) {
      set((s) => ({
        bots: s.bots.map((b) =>
          b.projectPath === projectPath ? { ...b, status: 'starting' as const } : b,
        ),
      }));
    } else {
      toast.error(res.error || t('bot.restartFailed'));
    }
  },

  init: () => {
    if (!window.qqbat?.botManager) return () => {};
    get().loadBots();

    const unsub = window.qqbat.botManager.onStatusChanged((raw) => {
      const data = raw as BotStatusInfo;
      set((s) => ({
        bots: s.bots.map((b) =>
          b.projectPath === data.projectPath
            ? {
                ...b,
                status: data.status,
                pid: data.pid,
                uptime: data.uptime,
                startedAt: data.startedAt ?? b.startedAt,
              }
            : b,
        ),
      }));
    });

    return () => {
      unsub();
    };
  },
}));
