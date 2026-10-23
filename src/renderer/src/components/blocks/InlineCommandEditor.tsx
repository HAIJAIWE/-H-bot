// src/renderer/src/components/blocks/InlineCommandEditor.tsx
//
// 「可点指令」编辑器 —— 消息**正文里**那段可以点的文字。
//
// ## 它和「按钮」是两套官方能力（别混）
//
//   · 按钮 `keyboard`：消息**下方**客户端画的方块，结构化字段，上限 5 行 × 5 个；
//   · 可点指令：写在 **markdown 正文里**的一段字，官方叫「参数指令 / 回车指令」，
//     不占按钮预算，客户端不支持按钮时也能用。
//
// 官方文档 https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html
//   · `<qqbot-cmd-input text show />` **参数指令**：点一下把指令**填进输入框**，全场景可用；
//   · `<qqbot-cmd-enter text />`      **回车指令**：点一下**直接发出去**，
//     ⚠️ 官方原文：「群聊和文字子频道**不支持**该能力」。
//
// ## 为什么只让用户填两件事
//
// 标签本身有三个坑：`text`/`show` **都必须 urlencode**、长度 ≤100、回车指令群聊不支持。
// 这些**全部交给 `@shared/message/compose`**（`mdInlineCommand`）——
// 与运行时是同一份代码，所以下面预览框里显示的就是会实际发出去的那串字符。
import { useMemo } from 'react';
import type { InlineCommandMode } from '@shared/message/compose';
import { mdInlineCommand } from '@shared/message/compose';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { inputForm } from '../ui/inputStyles';
import { useStableKeys } from '../../hooks/useStableKeys';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { Plus, Trash2, X } from 'lucide-react';

/** 一行里的一个标签 */
interface Tag {
  /** 消息里**显示**的文字（官方 `show`），如 `[签到]` */
  label: string;
  /** 点击后填入/发出的指令（官方 `text`），如 `/签到` */
  data: string;
  /** `input`=点一下填进输入框（默认，全场景）；`enter`=点一下直接发（群聊不支持） */
  mode: InlineCommandMode;
}

type Row = Tag[];

const MODE_OPTIONS = [
  {
    value: 'input' as const,
    get label() {
      return t('blocks.inlineCommand.modeInput');
    },
  },
  {
    value: 'enter' as const,
    get label() {
      return t('blocks.inlineCommand.modeEnter');
    },
  },
];

/**
 * 把 config 里的值归一化成「行 × 标签」。
 *
 * 与运行时的"宽进"保持一致（`buildInlineCommands`）：扁平数组里每一项自占一行，
 * 字符串写法等价于 `{label: 同值, data: 同值}`。**认不出来的一律当空**，
 * 不让编辑器因为一段脏 JSON 直接崩掉。
 */
export function toRows(value: unknown): Row[] {
  let v: unknown = value;
  if (typeof v === 'string') {
    const txt = v.trim();
    if (!txt) return [];
    try {
      v = JSON.parse(txt);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];

  const rows: Row[] = [];
  for (const rawRow of v) {
    const items: unknown[] = Array.isArray(rawRow) ? rawRow : [rawRow];
    const tags: Tag[] = [];
    for (const item of items) {
      if (typeof item === 'string' || typeof item === 'number') {
        tags.push({ label: String(item), data: String(item), mode: 'input' });
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        tags.push({
          label: String(o.label ?? o.show ?? ''),
          data: String(o.data ?? o.command ?? ''),
          mode: o.mode === 'enter' ? 'enter' : 'input',
        });
      }
    }
    rows.push(tags);
  }
  return rows;
}

/**
 * 反过来：把「行 × 标签」写成 config 值（JSON 字符串，与 `defaultConfig` 的 `'[]'` 同形）。
 *
 * ⚠️ **没填完的空行 / 空标签要原样写出去，不能在写回时过滤掉**（真机踩到）：
 * 本组件是受控的（onChange → store → value 变 → 重渲染），写回时过滤空值就等于
 * 点「+ 添加一行」后那一行**立刻消失**，用户根本没法往下填。
 * 空值由运行时跳过 —— `buildInlineCommands` 对空行/空标签静默跳过，不产出死标签。
 */
function toConfig(rows: Row[]): string {
  return JSON.stringify(
    rows.map((tags) =>
      tags.map((tag) => {
        const o: Record<string, unknown> = { label: tag.label, data: tag.data };
        if (tag.mode === 'enter') o.mode = 'enter';
        return o;
      }),
    ),
  );
}

interface Props {
  /** `message_compose` 的 `inline_commands`（数组或 JSON 字符串） */
  value: unknown;
  onChange: (value: string) => void;
}

export function InlineCommandEditor({ value, onChange }: Props) {
  useLocaleSubscription();

  const rows = useMemo(() => toRows(value), [value]);
  // 行用稳定 key（删除中间一行时输入框不错位）。标签用下标做 key：
  // 编辑不会改变下标，只有"删掉正在编辑的那一行"才会失焦 —— 那本来就该失焦。
  const [rowKeys, removeRowKey] = useStableKeys(rows.length);

  const commit = (next: Row[]) => onChange(toConfig(next));

  // 新行**先是一行空的**（不是一个空白标签）：空行渲染成"这一行还没有标签 + 加标签"，
  // 运行时也直接跳过它，不会留下一个点了没反应的死标签。
  const addRow = () => commit([...rows, []]);

  const removeRow = (rowIdx: number) => {
    removeRowKey(rowIdx);
    commit(rows.filter((_, i) => i !== rowIdx));
  };

  const updateTag = (rowIdx: number, tagIdx: number, patch: Partial<Tag>) => {
    commit(
      rows.map((tags, i) =>
        i === rowIdx ? tags.map((tag, j) => (j === tagIdx ? { ...tag, ...patch } : tag)) : tags,
      ),
    );
  };

  const addTag = (rowIdx: number) => {
    commit(
      rows.map((tags, i) =>
        i === rowIdx
          ? [...tags, { label: '', data: '', mode: 'input' as InlineCommandMode }]
          : tags,
      ),
    );
  };

  const removeTag = (rowIdx: number, tagIdx: number) => {
    commit(rows.map((tags, i) => (i === rowIdx ? tags.filter((_, j) => j !== tagIdx) : tags)));
  };

  const hasEnter = rows.some((tags) => tags.some((tag) => tag.mode === 'enter'));
  const hasAny = rows.some((tags) => tags.some((tag) => tag.data.trim() || tag.label.trim()));

  return (
    <div className="space-y-3">
      <div className="text-xs leading-relaxed text-zinc-500">{t('blocks.inlineCommand.hint')}</div>

      {rows.map((tags, rowIdx) => (
        <div
          key={rowKeys[rowIdx]}
          className="space-y-1.5 rounded border border-zinc-800 bg-zinc-900/50 p-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">
              {t('blocks.inlineCommand.rowLabel', { index: String(rowIdx + 1) })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addTag(rowIdx)}
                leftIcon={<Plus className="h-3 w-3" />}
                className="text-blue-400 hover:text-blue-300"
              >
                {t('blocks.inlineCommand.addTag')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('blocks.inlineCommand.removeRow')}
                title={t('blocks.inlineCommand.removeRow')}
                onClick={() => removeRow(rowIdx)}
                className="text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {tags.length === 0 && (
            <div className="text-[11px] text-zinc-600">{t('blocks.inlineCommand.emptyRow')}</div>
          )}

          {tags.map((tag, tagIdx) => (
            <div key={tagIdx} className="flex items-center gap-1.5">
              <input
                className={`w-28 shrink-0 ${inputForm}`}
                value={tag.label}
                aria-label={t('blocks.inlineCommand.showLabel')}
                placeholder={t('blocks.inlineCommand.showPlaceholder')}
                onChange={(e) => updateTag(rowIdx, tagIdx, { label: e.target.value })}
              />
              <input
                className={`min-w-0 flex-1 ${inputForm}`}
                value={tag.data}
                aria-label={t('blocks.inlineCommand.dataLabel')}
                placeholder={t('blocks.inlineCommand.dataPlaceholder')}
                onChange={(e) => updateTag(rowIdx, tagIdx, { data: e.target.value })}
              />
              <Dropdown<InlineCommandMode>
                value={tag.mode}
                options={MODE_OPTIONS}
                ariaLabel={t('blocks.inlineCommand.modeLabel')}
                onChange={(v) => updateTag(rowIdx, tagIdx, { mode: v })}
                className="w-36 shrink-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('blocks.inlineCommand.removeTag')}
                title={t('blocks.inlineCommand.removeTag')}
                onClick={() => removeTag(rowIdx, tagIdx)}
                className="shrink-0 text-zinc-500 hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={addRow}
        leftIcon={<Plus className="h-3 w-3" />}
        className="text-blue-400 hover:text-blue-300"
      >
        {t('blocks.inlineCommand.addRow')}
      </Button>

      {/* 预览：直接用运行时那一个函数生成，界面上看到的就是会发出去的那串字符 */}
      <div className="space-y-1">
        <div className="text-[11px] text-zinc-500">{t('blocks.inlineCommand.previewLabel')}</div>
        <div className="space-y-1 rounded border border-zinc-700/60 bg-zinc-900 px-2 py-1.5">
          {!hasAny && (
            <div className="text-[11px] text-zinc-600">
              {t('blocks.inlineCommand.previewEmpty')}
            </div>
          )}
          {rows.map((tags, rowIdx) => {
            const line = tags
              .filter((tag) => tag.data.trim() || tag.label.trim())
              .map((tag) => mdInlineCommand(tag.data, { show: tag.label, mode: tag.mode }))
              .filter(Boolean)
              .join(' ');
            if (!line) return null;
            return (
              <div key={rowIdx} className="break-all font-mono text-[10px] text-zinc-400">
                {line}
              </div>
            );
          })}
        </div>
        {hasEnter && (
          <div className="text-[11px] leading-relaxed text-amber-400/80">
            {t('blocks.inlineCommand.enterGroupWarning')}
          </div>
        )}
      </div>
    </div>
  );
}
