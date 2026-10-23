import React, { useEffect, useState, useCallback, useMemo, useRef, useId } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { RecordEditModal } from './RecordEditModal';
import { TableDesignModal } from './TableDesignModal';
import { categoryDescription, categoryLabel } from './configCategoryLabels';
import type { ConfigCategory, TableSchema, FieldSchema, QueryResult } from '@shared/types/launch';
import type { FieldConfig, BaseType } from '@shared/types/typeSystem';
import { DEFAULT_PAGE_SIZE } from '@shared/types/pagination';
import { TypeEditor } from './editors/TypeEditor';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { inputForm } from '../ui/inputStyles';
import { t, getLocale } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 超过该行数后启用虚拟滚动 */
const TABLE_VIRTUAL_THRESHOLD = 50;
/** 虚拟滚动单行高度（px）—— 与 px-3 py-2 + text-sm 估算匹配 */
const TABLE_ROW_HEIGHT = 40;

function fieldSchemaToFieldConfig(field: FieldSchema): FieldConfig {
  return {
    type: field.type as unknown as BaseType,
    label: field.label,
    enumValues: field.options,
    min: field.min,
    max: field.max,
  };
}

/** 格式化值 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? t('data.yes') : t('data.no');
  if (typeof val === 'number' && Math.abs(val) >= 10000 && Number.isInteger(val))
    return val.toLocaleString(getLocale());
  return String(val);
}

/** 单张表的弹窗编辑器 */
export const TableEditorPopup = React.memo(function TableEditorPopup({
  category,
  projectPath,
  onClose,
  onTableChanged,
}: {
  category: ConfigCategory;
  projectPath: string;
  onClose: () => void;
  onTableChanged: () => void;
}) {
  useLocaleSubscription();
  const [configSchema, setConfigSchema] = useState<TableSchema[]>([]);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  // 弹窗标题 id，供 aria-labelledby 关联容器与标题
  const titleId = useId();
  const toast = useToast();
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    rowid: number;
    field: string;
    original: unknown;
  } | null>(null);
  const [editValue, setEditValue] = useState<unknown>(null);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    title: string;
    fields: FieldSchema[];
    initialValues: Record<string, unknown>;
    mode: 'create' | 'edit';
    rowid?: number;
  }>({ open: false, title: '', fields: [], initialValues: {}, mode: 'create' });
  const [designOpen, setDesignOpen] = useState(false);
  // 批量删除进行中标记：用于禁用按钮、防止重复点击
  const [batchDeleting, setBatchDeleting] = useState(false);
  // 批量删除进度：删除循环中实时更新 { current, total }
  const [batchDeleteProgress, setBatchDeleteProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  // 批量删除确认弹窗状态
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; count: number }>({
    open: false,
    count: 0,
  });
  // 单行删除确认弹窗状态：删除玩家数据记录前二次确认，避免误删
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<{ rowid: number } | null>(null);

  const pageSize = DEFAULT_PAGE_SIZE;

  // 搜索防抖：避免每次按键触发全量行过滤
  const debouncedFilterText = useDebouncedValue(filterText, 300);

  // 下一页数据缓存（ref 避免 re-render；切表时清空）
  // 当数据加载完成时静默预加载下一页；翻页时若命中缓存则立即显示，并继续预加载下下一页
  const nextPageCacheRef = useRef<{ page: number; data: QueryResult | null; loading: boolean }>({
    page: 0,
    data: null,
    loading: false,
  });

  // 虚拟滚动：测量表格可用高度（>50 行时启用 react-window）
  // 使用 callback ref：虚拟/非虚拟模式切换会替换 DOM 节点，需在节点变化时重新观察
  const tableBodyRef = useRef<HTMLDivElement | null>(null);
  const tableBodyRORef = useRef<ResizeObserver | null>(null);
  const [tableBodyHeight, setTableBodyHeight] = useState(0);
  const setTableBodyNode = useCallback((node: HTMLDivElement | null) => {
    if (tableBodyRORef.current) {
      tableBodyRORef.current.disconnect();
      tableBodyRORef.current = null;
    }
    tableBodyRef.current = node;
    if (node) {
      setTableBodyHeight(node.clientHeight);
      const ro = new ResizeObserver(() => setTableBodyHeight(node.clientHeight));
      ro.observe(node);
      tableBodyRORef.current = ro;
    } else {
      setTableBodyHeight(0);
    }
  }, []);

  // 切换表时清空下一页缓存，避免不同表数据混淆
  useEffect(() => {
    nextPageCacheRef.current = { page: 0, data: null, loading: false };
  }, [category.name]);

  // 静默预加载指定页（不触发 loading 状态，仅填充缓存）
  const preloadNextPage = useCallback(
    async (nextPage: number) => {
      if (nextPageCacheRef.current.loading) return;
      nextPageCacheRef.current = { page: nextPage, data: null, loading: true };
      try {
        const res = await window.qqbat.launchConfig.getTable(
          projectPath,
          category.name,
          nextPage,
          pageSize,
        );
        if (res.ok && res.data && res.data.rows.length > 0) {
          nextPageCacheRef.current = { page: nextPage, data: res.data, loading: false };
        } else {
          // 没有更多数据，不缓存
          nextPageCacheRef.current = { page: 0, data: null, loading: false };
        }
      } catch {
        nextPageCacheRef.current = { page: 0, data: null, loading: false };
      }
    },
    [projectPath, category.name, pageSize],
  );

  const loadData = useCallback(
    async (p: number) => {
      // 命中缓存：立即显示，并后台预加载下下一页
      if (nextPageCacheRef.current.page === p && nextPageCacheRef.current.data) {
        const cached = nextPageCacheRef.current.data;
        nextPageCacheRef.current = { page: 0, data: null, loading: false };
        setQueryResult(cached);
        setLoading(false);
        preloadNextPage(p + 1);
        return;
      }
      // 未命中：正常加载
      setLoading(true);
      try {
        const [tableRes, schemaRes] = await Promise.all([
          window.qqbat.launchConfig.getTable(projectPath, category.name, p, pageSize),
          window.qqbat.launchConfig.getSchema(projectPath, category.name),
        ]);
        if (tableRes.ok && tableRes.data) setQueryResult(tableRes.data);
        if (schemaRes.ok && schemaRes.data) setConfigSchema(schemaRes.data);
        // IPC 调用失败时通过 Toast 提示用户（替代仅 console.error 的静默失败）
        if (!tableRes.ok) {
          toast.error(
            t('launch.common.loadDataFailedWithMsg', {
              msg: tableRes.error || t('launch.common.unknownError'),
            }),
          );
        }
        if (!schemaRes.ok) {
          toast.error(
            t('launch.common.loadSchemaFailedWithMsg', {
              msg: schemaRes.error || t('launch.common.unknownError'),
            }),
          );
        }
      } finally {
        setLoading(false);
      }
      // 加载完成后静默预加载下一页
      preloadNextPage(p + 1);
    },
    [projectPath, category.name, pageSize, preloadNextPage, toast],
  );

  useEffect(() => {
    loadData(page);
  }, [page, loadData]);

  const filteredRows = useMemo(() => {
    if (!queryResult) return [];
    if (!debouncedFilterText.trim()) return queryResult.rows;
    const q = debouncedFilterText.toLowerCase();
    return queryResult.rows.filter((row) =>
      Object.values(row).some((v) =>
        String(v ?? '')
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [queryResult, debouncedFilterText]);

  const totalPages = queryResult ? Math.ceil(queryResult.total / pageSize) : 1;

  // 虚拟滚动列布局：checkbox | rowid | 数据列... | 操作
  const dataColumns = useMemo(() => {
    if (queryResult && queryResult.rows.length > 0) {
      return Object.keys(queryResult.rows[0]).filter((k) => k !== 'rowid');
    }
    return [];
  }, [queryResult]);

  const gridTemplateColumns = useMemo(
    () => `40px 64px repeat(${dataColumns.length}, minmax(140px, 1fr)) 140px`,
    [dataColumns.length],
  );

  // 组件卸载时清理 ResizeObserver（观察逻辑已移至 setTableBodyNode callback ref）
  useEffect(() => {
    return () => {
      if (tableBodyRORef.current) {
        tableBodyRORef.current.disconnect();
        tableBodyRORef.current = null;
      }
    };
  }, []);

  const handleCellClick = useCallback((rowid: number, field: string, currentValue: unknown) => {
    setEditingCell({ rowid, field, original: currentValue });
    setEditValue(currentValue);
  }, []);

  // 防止 onBlur 与 Enter 触发的重入：保存进行中时忽略后续触发
  const savingRef = useRef(false);
  const handleCellSave = useCallback(async () => {
    if (!editingCell) return;
    // 重入保护：onBlur 和 onKeyDown(Enter) 可能几乎同时触发，导致重复 IPC 调用 + 重复 toast
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const res = await window.qqbat.launchConfig.updateRecord(
        projectPath,
        category.name,
        editingCell.rowid,
        { [editingCell.field]: editValue },
      );
      if (res.ok) {
        await loadData(page);
        setEditingCell(null);
      } else {
        // 后端验证失败（如 enum 值不合法、数值超范围），显示错误但不关闭编辑状态，允许用户修正
        toast.error(res.error || t('launch.common.saveFailed'));
      }
    } catch (e) {
      // IPC 桥接异常时也需提示用户，否则错误被静默吞掉
      toast.error(
        t('launch.common.saveFailedWithMsg', { msg: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      savingRef.current = false;
    }
  }, [editingCell, editValue, projectPath, category, loadData, page, toast]);

  const handleCellCancel = useCallback(() => {
    if (editingCell) {
      setEditValue(editingCell.original);
      setEditingCell(null);
    }
  }, [editingCell]);

  const handleDelete = useCallback(
    async (rowid: number) => {
      const res = await window.qqbat.launchConfig.deleteRecord(projectPath, category.name, rowid);
      if (!res.ok) {
        // IPC 返回 {ok:false} 而非抛异常时，需手动抛出让调用方的 try-catch 捕获
        throw new Error(res.error || t('launch.common.deleteFailed'));
      }
      await loadData(page);
    },
    [projectPath, category, loadData, page],
  );

  // 点击单行删除按钮：打开确认弹窗（不立即删除）
  const handleDeleteClick = useCallback((rowid: number) => {
    setConfirmDeleteRow({ rowid });
  }, []);

  // 确认单行删除：执行删除并关闭弹窗
  const confirmDeleteRowExec = useCallback(async () => {
    if (!confirmDeleteRow) return;
    const { rowid } = confirmDeleteRow;
    setConfirmDeleteRow(null);
    try {
      await handleDelete(rowid);
    } catch (err) {
      toast.error(
        t('launch.common.deleteFailedWithMsg', {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }, [confirmDeleteRow, handleDelete, toast]);

  // 点击批量删除按钮：打开自定义确认弹窗（替代 window.confirm）
  const handleBatchDeleteClick = () => {
    setConfirmDelete({ open: true, count: selectedRows.size });
  };

  // 取消批量删除：关闭确认弹窗
  const handleCancelBatchDelete = () => {
    setConfirmDelete({ open: false, count: 0 });
  };

  // 确认批量删除：逐条删除并实时更新进度
  const handleConfirmBatchDelete = async () => {
    setConfirmDelete({ open: false, count: 0 });
    setBatchDeleting(true);
    const rowids = Array.from(selectedRows);
    try {
      for (let i = 0; i < rowids.length; i++) {
        // 更新当前删除进度（1-based）
        setBatchDeleteProgress({ current: i + 1, total: rowids.length });
        const res = await window.qqbat.launchConfig.deleteRecord(
          projectPath,
          category.name,
          rowids[i],
        );
        if (!res.ok) {
          // IPC 返回 {ok:false} 而非抛异常时，需手动抛出让 catch 捕获
          throw new Error(
            res.error || t('launch.common.deleteRowFailed', { id: String(rowids[i]) }),
          );
        }
      }
      setSelectedRows(new Set());
      await loadData(page);
    } catch (err) {
      console.error('[TableEditorPopup] 批量删除失败:', err);
      // 刷新数据让已删除的行从列表消失
      await loadData(page);
      // 清理选中状态
      setSelectedRows(new Set());
      // 通过全局 Toast 提示用户删除失败原因
      toast.error(
        t('launch.common.deleteFailedWithMsg', {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBatchDeleting(false);
      setBatchDeleteProgress(null);
    }
  };

  const toggleRowSelection = useCallback((rowid: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowid)) next.delete(rowid);
      else next.add(rowid);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    const allSelected =
      filteredRows.length > 0 && filteredRows.every((r) => selectedRows.has(r.rowid as number));
    const next = new Set<number>();
    if (!allSelected) {
      filteredRows.forEach((r) => next.add(r.rowid as number));
    }
    setSelectedRows(next);
  }, [filteredRows, selectedRows]);

  const handleOpenNewDialog = useCallback(() => {
    const fields = configSchema[0]?.fields ?? [];
    const defaults: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === 'int' || f.type === 'float') defaults[f.name] = 0;
      else if (f.type === 'bool') defaults[f.name] = false;
      else defaults[f.name] = '';
    }
    setEditModal({
      open: true,
      title: t('launch.common.createWithName', { name: category.displayName }),
      fields,
      initialValues: defaults,
      mode: 'create',
    });
  }, [configSchema, category]);

  const handleEditModalSave = useCallback(
    async (values: Record<string, unknown>) => {
      let res: { ok: boolean; error?: string };
      if (editModal.mode === 'edit' && editModal.rowid) {
        res = await window.qqbat.launchConfig.updateRecord(
          projectPath,
          category.name,
          editModal.rowid,
          values,
        );
      } else {
        res = await window.qqbat.launchConfig.insertRecord(projectPath, category.name, values);
      }
      if (!res.ok) {
        // IPC 返回 {ok:false} 而非抛异常时，需手动抛出让 RecordEditModal 的 try-catch 捕获并显示错误
        throw new Error(res.error || t('launch.common.saveFailed'));
      }
      await loadData(page);
    },
    [editModal, projectPath, category, loadData, page],
  );

  const getColumnLabel = useCallback(
    (col: string): string => {
      const tblSchema = configSchema.find((t) => t.name === category.name);
      if (!tblSchema) return col;
      const field = tblSchema.fields.find((f) => f.name === col);
      return field?.label || col;
    },
    [configSchema, category],
  );

  const getColumnDescription = useCallback(
    (col: string): string | undefined => {
      const tblSchema = configSchema.find((t) => t.name === category.name);
      if (!tblSchema) return undefined;
      const field = tblSchema.fields.find((f) => f.name === col);
      return field?.description;
    },
    [configSchema, category],
  );

  /**
   * 表结构变更（重命名/增删字段）后的统一刷新。
   *
   * ⚠️ 必须**先 await 完 loadData（表数据 + schema）再通知父组件**。
   * 原来两句是并列的、且都没 await —— 设计弹窗一关就立刻重新打开时，
   * `configSchema` 还是上一轮的旧快照，用户看到"字段列表没刷新"
   * （实测反馈："改名了它需要刷新一下，但面板的字段没刷新"）。
   * 顺序反过来也不行：父组件刷新完会重新渲染本弹窗，那时 schema 必须已经是新的。
   */
  const handleDesignChanged = useCallback(async () => {
    await loadData(page);
    onTableChanged();
  }, [onTableChanged, loadData, page]);

  /** 虚拟滚动行渲染所需数据（通过 itemData 传递，避免闭包失效） */
  const virtualRowData = useMemo<{
    rows: typeof filteredRows;
    dataColumns: string[];
    gridTemplateColumns: string;
    selectedRows: Set<number>;
    editingCell: { rowid: number; field: string; original: unknown } | null;
    editValue: unknown;
    configSchema: TableSchema[];
    category: ConfigCategory;
    onCellClick: (rowid: number, field: string, currentValue: unknown) => void;
    onCellSave: () => void;
    onCellCancel: () => void;
    setEditValue: (v: unknown) => void;
    onEdit: (row: Record<string, unknown>) => void;
    onDelete: (rowid: number) => void;
    onToggleRow: (rowid: number) => void;
    getColumnLabel: (col: string) => string;
    getColumnDescription: (col: string) => string | undefined;
  }>(
    () => ({
      rows: filteredRows,
      dataColumns,
      gridTemplateColumns,
      selectedRows,
      editingCell,
      editValue,
      configSchema,
      category,
      onCellClick: handleCellClick,
      onCellSave: handleCellSave,
      onCellCancel: handleCellCancel,
      setEditValue,
      onEdit: (row: Record<string, unknown>) => {
        const fields = configSchema[0]?.fields ?? [];
        setEditModal({
          open: true,
          title: t('launch.common.editWithName', { name: category.displayName }),
          fields,
          initialValues: { ...row } as Record<string, unknown>,
          mode: 'edit',
          rowid: row.rowid as number,
        });
      },
      onDelete: handleDeleteClick,
      onToggleRow: toggleRowSelection,
      getColumnLabel,
      getColumnDescription,
    }),
    [
      filteredRows,
      dataColumns,
      gridTemplateColumns,
      selectedRows,
      editingCell,
      editValue,
      configSchema,
      category,
      handleCellClick,
      handleCellSave,
      handleCellCancel,
      handleDeleteClick,
      toggleRowSelection,
      getColumnLabel,
      getColumnDescription,
    ],
  );

  /** 虚拟滚动行渲染函数 —— 必须 apply style 以定位；用 div+grid 模拟表格行 */
  const renderVirtualRow = useCallback(
    ({ index, style, data }: ListChildComponentProps<typeof virtualRowData>) => {
      const row = data.rows[index];
      const isSelected = data.selectedRows.has(row.rowid as number);
      return (
        <div
          style={{ ...style, display: 'grid', gridTemplateColumns: data.gridTemplateColumns }}
          className={`border-b border-zinc-800/50 hover:bg-zinc-800/50 ${isSelected ? 'bg-blue-900/20' : ''}`}
        >
          <div className="px-3 py-2 flex items-center">
            <input
              type="checkbox"
              className="accent-blue-500 w-4 h-4"
              checked={isSelected}
              aria-label={t('launch.common.selectRowAria', { n: String(index + 1) })}
              onChange={() => data.onToggleRow(row.rowid as number)}
            />
          </div>
          <div className="px-3 py-2 text-zinc-500 flex items-center">{row.rowid as number}</div>
          {data.dataColumns.map((col) => {
            const val = (row as Record<string, unknown>)[col];
            const isEditing =
              data.editingCell?.rowid === row.rowid && data.editingCell?.field === col;
            const fieldConfig =
              data.configSchema.length > 0
                ? (() => {
                    const fs = data.configSchema[0]?.fields.find((f) => f.name === col);
                    return fs ? fieldSchemaToFieldConfig(fs) : null;
                  })()
                : null;
            return (
              <div
                key={col}
                className="px-3 py-2 flex items-center max-w-[260px] cursor-pointer overflow-hidden"
                role="gridcell"
                tabIndex={isEditing ? -1 : 0}
                onClick={() => !isEditing && data.onCellClick(row.rowid as number, col, val)}
                onKeyDown={(e) => {
                  if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    data.onCellClick(row.rowid as number, col, val);
                  }
                }}
                title={formatValue(val)}
              >
                {isEditing ? (
                  <div
                    onBlur={data.onCellSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') data.onCellSave();
                      if (e.key === 'Escape') data.onCellCancel();
                    }}
                  >
                    {fieldConfig ? (
                      <TypeEditor
                        value={data.editValue}
                        onChange={data.setEditValue}
                        field={fieldConfig}
                      />
                    ) : (
                      <input
                        className="w-full bg-zinc-800 border border-blue-500 rounded px-2 py-1 text-zinc-200 outline-none text-sm"
                        aria-label={t('launch.common.editCellAria', { col })}
                        value={String(data.editValue ?? '')}
                        onChange={(e) => data.setEditValue(e.target.value)}
                        autoFocus
                      />
                    )}
                  </div>
                ) : (
                  <span
                    className={`truncate ${val === null ? 'text-zinc-600 italic' : 'text-zinc-300'}`}
                  >
                    {formatValue(val)}
                  </span>
                )}
              </div>
            );
          })}
          <div className="px-3 py-2 text-right whitespace-nowrap flex items-center justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => data.onEdit(row)}>
              {t('launch.common.edit')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => data.onDelete(row.rowid as number)}>
              {t('launch.common.delete')}
            </Button>
          </div>
        </div>
      );
    },
    [],
  );

  /**
   * 文件名提示：只在**有描述**且文件名与显示名不一致时才补一句。
   *
   * 两个约束都是实测踩出来的：
   * · 没有描述时这一行本来就回退成"表名"，再补一个文件名会变成 `drops · 共 55 条 · drops`（重复）；
   * · 显示名与文件名一致时（如都叫 drops）提示是纯噪音。
   * 显示名（中文/自定义）与库文件名（ASCII，流程绑定用的就是它）是两回事，
   * 不知道这层区别的用户会以为"中文名改了、下面还写着英文，是没改成功"。
   */
  const fileNameHint = useMemo(() => {
    const label = categoryLabel(category);
    const hasDescription = !!categoryDescription(category);
    if (!hasDescription || !category.name || category.name === label) return null;
    return `· ${category.name}`;
  }, [category]);

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      {/* 弹窗 */}
      <div
        className="fixed inset-4 bg-zinc-900 rounded-lg z-50 flex flex-col shadow-2xl border border-zinc-700"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/95 shrink-0">
          <div>
            <div id={titleId} className="text-base font-semibold text-zinc-200">
              {categoryLabel(category)}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {categoryDescription(category) || category.name}{' '}
              {t('launch.common.totalRows', { count: String(queryResult?.total ?? 0) })}
              {/* 文件名与表名不一致时补一行提示（说明"库里叫什么"），
                  一致时不显示 —— 内部英文标识对用户是噪音。
                  用户实测反馈过："中文名变了、下面还是 diaoluo，看着像没改成功"。 */}
              {fileNameHint && <span className="ml-1 text-zinc-600">{fileNameHint}</span>}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xl leading-none px-2"
            onClick={onClose}
            aria-label={t('data.editor.closeAria')}
          >
            ×
          </Button>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
          <div className="flex items-center gap-3">
            <input
              className={`w-56 ${inputForm} placeholder-zinc-600`}
              placeholder={t('data.editor.searchPlaceholder')}
              aria-label={t('data.editor.searchAria')}
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setDesignOpen(true)}
              title={t('data.editor.designTitle')}
            >
              <span></span> {t('data.design.title')}
            </Button>
            <Button variant="primary" size="md" onClick={handleOpenNewDialog}>
              {t('launch.common.addPlus')}
            </Button>
            {selectedRows.size > 0 && (
              <>
                <Button
                  variant="danger"
                  size="md"
                  onClick={handleBatchDeleteClick}
                  disabled={batchDeleting}
                >
                  {batchDeleting
                    ? t('launch.common.deleting')
                    : t('launch.common.deleteSelectedCount', { count: String(selectedRows.size) })}
                </Button>
                {batchDeleting && batchDeleteProgress && (
                  <span className="text-xs text-zinc-400">
                    {t('launch.common.deletingProgress', {
                      current: String(batchDeleteProgress.current),
                      total: String(batchDeleteProgress.total),
                    })}
                  </span>
                )}
              </>
            )}
            <div className="flex items-center gap-1 ml-2 border-l border-zinc-700 pl-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('ui.prevPage')}
              </Button>
              <span className="text-sm text-zinc-500 min-w-[3rem] text-center">
                {page}/{totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('ui.nextPage')}
              </Button>
            </div>
          </div>
        </div>

        {/* 数据表格 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading && (
            <div className="flex items-center justify-center h-full text-zinc-500 text-base">
              <Spinner size="md" />
              <span className="ml-2">{t('launch.common.loading')}</span>
            </div>
          )}
          {!loading &&
            queryResult &&
            (filteredRows.length > TABLE_VIRTUAL_THRESHOLD && tableBodyHeight > 0 ? (
              <>
                {/* 虚拟滚动表头（div+grid，与行布局对齐） */}
                <div
                  className="grid bg-zinc-900 border-b border-zinc-800 shrink-0"
                  style={{ gridTemplateColumns }}
                >
                  <div className="px-3 py-2.5 flex items-center">
                    <input
                      type="checkbox"
                      className="accent-blue-500 w-4 h-4"
                      checked={
                        filteredRows.length > 0 &&
                        filteredRows.every((r) => selectedRows.has(r.rowid as number))
                      }
                      aria-label={t('data.editor.selectAllRows')}
                      onChange={toggleAllRows}
                    />
                  </div>
                  <div className="px-3 py-2.5 text-zinc-500 font-medium">rowid</div>
                  {dataColumns.map((col) => (
                    <div
                      key={col}
                      className="px-3 py-2.5 text-zinc-400 font-medium whitespace-nowrap overflow-hidden"
                      title={
                        getColumnDescription(col)
                          ? `${getColumnLabel(col)} — ${getColumnDescription(col)}`
                          : getColumnLabel(col)
                      }
                    >
                      {getColumnLabel(col)}
                    </div>
                  ))}
                  <div className="px-3 py-2.5 text-zinc-500 font-medium text-right">
                    {t('data.editor.actions')}
                  </div>
                </div>
                {/* 虚拟滚动列表（react-window FixedSizeList） */}
                <div ref={setTableBodyNode} className="flex-1 overflow-hidden">
                  <FixedSizeList
                    height={tableBodyHeight}
                    itemCount={filteredRows.length}
                    itemSize={TABLE_ROW_HEIGHT}
                    width="100%"
                    itemData={virtualRowData}
                    className="scrollbar-thin"
                  >
                    {renderVirtualRow}
                  </FixedSizeList>
                </div>
              </>
            ) : (
              <div ref={setTableBodyNode} className="h-full overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-900 sticky top-0 z-10">
                      <th className="px-3 py-2.5 text-zinc-500 font-medium border-b border-zinc-800 w-10">
                        <input
                          type="checkbox"
                          className="accent-blue-500 w-4 h-4"
                          checked={
                            filteredRows.length > 0 &&
                            filteredRows.every((r) => selectedRows.has(r.rowid as number))
                          }
                          aria-label={t('data.editor.selectAllRows')}
                          onChange={toggleAllRows}
                        />
                      </th>
                      <th className="text-left px-3 py-2.5 text-zinc-500 font-medium border-b border-zinc-800 w-16">
                        rowid
                      </th>
                      {queryResult.rows.length > 0 &&
                        Object.keys(queryResult.rows[0])
                          .filter((k) => k !== 'rowid')
                          .map((col) => (
                            <th
                              key={col}
                              className="text-left px-3 py-2.5 text-zinc-400 font-medium border-b border-zinc-800 whitespace-nowrap"
                              title={
                                getColumnDescription(col)
                                  ? `${getColumnLabel(col)} — ${getColumnDescription(col)}`
                                  : getColumnLabel(col)
                              }
                            >
                              {getColumnLabel(col)}
                            </th>
                          ))}
                      <th className="text-right px-3 py-2.5 text-zinc-500 font-medium border-b border-zinc-800">
                        {t('data.editor.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.rowid as number}
                        className={`hover:bg-zinc-800/50 ${selectedRows.has(row.rowid as number) ? 'bg-blue-900/20' : ''}`}
                      >
                        <td className="px-3 py-2 border-b border-zinc-800/50">
                          <input
                            type="checkbox"
                            className="accent-blue-500 w-4 h-4"
                            checked={selectedRows.has(row.rowid as number)}
                            aria-label={t('launch.common.selectRowIdAria', {
                              id: String(row.rowid as number),
                            })}
                            onChange={() => toggleRowSelection(row.rowid as number)}
                          />
                        </td>
                        <td className="px-3 py-2 text-zinc-500 border-b border-zinc-800/50">
                          {row.rowid as number}
                        </td>
                        {Object.entries(row)
                          .filter(([k]) => k !== 'rowid')
                          .map(([col, val]) => {
                            const isEditing =
                              editingCell?.rowid === row.rowid && editingCell?.field === col;
                            const fieldConfig =
                              configSchema.length > 0
                                ? (() => {
                                    const fs = configSchema[0]?.fields.find((f) => f.name === col);
                                    return fs ? fieldSchemaToFieldConfig(fs) : null;
                                  })()
                                : null;
                            return (
                              <td
                                key={col}
                                className="px-3 py-2 border-b border-zinc-800/50 max-w-[240px] cursor-pointer"
                                tabIndex={isEditing ? -1 : 0}
                                onClick={() =>
                                  !isEditing && handleCellClick(row.rowid as number, col, val)
                                }
                                onKeyDown={(e) => {
                                  if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                                    e.preventDefault();
                                    handleCellClick(row.rowid as number, col, val);
                                  }
                                }}
                                title={formatValue(val)}
                              >
                                {isEditing ? (
                                  <div
                                    onBlur={handleCellSave}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleCellSave();
                                      if (e.key === 'Escape') handleCellCancel();
                                    }}
                                  >
                                    {fieldConfig ? (
                                      <TypeEditor
                                        value={editValue}
                                        onChange={setEditValue}
                                        field={fieldConfig}
                                      />
                                    ) : (
                                      <input
                                        className="w-full bg-zinc-800 border border-blue-500 rounded px-2 py-1 text-zinc-200 outline-none text-sm"
                                        aria-label={t('launch.common.editCellAria', { col })}
                                        value={String(editValue ?? '')}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        autoFocus
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <span
                                    className={
                                      val === null ? 'text-zinc-600 italic' : 'text-zinc-300'
                                    }
                                  >
                                    {formatValue(val)}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        <td className="px-3 py-2 border-b border-zinc-800/50 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mr-3"
                            onClick={() => {
                              const fields = configSchema[0]?.fields ?? [];
                              setEditModal({
                                open: true,
                                title: t('launch.common.editWithName', {
                                  name: category.displayName,
                                }),
                                fields,
                                initialValues: { ...row } as Record<string, unknown>,
                                mode: 'edit',
                                rowid: row.rowid as number,
                              });
                            }}
                          >
                            {t('launch.common.edit')}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteClick(row.rowid as number)}
                          >
                            {t('launch.common.delete')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={99}>
                          {debouncedFilterText ? (
                            <EmptyState
                              title={t('data.editor.noMatch')}
                              description={t('data.editor.noMatchHint')}
                              action={
                                <Button variant="ghost" size="sm" onClick={() => setFilterText('')}>
                                  {t('data.editor.clearFilter')}
                                </Button>
                              }
                            />
                          ) : (
                            <EmptyState
                              title={t('launch.common.noData')}
                              description={t('data.common.addFirstRecordHint')}
                              action={
                                <Button variant="primary" size="sm" onClick={handleOpenNewDialog}>
                                  {t('launch.common.addPlus')}
                                </Button>
                              }
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      </div>

      {/* 编辑/新增弹窗 */}
      <RecordEditModal
        open={editModal.open}
        onClose={() => setEditModal((prev) => ({ ...prev, open: false }))}
        title={editModal.title}
        fields={editModal.fields}
        initialValues={editModal.initialValues}
        mode={editModal.mode}
        projectPath={projectPath}
        onSave={handleEditModalSave}
      />

      {/* 表结构设计 Modal */}
      <TableDesignModal
        open={designOpen}
        projectPath={projectPath}
        category={category.name}
        displayName={category.displayName}
        schema={configSchema}
        onClose={() => setDesignOpen(false)}
        onChanged={handleDesignChanged}
      />

      {/* 批量删除确认弹窗 */}
      <Modal
        open={confirmDelete.open}
        onClose={handleCancelBatchDelete}
        title={t('data.editor.confirmBatchDelete')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={handleCancelBatchDelete}>
              {t('launch.common.cancel')}
            </Button>
            <Button variant="danger" size="md" onClick={handleConfirmBatchDelete}>
              {t('launch.common.confirmDelete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          {t('launch.common.confirmBatchDeleteBody', { count: String(confirmDelete.count) })}
        </p>
      </Modal>

      {/* 单行删除确认弹窗 */}
      <Modal
        open={confirmDeleteRow !== null}
        onClose={() => setConfirmDeleteRow(null)}
        title={t('launch.common.confirmDelete')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirmDeleteRow(null)}>
              {t('launch.common.cancel')}
            </Button>
            <Button variant="danger" size="md" onClick={confirmDeleteRowExec}>
              {t('launch.common.confirmDelete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">{t('launch.common.confirmDeleteRecord')}</p>
      </Modal>
    </>
  );
});
