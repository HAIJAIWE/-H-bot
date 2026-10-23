import React, { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { useProjectStore } from '../../stores/projectStore';
import { STORAGE_KEYS } from '../../lib/infra/storageKeys';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { RecordEditModal } from './RecordEditModal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SkeletonTableRow } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import type { TableSchema, FieldSchema } from '@shared/types/launch';
import type { DataTemplate } from '../../types/ipc';
import {
  PLAYER_ROW_HEIGHT,
  // PLAYER_VIRTUAL_THRESHOLD 已删除：列表现在**只有一条渲染路径**（全部虚拟滚动），
  // 按数量分两条会导致"改一处不生效"（2026-10-03 实测踩到）。
  TABLE_DESCRIPTIONS,
  KEY_LABELS,
  FIELD_GROUPS,
  type FieldType,
  FIELD_TYPES,
  FIELD_ENUMS,
  valueToInput,
  inputToValue,
  isPlayersTable,
  isPersistentTable,
  formatValue,
  getFieldLabel,
  getFieldDesc,
  mergeSchemaOptions,
  getTitleField,
  type PlayerWithUid,
} from './dataBrowserConstants';
import { CharacterProfileCard } from './CharacterProfileCard';
import { PersistentGroupEditor } from './PersistentGroupEditor';
import {
  reencodePreservingTtl,
  needsEnvelopeUpgrade,
  migrateToEnvelope,
} from '@shared/persist/value';
import { loadPlayerView, loadConfigTable, type PlayerViewData } from './playerViewData';
import { UidEditDialog } from './UidEditDialog';
import { PersistentEditDialog } from './PersistentEditDialog';
import { PlayerStoreBar } from './PlayerStoreBar';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { flushFlow } from '@renderer/lib/canvas/flushFlow';
import {
  ClipboardList,
  User,
  Backpack,
  Calendar,
  PawPrint,
  Trophy,
  Gem,
  Dices,
  RefreshCw,
  BarChart3,
  Swords,
  Footprints,
  FileText,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';

/** 表格图标解析：将 dataBrowserConstants 中的图标名称字符串解析为 lucide 组件 */
const TABLE_ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  User,
  Backpack,
  Calendar,
  PawPrint,
  Trophy,
  Gem,
  Dices,
  RefreshCw,
  BarChart3,
  Swords,
  Footprints,
  FileText,
};

/** 渲染表格图标：支持 lucide 图标名称，回退到 FileText */
function renderTableIcon(icon: string): ReactNode {
  const Comp = TABLE_ICON_MAP[icon];
  return Comp ? <Comp className="w-4 h-4" /> : <FileText className="w-4 h-4" />;
}

export const DataBrowserPanel = React.memo(function DataBrowserPanel() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  // 订阅 botType：原实现用 useProjectStore.getState() 在 JSX 中读取，非响应式，
  // 切换项目/修改 botType 后 CharacterProfileCard 仍按旧值渲染
  const botType = useProjectStore((s) => s.currentProject?.botType);
  const [template, setTemplate] = useState<DataTemplate | null>(null);
  const [players, setPlayers] = useState<PlayerWithUid[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.playerSearchHistory) || '[]');
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [searching, setSearching] = useState(false);
  const [foundPlayerQQ, setFoundPlayerQQ] = useState<string | null>(null);
  const [foundSourcePath, setFoundSourcePath] = useState<string | null>(null);
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [playerTables, setPlayerTables] = useState<
    { table: string; fields: FieldSchema[]; rows: Record<string, unknown>[] }[]
  >([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['players']));
  const [editModal, setEditModal] = useState<{
    open: boolean;
    title: string;
    fields: FieldSchema[];
    initialValues: Record<string, unknown>;
    mode: 'create' | 'edit';
    filePath: string;
    tableName: string;
    rowid?: number;
  }>({
    open: false,
    title: '',
    fields: [],
    initialValues: {},
    mode: 'create',
    filePath: '',
    tableName: '',
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    row: Record<string, unknown>;
    cell?: string;
    filePath: string;
    tableName: string;
  } | null>(null);
  // UID 编辑状态
  const [uidEditTarget, setUidEditTarget] = useState<{ uid: string; openid: string | null } | null>(
    null,
  );
  const [uidEditValue, setUidEditValue] = useState('');
  const [uidEditError, setUidEditError] = useState('');
  const [uidEditSaving, setUidEditSaving] = useState(false);
  // 动态分组（优先用模板，fallback到硬编码）— useMemo 避免无限循环
  const dynamicGroups = useMemo(
    function () {
      return template?.groups
        ? template.groups.map(function (g) {
            return {
              id: g.id,
              label: g.label,
              icon: g.icon,
              fields: g.fields.map(function (f) {
                return f.key;
              }),
            };
          })
        : FIELD_GROUPS;
    },
    [template],
  );

  // 动态字段类型
  const dynamicFieldTypes = useMemo(
    function () {
      const m: Record<string, FieldType> = {};
      if (template?.groups) {
        template.groups.forEach(function (g) {
          g.fields.forEach(function (f) {
            m[f.key] = f.type as FieldType;
          });
        });
      } else {
        Object.assign(m, FIELD_TYPES);
      }
      return m;
    },
    [template],
  );

  // 动态enum选项
  const dynamicFieldEnums = useMemo(
    function () {
      const m: Record<string, { value: string; label: string }[]> = {};
      if (template?.groups) {
        template.groups.forEach(function (g) {
          g.fields.forEach(function (f) {
            if (f.options) m[f.key] = f.options;
          });
        });
      } else {
        Object.assign(m, FIELD_ENUMS);
      }
      return m;
    },
    [template],
  );

  // 动态 KEY_LABELS（合并模板中的 label）
  const dynamicKeyLabels = useMemo(
    function () {
      const m: Record<string, string> = Object.assign({}, KEY_LABELS);
      if (template?.groups) {
        template.groups.forEach(function (g) {
          g.fields.forEach(function (f) {
            m[f.key] = f.label;
          });
        });
      }
      return m;
    },
    [template],
  );

  // 使用 dynamicKeyLabels 的 getKeyLabel（覆盖模块级函数）
  const getKeyLabel = function (key: string): string {
    const parts = key.split(':');
    const rawKey = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
    return dynamicKeyLabels[rawKey] || rawKey;
  };

  // _persistent 分组卡片折叠状态（默认展开第一组，其余折叠）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(function () {
    const s = new Set<string>();
    dynamicGroups.forEach(function (g, i) {
      if (i > 0) s.add(g.id);
    });
    return s;
  });
  // 智能编辑弹窗状态
  const [persistentEdit, setPersistentEdit] = useState<{
    open: boolean;
    key: string;
    label: string;
    type: FieldType;
    value: unknown;
    rowid: number | null;
    filePath: string;
    tableName: string;
  }>({
    open: false,
    key: '',
    label: '',
    type: 'text',
    value: '',
    rowid: null,
    filePath: '',
    tableName: '',
  });
  const [persistentEditValue, setPersistentEditValue] = useState('');
  const [persistentEditSaving, setPersistentEditSaving] = useState(false);
  /** 正在修复旧格式 `_persistent` 行 */
  const [repairing, setRepairing] = useState(false);
  /** 角色卡数据：字段清单（项目流程 + 存档）× 道具配置表 */
  const [playerView, setPlayerView] = useState<PlayerViewData>({
    fields: [],
    itemConfig: null,
    warnings: [],
  });
  const searchRef = useRef<HTMLInputElement>(null);
  // 搜索防抖：用 useDebouncedValue 替代手写 setTimeout，统一本地过滤与远程搜索的延迟节流
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  // 玩家列表虚拟滚动：测量可用高度（>50 行时启用 react-window）
  const playerListInnerRef = useRef<HTMLDivElement>(null);
  const [playerListHeight, setPlayerListHeight] = useState(0);
  // 全局 Toast 通知（IPC 调用失败时提示用户）
  const toast = useToast();
  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'error') => {
      if (type === 'success') toast.success(message);
      else toast.error(message);
    },
    [toast],
  );
  // 单行删除确认弹窗状态：删除玩家数据记录前二次确认，避免误删
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<{
    filePath: string;
    tableName: string;
    rowid: number;
  } | null>(null);
  // 玩家列表加载错误：区分"加载失败"与"暂无玩家"，避免空列表误导用户
  const [playersLoadError, setPlayersLoadError] = useState<string | null>(null);
  /** 身份一致性问题（只读检查的结果；为空表示没问题或还没查） */
  const [identityIssues, setIdentityIssues] = useState<
    { kind: string; uid: string; detail: string }[]
  >([]);
  /** 待确认"删除玩家"的目标（不可逆操作，先确认再执行） */
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<{ uid: string } | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState(false);
  /** 待合并的源玩家（「合并到…」：把 ta 的存档并入目标玩家） */
  const [mergeFrom, setMergeFrom] = useState<{ uid: string } | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [merging, setMerging] = useState(false);
  /** 还没有基础数据的玩家数（>0 时显示「初始化基础数据」按钮） */
  const [missingBaseCount, setMissingBaseCount] = useState(0);
  const [backfilling, setBackfilling] = useState(false);

  const buildFilePath = useCallback(
    (filename: string) => {
      if (!projectPath) return '';
      return projectPath.replace(/\\/g, '/') + '/data/players/' + filename;
    },
    [projectPath],
  );

  const findPlayerSourcePath = useCallback(
    (uid: string): string | null => {
      // 用 uid 查找
      const player = players.find((p) => p.uid === uid);
      if (!player || player.sources.length === 0) return null;
      return buildFilePath(player.sources[0]);
    },
    [players, buildFilePath],
  );

  /**
   * 问一下"还有几个玩家没有基础数据"—— >0 时列表标题旁会出现初始化按钮。
   *
   * **失败不提示**：这只是个可选提示，不该因为一次统计失败就打扰用户。
   * 必须定义在**首次加载玩家列表的那个 effect 之前** —— 下面 `reloadPlayers`
   * 也要用它，而 effect 的依赖数组在渲染期就会被求值（踩过 TDZ：
   * `Cannot access 'refreshMissingBaseCount' before initialization`）。
   */
  const refreshMissingBaseCount = useCallback(() => {
    if (!projectPath) return;
    // ⚠️ **必须**检查方法存在：这个 bridge 是运行时通过 IPC 注入的，
    // preload 若没同步（例如只加在了另一份定义上、或用户没重启应用），
    // 直接调用会抛 `is not a function` 并让**整个面板**被 ErrorBoundary 兜住
    // （踩过：一个"可选提示"的统计把玩家浏览整页打崩了）。
    // 这里是可选信息 —— 拿不到就当作 0，不显示初始化按钮即可。
    const bridge = window.qqbat?.launchData?.countPlayersMissingBaseData;
    if (typeof bridge !== 'function') return;
    bridge(projectPath)
      .then((res) => {
        if (res.ok && typeof res.data === 'number') setMissingBaseCount(res.data);
      })
      .catch(() => {
        /* 忽略：提示性信息 */
      });
  }, [projectPath]);

  // 同时使用 listPlayers 和 getPlayersWithUid，合并数据
  useEffect(() => {
    if (!projectPath) return;
    setLoadingPlayers(true);
    setPlayersLoadError(null);
    window.qqbat.launchData
      .getPlayersWithUid(projectPath)
      .then((res) => {
        if (res.ok && res.data) {
          setPlayers(res.data);
        } else {
          // 加载失败：记录错误信息，渲染时显示错误提示而非空状态
          console.error('[DataBrowser] getPlayersWithUid failed:', res.error);
          setPlayersLoadError(res.error || t('data.browser.loadPlayersFailed'));
        }
        setLoadingPlayers(false);
      })
      .catch((e) => {
        console.error('[DataBrowser] getPlayersWithUid error:', e);
        setPlayersLoadError(e instanceof Error ? e.message : String(e));
        setLoadingPlayers(false);
      });
    // "还有几个玩家没有基础数据" —— 有的话列表标题旁出现初始化按钮（失败静默）
    refreshMissingBaseCount();
  }, [projectPath, refreshMissingBaseCount]);

  // 加载数据模板（用于 _persistent 字段分组、类型、enum）
  useEffect(() => {
    if (!projectPath) {
      setTemplate(null);
      return;
    }
    // 架构：**读盘前先冲刷**（同 PropertyDrawer；见 lib/canvas/flushFlow.ts）
    void flushFlow(projectPath)
      .then(() => window.qqbat.launchData.getDataTemplate(projectPath))
      .then((res) => {
        if (res.ok && res.data) {
          setTemplate(res.data);
        } else {
          setTemplate(null); // 加载失败用 fallback
        }
      })
      .catch(() => {
        setTemplate(null);
      });
  }, [projectPath]);

  /**
   * 组装角色卡数据：字段清单来自**项目自己的流程声明 + 存档实际值**。
   *
   * 这里的意义（见 docs/game/player-data-cards-design.md）：原来卡片显示什么由一份与项目无关的
   * 通用模板决定，于是把项目里根本不存在的字段画成「（未初始化）」，而项目真实的
   * `bag`/`equip`/`lv` 一个都没认出来。现在反过来：**项目有什么就显示什么**。
   */
  // 玩家存档的稳定标识 + 稳定行引用：`playerTables` 每次刷新都是新数组，
  // 直接进 deps 会让下面那个 effect 反复重跑 —— 每跑一次都要
  // `flow:load` 解析一遍 1MB+ 的 flow.json（实测刷一次面板触发十几次，
  // 主进程日志被「已为 N 个节点补全端口」刷满）。
  // 用内容拼出的 key 做依赖，并把行放进 ref，effect 里就不再直接读 `playerTables`。
  const playerDataKey = useMemo(() => {
    const persistent = playerTables.find((pt) => isPersistentTable(pt.table));
    return (persistent?.rows ?? [])
      .map((r) => `${String(r.key ?? '')}=${String(r.value ?? '')}`)
      .join('\n');
  }, [playerTables]);

  const playerRowsRef = useRef<{ key?: unknown; value?: unknown; scope?: unknown }[]>([]);
  playerRowsRef.current = (playerTables.find((pt) => isPersistentTable(pt.table))?.rows ?? []) as {
    key?: unknown;
    value?: unknown;
    scope?: unknown;
  }[];

  // 身份一致性检查（只读）：存档按 uid 存，而 uid 来自 openid→uid 映射，两者漂了
  // 不会报错、只是"数据认不出是谁"。所以在这里主动体检一次并显式提示。
  useEffect(() => {
    if (!projectPath) {
      setIdentityIssues([]);
      return;
    }
    let cancelled = false;
    // 用 try 兜住**同步**抛错：通道可能不存在（测试替身 / 版本错配），
    // 而 "checkIdentity is not a function" 是同步 TypeError，只写 .catch 挡不住。
    try {
      const check = window.qqbat.launchData.checkIdentity;
      if (typeof check !== 'function') {
        setIdentityIssues([]);
        return;
      }
      void check(projectPath)
        .then((res) => {
          if (cancelled) return;
          setIdentityIssues(
            res.ok && res.data ? res.data.issues.filter((i) => i.kind !== 'empty_mapping') : [],
          );
        })
        .catch(() => {
          if (!cancelled) setIdentityIssues([]); // 体检失败不打扰用户
        });
    } catch {
      setIdentityIssues([]);
    }
    return () => {
      cancelled = true;
    };
  }, [projectPath, playerDataKey]);

  useEffect(() => {
    let cancelled = false;
    const rows = playerRowsRef.current;
    // 架构：**读盘前先冲刷**。loadPlayerView 会调主进程的 `getPlayerSchema`，
    // 而它按 flow.json 的 `variable_persist` 声明派生字段契约 —— 不冲刷的话
    // "刚改完画布就点玩家"会按旧图算字段（新 key 看不到）。干净时 flushFlow 是 no-op。
    // 屏障形态已登记在 tests/guards/flowReadBarrier.test.ts（playerSchemaService）。
    void flushFlow(projectPath)
      .then(() =>
        loadPlayerView(projectPath, rows, {
          loadFlow: async (p) => {
            const res = await window.qqbat.flow.load(p);
            return { ok: res.ok, data: res.data, error: res.error };
          },
          getPlayerSchema: async (p) => {
            const res = await window.qqbat.launchData.getPlayerSchema(p);
            return res.ok && res.data ? { fields: res.data.fields } : null;
          },
          queryConfigTable: async (dbPath, table) =>
            loadConfigTable(
              (p, t, page, size) => window.qqbat.launchData.queryTable(p, t, page, size),
              (p) => window.qqbat.launchData.getSchema(p),
              dbPath,
              table,
            ),
        }),
      )
      .then((view) => {
        if (!cancelled) setPlayerView(view);
      })
      .catch(() => {
        if (!cancelled) setPlayerView({ fields: [], itemConfig: null, warnings: [] });
      });
    return () => {
      cancelled = true;
    };
    // `playerRowsRef` 是 ref（不参与依赖比较）；`playerDataKey` 是 playerTables 的内容摘要，
    // 用它替代 playerTables 正是为了不被"每次刷新都是新数组"反复触发。
  }, [projectPath, playerDataKey]);

  const handleSelectPlayer = useCallback(
    async (uid: string) => {
      setFoundPlayerQQ(uid);
      setPlayerTables([]);
      const fullPath = findPlayerSourcePath(uid);
      if (!fullPath) return;
      setFoundSourcePath(fullPath);
      try {
        const schemaRes = await window.qqbat.launchData.getSchema(fullPath);
        if (schemaRes.ok && schemaRes.data) setSchema(schemaRes.data);
        const dataRes = await window.qqbat.launchData.queryPlayerTables(fullPath, uid);
        if (dataRes.ok && dataRes.data) {
          setPlayerTables(dataRes.data);
          const collapsed = new Set<string>(dataRes.data.map((d) => d.table));
          collapsed.delete('players');
          setCollapsedSections(collapsed);
        }
      } catch (e) {
        console.error('[DataBrowser] handleSelectPlayer failed:', e);
        showToast(
          t('launch.common.loadDataFailedWithMsg', {
            msg: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [findPlayerSourcePath, showToast],
  );

  const handleSearch = useCallback(
    async (q: string) => {
      if (!projectPath || !q.trim()) return;
      setSearching(true);
      try {
        const res = await window.qqbat.launchData.searchPlayer(projectPath, q.trim());
        if (res.ok && res.data && res.data.length > 0) {
          const qqVal = String(
            res.data[0].row.qq ?? res.data[0].row.user_id ?? res.data[0].row.qq_number ?? q.trim(),
          );
          setFoundPlayerQQ(qqVal);
          const srcPath = buildFilePath(res.data[0].source);
          setFoundSourcePath(srcPath);
          const schemaRes = await window.qqbat.launchData.getSchema(srcPath);
          if (schemaRes.ok && schemaRes.data) setSchema(schemaRes.data);
          const dataRes = await window.qqbat.launchData.queryPlayerTables(srcPath, qqVal);
          if (dataRes.ok && dataRes.data) {
            setPlayerTables(dataRes.data);
            const collapsed = new Set<string>(dataRes.data.map((d) => d.table));
            collapsed.delete('players');
            setCollapsedSections(collapsed);
          }
        } else {
          setFoundPlayerQQ(null);
          setFoundSourcePath(null);
          setPlayerTables([]);
        }
        // 使用函数式更新避免将 searchHistory 放入 useCallback 依赖，防止重复搜索
        setSearchHistory((prev) => {
          if (prev.includes(q.trim())) return prev;
          const newHist = [q.trim(), ...prev].slice(0, 10);
          sessionStorage.setItem(STORAGE_KEYS.playerSearchHistory, JSON.stringify(newHist));
          return newHist;
        });
      } catch (e) {
        console.error('[DataBrowser] handleSearch failed:', e);
        showToast(
          t('launch.common.searchFailedWithMsg', {
            msg: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        setSearching(false);
      }
    },
    [projectPath, buildFilePath, showToast],
  );

  useEffect(() => {
    if (!debouncedSearchQuery.trim()) {
      setFoundPlayerQQ(null);
      setFoundSourcePath(null);
      setPlayerTables([]);
      return;
    }
    // 防抖已由 useDebouncedValue 完成，这里直接触发远程搜索
    handleSearch(debouncedSearchQuery);
  }, [debouncedSearchQuery, handleSearch]);

  const toggleSection = (table: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // 切换玩家时重置分组折叠状态（默认展开第一组，其余折叠）
  useEffect(() => {
    const s = new Set<string>();
    dynamicGroups.forEach(function (g, i) {
      if (i > 0) s.add(g.id);
    });
    // 只在内容真正变化时才更新，避免无限循环
    setCollapsedGroups((prev) => {
      if (prev.size === s.size && [...prev].every((v) => s.has(v))) return prev;
      return s;
    });
  }, [foundPlayerQQ, dynamicGroups]);

  // 智能编辑弹窗打开时，将 value 转换为 input 可显示的字符串
  useEffect(() => {
    if (persistentEdit.open) {
      setPersistentEditValue(valueToInput(persistentEdit.value, persistentEdit.type));
    }
  }, [persistentEdit]);

  const handleEditSave = async (values: Record<string, unknown>) => {
    if (!editModal.filePath || !editModal.tableName) return;
    try {
      if (editModal.mode === 'edit' && editModal.rowid) {
        await window.qqbat.launchData.updateRecord(
          editModal.filePath,
          editModal.tableName,
          editModal.rowid,
          values,
        );
      } else {
        await window.qqbat.launchData.insertRecord(editModal.filePath, editModal.tableName, values);
      }
      if (foundPlayerQQ && foundSourcePath) {
        const dataRes = await window.qqbat.launchData.queryPlayerTables(
          foundSourcePath,
          foundPlayerQQ,
        );
        if (dataRes.ok && dataRes.data) {
          setPlayerTables(dataRes.data);
        } else {
          // 刷新数据失败时提示用户，避免静默跳过
          showToast(dataRes.error ?? t('data.browser.refreshFailed'));
        }
      }
    } catch (e) {
      console.error('[DataBrowser] handleEditSave failed:', e);
      // 重新抛出，让 RecordEditModal 保持打开并通过 setError 显示错误，用户可重试
      // 不在此处 showToast，避免与 RecordEditModal 内的 setError 形成双重错误提示
      throw e;
    }
  };

  const handleDelete = useCallback(
    async (filePath: string, tableName: string, rowid: number) => {
      try {
        await window.qqbat.launchData.deleteRecord(filePath, tableName, rowid);
        if (foundPlayerQQ && foundSourcePath) {
          const dataRes = await window.qqbat.launchData.queryPlayerTables(
            foundSourcePath,
            foundPlayerQQ,
          );
          if (dataRes.ok && dataRes.data) {
            setPlayerTables(dataRes.data);
          } else {
            // 刷新数据失败时提示用户，避免静默跳过
            showToast(dataRes.error ?? t('data.browser.refreshFailed'));
          }
        }
      } catch (e) {
        console.error('[DataBrowser] handleDelete failed:', e);
        showToast(
          t('launch.common.deleteFailedWithMsg', {
            msg: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [foundPlayerQQ, foundSourcePath, showToast],
  );

  // 点击删除按钮：打开确认弹窗（不立即删除）
  const requestDelete = useCallback((filePath: string, tableName: string, rowid: number) => {
    setConfirmDeleteRow({ filePath, tableName, rowid });
  }, []);

  // 确认删除：执行删除并关闭弹窗
  const confirmDeleteRowExec = useCallback(async () => {
    if (!confirmDeleteRow) return;
    const { filePath, tableName, rowid } = confirmDeleteRow;
    setConfirmDeleteRow(null);
    await handleDelete(filePath, tableName, rowid);
  }, [confirmDeleteRow, handleDelete]);

  /**
   * 问一下"还有几个玩家没有基础数据"—— >0 时列表标题旁会出现初始化按钮。
   *
   * **失败不提示**：这只是个可选提示，不该因为一次统计失败就打扰用户。
   * 单独抽成回调是因为**两个地方**都要用：首次加载玩家列表、以及"重试"按钮。
   */
  /** 重新加载玩家列表（供加载失败后重试） */
  const reloadPlayers = useCallback(() => {
    if (!projectPath) return;
    setLoadingPlayers(true);
    setPlayersLoadError(null);
    window.qqbat.launchData
      .getPlayersWithUid(projectPath)
      .then((res) => {
        if (res.ok && res.data) {
          setPlayers(res.data);
        } else {
          setPlayersLoadError(res.error || t('data.browser.loadPlayersFailed'));
        }
        setLoadingPlayers(false);
      })
      .catch((e) => {
        setPlayersLoadError(e instanceof Error ? e.message : String(e));
        setLoadingPlayers(false);
      });
    refreshMissingBaseCount();
  }, [projectPath, refreshMissingBaseCount]);

  /** 确认删除玩家：调主进程（它会先备份该玩家的 db），然后刷新玩家列表 */
  const confirmDeletePlayerExec = useCallback(async () => {
    if (!confirmDeletePlayer || !projectPath) return;
    const uid = confirmDeletePlayer.uid;
    setConfirmDeletePlayer(null);
    setDeletingPlayer(true);
    try {
      const res = await window.qqbat.launchData.deletePlayer(projectPath, uid);
      if (!res.ok) {
        showToast(res.error ?? t('data.browser.deletePlayerFailed'));
        return;
      }
      showToast(t('data.browser.deletePlayerOk', { uid, count: res.data?.deleted ?? 0 }));
      // 删的是当前选中的玩家 → 清掉右侧详情，避免显示已删除的数据
      if (foundPlayerQQ === uid) {
        setFoundPlayerQQ(null);
        setFoundSourcePath(null);
        setPlayerTables([]);
      }
      reloadPlayers();
    } catch (e) {
      console.error('[DataBrowser] deletePlayer failed:', e);
      showToast(
        t('launch.common.deleteFailedWithMsg', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setDeletingPlayer(false);
    }
  }, [confirmDeletePlayer, projectPath, foundPlayerQQ, showToast, reloadPlayers]);

  /**
   * 确认合并：把源玩家的**存档 + 身份映射**一起并进目标玩家。
   *
   * 机器人运行时后端会拒绝（翻译器把映射缓存在内存，稍后会覆盖文件改动）——
   * 这里如实把那个错误提示出来，而不是静默失败。
   */
  const confirmMergeExec = useCallback(async () => {
    if (!mergeFrom || !mergeTarget || !projectPath) return;
    const from = mergeFrom.uid;
    const to = mergeTarget;
    setMergeFrom(null);
    setMerging(true);
    try {
      const res = await window.qqbat.launchData.mergePlayers(projectPath, from, to);
      if (!res.ok) {
        showToast(res.error ?? t('data.browser.mergeFailed'));
        return;
      }
      showToast(t('data.browser.mergeOk', { from, to, moved: String(res.data?.moved ?? 0) }));
      // 源玩家没了 → 清掉右侧详情，避免显示已合并的数据
      if (foundPlayerQQ === from) {
        setFoundPlayerQQ(null);
        setFoundSourcePath(null);
        setPlayerTables([]);
      }
      reloadPlayers();
    } catch (e) {
      console.error('[DataBrowser] mergePlayers failed:', e);
      showToast(
        t('launch.common.deleteFailedWithMsg', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setMerging(false);
    }
  }, [mergeFrom, mergeTarget, projectPath, foundPlayerQQ, showToast, reloadPlayers]);

  // 智能编辑弹窗保存
  const handlePersistentEditSave = async () => {
    if (!persistentEdit.filePath || !persistentEdit.tableName) return;
    setPersistentEditSaving(true);
    try {
      const inputValue = inputToValue(
        persistentEditValue,
        persistentEdit.type,
        persistentEdit.value,
      );
      // `_persistent.value` 必须是 `{"value":x,"expire_at":t}` 包装（运行时 extractStoredValue
      // 认这个格式）。这里直接改表，绕过了 persistentStore.saveValue，所以得自己补包装 ——
      // 顺手继承原条目的 TTL，否则「改个数值」会把带过期的条目变成永久。
      const newValue = reencodePreservingTtl(persistentEdit.value, inputValue);
      if (persistentEdit.rowid) {
        // 已有记录：更新
        await window.qqbat.launchData.updateRecord(
          persistentEdit.filePath,
          persistentEdit.tableName,
          persistentEdit.rowid,
          { value: newValue },
        );
      } else {
        // 虚拟行（模板字段未初始化）：插入新记录
        await window.qqbat.launchData.insertRecord(
          persistentEdit.filePath,
          persistentEdit.tableName,
          {
            key: persistentEdit.key,
            value: newValue,
            scope: '',
          },
        );
      }
      setPersistentEdit((prev) => ({ ...prev, open: false }));
      // 刷新数据
      if (foundPlayerQQ && foundSourcePath) {
        const dataRes = await window.qqbat.launchData.queryPlayerTables(
          foundSourcePath,
          foundPlayerQQ,
        );
        if (dataRes.ok && dataRes.data) {
          setPlayerTables(dataRes.data);
        } else {
          // 刷新数据失败时提示用户，避免静默跳过
          showToast(dataRes.error ?? t('data.browser.refreshFailed'));
        }
      }
    } catch (e) {
      console.error('[DataBrowser] handlePersistentEditSave failed:', e);
      showToast(
        t('launch.common.saveFailedWithMsg', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
      // 失败时不关闭弹窗，保留用户输入以便重试
    } finally {
      setPersistentEditSaving(false);
    }
  };

  /**
   * 初始化历史玩家的**引擎基础数据**（注册时间 / 最后在线 / 消息计数）。
   *
   * 为什么需要这个按钮：基础数据是"从功能上线那一刻起"才记的，上线之前的玩家
   * 档案里只有业务字段（`lv`/`gold`/`bag`…），卡片上"基础数据"那一块就是空的。
   * 这里用存档行的 `updated_at` 反推一个参考值（**天级精度，不编造**）：
   *   最早的一行 → 注册时间；最晚的一行 → 最后在线；计数填 0（存档里没有条数）。
   *
   * 幂等：已有值的 key 一律不动 —— 尤其是 `registered_at`（它的语义是"首次见到"，
   * 被改写就废了）。所以点第二次是安全的。
   */
  const handleBackfillBaseData = useCallback(async () => {
    if (!projectPath || backfilling) return;
    // 同 refreshMissingBaseCount：bridge 可能没同步，别让"可选功能"把整页打崩
    const backfill = window.qqbat?.launchData?.backfillPlayerBaseData;
    if (typeof backfill !== 'function') {
      showToast(t('data.base.initFailed'));
      return;
    }
    setBackfilling(true);
    try {
      const res = await backfill(projectPath);
      if (!res.ok) {
        showToast(res.error || t('data.base.initFailed'));
        return;
      }
      showToast(
        t('data.base.initDone', {
          players: String(res.data?.players ?? 0),
          written: String(res.data?.written ?? 0),
        }),
        'success',
      );
      setMissingBaseCount(0);
      // 重新拉数据，让卡片立刻显示新写入的基础数据（而不是等下次切玩家）
      const qq = foundPlayerQQ;
      const sourcePath = foundSourcePath;
      if (qq && sourcePath) {
        const dataRes = await window.qqbat.launchData.queryPlayerTables(sourcePath, qq);
        if (dataRes.ok && dataRes.data) setPlayerTables(dataRes.data);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('data.base.initFailed'));
    } finally {
      setBackfilling(false);
    }
  }, [projectPath, backfilling, foundPlayerQQ, foundSourcePath, showToast]);

  /**
   * 修复 `_persistent` 里的**旧格式行**：把裸值补成 `{"value":…,"expire_at":null}` 包装。
   *
   * 为什么需要：历史版本的编辑面板会把解包后的值直接写回（写坏了格式）。
   * 那种行运行时 `extractStoredValue` 读不可预期 —— `'expire_at' in 55` 会抛。
   * 现在的写入端已经修好，但**已经写坏的行得能救回来**。
   */
  const handleRepairLegacyRows = useCallback(async () => {
    const persistentTable = playerTables.find((pt) => isPersistentTable(pt.table));
    const sourcePath = foundSourcePath;
    const qq = foundPlayerQQ;
    if (!persistentTable || !sourcePath || !qq) return;
    const targets = persistentTable.rows.filter((r) => needsEnvelopeUpgrade(r.value));
    if (targets.length === 0) return;
    setRepairing(true);
    try {
      let fixed = 0;
      for (const row of targets) {
        const rowid = row.rowid as number | undefined;
        if (!rowid) continue;
        const res = await window.qqbat.launchData.updateRecord(
          sourcePath,
          persistentTable.table,
          rowid,
          { value: migrateToEnvelope(row.value) },
        );
        if (res.ok) fixed++;
      }
      // 重新拉一次，确保界面显示的是磁盘上的真实状态（而不是本地猜测）
      const dataRes = await window.qqbat.launchData.queryPlayerTables(sourcePath, qq);
      if (dataRes.ok && dataRes.data) setPlayerTables(dataRes.data);
      showToast(t('data.persist.repairDone', { count: fixed }));
    } catch (e) {
      console.error('[DataBrowser] handleRepairLegacyRows failed:', e);
      showToast(
        t('launch.common.saveFailedWithMsg', { msg: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setRepairing(false);
    }
  }, [playerTables, foundSourcePath, foundPlayerQQ, showToast]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setContextMenu(null);
  };

  // 打开 UID 编辑弹窗
  const openUidEdit = useCallback((player: PlayerWithUid) => {
    setUidEditTarget({ uid: player.uid, openid: player.openid });
    setUidEditValue(player.uid);
    setUidEditError('');
  }, []);

  // 保存 UID 编辑
  const saveUidEdit = useCallback(async () => {
    if (!uidEditTarget || !projectPath) return;
    const newUid = parseInt(uidEditValue, 10);
    if (isNaN(newUid) || newUid < 1) {
      setUidEditError(t('data.browser.uidInvalid'));
      return;
    }
    if (!uidEditTarget.openid) {
      setUidEditError(t('data.browser.noOpenidMap'));
      return;
    }
    setUidEditSaving(true);
    try {
      const res = await window.qqbat.launchData.updatePlayerUid(
        projectPath,
        uidEditTarget.openid,
        newUid,
      );
      if (res.ok) {
        setUidEditTarget(null);
        // 刷新玩家列表
        const playersRes = await window.qqbat.launchData.getPlayersWithUid(projectPath);
        if (playersRes.ok && playersRes.data) setPlayers(playersRes.data);
        // 如果当前查看的玩家被修改，刷新数据
        if (foundPlayerQQ && foundSourcePath) {
          const dataRes = await window.qqbat.launchData.queryPlayerTables(
            foundSourcePath,
            String(newUid),
          );
          if (dataRes.ok && dataRes.data) {
            setPlayerTables(dataRes.data);
            setFoundPlayerQQ(String(newUid));
          } else {
            // 刷新数据失败时提示用户，避免静默跳过
            showToast(dataRes.error ?? t('data.browser.refreshFailed'));
          }
        }
      } else {
        setUidEditError(res.error || t('launch.common.saveFailed'));
      }
    } catch (e) {
      console.error('[DataBrowser] saveUidEdit failed:', e);
      setUidEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setUidEditSaving(false);
    }
  }, [uidEditTarget, uidEditValue, projectPath, foundPlayerQQ, foundSourcePath, showToast]);

  const filteredPlayers = useMemo(() => {
    const q = debouncedSearchQuery.trim();
    if (!q) return players;
    return players.filter((p) => p.uid.includes(q) || (p.openid !== null && p.openid.includes(q)));
  }, [players, debouncedSearchQuery]);

  /** 玩家列表虚拟滚动行渲染所需数据（通过 itemData 传递，避免闭包失效） */
  const playerItemData = useMemo<{
    players: PlayerWithUid[];
    foundPlayerQQ: string | null;
    onSelect: (uid: string) => void;
    onEditUid: (player: PlayerWithUid) => void;
    onDeletePlayer: (player: PlayerWithUid) => void;
    onMergePlayer: (player: PlayerWithUid) => void;
  }>(
    () => ({
      players: filteredPlayers,
      foundPlayerQQ,
      onSelect: handleSelectPlayer,
      onEditUid: openUidEdit,
      onDeletePlayer: (player: PlayerWithUid) => setConfirmDeletePlayer({ uid: player.uid }),
      onMergePlayer: (player: PlayerWithUid) => {
        setMergeFrom({ uid: player.uid });
        setMergeTarget('');
      },
    }),
    [filteredPlayers, foundPlayerQQ, handleSelectPlayer, openUidEdit],
  );

  /** 虚拟滚动行渲染函数 —— 必须 apply style 以定位 */
  const renderPlayerRow = useCallback(
    ({ index, style, data }: ListChildComponentProps<typeof playerItemData>) => {
      const player = data.players[index];
      const displayName = player.nickname || t('data.browser.playerUidLabel') + player.uid;
      const isActive = data.foundPlayerQQ === player.uid;
      return (
        <div
          style={style}
          role="button"
          tabIndex={0}
          aria-label={t('data.browser.selectPlayerAria', { name: displayName })}
          className={
            'px-3 py-2 text-xs cursor-pointer border-l-2 overflow-hidden ' +
            (isActive
              ? 'bg-zinc-800 text-zinc-200 border-l-blue-500'
              : 'text-zinc-400 hover:bg-zinc-800/50 border-l-transparent')
          }
          onClick={() => data.onSelect(player.uid)}
          // 右键行 → 弹"删除玩家"确认框（与非虚拟滚动那条保持一致）
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            data.onDeletePlayer(player);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              data.onSelect(player.uid);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 min-w-0">
              <span className="font-medium truncate">{displayName}</span>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs px-1 rounded bg-zinc-700/50 text-zinc-500 hover:text-blue-400 hover:bg-zinc-700 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onEditUid(player);
                }}
                title={t('data.browser.editUid')}
              >
                {t('data.browser.changeUid')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs px-1 rounded bg-zinc-700/50 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onDeletePlayer(player);
                }}
                title={t('data.browser.deletePlayerHint')}
              >
                {t('data.browser.deletePlayer')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs px-1 rounded bg-zinc-700/50 text-zinc-500 hover:text-amber-400 hover:bg-zinc-700 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onMergePlayer(player);
                }}
                title={t('data.browser.mergeHint')}
              >
                {t('data.browser.mergeTo')}
              </Button>
            </div>
            <span className="text-xs text-zinc-500 shrink-0">
              {player.recordCount} {t('launch.common.recordUnit')}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-zinc-500 mt-0.5">
            <span>UID: {player.uid}</span>
            {player.openid && (
              <span className="truncate" title={player.openid}>
                &nbsp;| openid: {player.openid.substring(0, 8)}...
              </span>
            )}
          </div>
        </div>
      );
    },
    [],
  );

  // 测量玩家列表可用高度（ResizeObserver），仅当 >50 行时实际使用
  useEffect(() => {
    const el = playerListInnerRef.current;
    if (!el) return;
    const update = () => setPlayerListHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!projectPath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title={t('launch.common.selectProject')}
          description={t('data.browser.selectProjectHint')}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* 存档位置：一行可见 + 一键打开（玩家数据现在存在**项目内**，用户需要知道在哪） */}
      <PlayerStoreBar projectPath={projectPath} />
      <div className="flex-1 flex min-h-0">
        <div className="w-56 border-r border-zinc-800 flex flex-col">
          <div className="p-2 border-b border-zinc-800 relative">
            <div className="text-xs text-zinc-300 font-medium mb-1">{t('data.browser.search')}</div>
            <input
              ref={searchRef}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500"
              placeholder={t('data.browser.searchPlaceholder')}
              aria-label={t('data.browser.searchAria')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
              onFocus={() => searchHistory.length > 0 && setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 200)}
            />
            {showHistory && searchHistory.length > 0 && (
              <div className="absolute top-full left-2 right-2 bg-zinc-800 border border-zinc-700 rounded mt-0.5 z-10 shadow-lg">
                {searchHistory.map((q) => (
                  <div
                    key={q}
                    className="px-2 py-1 text-xs text-zinc-400 cursor-pointer hover:bg-zinc-700 hover:text-zinc-200"
                    role="option"
                    tabIndex={0}
                    onMouseDown={() => {
                      setSearchQuery(q);
                      setShowHistory(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setSearchQuery(q);
                        setShowHistory(false);
                      }
                    }}
                  >
                    {q}
                  </div>
                ))}
              </div>
            )}
            {searching && (
              <div className="text-xs text-blue-400 mt-1 flex items-center gap-1.5">
                <Spinner size="sm" />
                <span>{t('launch.common.searching')}</span>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 text-xs text-zinc-500 uppercase tracking-wider shrink-0 flex items-center justify-between gap-2">
              <span>
                {t('data.browser.playerList')} {loadingPlayers ? '' : '(' + players.length + ')'}
              </span>
              {/*
                初始化基础数据：引擎基础数据（注册时间/最后在线/消息计数）是
                "从功能上线那一刻起"才记的，老玩家档案里没有 → 卡片上那一块是空的。
                这个按钮用存档的 `updated_at` 反推一个参考值（天级精度，不编）。
                幂等：已有值的 key 一律不动，所以点第二次是安全的。
              */}
              {!loadingPlayers && missingBaseCount > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={backfilling}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 normal-case tracking-normal shrink-0"
                  title={t('data.base.initHint', { count: String(missingBaseCount) })}
                  onClick={handleBackfillBaseData}
                >
                  {t('data.base.initAction', { count: String(missingBaseCount) })}
                </Button>
              )}
            </div>
            {identityIssues.length > 0 && (
              <div
                className="shrink-0 px-3 py-1.5 text-[10px] leading-tight bg-amber-500/10 text-amber-400/90 border-b border-amber-500/20"
                title={identityIssues
                  .map((i) => (i.uid ? `UID ${i.uid}: ` : '') + i.detail)
                  .join('\n')}
              >
                <span className="font-medium">
                  {t('data.browser.identityWarning', { count: String(identityIssues.length) })}
                </span>
                <span className="text-amber-500/70 ml-1">
                  {t('data.browser.identityWarningHint')}
                </span>
              </div>
            )}
            <div ref={playerListInnerRef} className="flex-1 overflow-hidden">
              {loadingPlayers && (
                <div className="px-4 mt-2 space-y-1">
                  <SkeletonTableRow columns={3} />
                  <SkeletonTableRow columns={3} />
                  <SkeletonTableRow columns={3} />
                  <SkeletonTableRow columns={3} />
                  <SkeletonTableRow columns={3} />
                </div>
              )}
              {!loadingPlayers && playersLoadError && players.length === 0 && (
                <div className="text-xs text-center mt-6 px-4">
                  <div className="text-red-400 mb-2 font-medium">
                    {t('data.browser.playersLoadFailed')}
                  </div>
                  <div className="text-zinc-500 mb-4 break-words">{playersLoadError}</div>
                  <Button variant="primary" size="sm" onClick={reloadPlayers}>
                    {t('launch.common.retry')}
                  </Button>
                </div>
              )}
              {!loadingPlayers && !playersLoadError && filteredPlayers.length === 0 && (
                <div className="mt-6 px-4">
                  <EmptyState
                    title={t('data.browser.noPlayers')}
                    description={t('data.browser.emptyHint')}
                  />
                </div>
              )}
              {/* 玩家列表**只有一条渲染路径**：全部走虚拟滚动。
                  曾经按数量分两条（>50 走 react-window、≤50 走内联 map），后果是"改一处不生效" ——
                  2026-10-03 就在这上面栽过：加了「删除玩家」按钮，而 11 个玩家走的是另一条，看不到。
                  高度还没测到（首帧）时用兜底高度，保证永远有内容。 */}
              {!loadingPlayers && filteredPlayers.length > 0 && (
                <FixedSizeList
                  height={
                    playerListHeight > 0
                      ? playerListHeight
                      : PLAYER_ROW_HEIGHT * Math.min(filteredPlayers.length, 8)
                  }
                  itemCount={filteredPlayers.length}
                  itemSize={PLAYER_ROW_HEIGHT}
                  width="100%"
                  itemData={playerItemData}
                  className="scrollbar-thin"
                >
                  {renderPlayerRow}
                </FixedSizeList>
              )}
            </div>
          </div>

          {foundPlayerQQ && (
            <div className="border-t border-zinc-800 p-2">
              <div className="text-xs text-green-400">
                {t('data.browser.current')} {foundPlayerQQ}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {t('data.browser.recordCount', {
                  count: String(
                    playerTables.reduce(function (s, tb) {
                      return s + tb.rows.length;
                    }, 0),
                  ),
                })}{' '}
                / {t('data.browser.tableCount', { count: String(playerTables.length) })}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {!foundPlayerQQ && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-zinc-500 text-sm mb-2">{t('data.browser.selectToView')}</div>
                <div className="text-zinc-500 text-xs">{t('data.browser.selectToViewHint')}</div>
              </div>
            </div>
          )}
          {foundPlayerQQ && playerTables.length === 0 && !searching && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-zinc-500 text-sm mb-2">{t('data.browser.notFound')}</div>
                <div className="text-zinc-500 text-xs">{t('data.card.noRoleHintAlt')}</div>
              </div>
            </div>
          )}
          {foundPlayerQQ && playerTables.length > 0 && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              {playerView.warnings.length > 0 && (
                <div className="bg-amber-900/20 border border-amber-800/50 rounded p-2">
                  {playerView.warnings.map(function (w, i) {
                    return (
                      <div key={i} className="text-xs text-amber-300">
                        {w}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* 角色面板 — 字段来自项目自己的流程声明 + 存档实际值（见 docs/game/player-data-cards-design.md） */}
              <CharacterProfileCard
                fields={playerView.fields}
                foundPlayerQQ={foundPlayerQQ}
                botType={botType}
                itemConfig={playerView.itemConfig}
                onEditPlayer={function () {
                  // 打开 players 表的编辑弹窗：找到第一行数据并填充表单
                  const playersTable = playerTables.find(function (t) {
                    return t.table === 'players';
                  });
                  if (playersTable && playersTable.rows.length > 0) {
                    const firstRow = playersTable.rows[0];
                    setEditModal({
                      open: true,
                      title: t('data.card.editPlayer'),
                      fields: mergeSchemaOptions(playersTable.fields, 'players', schema),
                      initialValues: Object.assign({}, firstRow),
                      mode: 'edit',
                      filePath: foundSourcePath || '',
                      tableName: 'players',
                      rowid: firstRow.rowid as number,
                    });
                  } else {
                    // 没有 players 表时，"编辑玩家"落到 _persistent 上（字段就在那里）
                    const persistentTable = playerTables.find(function (pt) {
                      return isPersistentTable(pt.table);
                    });
                    const firstRow = persistentTable?.rows?.[0];
                    if (persistentTable && firstRow) {
                      setEditModal({
                        open: true,
                        title: t('data.card.editPlayer'),
                        fields: mergeSchemaOptions(persistentTable.fields, '_persistent', schema),
                        initialValues: Object.assign({}, firstRow),
                        mode: 'edit',
                        filePath: foundSourcePath || '',
                        tableName: '_persistent',
                        rowid: firstRow.rowid as number,
                      });
                    }
                  }
                }}
              />
              {playerTables
                .filter(function (playerTable) {
                  // 跳过 players 表：已由 CharacterProfileCard 展示并提供编辑入口
                  return !isPlayersTable(playerTable.table);
                })
                .map(function (playerTable) {
                  const table = playerTable.table;
                  const fields = mergeSchemaOptions(playerTable.fields, table, schema);
                  const rows = playerTable.rows;
                  const desc = TABLE_DESCRIPTIONS[table];
                  const sectionLabel = desc ? desc.label : table;
                  const sectionIcon = desc ? desc.icon : 'FileText';
                  const isCollapsed = collapsedSections.has(table);
                  // 注：players 表已在 playerTables.filter 中跳过（由 CharacterProfileCard 展示）
                  return (
                    <div
                      key={table}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden"
                    >
                      <div
                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-800/50 select-none"
                        onClick={function () {
                          toggleSection(table);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={!isCollapsed}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleSection(table);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs inline-flex items-center text-zinc-500">
                            {isCollapsed ? (
                              <ChevronRight aria-hidden="true" className="w-3 h-3" />
                            ) : (
                              <ChevronDown aria-hidden="true" className="w-3 h-3" />
                            )}
                          </span>
                          <span className="text-sm inline-flex items-center">
                            {renderTableIcon(sectionIcon)}
                          </span>
                          <span className="text-xs font-medium text-zinc-200">{sectionLabel}</span>
                          <span className="text-xs text-zinc-500">
                            ({rows.length} {t('launch.common.recordUnit')})
                          </span>
                        </div>
                        {!isCollapsed && !isPersistentTable(table) && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                            onClick={function (e) {
                              e.stopPropagation();
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
                        )}
                      </div>
                      {!isCollapsed && (
                        <div className="px-3 pb-3 space-y-2">
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
                          {isPersistentTable(table) ? (
                            <PersistentGroupEditor
                              rows={rows}
                              fields={fields}
                              sectionLabel={sectionLabel}
                              dynamicGroups={dynamicGroups}
                              dynamicFieldTypes={dynamicFieldTypes}
                              getKeyLabel={getKeyLabel}
                              template={template}
                              collapsedGroups={collapsedGroups}
                              toggleGroup={toggleGroup}
                              foundSourcePath={foundSourcePath}
                              table={table}
                              setContextMenu={setContextMenu}
                              setPersistentEdit={setPersistentEdit}
                              setEditModal={setEditModal}
                              requestDelete={requestDelete}
                              onRepairLegacyRows={repairing ? undefined : handleRepairLegacyRows}
                            />
                          ) : (
                            rows.map(function (row, ri) {
                              const title = getTitleField(row);
                              return (
                                <div
                                  key={String(row.rowid ?? 'nr-' + ri)}
                                  className="bg-zinc-800/20 border border-zinc-800/50 rounded p-2.5 hover:bg-zinc-800/40 group"
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
                                  <div className="flex items-start justify-between mb-1">
                                    <div className="text-xs text-zinc-200 font-medium truncate flex-1">
                                      {title && <span className="mr-1">{title}</span>}
                                      <span className="text-zinc-500 font-normal">
                                        #{String(row.rowid)}
                                      </span>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={function () {
                                          setEditModal({
                                            open: true,
                                            title: t('launch.common.edit') + sectionLabel,
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
                                      <Button
                                        variant="danger"
                                        size="sm"
                                        className="text-xs px-1.5 py-0.5 rounded bg-red-800/40 text-red-400 hover:bg-red-800/60"
                                        onClick={function () {
                                          requestDelete(
                                            foundSourcePath || '',
                                            table,
                                            row.rowid as number,
                                          );
                                        }}
                                      >
                                        {t('launch.common.delete')}
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                    {Object.entries(row)
                                      .filter(function (kv) {
                                        return kv[0] !== 'rowid';
                                      })
                                      .map(function (kv) {
                                        const col = kv[0];
                                        const val = kv[1];
                                        if (
                                          title !== null &&
                                          (col === 'name' ||
                                            col === 'item_name' ||
                                            col === 'skill_name' ||
                                            col === 'pet_name' ||
                                            col === 'title') &&
                                          String(val) === title
                                        )
                                          return null;
                                        return (
                                          <span key={col} className="text-xs text-zinc-400">
                                            {getFieldLabel(table, col, schema)}:
                                            <span
                                              className="text-zinc-300 ml-0.5"
                                              title={
                                                getFieldDesc(table, col, schema)
                                                  ? getFieldLabel(table, col, schema) +
                                                    ' \u2014 ' +
                                                    (getFieldDesc(table, col, schema) || '')
                                                  : undefined
                                              }
                                            >
                                              {formatValue(val, col)}
                                            </span>
                                          </span>
                                        );
                                      })}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
          {contextMenu && (
            <div
              className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 text-xs"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              role="menu"
            >
              <div
                className="px-3 py-1.5 text-zinc-300 cursor-pointer hover:bg-zinc-700"
                role="menuitem"
                tabIndex={0}
                onClick={function () {
                  const text = Object.entries(contextMenu.row)
                    .filter(function (kv) {
                      return kv[0] !== 'rowid';
                    })
                    .map(function (kv) {
                      return kv[0] + ': ' + formatValue(kv[1]);
                    })
                    .join('\n');
                  copyToClipboard(text);
                }}
                onKeyDown={function (e) {
                  if (e.key === 'Enter') {
                    const text = Object.entries(contextMenu.row)
                      .filter(function (kv) {
                        return kv[0] !== 'rowid';
                      })
                      .map(function (kv) {
                        return kv[0] + ': ' + formatValue(kv[1]);
                      })
                      .join('\n');
                    copyToClipboard(text);
                  }
                }}
              >
                {t('data.browser.copyRow')}
              </div>
            </div>
          )}
          <RecordEditModal
            open={editModal.open}
            onClose={function () {
              setEditModal(function (prev) {
                return Object.assign({}, prev, { open: false });
              });
            }}
            title={editModal.title}
            fields={editModal.fields}
            initialValues={editModal.initialValues}
            mode={editModal.mode}
            projectPath={projectPath}
            onSave={handleEditSave}
          />

          {/* UID 编辑弹窗 */}
          <UidEditDialog
            open={!!uidEditTarget}
            uidEditTarget={uidEditTarget}
            uidEditValue={uidEditValue}
            uidEditError={uidEditError}
            uidEditSaving={uidEditSaving}
            onClose={() => setUidEditTarget(null)}
            onValueChange={setUidEditValue}
            onSave={saveUidEdit}
          />

          {/* _persistent 智能编辑弹窗 */}
          <PersistentEditDialog
            persistentEdit={persistentEdit}
            persistentEditValue={persistentEditValue}
            persistentEditSaving={persistentEditSaving}
            dynamicFieldEnums={dynamicFieldEnums}
            onClose={function () {
              setPersistentEdit(function (prev) {
                return Object.assign({}, prev, { open: false });
              });
            }}
            onValueChange={setPersistentEditValue}
            onSave={handlePersistentEditSave}
          />
        </div>

        {/* 删除玩家确认弹窗（不可逆：会删掉该玩家所有存档） */}
        <ConfirmDialog
          open={confirmDeletePlayer !== null}
          onClose={() => setConfirmDeletePlayer(null)}
          onConfirm={confirmDeletePlayerExec}
          title={t('data.browser.deletePlayerConfirmTitle')}
          message={t('data.browser.deletePlayerConfirmBody', {
            uid: confirmDeletePlayer?.uid ?? '',
          })}
          confirmText={
            deletingPlayer ? t('launch.common.deleting') : t('launch.common.confirmDelete')
          }
          variant="danger"
          warning
        />

        {/* 合并玩家：把源玩家并入目标（存档 + 身份映射一起；机器人运行时后端会拒绝） */}
        <ConfirmDialog
          open={mergeFrom !== null}
          onClose={() => setMergeFrom(null)}
          onConfirm={confirmMergeExec}
          title={t('data.browser.mergeTitle')}
          confirmText={merging ? t('launch.common.deleting') : t('launch.common.confirmDelete')}
          variant="danger"
          warning
        >
          <div className="space-y-2">
            <div className="text-xs text-zinc-300">
              {t('data.browser.mergeBody', { from: mergeFrom?.uid ?? '' })}
            </div>
            <select
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              aria-label={t('data.browser.mergePickTarget')}
            >
              <option value="">{t('data.browser.mergePickTarget')}</option>
              {players
                .filter((p) => p.uid !== mergeFrom?.uid)
                .map((p) => (
                  <option key={p.uid} value={p.uid}>
                    UID {p.uid}（{p.recordCount} {t('launch.common.recordUnit')}）
                  </option>
                ))}
            </select>
            <div className="text-[10px] text-zinc-500">{t('data.browser.mergeNeedStop')}</div>
          </div>
        </ConfirmDialog>

        {/* 单行删除确认弹窗 */}
        <ConfirmDialog
          open={confirmDeleteRow !== null}
          onClose={() => setConfirmDeleteRow(null)}
          onConfirm={confirmDeleteRowExec}
          title={t('launch.common.confirmDelete')}
          message={t('launch.common.confirmDeleteRecord')}
          confirmText={t('launch.common.confirmDelete')}
          variant="danger"
          warning
        />

        {/* Toast 通知由全局 ToastProvider 提供 */}
      </div>
    </div>
  );
});
