import type { FieldSchema } from '@shared/types/launch';
import type { DataTemplate } from '../../types/ipc';
import type { FieldType } from './dataBrowserConstants';
import { getRawKey, formatValue } from './dataBrowserConstants';
import { unwrapPersistentValue, needsEnvelopeUpgrade } from '@shared/persist/value';
import { isBaseDataKey } from '@shared/persist/baseKeys';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import {
  User,
  Calendar,
  BarChart3,
  Lock,
  Settings,
  MessageCircle,
  Package,
  Globe,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 将图标名称（来自 dataBrowserConstants）解析为 lucide 图标组件 */
const ICON_MAP: Record<string, LucideIcon> = {
  User,
  Calendar,
  BarChart3,
  Lock,
  Settings,
  MessageCircle,
  Package,
  Globe,
};

/** 渲染分组图标：支持 lucide 图标名称字符串，回退到原字符串显示（兼容模板 emoji） */
function renderGroupIcon(icon: string): ReactNode {
  const Comp = ICON_MAP[icon];
  return Comp ? <Comp className="w-4 h-4" /> : <span>{icon}</span>;
}

/** 动态分组配置（来自模板或 fallback 到硬编码） */
interface DynamicGroup {
  id: string;
  label: string;
  icon: string;
  fields: string[];
}

/** 右键菜单状态类型 */
interface ContextMenuState {
  x: number;
  y: number;
  row: Record<string, unknown>;
  cell?: string;
  filePath: string;
  tableName: string;
}

/** _persistent 智能编辑弹窗状态类型 */
interface PersistentEditState {
  open: boolean;
  key: string;
  label: string;
  type: FieldType;
  value: unknown;
  rowid: number | null;
  filePath: string;
  tableName: string;
}

/** 通用编辑弹窗状态类型 */
interface EditModalState {
  open: boolean;
  title: string;
  fields: FieldSchema[];
  initialValues: Record<string, unknown>;
  mode: 'create' | 'edit';
  filePath: string;
  tableName: string;
  rowid?: number;
}

interface PersistentGroupEditorProps {
  /** _persistent 表的全部行 */
  rows: Record<string, unknown>[];
  /** 表的字段定义（已合并 schema options） */
  fields: FieldSchema[];
  /** 区段中文名（用于空状态文案） */
  sectionLabel: string;
  /** 动态分组列表 */
  dynamicGroups: DynamicGroup[];
  /** 动态字段类型映射 */
  dynamicFieldTypes: Record<string, FieldType>;
  /** 动态 key 中文标签函数（覆盖模块级 getKeyLabel） */
  getKeyLabel: (key: string) => string;
  /** 数据模板（用于查找字段定义和默认值） */
  template: DataTemplate | null;
  /** 当前折叠的分组 id 集合 */
  collapsedGroups: Set<string>;
  /** 切换分组折叠状态 */
  toggleGroup: (groupId: string) => void;
  /** 玩家数据文件路径 */
  foundSourcePath: string | null;
  /** 表名（'_persistent'） */
  table: string;
  /** 打开右键菜单 */
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  /** 打开 _persistent 智能编辑弹窗 */
  setPersistentEdit: React.Dispatch<React.SetStateAction<PersistentEditState>>;
  /** 打开通用编辑弹窗 */
  setEditModal: React.Dispatch<React.SetStateAction<EditModalState>>;
  /** 请求删除（打开确认弹窗） */
  requestDelete: (filePath: string, tableName: string, rowid: number) => void;
  /**
   * 修复旧格式行（**可选**：缺省不渲染修复按钮）。
   *
   * `_persistent.value` 必须是 `{"value":…,"expire_at":…}` 包装。写入端历史上会把值
   * 写坏成裸值（数字/对象/纯文本），那种行运行时读不可预期，需要在界面上能一键补回格式。
   */
  onRepairLegacyRows?: () => void;
}

/**
 * _persistent 表的分组渲染器
 *
 * 原为 DataBrowserPanel 中 isPersistentTable 分支的 IIFE。
 * 负责：按 dynamicGroups 分组、合并模板字段（虚拟行）、渲染玩家数据分组卡片与全局配置区块。
 */
export function PersistentGroupEditor({
  rows,
  fields,
  sectionLabel,
  dynamicGroups,
  dynamicFieldTypes,
  getKeyLabel,
  template,
  collapsedGroups,
  toggleGroup,
  foundSourcePath,
  table,
  setContextMenu,
  setPersistentEdit,
  setEditModal,
  requestDelete,
  onRepairLegacyRows,
}: PersistentGroupEditorProps) {
  useLocaleSubscription();
  /** 旧格式（裸值）行数：>0 时在分组头部显示「修复旧格式」入口 */
  const legacyRowCount = onRepairLegacyRows
    ? rows.filter(function (r) {
        return needsEnvelopeUpgrade(r.value);
      }).length
    : 0;
  const globalRows = rows.filter(function (r) {
    return String(r.scope ?? '') === 'global';
  });
  const playerRows = rows.filter(function (r) {
    return String(r.scope ?? '') !== 'global';
  });

  // 收集所有已分组的 rawKey，用于找出"其他"字段
  const groupedRawKeys = new Set<string>();
  dynamicGroups.forEach(function (g) {
    g.fields.forEach(function (f) {
      groupedRawKeys.add(f);
    });
  });

  // 从模板中查找字段定义
  function findTemplateField(fieldKey: string) {
    if (!template?.groups) return undefined;
    for (let gi = 0; gi < template.groups.length; gi++) {
      for (let fi = 0; fi < template.groups[gi].fields.length; fi++) {
        if (template.groups[gi].fields[fi].key === fieldKey) return template.groups[gi].fields[fi];
      }
    }
    return undefined;
  }
  // 获取类型默认值
  function getDefaultForType(type: string) {
    switch (type) {
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'json':
        return '{}';
      default:
        return '';
    }
  }
  // 提取玩家前缀（从已有 key 推断，如 user_xxx:）
  let playerPrefix = '';
  if (playerRows.length > 0) {
    const firstKey = String(playerRows[0].key ?? '');
    const colonIdx = firstKey.indexOf(':');
    if (colonIdx > 0) playerPrefix = firstKey.substring(0, colonIdx + 1);
  }

  // 按 dynamicGroups 分组（合并模板字段和实际数据）
  const groupedRows: {
    groupId: string;
    groupLabel: string;
    groupIcon: string;
    rows: Record<string, unknown>[];
  }[] = [];
  dynamicGroups.forEach(function (g) {
    const matched: Record<string, unknown>[] = playerRows.filter(function (r) {
      const rawKey = getRawKey(String(r.key ?? ''));
      return g.fields.indexOf(rawKey) >= 0;
    });
    // 对于模板定义但 _persistent 表里没有的字段，创建虚拟行（显示默认值）
    const matchedRawKeys = new Set(
      matched.map(function (r) {
        return getRawKey(String(r.key ?? ''));
      }),
    );
    g.fields.forEach(function (fieldKey) {
      if (!matchedRawKeys.has(fieldKey)) {
        const fieldDef = findTemplateField(fieldKey);
        if (fieldDef) {
          matched.push({
            key: playerPrefix ? playerPrefix + fieldKey : fieldKey,
            value: fieldDef.default ?? getDefaultForType(fieldDef.type),
            scope: '',
            rowid: null,
            _virtual: true,
          });
        }
      }
    });
    if (matched.length > 0) {
      groupedRows.push({ groupId: g.id, groupLabel: g.label, groupIcon: g.icon, rows: matched });
    }
  });

  // 未匹配到任何分组的字段
  const otherRows = playerRows.filter(function (r) {
    const rawKey = getRawKey(String(r.key ?? ''));
    return !groupedRawKeys.has(rawKey);
  });

  // 渲染单行（玩家数据）
  function renderPlayerRow(row: Record<string, unknown>, ri: number) {
    const key = String(row.key ?? '');
    const val = row.value;
    const rawKey = getRawKey(key);
    const cnLabel = getKeyLabel(key);
    const fieldType: FieldType = dynamicFieldTypes[rawKey] || 'text';
    const isVirtual = row._virtual === true;
    return (
      <div
        key={String(row.rowid ?? 'pv-' + ri)}
        className={
          'flex items-center gap-2 px-3 py-2 group hover:bg-zinc-800/40 ' +
          (ri > 0 ? 'border-t border-zinc-800/50' : '')
        }
        onContextMenu={function (e) {
          if (isVirtual) return;
          e.preventDefault();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            row: row,
            filePath: foundSourcePath || '',
            tableName: table,
          });
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-200 font-medium">
            {cnLabel}
            {isVirtual && (
              <span className="ml-1 text-xs text-zinc-500">{t('data.card.uninitialized')}</span>
            )}
          </div>
          <div className="text-xs text-zinc-500 truncate" title={key}>
            {key}
          </div>
        </div>
        <div
          className={
            'text-sm font-mono text-right shrink-0 min-w-[60px] ' +
            (isVirtual ? 'text-zinc-500 italic' : 'text-zinc-100')
          }
        >
          {formatValue(unwrapPersistentValue(val), 'value')}
        </div>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="sm"
            onClick={function () {
              setPersistentEdit({
                open: true,
                key: key,
                label: cnLabel,
                type: fieldType,
                value: val,
                rowid: isVirtual ? null : (row.rowid as number),
                filePath: foundSourcePath || '',
                tableName: table,
              });
            }}
          >
            {t('launch.common.edit')}
          </Button>
          {/* 基础数据（`__sys_*`）不给删除：删掉下一条消息又会重建，值还变了 —— 
              留一个"删了会自己回来"的按钮比没有更糟。判据用 rawKey（`key` 是 `user_<uid>:__sys_x`） */}
          {!isVirtual && !isBaseDataKey(rawKey) && (
            <Button
              variant="danger"
              size="sm"
              className="text-xs px-1.5 py-0.5 rounded bg-red-800/40 text-red-400 hover:bg-red-800/60"
              onClick={function () {
                requestDelete(foundSourcePath || '', table, row.rowid as number);
              }}
            >
              {t('launch.common.delete')}
            </Button>
          )}
          {isBaseDataKey(rawKey) && (
            <span
              className="text-[10px] text-zinc-600 shrink-0"
              title={t('data.base.engineMaintainedHint')}
            >
              {t('data.base.engineMaintained')}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 渲染一个分组卡片
  function renderGroupCard(
    groupId: string,
    groupLabel: string,
    groupIcon: string,
    groupRows: typeof playerRows,
  ) {
    const isGroupCollapsed = collapsedGroups.has(groupId);
    return (
      <div
        key={groupId}
        className="bg-zinc-900/40 rounded-lg border border-zinc-800 overflow-hidden"
      >
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-800/40 select-none"
          role="button"
          tabIndex={0}
          aria-label={t('data.card.toggleGroupAria', {
            action: isGroupCollapsed ? t('data.card.expand') : t('data.card.collapse'),
            name: groupLabel,
          })}
          aria-expanded={!isGroupCollapsed}
          onClick={function () {
            toggleGroup(groupId);
          }}
          onKeyDown={function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleGroup(groupId);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 inline-flex items-center">
              {isGroupCollapsed ? (
                <ChevronRight aria-hidden="true" className="w-3 h-3" />
              ) : (
                <ChevronDown aria-hidden="true" className="w-3 h-3" />
              )}
            </span>
            <span className="text-sm inline-flex items-center">{renderGroupIcon(groupIcon)}</span>
            <span className="text-xs font-medium text-zinc-200">{groupLabel}</span>
            <span className="text-xs text-zinc-500">({groupRows.length})</span>
          </div>
        </div>
        {!isGroupCollapsed && (
          <div className="border-t border-zinc-800/50">
            {groupRows.map(function (row, ri) {
              return renderPlayerRow(row, ri);
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groupedRows.length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
            <User className="w-4 h-4" />
            <span>{t('data.table.player')}</span>
            <span className="text-zinc-600">
              (
              {groupedRows.reduce(function (s, g) {
                return s + g.rows.length;
              }, 0)}
              )
            </span>
          </div>
          <div className="space-y-2">
            {groupedRows.map(function (grp) {
              return renderGroupCard(grp.groupId, grp.groupLabel, grp.groupIcon, grp.rows);
            })}
            {otherRows.length > 0 &&
              renderGroupCard('__other__', t('data.card.otherFields'), 'Package', otherRows)}
          </div>
        </div>
      )}
      {globalRows.length > 0 && (
        <div>
          <div className="text-xs text-amber-500/70 mb-1.5 flex items-center gap-1">
            <Globe aria-hidden="true" className="w-4 h-4" />
            <span>{t('data.card.globalConfig')}</span>
            <span className="text-zinc-600">({globalRows.length})</span>
          </div>
          <div className="bg-amber-900/10 rounded-lg overflow-hidden border border-amber-800/30">
            {globalRows.map(function (row, ri) {
              const key = String(row.key ?? '');
              const val = row.value;
              const cnLabel = getKeyLabel(key);
              const updatedAt = String(row.updated_at ?? '');
              return (
                <div
                  key={row.rowid ? String(row.rowid) : 'gv-' + ri}
                  className={
                    'flex items-center gap-2 px-3 py-2 group hover:bg-amber-900/20 ' +
                    (ri > 0 ? 'border-t border-amber-800/20' : '')
                  }
                  onContextMenu={function (e) {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      row: row,
                      filePath: foundSourcePath || '',
                      tableName: table,
                    });
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200 font-medium">{cnLabel}</div>
                    <div className="text-xs text-zinc-500 truncate" title={key}>
                      {key}
                    </div>
                  </div>
                  <div className="text-sm text-amber-200 font-mono text-right shrink-0 min-w-[60px]">
                    {formatValue(unwrapPersistentValue(val), 'value')}
                  </div>
                  <div className="text-xs text-zinc-500 shrink-0 hidden sm:block">
                    {updatedAt.substring(5, 16)}
                  </div>
                  <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={function () {
                        setEditModal({
                          open: true,
                          title: t('data.persist.editDot') + cnLabel,
                          fields: fields,
                          initialValues: Object.assign({}, row),
                          mode: 'edit',
                          filePath: foundSourcePath || '',
                          tableName: table,
                          rowid: row.rowid as number,
                        });
                      }}
                    >
                      {t('launch.common.edit')}
                    </Button>
                    {/* 全局配置区同理：基础数据（`__sys_*`）不给删除 */}
                    {!isBaseDataKey(getRawKey(key)) && (
                      <Button
                        variant="danger"
                        size="sm"
                        className="text-xs px-1.5 py-0.5 rounded bg-red-800/40 text-red-400 hover:bg-red-800/60"
                        onClick={function () {
                          requestDelete(foundSourcePath || '', table, row.rowid as number);
                        }}
                      >
                        {t('launch.common.delete')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {rows.length === 0 && (
        <EmptyState
          title={t('launch.common.noData')}
          description={t('data.common.addRecordHint')}
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={function () {
                setEditModal({
                  open: true,
                  title: t('launch.common.add') + sectionLabel,
                  fields: fields,
                  initialValues: {},
                  mode: 'create',
                  filePath: foundSourcePath || '',
                  tableName: table,
                });
              }}
            >
              {t('launch.common.addPlus')}
            </Button>
          }
        />
      )}
      {legacyRowCount > 0 && onRepairLegacyRows && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-800/50 bg-amber-900/20 px-2.5 py-1.5">
          <span className="text-xs text-amber-300">
            {t('data.persist.legacyRowsHint', { count: legacyRowCount })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="text-xs px-2 py-0.5 rounded bg-amber-800/40 text-amber-200 hover:bg-amber-800/60 shrink-0"
            onClick={onRepairLegacyRows}
          >
            {t('data.persist.repairLegacy')}
          </Button>
        </div>
      )}
    </div>
  );
}
