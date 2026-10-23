// src/renderer/src/lib/flattenTemplate.ts
//
// 「文本模板 → 发消息」折平：把「文本模板」节点的文案搬进下游「发消息」的 text/markdown，
// 并把模板节点连同它的连线一起删掉。
//
// 为什么要有这个（见 docs/ai/pending-design.md D5 第 1 步「回复即模板」）：
// 「发消息」自己就支持 `{var1}~{var4}`，再串一个「文本模板」是**同一语义两处表达**
// （D5 判据 1）。新建指令向导已经不会再产生这种链，但历史图里还留着 ——
// 用户真机图 20 条链，每条都多一个「文本模板」节点（77 节点里有 20 个）。
//
// 铁律：**行为逐字保持**。只搬「文案」与「数据线」，其它配置（mode/target/...）一个字不动；
// 搬不动的（占位符超过 var4、用了命名变量、出口被多处使用……）一律**跳过并说明原因**，
// 不猜、不丢。宁可少折几个，也不能把用户的流程改坏。
import type { FlowNode, FlowEdge } from '@shared/types/flow';
import { isControlEdge } from './executionOrder';
import { t } from '../i18n';

/** 「发消息」上支持 `{varN}` 插值的文案端口（与 builtinCatalog 的 message_send 端口一致） */
const TEXT_PORTS = ['text', 'markdown'] as const;
/** 端口 → 该端口生效的 mode（text 端口在「文本」模式，markdown 在「按钮UI」模式） */
const PORT_MODE: Record<string, string> = { text: 'text', markdown: 'keyboard' };
/** 「发消息」支持的占位符端口；超过这个范围模板就搬不过去 */
const SEND_VAR_PORTS = new Set(['var1', 'var2', 'var3', 'var4']);

export interface FlattenItem {
  /** 要删掉的「文本模板」节点 */
  templateId: string;
  /** 接收文案的「发消息」节点 */
  sendId: string;
  /** 文案搬到哪个端口 */
  port: 'text' | 'markdown';
}

export interface FlattenPlan {
  items: FlattenItem[];
  /** 看起来像但折不了的，附原因（界面上如实说明，不静默跳过） */
  skipped: Array<{ nodeId: string; reason: string }>;
}

/**
 * 扫描全图，列出"可以折平"的「文本模板」。
 *
 * 纯函数，不改任何数据 —— 界面先用它显示"可省 N 个节点"，用户确认后才 `applyFlattenPlan`。
 */
export function planFlattenTemplates(nodes: FlowNode[], edges: FlowEdge[]): FlattenPlan {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const items: FlattenItem[] = [];
  const skipped: FlattenPlan['skipped'] = [];
  const skip = (nodeId: string, reason: string) => skipped.push({ nodeId, reason });

  for (const tpl of nodes) {
    if (tpl.data.nodeKind !== 'format_text') continue;
    const cfg = tpl.data.config;
    const template = String(cfg.template ?? '');
    if (!template.trim()) {
      skip(tpl.id, t('flatten.emptyTemplate'));
      continue;
    }
    // 命名变量（variables_json）折平后无处安放：message_send 只认 var1~var4
    const vjson = cfg.variables_json;
    if (
      vjson !== undefined &&
      vjson !== null &&
      String(vjson).trim() !== '' &&
      String(vjson).trim() !== '{}'
    ) {
      skip(tpl.id, t('flatten.namedVars'));
      continue;
    }
    // 占位符必须落在 var1~var4；var5+ 在「发消息」上没有对应端口
    const over = [...template.matchAll(/\{(\w+)\}/g)]
      .map((m) => m[1])
      .filter((name) => /^var\d+$/.test(name) && !SEND_VAR_PORTS.has(name));
    if (over.length > 0) {
      skip(tpl.id, t('flatten.tooManyVars', { vars: [...new Set(over)].join('/') }));
      continue;
    }

    // 出口：必须恰好一条数据边，且指向「发消息」的文案端口
    const dataOuts = edges.filter((e) => e.source === tpl.id && !isControlEdge(e, nodes));
    if (dataOuts.length !== 1) {
      skip(tpl.id, t('flatten.multipleConsumers', { count: dataOuts.length }));
      continue;
    }
    const out = dataOuts[0];
    const send = byId.get(out.target);
    if (!send || send.data.nodeKind !== 'message_send') {
      skip(tpl.id, t('flatten.notSendNode'));
      continue;
    }
    const port = out.targetPort as FlattenItem['port'];
    if (!(TEXT_PORTS as readonly string[]).includes(port)) {
      skip(tpl.id, t('flatten.notTextPort', { port: out.targetPort }));
      continue;
    }
    if (String(send.data.config.mode ?? 'text') !== PORT_MODE[port]) {
      skip(tpl.id, t('flatten.wrongMode', { mode: PORT_MODE[port] }));
      continue;
    }
    if (String(send.data.config[port] ?? '').trim() !== '') {
      skip(tpl.id, t('flatten.textOccupied'));
      continue;
    }

    // 入口：数据边必须都落在 var1~var4，且下游同名端口还没被占用
    const dataIns = edges.filter((e) => e.target === tpl.id && !isControlEdge(e, nodes));
    const badIn = dataIns.find((e) => !SEND_VAR_PORTS.has(e.targetPort));
    if (badIn) {
      skip(tpl.id, t('flatten.portMissing', { port: badIn.targetPort }));
      continue;
    }
    const occupied = dataIns.find((e) =>
      edges.some((x) => x.target === send.id && x.targetPort === e.targetPort),
    );
    if (occupied) {
      skip(tpl.id, t('flatten.portOccupied', { port: occupied.targetPort }));
      continue;
    }

    items.push({ templateId: tpl.id, sendId: send.id, port });
  }

  return { items, skipped };
}

/**
 * 应用折平计划，返回**新的** nodes / edges（不改入参）。
 *
 * 三件事，除此之外一个字不动：
 * 1. 文案搬到下游「发消息」的文案端口
 * 2. 模板的**入数据边**改指「发消息」的同名端口（var1→var1，不重编号）
 * 3. 控制流把模板摘掉：`前驱 → 模板 → 后继` 变成 `前驱 → 后继`
 *
 * 模板的**出数据边**（`模板.result → 发消息.text`）直接丢弃 —— 文案已经搬过去了。
 */
export function applyFlattenPlan(
  nodes: FlowNode[],
  edges: FlowEdge[],
  plan: FlattenPlan,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (plan.items.length === 0) return { nodes, edges };

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const itemByTemplate = new Map(plan.items.map((i) => [i.templateId, i] as const));

  // 1. 文案：按下游「发消息」聚合（一个发消息只会被一个模板指向，plan 里已保证）
  const textForSend = new Map<string, { port: FlattenItem['port']; template: string }>();
  for (const item of plan.items) {
    const tpl = byId.get(item.templateId);
    if (!tpl) continue;
    textForSend.set(item.sendId, {
      port: item.port,
      template: String(tpl.data.config.template ?? ''),
    });
  }

  const nextNodes = nodes
    .filter((n) => !itemByTemplate.has(n.id))
    .map((n) => {
      const move = textForSend.get(n.id);
      if (!move) return n;
      return {
        ...n,
        data: { ...n.data, config: { ...n.data.config, [move.port]: move.template } },
      };
    });

  // 2. 边：数据入边改指、控制入/出边暂存待重连、其余原样保留
  const nextEdges: FlowEdge[] = [];
  const controlIn = new Map<string, FlowEdge>();
  const controlOut = new Map<string, FlowEdge>();

  for (const e of edges) {
    const targetItem = itemByTemplate.get(e.target);
    const sourceItem = itemByTemplate.get(e.source);
    const control = isControlEdge(e, nodes);

    if (targetItem && !control) {
      // 数据流入模板 → 改指「发消息」的同名端口
      nextEdges.push({ ...e, id: `${e.id}__flat`, target: targetItem.sendId });
      continue;
    }
    if (targetItem && control) {
      controlIn.set(e.target, e);
      continue;
    }
    if (sourceItem && control) {
      controlOut.set(e.source, e);
      continue;
    }
    if (sourceItem) continue; // 模板的出数据边：文案已搬走，丢弃
    nextEdges.push(e);
  }

  // 3. 控制流重连：前驱 → 后继（模板节点被摘掉）
  for (const item of plan.items) {
    const inEdge = controlIn.get(item.templateId);
    const outEdge = controlOut.get(item.templateId);
    // 没有前驱或后继（模板是孤立的/在链尾）→ 不重连，删掉即可
    if (!inEdge || !outEdge) continue;
    nextEdges.push({
      ...inEdge,
      id: `${inEdge.id}__flat`,
      target: outEdge.target,
      targetPort: outEdge.targetPort,
    });
  }

  return { nodes: nextNodes, edges: nextEdges };
}
