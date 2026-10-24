import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { NodeSpec } from '@shared/types/flow';
import {
  groupByGroup,
  getGroupDisplayName,
  setCustomNodes,
  setPluginNodes,
  setAiGeneratedNodes,
} from '../../lib/node/nodeCatalog';
import { createNode, createEdge } from '../../lib/canvas/nodeFactory';
import { NODE_WIDTH } from '../../lib/canvas/canvasConstants';
import { useFlowStore } from '../../stores/flowStore';
import { useI18nStore } from '../../stores/i18nStore';
import { t } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import {
  getExecutionChains,
  getControlOutputs,
  getControlInput,
} from '../../lib/canvas/executionOrder';
import { getNodeIcon } from '../blocks/iconMap';
import { recordNodeUsage, loadRecentKinds } from '../../lib/infra/recentStore';
import { matchesNodePaletteQuery } from '../../lib/node/paletteSearch';
import { findSpec } from '../../lib/node/nodeCatalog';
import {
  ChevronDown,
  Package,
  Sparkles,
  X,
  Zap,
  MessageSquare,
  Send,
  Brain,
  Database,
  Sigma,
  GitBranch,
  Type as TypeIcon,
  Users,
  Workflow,
  Box,
  History,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { Button } from '../ui/Button';
import { inputForm } from '../ui/inputStyles';
import { getAllSpecs } from '../../lib/node/nodeCatalog';
import { specVisibleForBotType } from '@shared/domain/project/botTypeConfig';
import { STORAGE_KEYS } from '../../lib/infra/storageKeys';

/** 分组折叠状态持久化 key */
const COLLAPSE_KEY = STORAGE_KEYS.paletteCollapsed;

/** 类型筛选 Tabs（与节点 type 字段对应）。labelKey 是 i18n 键，渲染时按当前语言取 */
const TYPE_TABS = [
  { id: 'all', labelKey: 'palette.typeAll' },
  { id: 'trigger', labelKey: 'palette.typeTrigger' },
  { id: 'action', labelKey: 'palette.typeAction' },
  { id: 'logic', labelKey: 'palette.typeLogic' },
  { id: 'data', labelKey: 'palette.typeData' },
  { id: 'ai', labelKey: 'palette.typeAi' },
  { id: 'custom', labelKey: 'palette.typeCustom' },
] as const;

/** 分组名 → 图标映射（视觉上快速识别分组） */
const GROUP_ICONS: Record<string, LucideIcon> = {
  触发器: Zap,
  消息: MessageSquare,
  动作: Send,
  AI: Brain,
  存储: Database,
  数据: Database,
  计算: Sigma,
  判断: GitBranch,
  文本: TypeIcon,
  上下文: Users,
  控制流: Workflow,
  自定义: Package,
  'AI 生成': Sparkles,
};

/** 搜索词高亮：所有命中处包 <mark>（大小写不敏感） */
function highlightText(text: string, q: string) {
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="bg-blue-500/30 text-blue-200 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function NodePalette() {
  // 折叠状态从 localStorage 恢复（重启/切换项目不丢失）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (!raw) return {};
      // 形状校验：存储值损坏（如曾被写入 "null"/数字）时回退空对象，避免 collapsed[group] 访问崩溃
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, boolean>)
        : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {
      /* localStorage 不可用时静默失败 */
    }
  }, [collapsed]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | NodeSpec['type']>('all');
  // 最近使用节点 kind（点击/拖放添加后刷新，与插入菜单共享数据源）
  const [recent, setRecent] = useState<string[]>(() => loadRecentKinds());
  const [loading, setLoading] = useState(false);
  // 自定义节点扫描错误（不阻塞内置节点使用，仅提示用户重试）
  const [scanError, setScanError] = useState<string | null>(null);
  // 插件加载错误（插件系统非必需，但不应静默吞掉）
  const [pluginError, setPluginError] = useState<string | null>(null);
  // 目录版本号：扫描完成后递增，作为 useMemo 显式依赖触发分组重算
  // 原实现用 loading 作为隐式依赖，语义模糊且每次扫描触发 2 次重算（true/false 各一次）
  const [catalogVersion, setCatalogVersion] = useState(0);
  // 当前进行中的扫描目录：resolve 时若已被新扫描/项目切换取代则丢弃结果（防旧项目结果覆盖新项目）
  const scanningRef = useRef<string | null>(null);
  const addNode = useFlowStore((s) => s.addNode);
  const addEdge = useFlowStore((s) => s.addEdge);
  const selectNode = useFlowStore((s) => s.selectNode);
  const currentProject = useProjectStore((s) => s.currentProject);

  /** 清空自定义/插件/AI 节点目录并递增版本（目录清空也是目录变化，必须触发分组重算） */
  const clearCatalog = useCallback(() => {
    setCustomNodes([]);
    setPluginNodes([]);
    setAiGeneratedNodes([]);
    setCatalogVersion((v) => v + 1);
  }, []);

  const doScan = useCallback(async (projectPath: string) => {
    scanningRef.current = projectPath;
    setLoading(true);
    setScanError(null);
    try {
      const result = await window.qqbat.customNode.scan(projectPath);
      // 竞态防护：等待期间可能已切换到新项目/重新扫描，旧结果直接丢弃
      if (scanningRef.current !== projectPath) return;
      if (!result.ok || !result.data) {
        setCustomNodes([]);
        setAiGeneratedNodes([]);
        setCatalogVersion((v) => v + 1);
        // scan 返回 ok=false 时记录错误，让用户知道自定义节点未加载
        if (!result.ok) setScanError(result.error || t('palette.scanFailed'));
        return;
      }

      // 并行扫描 AI 生成节点（plugins/ai-* 插件包），失败不阻塞自定义节点展示
      // 失败**不能静默**：吞掉会让用户以为「本来就没有 AI 生成的节点」（误导）——
      // 与上面自定义节点那条路一致，把错误显示出来。
      const aiResult = await window.qqbat.customNode
        .scanAiGenerated(projectPath)
        .catch((e: unknown) => {
          setScanError(e instanceof Error ? e.message : String(e));
          return null;
        });
      if (scanningRef.current !== projectPath) return;
      if (aiResult?.ok && aiResult.data) {
        const aiSpecs: NodeSpec[] = aiResult.data.map((s) => ({
          kind: s.kind,
          type: 'custom',
          label: s.label,
          // group 是**分组键**（NodeSpec['group'] 是中文常量联合类型），
          // 拿它做逻辑判断、交给 getGroupDisplayName() 显示；不要在这里翻译。
          group: 'AI 生成',
          icon: s.icon || '⚡',
          description: s.description || t('palette.aiNodeDescription', { name: s.label }),
          summary: s.summary,
          sideEffects: s.sideEffects,
          tags: s.tags,
          defaultConfig: s.defaultConfig,
          inputs: s.inputs.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            dataType: p.dataType ?? 'any',
          })),
          outputs: s.outputs.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            dataType: p.dataType ?? 'any',
          })),
        }));
        setAiGeneratedNodes(aiSpecs);
      } else {
        setAiGeneratedNodes([]);
      }

      // 将 ScannedNode[] 转为 NodeSpec[]
      const specs: NodeSpec[] = result.data.map((s) => ({
        kind: `custom_${s.funcName}`,
        type: 'custom',
        label: s.name,
        group: '自定义',
        icon: s.icon || '🔧',
        description: s.description || t('palette.customNodeDescription', { name: s.name }),
        defaultConfig: {},
        inputs: [
          { id: 'in', name: 'in', kind: 'control' },
          ...s.inputs.map((input) => ({
            id: input,
            name: input,
            kind: 'data' as const,
            dataType: 'any' as const,
          })),
        ],
        outputs: [
          { id: 'out', name: 'out', kind: 'control' },
          ...s.outputs.map((output) => ({
            id: output,
            name: output,
            kind: 'data' as const,
            dataType: 'any' as const,
          })),
        ],
      }));
      setCustomNodes(specs);
      // 显式递增版本号，触发 groups useMemo 重算
      setCatalogVersion((v) => v + 1);
    } catch (e) {
      if (scanningRef.current !== projectPath) return;
      console.warn('[NodePalette] 自定义节点加载失败:', e);
      setCustomNodes([]);
      setAiGeneratedNodes([]);
      setCatalogVersion((v) => v + 1);
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      // 仅最新扫描拥有 loading 开关权，旧扫描不得提前关闭 loading
      if (scanningRef.current === projectPath) setLoading(false);
    }
  }, []);

  // 加载插件节点（错误不阻塞，但记录以便提示）
  const loadPlugins = useCallback(async () => {
    setPluginError(null);
    try {
      const result = await window.qqbat.plugin.getAllSpecs();
      if (result.ok && result.data) {
        setPluginNodes(result.data);
      } else if (!result.ok) {
        setPluginError(result.error || t('palette.pluginLoadFailed'));
      }
    } catch (e) {
      // 插件系统非必需，但记录错误以便用户知晓
      console.warn('[NodePalette] 插件节点加载失败:', e);
      setPluginError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 加载自定义节点 + 启动文件监听
  useEffect(() => {
    if (!currentProject) {
      clearCatalog();
      setScanError(null);
      setPluginError(null);
      return;
    }

    // 初始扫描自定义节点
    doScan(currentProject.path);

    // 启动文件监听
    window.qqbat.customNode.watch(currentProject.path).catch((e) => {
      console.warn('[NodePalette] 文件监听启动失败:', e);
    });

    // 加载插件节点
    loadPlugins();

    // 监听文件变化事件
    const cleanup = window.qqbat.customNode.onChanged((data) => {
      if (data.projectPath === currentProject.path) {
        doScan(currentProject.path);
      }
    });

    return () => {
      cleanup();
      // 失效当前扫描（结果返回后丢弃），并停止后端 FSWatcher
      scanningRef.current = null;
      window.qqbat.customNode.unwatch(currentProject.path).catch(() => {
        // unwatch 失败不影响功能，后端窗口关闭时会兜底清理
      });
    };
  }, [currentProject, doScan, loadPlugins, clearCatalog]);

  // 订阅 locale：目录文案按当前语言现取，必须靠它触发重算/重渲染才能切语言即时生效
  const locale = useI18nStore((s) => s.locale);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion 为扫描目录版本号，locale 变化需重新分组取新语言文案
  /**
   * ★ 节点库按【当前项目类型】过滤（2026-10-04）：
   * 例如「QQ 官方机器人」项目只显示带 `QQ` 标签的节点（收发消息 / 群·频道 / 互动 / 上下文…）。
   *
   * ⚠️ 只过滤**节点库**（能"新增"什么），不影响画布上已有的节点 ——
   * 老项目里已经摆着的节点照常显示、照常运行 ✓（这是与"历史事故"的关键区别，见 botTypeConfig.ts）。
   */
  const botType = useProjectStore((s) => s.currentProject?.botType);
  // 通用节点始终可见；只挡**别的平台**的专属节点（见 botTypeConfig 的 PLATFORM_TAGS）
  const allSpecs = useMemo(() => getAllSpecs(), [catalogVersion]);
  const visibleSpecs = useMemo(
    () => allSpecs.filter((s) => specVisibleForBotType(s, botType)),
    [allSpecs, botType],
  );
  const hiddenCount = allSpecs.length - visibleSpecs.length;
  const groups = useMemo(() => groupByGroup(visibleSpecs), [visibleSpecs, locale]); // 扫描完成/切语言/切项目类型后重新分组

  // 搜索时自动展开所有有匹配的分组
  const isSearching = search.trim().length > 0;

  // 过滤：类型 Tab + 搜索词。
  // 搜索走 `matchesNodePaletteQuery`（lib/node/paletteSearch）—— 语料覆盖 label/kind/description/
  // summary/tags/端口名/端口选项。**别退化成只匹配 label/kind/description**：
  // 那样「按钮」「群黑名单」「批量踢出」「输入中状态」这些用户真会打的词全都搜不到，
  // 而那些词指的是**能力**、不是节点名（tests/renderer/lib/node/paletteSearch.test.ts 守着这条）。
  const filteredGroups = useMemo(() => {
    const q = search.trim();
    let entries: [string, NodeSpec[]][] = Object.entries(groups);
    if (typeFilter !== 'all') {
      entries = entries
        .map(([g, specs]): [string, NodeSpec[]] => [g, specs.filter((s) => s.type === typeFilter)])
        .filter(([, specs]) => specs.length > 0);
    }
    if (q) {
      entries = entries
        .map(([g, specs]): [string, NodeSpec[]] => [
          g,
          specs.filter((s) => matchesNodePaletteQuery(s, q)),
        ])
        .filter(([, specs]) => specs.length > 0);
    }
    return Object.fromEntries(entries);
  }, [groups, search, typeFilter]);

  // 最近使用分组：无搜索且全部 Tab 时置顶显示
  const recentSpecs = useMemo(() => {
    if (isSearching || typeFilter !== 'all') return [];
    return recent
      .map((k) => findSpec(k))
      .filter((s): s is NodeSpec => !!s)
      .slice(0, 8);
  }, [recent, isSearching, typeFilter]);

  /** 点击节点：追加到当前选中链末尾，或创建新链（触发器） */
  function handleAdd(kind: string) {
    // 先读旧选中节点，再创建/选中新节点——否则 selectedNodeId 已是新节点自己，
    // 「追加到选中链」永远找不到目标链（原实现因此总是兜底到最后一条链）
    const oldSelectedNodeId = useFlowStore.getState().selectedNodeId;
    // 新节点落位：有选中节点时放到其右侧（避免叠在 (0,0) 上互相遮挡）；
    // 无选中节点时放到已有节点包围盒右下角，首个节点落在原点
    const st = useFlowStore.getState();
    const sel = st.nodes.find((n) => n.id === oldSelectedNodeId);
    const basePos = sel
      ? { x: sel.position.x + NODE_WIDTH + 80, y: sel.position.y }
      : { x: Math.max(0, ...st.nodes.map((n) => n.position.x + NODE_WIDTH)) + 80, y: 0 };
    const node = createNode(kind, basePos);
    recordNodeUsage(kind);
    setRecent(loadRecentKinds());
    addNode(node);
    selectNode(node.id);

    // 触发器不需要连接，直接作为新链
    if (node.type === 'trigger') return;

    // 非触发器：追加到当前链末尾
    const { nodes, edges } = useFlowStore.getState();
    const chains = getExecutionChains(nodes, edges);
    if (chains.length === 0) return;

    // 找旧选中节点所在的链，否则用最后一条链
    let targetChain = chains.find((c) => c.sequence.some((n) => n.id === oldSelectedNodeId));
    if (!targetChain) targetChain = chains[chains.length - 1];

    const lastNode = targetChain.sequence[targetChain.sequence.length - 1];
    // 如果最后一个节点是分支，不自动连接（用户需在积木编辑器中手动指定分支）
    if (lastNode.data.nodeKind === 'branch_if' || lastNode.data.nodeKind === 'loop') return;

    const lastOut = getControlOutputs(lastNode)[0];
    const newIn = getControlInput(node);
    if (lastOut && newIn) {
      addEdge(createEdge(lastNode.id, lastOut.portId, node.id, newIn.portId));
    }
  }

  /** 渲染单个节点项（分组与「最近使用」共用） */
  const renderSpecItem = (spec: NodeSpec) => {
    // 自定义/AI 生成节点用专属图标，其余走 lucide 类型图标映射
    const Icon =
      spec.group === 'AI 生成'
        ? Sparkles
        : spec.group === '自定义'
          ? Package
          : getNodeIcon(spec.kind);
    const q = search.trim().toLowerCase();
    return (
      <div
        key={spec.kind}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/node-kind', spec.kind);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => handleAdd(spec.kind)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleAdd(spec.kind);
          }
        }}
        className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-zinc-300 hover:bg-zinc-800 cursor-grab active:cursor-grabbing hover:border-zinc-600 border border-transparent transition-colors"
        title={spec.description}
        role="button"
        aria-label={t('palette.addNodeAria', { name: spec.label })}
        tabIndex={0}
      >
        <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="truncate">{highlightText(spec.label, q)}</span>
        {/* 右侧标签：组装 / 平台兼容性 */}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {spec.tags?.includes('composite') && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 border border-violet-700/40"
              title={t('palette.composedTitle')}
            >
              {t('palette.composed')}
            </span>
          )}
          {spec.platform === 'qq' && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40"
              title={t('palette.qqOfficialTitle')}
            >
              {t('palette.qqOfficial')}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col node-palette" aria-busy={loading || undefined}>
      {/*
        ★ 平台横幅（2026-10-04）：项目类型只挡**别的平台**的专属节点，通用节点始终在。
        只有"真的挡住了东西"时才显示（当前没有别的平台节点 → 不显示，免得白占地方）。
      */}
      {hiddenCount > 0 && (
        <div className="px-2 py-1.5 border-b border-zinc-800 bg-zinc-900/60 text-[11px] text-zinc-400 shrink-0 leading-tight">
          {t('palette.typeFilterHint', {
            type: t(`launch.botType.${botType ?? 'general'}`),
            count: String(hiddenCount),
          })}
        </div>
      )}

      {/* 搜索框 */}
      <div className="p-2 border-b border-zinc-800 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('palette.searchPlaceholder')}
            className={`w-full ${inputForm} focus:ring-1 focus:ring-blue-500/30 placeholder:text-zinc-600 pr-7`}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('palette.clearSearch')}
              title={t('palette.clearSearch')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* 操作引导：新手第一眼看到"怎么把节点加到画布" */}
        <p className="mt-1 text-[10px] text-zinc-600">{t('palette.addHint')}</p>
      </div>
      {/* 类型筛选 Tabs：快速按节点类型过滤 */}
      <div className="px-2 pb-2 border-b border-zinc-800 flex gap-1 shrink-0 flex-wrap">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTypeFilter(tab.id as typeof typeFilter)}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              typeFilter === tab.id
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
            aria-pressed={typeFilter === tab.id}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      {/* 自定义节点/插件加载错误提示：不阻塞内置节点使用，仅提示重试 */}
      {(scanError || pluginError) && (
        <div className="px-3 py-2 border-b border-zinc-800 bg-amber-900/20 text-xs">
          <div className="text-amber-300 mb-1">
            {scanError
              ? t('palette.customLoadFailed', { msg: scanError })
              : t('palette.pluginNodesLoadFailed', { msg: pluginError ?? '' })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-amber-400 hover:text-amber-200 underline px-0 py-0 justify-start"
            onClick={() => {
              if (scanError && currentProject) doScan(currentProject.path);
              if (pluginError) loadPlugins();
            }}
          >
            {t('palette.retry')}
          </Button>
        </div>
      )}
      {/* 加载中提示 */}
      {loading && (
        <div className="px-3 py-3 border-b border-zinc-800 flex items-center gap-2 text-xs text-zinc-500">
          <Spinner size="sm" />
          <span>{t('palette.scanning')}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {Object.keys(filteredGroups).length === 0 && isSearching && (
          <EmptyState
            title={t('palette.noMatchTitle')}
            description={t('palette.noMatchDesc', { query: search })}
          />
        )}
        {Object.keys(filteredGroups).length === 0 && !isSearching && typeFilter !== 'all' && (
          <EmptyState
            title={t('palette.emptyTypeTitle', {
              type: t(
                TYPE_TABS.find((tab) => tab.id === typeFilter)?.labelKey ?? 'palette.typeAll',
              ),
            })}
            description={t('palette.emptyTypeDesc')}
          />
        )}
        {/* 最近使用置顶分组（与插入菜单共享数据源） */}
        {recentSpecs.length > 0 && (
          <div
            role="region"
            aria-label={t('palette.recentAria')}
            className="border-b border-zinc-800"
          >
            <div className="px-3 py-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-500 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm">
              <History className="w-3.5 h-3.5 shrink-0" />
              {t('palette.recent')}
            </div>
            <div className="px-2 pb-2 space-y-1">{recentSpecs.map(renderSpecItem)}</div>
          </div>
        )}
        {Object.entries(filteredGroups).map(([group, specs]) => {
          const isCollapsed = !isSearching && collapsed[group];
          const GroupIcon = GROUP_ICONS[group] ?? Box;
          return (
            <div
              key={group}
              role="region"
              aria-label={t('palette.groupAria', { name: getGroupDisplayName(group) })}
              className="border-b border-zinc-800"
            >
              <Button
                variant="ghost"
                size="md"
                className="w-full px-3 py-2 flex items-center justify-between font-semibold text-zinc-400 hover:bg-zinc-900 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm"
                onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
                aria-label={t('palette.toggleGroupAria', {
                  action: isCollapsed ? t('palette.expand') : t('palette.collapse'),
                  name: getGroupDisplayName(group),
                })}
                aria-expanded={!isCollapsed}
              >
                <span className="flex items-center gap-1.5">
                  <GroupIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  {getGroupDisplayName(group)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500 font-normal">{specs.length}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                </span>
              </Button>
              {!isCollapsed && (
                <div className="px-2 pb-2 space-y-1">{specs.map(renderSpecItem)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
