// 通用确认弹窗：替代 window.confirm，风格与 Modal 一致

import type { ReactNode } from 'react';
import { Modal, ModalFooter } from './Modal';
import { AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  /** 提示消息（与 children 互斥，优先使用 children） */
  message?: string;
  /** 自定义内容（如输入框），与 message 互斥 */
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 确认按钮变体，危险操作用 danger */
  variant?: 'primary' | 'danger';
  /** 是否显示警告图标 */
  warning?: boolean;
  /** 确认按钮是否禁用 */
  confirmDisabled?: boolean;
}

/**
 * 通用确认弹窗：替代 window.confirm
 *
 * 用法 1（简单消息）：
 * ```tsx
 * <ConfirmDialog open={show} onClose={close} onConfirm={handle}
 *   message="确定要删除吗？" variant="danger" />
 * ```
 *
 * 用法 2（自定义内容）：
 * ```tsx
 * <ConfirmDialog open={show} onClose={close} onConfirm={handle} title="克隆">
 *   <input ... />
 * </ConfirmDialog>
 * ```
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = t('ui.confirmTitle'),
  message,
  children,
  confirmText = t('ui.confirm'),
  cancelText = t('launch.common.cancel'),
  variant = 'primary',
  warning = variant === 'danger',
  confirmDisabled = false,
}: ConfirmDialogProps) {
  useLocaleSubscription();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="420px"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={onConfirm}
          cancelText={cancelText}
          confirmText={confirmText}
          confirmVariant={variant}
          confirmDisabled={confirmDisabled}
        />
      }
    >
      {children ?? (
        <div className="flex items-start gap-3">
          {warning && (
            <AlertTriangle aria-hidden="true" className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          )}
          <p className="text-sm text-zinc-300 whitespace-pre-line">{message}</p>
        </div>
      )}
    </Modal>
  );
}
