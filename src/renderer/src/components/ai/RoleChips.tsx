// src/renderer/src/components/ai/RoleChips.tsx
//
// 角色选择 chips（输入框上方那排「角色：🧩流程助手 📝代码助手 …」）。
//
// 2026-10-24 修的是**换行后的观感**：原来是"一个带外框的 flex 容器装 4 个按钮"，
// 窄窗口（869px 时中栏只有 ~380–500px）下外框被挤窄 → 每个按钮内部的文字自己折行，
// 结果四个 chip 高低不齐、像二维码。现在每个 chip 都是**独立药丸**，整排 flex-wrap：
// 窄了就整颗往下换行，绝不在按钮内部断字（whitespace-nowrap），行高统一。
import { t } from '@renderer/i18n';
import { useLocaleSubscription } from '@renderer/stores/i18nStore';
import type { AgentMode } from '@shared/ai/roleDomains';
import { AI_MODE_BUTTONS } from './agentModes';

export interface RoleChipsProps {
  /** 当前生效的角色（跟随页面时也要传解析后的那个） */
  value: AgentMode;
  onChange: (mode: AgentMode) => void;
  /** 传了就显示「跟随页面」；不传 = 当前本来就跟页面走 */
  onReset?: () => void;
}

export function RoleChips({ value, onChange, onReset }: RoleChipsProps) {
  // 组件用了 t() 就必须订阅语言变化 —— 否则切语言时它不重渲染（i18n 闸门抓着这条）
  useLocaleSubscription();
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {AI_MODE_BUTTONS.map(({ mode, icon, labelKey, hintKey }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            title={t(hintKey)}
            onClick={() => onChange(mode)}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1 py-0.5 leading-4 transition-colors ${
              active
                ? 'border-blue-500/60 bg-blue-500/20 text-blue-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="whitespace-nowrap px-0.5 text-zinc-500 underline hover:text-zinc-300"
        >
          {t('ai.mode.followPage')}
        </button>
      )}
    </div>
  );
}
