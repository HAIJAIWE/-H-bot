// src/renderer/src/components/canvas/ButtonPanelSideList.tsx
// 左侧按钮面板快捷列表：点击面板 → 自动创建配好按钮的 message_send(keyboard) 节点
//
// 设计意图：
//   按钮面板是"资源"，message_send(keyboard) 是"引用方"。
//   用户在左侧看到面板列表，点击即创建一个带好按钮配置的 message_send 节点——
//   不用先创建节点再去 PropertyDrawer 里选面板，"接上"这一步直接完成。

import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useFlowStore } from '../../stores/flowStore';
import { useUiStore } from '../../stores/uiStore';
import { createNode } from '../../lib/canvas/nodeFactory';
import { useToast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import type { ButtonPanel } from '@shared/types/buttonPanel';
import { LayoutTemplate, Plus, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function ButtonPanelSideList() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const addNode = useFlowStore((s) => s.addNode);
  const selectNode = useFlowStore((s) => s.selectNode);
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const setCenterTab = useUiStore((s) => s.setCenterTab);
  const toast = useToast();

  const [panels, setPanels] = useState<ButtonPanel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const reload = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await window.qqbat.buttonPanel.list(projectPath);
      if (res.ok && res.data) {
        setPanels(res.data);
      } else {
        setLoadError(res.error || t('canvas.buttonPanel.loadFailed'));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** 点击面板：创建一个配好按钮的 message_send(keyboard) 节点 */
  const handlePickPanel = useCallback(
    (panel: ButtonPanel) => {
      const node = createNode('message_send', { x: 0, y: 0 });
      // 先添加节点到 store，再更新配置（updateNodeConfig 需要节点已在 store 中）
      addNode(node);
      // 防御性兜底：countButtons 内部已用 panel.keyboard?.rows ?? [] 暗示 keyboard 可能为 undefined，
      // JSON.parse(JSON.stringify(undefined)) 会抛 SyntaxError 导致整个左侧栏崩溃
      const keyboardCopy = panel.keyboard
        ? (JSON.parse(JSON.stringify(panel.keyboard)) as typeof panel.keyboard)
        : { rows: [] };
      updateNodeConfig(node.id, {
        mode: 'keyboard',
        keyboard: keyboardCopy,
        panelId: panel.id,
        markdown: `## ${panel.name}\n${panel.description || ''}`,
        text: '',
      });
      selectNode(node.id);
      toast.success(
        t('canvas.buttonPanel.created', {
          name: panel.name,
          count: countButtons(panel),
        }),
      );
    },
    [addNode, updateNodeConfig, selectNode, toast],
  );

  const buttonCount = (p: ButtonPanel) => countButtons(p);

  return (
    <div className="border-t border-zinc-800 shrink-0">
      {/* 标题栏 */}
      <Button
        variant="ghost"
        className="w-full px-3 py-2 flex items-center justify-between text-sm font-semibold text-zinc-400 uppercase hover:bg-zinc-900"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-1.5">
          <LayoutTemplate className="w-3.5 h-3.5" />
          {t('canvas.buttonPanel.title')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500 normal-case font-normal">
            {t('editor.count.units', { count: panels.length })}
          </span>
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown aria-hidden="true" className="w-3.5 h-3.5" />
          )}
        </span>
      </Button>

      {!collapsed && (
        <div className="px-2 pb-2 space-y-1 max-h-64 overflow-y-auto">
          {loading && (
            <div className="text-xs text-zinc-500 px-2 py-1">{t('editor.action.loading')}</div>
          )}
          {!loading && loadError && (
            <div className="px-2 py-1.5">
              <p className="text-xs text-red-400 mb-1 truncate" title={loadError}>
                {loadError}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-blue-400 hover:text-blue-300"
                onClick={reload}
              >
                {t('panel.crash.retry')}
              </Button>
            </div>
          )}
          {!loading && !loadError && panels.length === 0 && (
            <EmptyState
              title={t('launch.common.noPanels')}
              description={t('canvas.buttonPanel.emptyHint')}
            />
          )}
          {!loading &&
            !loadError &&
            panels.map((panel) => (
              <div
                key={panel.id}
                onClick={() => handlePickPanel(panel)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePickPanel(panel);
                  }
                }}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer border border-transparent hover:border-zinc-600 transition-colors"
                title={t('canvas.buttonPanel.createHint', {
                  name: panel.name,
                  count: buttonCount(panel),
                })}
                role="button"
                tabIndex={0}
              >
                <LayoutTemplate className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span className="truncate flex-1">{panel.name}</span>
                <span className="text-xs text-zinc-500 shrink-0">
                  {t('canvas.buttonPanel.buttonCount', { count: buttonCount(panel) })}
                </span>
              </div>
            ))}

          {/* 底部操作 */}
          <div className="flex items-center gap-1 pt-1 border-t border-zinc-800/50 mt-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => setCenterTab('panels')}
              title={t('canvas.buttonPanel.manageTitle')}
            >
              <Plus aria-hidden="true" className="w-3 h-3" />
              {t('canvas.buttonPanel.manage')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center justify-center px-2 py-1 rounded text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={reload}
              title={t('canvas.buttonPanel.refresh')}
              leftIcon={<RefreshCw className="w-3 h-3" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 统计面板按钮总数 */
function countButtons(panel: ButtonPanel): number {
  let n = 0;
  for (const row of panel.keyboard?.rows ?? []) {
    if (row?.buttons) n += row.buttons.length;
  }
  return n;
}
