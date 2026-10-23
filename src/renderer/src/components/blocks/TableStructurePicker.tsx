// src/renderer/src/components/blocks/TableStructurePicker.tsx
//
// 表结构选择器 — 浏览数据库的表和字段，点击字段名插入到配置输入框。
//
// 调用已有的 IPC：window.qqbat.launchData.getSchema(filePath) 获取表结构。
// 用于 database_write 节点的 table/data/condition 字段可视化选择。

import { useEffect, useState } from 'react';
import { Table, X } from 'lucide-react';
import type { TableSchema, FieldSchema } from '@shared/types/launch';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface TableStructurePickerProps {
  /** 数据库文件路径（空则无法加载） */
  dbPath: string;
  /** 字段选择回调：返回选中的字段名（含表名前缀可选） */
  onPickField: (fieldName: string, table?: string) => void;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 当前选中的表名（用于高亮） */
  currentTable?: string;
}

/** SQLite 类型 → 颜色映射 */
function fieldTypeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('int')) return 'text-blue-400';
  if (t.includes('text') || t.includes('char') || t.includes('clob')) return 'text-emerald-400';
  if (t.includes('real') || t.includes('float') || t.includes('double')) return 'text-amber-400';
  if (t.includes('blob')) return 'text-purple-400';
  return 'text-zinc-400';
}

export function TableStructurePicker({
  dbPath,
  onPickField,
  onClose,
  currentTable,
}: TableStructurePickerProps) {
  useLocaleSubscription();
  const [schemas, setSchemas] = useState<TableSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(currentTable ?? null);

  useEffect(() => {
    if (!dbPath) {
      setError(t('blocks.tablePicker.noDbPath'));
      return;
    }
    setLoading(true);
    setError(null);
    window.qqbat.launchData
      .getSchema(dbPath)
      .then((result) => {
        // getSchema 返回 ApiResult<TableSchema[]>，需要解包
        const tables = result?.ok ? (result.data ?? []) : [];
        setSchemas(tables);
        if (tables.length > 0 && !selectedTable) {
          setSelectedTable(tables[0].name);
        }
        if (!result?.ok && result?.error) {
          setError(t('blocks.tablePicker.loadFailed', { error: result.error }));
        }
      })
      .catch((e) => {
        setError(
          t('blocks.tablePicker.loadSchemaFailed', {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅初次加载时默认选中第一张表，selectedTable 变化不应重复请求
  }, [dbPath]);

  const currentSchema = schemas.find((s) => s.name === selectedTable);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-h-[480px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
          <h3 className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
            <Table className="w-4 h-4 text-zinc-400" />
            {t('blocks.tablePicker.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-xs flex items-center gap-1"
            aria-label={t('editor.action.close')}
          >
            <X className="w-3.5 h-3.5" />
            {t('editor.action.close')}
          </button>
        </div>

        {/* 数据库路径显示 */}
        <div className="px-4 py-1.5 border-b border-zinc-800/50 shrink-0">
          <p className="text-xs text-zinc-600 truncate" title={dbPath}>
            📁 {dbPath || t('canvas.summary.notConfigured')}
          </p>
        </div>

        {/* 主体：左侧表列表 + 右侧字段列表 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧：表列表 */}
          <div className="w-40 border-r border-zinc-800 overflow-y-auto shrink-0">
            {loading && (
              <div className="px-3 py-4 text-xs text-zinc-500 text-center">
                {t('editor.action.loading')}
              </div>
            )}
            {error && <div className="px-3 py-4 text-xs text-red-400 text-center">{error}</div>}
            {!loading && !error && schemas.length === 0 && (
              <div className="px-3 py-4 text-xs text-zinc-600 text-center">
                {t('blocks.tablePicker.noTables')}
              </div>
            )}
            {!loading &&
              !error &&
              schemas.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setSelectedTable(s.name)}
                  className={`w-full text-left px-3 py-1.5 text-xs border-b border-zinc-800/50 transition-colors ${
                    selectedTable === s.name
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                  title={s.name}
                >
                  <span className="truncate block">🗄 {s.name}</span>
                  <span className="text-zinc-600 text-xs">
                    {t('blocks.tablePicker.fieldCount', { count: s.fields?.length ?? 0 })}
                  </span>
                </button>
              ))}
          </div>

          {/* 右侧：字段列表 */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {!currentSchema ? (
              <div className="px-4 py-8 text-xs text-zinc-600 text-center">
                {t('blocks.tablePicker.selectTableHint')}
              </div>
            ) : (
              <div>
                <div className="px-3 py-1.5 border-b border-zinc-800/50 bg-zinc-900/50 shrink-0 sticky top-0">
                  <span className="text-xs text-zinc-400">
                    {t('blocks.tablePicker.fieldsHeader', { count: currentSchema.fields.length })}
                  </span>
                </div>
                {currentSchema.fields.map((field: FieldSchema) => (
                  <button
                    key={field.name}
                    type="button"
                    onClick={() => onPickField(field.name, currentSchema.name)}
                    className="w-full text-left px-3 py-1.5 text-xs border-b border-zinc-800/30 hover:bg-zinc-800/50 transition-colors group"
                    title={field.label || field.description || field.name}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-zinc-200 font-mono truncate group-hover:text-blue-300">
                        {field.name}
                      </code>
                      <span className={`text-xs ${fieldTypeColor(field.type)} shrink-0`}>
                        {field.type}
                      </span>
                    </div>
                    {field.label && field.label !== field.name && (
                      <p className="text-xs text-zinc-600 truncate mt-0.5">{field.label}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-1.5 border-t border-zinc-800 shrink-0">
          <p className="text-xs text-zinc-600">{t('blocks.tablePicker.clickToInsert')}</p>
        </div>
      </div>
    </div>
  );
}
