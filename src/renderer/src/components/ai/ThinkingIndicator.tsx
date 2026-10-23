// src/renderer/src/components/ai/ThinkingIndicator.tsx
//
// **思考中指示器**（从 ChatPanel 拆出，2026-10-19）：流式开始前的那三个跳点。
// 为什么单独拆：这里塞了三个容易各自漂移的运行时信息 —— 当前步骤名（runningLabel）、
// 已耗时（runElapsed）、以及"一旦开始出声就换成 StreamingBubble"的由调用方判断的规则。
// 拆出来之后 ChatPanel 只负责"什么时候显示"，不掺和长什么样。
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function ThinkingIndicator({
  label,
  elapsed,
  step,
}: {
  /** 当前步骤名（工具名/阶段）；没有就不显示 */
  label?: string;
  /** 已耗时（秒）；0 表示不显示 */
  elapsed: number;
  /** 步边界（循环模式）：第几/共几步；没有就不显示 */
  step?: { step: number; maxSteps: number } | null;
}): React.ReactNode {
  useLocaleSubscription();
  return (
    <div className="flex gap-2 mb-3">
      <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-300 flex-shrink-0">
        AI
      </div>
      <div
        className="flex items-center gap-1 px-3 py-2 rounded-lg bg-zinc-800/80 rounded-tl-sm"
        role="status"
        aria-label={t('ai.chat.thinkingAria')}
      >
        {step && (
          <span className="mr-1 text-[11px] text-sky-300" title={t('ai.chat.sessionStepTitle')}>
            {t('ai.chat.sessionStep', { step: String(step.step), max: String(step.maxSteps) })}
          </span>
        )}
        {label && <span className="mr-1 text-[11px] text-zinc-400">{label}</span>}
        <span
          className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
        {elapsed > 0 && <span className="ml-1.5 text-[11px] text-zinc-500">{elapsed}s</span>}
      </div>
    </div>
  );
}
