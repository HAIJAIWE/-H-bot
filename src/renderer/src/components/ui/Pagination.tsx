// 分页组件：上一页/下一页按钮 + 页码显示 + 跳页输入

import { useState } from 'react';
import { Button } from './Button';
import { inputSm } from './inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface PaginationProps {
  /** 当前页（从 1 开始） */
  page: number;
  /** 总页数 */
  totalPages: number;
  /** 翻页回调 */
  onPageChange: (page: number) => void;
}

/** 分页控件：支持直接跳页 */
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  useLocaleSubscription();
  const [jumpValue, setJumpValue] = useState('');

  const handleJump = () => {
    const n = parseInt(jumpValue, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n);
    }
    setJumpValue('');
  };

  if (totalPages <= 1) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>{t('ui.pageOf', { page: String(page), total: String(totalPages) })}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={t('ui.prevPage')}
      >
        {t('ui.prevPage')}
      </Button>
      <span className="text-zinc-300" aria-live="polite">
        {t('ui.pageOf', { page: String(page), total: String(totalPages) })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label={t('ui.nextPage')}
      >
        {t('ui.nextPage')}
      </Button>
      <div className="flex items-center gap-1 ml-1">
        <span>{t('ui.jumpTo')}</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleJump();
          }}
          onBlur={handleJump}
          placeholder={String(page)}
          className={`w-14 ${inputSm}`}
          aria-label={t('ui.jumpToPage')}
        />
        <span>{t('ui.pageWord')}</span>
      </div>
    </div>
  );
}
