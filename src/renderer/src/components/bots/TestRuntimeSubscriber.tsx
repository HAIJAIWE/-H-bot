// src/renderer/src/components/bots/TestRuntimeSubscriber.tsx
import { useEffect } from 'react';
import { useTestStore, botLogToTestEntry, nodeEventToTestEntry } from '../../stores/testStore';
import { useProjectStore } from '../../stores/projectStore';
import { useBotStore } from '../../stores/botStore';

/**
 * 全局订阅 runtime 日志与节点执行事件，写入 testStore。
 * 隐藏组件，不渲染任何 UI，在 Workspace 层挂载一次即可。
 * 同时根据当前项目同步 bot 运行状态与节点名映射。
 */
export function TestRuntimeSubscriber() {
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const bots = useBotStore((s) => s.bots);
  const selectedBotPath = useBotStore((s) => s.selectedBotPath);

  const addLog = useTestStore((s) => s.addLog);
  const setBotRunning = useTestStore((s) => s.setBotRunning);
  const loadNodeNames = useTestStore((s) => s.loadNodeNames);

  // 项目变化时重新加载节点名
  useEffect(() => {
    if (projectPath) loadNodeNames(projectPath);
  }, [projectPath, loadNodeNames]);

  // 根据选中 bot 同步运行状态
  useEffect(() => {
    const path = selectedBotPath || bots[0]?.projectPath;
    const bot = bots.find((b) => b.projectPath === path);
    setBotRunning(bot?.status === 'running');
  }, [bots, selectedBotPath, setBotRunning]);

  // 订阅 bot 日志
  useEffect(() => {
    if (!window.qqbat?.runtime?.onLog) return;
    const cleanup = window.qqbat.runtime.onLog((data) => {
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const entry = botLogToTestEntry(item.entry, item.projectPath);
        if (entry) addLog(entry);
      }
    });
    return cleanup;
  }, [addLog]);

  // 订阅节点执行事件
  useEffect(() => {
    if (!window.qqbat?.runtime?.onExecuteNode) return;
    // 主进程发送的 payload 是 { projectPath, event } 包装对象，需解构取 event
    const cleanup = window.qqbat.runtime.onExecuteNode(({ projectPath, event }) => {
      // 多项目过滤：仅当前项目的节点事件才进入测试面板
      if (projectPath && projectPath !== useProjectStore.getState().currentProject?.path) return;
      const nodeNames = useTestStore.getState().nodeNames;
      addLog(nodeEventToTestEntry(event, nodeNames));
    });
    return cleanup;
  }, [addLog]);

  return null;
}
