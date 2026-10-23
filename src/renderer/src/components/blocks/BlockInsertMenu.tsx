// src/renderer/src/components/blocks\BlockInsertMenu.tsx
import { useState, useMemo, useEffect } from 'react';
import { Star, History } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  getAllSpecs,
  groupByGroup,
  findSpec,
  getGroupDisplayName,
} from '../../lib/node/nodeCatalog';
import { useI18nStore } from '../../stores/i18nStore';
import { getNodeIcon } from './iconMap';
import type { NodeSpec } from '@shared/types/flow';
import { t } from '../../i18n';
import {
  loadRecentKinds,
  recordNodeUsage,
  loadFavoriteKinds,
  toggleFavoriteKind,
} from '../../lib/infra/recentStore';

interface BlockInsertMenuProps {
  onPick: (kind: string) => void;
  onClose: () => void;
  /** 是否只显示触发器（添加新链时用） */
  triggersOnly?: boolean;
}

export function BlockInsertMenu({ onPick, onClose, triggersOnly = false }: BlockInsertMenuProps) {
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  // 挂载时读取 localStorage
  useEffect(() => {
    setRecent(loadRecentKinds());
    setFavorites(loadFavoriteKinds());
  }, []);

  // 订阅 locale：节点名/描述来自目录，切语言必须重取
  const locale = useI18nStore((s) => s.locale);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getAllSpecs() 内部按当前语言取目录，locale 是它的隐含依赖，eslint 看不出来
  const allSpecs = useMemo(() => getAllSpecs(), [locale]);
  const filtered = useMemo(() => {
    let specs = triggersOnly
      ? allSpecs.filter((s) => s.type === 'trigger')
      : allSpecs.filter((s) => s.type !== 'trigger');
    const q = search.trim().toLowerCase();
    if (q) {
      specs = specs.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.kind.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      );
    }
    return specs;
  }, [allSpecs, search, triggersOnly]);

  const grouped = useMemo(() => groupByGroup(filtered), [filtered]);

  const toggleFavorite = (kind: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => toggleFavoriteKind(kind, prev));
  };

  const handlePick = (kind: string) => {
    recordNodeUsage(kind);
    onPick(kind);
  };

  /** 渲染单个节点项（外层 div 承担添加，内嵌独立收藏按钮——避免 button 嵌套 button 的无效 HTML） */
  const renderSpecButton = (spec: NodeSpec) => {
    const SpecIcon = getNodeIcon(spec.kind);
    const isFav = favorites.includes(spec.kind);
    return (
      <div
        key={spec.kind}
        role="button"
        tabIndex={0}
        aria-label={t('blocks.insert.addNodeAria', { name: spec.label })}
        title={spec.description}
        className="w-full text-left flex items-center gap-2 group hover:bg-blue-600/30 py-1.5 text-zinc-200 justify-start rounded px-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        onClick={() => handlePick(spec.kind)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handlePick(spec.kind);
          }
        }}
      >
        <SpecIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="truncate">{spec.label}</span>
        {/* P0-2: 组装节点标记 */}
        {spec.tags?.includes('composite') && (
          <span
            className="shrink-0 px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 border border-violet-700/40"
            title={t('palette.composedTitle')}
          >
            {t('palette.composed')}
          </span>
        )}
        {/* 收藏按钮（独立 button，stopPropagation 防止误触发添加） */}
        <button
          type="button"
          aria-label={isFav ? t('blocks.insert.unfavorite') : t('blocks.insert.favorite')}
          title={isFav ? t('blocks.insert.unfavorite') : t('blocks.insert.favorite')}
          className={`ml-auto shrink-0 w-5 h-5 flex items-center justify-center rounded cursor-pointer transition-opacity focus:outline-none ${
            isFav
              ? 'text-amber-400 opacity-100'
              : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-amber-400'
          }`}
          onClick={(e) => toggleFavorite(spec.kind, e)}
        >
          <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  /** 渲染收藏/最近分组（仅在有数据时显示） */
  const renderPinnedGroup = (
    title: string,
    kinds: string[],
    GroupIcon: LucideIcon,
    iconClass = '',
  ) => {
    if (kinds.length === 0) return null;
    const specs = kinds
      .map((k) => findSpec(k))
      .filter((s): s is NodeSpec => !!s)
      // 应用 triggersOnly 过滤
      .filter((s) => (triggersOnly ? s.type === 'trigger' : s.type !== 'trigger'));
    if (specs.length === 0) return null;
    return (
      <div className="mb-1">
        <div className="text-xs text-zinc-500 px-2 py-0.5 flex items-center gap-1">
          <GroupIcon className={`w-3 h-3 ${iconClass}`} />
          <span>{title}</span>
        </div>
        {specs.map(renderSpecButton)}
      </div>
    );
  };

  const hasSearch = search.trim().length > 0;

  return (
    <div className="bg-zinc-800/95 border border-zinc-700 rounded-md mx-2 my-1 p-2 max-h-64 overflow-auto shadow-lg">
      <input
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 mb-2 focus:outline-none focus:border-blue-500"
        placeholder={t('palette.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {/* 收藏与最近使用：仅在无搜索词时显示在顶部 */}
      {!hasSearch &&
        renderPinnedGroup(t('blocks.insert.favorite'), favorites, Star, 'text-amber-400')}
      {!hasSearch && renderPinnedGroup(t('palette.recent'), recent, History)}
      {/* 分隔线 */}
      {!hasSearch && (favorites.length > 0 || recent.length > 0) && (
        <div className="border-t border-zinc-700 my-1" />
      )}
      {Object.entries(grouped).map(([group, specs]) => (
        <div key={group} className="mb-1">
          <div className="text-xs text-zinc-500 px-2 py-0.5">{getGroupDisplayName(group)}</div>
          {specs.map(renderSpecButton)}
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-left hover:bg-zinc-700/50 py-1.5 mt-1 text-zinc-500 justify-start"
        onClick={onClose}
      >
        {t('editor.action.cancel')}
      </Button>
    </div>
  );
}
