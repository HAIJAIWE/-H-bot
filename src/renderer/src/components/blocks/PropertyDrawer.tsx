// src/renderer/src/components/blocks/PropertyDrawer.tsx
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import type { FlowNode, FlowEdge, ConfigApiBinding } from '@shared/types/flow';
import { findSpec, nodeDisplayLabel } from '../../lib/node/nodeCatalog';
import { DEFAULT_DB_PATH } from '@shared/nodes/builtinCatalog';
import {
  getControlInput,
  isControlPortName,
  isSubflowDefine,
} from '../../lib/canvas/executionOrder';
import {
  createEmptyKeyboard,
  getSendMessageOutputs,
  getExpressionEvalOutputs,
} from '@shared/types/keyboard';
import { findBinding } from './DataBindingSelect';
import { DataBindingSelect } from './DataBindingSelect';
import { isPersistenceKind } from '@shared/nodes/kindSets';
import {
  buildConfigFields,
  groupFieldsBySection,
  isFieldOwnedElsewhere,
  partitionBindingRows,
  sectionOf,
} from './configFieldModel';
import { ConfigFieldRow } from './ConfigFieldRow';
import { computeVariableSlotCount } from '../../lib/expression/expressionVarSlots';
import { IfBranchBuilder } from './IfBranchBuilder';
import { ExpressionVarHelper, insertIntoFieldTextarea } from './ExpressionVarHelper';
import { findEnclosingSubflowId, namedVariablesOf } from '../../lib/expression/variableRegistry';
import { SwitchCaseEditor } from './SwitchCaseEditor';
import { SubflowParamsEditor } from './SubflowParamsEditor';
import { StartNodeConfigEditor } from './StartNodeConfigEditor';
import { EndNodeConfigEditor } from './EndNodeConfigEditor';
import { TableStructurePicker } from './TableStructurePicker';
import { MessageActionEditor } from './MessageActionEditor';
import { InlineCommandEditor } from './InlineCommandEditor';
import {
  useFlowStore,
  beginHistoryBatch,
  endHistoryBatch,
  pushHistoryPoint,
} from '../../stores/flowStore';
import { useI18nStore } from '../../stores/i18nStore';
import { Switch } from '../ui/Switch';
import { useProjectStore } from '../../stores/projectStore';
import { useStableKeys } from '../../hooks/useStableKeys';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import type { DataTemplate } from '../../types/ipc';
import { getNodeIcon, getDataTypeMeta, SECTION_ICONS } from './iconMap';
import { useToast } from '../ui/Toast';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { EmptyState } from '../ui/EmptyState';

import {
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Plus,
  Sigma,
  StickyNote,
  Table,
} from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';

// P0-D1 重构：常量字典、防抖输入组件、展示子组件拆分到独立文件
import { MULTILINE_FIELDS, JSON_FIELDS, JSON_EXAMPLES } from './propertyDrawerConstants';
// 配置字段显示名/说明的唯一真相（收敛自原先三份副本）
import { fieldHint, fieldLabel } from '../../i18n/fieldLabels';
import { t } from '../../i18n';
// 枚举型字段的选项来自目录（单一真相，见 docs/nodes/nodes-audit-handoff.md 闸 1）
import { getFieldOptions } from '@shared/nodes/portOptions';
import { DebouncedTextInput, DebouncedTextarea } from './DebouncedInputs';
import { FormulaEditor } from './FormulaEditor';
import { PortsSections } from './PortsSections';
import { ConfigFieldsSection } from './ConfigFieldsSection';
import { flushFlow } from '@renderer/lib/canvas/flushFlow';
import {
  Section,
  PortBindingRow,
  InfoRow,
  HelpIcon,
  SubflowParamsSection,
} from './PropertyDrawerParts';

interface PropertyDrawerProps {
  node: FlowNode | null;
  edges: FlowEdge[];
  upstreamNodes: FlowNode[];
  onClose: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** 阶段 7 Part A：高亮指定字段（错误修复跳转用）。消费后调用 onHighlightConsumed 清空。 */
  highlightField?: string | null;
  onHighlightConsumed?: () => void;
}

export const PropertyDrawer = React.memo(function PropertyDrawer({
  node,
  edges,
  upstreamNodes,
  onClose,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
  highlightField,
  onHighlightConsumed,
}: PropertyDrawerProps) {
  // 订阅 locale：端口名/端口说明/选项文案都来自目录，切语言必须重取
  const locale = useI18nStore((s) => s.locale);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- findSpec() 内部按当前语言取目录，locale 是它的隐含依赖，eslint 看不出来
  const spec = useMemo(() => (node ? findSpec(node.data.nodeKind) : null), [node, locale]);
  const NodeIcon = node ? getNodeIcon(node.data.nodeKind) : null;
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const updateNodeDescription = useFlowStore((s) => s.updateNodeDescription);
  const updateNodeOutputs = useFlowStore((s) => s.updateNodeOutputs);
  const addEdge = useFlowStore((s) => s.addEdge);
  const removeEdge = useFlowStore((s) => s.removeEdge);
  const validateNode = useFlowStore((s) => s.validateNode);
  const nodeErrors = useFlowStore((s) => (node ? s.nodeErrors[node.id] : undefined));
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const toast = useToast();
  // P0-D2：抽屉焦点管理（组件仅在显示时挂载，故 open 恒为 true；
  // 卸载时回归触发元素焦点，Esc 关闭，Tab 在抽屉内循环）
  const { ref: drawerRef, titleId: drawerTitleId } = useDialogFocus<HTMLDivElement>(true, onClose);
  // 所有节点列表：供 subflow_call 的 subflow_id 下拉选择用
  const allNodes = useFlowStore((s) => s.nodes);
  // 所有子流程定义节点（subflow_defined），用于 subflow_id 下拉选项
  const subflowDefineOptions = useMemo(() => {
    return allNodes
      .filter((n) => isSubflowDefine(n) && n.id !== node?.id)
      .map((n) => ({
        value: n.id,
        label: `${n.data.config.subflow_name || t('drawer.unnamedSubflow')} (${n.id})`,
      }));
  }, [allNodes, node?.id]);

  // 判断当前画布是否为子流程画布：
  // 1. 存在独立的 subflow_defined 节点（nodeKind === 'subflow_defined'）
  // 2. 或存在 start_node 且其 trigger_type === 'subflow_defined'
  // 用于 end_node 的 isSubflow prop：普通链 end_node 生成 pass（无返回值），子流程链生成 return {...}
  const isSubflowCanvas = useMemo(() => {
    return allNodes.some(
      (n) =>
        isSubflowDefine(n) ||
        (n.data.nodeKind === 'start_node' && n.data.config?.trigger_type === 'subflow_defined'),
    );
  }, [allNodes]);

  const isTrigger = node?.type === 'trigger';
  const isBranch = node?.data.nodeKind === 'branch_if' || node?.data.nodeKind === 'loop';

  // 表达式变量助手用：命名变量（按作用域过滤要知道自己在哪个子流程里）
  //
  // ⚠️ 这里用 **store 的 edges** 而不是 `edges` prop：`allNodes` 已经取自 store，
  // 两处来源不同就会出现"画布上明明连着、清单说没连"这种自相矛盾（真机上两者相同，
  // 但没必要把一致性押在调用方身上 —— 测试里立刻就暴露了一次）。
  const storeEdges = useFlowStore((s) => s.edges);
  const namedVariables = useMemo(() => namedVariablesOf(allNodes), [allNodes]);
  const enclosingSubflowId = useMemo(
    () => (node ? findEnclosingSubflowId(node.id, allNodes, storeEdges) : null),
    [node, allNodes, storeEdges],
  );
  /** 这个节点有几条**控制**入口线（>1 = 汇合点，两条分支接同一段后续） */
  const incomingControlCount = useMemo(() => {
    if (!node) return 0;
    const ctrlIn = getControlInput(node)?.portId;
    if (!ctrlIn) return 0;
    return storeEdges.filter((e) => e.target === node.id && e.targetPort === ctrlIn).length;
  }, [node, storeEdges]);

  // expression_eval 公式列表的稳定 key（避免删除/编辑时 DOM 错位）
  const formulasList =
    (node?.data.config?.formulas as Array<{ name: string; expression: string }>) ?? [];
  const [formulaKeys, removeFormulaKey] = useStableKeys(formulasList.length);

  // 数据模板：仅 variable_persist 节点需要
  const [template, setTemplate] = useState<DataTemplate | null>(null);
  // ⚠️ 2026-10-03：原来写死 variable_persist —— 拆成 7 个持久化节点之后，
  // 新节点（load_variable / save_variable / …）**拿不到数据模板选择器**（静默失效）。
  // 改为按目录的 resource === 'player_data' 派生（见 kindSets.ts），加新节点自动生效。
  const isPersistentNode = isPersistenceKind(node?.data.nodeKind);
  /**
   * 「显示全部参数」开关（默认关）。
   *
   * 默认只显示当前模式用得上的字段（如 group_op 选「禁言」时不再显示名片/头衔/文件路径），
   * 但高级用户可能想一次看全 —— 开关是他们的逃生口，也让"下限高、上限高"两头都成立。
   * 状态在组件内（切节点自动重置为关，避免上个子节点的展开状态影响下一个）。
   */
  const [showAllConfigFields, setShowAllConfigFields] = useState(false);
  /**
   * 折叠的分组（组装器类节点的字段太多：拼装消息 14 项、战斗面板 17 项）。
   * 默认**全部展开**（不藏东西 ✗），用户想看清结构时可以逐组折起来 ✓。
   * 切节点时重置 —— 否则上一个节点的折叠状态会影响下一个（这个坑以前在"显示全部参数"上踩过）。
   */
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  /** 当前展开了绑定选择器的配置字段（null = 都收起，保持面板精简） */
  const [inlineBindingPort, setInlineBindingPort] = useState<string | null>(null);
  // database_write 表结构浏览弹窗开关
  const [showTablePicker, setShowTablePicker] = useState(false);
  const isDbWriteNode = node?.data.nodeKind === 'database_write';
  // database_write 的数据库路径：优先用节点配置的 db_path；为空时回退到
  // **与「数据管理」同一批库**的默认路径（唯一真相层 DEFAULT_DB_PATH）。
  // 历史回退值 `data/player.db` 是临时拼的：那个库既不在数据浏览（data/players/）
  // 也不在配置管理（data/config/）的扫描范围内，表结构浏览弹窗会打开一个空库。
  //
  // 相对路径要补成绝对路径：表结构弹窗走 `launch:getSchema`，而该 IPC 用
  // `assertPathWithinBase(process.cwd(), …)` 校验 —— 只传相对路径时能不能打开
  // 取决于进程 cwd 恰好是不是项目目录（开发时是、打包后不是），属于碰运气。
  // 数据管理面板自己用的就是绝对路径（`dataService.listDataSources` 返回 `fullPath`）。
  const rawDbPath = (node?.data.config.db_path as string) || DEFAULT_DB_PATH;
  const dbPath =
    projectPath && !/^([a-zA-Z]:[\\/]|[\\/])/.test(rawDbPath)
      ? `${projectPath.replace(/[\\/]+$/, '')}/${rawDbPath}`
      : rawDbPath;
  const templateReqSeqRef = useRef(0);
  // 依赖 node?.id 而非 node 引用：防抖提交/数字键按下时 node 引用变化不再重复发 IPC；
  // 请求序号守卫：快速切换节点时丢弃过期响应（C 修复：原实现旧响应会覆盖新节点的 template）
  useEffect(() => {
    if (!isPersistentNode || !projectPath || !node?.id) return;
    const reqSeq = ++templateReqSeqRef.current;
    // 架构：**读盘前先冲刷** —— 主进程按 flow.json 里 variable_persist 的声明取权威 key，
    // 不冲刷的话"刚加的持久化节点"在这里看不到（见 lib/canvas/flushFlow.ts）
    void flushFlow(projectPath)
      .then(() => window.qqbat.launchData.getDataTemplate(projectPath))
      .then((res) => {
        if (templateReqSeqRef.current !== reqSeq) return;
        if (res.ok && res.data) setTemplate(res.data);
      })
      .catch((err) => {
        toast.error(t('drawer.operationFailed', { msg: String(err?.message ?? err) }));
      });
  }, [isPersistentNode, projectPath, node?.id, toast]);

  // 阶段 7 Part A：错误修复跳转 — 滚动到高亮字段并消费请求
  useEffect(() => {
    if (!highlightField || !node) return;
    // 等待下一帧确保 DOM 已渲染（特别是节点切换时）
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-field-key="${highlightField}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      onHighlightConsumed?.();
    }, 50);
    return () => clearTimeout(timer);
  }, [highlightField, node, onHighlightConsumed]);

  const templateKeyOptions = useMemo(() => {
    if (!template?.groups) return [];
    const opts: { value: string; label: string; group: string }[] = [];
    template.groups.forEach((g) => {
      g.fields.forEach((f) => {
        opts.push({ value: f.key, label: `${f.label} (${f.key})`, group: g.label });
      });
    });
    return opts;
  }, [template]);

  const dataInputs = useMemo(() => {
    if (!spec || !node) return [];
    const inputs = spec.inputs ?? node.data.inputs;
    return inputs.filter((p) => p.kind === 'data');
  }, [spec, node]);

  /** 该端口是否已被绑定（上游数据流边，或配置 API 绑定） */
  const isPortBound = useCallback(
    (portId: string): boolean => {
      if (!node) return false;
      if (findBinding(edges, node.id, portId)) return true;
      return edges.some(
        (e) => e.target === node.id && e.targetPort === portId && e.source === '__config_api__',
      );
    },
    [edges, node],
  );

  /** 端口 → 绑定来源的可读描述（用于"已绑定 ← 源"提示） */
  const describeBinding = useCallback(
    (portId: string): string | null => {
      if (!node) return null;
      const binding = findBinding(edges, node.id, portId);
      if (binding) {
        const srcNode = upstreamNodes.find((n) => n.id === binding.source);
        const srcPort = srcNode
          ? findSpec(srcNode.data.nodeKind)?.outputs.find((p) => p.id === binding.sourcePort)
          : undefined;
        return srcNode
          ? `${nodeDisplayLabel(srcNode)} · ${srcPort?.name ?? binding.sourcePort}`
          : binding.sourcePort;
      }
      const api = edges.find(
        (e) => e.target === node.id && e.targetPort === portId && e.source === '__config_api__',
      )?.configApi;
      return api ? `📦 ${api.table}.${api.field}` : null;
    },
    [edges, node, upstreamNodes],
  );

  const dataOutputs = useMemo(() => {
    if (!spec || !node) return [];
    const outputs = spec.outputs ?? node.data.outputs;
    return outputs.filter((p) => p.kind === 'data');
  }, [spec, node]);

  const configFields = useMemo(
    () => buildConfigFields(spec, node?.data.nodeKind ?? '', node?.data.config ?? {}),
    [spec, node],
  );

  /** 与当前模式无关、但用户填过值或有错的字段（用于"显示全部参数"提示） */
  const hiddenFieldCount = useMemo(
    () => configFields.filter((f) => !f.applicable).length,
    [configFields],
  );
  const visibleConfigFields = useMemo(() => {
    // 组装器类节点：先按分组稳定重排，保证同一组的字段连续（否则分组标题会重复出现）
    const shown = showAllConfigFields ? configFields : configFields.filter((f) => f.applicable);
    return groupFieldsBySection(shown, node?.data.nodeKind ?? '');
  }, [configFields, showAllConfigFields, node?.data.nodeKind]);
  /** 当前模式下必填字段数（D5 头部用："现在要你决定 N 项必填"） */
  const requiredVisibleCount = useMemo(
    () => visibleConfigFields.filter((f) => f.required).length,
    [visibleConfigFields],
  );

  // 当配置变更时验证节点
  // 依赖项使用 node?.id 而非 node 对象引用：切换节点时引用必变，触发校验；
  // 同一节点内 config/inputs 变化时也会触发。避免 node 对象引用每次渲染都变化导致无谓校验。
  const nodeId = node?.id;
  const nodeConfig = node?.data.config;
  const nodeInputs = node?.data.inputs;
  useEffect(() => {
    if (nodeId) validateNode(nodeId);
  }, [nodeId, nodeConfig, nodeInputs, validateNode]);

  // message_send 节点：当 mode/keyboard 变化时，动态更新输出端口（按钮事件端口）
  // 依赖用 node?.id + config 字段而非 node 引用：避免每次渲染都触发端口比较（C 修复）
  useEffect(() => {
    if (!node || node.data.nodeKind !== 'message_send') return;
    const newOutputs = getSendMessageOutputs(node.data.config);
    const oldOutputs = node.data.outputs;
    // 仅在端口列表实际变化时更新（避免无限循环）
    const changed =
      oldOutputs.length !== newOutputs.length ||
      newOutputs.some((p, i) => p.id !== oldOutputs[i]?.id || p.name !== oldOutputs[i]?.name);
    if (changed) {
      updateNodeOutputs(node.id, newOutputs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- node 仅用于读当前 outputs（写入目标）与 id（已在依赖），端口同步由 config 字段驱动
  }, [node?.id, node?.data.config?.mode, node?.data.config?.keyboard, updateNodeOutputs]);

  // expression_eval 节点：当 mode/formulas 变化时，动态更新输出端口（formulas 模式生成公式端口）
  useEffect(() => {
    if (!node || node.data.nodeKind !== 'expression_eval') return;
    const newOutputs = getExpressionEvalOutputs(node.data.config);
    const oldOutputs = node.data.outputs;
    const changed =
      oldOutputs.length !== newOutputs.length ||
      newOutputs.some((p, i) => p.id !== oldOutputs[i]?.id || p.name !== oldOutputs[i]?.name);
    if (changed) {
      updateNodeOutputs(node.id, newOutputs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- node 仅用于读当前 outputs（写入目标）与 id（已在依赖），端口同步由 config 字段驱动
  }, [node?.id, node?.data.config?.mode, node?.data.config?.formulas, updateNodeOutputs]);

  // 必填 vs 可选 数据端口
  //
  // ## 为什么这里要过滤（用户实测："这么多选择框，新人看了头大，我看了也头大"）
  //
  // 数据来源区曾把**全部** data 端口逐个渲染成"绑定行"（类型图标 + 端口名 + 手动输入下拉 +
  // 提示），group_op 的 15 个数据端口就是 15 行；而其中大多数参数在「完整配置」区还有
  // 一个值输入框 —— 同一个参数出现两次，控件自然堆成墙。判定逻辑见
  // `configFieldModel.isBindingRowPort`（已绑定的始终显示；有配置字段的交给配置区）。
  const bindingRows = useMemo(() => {
    // D4：公式节点的 v1~v11 是**按需变量**——只给"表达式里实际用到的"显示绑定行。
    // 之前 11 个变量端口固定渲染 11 行（每行还带一个「手动输入」下拉），
    // 而公式通常只用 1~3 个（用户实测："选择框出现太多了"）。
    // 已绑定的变量始终显示（安全阀：绝不藏用户接过线的端口）。
    const slotLimit =
      node?.data.nodeKind === 'expression_eval'
        ? computeVariableSlotCount({
            expression: String(node.data.config.expression ?? ''),
            formulas: node.data.config.formulas,
            manualCount: dataInputs.filter((p) => isPortBound(p.id)).length,
          })
        : Number.POSITIVE_INFINITY;
    const relevantInputs = dataInputs.filter((p) => {
      const m = /^v(\d+)$/.exec(p.id);
      if (!m) return true;
      return Number(m[1]) <= slotLimit || isPortBound(p.id);
    });

    return partitionBindingRows(relevantInputs, {
      config: node?.data.config ?? {},
      // 用目录声明的默认值键集合（而不是当前 config 的键：可能只填了部分字段）
      configKeys: new Set(Object.keys(spec?.defaultConfig ?? {})),
      isBound: isPortBound,
    });
  }, [dataInputs, isPortBound, node, spec]);
  const requiredInputs = bindingRows.required;
  const optionalInputs = bindingRows.optional;

  // 统计每个输出端口被多少下游绑定
  const outputConnectionCount = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!node) return counts;
    for (const edge of edges) {
      if (edge.source === node.id) {
        // 只统计数据流边（排除控制流端口）
        if (!isControlPortName(edge.sourcePort)) {
          counts[edge.sourcePort] = (counts[edge.sourcePort] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [edges, node]);

  const handleBinding = useCallback(
    (portId: string, sourceNodeId: string, sourcePortId: string) => {
      if (!node) return;
      const existing = findBinding(edges, node.id, portId);
      const st = useFlowStore.getState();
      // 先删旧边再建新边各压一次历史 → 包成单个撤销单元：
      // 批前状态入栈，批内 removeEdge/addEdge 不再各自 pushHistory（C 修复）
      pushHistoryPoint(st.nodes, st.edges);
      beginHistoryBatch();
      if (existing) removeEdge(existing.id);
      // 边 ID：e-源节点-源端口-目标节点-目标端口（语义化，无随机后缀）
      addEdge({
        id: `e-${sourceNodeId}-${sourcePortId}-${node.id}-${portId}`,
        source: sourceNodeId,
        sourcePort: sourcePortId,
        target: node.id,
        targetPort: portId,
      });
      endHistoryBatch();
    },
    [node, edges, removeEdge, addEdge],
  );

  const handleClearBinding = useCallback(
    (portId: string) => {
      if (!node) return;
      const existing = findBinding(edges, node.id, portId);
      if (existing) removeEdge(existing.id);
    },
    [node, edges, removeEdge],
  );

  /** 配置 API 绑定：创建 __config_api__ 边，流程中不显示读配置节点 */
  const handleConfigApiBinding = useCallback(
    (portId: string, configApi: ConfigApiBinding) => {
      if (!node) return;
      // 清除该端口上的所有现有绑定（普通数据流边 + 配置 API 边）
      const existingNormal = findBinding(edges, node.id, portId);
      if (existingNormal) removeEdge(existingNormal.id);
      const existingCfg = edges.find(
        (e) => e.target === node.id && e.targetPort === portId && e.source === '__config_api__',
      );
      if (existingCfg) removeEdge(existingCfg.id);
      // 创建配置 API 边
      addEdge({
        id: `e-cfgapi-${node.id}-${portId}`,
        source: '__config_api__',
        sourcePort: '__api__',
        target: node.id,
        targetPort: portId,
        configApi,
      });
    },
    [node, edges, removeEdge, addEdge],
  );

  // P0-D4：抽屉内删除节点（与画布删除同规则：trigger 不显示、subflow_defined 被引用校验、多分支二次确认）
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const handleDeleteClick = () => {
    if (!node) return;
    const reason = useFlowStore.getState().canRemoveNode(node.id);
    if (reason) {
      toast.error(reason);
      return;
    }
    const multiBranchKinds = ['branch_if', 'branch_switch', 'try_catch', 'loop'];
    if (multiBranchKinds.includes(node.data.nodeKind)) {
      setDeleteConfirm(true);
      return;
    }
    onDelete();
  };

  if (!node || !spec) {
    // 未选节点空状态：显示抽屉骨架 + 引导文案，避免用户看到空白不知如何操作
    // （场景：选中节点被删除 / selectedNodeId 失效。正常情况下抽屉由 showPropertyDrawer 控制）
    return (
      <>
        <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={onClose} />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={drawerTitleId}
          tabIndex={-1}
          className="fixed right-0 top-0 bottom-0 w-[420px] bg-zinc-900 border-l border-zinc-700 shadow-2xl z-50 flex flex-col animate-[slideInRight_0.2s_ease-out] outline-none"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <span id={drawerTitleId} className="text-sm font-semibold text-zinc-100">
              {t('drawer.nodeConfig')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              title={t('common.close')}
              className="w-7 h-7 hover:text-white"
              leftIcon={<X className="w-4 h-4" />}
            />
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              title={t('drawer.noNodeSelected')}
              description={t('drawer.noNodeSelectedDesc')}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* 遮罩层（点击关闭） */}
      <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={onClose} />

      {/* 抽屉主体 */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={drawerTitleId}
        tabIndex={-1}
        className="fixed right-0 top-0 bottom-0 w-[420px] bg-zinc-900 border-l border-zinc-700 shadow-2xl z-50 flex flex-col animate-[slideInRight_0.2s_ease-out] outline-none"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800 shrink-0">
          {NodeIcon && <NodeIcon className="w-5 h-5 text-zinc-400 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div id={drawerTitleId} className="text-sm font-semibold text-zinc-100 truncate">
              {nodeDisplayLabel(node)}
            </div>
            {/*
              只显示中文分组，内部英文标识（nodeKind）挪进 tooltip。
              事故：这一行原来直接渲染 `node.data.nodeKind`，于是"全中文界面"的标题正下方
              挂着一串 `expression_eval` / `variable_persist` —— 用户实测反馈"看不懂英文，
              我不是做的全中文么"。它是排查用的技术信息，不该常驻在标题下；
              挪进 tooltip 仍然找得回来（见 lowcode-design.md 原则 3：隐藏必须可找回），
              「节点信息」区块里也保留了完整的一条。
            */}
            <div className="text-xs text-zinc-500 flex items-center gap-1.5">
              <span
                className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400"
                title={node.data.nodeKind}
              >
                {spec.group}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            title={t('common.close')}
            className="w-7 h-7 hover:text-white"
            leftIcon={<X className="w-4 h-4" />}
          />
        </div>

        {/* 节点说明 */}
        {spec.summary && (
          <div className="px-4 py-2.5 bg-zinc-800/40 border-b border-zinc-800 shrink-0">
            <p className="text-xs text-zinc-400 leading-relaxed">{spec.summary}</p>
          </div>
        )}

        {/* 节点备注（用户可编辑的业务说明） */}
        <div className="px-4 py-2.5 border-b border-zinc-800 shrink-0">
          <label className="text-xs text-zinc-500 block mb-1 flex items-center gap-1">
            <StickyNote className="w-3.5 h-3.5" />
            {t('drawer.note')}
          </label>
          <DebouncedTextInput
            className="w-full text-xs text-zinc-200 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-zinc-500"
            placeholder={t('drawer.notePlaceholder')}
            ariaLabel={t('drawer.noteAria')}
            value={node.data.description ?? ''}
            onChange={(v) => updateNodeDescription(node.id, v)}
          />
          {/* 一句提示：备注是给「意图/业务说明」用的，标题保持类型名（AI 也按这条走） */}
          <p className="mt-1 text-[10px] text-zinc-600">{t('drawer.noteHint')}</p>
        </div>

        {/* 错误提示（参数验证失败） */}
        {nodeErrors && nodeErrors.length > 0 && (
          <div className="px-4 py-2 bg-red-900/20 border-b border-red-900/40 shrink-0 space-y-0.5">
            {nodeErrors.map((err: string, i: number) => (
              <div key={i} className="text-xs text-red-400 flex items-start gap-1">
                <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            ))}
          </div>
        )}

        {/* 可滚动内容区 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ===== 节点自解释头部（D5）=====
              用户实测："完全不知道怎么设计这个节点是干啥的" —— 打开节点先看到一列输入框，
              既不知道它在流程里做什么，也不知道这次要填几项。
              这里先回答"它做什么"（目录里的 summary，人话版），再说"现在要你决定几项"。 */}
          {spec && (
            <div className="mx-4 mt-3 mb-1 rounded-lg border border-zinc-700/70 bg-zinc-800/40 px-3 py-2">
              <div className="text-xs text-zinc-300 leading-relaxed">
                <span className="text-zinc-500">{t('drawer.whatThisNodeDoes')}</span>
                {spec.summary || spec.description || spec.label}
              </div>
              {/* 汇合点提示：控制口现在允许多条入边（两条分支接同一段后续）。
                  只在**真的有**多条入口时出现，所以不会给普通节点添噪音。
                  没有这句话的话，用户拖第二条线时会以为"怎么又多了一条"（以前是替换掉旧的）。 */}
              {incomingControlCount > 1 && (
                <div className="mt-1 text-[11px] text-sky-300/90 leading-relaxed">
                  {t('drawer.joinHint', { count: String(incomingControlCount) })}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
                <span>
                  {t('drawer.decidePrefix')}{' '}
                  <span className="text-zinc-300">
                    {requiredVisibleCount > 0
                      ? t('drawer.decideRequired', { count: String(requiredVisibleCount) })
                      : t('drawer.decideCount', { count: String(visibleConfigFields.length) })}
                  </span>
                  {requiredVisibleCount > 0 &&
                    visibleConfigFields.length - requiredVisibleCount > 0 && (
                      <>
                        {' + '}
                        <span className="text-zinc-400">
                          {t('drawer.optionalCount', {
                            count: String(visibleConfigFields.length - requiredVisibleCount),
                          })}
                        </span>
                      </>
                    )}
                </span>
                {hiddenFieldCount > 0 && (
                  <span className="text-zinc-600">
                    {t('drawer.hiddenFieldsHint', { count: String(hiddenFieldCount) })}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ============ 完整配置区（卡片内联字段之外的完整字段在此编辑） ============ */}
          {/* ============ 配置字段区（已抽到 ConfigFieldsSection）============ */}
          {configFields.length > 0 && (
            <ConfigFieldsSection
              allNodes={allNodes}
              collapsedSections={collapsedSections}
              describeBinding={describeBinding}
              edges={edges}
              enclosingSubflowId={enclosingSubflowId ?? null}
              handleBinding={handleBinding}
              handleClearBinding={handleClearBinding}
              handleConfigApiBinding={handleConfigApiBinding}
              hiddenFieldCount={hiddenFieldCount}
              highlightField={highlightField ?? null}
              inlineBindingPort={inlineBindingPort}
              isDbWriteNode={isDbWriteNode}
              isPersistentNode={isPersistentNode}
              namedVariables={namedVariables}
              node={node}
              nodeId={nodeId}
              setCollapsedSections={setCollapsedSections}
              setInlineBindingPort={setInlineBindingPort}
              setShowAllConfigFields={setShowAllConfigFields}
              setShowTablePicker={setShowTablePicker}
              showAllConfigFields={showAllConfigFields}
              spec={spec}
              storeEdges={storeEdges}
              templateKeyOptions={templateKeyOptions}
              updateNodeConfig={updateNodeConfig}
              upstreamNodes={upstreamNodes}
              visibleConfigFields={visibleConfigFields}
            />
          )}

          {/* ============ 子流程选择（subflow_call 专用）============ */}
          {node.data.nodeKind === 'subflow_call' && (
            <Section
              title={t('drawer.callTarget')}
              icon={SECTION_ICONS.config}
              collapsible
              defaultOpen={true}
            >
              <div className="space-y-2">
                <label className="text-xs text-zinc-300 flex items-center gap-1">
                  <span className="text-red-400">*</span>
                  {fieldLabel('subflow_id')}
                </label>
                <Dropdown
                  value={String(node.data.config.subflow_id ?? '')}
                  ariaLabel={t('drawer.subflowSelect')}
                  onChange={(v) => updateNodeConfig(node.id, { subflow_id: v })}
                  options={[
                    { value: '', label: t('drawer.subflowPlaceholder') },
                    ...subflowDefineOptions,
                  ]}
                  className={`w-full ${!node.data.config.subflow_id ? 'border-red-500/60' : ''}`}
                />
                {subflowDefineOptions.length === 0 && (
                  <div className="text-xs text-amber-400">{t('drawer.noSubflowDefined')}</div>
                )}
                {!!node.data.config.subflow_id && (
                  <div className="text-xs text-zinc-500">{t('drawer.subflowCallHint')}</div>
                )}
              </div>
            </Section>
          )}

          {/* ============ 参数说明（subflow_call 专用，显示被调用子流程的入参）============ */}
          {node.data.nodeKind === 'subflow_call' && !!node.data.config.subflow_id && (
            <SubflowParamsSection
              defineNode={allNodes.find((n) => n.id === node.data.config.subflow_id)}
              sectionIcon={SECTION_ICONS.config}
            />
          )}

          {/* ============ 触发器配置（start_node 专用）============ */}
          {node.data.nodeKind === 'start_node' && (
            <Section
              title={t('drawer.triggerConfig')}
              icon={SECTION_ICONS.config}
              collapsible
              defaultOpen={true}
            >
              <StartNodeConfigEditor
                config={node.data.config}
                nodeId={node.id}
                onConfigChange={(patch) => updateNodeConfig(node.id, patch)}
              />
            </Section>
          )}

          {/* ============ 结束配置（end_node 专用）============ */}
          {node.data.nodeKind === 'end_node' && (
            <Section
              title={t('drawer.endConfig')}
              icon={SECTION_ICONS.config}
              collapsible
              defaultOpen={true}
            >
              <EndNodeConfigEditor
                config={node.data.config}
                nodeId={node.id}
                onConfigChange={(patch) => updateNodeConfig(node.id, patch)}
                upstreamNodes={upstreamNodes}
                isSubflow={isSubflowCanvas}
              />
            </Section>
          )}

          {/* ============ 参数编辑器（subflow_defined 专用）============ */}
          {isSubflowDefine(node) && (
            <Section title={t('drawer.paramList')} icon={RefreshCw} collapsible defaultOpen={true}>
              <SubflowParamsEditor
                config={node.data.config}
                nodeId={node.id}
                onConfigChange={(patch) => updateNodeConfig(node.id, patch)}
              />
            </Section>
          )}

          {/* ============ 分支编辑器（branch_switch 专用）============ */}
          {node.data.nodeKind === 'branch_switch' && (
            <Section
              title={t('drawer.branchEditor')}
              icon={RefreshCw}
              collapsible
              defaultOpen={true}
            >
              <SwitchCaseEditor
                nodeId={node.id}
                config={node.data.config}
                onConfigChange={(patch) => updateNodeConfig(node.id, patch)}
              />
            </Section>
          )}

          {/* ============ 按钮消息编辑器（message_send 按钮UI模式）============ */}
          {node.data.nodeKind === 'message_send' && node.data.config?.mode === 'keyboard' && (
            <Section
              title={t('drawer.keyboardEditor')}
              icon={RefreshCw}
              collapsible
              defaultOpen={true}
            >
              <MessageActionEditor
                nodeId={node.id}
                config={node.data.config}
                onConfigChange={(patch) => updateNodeConfig(node.id, patch)}
                projectPath={projectPath}
              />
            </Section>
          )}

          {/* ============ 可点指令编辑器（message_compose）============ */}
          {node.data.nodeKind === 'message_compose' && (
            <Section
              title={t('drawer.inlineCommandEditor')}
              icon={RefreshCw}
              collapsible
              defaultOpen={true}
            >
              <InlineCommandEditor
                value={node.data.config?.inline_commands}
                onChange={(v) => updateNodeConfig(node.id, { inline_commands: v })}
              />
            </Section>
          )}

          {/* expression_eval 公式编辑器（formulas 模式）—— 已抽到 FormulaEditor */}
          {node.data.nodeKind === 'expression_eval' && node.data.config?.mode === 'formulas' && (
            <FormulaEditor
              node={node}
              formulasList={formulasList}
              formulaKeys={formulaKeys}
              removeFormulaKey={removeFormulaKey}
              updateNodeConfig={updateNodeConfig}
            />
          )}

          {/* ============ 端口三区（必填 / 可选 / 输出）—— 已抽到 PortsSections ============ */}
          <PortsSections
            node={node}
            edges={edges}
            upstreamNodes={upstreamNodes}
            requiredInputs={requiredInputs}
            optionalInputs={optionalInputs}
            dataOutputs={dataOutputs}
            handleBinding={handleBinding}
            handleClearBinding={handleClearBinding}
            handleConfigApiBinding={handleConfigApiBinding}
            outputConnectionCount={outputConnectionCount}
          />

          {/* ============ 节点信息 ============ */}
          <Section
            title={t('drawer.nodeInfo')}
            icon={SECTION_ICONS.info}
            collapsible
            defaultOpen={false}
          >
            <div className="space-y-1 text-xs text-zinc-400">
              <InfoRow label={t('drawer.nodeId')} value={node.id} mono />
              <InfoRow label={t('drawer.nodeType')} value={spec.label} />
              <InfoRow label={t('drawer.typeId')} value={node.data.nodeKind} mono />
              <InfoRow label={t('drawer.group')} value={spec.group} />
              <InfoRow
                label={t('drawer.sideEffects')}
                value={
                  (spec.sideEffects?.length ?? 0) > 0
                    ? spec.sideEffects!.join(', ')
                    : t('drawer.none')
                }
              />
              {/* P2-7: composite 标签单独显示（带紫色强调），不与业务标签混排 */}
              {spec.tags?.includes('composite') && (
                <div className="flex items-start gap-2 pt-1">
                  <span className="text-zinc-500 shrink-0">{t('drawer.nodeCategory')}</span>
                  <span
                    className="px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 text-xs border border-violet-700/40"
                    title={t('palette.composedTitle')}
                  >
                    {t('drawer.composedNode')}
                  </span>
                </div>
              )}
              {/* 业务标签（过滤掉 composite，避免与节点类别徽章重复） */}
              {(spec.tags?.filter((t) => t !== 'composite').length ?? 0) > 0 && (
                <div className="flex items-start gap-2 pt-1">
                  <span className="text-zinc-500 shrink-0">{t('drawer.tags')}</span>
                  <div className="flex flex-wrap gap-1">
                    {spec
                      .tags!.filter((t) => t !== 'composite')
                      .map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Footer 操作区 */}
        <div className="px-4 py-3 border-t border-zinc-800 shrink-0 flex items-center gap-2">
          {!isTrigger && !isBranch && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onMoveUp}
                disabled={!canMoveUp}
                title={t('drawer.moveUp')}
                leftIcon={<ChevronUp className="w-3.5 h-3.5" />}
              >
                {t('drawer.moveUp')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onMoveDown}
                disabled={!canMoveDown}
                title={t('drawer.moveDown')}
                leftIcon={<ChevronDown className="w-3.5 h-3.5" />}
              >
                {t('drawer.moveDown')}
              </Button>
            </>
          )}
          {!isTrigger && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteClick}
              title={t('drawer.deleteNode')}
              className="ml-auto bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              {t('drawer.delete')}
            </Button>
          )}
        </div>
      </div>

      {/* P0-D4：删除分支节点二次确认（与画布删除规则一致） */}
      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={() => {
          setDeleteConfirm(false);
          onDelete();
        }}
        title={t('drawer.deleteBranchNode')}
        message={t('drawer.deleteBranchConfirm')}
        confirmText={t('drawer.confirmDelete')}
        variant="danger"
      />

      {/* database_write 表结构浏览弹窗 */}
      {showTablePicker && isDbWriteNode && node && (
        <TableStructurePicker
          dbPath={dbPath}
          currentTable={String(node.data.config.table ?? '')}
          onPickField={(_fieldName, table) => {
            // 点击字段时把所属表名填入 table 字段（便于快速选择表）
            if (table) {
              updateNodeConfig(node.id, { table });
            }
            setShowTablePicker(false);
          }}
          onClose={() => setShowTablePicker(false)}
        />
      )}
    </>
  );
});
