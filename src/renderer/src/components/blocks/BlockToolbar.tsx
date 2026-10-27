// src/renderer/src/components/blocks/BlockToolbar.tsx
//
// 低代码编辑器的**工具栏**（从 `BlockEditor.tsx` 抽出的第一块，拆分 Step 1）。
//
// 为什么先抽它：`BlockEditor` 是 2,151 行 / 改过 80 次的全仓最热文件，而工具栏是它里面
// 唯一一块**几乎不碰画布内部**的纯 JSX（按钮 + 徽标 + 平台过滤）。抽出来之后，
// 以后改按钮不用再动那个巨型组件 ✓
//
// 契约：**逐字节搬过来的**，只加了一层 props 解构 —— 行为必须与抽之前**完全一致**。
// 底线由 `tests/renderer/components/blocks/blockEditorToolbar.test.tsx` 盯着（4 条，一字未改 ✓）。
import { Button } from '@renderer/components/ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { focusNode } from '../../lib/canvas/reactFlowBridge';
import { useFlowStore } from '@renderer/stores/flowStore';
import { FlowIssuesButton } from './FlowIssuesButton';
import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  CornerUpLeft,
  Database,
  GitBranch,
  LayoutTemplate,
  ListChecks,
  ListPlus,
  ListTree,
  Maximize,
  Plus,
  Puzzle,
  Redo2,
  Undo2,
  Wand2,
} from 'lucide-react';
import { platformTagsVisible, projectPlatformFamily } from '@shared/domain/platform/registry';
import { TOOLBAR_PLATFORM_TAGS } from '../../lib/node/platformEntries';
import { t } from '@renderer/i18n';
import { useLocaleSubscription } from '@renderer/stores/i18nStore';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { BotType } from '@shared/domain/project/botTypeConfig';

/** 工具栏需要的全部外部量（从 BlockEditor 的状态/回调里挑出来的） */
export interface BlockToolbarProps {
  botType: BotType | undefined;
  chains: unknown[];
  nodes: unknown[];
  edges: unknown[];
  systems: { id: string; name: string; icon?: ReactNode }[];
  errorNodeIds: Set<string>;
  generating: boolean;
  driftChecked: boolean;
  driftStaleScopes: number;
  driftStaleItems: number;
  redoDepth: number;
  undoDepth: number;
  loadErrorBanner: ReactNode;
  subflowJump: { fromCallId: string; toDefineId: string } | null;
  setSubflowJump: Dispatch<SetStateAction<{ fromCallId: string; toDefineId: string } | null>>;
  showCommandPanel: boolean;
  setShowCommandPanel: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowCommandWizard: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowOutline: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowConfigQueryWizard: (v: boolean) => void;
  setShowTemplateLib: (v: boolean) => void;
  setDeleteSystemTarget: (v: { id: string; name: string } | null) => void;
  fitCanvas: () => void;
  setShowCommandList: (v: boolean | ((prev: boolean) => boolean)) => void;
  showDataEdges: boolean;
  setShowDataEdges: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowFactoryConfig: (v: boolean | ((p: boolean) => boolean)) => void;
  focusNodeId: string | null;
  showOutline: boolean;
  showCommandList: boolean;
  setShowTestDialog: (v: boolean) => void;
  handleLayoutAll: () => void;
  openGenerateDialog: () => void;
  jumpToNextError: () => void;
}

export function BlockToolbar(props: BlockToolbarProps): ReactNode {
  const {
    botType,
    chains,
    nodes,
    edges,
    systems,
    errorNodeIds,
    generating,
    driftChecked,
    driftStaleScopes,
    driftStaleItems,
    redoDepth,
    undoDepth,
    loadErrorBanner,
    subflowJump,
    setSubflowJump,
    showCommandPanel,
    setShowCommandPanel,
    setShowCommandWizard,
    setShowOutline,
    setShowConfigQueryWizard,
    setShowTemplateLib,
    setDeleteSystemTarget,
    fitCanvas,
    setShowCommandList,
    showDataEdges,
    setShowDataEdges,
    setShowFactoryConfig,
    focusNodeId,
    showOutline,
    showCommandList,
    setShowTestDialog,
    handleLayoutAll,
    openGenerateDialog,
    jumpToNextError,
  } = props;

  // 组件用了 t() 就必须订阅语言变化 —— 否则切语言时它不重渲染（i18n 闸门抓着这条）
  useLocaleSubscription();

  return (
    <>
      {/* 工具栏（三级结构：标题/统计 → 左组"改东西" → 右组"看画布 + 落盘"）
          `flex-wrap` + 子项不收缩：工具栏的自然宽度（约 1300px）早就超过了窄窗口的可用宽度，
          而原来是 nowrap —— 于是 flex 把每一项都压扁，"新建指令"这类按钮被压成竖排单字、
          "20 个指令 · 77 个节点 · 94 条连线"被压成十几行（工具栏因此高达 240px）。
          2026-10-24 再收一次：只用一层 flex-wrap 时，换行点落在哪个按钮纯看宽度，
          869px 下「生成代码」被单独挤到最后一行（一个按钮占一行、看着像掉队）。
          试过把按钮分成左右两组各自换行 —— 中栏只有 344px 时两组分别 wrap，工具栏
          反而从 ~150px 涨到 205px（更挤）。所以保持**单层贪婪换行**，只把
          "测试 + 生成代码"这对落盘动作套一层小分组：它们永远在同一行，
          其余按钮按宽度自然填满每一行。 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 border-b border-zinc-800 shrink-0 [&>*]:shrink-0 [&>*]:whitespace-nowrap">
        <span className="text-sm text-zinc-300 flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <Puzzle className="w-4 h-4" />
          {t('blocks.editor.lowCode')}
        </span>
        <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
          {t('blocks.editor.stats', {
            chains: chains.length,
            nodes: nodes.length,
            edges: edges.length,
          })}
        </span>
        <Button
          variant="primary"
          size="sm"
          className="bg-blue-600/30 hover:bg-blue-600/50 text-blue-200"
          leftIcon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowCommandWizard(true)}
          title={t('blocks.editor.tip.newCommand')}
        >
          {t('blocks.editor.wizard.command')}
        </Button>
        {platformTagsVisible(TOOLBAR_PLATFORM_TAGS.commandPanel, projectPlatformFamily({ botType })) && (
          <Button
            variant={showCommandPanel ? 'primary' : 'secondary'}
            size="sm"
            className={
              showCommandPanel
                ? 'bg-blue-600/30 text-blue-200'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }
            leftIcon={<ListPlus className="w-3.5 h-3.5" />}
            onClick={() => {
              setShowCommandPanel((v) => !v);
              // 三个面板占同一块位置，同时开会把画布挤没
              setShowOutline(false);
              setShowCommandList(false);
            }}
            title={
              driftChecked && (driftStaleScopes > 0 || driftStaleItems > 0)
                ? t('blocks.editor.tip.panelDrift', {
                    scopes: String(driftStaleScopes),
                    items: String(driftStaleItems),
                  })
                : t('blocks.editor.tip.commandPanel')
            }
          >
            {t('blocks.editor.tab.commandPanel')}
            {driftChecked && (driftStaleScopes > 0 || driftStaleItems > 0) && (
              <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[10px] leading-4 text-amber-300">
                {driftStaleScopes > 0 ? driftStaleScopes : driftStaleItems}
              </span>
            )}
          </Button>
        )}
        {platformTagsVisible(TOOLBAR_PLATFORM_TAGS.factoryConfig, projectPlatformFamily({ botType })) && (
          <Button
            variant="secondary"
            size="sm"
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            leftIcon={<ClipboardCheck className="w-3.5 h-3.5" />}
            onClick={() => setShowFactoryConfig(true)}
            title={t('blocks.editor.tip.factoryConfig')}
          >
            {t('blocks.editor.tab.factoryConfig')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          leftIcon={<Database className="w-3.5 h-3.5" />}
          onClick={() => setShowConfigQueryWizard(true)}
          title={t('blocks.editor.tip.newLookup')}
        />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LayoutTemplate className="w-3.5 h-3.5" />}
          onClick={() => setShowTemplateLib(true)}
          title={t('blocks.editor.tip.snippets')}
        >
          {t('blocks.editor.tab.snippets')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Wand2 className="w-3.5 h-3.5" />}
          onClick={() => {
            void handleLayoutAll();
          }}
          title={t('blocks.editor.tip.autoLayout')}
        >
          {t('blocks.editor.tab.layout')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Maximize className="w-3.5 h-3.5" />}
          onClick={() => fitCanvas()}
          title={t('blocks.editor.menu.fitViewShortcut')}
        >
          {t('blocks.editor.tab.fit')}
        </Button>
        {errorNodeIds.size > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="bg-red-700/30 hover:bg-red-700/50 text-red-300 border border-red-700/40"
            leftIcon={<AlertTriangle className="w-3.5 h-3.5" />}
            onClick={jumpToNextError}
            title={t('blocks.editor.nodeErrors', { count: errorNodeIds.size })}
          >
            {t('blocks.editor.errorCount', { count: errorNodeIds.size })}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className={
            showDataEdges
              ? 'bg-sky-700/30 hover:bg-sky-700/50 text-sky-200 border border-sky-600/40'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }
          leftIcon={<GitBranch className="w-3.5 h-3.5" />}
          onClick={() => setShowDataEdges((v) => !v)}
          title={t('blocks.editor.tip.dataFlow')}
        >
          {t('blocks.editor.tab.dataFlow')}
        </Button>
        <Dropdown
          value=""
          onChange={(v) => {
            if (v) {
              setDeleteSystemTarget({
                id: v,
                name: systems.find((s) => s.id === v)?.name ?? v,
              });
            }
          }}
          options={[
            { value: '', label: t('blocks.editor.menu.deleteSystem') },
            ...systems.map((s) => ({ value: s.id, label: `${s.icon} ${s.name}` })),
          ]}
        />
        {/* 返回调用处：subflow_call 跳到 define 后显示，点击回到发起跳转的调用节点 */}
        {subflowJump && focusNodeId === subflowJump.toDefineId && (
          <Button
            variant="secondary"
            size="sm"
            className="bg-purple-800/40 hover:bg-purple-700/40 text-purple-200 border border-purple-500/40"
            leftIcon={<CornerUpLeft className="w-3.5 h-3.5" />}
            onClick={() => {
              if (subflowJump) {
                const fromCallId = subflowJump.fromCallId;
                setSubflowJump(null);
                focusNode(fromCallId);
              }
            }}
            title={t('blocks.editor.tip.backToCaller')}
          >
            {t('blocks.editor.tab.backToCaller')}
          </Button>
        )}
        <Button
          variant={showOutline ? 'primary' : 'secondary'}
          size="sm"
          className={
            showOutline
              ? 'bg-blue-600/30 text-blue-200'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }
          leftIcon={<ListTree className="w-3.5 h-3.5" />}
          onClick={() => {
            setShowOutline((v) => !v);
            // 两个面板占同一块位置，同时开会把画布挤没（指令清单比大纲宽）
            setShowCommandList(false);
          }}
          title={t('blocks.editor.tip.outline')}
        >
          {t('blocks.editor.tab.outline')}
        </Button>
        <Button
          variant={showCommandList ? 'primary' : 'secondary'}
          size="sm"
          className={
            showCommandList
              ? 'bg-blue-600/30 text-blue-200'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }
          leftIcon={<ListChecks className="w-3.5 h-3.5" />}
          onClick={() => {
            setShowCommandList((v) => !v);
            setShowOutline(false);
          }}
          title={t('blocks.editor.tip.commandList')}
        />
        <Button
          variant="secondary"
          size="sm"
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-20"
          leftIcon={<Undo2 className="w-4 h-4" />}
          disabled={!undoDepth}
          onClick={() => useFlowStore.getState().undo()}
          title={t('blocks.editor.menu.undo')}
        />
        <Button
          variant="secondary"
          size="sm"
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-20"
          leftIcon={<Redo2 className="w-4 h-4" />}
          disabled={!redoDepth}
          onClick={() => useFlowStore.getState().redo()}
          title={t('blocks.editor.menu.redo')}
        />
        {/* 教学入口已移除（2026-10-03）—— 用户反馈教程不够好，连同 TutorialModal 一起下线。
              将来重做时：组件与文案键都已删干净（原文案键被语言包孤儿键闸门逼着删掉了，见 0d7a779）。
              从 git 取回旧版当起点：git show 0d7a779^:src/renderer/src/components/blocks/TutorialModal.tsx */}
        <FlowIssuesButton />
        {/* 这两个是"落盘动作"，永远成对出现 —— 单独再包一层，窄栏下不会被拆开 */}
        <div className="flex items-center gap-2 [&>*]:shrink-0 [&>*]:whitespace-nowrap">
        <Button
          variant="success"
          size="sm"
          className="bg-green-700/30 hover:bg-green-700/50 text-green-300"
          leftIcon={<ChevronRight className="w-4 h-4" />}
          onClick={() => setShowTestDialog(true)}
          data-guide-target="test"
        >
          {t('editor.tab.test')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="bg-blue-600/30 hover:bg-blue-600/50 text-blue-200"
          onClick={() => void openGenerateDialog()}
          disabled={generating}
          data-guide-target="generate"
        >
          {generating ? t('ai.generating') : t('ai.quick.generate')}
        </Button>
        </div>
      </div>

      {loadErrorBanner}
    </>
  );
}
