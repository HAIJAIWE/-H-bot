// 从 BlockEditor.tsx 拆分而来（P0-D1 重构）
// 分组与子流程弹窗组件：CreateGroupDialog、RenameGroupDialog、CreateSubflowDialog
import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 创建分组弹窗：输入标题后创建分组 */
export function CreateGroupDialog({
  nodeCount,
  onCancel,
  onConfirm,
}: {
  nodeCount: number;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  useLocaleSubscription();
  const [title, setTitle] = useState('');
  return (
    <ConfirmDialog
      open
      onClose={onCancel}
      onConfirm={() => onConfirm(title.trim() || t('blocks.group.unnamed'))}
      title={t('blocks.group.createTitle', { count: nodeCount })}
      confirmText={t('launch.common.confirmCreate')}
      confirmDisabled={title.trim().length === 0}
    >
      <div className="space-y-2">
        <label className="text-xs text-zinc-400">{t('blocks.group.titleLabel')}</label>
        <input
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          placeholder={t('blocks.group.titlePlaceholder')}
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) onConfirm(title.trim());
          }}
        />
        <p className="text-xs text-zinc-500">{t('blocks.group.hint')}</p>
      </div>
    </ConfirmDialog>
  );
}

/** 重命名分组弹窗 */
export function RenameGroupDialog({
  initialTitle,
  onCancel,
  onConfirm,
}: {
  initialTitle: string;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  useLocaleSubscription();
  const [title, setTitle] = useState(initialTitle);
  return (
    <ConfirmDialog
      open
      onClose={onCancel}
      onConfirm={() => onConfirm(title.trim() || initialTitle)}
      title={t('blocks.editor.renameGroup')}
      confirmText={t('settings.aiProvider.confirmSave')}
      confirmDisabled={title.trim().length === 0}
    >
      <div className="space-y-2">
        <label className="text-xs text-zinc-400">{t('blocks.group.titleLabel')}</label>
        <input
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) onConfirm(title.trim());
          }}
        />
      </div>
    </ConfirmDialog>
  );
}

/** 折叠成子流程弹窗：输入子流程名后创建 subflow_defined + subflow_call */
export function CreateSubflowDialog({
  nodeCount,
  onCancel,
  onConfirm,
}: {
  nodeCount: number;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  useLocaleSubscription();
  const [name, setName] = useState('');
  return (
    <ConfirmDialog
      open
      onClose={onCancel}
      onConfirm={() => onConfirm(name.trim() || t('drawer.unnamedSubflow'))}
      title={t('blocks.subflow.createTitle', { count: nodeCount })}
      confirmText={t('blocks.subflow.confirm')}
      confirmDisabled={name.trim().length === 0}
    >
      <div className="space-y-2">
        <label className="text-xs text-zinc-400">{t('blocks.subflow.nameLabel')}</label>
        <input
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          placeholder={t('blocks.subflow.namePlaceholder')}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onConfirm(name.trim());
          }}
        />
        <p className="text-xs text-zinc-500 leading-relaxed">{t('blocks.subflow.hint')}</p>
      </div>
    </ConfirmDialog>
  );
}
