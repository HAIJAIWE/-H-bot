// src/renderer/src/components/ui/JsonEditModePanel.tsx
import { Button } from './Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/**
 * JSON 编辑模式切换面板 —— 抽取自 SwitchCaseEditor / EndNodeConfigEditor / SubflowParamsEditor
 * 三个编辑器组件共有的"可视化编辑 ↔ JSON 编辑"切换 UI。
 *
 * 与 useJsonEditMode hook 配套使用：
 * - 编辑模式：显示 textarea + 应用/取消按钮 + 错误提示
 * - 非编辑模式：显示"JSON 编辑模式"按钮 + 可选的"查看 JSON"折叠预览
 *
 * @param jsonMode 是否处于 JSON 编辑模式
 * @param jsonText JSON 文本
 * @param jsonError 错误信息（空串表示无错误）
 * @param onEnter 进入 JSON 编辑模式
 * @param onExit 退出 JSON 编辑模式（取消）
 * @param onApply 应用 JSON
 * @param onTextChange JSON 文本变更
 * @param ariaLabel textarea 的无障碍标签
 * @param previewData 非编辑模式下"查看 JSON"折叠预览的数据（数组非空 / 非空对象时显示）
 */
export function JsonEditModePanel({
  jsonMode,
  jsonText,
  jsonError,
  onEnter,
  onExit,
  onApply,
  onTextChange,
  ariaLabel,
  previewData,
}: {
  jsonMode: boolean;
  jsonText: string;
  jsonError: string;
  onEnter: () => void;
  onExit: () => void;
  onApply: () => void;
  onTextChange: (text: string) => void;
  ariaLabel: string;
  previewData?: unknown;
}) {
  // 数组空 / null / undefined 时不显示"查看 JSON"
  useLocaleSubscription();
  const showPreview =
    previewData != null && !(Array.isArray(previewData) && previewData.length === 0);

  if (jsonMode) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">{t('ui.jsonEdit')}</span>
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onApply}
              className="text-blue-400 hover:text-blue-300"
            >
              {t('ui.apply')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onExit}
              className="text-zinc-500 hover:text-zinc-300"
            >
              {t('launch.common.cancel')}
            </Button>
          </div>
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => onTextChange(e.target.value)}
          rows={5}
          aria-label={ariaLabel}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono resize-y"
        />
        {jsonError && <div className="text-xs text-red-400">{jsonError}</div>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onEnter}
        className="text-zinc-500 hover:text-zinc-300"
      >
        {t('ui.jsonEditMode')}
      </Button>
      {showPreview && (
        <details className="text-xs ml-auto">
          <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300">
            {t('ui.viewJson')}
          </summary>
          <pre className="mt-1 bg-zinc-900 rounded px-2 py-1.5 border border-zinc-700 text-xs text-zinc-300 font-mono overflow-x-auto">
            {JSON.stringify(previewData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
