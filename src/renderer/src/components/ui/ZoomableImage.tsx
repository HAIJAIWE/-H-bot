// src/renderer/src/components/ui/ZoomableImage.tsx
//
// **可放大的图片**（2026-10-20）：聊天里/待发送的缩略图太小，点一下全屏看。
//
// 用 portal 挂到 document.body：消息列表是 overflow 容器，直接 fixed 也可能被
// 祖先的层叠/裁剪影响；portal 最稳。Esc、点背景、点关闭都能收。
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  /** 缩略图的样式（尺寸/圆角由调用方决定） */
  className?: string;
}): React.ReactNode {
  useLocaleSubscription();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <img
        src={src}
        alt={alt ?? ''}
        className={`cursor-zoom-in ${className ?? ''}`}
        onClick={() => setOpen(true)}
      />
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6"
            role="dialog"
            aria-modal="true"
            aria-label={t('common.imagePreview')}
            onClick={() => setOpen(false)}
          >
            <img
              src={src}
              alt={alt ?? ''}
              className="max-h-full max-w-full rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700"
              onClick={() => setOpen(false)}
              aria-label={t('common.imagePreviewClose')}
              title={t('common.imagePreviewClose')}
            >
              ✕
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
