// src/renderer/src/components/ai/InlineEditBox.tsx
//
// **就地编辑框**（从 ChatPanel 拆出，2026-10-18）：直接长在**那条消息下面**（不是底部输入框）。
// 保存 = 把改后的内容作为新消息发出去（不原地改历史）。
// 语义：**先回退、再发** —— 编辑后从这句重新开始，产物也回退到这条消息之前的版本；
// 回退失败不拦发送，但如实告诉用户"产物没退"。
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { useAiStore } from '../../stores/aiStore';

export function InlineEditBox({
  role,
  content,
  projectPath,
  draft,
  onDraftChange,
  onClose,
}: {
  role: string;
  content: string;
  /** 项目绝对路径（发送要用它；不要在组件里自己猜 conversationPath） */
  projectPath: string | undefined;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();

  const save = (): void => {
    void (async () => {
      const next = draft.trim();
      if (!next || !projectPath) return;
      onClose();
      try {
        const res = await window.qqbat?.ai?.rewindAiTo?.(
          projectPath,
          content,
          useAiStore.getState().activeThreadId,
        );
        if (res && res.ok === false) {
          useAiStore.getState().addMessage({
            role: 'system',
            content: t('ai.chat.rewindFailed', { reason: res.error ?? '' }),
          });
        }
      } catch (e) {
        console.error('[rewind] failed:', e);
      }
      await useAiStore.getState().sendMessage(projectPath, next);
    })();
  };

  return (
    <div className={role === 'user' ? 'flex justify-end pr-8 -mt-1 mb-3' : 'pl-8 -mt-1 mb-3'}>
      <div className="w-full max-w-[85%]">
        <textarea
          className="w-full min-h-[64px] resize-y rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-blue-500/50"
          value={draft}
          autoFocus
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
          <button
            type="button"
            className="text-blue-400 hover:text-blue-300 disabled:opacity-40"
            disabled={!draft.trim()}
            onClick={save}
          >
            {t('ai.chat.editSave')}
          </button>
          <button type="button" className="hover:text-zinc-300" onClick={onClose}>
            {t('ai.chat.editCancel')}
          </button>
          <span className="text-zinc-600">{t('ai.chat.editHint')}</span>
        </div>
      </div>
    </div>
  );
}
