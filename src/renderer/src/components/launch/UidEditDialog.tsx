import { Modal, ModalFooter } from '../ui/Modal';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface UidEditDialogProps {
  /** 弹窗是否打开（由父组件通过 !!uidEditTarget 推导） */
  open: boolean;
  /** 当前编辑目标（含原 UID 和 openid） */
  uidEditTarget: { uid: string; openid: string | null } | null;
  /** 输入框值 */
  uidEditValue: string;
  /** 错误信息 */
  uidEditError: string;
  /** 是否保存中 */
  uidEditSaving: boolean;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 输入值变更 */
  onValueChange: (v: string) => void;
  /** 保存 */
  onSave: () => void;
}

/**
 * UID 编辑弹窗
 *
 * 原为 DataBrowserPanel 中内联的 Modal，提取为独立组件。
 * 用于修改玩家 UID（需要 openid 映射存在）。
 */
export function UidEditDialog({
  open,
  uidEditTarget,
  uidEditValue,
  uidEditError,
  uidEditSaving,
  onClose,
  onValueChange,
  onSave,
}: UidEditDialogProps) {
  useLocaleSubscription();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('data.browser.editUid')}
      width="320px"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={onSave}
          confirmText={uidEditSaving ? t('launch.common.saving') : t('launch.common.confirmSave')}
          confirmDisabled={uidEditSaving}
        />
      }
    >
      <div className="space-y-2 mb-2">
        <div className="text-xs text-zinc-500">
          {t('data.uid.current')} <span className="text-zinc-300">{uidEditTarget?.uid}</span>
        </div>
        {uidEditTarget?.openid && (
          <div className="text-xs text-zinc-500">
            openid:{' '}
            <span className="text-zinc-300 text-xs" title={uidEditTarget.openid}>
              {uidEditTarget.openid.substring(0, 12)}...
            </span>
          </div>
        )}
        {!uidEditTarget?.openid && (
          <div className="text-xs text-amber-400">{t('data.uid.noMapping')}</div>
        )}
        <div>
          <label className="text-xs text-zinc-500 block mb-1">{t('data.uid.newUid')}</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500"
            value={uidEditValue}
            aria-label={t('data.uid.newUid')}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
            autoFocus
            placeholder={t('data.uid.newUidPlaceholder')}
          />
        </div>
        {uidEditError && <div className="text-xs text-red-400">{uidEditError}</div>}
      </div>
    </Modal>
  );
}
