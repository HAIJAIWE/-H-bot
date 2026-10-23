// src/renderer/src/stores/testStore.ts
import { create } from 'zustand';
import type { BotLogEntry, ExecuteNodeEvent } from '@shared/types/runtime';
import type { FlowGraph } from '@shared/types/flow';
import { t, getLocale } from '../i18n';

/** 测试日志来源。存**稳定键**而不是显示文案：显示文案随语言变，
 *  拿它做过滤/配色判断会在英文界面下静默失效。 */
export type TestLogSource = 'bot' | 'system' | 'translator' | 'manager' | 'test' | 'node';

export interface TestLogEntry {
  id: number;
  time: string;
  icon: string;
  source: TestLogSource;
  detail: string;
  level?: 'info' | 'warn' | 'error';
}

/** 测试日志最大保留条数（FIFO 淘汰最旧条目） */
const MAX_TEST_LOG = 500;

interface TestState {
  log: TestLogEntry[];
  showTestDialog: boolean;
  testMessage: string;
  testLoading: boolean;
  nodeNames: Record<string, string>;
  /** 当前选中 bot 的运行状态，用于在流程/代码视图判断是否可测试 */
  botRunning: boolean;

  addLog: (entry: Omit<TestLogEntry, 'id' | 'time'>) => void;
  clearLog: () => void;
  openDialog: () => void;
  closeDialog: () => void;
  setTestMessage: (msg: string) => void;
  setBotRunning: (running: boolean) => void;
  /** 读取 flow.json 构建节点 id → 名称映射 */
  loadNodeNames: (projectPath: string) => Promise<void>;
  /** 发送一条模拟测试消息 */
  sendTest: (projectPath: string) => Promise<void>;
}

let logId = 0;

const now = () =>
  new Date().toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export const useTestStore = create<TestState>((set, get) => ({
  log: [],
  showTestDialog: false,
  testMessage: '',
  testLoading: false,
  nodeNames: {},
  botRunning: false,

  addLog: (entry) =>
    set((s) => ({
      log: [{ ...entry, id: ++logId, time: now() }, ...s.log].slice(0, MAX_TEST_LOG),
    })),

  clearLog: () => set({ log: [] }),
  openDialog: () => set({ showTestDialog: true }),
  closeDialog: () => set({ showTestDialog: false }),
  setTestMessage: (msg) => set({ testMessage: msg }),
  setBotRunning: (running) => set({ botRunning: running }),
  loadNodeNames: async (projectPath) => {
    try {
      const res = await window.qqbat.flow.load(projectPath);
      if (res.ok && res.data) {
        const flow = res.data as FlowGraph;
        const names: Record<string, string> = {};
        for (const node of flow.nodes ?? []) {
          names[node.id] = node.data?.label || node.id;
        }
        set({ nodeNames: names });
      }
    } catch {
      /* 忽略，节点名映射非关键路径 */
    }
  },

  sendTest: async (projectPath) => {
    const msg = get().testMessage.trim();
    if (!msg) return;
    set({ testLoading: true });
    try {
      // 运行状态统一从 botManager 取（runtime:* 不再提供控制/状态通道）
      const listRes = await window.qqbat.botManager.list();
      const bot = listRes.ok ? listRes.data?.find((b) => b.projectPath === projectPath) : undefined;
      if (!listRes.ok || bot?.status !== 'running') {
        get().addLog({
          icon: '⚠️',
          source: 'system',
          detail: t('editor.test.botNotRunning'),
          level: 'warn',
        });
        return;
      }
      const res = await window.qqbat.runtime.injectTestMessage(projectPath, msg);
      if (res.ok && res.data?.sent) {
        get().addLog({
          icon: '🧪',
          source: 'test',
          detail: t('editor.test.sent', { msg }),
          level: 'info',
        });
        set({ testMessage: '', showTestDialog: false });
      } else {
        get().addLog({
          icon: '⚠️',
          source: 'system',
          detail: res.error || t('editor.test.sendFailed'),
          level: 'warn',
        });
      }
    } catch (e) {
      get().addLog({
        icon: '❌',
        source: 'system',
        detail: t('editor.test.sendError', { error: String(e) }),
        level: 'error',
      });
    } finally {
      set({ testLoading: false });
    }
  },
}));

/** 将 bot 日志条目转成测试日志（过滤心跳等噪音） */
export function botLogToTestEntry(
  entry: BotLogEntry,
  projectPath: string,
): Omit<TestLogEntry, 'id' | 'time'> | null {
  // projectPath 暂时未使用，预留多项目过滤
  void projectPath;
  if (entry.message.includes('heartbeat_ack') || entry.message.includes('clients=0')) return null;
  const icon = entry.source === 'bot' ? '🔹' : '🔸';
  let source: TestLogSource = entry.source === 'bot' ? 'bot' : 'system';
  if (entry.message.startsWith('[translator]')) source = 'translator';
  else if (entry.message.startsWith('[botManager]')) source = 'manager';
  const cleanMsg = entry.message.replace(/\[translator\] |\[botManager\] /g, '');
  return {
    icon,
    source,
    detail: cleanMsg,
    level: entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info',
  };
}

/** 将节点执行事件转成测试日志 */
export function nodeEventToTestEntry(
  event: ExecuteNodeEvent,
  nodeNames: Record<string, string>,
): Omit<TestLogEntry, 'id' | 'time'> {
  const nodeName = nodeNames[event.nodeId] || event.nodeId;
  const statusIcon = event.status === 'enter' ? '▶️' : event.status === 'exit' ? '✅' : '❌';
  const detail = event.duration !== undefined ? `${nodeName} (${event.duration}ms)` : nodeName;
  return {
    icon: statusIcon,
    source: 'node',
    detail,
    level: event.status === 'error' ? 'error' : 'info',
  };
}
