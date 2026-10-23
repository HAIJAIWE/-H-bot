// src/renderer/src/lib/ai/builtinAiSlots.tsx
//
// **内置贡献**：把原本硬编码在 ChatPanel 里的"输入提示语"改成一段插槽内容 ——
// 既证明插槽真的通了，也让 ChatPanel 少一行硬编码。
// 以后模型/用量、附件入口都按这个形状注册（数据从哪来，由贡献方自己取）。
import { t } from '../../i18n';
import { registerAiSlot } from './uiSlots';

registerAiSlot({
  id: 'builtin.enter-hint',
  slot: 'composer.hint',
  order: 10,
  render: () => <p className="text-xs text-zinc-500 mt-1 px-1">{t('ai.chat.enterHint')}</p>,
});
