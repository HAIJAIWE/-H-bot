// src/renderer/src/components/blocks/useEditorActions.ts
//
// **交互回调**——从 `BlockEditor` 抽出的第二个 hook（拆分 Step 3b，372 行）。
//
// 这一块是"用户点了什么 → 干什么"：右键菜单、新建指令、生成代码、删除系统、
// 折叠子流程、分组增删改。**13 个产出**全是给 JSX 用的回调 / 菜单项数组。
//
// 21 个输入是**自动分析**出来的：AST 里"区域引用、且在区域之前声明"的名字，再减掉 import
// （import 的由本文件自己引入，见下）。类型优先抄 `useBlockEditorState.ts` 的现成声明。
import { useCallback, useMemo } from 'react';
import { placeNewNodesBelow } from './blockEditorModel';
import { useFlowStore } from '../../stores/flowStore';
import { recordNodeUsage } from '../../lib/infra/recentStore';
import { TemplateLibrary } from './TemplateLibrary';
import { useGitStore } from '../../stores/gitStore';
import { Button } from '../ui/Button';
import { NewChainMenu } from './NewChainMenu';
import { NewCommandWizard } from './NewCommandWizard';
import { normalizeCommand, type CommandWizardInput } from '../../lib/command/commandWizard';
// 铺链的统一入口（向导与智能体同一条路）；实现见 lib/command/insertChain.ts
import { insertCommandChain, insertConfigQueryChain } from '../../lib/command/insertChain';
import { type ConfigQueryInput } from '../../lib/command/configQueryChain';
import { layoutFlow } from '../../lib/canvas/autoLayout';
import { focusNode, fitCanvas } from '../../lib/canvas/reactFlowBridge';
import { isSubflowDefine } from '../../lib/canvas/executionOrder';
import { createNode } from '../../lib/canvas/nodeFactory';
import { FlowNode } from '@shared/types/flow';
import { Plus } from 'lucide-react';
import { ContextMenuItem } from './ContextMenu';
import { t } from '../../i18n';
import { useToast } from '../ui/Toast';
import type { ReactNode } from 'react';

/** 交互回调需要的全部外部量 */
export interface UseEditorActionsOptions {
  contextMenu: { x: number; y: number; nodeId: string } | null;
  deleteSystemTarget: { id: string; name: string } | null;
  drawerNodeId: string | null;
  groupDialog: { nodeIds: string[] } | null;
  loadErrorBanner: ReactNode;
  projectPath: string;
  renameDialog: { groupId: string; title: string } | null;
  setDeleteSystemTarget: (v: { id: string; name: string } | null) => void;
  setDrawerNodeId: (id: string | null) => void;
  setGenHeadVersion: (v: string | null) => void;
  setGenVersionMessage: (v: string) => void;
  setGroupDialog: (v: { nodeIds: string[] } | null) => void;
  setRenameDialog: (v: { groupId: string; title: string } | null) => void;
  setShowCommandWizard: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowConfigQueryWizard: (v: boolean) => void;
  setShowNewChainMenu: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSubflowDialog: (v: { nodeIds: string[] } | null) => void;
  showCommandWizard: boolean;
  showNewChainMenu: boolean;
  subflowDialog: { nodeIds: string[] } | null;
  toast: ReturnType<typeof useToast>;
  setGenVersionName: (v: string) => void;
  setGenDialog: (v: boolean | ((p: boolean) => boolean)) => void;
}

export function useEditorActions(opts: UseEditorActionsOptions) {
  const deleteNodeAndReconnect = useFlowStore((s) => s.deleteNodeAndReconnect);
  const removeSystem = useFlowStore((s) => s.removeSystem);
  const addNode = useFlowStore((s) => s.addNode);
  const toggleNodeGroupCollapse = useFlowStore((s) => s.toggleNodeGroupCollapse);
  const fetchVersions = useGitStore((s) => s.fetchVersions);
  const selectNode = useFlowStore((s) => s.selectNode);
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const isNodeInGroup = useFlowStore((s) => s.isNodeInGroup);
  const removeNodeGroup = useFlowStore((s) => s.removeNodeGroup);
  const clipboard = useFlowStore((s) => s.clipboard);
  const addNodeGroup = useFlowStore((s) => s.addNodeGroup);
  const renameNodeGroup = useFlowStore((s) => s.renameNodeGroup);
  const foldToSubflow = useFlowStore((s) => s.foldToSubflow);
  const setFocusNode = useFlowStore((s) => s.setFocusNode);
  const generateCode = useFlowStore((s) => s.generateCode);
  const {
    contextMenu,
    deleteSystemTarget,
    drawerNodeId,
    groupDialog,
    loadErrorBanner,
    projectPath,
    renameDialog,
    setDeleteSystemTarget,
    setDrawerNodeId,
    setGenHeadVersion,
    setGenVersionMessage,
    setGroupDialog,
    setRenameDialog,
    setShowCommandWizard,
    setShowConfigQueryWizard,
    setShowNewChainMenu,
    setSubflowDialog,
    showCommandWizard,
    showNewChainMenu,
    subflowDialog,
    toast,
    setGenVersionName,
    setGenDialog,
  } = opts;

  // ===== 交互回调（沿用列表式） =====

  const handleCloseDrawer = useCallback(() => {
    setDrawerNodeId(null);
  }, [setDrawerNodeId]);

  /** 删除节点（store 自动重连控制流，单次 pushHistory） */
  const handleDeleteNode = useCallback(
    (node: FlowNode) => {
      deleteNodeAndReconnect(node.id);
      if (drawerNodeId === node.id) setDrawerNodeId(null);
    },
    [deleteNodeAndReconnect, drawerNodeId, setDrawerNodeId],
  );

  /** 删除系统（确认后） */
  const confirmDeleteSystem = useCallback(() => {
    if (!deleteSystemTarget) return;
    removeSystem(deleteSystemTarget.id);
    setDeleteSystemTarget(null);
  }, [deleteSystemTarget, removeSystem, setDeleteSystemTarget]);

  /** 添加新链（触发器） */
  const handleAddChain = (kind: string, systemId?: string) => {
    recordNodeUsage(kind);
    const newNode = createNode(kind, { x: 0, y: 0 });
    addNode(newNode);
    selectNode(newNode.id);
    if (systemId) {
      useFlowStore.getState().addChainToSystem(systemId, newNode.id);
    }
    setShowNewChainMenu(false);
    focusNode(newNode.id);
  };

  /**
   * 「新建指令」向导：把向导输入变成一条**已连好线**的链。
   *
   * 用 `insertTemplate`（store 里唯一支持"批量建节点+边"的入口）铺节点，
   * 再把新节点挪到现有内容下方 —— `updateNodePositions` 不进历史，所以
   * 一次 Ctrl+Z 就能整体撤销，不会出现"撤销三次才回到创建前"。
   */
  const handleCreateCommand = useCallback(
    (input: CommandWizardInput) => {
      // ⚠️ 走共享插入（`insertCommandChain`）：智能体的 `new_command` 工具调的是**同一个函数** ——
      // 否则"界面向导建的链"和"AI 建的链"迟早会分叉（本仓库为这类分裂栽过好几次）
      const ids = insertCommandChain(input);
      placeNewNodesBelow(ids);
      setShowCommandWizard(false);
      toast.success(
        t('blocks.editor.wizard.commandCreated', {
          command: normalizeCommand(input.command),
          count: ids.length,
        }),
      );
    },
    [toast],
  );

  /**
   * 「查表指令」向导：铺出「收到消息 → 取参数 → 回复」，再补上配置绑定边。
   *
   * 配置绑定是**伪源边**（`source === '__config_api__'`），它引用的是"目标节点的真实 ID"，
   * 而真实 ID 只有 `insertTemplate` 返回后才知道 —— 所以只能分两步：
   * 先插入节点，再按 `configApiEdges` 里的**索引**翻译成 ID 建边。
   *
   * 两步之间用 `beginHistoryBatch` 包住：否则"插入节点"和"建绑定边"会各压一次历史，
   * 用户要按两次 Ctrl+Z 才能撤掉一条指令（设计原则：一次操作 = 一次撤销）。
   */
  const handleCreateConfigQuery = useCallback(
    (input: ConfigQueryInput) => {
      // 走共享插入（智能体的 new_lookup 调的是同一个函数）
      const ids = insertConfigQueryChain(input);
      placeNewNodesBelow(ids);
      setShowConfigQueryWizard(false);
      toast.success(
        t('blocks.editor.wizard.lookupCreated', {
          command: normalizeCommand(input.command),
          table: input.table,
          field: input.field,
        }),
      );
    },
    [toast, setShowConfigQueryWizard],
  );

  /** 构造节点右键菜单项 */
  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu) return [];
    const items: ContextMenuItem[] = [];
    const clickedNode = nodes.find((n) => n.id === contextMenu.nodeId);
    // 多选集合 = 主选中节点（selectedNodeId）+ Ctrl 附加集合（selectedNodeIds）
    const multiIds =
      selectedNodeId && !selectedNodeIds.includes(selectedNodeId)
        ? [selectedNodeId, ...selectedNodeIds]
        : selectedNodeIds;
    if (multiIds.length > 1) {
      const hasTrigger = multiIds.some((id: string) => {
        const n = nodes.find((nn) => nn.id === id);
        return n?.type === 'trigger';
      });
      items.push({
        label: t('blocks.editor.createGroup', { count: multiIds.length }),
        onClick: () => setGroupDialog({ nodeIds: [...multiIds] }),
      });
      if (!hasTrigger) {
        items.push({
          label: t('blocks.editor.collapseToSubflow', { count: multiIds.length }),
          onClick: () => setSubflowDialog({ nodeIds: [...multiIds] }),
        });
      }
    }
    if (clickedNode) {
      const grp = isNodeInGroup(clickedNode.id);
      if (grp) {
        items.push({
          label: grp.collapsed ? t('blocks.editor.expandGroup') : t('blocks.editor.collapseGroup'),
          onClick: () => toggleNodeGroupCollapse(grp.id),
        });
        items.push({
          label: t('blocks.editor.renameGroup'),
          onClick: () => setRenameDialog({ groupId: grp.id, title: grp.title }),
        });
        items.push({
          label: t('launch.common.deleteGroup'),
          onClick: () => removeNodeGroup(grp.id),
        });
      }
    }
    // 触发器无删除项；孤儿 subflow_defined（type 也是 'trigger'）应可删（C 修复：原判断
    // 一律按 type==='trigger' 隐藏删除项，导致孤儿子流程定义永远删不掉）
    if (clickedNode && !(clickedNode.type === 'trigger' && !isSubflowDefine(clickedNode))) {
      items.push({
        label: t('drawer.deleteNode'),
        onClick: () => handleDeleteNode(clickedNode),
      });
    }
    return items;
  }, [
    contextMenu,
    nodes,
    selectedNodeId,
    selectedNodeIds,
    isNodeInGroup,
    toggleNodeGroupCollapse,
    removeNodeGroup,
    handleDeleteNode,
    setGroupDialog,
    setSubflowDialog,
    setRenameDialog,
  ]);

  /** 全图布局：有分组走列表式（一条指令一行），否则走 ELK */
  const handleLayoutAll = useCallback(async () => {
    try {
      const st = useFlowStore.getState();
      const positions = await layoutFlow(st.nodes, st.edges, st.nodeGroups);
      st.updateNodePositions(positions);
      fitCanvas();
    } catch (e) {
      console.warn('[BlockEditor] 自动布局失败:', e);
    }
  }, []);

  /** 构造画布空白右键菜单项 */
  const paneContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
      { label: t('blocks.editor.menu.newCommand'), onClick: () => setShowCommandWizard(true) },
      { label: t('blocks.editor.menu.newTrigger'), onClick: () => setShowNewChainMenu(true) },
      {
        label: t('blocks.editor.menu.autoLayout'),
        onClick: () => {
          void handleLayoutAll();
        },
      },
      { label: t('blocks.editor.menu.fitView'), onClick: () => fitCanvas() },
    ];
    if (clipboard) {
      items.push({
        label: t('blocks.editor.menu.paste'),
        onClick: () => {
          const st = useFlowStore.getState();
          const newIds = st.pasteNodes();
          if (newIds.length > 0) {
            st.selectNode(newIds[0]);
            focusNode(newIds[0]);
            st.highlightNodes(newIds);
          }
        },
      });
    }
    return items;
  }, [clipboard, setShowNewChainMenu, handleLayoutAll]);

  /** 确认创建分组 */
  const confirmCreateGroup = useCallback(
    (title: string) => {
      if (!groupDialog) return;
      addNodeGroup(title, groupDialog.nodeIds);
      setGroupDialog(null);
    },
    [groupDialog, addNodeGroup, setGroupDialog],
  );

  /** 确认重命名分组 */
  const confirmRenameGroup = useCallback(
    (title: string) => {
      if (!renameDialog) return;
      renameNodeGroup(renameDialog.groupId, title);
      setRenameDialog(null);
    },
    [renameDialog, renameNodeGroup, setRenameDialog],
  );

  /** 确认折叠成子流程 */
  const confirmFoldToSubflow = useCallback(
    (name: string) => {
      if (!subflowDialog) return;
      const defineId = foldToSubflow(subflowDialog.nodeIds, name);
      setSubflowDialog(null);
      if (defineId) {
        toast.success(t('blocks.editor.subflowCreated', { name }));
        setTimeout(() => setFocusNode(null), 3000);
      } else {
        toast.error(t('blocks.editor.collapseFailed'));
      }
    },
    [subflowDialog, foldToSubflow, setSubflowDialog, toast, setFocusNode],
  );

  /**
   * 「生成代码」—— **先弹命名面板**：版号预填"下一个建议值"、可改；名字可留空；
   * 也可以选择"只生成，不记版本"。
   *
   * 为什么先弹再生成：版本号在生成那一刻就该定下来，生成完再补命名会让
   * "这次生成对应哪个版本"错位；而且用户要的正是"点生成代码 → 命名"这个动作。
   */
  const openGenerateDialog = async () => {
    if (!projectPath) return;
    // 先拿到建议版号与 HEAD 状态（fetchVersions 会更新 store）
    await fetchVersions(projectPath);
    const gs = useGitStore.getState();
    const atHead =
      gs.versionHeadHash === null
        ? undefined
        : gs.versionTags.find((t) => t.hash === gs.versionHeadHash);

    // 面板**总是要弹**（点生成代码就该看到命名面板 —— 这是用户明确要的交互）。
    // "这次不能新建版本"这种情况放在面板**里面**说清楚，而不是让面板消失 ——
    // 面板不出现会让人以为功能坏了（实测就被这么反馈过）。
    setGenHeadVersion(atHead?.name ?? null);
    setGenVersionName(gs.versionNext || 'v1.0');
    setGenVersionMessage('');
    setGenDialog(true);
  };

  /** 真正执行生成。version: 对象=记版本；null=只生成不记版本 */
  const runGenerateCode = async (version: { name?: string; message?: string } | null) => {
    if (!projectPath) return;
    setGenDialog(false);
    const ok = await generateCode(projectPath, false, version);
    if (ok) {
      const st = useFlowStore.getState();
      if (st.lastGeneratedVersionError) {
        // 想记版本却没记上（例如同一个提交上已有版本）：必须说出来，否则又是"什么都没发生"
        toast.error(
          t('blocks.editor.codegenVersionFailed', { error: st.lastGeneratedVersionError }),
        );
      } else if (st.lastGeneratedVersion) {
        toast.success(t('blocks.editor.codegenOkWithVersion', { name: st.lastGeneratedVersion }));
      } else {
        // 没记版本：选了"只生成"或非 git 项目
        toast.success(t('blocks.editor.codegenOk'));
      }
    } else {
      toast.error(t('blocks.editor.codegenFailed'));
    }
  };

  return {
    handleAddChain,
    confirmCreateGroup,
    confirmDeleteSystem,
    confirmFoldToSubflow,
    confirmRenameGroup,
    contextMenuItems,
    handleCloseDrawer,
    handleCreateCommand,
    handleCreateConfigQuery,
    handleDeleteNode,
    handleLayoutAll,
    openGenerateDialog,
    paneContextMenuItems,
    runGenerateCode,
  };
}
