// 从 BlockEditor.tsx 拆分而来（P0-D1 重构）
// 快捷键帮助 Modal：? 键触发，展示全部快捷键列表
import { Modal } from '../ui/Modal';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 快捷键帮助 Modal（? 键触发） */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLocaleSubscription();
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={t('blocks.shortcuts.title')} width="480px">
      <div className="space-y-1 text-sm">
        {[
          [t('blocks.shortcuts.connectKey'), t('blocks.shortcuts.connectDesc')],
          ['Ctrl + Z / Ctrl + Y', t('blocks.shortcuts.undoRedo')],
          ['Ctrl + C / Ctrl + V', t('blocks.shortcuts.copyPaste')],
          ['Ctrl + F', t('blocks.shortcuts.searchNodes')],
          ['Backspace / Delete', t('blocks.shortcuts.deleteSelected')],
          [t('blocks.shortcuts.ctrlClickKey'), t('blocks.shortcuts.ctrlClickDesc')],
          ['Ctrl + A', t('blocks.shortcuts.selectAll')],
          ['Esc', t('blocks.shortcuts.escDesc')],
          [t('blocks.shortcuts.shiftDragKey'), t('blocks.shortcuts.shiftDragDesc')],
          [t('blocks.shortcuts.dragPaneKey'), t('blocks.shortcuts.dragPaneDesc')],
          [t('blocks.shortcuts.wheelKey'), t('blocks.shortcuts.wheelDesc')],
          [t('blocks.shortcuts.dblClickKey'), t('blocks.shortcuts.dblClickDesc')],
          [t('blocks.shortcuts.rightClickKey'), t('blocks.shortcuts.rightClickDesc')],
          ['?', t('blocks.shortcuts.showHelp')],
        ].map(([key, desc]) => (
          <div
            key={key}
            className="flex items-center justify-between py-1.5 border-b border-zinc-800"
          >
            <code className="text-blue-300 text-xs bg-zinc-800 px-2 py-0.5 rounded">{key}</code>
            <span className="text-zinc-300">{desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
