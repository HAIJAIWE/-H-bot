import { useState, useMemo } from 'react';
import type {
  InlineKeyboard,
  InlineKeyboardRow,
  Button as KeyboardButton,
} from '@shared/types/keyboard';
import { createEmptyRow, createEmptyButton, createEmptyKeyboard } from '@shared/types/keyboard';
import { useStableKeys } from '../../hooks/useStableKeys';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { DebouncedTextInput } from './DebouncedInputs';
import { useFlowStore } from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface Props {
  value: InlineKeyboard;
  onChange: (keyboard: InlineKeyboard) => void;
  /** Markdown 文本（用于 QQ 预览面板显示消息内容） */
  markdown?: string;
  /** 节点 ID：传入时按键文本走防抖提交，从 store 读最新 keyboard 避免旧闭包覆盖（C 修复） */
  nodeId?: string;
}

const STYLE_OPTIONS = [
  {
    value: 0,
    get label() {
      return t('blocks.keyboard.styleSecondary');
    },
  },
  {
    value: 1,
    get label() {
      return t('blocks.keyboard.stylePrimary');
    },
  },
];

const ACTION_TYPE_OPTIONS = [
  {
    value: 0,
    get label() {
      return t('blocks.keyboard.actionLink');
    },
  },
  {
    value: 1,
    get label() {
      return t('blocks.keyboard.actionCallback');
    },
  },
  {
    value: 2,
    get label() {
      // 这里原来借用 `canvas.summary.atMe`（显示成「@机器人」）——**名字是错的**：
      // 官方 type=2 是「指令按钮」，点击后由平台**以用户身份**把 action.data 发出来，
      // 并不涉及 @机器人。同一个组件下面的「数据」字段早就按类型正确取标签
      // （type 2 → commandText「命令文本（如 /搜索）」），只有这个下拉写错了名字，
      // 于是"点击触发指令"这个功能在界面上找不到。
      // 依据：docs/platforms/多平台适配设计.md:219、docs/platforms/QQ官方API开发参考.md:342
      return t('blocks.keyboard.actionCommand');
    },
  },
];

const PERMISSION_TYPE_OPTIONS = [
  {
    value: 0,
    get label() {
      return t('blocks.keyboard.permUser');
    },
  },
  {
    value: 1,
    get label() {
      return t('blocks.keyboard.permAdmin');
    },
  },
  {
    value: 2,
    get label() {
      return t('blocks.keyboard.permAll');
    },
  },
  {
    value: 3,
    get label() {
      return t('blocks.keyboard.permRole');
    },
  },
];

const MAX_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;

/** QQ 风格实时预览面板 — 模拟 QQ 客户端渲染效果 */
function QQPreview({ markdown, keyboard }: { markdown: string; keyboard: InlineKeyboard }) {
  useLocaleSubscription();
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set());

  const toggleVisited = (btnId: string) => {
    setVisitedSet((prev) => {
      const next = new Set(prev);
      if (next.has(btnId)) {
        next.delete(btnId);
      } else {
        next.add(btnId);
      }
      return next;
    });
  };

  // 简单 markdown 渲染：去掉 ## 标记，保留换行
  const renderMarkdown = (md: string) => {
    if (!md) return <span className="text-zinc-400 italic">{t('blocks.keyboard.noMarkdown')}</span>;
    const lines = md.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      return <div key={i}>{trimmed || '\u00A0'}</div>;
    });
  };

  return (
    <div className="bg-zinc-100 rounded-lg p-3">
      <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
        <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full" />
        {t('blocks.keyboard.previewLabel')}
      </div>
      {/* QQ 消息气泡 */}
      <div className="bg-white rounded-xl p-3 shadow-sm max-w-sm">
        {/* Markdown 内容区 */}
        <div className="text-sm text-zinc-800 mb-2 whitespace-pre-wrap break-words">
          {renderMarkdown(markdown)}
        </div>
        {/* 按钮区 */}
        {keyboard.rows.length === 0 ? (
          <div className="text-xs text-zinc-400 italic mt-2">{t('launch.panel.noButtons')}</div>
        ) : (
          <div className="space-y-1.5 mt-2">
            {keyboard.rows.map((row, rowIdx) => (
              <div key={rowIdx} className="flex gap-1.5 flex-wrap">
                {row.buttons.map((btn) => {
                  const visited = visitedSet.has(btn.id);
                  const label =
                    visited && btn.render_data.visited_label
                      ? btn.render_data.visited_label
                      : btn.render_data.label;
                  const isPrimary = btn.render_data.style === 1;
                  return (
                    <Button
                      key={btn.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleVisited(btn.id)}
                      className={`px-3 py-1.5 rounded-md text-xs border transition-all ${
                        visited
                          ? 'border-zinc-300 text-zinc-400 bg-zinc-50 cursor-pointer'
                          : isPrimary
                            ? 'border-blue-500 text-blue-600 hover:bg-blue-50 cursor-pointer'
                            : 'border-zinc-400 text-zinc-600 hover:bg-zinc-50 cursor-pointer'
                      }`}
                      title={
                        visited
                          ? t('blocks.keyboard.clicked')
                          : t('blocks.keyboard.simulateClick', { data: btn.action.data })
                      }
                    >
                      {label || t('blocks.endNode.emptyOption')}
                    </Button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function KeyboardEditor({ value, onChange, markdown = '', nodeId }: Props) {
  useLocaleSubscription();
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState('');

  // 同步 JSON 文本
  const jsonStr = useMemo(() => JSON.stringify(value, null, 2), [value]);

  // 行列表稳定 key（避免删除/编辑时输入框错位；行结构本身无唯一 id）
  const [rowKeys, removeRowKey] = useStableKeys(value.rows.length);

  const updateRow = (rowIdx: number, newRow: InlineKeyboardRow) => {
    const newRows = [...value.rows];
    newRows[rowIdx] = newRow;
    onChange({ rows: newRows });
  };

  const addRow = () => {
    if (value.rows.length >= MAX_ROWS) return;
    onChange({ rows: [...value.rows, createEmptyRow()] });
  };

  const removeRow = (rowIdx: number) => {
    removeRowKey(rowIdx);
    onChange({ rows: value.rows.filter((_, i) => i !== rowIdx) });
  };

  const addButton = (rowIdx: number) => {
    const row = value.rows[rowIdx];
    if (row.buttons.length >= MAX_BUTTONS_PER_ROW) return;
    updateRow(rowIdx, { buttons: [...row.buttons, createEmptyButton()] });
  };

  const removeButton = (rowIdx: number, btnIdx: number) => {
    const row = value.rows[rowIdx];
    updateRow(rowIdx, { buttons: row.buttons.filter((_, i) => i !== btnIdx) });
  };

  const updateButton = (rowIdx: number, btnIdx: number, updates: Partial<KeyboardButton>) => {
    const row = value.rows[rowIdx];
    const newButtons = [...row.buttons];
    newButtons[btnIdx] = { ...newButtons[btnIdx], ...updates };
    updateRow(rowIdx, { buttons: newButtons });
  };

  /** 防抖提交路径：从 store 读最新 keyboard，按 (行, 列, 字段) 精确 patch，避免旧闭包覆盖其他编辑（C 修复）。
   *  无 nodeId（面板编辑器等非节点场景）时立即提交，保证功能与即时性不回退。 */
  const commitButtonField = (
    rowIdx: number,
    btnIdx: number,
    field: 'label' | 'visited_label' | 'data',
    text: string,
  ) => {
    if (!nodeId) {
      const row = value.rows[rowIdx];
      const newButtons = [...row.buttons];
      const btn = newButtons[btnIdx];
      if (field === 'data') {
        newButtons[btnIdx] = { ...btn, action: { ...btn.action, data: text } };
      } else {
        const renderData = { ...btn.render_data };
        if (field === 'label') renderData.label = text;
        else renderData.visited_label = text || undefined;
        newButtons[btnIdx] = { ...btn, render_data: renderData };
      }
      updateRow(rowIdx, { buttons: newButtons });
      return;
    }
    const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const raw = node.data.config?.keyboard;
    let latest: InlineKeyboard;
    try {
      latest = JSON.parse(JSON.stringify(raw)) as InlineKeyboard;
      if (!latest || !Array.isArray(latest.rows)) latest = createEmptyKeyboard();
    } catch {
      latest = createEmptyKeyboard();
    }
    const next = latest.rows.map((row, ri) => {
      if (ri !== rowIdx) return row;
      return {
        buttons: row.buttons.map((btn, bi) => {
          if (bi !== btnIdx) return btn;
          if (field === 'data') {
            return { ...btn, action: { ...btn.action, data: text } };
          }
          const renderData = { ...btn.render_data };
          if (field === 'label') renderData.label = text;
          else renderData.visited_label = text || undefined;
          return { ...btn, render_data: renderData };
        }),
      };
    });
    onChange({ rows: next });
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.rows)) {
        onChange(parsed as InlineKeyboard);
      }
    } catch {
      // JSON 语法错误时不更新，等用户修正
    }
  };

  return (
    <div className="space-y-3">
      {/* ============ QQ 风格实时预览（始终显示）============ */}
      <QQPreview markdown={markdown} keyboard={value} />

      {/* ============ 编辑模式切换 ============ */}
      <div role="tablist" className="flex gap-1 border-b border-zinc-700 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={mode === 'visual'}
          onClick={() => {
            setMode('visual');
          }}
          className={`px-2 py-1 text-xs rounded ${mode === 'visual' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {t('blocks.keyboard.visualEdit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={mode === 'json'}
          onClick={() => {
            setJsonText(jsonStr);
            setMode('json');
          }}
          className={`px-2 py-1 text-xs rounded ${mode === 'json' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {t('ui.jsonEdit')}
        </Button>
      </div>

      {mode === 'visual' ? (
        <div role="tabpanel" className="space-y-2">
          {value.rows.map((row, rowIdx) => (
            <div key={rowKeys[rowIdx]} className="border border-zinc-700 rounded p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {t('blocks.keyboard.rowLabel', {
                    index: rowIdx + 1,
                    count: row.buttons.length,
                    max: MAX_BUTTONS_PER_ROW,
                  })}
                </span>
                <Button type="button" variant="danger" size="sm" onClick={() => removeRow(rowIdx)}>
                  {t('blocks.keyboard.deleteRow')}
                </Button>
              </div>
              {row.buttons.map((btn, btnIdx) => (
                <div key={btn.id} className="bg-zinc-800 rounded p-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">
                      {t('blocks.keyboard.buttonLabel', { index: btnIdx + 1 })}
                    </span>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => removeButton(rowIdx, btnIdx)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                  {/* 按钮文字 */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="text-zinc-400">
                      {t('blocks.keyboard.buttonText')}
                      <DebouncedTextInput
                        value={btn.render_data.label}
                        onChange={(v) => commitButtonField(rowIdx, btnIdx, 'label', v)}
                        className="w-full mt-0.5 px-1.5 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
                        delayMs={nodeId ? 300 : 0}
                      />
                    </label>
                    <label className="text-zinc-400">
                      {t('blocks.keyboard.clickedText')}
                      <DebouncedTextInput
                        value={btn.render_data.visited_label ?? ''}
                        onChange={(v) => commitButtonField(rowIdx, btnIdx, 'visited_label', v)}
                        className="w-full mt-0.5 px-1.5 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
                        delayMs={nodeId ? 300 : 0}
                      />
                    </label>
                  </div>
                  {/* 样式 */}
                  <label className="block text-zinc-400" title={t('blocks.keyboard.styleHint')}>
                    {t('blocks.keyboard.buttonStyle')}
                    <Dropdown<number>
                      value={btn.render_data.style ?? 0}
                      onChange={(v) =>
                        updateButton(rowIdx, btnIdx, {
                          render_data: { ...btn.render_data, style: v as 0 | 1 },
                        })
                      }
                      options={STYLE_OPTIONS}
                      className="mt-0.5"
                    />
                  </label>
                  {/* Action 类型 */}
                  <label className="block text-zinc-400" title={t('blocks.keyboard.actionHint')}>
                    {t('blocks.keyboard.actionType')}
                    <Dropdown<number>
                      value={btn.action.type}
                      onChange={(v) =>
                        updateButton(rowIdx, btnIdx, {
                          action: { ...btn.action, type: v as 0 | 1 | 2 },
                        })
                      }
                      options={ACTION_TYPE_OPTIONS}
                      className="mt-0.5"
                    />
                  </label>
                  {/* Action data */}
                  <label className="block text-zinc-400">
                    {btn.action.type === 0
                      ? t('blocks.keyboard.linkUrl')
                      : btn.action.type === 1
                        ? t('blocks.keyboard.callbackData')
                        : t('blocks.keyboard.commandText')}
                    <DebouncedTextInput
                      value={btn.action.data}
                      onChange={(v) => commitButtonField(rowIdx, btnIdx, 'data', v)}
                      className="w-full mt-0.5 px-1.5 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200"
                      delayMs={nodeId ? 300 : 0}
                    />{' '}
                  </label>
                  {/* 权限类型 */}
                  <label className="block text-zinc-400" title={t('blocks.keyboard.permHint')}>
                    {t('blocks.keyboard.permission')}
                    <Dropdown<number>
                      value={btn.action.permission.type}
                      onChange={(v) =>
                        updateButton(rowIdx, btnIdx, {
                          action: {
                            ...btn.action,
                            permission: { ...btn.action.permission, type: v as 0 | 1 | 2 | 3 },
                          },
                        })
                      }
                      options={PERMISSION_TYPE_OPTIONS}
                      className="mt-0.5"
                    />
                  </label>
                </div>
              ))}
              {row.buttons.length < MAX_BUTTONS_PER_ROW && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => addButton(rowIdx)}
                  className="text-blue-400 hover:text-blue-300"
                >
                  {t('blocks.keyboard.addButton')}
                </Button>
              )}
            </div>
          ))}
          {value.rows.length < MAX_ROWS && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addRow}
              className="text-blue-400 hover:text-blue-300"
            >
              {t('blocks.keyboard.addRow')}
            </Button>
          )}
        </div>
      ) : (
        <div role="tabpanel">
          <textarea
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            rows={12}
            className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 font-mono"
            placeholder={t('blocks.keyboard.jsonPlaceholder')}
          />
          <div className="mt-1 text-xs text-zinc-500">{t('blocks.keyboard.jsonHint')}</div>
        </div>
      )}
    </div>
  );
}
