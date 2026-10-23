// 从 BlockEditor.tsx 拆分而来（P0 批次 7）
// 新建链菜单：触发器选择 + 系统归入选择
import { useState, memo } from 'react';
import type { SystemGroup } from '@shared/types/flow';
import { BlockInsertMenu } from './BlockInsertMenu';
import { Dropdown } from '../ui/Dropdown';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface NewChainMenuProps {
  systems: SystemGroup[];
  onPick: (kind: string, systemId?: string) => void;
  onClose: () => void;
}

export const NewChainMenu = memo(function NewChainMenu({
  systems,
  onPick,
  onClose,
}: NewChainMenuProps) {
  useLocaleSubscription();
  const [systemId, setSystemId] = useState('');
  return (
    <div className="bg-zinc-800/95 border border-zinc-700 rounded-md p-2 max-h-72 overflow-auto shadow-lg">
      {systems.length > 0 && (
        <div className="mb-2">
          <label className="text-xs text-zinc-500 block mb-1">
            {t('blocks.newChain.systemLabel')}
          </label>
          <Dropdown
            value={systemId}
            onChange={(v) => setSystemId(v)}
            options={[
              { value: '', label: t('blocks.newChain.noSystem') },
              ...systems.map((s) => ({ value: s.id, label: `${s.icon} ${s.name}` })),
            ]}
          />
        </div>
      )}
      <BlockInsertMenu
        triggersOnly
        onPick={(kind) => onPick(kind, systemId || undefined)}
        onClose={onClose}
      />
    </div>
  );
});
