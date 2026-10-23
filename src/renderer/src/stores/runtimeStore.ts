// src/renderer/src/stores/runtimeStore.ts
import { create } from 'zustand';
import type { BotStatus, BotState, BotLogEntry } from '@shared/types/runtime';
import type { LogLevel } from '@shared/types/log';
import { useProjectStore } from './projectStore';

interface RuntimeState {
  botStatus: BotStatus;
  botPid: number | null;
  startedAt: string | null;
  crashCount: number;
  uptime: number | null;
  starting: boolean;
  setBotState: (state: BotState) => void;
  setStarting: (v: boolean) => void;
  reset: () => void;
  /** 初始化运行时监听，onLog 回调由调用方注入（解耦 logStore） */
  init: (
    onLog: (
      level: LogLevel,
      message: string,
      nodeId?: string,
      traceId?: string,
      projectPath?: string,
    ) => void,
  ) => () => void;
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  botStatus: 'stopped',
  botPid: null,
  startedAt: null,
  crashCount: 0,
  uptime: null,
  starting: false,

  setBotState: (state) =>
    set({
      botStatus: state.status,
      botPid: state.pid,
      startedAt: state.startedAt,
      crashCount: state.crashCount,
      uptime: state.uptime,
    }),

  setStarting: (v) => set({ starting: v }),

  reset: () =>
    set({
      botStatus: 'stopped',
      botPid: null,
      startedAt: null,
      crashCount: 0,
      uptime: null,
      starting: false,
    }),

  init: (onLog) => {
    if (!window.qqbat?.runtime) return () => {};
    // 监听状态变更：统一走 botManager:statusChanged（runtime:* 已不再转发状态）。
    // payload 是单条 BotStatus（含 projectPath），按当前项目过滤，避免多项目互相覆盖。
    const unsubStatus = window.qqbat.botManager.onStatusChanged((status) => {
      const currentPath = useProjectStore.getState().currentProject?.path;
      const projectPath = status?.projectPath;
      if (projectPath && currentPath && projectPath !== currentPath) return;
      set({
        botStatus: status?.status ?? 'stopped',
        // BotStatus 不含 pid/crashCount（TS 运行时是主进程内的连接）：保持 0/null 语义
        botPid: null,
        startedAt: status?.startedAt ?? null,
        crashCount: 0,
        uptime: status?.uptime ?? null,
        starting: false,
      });
    });

    // 监听日志推送 → 通过回调写入（由调用方注入，避免 store 间耦合）
    // data 类型：主进程批量发送时为数组，单条时为对象；类型签名兼容两种形态
    type BotLogPayload = { projectPath: string; entry: BotLogEntry };
    const unsubLog = window.qqbat.runtime.onLog((data: BotLogPayload | BotLogPayload[]) => {
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const entry = item.entry;
        const level =
          entry.level === 'error'
            ? ('error' as const)
            : entry.level === 'warn'
              ? ('warn' as const)
              : ('info' as const);
        // nodeId: BotLogEntry 当前无此字段，运行时检测兼容未来节点级日志扩展
        const nodeId = (entry as { nodeId?: string }).nodeId;
        onLog(level, `[${entry.source}] ${entry.message}`, nodeId, entry.traceId, item.projectPath);
      }
    });

    // uptime 刷新
    const uptimeInterval = setInterval(() => {
      set((s) => {
        if (s.botStatus !== 'running' || !s.startedAt) return {};
        const elapsed = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000);
        return { uptime: elapsed };
      });
    }, 1000);

    return () => {
      unsubStatus();
      unsubLog();
      clearInterval(uptimeInterval);
    };
  },
}));
