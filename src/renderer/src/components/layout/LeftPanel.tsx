import { useUiStore } from '../../stores/uiStore';
import { NodePalette } from '../canvas/NodePalette';
import { ButtonPanelSideList } from '../canvas/ButtonPanelSideList';
import { BotManagerPanel } from '../bots/BotManagerPanel';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function LeftPanel() {
  useLocaleSubscription();
  const mode = useUiStore((s) => s.mode);

  if (mode === 'launch' || mode === 'browser') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-zinc-950 border-r border-zinc-800">
        <BotManagerPanel />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-950 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800 shrink-0">
        <h3 className="text-xs font-semibold text-zinc-400">{t('launch.left.nodeLibrary')}</h3>
      </div>
      <NodePalette />
      {/* 按钮面板快捷列表：点击面板自动创建配好按钮的 message_send 节点 */}
      <ButtonPanelSideList />
    </div>
  );
}
