// src/shared/nodes/configQueryChain.ts
//
// 「查表 → 执行」标准链的纯逻辑：把「命令词 + 配置表 + 字段」翻译成
// 「收到消息 → 取参数 → 查表后回复」这一条链。
//
// 为什么需要它（见 docs/architecture/large-project-design.md 三、L1）：100 个技能画成 100 条链是
// 500+ 个节点；落成「1 条引擎链 + 100 行数据」才是规模化的出路。这条链就是那个"引擎"。
//
// 与 commandWizard 的关键区别：查表**不是节点**，而是伪源边（`__config_api__`）——
// 它没有源节点，只在插入后拿到目标节点的真实 ID 才能建。所以这里把配置绑定单独放在
// `configApiEdges` 里，用**索引**引用节点，由调用方在插入后翻译成真实 ID。
import type { TemplateEdgeDef, TemplateNodeDef } from './subflowTemplateTypes';
import { normalizeCommand } from './commandChain';

/** 「取参数」节点在 nodes 数组里的下标 */
export const ARG_NODE_INDEX = 1;
/** 「回复」节点在 nodes 数组里的下标（配置绑定与变量都接在它身上） */
export const REPLY_NODE_INDEX = 2;

export interface ConfigQueryInput {
  /** 命令词（可带 `/`） */
  command: string;
  /** 配置表名（配置库里的 category，如 'skills'） */
  table: string;
  /** 配置库文件相对项目根的路径，如 'data/config/skills.db' */
  dbPath: string;
  /** 要显示给用户的字段（绑定到 `{var1}`） */
  field: string;
  /** 用哪个字段匹配用户输入（WHERE）。留空 = 不筛条件，取第一行 */
  matchField: string;
  /** 回复文案：`{var1}` = 查到的字段值，`{var2}` = 用户输入的参数 */
  reply: string;
}

/** 需要由调用方额外创建的配置 API 边（伪源，插入后按索引解析成真实节点 ID） */
export interface ConfigApiEdgeDef {
  /** 目标节点在 nodes 数组中的下标 */
  target: number;
  targetPort: string;
  table: string;
  field: string;
  dbPath: string;
  /** 不含 WHERE 关键字；`?` 的值来自 paramRef */
  where?: string;
  /** WHERE 里 `?` 的取值来源（按索引引用上游节点的输出端口） */
  paramRef?: { node: number; port: string };
}

export interface ConfigQueryChain {
  nodes: TemplateNodeDef[];
  edges: TemplateEdgeDef[];
  configApiEdges: ConfigApiEdgeDef[];
}

/** 就绪判定：命令词 / 配置表 / 字段 / 回复缺一不可（少了任何一个生成的链都是废的） */
export function isConfigQueryReady(input: ConfigQueryInput): boolean {
  return (
    normalizeCommand(input.command).length > 0 &&
    input.table.trim().length > 0 &&
    input.dbPath.trim().length > 0 &&
    input.field.trim().length > 0 &&
    input.reply.trim().length > 0
  );
}

/**
 * 生成节点链。
 *
 * 形状：`收到消息(/技能) → 取参数 → 回复`，外加一条隐藏的配置绑定边：
 *
 * ```
 * 收到消息 ─next→ 取参数 ─out→ 回复           （控制流）
 *                  └─result→ var2            （用户输入的参数，文案里写 {var2}）
 *   配置表(field) ──────────→ var1            （查到的值，文案里写 {var1}）
 * ```
 *
 * 用 `get_context(command_args, index=0)` 而不是直接拿触发器的 `args` 端口：
 * `args` 是**列表**，而配置查询的 WHERE 参数只接受标量（`resolveConfigApiValue` 直接把
 * 端口值 push 进 where_params，塞列表会变成嵌套数组）。
 */
export function buildConfigQueryChain(input: ConfigQueryInput): ConfigQueryChain {
  const command = normalizeCommand(input.command);
  const matchField = input.matchField.trim();

  const nodes: TemplateNodeDef[] = [
    {
      kind: 'message_received',
      config: { match: 'command', message_type: 'any', command, prefix: '/' },
      label: `/${command}`,
    },
    {
      // ⚠️ 2026-10-03：原来生成 `get_context`（已弃用、面板已隐藏）——
      // 拆分成"按数据来源"之后，command_args 属于「当前消息」→ get_message。
      kind: 'get_message',
      // command_args + index 0 = 用户输入的第一个参数（`/技能 火球术` → 火球术）
      config: { mode: 'command_args', index: 0 },
      label: '取参数',
    },
    {
      kind: 'message_send',
      config: { mode: 'text', text: input.reply },
      // 节点标题是**落盘字段**（写进用户的 .qqbat/flow.json，也进生成代码注释），
      // 恒为 zh-CN 规范名；显示由 nodeDisplayLabel() 按当前语言处理。
      // 不能翻译 —— 否则英文界面下建出的链，其标题在中文界面里也还是英文。
      label: '回复',
    },
  ];

  const edges: TemplateEdgeDef[] = [
    { from: 0, fromPort: 'next', to: ARG_NODE_INDEX, toPort: 'in' },
    { from: ARG_NODE_INDEX, fromPort: 'out', to: REPLY_NODE_INDEX, toPort: 'in' },
    // 参数也接进发送节点：文案里可以用 {var2} 回显用户输入（"未找到 xxx" 这类提示要用）
    { from: ARG_NODE_INDEX, fromPort: 'result', to: REPLY_NODE_INDEX, toPort: 'var2' },
  ];

  const configApiEdges: ConfigApiEdgeDef[] = [
    {
      target: REPLY_NODE_INDEX,
      targetPort: 'var1',
      table: input.table.trim(),
      field: input.field.trim(),
      dbPath: input.dbPath.trim(),
      // 没选匹配字段就不带 WHERE：查第一行（"随机抽一条配置"这类用法）
      ...(matchField
        ? { where: `${matchField} = ?`, paramRef: { node: ARG_NODE_INDEX, port: 'result' } }
        : {}),
    },
  ];

  return { nodes, edges, configApiEdges };
}
