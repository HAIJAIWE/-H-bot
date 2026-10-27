// src/shared/nodes/flowNormalize.ts
//
// 流程规范化与校验 —— **唯一真相层**。
//
// ## 为什么需要它
//
// flow.json 里的节点**不保证**保存了端口定义（`data.inputs` / `data.outputs`）：
// 内置模板（`src/main/templates/*.ts`）只写 `{ id, kind, label, type, x, y, config }`，
// 从模板创建的项目天生没有端口。历史上每个消费方各自兜底，于是同一份流程被四套代码
// 各自解释，行为不一致（实测踩到的三个 bug）：
//   1. 代码生成有 `populateMissingPorts`（从注册表补端口）→ 生成的代码看着正常；
//   2. `sanitizeFlowEdges` 校验端口时看不到 `keyboard` 推导出的 `btn_*` → 按钮连线被当
//      无效边**静默删除**（实测删了 4 条）；
//   3. 解释器**没有**任何兜底 → handler 拿到空 kwargs → `message_send` 在
//      「text 不能为空」处静默返回（实测：机器人完全不回复）。
//
// 本模块把"补端口 + 校验"收敛成一处，供渲染层、代码生成、解释器共用：
//   - 端口来源：`NODE_CATALOG_V2`（静态节点目录，渲染层/主进程/无头运行时都可用；
//     不用可变注册表，避免依赖"必须先 registerAllBuiltinNodes"这一隐式前提）
//   - 动态端口：由 config 推导（`message_send(keyboard)` 的 `btn_*`、
//     `expression_eval(formulas)` 的公式端口）
//
// ## 设计约束
//   - **非破坏性**：只增不删。已有端口（含目录里没有的动态端口）一律保留，
//     避免"规范化把用户连线弄丢"这类反向事故。
//   - **可报告**：所有改动以 `NormalizeChange[]` 返回，调用方可以记录/提示，
//     而不是悄悄改掉数据（这是历史上最痛的教训：静默清洗）。
import { NODE_CATALOG_V2 } from './builtinCatalog';
import { toPlainPorts } from './portUtils';
import { getExpressionEvalOutputs, getSendMessageOutputs } from '../types/keyboard';
import { isPortApplicable, type VisibilityPort } from './fieldVisibility';
import type { Port } from '../types/flow';

/**
 * 规范化/校验只依赖图的两个字段，因此对图类型**泛型化**：既能用于渲染层与主进程的
 * 严格 schema 类型（`@shared/types/flow`），也能用于运行时那套故意宽松的类型
 * （`src/main/runtime/ExecContext.ts` 用索引签名容忍畸形数据）。这样统一层无需在
 * 每个调用点强转类型。
 *
 * 注意：以下接口**不能**声明 `[key: string]: unknown` —— 带索引签名的目标类型
 * 无法接受未声明索引签名的来源类型（严格 FlowGraph 就是这种），会退化成大面积
 * 类型错误。
 */
/**
 * 端口的最小结构：严格 `Port`（catalog）与运行时宽松端口
 * （`{ id, kind: string, [k]: any }`，缺 name）都必须可赋值给它。
 * 因此这里只保留两边都有的可选字段 —— 同样**不加索引签名**。
 */
export interface NormalizablePort {
  id: string;
  kind?: string;
  name?: string;
  dataType?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

export interface NormalizableNodeData {
  nodeKind?: string;
  label?: string;
  config?: Record<string, unknown>;
  inputs?: NormalizablePort[];
  outputs?: NormalizablePort[];
}

export interface NormalizableNode {
  id: string;
  type?: string;
  data?: NormalizableNodeData;
}

export interface NormalizableGraph {
  nodes?: NormalizableNode[];
  edges?: unknown[];
}

/** 单个节点的规范化改动 */
export interface NormalizeChange {
  nodeId: string;
  nodeKind: string;
  /** 补了哪些输入端口 */
  addedInputs: string[];
  /** 补了哪些输出端口 */
  addedOutputs: string[];
}

export interface NormalizeResult<T> {
  graph: T;
  /** 发生过改动的节点（未改动的不出现） */
  changes: NormalizeChange[];
  /** 节点目录里查不到的 kind（插件节点 / 已移除的节点） */
  unknownKinds: Array<{ nodeId: string; nodeKind: string }>;
}

/** 校验问题的严重级别 */
export type IssueSeverity = 'error' | 'warning' | 'info';

import { collectConnectionIssues, isTriggerLikeNode } from './connectionIssues';
import { describePlatformMismatch, findPlatformMismatches } from './platformCheck';
import type { PlatformFamily } from '../domain/platform/registry';

/** 一条校验问题 */
export interface FlowIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** 给界面的一行修复建议（来自连线规则） */
  fixHint?: string;
}

/** 按 kind 查节点目录 */
function findSpec(kind: string) {
  return NODE_CATALOG_V2.find((s) => s.kind === kind);
}

/**
 * 由 config 推导的动态输出端口。
 *
 * 这些端口不在节点目录里，因为它们的数量/名称取决于用户配置（按钮、公式）。
 */
function dynamicOutputsFor(nodeKind: string, config: Record<string, unknown>): Port[] {
  if (nodeKind === 'message_send') return getSendMessageOutputs(config);
  if (nodeKind === 'expression_eval') return getExpressionEvalOutputs(config);
  // 其它节点的动态端口（如 branch_switch 的 case_*）依赖既有保存值：
  // 非破坏性合并会原样保留它们，故此处无需推导。
  return [];
}

/** 合并端口：保留已有（含动态端口），仅追加缺失的定义 */
function mergePorts(
  existing: NormalizablePort[] | undefined,
  desired: NormalizablePort[],
): {
  ports: NormalizablePort[];
  added: string[];
} {
  const current = Array.isArray(existing) ? existing : [];
  const seen = new Set(current.map((p) => p.id));
  const added: NormalizablePort[] = [];
  for (const port of desired) {
    if (!port?.id || seen.has(port.id)) continue;
    seen.add(port.id);
    added.push({ ...port });
  }
  return {
    ports: added.length > 0 ? [...current, ...added] : current,
    added: added.map((p) => p.id),
  };
}

/**
 * 规范化流程：按节点目录补齐缺失的端口定义（非破坏性）。
 *
 * 幂等：对已经完整的流程调用不会产生任何改动。
 */
export function normalizeFlow<T extends NormalizableGraph>(graph: T): NormalizeResult<T> {
  const changes: NormalizeChange[] = [];
  const unknownKinds: Array<{ nodeId: string; nodeKind: string }> = [];

  const nodes = (graph.nodes ?? []).map((node) => {
    const nodeKind = node.data?.nodeKind ?? '';
    const spec = findSpec(nodeKind);

    if (!spec) {
      if (nodeKind) unknownKinds.push({ nodeId: node.id, nodeKind });
      return node;
    }

    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    // 端口必须脱函数（showWhen）：规范化结果会进渲染层 store，
    // 带函数的对象过不了撤销历史的 structuredClone（DataCloneError）
    const desiredInputs = toPlainPorts(spec.inputs) as Port[];
    const desiredOutputs = [
      ...(toPlainPorts(spec.outputs) as Port[]),
      ...dynamicOutputsFor(nodeKind, config),
    ];

    const inputs = mergePorts(node.data?.inputs, desiredInputs);
    const outputs = mergePorts(node.data?.outputs, desiredOutputs);

    if (inputs.added.length === 0 && outputs.added.length === 0) return node;

    changes.push({
      nodeId: node.id,
      nodeKind,
      addedInputs: inputs.added,
      addedOutputs: outputs.added,
    });

    return {
      ...node,
      data: { ...node.data, inputs: inputs.ports, outputs: outputs.ports },
    } as NormalizableNode;
  });

  return {
    graph: (changes.length > 0 ? { ...graph, nodes } : graph) as T,
    changes,
    unknownKinds,
  };
}

/** 校验问题的最小边结构（同时兼容严格 schema 与运行时宽松类型） */
export interface NormalizableEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  configApi?: unknown;
}

/**
 * 校验流程，返回问题清单（不修改流程）。
 *
 * 覆盖的都是**真实踩过**的坑：端口定义丢失、连线指向不存在的端口/节点、
 * 必填配置为空、节点不可达。
 */
/**
 * 把节点配置里所有"看起来像按钮"的对象收集起来。
 *
 * 三种存放位置（都是项目里真实存在的）：
 *   · `message_send`  → `config.keyboard.rows[].buttons[]`
 *   · `message_compose` → `config.buttons[]`
 *   · 面板/菜单类节点 → `config.rows[].buttons[]`
 *
 * 不按节点 kind 分派，是因为**按钮字段名在不同节点上不一样**，而校验规则完全一样；
 * 按形状收集，将来加新节点也不会漏掉。收集不到就返回空数组（不误报）。
 */
function collectButtons(config: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const asObj = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

  const rowsFrom = (kb: unknown) => {
    const k = asObj(kb);
    const rows = k?.rows;
    return Array.isArray(rows) ? rows : null;
  };
  const rows = rowsFrom(config.keyboard) ?? (Array.isArray(config.rows) ? config.rows : null);
  if (rows) {
    for (const r of rows) {
      const buttons = asObj(r)?.buttons;
      if (Array.isArray(buttons)) {
        for (const b of buttons) {
          const o = asObj(b);
          if (o && o.action) out.push(o);
        }
      }
    }
  }
  if (Array.isArray(config.buttons)) {
    for (const b of config.buttons) {
      const o = asObj(b);
      if (o && o.action) out.push(o);
    }
  }
  return out;
}

/**
 * 校验选项（第 65 批 `platformCheck` 引入）。
 *
 * `projectPlatform` 是**可选**的：调用方不知道项目平台时（例如只拿到一张孤立的图、
 * AI 提案预演）就不传，校验保持原来的行为 —— 平台校验绝不能变成"没传参就报错"。
 */
export interface ValidateFlowOptions {
  /** 当前项目所属平台族；传 `null` 表示"项目没绑平台"，此时不做平台校验 */
  projectPlatform?: PlatformFamily | null
}

export function validateFlow(
  graph: NormalizableGraph,
  options: ValidateFlowOptions = {},
): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = graph.nodes ?? [];
  const edges = (graph.edges ?? []) as NormalizableEdge[];

  const nodeMap = new Map<string, NormalizableNode>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-node-id',
        message: `节点 id 重复: ${node.id}`,
        nodeId: node.id,
      });
    }
    nodeMap.set(node.id, node);
  }

  /**
   * 连线 id 必须唯一 —— 之前**没有任何东西在守它**。
   *
   * 事故（2026-09-19，用户项目实测）：`rpg_c6` 被两条线共用
   * （`rpg_calc → rpg_inc_exp` 与 `rpg_lrow → rpg_calc`），是**脚本批量生成节点/边**时
   * 手写 id 撞车造成的，横跨了 3 个备份版本都没人发现。
   *
   * 为什么是 warning 而不是 error：执行器走的是 `controlOut` / `dataIn`
   * （按「节点 + 端口」索引，见 ExecContext.findControlNext），**不读边 id**，
   * 所以流程照跑。真正坏掉的是**编辑**：画布与 store 大量按 id 找边
   * （删除 / 更新 / React 渲染 key），`findIndex(e => e.id === id)` 会命中**另一条** ——
   * 现象是"删一条线，另一条也没了"。这种"跑得通但改不动"的问题不该拦预览，
   * 但必须报出来，否则用户永远不知道。
   */
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    // 缺 id 的边不参与去重：报「重复: undefined」是误报（那是"缺失"不是"重复"），
    // 只会给问题清单添噪声
    if (!edge.id) continue;
    if (edgeIds.has(edge.id)) {
      issues.push({
        severity: 'warning',
        code: 'duplicate-edge-id',
        message: `连线 id 重复: ${edge.id}（同一 id 被多条连线共用，删除或更新连线时会改错对象）`,
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
  }

  for (const node of nodes) {
    const nodeKind = node.data?.nodeKind ?? '';
    const spec = findSpec(nodeKind);
    if (!spec) {
      issues.push({
        severity: 'warning',
        code: 'unknown-node-kind',
        message: `节点「${node.data?.label ?? node.id}」的类型 ${nodeKind || '(空)'} 不在内置节点目录中${
          nodeKind.startsWith('plugin_') ? '（按插件节点处理，请确认 plugins/ 中已提供）' : ''
        }`,
        nodeId: node.id,
      });
      continue;
    }

    // 必填配置：数据端口 required 且既无连线、config 也为空
    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    for (const port of (spec.inputs as Port[]).filter((p) => p.kind === 'data' && p.required)) {
      // 当前模式下用不到的字段不算"缺必填"（`showWhen` 是目录对"这个字段适不适用"的声明）。
      // 少了这一条会报**假错误**：`expression_eval` 的「表达式」在 formulas 模式下根本没被读，
      // 却因为没有值把整张图标红（搭 RPG 主线时实测）。
      if (!isPortApplicable(port as VisibilityPort, config, spec.defaultConfig)) continue;
      const bound = edges.some((e) => e.target === node.id && e.targetPort === port.id);
      const raw = config[port.id];
      const empty = raw === undefined || raw === null || raw === '';
      if (!bound && empty) {
        issues.push({
          severity: 'error',
          code: 'missing-required-config',
          message: `节点「${node.data?.label ?? node.id}」缺少必填项「${port.name}」`,
          nodeId: node.id,
        });
      }
    }

    // 按钮：`action.data` 不能空 —— 之前**没有任何东西在守它**
    //
    // 事故来源（2026-09-29）：`createEmptyButton()` 的初值就是 `data: ''`（见
    // `shared/types/keyboard.ts`），用户加一行按钮但忘了填内容，**校验全绿、也能发出去**，
    // 只是用户点下去什么都不发生 —— 又一次"看起来成功了、其实没成功"。
    // 而 `type=0`（链接跳转）还多一条官方硬要求：`data` 必须是 http/https（错误码 40030008）。
    for (const btn of collectButtons(config)) {
      const action = (btn as { action?: { type?: number; data?: string } }).action;
      const data = String(action?.data ?? '').trim();
      const type = Number(action?.type ?? 0);
      const label = String(
        (btn as { render_data?: { label?: string } }).render_data?.label ?? '',
      ).trim();
      const where = `节点「${node.data?.label ?? node.id}」的按钮${label ? `「${label}」` : ''}`;

      if (!data) {
        issues.push({
          severity: 'error',
          code: 'button-data-empty',
          message: `${where}没有内容：用户点下去不会有任何反应（按钮类型 ${
            type === 2 ? '指令' : type === 0 ? '链接' : '回传'
          }）`,
          nodeId: node.id,
        });
        continue;
      }
      if (type === 0 && !/^https?:\/\//i.test(data)) {
        issues.push({
          severity: 'error',
          code: 'button-link-not-url',
          message: `${where}是链接按钮，内容必须以 http:// 或 https:// 开头（现在是「${data.slice(0, 40)}」）`,
          nodeId: node.id,
        });
      }
      if (!label) {
        issues.push({
          severity: 'warning',
          code: 'button-label-empty',
          message: `${where}没有文字，客户端上是个空按钮`,
          nodeId: node.id,
        });
      }
    }
  }

  // 连线：两端节点必须存在，端口必须存在（端口以规范化后的定义为准）
  for (const edge of edges) {
    // 配置 API 边是**伪源**：source === '__config_api__'，它并不指向画布里的某个真实节点，
    // 而是"运行时按绑定边查询配置库后把值注入 target 端口"。因此不能按普通边校验 source，
    // 否则永远报"指向不存在的节点"。
    const isConfigApiEdge = edge.source === '__config_api__' && edge.configApi != null;
    if (isConfigApiEdge) {
      const target = nodeMap.get(edge.target);
      if (!target) {
        issues.push({
          severity: 'error',
          code: 'edge-missing-node',
          message: `连线 ${edge.id} 的目标节点不存在（${edge.target}）`,
          edgeId: edge.id,
        });
        continue;
      }
      continue;
    }

    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) {
      issues.push({
        severity: 'error',
        code: 'edge-missing-node',
        message: `连线 ${edge.id} 指向不存在的节点（${edge.source} → ${edge.target}）`,
        edgeId: edge.id,
      });
      continue;
    }
    const outputIds = new Set((source.data?.outputs ?? []).map((p) => p.id));
    if (edge.sourcePort && !outputIds.has(edge.sourcePort)) {
      issues.push({
        severity: 'error',
        code: 'edge-invalid-source-port',
        message: `连线 ${edge.id} 的起点端口 ${edge.sourcePort} 不存在于节点「${source.data?.label ?? source.id}」`,
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
    const inputIds = new Set((target.data?.inputs ?? []).map((p) => p.id));
    if (edge.targetPort && !inputIds.has(edge.targetPort)) {
      issues.push({
        severity: 'error',
        code: 'edge-invalid-target-port',
        message: `连线 ${edge.id} 的终点端口 ${edge.targetPort} 不存在于节点「${target.data?.label ?? target.id}」`,
        edgeId: edge.id,
        nodeId: target.id,
      });
    }
  }

  /**
   * 重复的命令触发器（2026-10-06 真机）：
   * 两条「收到消息」配同一个命令词 → 机器人对同一条消息**走两条链、回两遍**。
   * 最常见的来源：套了片段（片段**自带**触发器）又自己 add_node 加了一个同命令的触发器 ——
   * 实测那个计划里就带着这种重复（卡片上「10 处提醒」的一部分）。
   */
  const commandTriggers = new Map<string, string[]>();
  for (const node of graph.nodes ?? []) {
    const kind = String(node.data?.nodeKind ?? node.type ?? '');
    if (kind !== 'message_received') continue;
    const cfg = (node.data?.config ?? {}) as Record<string, unknown>;
    if (cfg.match !== 'command') continue;
    const command = String(cfg.command ?? '').trim();
    if (!command) continue;
    const list = commandTriggers.get(command);
    if (list) list.push(node.id);
    else commandTriggers.set(command, [node.id]);
  }
  for (const [command, ids] of commandTriggers) {
    if (ids.length < 2) continue;
    // 只报"多余的那些"：每一条问题都能对应到一个**该删的节点**（第一条是正常的）
    for (const id of ids.slice(1)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-command-trigger',
        nodeId: id,
        message: `命令 /${command} 有 ${ids.length} 个触发器 —— 同一条消息会被处理 ${ids.length} 次（机器人回多遍）。删掉多余的触发器，或改成别的命令词。`,
      });
    }
  }

  // 可达性：从触发器出发，沿**控制流边**走不到的节点永远不会执行。
  // 起点判定必须用 isTriggerLikeNode（画布节点 type 是 canvasNode，领域类型在 data.nodeKind）
  //
  // ⚠️ 2026-09-27 修：这里原来顺着**所有**边（含数据边）走 —— 与上面这行注释
  // （"沿控制流边"）不符。实测后果（`projects/RPG飞书测试`）：
  // 整条战斗链（伤害计算 / 升级判定 / 战斗文案 / **该发出去的那条消息** / 全部存档写入）
  // 只通过数据线连到可达节点，于是被判成"可达" —— 校验器只报 **1** 个不可达节点，
  // 而按运行时口径实际有 **32** 个（漏报 31 个）。
  //
  // 为什么必须只走控制边：运行时是**控制流**驱动的（`FlowInterpreter` 用
  // `findControlNext` 推进），端口值只在节点执行时才写进变量表。
  // 所以"只有数据线连着"≠"会执行" —— **数据线只传值，不驱动执行**。
  const portKindOf = (
    nodeId: string,
    portId: string | undefined,
    side: 'in' | 'out',
  ): string | undefined => {
    if (!portId) return undefined;
    const node = nodeMap.get(nodeId);
    const selfPorts = node?.data as { inputs?: Port[]; outputs?: Port[] } | undefined;
    const selfKind = (side === 'out' ? selfPorts?.outputs : selfPorts?.inputs)?.find(
      (p) => p.id === portId,
    )?.kind;
    if (selfKind) return selfKind;
    const spec = findSpec(node?.data?.nodeKind ?? '');
    const specPorts = (side === 'out' ? spec?.outputs : spec?.inputs) as Port[] | undefined;
    return specPorts?.find((p) => p.id === portId)?.kind;
  };
  /**
   * 是不是控制边。
   *
   * 任一侧能解析出 `control` 就算控制边；**两侧都解析不出来时保守当控制边** ——
   * 宁可把"其实没入口"漏报成可达，也不要因为端口定义缺失（旧存档常见）误报一片不可达：
   * 假红比漏报更快让人不再信这个数字。
   */
  const isControlEdge = (edge: NormalizableEdge): boolean => {
    const sKind = portKindOf(edge.source, edge.sourcePort, 'out');
    const tKind = portKindOf(edge.target, edge.targetPort, 'in');
    if (sKind === 'control' || tKind === 'control') return true;
    if (sKind === undefined && tKind === undefined) return true;
    return false;
  };
  const reachable = new Set<string>();
  const queue = nodes.filter((n) => isTriggerLikeNode(n)).map((n) => n.id);
  queue.forEach((id) => reachable.add(id));
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== current) continue;
      if (!isControlEdge(edge)) continue;
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      queue.push(edge.target);
    }
  }
  for (const node of nodes) {
    if (isTriggerLikeNode(node) || reachable.has(node.id)) continue;
    // 分两种说法：用户最容易困惑的是"我明明连线了啊" —— 那是**数据线**，不驱动执行
    const hasAnyIn = edges.some((e) => e.target === node.id);
    issues.push({
      severity: 'warning',
      code: 'unreachable-node',
      message: hasAnyIn
        ? `节点「${node.data?.label ?? node.id}」只有数据线相连、没有任何控制入口，不会被执行（数据线只传值，不驱动执行）`
        : `节点「${node.data?.label ?? node.id}」没有任何入口，不会被执行`,
      nodeId: node.id,
    });
  }

  // 连线层面的规则（必填端口未连 / 孤立节点…）与结构层面的规则**合并成一份结果**：
  // 画布右下角的提示与工具栏的「问题」按钮从此读的是同一个引擎、同一个数字。
  // （历史事故：两个引擎互不包含，同一份流程同屏显示 61 与 43 两个数字。）
  const reported = new Set(issues.map((i) => i.nodeId).filter((id): id is string => !!id));
  for (const issue of collectConnectionIssues(nodes, edges, reported)) {
    issues.push({
      severity: issue.level,
      code: issue.code,
      message: issue.message,
      nodeId: issue.nodeId,
      edgeId: issue.edgeId,
      fixHint: issue.fixHint,
    });
  }

  // 平台能力校验（第 65 批）：节点只能在自己的平台框架里工作，摆错项目里再跑就是
  // 「运行时才发现节点不工作」。这里把它提到校验面板 —— 用户添加时被拦、存盘后能看到
  // 为什么、运行时预检（FlowRuntime.start）再兜一次底。
  // 注意 severity 用 error：它会在预览/运行前被当成阻断项（hasBlockingIssues）。
  if (options.projectPlatform !== undefined) {
    for (const mismatch of findPlatformMismatches(graph, options.projectPlatform)) {
      issues.push({
        severity: 'error',
        code: 'platform-mismatch',
        message: describePlatformMismatch(mismatch),
        nodeId: mismatch.nodeId,
        fixHint: '换成当前平台可用的节点，或把节点移到对应平台的项目里',
      });
    }
  }

  return issues;
}

/** 便捷判断：是否存在阻断运行的问题 */
export function hasBlockingIssues(issues: FlowIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/**
 * 移除校验不通过的连线，并**返回被丢弃的连线**。
 *
 * 用途：替代过去那段"静默清洗"——调用方必须拿到 `dropped` 并记录/提示，
 * 否则用户会看到连线凭空消失（历史事故）。
 */
export function dropInvalidEdges<T extends NormalizableGraph>(
  graph: T,
): { graph: T; dropped: NormalizableEdge[] } {
  const issues = validateFlow(graph);
  const edges = (graph.edges ?? []) as NormalizableEdge[];

  /**
   * 有重复 id 时**不清理**。
   *
   * 这里的删除是"按 id 批量删"：若 id `X` 被两条线共用、其中一条有 error，
   * 两条 X 都会被删掉 —— 一条完全合法的连线会凭空消失（正是原则 2「不做静默清洗」
   * 要防的那种事故）。重复 id 本身已被 `validateFlow` 报成 warning，交给用户去重，
   * 比这里猜"该删哪一条"安全。
   */
  const duplicated = new Set<string>();
  const seen = new Set<string>();
  for (const e of edges) {
    if (!e.id) continue;
    if (seen.has(e.id)) duplicated.add(e.id);
    seen.add(e.id);
  }
  const invalidIds = new Set(
    issues
      .filter((i) => i.severity === 'error' && i.edgeId && !duplicated.has(i.edgeId))
      .map((i) => i.edgeId as string),
  );
  if (invalidIds.size === 0) return { graph, dropped: [] };
  const dropped = edges.filter((e) => invalidIds.has(e.id));
  return { graph: { ...graph, edges: edges.filter((e) => !invalidIds.has(e.id)) } as T, dropped };
}
