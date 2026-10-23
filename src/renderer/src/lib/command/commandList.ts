// src/renderer/src/lib/command/commandList.ts
//
// 「指令清单」的纯逻辑：把画布拆成"一条指令一行"，供只读清单面板渲染。
//
// 为什么要单独一个 lib：清单里的四列（命令词 / 回复摘要 / 节点数 / 问题数）全部是从图里
// **推导**出来的，没有第二份数据（设计原则 4：同一参数只出现在一个地方）。推导规则写错的
// 表现是"清单和画布说的不是一回事"——把子流程也当指令、问题数算漏、回复取错节点，
// 界面上完全看不出来 —— 所以规则必须可测。
import type { FlowNode, FlowEdge } from '@shared/types/flow';
import { getExecutionChains, isSubflowDefine } from '../canvas/executionOrder';
import { nodeDisplayLabel } from '../node/nodeCatalog';

/** 一条指令的**发布属性**：存在触发器节点的 `config` 上，跟着指令走 */
export interface PanelMeta {
  /** 进不进 QQ 的指令面板 */
  on: boolean;
  /** 面板里的顺序（小的在前）；`null` = 没设，排在设过的后面 */
  order: number | null;
  /** 面板里显示的描述；空 = 用回复摘要兜底 */
  desc: string;
}

/**
 * 读「发布属性」。
 *
 * ⚠️ 这三个键**故意不进目录的 `defaultConfig`** —— 进了 `PropertyDrawer` 就会渲染成字段，
 * 变成"同一参数两处可改"（违反设计原则 4）。它们**只在指令清单面板里**编辑，
 * 所以取值也放在这里，见 `docs/architecture/command-panel-design.md` §三。
 */
export function readPanelMeta(node: FlowNode): PanelMeta {
  const cfg = (node.data.config ?? {}) as Record<string, unknown>;
  const rawOrder = cfg.panel_order;
  return {
    on: cfg.panel_on === true,
    order: typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : null,
    desc: String(cfg.panel_desc ?? '').trim(),
  };
}

/** 清单的一行 = 一条链（一个触发器） */
export interface CommandRow {
  /** 触发器节点 ID（点击跳转用） */
  triggerId: string;
  /** 触发器在画布上的名字 */
  triggerLabel: string;
  /** 命令词（不含 `/`）；不是「指令」触发时为 null */
  command: string | null;
  /** 这一行怎么触发：指令 → `/xx`；其他 → 画布上的节点名 */
  triggerText: string;
  /** 回复摘要：链内**第一个**发消息节点的文案；没有则 null */
  reply: string | null;
  /** 该链的节点数（含触发器） */
  nodeCount: number;
  /** 该链内所有节点的问题数之和 */
  issueCount: number;
  /** 该链读的配置表（去重；空数组 = 没读配置表） */
  configTables: string[];
  /** 是不是子流程定义（不是真指令，清单里排到最后并标注） */
  isSubflow: boolean;
  /** QQ 指令面板的发布属性（挑不挑它、排第几、描述写什么） */
  panel: PanelMeta;
}

/**
 * 取命令词：只有 `message_received` + `match === 'command'` 才算「指令」。
 * 其他触发方式（@机器人 / 关键词 / 正则 / 定时）不是"用户能发的指令"，清单里如实显示节点名。
 *
 * 导出给 `chainShape.ts` 复用：形状重复提示里也要用**同一种**叫法指代一条链，
 * 否则同一张图上"清单叫 /签到、提示叫 收到消息"，用户对不上。
 */
export function readTriggerCommand(node: FlowNode): string | null {
  if (node.data.nodeKind !== 'message_received') return null;
  const cfg = node.data.config;
  if (cfg.match !== 'command') return null;
  const command = String(cfg.command ?? '').trim();
  return command || null;
}

/** 一条链在界面上的叫法：指令用 `/命令词`，其他触发方式用画布上的节点名（当前语言） */
export function triggerDisplayName(trigger: FlowNode): string {
  const command = readTriggerCommand(trigger);
  return command ? `/${command}` : nodeDisplayLabel(trigger);
}

/** 取非空字符串 */
function text(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * 取回复摘要：链内第一个发消息节点**实际要发的内容**。
 *
 * 两种形状都要认 —— 真机实测（用户 20 条链）**全部**是第一种，
 * 只看 `send.text` 会 20 条全显示"没有回复节点"：
 * - `文本模板 → 发消息`：send 自己的 text 为空，文案在上游 `format_text.template`
 * - 文案直接写在 `send.text` 里（「回复即模板」）
 */
function readReply(
  sequence: FlowNode[],
  edges: FlowEdge[],
  nodeById: Map<string, FlowNode>,
): string | null {
  for (const node of sequence) {
    if (node.data.nodeKind !== 'message_send') continue;
    const cfg = node.data.config;
    const port = String(cfg.mode ?? 'text') === 'keyboard' ? 'markdown' : 'text';
    const own = text(cfg[port]);
    if (own) return own;
    // 自己没写文案 → 顺着连到文案端口的数据边找上游文本模板
    const edge = edges.find((e) => e.target === node.id && e.targetPort === port);
    const upstream = edge ? text(nodeById.get(edge.source)?.data.config.template) : '';
    if (upstream) return upstream;
  }
  return null;
}

/**
 * 该链读了哪些配置表。
 * 配置绑定是**伪源边**（`source === '__config_api__'`），它没有源节点，按**目标节点**归属到链上。
 */
function readConfigTables(chainNodeIds: Set<string>, edges: FlowEdge[]): string[] {
  const tables = new Set<string>();
  for (const edge of edges) {
    if (edge.source !== '__config_api__' || !edge.configApi) continue;
    if (!chainNodeIds.has(edge.target)) continue;
    const table = String(edge.configApi.table ?? '').trim();
    if (table) tables.add(table);
  }
  return [...tables];
}

/**
 * 把图拆成清单行。
 *
 * 一条链 = 一个触发器 + 从它出发能走到的所有节点（沿用 `getExecutionChains` 的既有定义，
 * 与大纲面板**同源**，避免出现"清单和大纲对不上"两套说法）。
 * 排序：真指令在前、子流程在后，各自保持图里的先后。
 */
export function buildCommandRows(
  nodes: FlowNode[],
  edges: FlowEdge[],
  nodeIssues: Record<string, string[]> = {},
): CommandRow[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rows = getExecutionChains(nodes, edges).map((chain): CommandRow => {
    const command = readTriggerCommand(chain.trigger);
    const ids = new Set(chain.sequence.map((n) => n.id));
    let issueCount = 0;
    for (const id of ids) issueCount += nodeIssues[id]?.length ?? 0;
    return {
      triggerId: chain.trigger.id,
      triggerLabel: nodeDisplayLabel(chain.trigger),
      command,
      triggerText: triggerDisplayName(chain.trigger),
      reply: readReply(chain.sequence, edges, nodeById),
      nodeCount: chain.sequence.length,
      issueCount,
      configTables: readConfigTables(ids, edges),
      isSubflow: isSubflowDefine(chain.trigger),
      panel: readPanelMeta(chain.trigger),
    };
  });

  // 子流程不是"用户能发的指令"，混在指令里会让人以为指令数对不上
  return [...rows.filter((r) => !r.isSubflow), ...rows.filter((r) => r.isSubflow)];
}

/** 搜索过滤：命令词 / 触发方式 / 回复摘要 任一命中即保留 */
export function filterCommandRows(rows: CommandRow[], query: string): CommandRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.command ?? '', r.triggerText, r.reply ?? ''].some((v) => v.toLowerCase().includes(q)),
  );
}
