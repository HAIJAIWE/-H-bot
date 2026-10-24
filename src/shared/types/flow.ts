// src/shared/types/flow.ts

export type NodeType = 'trigger' | 'action' | 'logic' | 'data' | 'ai' | 'plugin' | 'custom';
export type PortKind = 'control' | 'data';

export interface Port {
  id: string;
  name: string;
  kind: PortKind;
  dataType?: string; // 数据端口类型：string/number/event/...
  required?: boolean; // 是否必填（数据来源区分必填/可选）
  description?: string; // 端口说明（抽屉中展示）
  default?: unknown; // 默认值（未绑定时使用）
  showWhen?: (config: Record<string, unknown>) => boolean; // 条件显示：按节点 config 决定端口是否在流程中显示
}

export interface FlowNodeData {
  label: string;
  nodeKind: string; // 节点规格 key（如 'message_received'、'message_send'）
  systemId?: string; // 所属系统 ID，如 "character"、"battle"
  description?: string; // 节点备注：说明此步骤在业务中的用途（区分同类多个节点）
  config: Record<string, unknown>;
  inputs: Port[];
  outputs: Port[];
  /** 画布折叠/展开状态。UI 临时态，exportGraph 时会剥离，不写入 flow.json */
  expanded?: boolean;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

/**
 * 配置 API 绑定：让节点的数据输入端口直接链接到配置库的某个字段，
 * 代码生成时自动注入隐藏的 database_write 调用。流程中不显示读配置节点。
 *
 * 当 FlowEdge.source === '__config_api__' 时，此边为配置 API 边，
 * configApi 字段描述绑定详情。
 */
export interface ConfigApiBinding {
  table: string; // 配置表名，如 'realms'
  field: string; // 提取字段，如 'name'（query 模式对应 database_write 的 result_field；query_all 模式留空）
  dbPath: string; // 数据库路径，如 'data/config/realms.db'
  where?: string; // WHERE 条件，如 'level_min <= ?'（不含 WHERE 关键字）
  whereParamRef?: {
    // WHERE 参数来源（引用上游节点输出端口，或 literalValue 字面量）
    nodeId: string;
    portId: string;
    /** 字面量模式：直接使用此值作为 WHERE 参数（不需要 nodeId/portId 引用） */
    literalValue?: string | number | boolean | null;
  };
  /**
   * 查询模式：
   * - `query`（默认）= 取**一个字段**的标量（`field` 必填）
   * - `query_row` = 取**一行**（整行对象，`field` 忽略）—— 读怪物/技能一行，一次拿全字段
   * - `query_all` = 取**多行**（数组）
   */
  mode?: 'query' | 'query_row' | 'query_all';
  /**
   * 排序子句（不含 `ORDER BY`）。
   *
   * 写 `RANDOM()` 就是"从表里随机取一行" —— 随机遇怪、随机掉落、随机抽题都靠它。
   * 不写的话 `LIMIT 1` 永远返回第一行（读配置表读到的永远是同一条）。
   * 只放行 `RANDOM()` 与「列名 [ASC|DESC]」，由 `databaseWrite.validateOrder` 校验。
   */
  order?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  // React Flow 兼容字段
  sourceHandle?: string;
  targetHandle?: string;
  // 配置 API 绑定：当 source === '__config_api__' 时此字段必填
  configApi?: ConfigApiBinding;
}

export interface Variable {
  id: string;
  name: string;
  dataType: string;
  defaultValue?: unknown;
  scope: 'global' | 'session';
  /** 变量描述（可选，用于变量面板展示） */
  description?: string;
  /** 来源节点 ID（可选，如 variable_set 节点 id；手动声明的变量无此字段） */
  source?: string;
  /** 来源类型：variable_set 节点 / start_node 参数 / 手动声明 */
  sourceType?: 'variable_set' | 'subflow_param' | 'manual';
}

export interface FlowGraph {
  schemaVersion: string;
  systems: SystemGroup[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: Variable[];
  nodeGroups?: NodeGroup[]; // 节点分组（可选，向后兼容）
  metadata: {
    name: string;
    version: string;
    /**
     * 目标运行时标识。
     *
     * 只有 TS 一种：旧版流程文件里可能残留别的字符串，加载时由 schema 统一归一为
     * `'typescript'`（见 src/main/schemas/flow.ts 的 metadata.runtime）。
     */
    runtime: 'typescript';
    createdAt: string;
    updatedAt: string;
  };
}

/** 节点分组：同组连续节点用可折叠框包裹 */
export interface NodeGroup {
  id: string;
  title: string;
  nodeIds: string[]; // 组内节点 ID 列表（有序）
  collapsed: boolean;
}

export interface SystemGroup {
  id: string; // 系统 ID，如 "character"
  name: string; // 显示名称，如 "角色系统"
  icon: string; // 图标，如 "🧙"
  description: string; // 描述，如 "角色创建、属性查看、升级"
  chainTriggerIds: string[]; // 属于该系统的 message_received 节点 ID 列表
}

/**
 * flow.json 的当前格式版本（**唯一真相**）。
 *
 * 必须与主进程加载判定用的 `CURRENT_SCHEMA_VERSION`（`src/main/services/flow.ts`）相等，
 * 由 `tests/main/services/flow.test.ts` 的门禁守着。
 *
 * 为什么重要（实测踩到）：写入方比读取方旧时，保存出来的是旧版本号，
 * 每次打开项目都会判定"需要迁移" → 多写一份 history 备份 + 原地重写 flow.json
 * （备份内容与现文件只差 schemaVersion 一行）。
 */
export const FLOW_SCHEMA_VERSION = '1.1' as const;

/**
 * @deprecated 使用 NodeSpecV2 代替。此类型仅用于兼容旧代码，将在后续版本移除。
 * 节点规格定义（左栏节点库 + 创建节点 + 校验）
 */
export interface NodeSpec {
  kind: string; // 唯一 key
  type: NodeType;
  label: string;
  group:
    | '触发器'
    | '动作'
    | '逻辑'
    | '数据'
    | '存储'
    | 'AI'
    | '消息'
    | '控制流'
    | '插件'
    | '自定义'
    | '数据源'
    | '上下文'
    | '判断'
    | '计算'
    | '文本'
    | '交互'
    | 'AI 生成';
  icon: string;
  description: string;
  summary?: string; // 节点简短说明（抽屉中展示）
  tags?: string[]; // 标签（抽屉中展示）
  sideEffects?: string[]; // 副作用列表
  /** 平台兼容性：'all'=跨平台（默认）, 'qq'=QQ 官方专属 */
  platform?: 'all' | 'qq';
  defaultConfig: Record<string, unknown>;
  inputs: Port[];
  outputs: Port[];
}
