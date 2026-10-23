// src/renderer/src/components/ai/ChatEmptyState.tsx
//
// **空态**（从 ChatPanel 拆出，2026-10-18）：没有消息时的欢迎语 + 快捷动作。
// 拆出来的理由：它依赖少（模式 + 发送回调），是消息区里最容易独立的一块。
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import type { AgentMode } from '@shared/ai/roleDomains';
import { Button } from '../ui/Button';

/** 空面板上的快捷操作（随空态一起从 ChatPanel 拆出）：按页面/模式给不同入口 */
function QuickActions({
  onAction,
  mode,
}: {
  onAction: (prompt: string) => void;
  mode: AgentMode;
}): React.ReactNode {
  const flowActions = [
    { label: t('ai.quick.analyze'), prompt: t('ai.quick.analyzePrompt') },
    { label: t('ai.quick.layout'), prompt: t('ai.quick.layoutPrompt') },
    { label: t('ai.quick.generate'), prompt: t('ai.quick.generatePrompt') },
    { label: t('ai.quick.explain'), prompt: t('ai.quick.explainPrompt') },
  ];
  const codeActions = [
    { label: t('ai.quick.readCode'), prompt: t('ai.quick.readCodePrompt') },
    { label: t('ai.quick.reviewCode'), prompt: t('ai.quick.reviewCodePrompt') },
    { label: t('ai.quick.newNode'), prompt: t('ai.quick.newNodePrompt') },
    { label: t('ai.quick.debugLogs'), prompt: t('ai.quick.debugLogsPrompt') },
  ];
  const creatorActions = [
    { label: t('ai.quick.creatorFeature'), prompt: t('ai.quick.creatorFeaturePrompt') },
    { label: t('ai.quick.creatorWhere'), prompt: t('ai.quick.creatorWherePrompt') },
    { label: t('ai.quick.creatorReadFile'), prompt: t('ai.quick.creatorReadFilePrompt') },
    { label: t('ai.quick.creatorTests'), prompt: t('ai.quick.creatorTestsPrompt') },
  ];
  const actions =
    mode === 'creator'
      ? creatorActions
      : mode === 'code'
        ? codeActions
        : mode === 'duo'
          ? [...flowActions.slice(0, 2), ...codeActions.slice(0, 2)]
          : flowActions;

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="ghost"
          size="sm"
          className="px-3 py-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/40 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          onClick={() => onAction(action.prompt)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export function ChatEmptyState({
  mode,
  onAction,
}: {
  mode: AgentMode;
  onAction: (text: string) => void;
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <span className="text-xl">🤖</span>
      </div>
      <p className="text-sm text-zinc-400 mb-1">{t('panel.right.ai')}</p>
      <p className="text-xs text-zinc-500 mb-4">
        {t(
          mode === 'code'
            ? 'ai.chat.hintCode'
            : mode === 'duo'
              ? 'ai.chat.hintDuo'
              : mode === 'creator'
                ? 'ai.chat.hintCreator'
                : 'ai.chat.hint',
        )}
      </p>
      <QuickActions onAction={onAction} mode={mode} />
    </div>
  );
}
