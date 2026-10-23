// src/renderer/src/components/blocks/MessageActionEditor.tsx
// message_send / reply_message 节点的配置编辑器
// 从 PropertyDrawer 中拆出：按钮消息编辑器（面板引用、Markdown 文本、按钮配置）
import { memo, useState, useEffect } from 'react';
import type { InlineKeyboard } from '@shared/types/keyboard';
import { createEmptyKeyboard } from '@shared/types/keyboard';
import type { ButtonPanel } from '@shared/types/buttonPanel';
import { KeyboardEditor } from './KeyboardEditor';
import { DebouncedTextarea } from './DebouncedInputs';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { inputForm } from '../ui/inputStyles';
import { useToast } from '../ui/Toast';
import { LayoutTemplate, Plus, RefreshCcw, RefreshCw } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface MessageActionEditorProps {
  /** 当前节点 ID */
  nodeId: string;
  /** 节点配置对象 */
  config: Record<string, unknown>;
  /** 配置变更回调 */
  onConfigChange: (patch: Record<string, unknown>) => void;
  /** 项目路径 */
  projectPath: string;
}

/** message_send / reply_message 节点的配置编辑器（按钮UI模式） */
export const MessageActionEditor = memo(function MessageActionEditor({
  nodeId,
  config,
  onConfigChange,
  projectPath,
}: MessageActionEditorProps) {
  useLocaleSubscription();
  const toast = useToast();

  // 按钮面板列表
  const [panels, setPanels] = useState<ButtonPanel[]>([]);
  const [newPanelName, setNewPanelName] = useState(''); // 新建面板内联输入
  const [panelOperating, setPanelOperating] = useState(false); // 面板异步操作 loading

  useEffect(() => {
    if (!projectPath) return;
    window.qqbat.buttonPanel
      .list(projectPath)
      .then((res) => {
        if (res.ok && res.data) setPanels(res.data);
      })
      .catch((err) => {
        toast.error(
          t('blocks.messageAction.operationFailed', { error: String(err?.message ?? err) }),
        );
      });
  }, [projectPath, toast]);

  return (
    <div className="space-y-3">
      {/* 面板引用：从全局面板库选择，选中后复制 keyboard 到节点 */}
      <div>
        <label className="flex items-center justify-between text-xs text-zinc-400 mb-1">
          <span className="flex items-center gap-1.5">
            <LayoutTemplate className="w-3.5 h-3.5" />
            {t('blocks.messageAction.panelRefLabel')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNewPanelName(t('blocks.messageAction.newPanel'))}
            className="text-blue-400 hover:text-blue-300"
            title={t('blocks.messageAction.newPanelTitle')}
            leftIcon={<Plus className="w-3 h-3" />}
          >
            {t('launch.common.create')}
          </Button>
        </label>
        {newPanelName !== '' && (
          <div className="flex items-center gap-2 mb-1">
            <input
              className={`flex-1 ${inputForm}`}
              aria-label={t('blocks.messageAction.newPanelPlaceholder')}
              value={newPanelName}
              onChange={(e) => setNewPanelName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newPanelName.trim() && projectPath) {
                  const res = await window.qqbat.buttonPanel.create(projectPath, {
                    name: newPanelName.trim(),
                  });
                  if (res.ok && res.data) {
                    setPanels((prev) => [...prev, res.data!]);
                    onConfigChange({
                      panelId: res.data!.id,
                      keyboard: JSON.parse(JSON.stringify(res.data!.keyboard)),
                    });
                    setNewPanelName('');
                  } else {
                    toast.error(res.error || t('blocks.messageAction.createPanelFailed'));
                  }
                }
                if (e.key === 'Escape') setNewPanelName('');
              }}
              placeholder={t('blocks.messageAction.newPanelHint')}
              autoFocus
            />
            <Button variant="ghost" size="sm" onClick={() => setNewPanelName('')}>
              {t('editor.action.cancel')}
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Dropdown
            value={(config?.panelId as string) ?? ''}
            ariaLabel={t('canvas.buttonPanel.title')}
            onChange={async (v) => {
              if (!v) {
                // 清空引用，保留现有 keyboard
                onConfigChange({ panelId: '' });
                return;
              }
              // 从面板库拉取最新 keyboard 并复制到节点
              if (!projectPath) return;
              const res = await window.qqbat.buttonPanel.get(projectPath, v);
              if (res.ok && res.data) {
                onConfigChange({
                  panelId: v,
                  keyboard: JSON.parse(JSON.stringify(res.data!.keyboard)),
                });
              } else {
                toast.error(res.error || t('blocks.messageAction.loadPanelFailed'));
              }
            }}
            options={[
              { value: '', label: t('blocks.messageAction.noPanelRef') },
              ...panels.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className="flex-1"
          />
          {(config?.panelId as string) && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={panelOperating}
                onClick={async () => {
                  const pid = config?.panelId as string;
                  if (!pid || !projectPath) return;
                  setPanelOperating(true);
                  try {
                    const res = await window.qqbat.buttonPanel.get(projectPath, pid);
                    if (res.ok && res.data) {
                      onConfigChange({
                        keyboard: JSON.parse(JSON.stringify(res.data!.keyboard)),
                      });
                    } else {
                      toast.error(res.error || t('blocks.messageAction.syncFailed'));
                    }
                  } finally {
                    setPanelOperating(false);
                  }
                }}
                className="border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                title={t('blocks.messageAction.syncTitle')}
                leftIcon={<RefreshCcw className="w-3 h-3" />}
              >
                {t('blocks.messageAction.sync')}
              </Button>
              <Button
                type="button"
                variant="success"
                size="sm"
                loading={panelOperating}
                onClick={async () => {
                  const pid = config?.panelId as string;
                  if (!pid || !projectPath) return;
                  const kb = config?.keyboard;
                  if (!kb) return;
                  setPanelOperating(true);
                  try {
                    const res = await window.qqbat.buttonPanel.update(projectPath, {
                      panelId: pid,
                      patch: { keyboard: kb as InlineKeyboard },
                    });
                    if (res.ok) {
                      toast.success(t('blocks.messageAction.savedToPanel'));
                    } else {
                      toast.error(res.error || t('editor.code.saveFailed'));
                    }
                  } finally {
                    setPanelOperating(false);
                  }
                }}
                className="border border-zinc-700"
                title={t('blocks.messageAction.saveBackTitle')}
                leftIcon={<RefreshCw className="w-3 h-3" />}
              >
                {t('blocks.messageAction.saveBack')}
              </Button>
            </>
          )}
        </div>
        {(config?.panelId as string) && (
          <div className="mt-1 text-xs text-zinc-500">{t('blocks.messageAction.panelRefNote')}</div>
        )}
      </div>
      {/* Markdown 文本框 */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          {t('blocks.messageAction.markdownLabel')}
        </label>
        <DebouncedTextarea
          value={(config?.markdown as string) ?? ''}
          onChange={(v) => onConfigChange({ markdown: v })}
          rows={4}
          className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 font-mono"
          placeholder={t('launch.panel.markdownPlaceholder')}
          ariaLabel={t('blocks.messageAction.markdownLabel')}
        />
      </div>
      {/* 按钮配置 */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">{t('field.label.keyboard')}</label>
        <KeyboardEditor
          value={(config?.keyboard as InlineKeyboard) ?? createEmptyKeyboard()}
          onChange={(kb) => onConfigChange({ keyboard: kb })}
          markdown={(config?.markdown as string) ?? ''}
          nodeId={nodeId}
        />
      </div>
    </div>
  );
});
