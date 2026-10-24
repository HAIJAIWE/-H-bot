import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { getAllSpecs, subscribeCatalog, getCatalogVersion } from '../../lib/node/nodeCatalog';
import { createNode } from '../../lib/canvas/nodeFactory';
import { useFlowStore } from '../../stores/flowStore';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { getNodeIcon } from '../blocks/iconMap';
import { recordNodeUsage } from '../../lib/infra/recentStore';
import { CommandPalette } from '../ui/CommandPalette';
import type { NodeSpec } from '@shared/types/flow';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function NodeSearchDialog() {
  useLocaleSubscription();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const addNode = useFlowStore((s) => s.addNode);

  // 订阅目录版本：自定义/插件节点扫描完成后结果立即可见（原 useMemo([query]) 会缓存空目录）
  const catalogVersion = useSyncExternalStore(subscribeCatalog, getCatalogVersion);

  // 使用 getAllSpecs() 统一数据源（V2 catalog + 自定义 + 插件节点），
  // 不再直接引用已废弃的老 NODE_CATALOG。
  const filtered = useMemo(() => {
    // catalogVersion 仅作失效信号：版本递增时强制重读 getAllSpecs()
    void catalogVersion;
    const all = getAllSpecs();
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (s: NodeSpec) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.group.toLowerCase().includes(q),
    );
  }, [query, catalogVersion]);

  // 全局快捷键：Ctrl+K / Cmd+K 切换
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setOpen((prev) => !prev);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelect = useCallback(
    (kind: string) => {
      // 与 NodePalette/BlockInsertMenu 行为一致：使用即入最近使用列表
      recordNodeUsage(kind);
      const node = createNode(kind, { x: 0, y: 0 });
      addNode(node);
      // 画布式：创建后选中 + 画布平移聚焦到新节点
      useFlowStore.getState().selectNode(node.id);
      focusNode(node.id);
      setOpen(false);
      setQuery('');
    },
    [addNode],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  return (
    <CommandPalette
      open={open}
      onClose={handleClose}
      query={query}
      onQueryChange={setQuery}
      placeholder={t('palette.searchPlaceholder')}
      itemCount={filtered.length}
      onSelect={(i) => handleSelect(filtered[i].kind)}
    >
      {({ selectedIndex, setSelectedIndex }) =>
        filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">
            {t('canvas.search.empty')}
          </div>
        ) : (
          filtered.map((spec: NodeSpec, index: number) => {
            const SpecIcon = getNodeIcon(spec.kind);
            return (
              <div
                key={spec.kind}
                role="option"
                tabIndex={-1}
                aria-selected={index === selectedIndex}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${
                  index === selectedIndex
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
                onClick={() => handleSelect(spec.kind)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <SpecIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{spec.label}</div>
                  <div className="text-xs text-zinc-500 truncate">{spec.group}</div>
                </div>
                {spec.platform === 'qq' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40 shrink-0">
                    {t('palette.qqOfficial')}
                  </span>
                )}
              </div>
            );
          })
        )
      }
    </CommandPalette>
  );
}
