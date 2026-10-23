// 从 BlockEditor.tsx 拆分而来（P0 批次 7）
// BlockEditor 的 UI 状态管理自定义 hook
// 包含所有 useState 和仅操作 UI 状态的 useCallback
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFlowStore } from '../../stores/flowStore';
import { searchNodes } from '../../lib/nodeSearch';
import { focusNode } from '../../lib/reactFlowBridge';
import type { FlowNode } from '@shared/types/flow';

export interface BlockEditorUIState {
  // 抽屉
  drawerNodeId: string | null;
  setDrawerNodeId: (id: string | null) => void;

  // 新建链菜单
  showNewChainMenu: boolean;
  setShowNewChainMenu: (v: boolean | ((prev: boolean) => boolean)) => void;

  // 测试对话框
  showTestDialog: boolean;
  setShowTestDialog: (v: boolean) => void;

  // 教学弹窗
  showTutorial: boolean;
  setShowTutorial: (v: boolean) => void;

  // 模板市场

  // 片段库
  showTemplateLib: boolean;
  setShowTemplateLib: (v: boolean) => void;

  // 大纲面板
  showOutline: boolean;
  setShowOutline: (v: boolean | ((prev: boolean) => boolean)) => void;

  // 指令清单面板（只读目录，与大纲共用右侧位置）
  showCommandList: boolean;
  setShowCommandList: (v: boolean | ((prev: boolean) => boolean)) => void;

  // 查表指令向导
  showConfigQueryWizard: boolean;
  setShowConfigQueryWizard: (v: boolean) => void;

  // 生成代码预检
  pendingGenerate: number | null;
  setPendingGenerate: (v: number | null) => void;

  // 删除系统确认
  deleteSystemTarget: { id: string; name: string } | null;
  setDeleteSystemTarget: (v: { id: string; name: string } | null) => void;

  // 删除整条链确认
  deleteChainTarget: FlowNode[] | null;
  setDeleteChainTarget: (v: FlowNode[] | null) => void;

  // 数据来源预览悬停高亮
  highlightedNodeId: string | null;
  setHighlightedNodeId: (v: string | null) => void;

  // 输出端口悬停高亮
  highlightedTargetIds: string[] | null;
  setHighlightedTargetIds: (v: string[] | null) => void;

  // 右键菜单
  contextMenu: { x: number; y: number; nodeId: string } | null;
  setContextMenu: (v: { x: number; y: number; nodeId: string } | null) => void;

  // 画布空白右键菜单
  paneContextMenu: { x: number; y: number; flowX: number; flowY: number } | null;
  setPaneContextMenu: (v: { x: number; y: number; flowX: number; flowY: number } | null) => void;

  // 创建分组弹窗
  groupDialog: { nodeIds: string[] } | null;
  setGroupDialog: (v: { nodeIds: string[] } | null) => void;

  // 重命名分组弹窗
  renameDialog: { groupId: string; title: string } | null;
  setRenameDialog: (v: { groupId: string; title: string } | null) => void;

  // 折叠成子流程弹窗
  subflowDialog: { nodeIds: string[] } | null;
  setSubflowDialog: (v: { nodeIds: string[] } | null) => void;

  // 错误修复跳转高亮字段
  highlightField: string | null;
  setHighlightField: (v: string | null) => void;

  // 画布搜索
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  matchIndex: number;
  setMatchIndex: (v: number) => void;
  searchMatches: string[];
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;

  // 快捷键帮助
  showShortcuts: boolean;
  setShowShortcuts: (v: boolean) => void;

  // 右键创建位置的待创建位置 ref
  pendingCreatePosRef: React.MutableRefObject<{ x: number; y: number } | null>;
}

/**
 * BlockEditor UI 状态管理 hook
 * 提取所有 UI overlay 状态（对话框、菜单、搜索等）
 */
export function useBlockEditorState(nodes: FlowNode[]): BlockEditorUIState {
  const selectNode = useFlowStore((s) => s.selectNode);

  // 抽屉
  const [drawerNodeId, setDrawerNodeId] = useState<string | null>(null);

  // 新建链菜单
  const [showNewChainMenu, setShowNewChainMenu] = useState(false);

  // 测试对话框
  const [showTestDialog, setShowTestDialog] = useState(false);

  // 教学弹窗
  const [showTutorial, setShowTutorial] = useState(false);

  // 模板市场

  // 片段库
  const [showTemplateLib, setShowTemplateLib] = useState(false);

  // 大纲面板
  const [showOutline, setShowOutline] = useState(false);

  // 指令清单面板
  const [showCommandList, setShowCommandList] = useState(false);

  // 查表指令向导
  const [showConfigQueryWizard, setShowConfigQueryWizard] = useState(false);

  // 生成代码预检
  const [pendingGenerate, setPendingGenerate] = useState<number | null>(null);

  // 删除系统确认
  const [deleteSystemTarget, setDeleteSystemTarget] = useState<{ id: string; name: string } | null>(
    null,
  );

  // 删除整条链确认
  const [deleteChainTarget, setDeleteChainTarget] = useState<FlowNode[] | null>(null);

  // 数据来源预览悬停高亮
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  // 输出端口悬停高亮
  const [highlightedTargetIds, setHighlightedTargetIds] = useState<string[] | null>(null);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(
    null,
  );

  // 画布空白右键菜单
  const [paneContextMenu, setPaneContextMenu] = useState<{
    x: number;
    y: number;
    flowX: number;
    flowY: number;
  } | null>(null);

  // 创建分组弹窗
  const [groupDialog, setGroupDialog] = useState<{ nodeIds: string[] } | null>(null);

  // 重命名分组弹窗
  const [renameDialog, setRenameDialog] = useState<{ groupId: string; title: string } | null>(null);

  // 折叠成子流程弹窗
  const [subflowDialog, setSubflowDialog] = useState<{ nodeIds: string[] } | null>(null);

  // 错误修复跳转高亮字段
  const [highlightField, setHighlightField] = useState<string | null>(null);

  // 画布搜索
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);

  // 快捷键帮助
  const [showShortcuts, setShowShortcuts] = useState(false);

  // 右键创建位置 ref
  const pendingCreatePosRef = useRef<{ x: number; y: number } | null>(null);

  // Ctrl+F 打开搜索框，Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // ? 键（Shift+/）打开快捷键帮助面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
          return;
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 搜索匹配节点列表
  const searchMatches = useMemo(() => searchNodes(searchQuery, nodes), [searchQuery, nodes]);

  // 搜索框变化时重置匹配索引
  useEffect(() => {
    setMatchIndex(0);
  }, [searchQuery]);

  // 搜索高亮：搜索框打开且有查询时高亮匹配节点
  useEffect(() => {
    if (searchOpen && searchQuery.trim()) {
      useFlowStore.getState().setSearchHighlights(searchMatches);
    } else {
      useFlowStore.getState().setSearchHighlights([]);
    }
  }, [searchOpen, searchQuery, searchMatches]);

  // 搜索框键盘事件：Enter 下一个，Shift+Enter 上一个
  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && searchMatches.length > 0) {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        const next = (matchIndex + dir + searchMatches.length) % searchMatches.length;
        setMatchIndex(next);
        const nodeId = searchMatches[next];
        selectNode(nodeId);
        focusNode(nodeId);
      }
    },
    [searchMatches, matchIndex, selectNode],
  );

  return {
    drawerNodeId,
    setDrawerNodeId,
    showNewChainMenu,
    setShowNewChainMenu,
    showTestDialog,
    setShowTestDialog,
    showTutorial,
    setShowTutorial,
    showTemplateLib,
    setShowTemplateLib,
    showOutline,
    setShowOutline,
    showCommandList,
    setShowCommandList,
    showConfigQueryWizard,
    setShowConfigQueryWizard,
    pendingGenerate,
    setPendingGenerate,
    deleteSystemTarget,
    setDeleteSystemTarget,
    deleteChainTarget,
    setDeleteChainTarget,
    highlightedNodeId,
    setHighlightedNodeId,
    highlightedTargetIds,
    setHighlightedTargetIds,
    contextMenu,
    setContextMenu,
    paneContextMenu,
    setPaneContextMenu,
    groupDialog,
    setGroupDialog,
    renameDialog,
    setRenameDialog,
    subflowDialog,
    setSubflowDialog,
    highlightField,
    setHighlightField,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    matchIndex,
    setMatchIndex,
    searchMatches,
    onSearchKeyDown,
    showShortcuts,
    setShowShortcuts,
    pendingCreatePosRef,
  };
}
