import { useState } from 'react';
import type { AdapterType } from '@shared/types/project';
import { Modal, ModalFooter } from '../ui/Modal';
import { inputForm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: { translatorPort: number }) => void;
  /** 适配器类型 */
  adapter: AdapterType;
  /** 当前翻译器端口 */
  translatorPort: number;
}

export function ConnectionConfigDialog({
  open,
  onClose,
  onSave,
  adapter: _adapter,
  translatorPort: initialPort,
}: Props) {
  useLocaleSubscription();
  const [editTranslatorPort, setEditTranslatorPort] = useState(initialPort);

  const handleSave = () => {
    onSave({
      translatorPort: editTranslatorPort,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('launch.connection.title')}
      width="480px"
      footer={<ModalFooter onCancel={onClose} onConfirm={handleSave} />}
    >
      <div className="space-y-4">
        {/* 翻译器端口 */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            {t('launch.connection.translatorPort')}
          </label>
          <input
            type="number"
            className={`w-full ${inputForm}`}
            value={editTranslatorPort}
            aria-label={t('launch.connection.translatorPort')}
            onChange={(e) => setEditTranslatorPort(parseInt(e.target.value) || 0)}
            min={1}
            max={65535}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('launch.connection.portHint')}</p>
        </div>
      </div>
    </Modal>
  );
}
