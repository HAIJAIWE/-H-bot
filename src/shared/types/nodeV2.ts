// src/shared/types/nodeV2.ts

/** 节点类型（扩展自旧 NodeType，加 'custom'） */
export type NodeTypeV2 = 'trigger' | 'action' | 'logic' | 'data' | 'ai' | 'custom';

/**
 * 下拉选项（枚举型 select 字段用）。
 */
export interface FieldOption {
  value: string;
  label: string;
  /** 可选分组：有 group 时按组渲染（组标题分隔），提升多选项可查找性 */
  group?: string;
}

/** 端口类型 */
export interface PortSpec {
  id: string;
  name: string; // 中文显示名
  kind: 'control' | 'data'; // control=控制流三角形, data=数据流圆形
  dataType?: string; // string/number/any/event/list/object/array/boolean/json/datetime
  description?: string; // 端口说明（AI 看）
  required?: boolean; // 数据端口是否必填
  default?: unknown; // 默认值
  // showWhen 是配置面板条件脚本,自由访问 config 任意字段(含嵌套,如 trigger_config.match)
  showWhen?: (config: Record<string, unknown>) => boolean; // 条件显示：按节点 config 决定端口是否在流程中显示
  /**
   * 可选值清单（枚举型配置端口用）。
   * 定义在 `src/shared/nodes/fieldOptions.ts`（单一真相）：属性面板、画布内联卡片
   * 都从**目录端口**读这份 options，不再各自维护一份模式清单。
   */
  options?: readonly FieldOption[];
}

/** handler 执行体引用，解耦 emitter */
export type HandlerRef =
  | { source: 'builtin'; module: string } // 应用内置，如 'message_send'
  /**
   * 自建节点（用户手写 / AI 生成）：以插件包形式提供实现。
   * 插件位于 {project}/plugins/<pluginName>/，节点 kind 为
   * `plugin_<pluginName>_<funcName>`，实现是 PluginNode.handler 函数字符串，
   * 由 runtime/dynamicHandlers 在 vm 沙箱中编译执行。
   */
  | { source: 'plugin'; pluginName: string; funcName: string }
  | { source: 'custom'; funcName: string } // 历史值：用户自定义节点（迁移前为 Python @node）
  | { source: 'ai_generated'; code: string } // 历史值：AI 生成节点（迁移前为内联 Python 代码）
  // 声明性节点：仅作为流程中的结构声明（如 table_define / panel_register），
  // 无运行时 handler；行为由 TS 侧服务（如 panelRegistryService）实现。
  | { source: 'declarative' };

/** 节点规格 v2 — 声明式工具节点 */
export interface NodeSpecV2 {
  kind: string; // 唯一标识
  type: NodeTypeV2;
  label: string; // 中文显示名
  group: string; // 分组（触发器/动作/逻辑/数据/AI/自定义/数据源）
  icon: string; // emoji 图标
  description: string; // 用户看的简短描述

  /** AI 可读字段（中文） */
  summary: string; // 30-80 字，做什么+什么时候用
  sideEffects: string[]; // 副作用标记：message_send/message_recall/api_call/read_db/write_db
  tags: string[]; // 中文标签，便于 AI 检索

  /**
   * 平台兼容性标注（多平台项目过滤可用节点用）。
   * - 'all'：跨平台可用（默认，未标注时视为 'all'）
   * - 'onebot'：OneBot V11/V12 专属（QQ via NapCat/go-cqhttp 等、OneBot V12 协议端）
   * - 'qq'：QQ 官方 Bot API 专属
   * UI 可据此在多平台项目中提示哪些节点仅 QQ 可用，避免用户误用。
   */
  platform?: 'all' | 'onebot' | 'qq';

  /**
   * 节点要求的绑定能力（细粒度，机器可校验；见 shared/domain/common/capabilities.ts）。
   * 例：message_send → ['im.message.send']。缺省表示不限制。
   * 与 platform 并存：platform 只给编辑器画徽标，新增判断一律用 requires。
   */
  requires?: string[];

  /**
   * 执行路径（闸门会校验"声明 == 证据"）：
   * - 'handler'：交给运行期 handler 执行（有 sideEffects 的动作类多为此）
   * - 'interpreter'：由 FlowInterpreter 内建解释（控制流/逻辑类）
   * - 'trigger'：只作为流程入口，不执行
   */
  execution?: 'handler' | 'interpreter' | 'trigger';
  /**
   * 操作对象（防重复闸门用：同一 resource 下的模式集合必须不相交）。
   * 与端口 options 的取值一起定义"这个节点能对什么做什么"，避免两个节点抢同一件事。
   */
  resource?: string;
  /**
   * 模式取舍说明：这个节点为什么这样分模式（给人看的，不参与运行）。
   * 多个节点做相近的事时，用它讲清"什么时候用哪个"。
   */
  modeRationale?: string;
  /** 已弃用标记：条目保留（老 flow.json 的契约），列表类消费者过滤掉（见 nodes/deprecation.ts） */
  deprecated?: unknown;

  /** handler 引用 */
  handler: HandlerRef;

  /** AI 工具暴露控制 */
  exposedAsTool: boolean; // 是否暴露给运行期 AI（默认 false）
  toolName?: string; // AI 看到的工具名（中文）
  toolArgs?: string[]; // 暴露给 AI 的参数白名单（空=全部暴露）

  defaultConfig: Record<string, unknown>;
  /**
   * **无端口**配置字段的可选值清单（枚举型字段用）。
   * 触发器这类节点没有输入端口（上游概念对它不成立），字段选项无法挂在端口上，
   * 但又必须在目录里有一处声明 —— 就写在这里（取值来自 `src/shared/nodes/fieldOptions.ts`）。
   * 有端口的字段请用 `PortSpec.options`。
   */
  configFieldOptions?: Record<string, readonly FieldOption[]>;
  inputs: PortSpec[];
  outputs: PortSpec[];
}

/** 风险等级（由 sideEffects 推断） */
export type RiskLevel = 'low' | 'high';

/** 高风险副作用集合 */
export const HIGH_RISK_SIDE_EFFECTS = new Set([
  'message_send',
  'message_recall',
  'api_call',
  'write_db',
  'file_write',
]);

/** 根据 sideEffects 推断风险等级 */
export function inferRiskLevel(sideEffects: string[]): RiskLevel {
  return sideEffects.some((s) => HIGH_RISK_SIDE_EFFECTS.has(s)) ? 'high' : 'low';
}

/** 字段验证器接口 */
export interface FieldValidator {
  validate: (value: unknown, config: Record<string, unknown>) => ValidationResult;
  message: string;
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  message?: string;
  severity: 'error' | 'warning';
}
