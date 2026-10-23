// src/renderer/src/components/editor/FileExplorer.tsx
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Lock } from 'lucide-react';
import { isAppManagedReadOnly } from './readOnlyPaths';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean; // 子目录是否已加载
}

interface FileExplorerProps {
  /** 项目根路径 */
  projectPath: string;
  /** 点击文件回调 */
  onOpenFile: (relativePath: string) => void;
  /** 当前打开的文件路径列表（用于高亮） */
  openFilePaths?: string[];
  /** 附加类名 */
  className?: string;
}

/** 文件图标颜色映射（按扩展名） */
function getFileIcon(name: string): { color: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    py: 'text-blue-400',
    json: 'text-yellow-400',
    env: 'text-green-400',
    toml: 'text-orange-400',
    yml: 'text-orange-400',
    yaml: 'text-orange-400',
    md: 'text-zinc-400',
    txt: 'text-zinc-400',
    ts: 'text-blue-300',
    tsx: 'text-blue-300',
    js: 'text-yellow-300',
    css: 'text-pink-400',
    html: 'text-orange-300',
  };
  return { color: map[ext] ?? 'text-zinc-500' };
}

/** 排除的目录名（不显示） */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  'dist',
  '.next',
]);

/** 排除的文件名 */
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);

/** 文件资源管理器：递归树形展示项目文件 */
export function FileExplorer({
  projectPath,
  onOpenFile,
  openFilePaths = [],
  className = '',
}: FileExplorerProps) {
  useLocaleSubscription();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // 加载指定目录的子项
  const loadDirectory = useCallback(
    async (projPath: string, relDir: string): Promise<FileNode[]> => {
      const res = await window.qqbat.file.list(projPath, relDir || undefined);
      if (!res.ok || !res.data) return [];
      const items = res.data as {
        name: string;
        path: string;
        isDirectory: boolean;
        size: number;
      }[];
      return items
        .filter((item) => {
          if (item.isDirectory && IGNORED_DIRS.has(item.name)) return false;
          if (!item.isDirectory && IGNORED_FILES.has(item.name)) return false;
          return true;
        })
        .map((item) => ({
          name: item.name,
          path: item.path,
          isDirectory: item.isDirectory,
          size: item.size,
          children: item.isDirectory ? [] : undefined,
          loaded: !item.isDirectory,
        }));
    },
    [],
  );

  // 加载根目录
  useEffect(() => {
    if (!projectPath) return;
    // 取消标志：快速切换项目时丢弃上一个 Promise 的结果，避免把旧项目树写入新项目
    let cancelled = false;
    setLoading(true);
    loadDirectory(projectPath, '')
      .then((children) => {
        if (cancelled) return;
        setTree(children);
        // 默认展开 src 目录
        const srcDir = children.find((c) => c.name === 'src' && c.isDirectory);
        if (srcDir) {
          setExpanded(new Set(['src']));
          loadDirectory(projectPath, 'src').then((srcChildren) => {
            if (cancelled) return;
            setTree((prev) =>
              prev.map((n) =>
                n.path === 'src' ? { ...n, children: srcChildren, loaded: true } : n,
              ),
            );
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, loadDirectory]);

  // 切换目录展开/收起
  const toggleDir = useCallback(
    async (node: FileNode) => {
      const newExpanded = new Set(expanded);
      if (newExpanded.has(node.path)) {
        newExpanded.delete(node.path);
        setExpanded(newExpanded);
      } else {
        newExpanded.add(node.path);
        setExpanded(newExpanded);
        // 懒加载子目录
        if (node.isDirectory && !node.loaded) {
          const children = await loadDirectory(projectPath, node.path);
          const updateTree = (nodes: FileNode[]): FileNode[] =>
            nodes.map((n) =>
              n.path === node.path
                ? { ...n, children, loaded: true }
                : n.children
                  ? { ...n, children: updateTree(n.children) }
                  : n,
            );
          setTree((prev) => updateTree(prev));
        }
      }
    },
    [expanded, projectPath, loadDirectory],
  );

  // 递归刷新某目录（空字符串表示刷新根目录）
  const refreshDir = useCallback(
    async (relDir: string) => {
      const children = await loadDirectory(projectPath, relDir);
      if (relDir === '' || relDir === undefined) {
        // 刷新根目录：直接替换整棵树
        setTree(children);
      } else {
        const updateTree = (nodes: FileNode[]): FileNode[] =>
          nodes.map((n) => {
            if (n.path === relDir) return { ...n, children, loaded: true };
            if (n.children) return { ...n, children: updateTree(n.children) };
            return n;
          });
        setTree((prev) => updateTree(prev));
      }
    },
    [projectPath, loadDirectory],
  );

  // 渲染树节点
  const renderNode = (node: FileNode, depth: number) => {
    const isExpanded = expanded.has(node.path);
    const isOpen = openFilePaths.includes(node.path);
    const iconInfo = node.isDirectory
      ? { Icon: isExpanded ? FolderOpen : Folder, color: 'text-yellow-400' }
      : { Icon: File, color: getFileIcon(node.name).color };
    // 应用管理的文件是只读的 —— **在树上就标出来**，避免"点开才发现改不了"（2026-10-02 用户反馈）
    const locked = !node.isDirectory && isAppManagedReadOnly(node.path);

    return (
      <div key={node.path}>
        <div
          role="treeitem"
          tabIndex={0}
          aria-label={node.name}
          aria-expanded={node.isDirectory ? isExpanded : undefined}
          className={`flex items-center gap-1 py-0.5 pr-2 cursor-pointer text-xs select-none hover:bg-zinc-800/60 ${
            isOpen ? 'bg-zinc-800/40 text-zinc-100' : 'text-zinc-400'
          }`}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          onClick={() => {
            if (node.isDirectory) {
              toggleDir(node);
            } else {
              onOpenFile(node.path);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (node.isDirectory) toggleDir(node);
              else onOpenFile(node.path);
            }
          }}
          title={locked ? `${node.path}\n${t('editor.explorer.readOnlyTitle')}` : node.path}
        >
          {/* 展开箭头 */}
          {node.isDirectory ? (
            isExpanded ? (
              <ChevronDown aria-hidden="true" className="w-3 h-3 shrink-0 text-zinc-500" />
            ) : (
              <ChevronRight aria-hidden="true" className="w-3 h-3 shrink-0 text-zinc-500" />
            )
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <iconInfo.Icon className={`w-3.5 h-3.5 shrink-0 ${iconInfo.color}`} />
          <span className="truncate">{node.name}</span>
          {locked && (
            <Lock
              aria-label={t('editor.explorer.readOnlyTitle')}
              className="w-3 h-3 shrink-0 text-amber-500/70 ml-auto"
            />
          )}
        </div>
        {/* 子节点 */}
        {node.isDirectory && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className={`h-full flex flex-col bg-zinc-950 border-r border-zinc-800 ${className}`}>
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-800 shrink-0">
        <span className="text-xs text-zinc-500 font-medium">{t('editor.explorer.title')}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshDir('')}
          title={t('editor.action.refresh')}
        >
          ⟳
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {loading ? (
          <div className="px-3 py-2 text-xs text-zinc-500">{t('editor.action.loading')}</div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-500">{t('editor.explorer.emptyProject')}</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}
