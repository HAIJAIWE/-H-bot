// src/renderer/src/pages/Workspace.tsx
import { useEffect, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { ThreeColumn } from '../components/layout/ThreeColumn';
import { TestDialog } from '../components/bots/TestDialog';
import { TestRuntimeSubscriber } from '../components/bots/TestRuntimeSubscriber';
import { useBotStore } from '../stores/botStore';
import { useProjectStore } from '../stores/projectStore';
import { useUiStore } from '../stores/uiStore';
import { NewProjectDialog } from '../components/project/NewProjectDialog';
import type { ProjectMeta } from '@shared/types/project';

export function Workspace() {
  // 使用选择器精确订阅，避免整个 store 变化触发重渲染
  const bots = useBotStore((s) => s.bots);
  const selectedBotPath = useBotStore((s) => s.selectedBotPath);
  const loading = useBotStore((s) => s.loading);
  const init = useBotStore((s) => s.init);
  const [showNewProject, setShowNewProject] = useState(false);
  const [dismissedNewProject, setDismissedNewProject] = useState(false);

  // 初始化 bot 列表
  useEffect(() => {
    const cleanup = init();
    return () => cleanup();
  }, [init]);

  // 无项目时弹出新建对话框（仅一次）
  useEffect(() => {
    if (!loading && !dismissedNewProject && bots.length === 0) {
      setShowNewProject(true);
    }
  }, [loading, dismissedNewProject, bots.length]);

  // 默认选中第一个 bot
  useEffect(() => {
    if (!selectedBotPath && bots.length > 0) {
      useBotStore.getState().selectBot(bots[0]?.projectPath ?? '');
    }
  }, [bots, selectedBotPath]);

  // selectedBotPath 变化时同步 currentProject
  // P2 修复：加 cancelled 标志防止竞态（快速切换项目时旧响应覆盖新数据），
  // 组件卸载后不再更新 store；补 .catch 防止未处理 rejection
  useEffect(() => {
    if (!selectedBotPath || !window.qqbat?.project) return;
    const api = window.qqbat.project as unknown as {
      getMeta: (path: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
    let cancelled = false;
    api
      .getMeta(selectedBotPath)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          useProjectStore.getState().setCurrentProject(res.data as ProjectMeta);
        }
      })
      .catch(() => {
        // getMeta 失败时不阻塞 UI，currentProject 保持上一次值
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBotPath]);

  return (
    <div className="h-screen flex flex-col">
      <header>
        <TopBar />
      </header>
      <ThreeColumn />

      <TestRuntimeSubscriber />
      <TestDialog />

      {showNewProject && (
        <NewProjectDialog
          open
          onClose={() => {
            setShowNewProject(false);
            setDismissedNewProject(true);
          }}
          onCreated={async (meta) => {
            setShowNewProject(false);
            useProjectStore.getState().setCurrentProject(meta);
            // 刷新 bot 列表：用 loadBots() 而非 init()，避免重复订阅 onStatusChanged 监听器导致泄漏
            // （init() 会新建一个监听器且返回的 unsub 被丢弃；监听器只应在挂载时订阅一次）
            useBotStore.getState().loadBots();
            // 自动切换到低代码面板（开发模式）
            useUiStore.getState().setMode('dev');
            useUiStore.getState().setCenterTab('blocks');
          }}
        />
      )}
    </div>
  );
}
