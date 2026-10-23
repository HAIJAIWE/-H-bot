// src/renderer/src/components/bots/TestDialog.tsx
import { useTestStore } from '../../stores/testStore';
import { useProjectStore } from '../../stores/projectStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 模拟测试对话框 —— 全局单例，由 testStore.showTestDialog 控制显隐 */
export function TestDialog() {
  useLocaleSubscription();
  const show = useTestStore((s) => s.showTestDialog);
  const message = useTestStore((s) => s.testMessage);
  const loading = useTestStore((s) => s.testLoading);
  const setMessage = useTestStore((s) => s.setTestMessage);
  const close = useTestStore((s) => s.closeDialog);
  const sendTest = useTestStore((s) => s.sendTest);
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');

  const handleSend = () => {
    // 与「发送」按钮 disabled 条件保持一致：空消息或加载中不允许发送
    // 原实现 Ctrl+Enter 时不检查 disabled，可发送空消息或在加载中重复发送
    if (!projectPath || !message.trim() || loading) return;
    sendTest(projectPath);
  };

  return (
    <Modal
      open={show}
      onClose={close}
      title={t('launch.test.titleIcon')}
      width="384px"
      footer={
        <div className="w-full flex items-center justify-between">
          <span className="text-xs text-zinc-500">{t('launch.test.ctrlEnterHint')}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="px-3 hover:bg-transparent hover:text-zinc-200"
              onClick={close}
            >
              {t('launch.common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="px-3"
              disabled={!message.trim() || loading}
              onClick={handleSend}
            >
              {loading ? t('launch.test.sending') : t('launch.test.send')}
            </Button>
          </div>
        </div>
      }
    >
      <p className="text-xs text-zinc-500 mb-3">{t('launch.test.hint')}</p>
      <textarea
        className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none resize-none h-20 focus:border-blue-500"
        placeholder={t('launch.test.placeholder')}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
        }}
        autoFocus
      />
    </Modal>
  );
}
