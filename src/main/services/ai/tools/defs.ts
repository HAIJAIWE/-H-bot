// src/main/services/ai/tools/defs.ts
//
// **工具定义汇总表**：模型看到的 name / description / parameters 由这里统一给出。
//
// ⚠️ 2026-10-07「一个工具 = 一份声明」迁移完成后，本文件**不再自己声明任何工具**：
// 23 个工具的声明与实现都在 `registry.ts`，这里只做两件事 ——
//   · 把 registry 的各分组聚合进 `ALL_TOOL_DEFINITIONS`（聚合顺序 = 模型看到的顺序）；
//   · 保留**组合类三个**（apply_template / new_command / new_lookup）的声明：它们只走提案路、
//     没有 execute 实现，声明留在这里最清楚（同样由 toolDefinitionDispatchSync 钉住）。
// 加新工具 = 在 registry.ts 加一条，然后在下面对应位置聚合一次。

import {
  registeredBatchDefinitions,
  registeredFileDefinitions,
  registeredGraphEditDefinitions,
  registeredNodeCatalogDefinitions,
  registeredFlowToolDefinitions,
  registeredRunTestDefinitions,
  registeredCodegenDefinitions,
  registeredReadFileDefinitions,
  registeredLogDefinitions,
  registeredCapabilityDefinitions,
  registeredCapabilityDiscoveryDefinitions,
  registeredCapabilityInvokeDefinitions,
  registeredPassthroughDefinitions,
  registeredNodeExampleDefinitions,
  registeredTemplateDefinitions,
} from './registry';
import type { AiToolDefinition, ToolCategory } from '@shared/types/ai';

// ====== 流程操作工具（返回指令，由渲染层执行）—— 声明与实现都在 registry.ts ======

/**
 * 「直接落地」类工具（2026-10-06 新增）。
 *
 * ## 为什么要有这一组（真机："智能体他不会干活"）
 *
 * 在这之前，助手想搭一条"签到指令"只能：读片段 → 读流程 → 查节点目录 → 再一个节点一个节点
 * `add_node` + `connect_nodes`（一条链十几个工具调用）。实测它把 10 轮上限全花在**探索**上，
 * 一次提案都没提出 —— 界面上什么都没发生。
 *
 * 而画布本身早就有一键入口：片段库（21 条现成玩法）与「新建指令」向导。
 * 这两个工具就是把那两段**同一条路**接给助手（渲染层执行时调的是同一个函数）。
 */
const composeToolDefs: AiToolDefinition[] = [
  {
    name: 'apply_template',
    description:
      '套用**预置玩法片段**（片段库里那 21 条：签到 / 抽奖 / 商店购买 / 冷却检查 / 时间格式化…）。' +
      '**搭流程的首选**：一条片段就是一串已经连好线的节点，比手搭十几步可靠得多。' +
      'templateId 必须来自 list_templates（先查再套，不要凭记忆编 id）。',
    parameters: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: '片段 id（list_templates 返回的那个 id 字段）',
        },
      },
      required: ['templateId'],
    },
    category: 'mutation',
  },
  {
    name: 'new_lookup',
    description:
      '**新建一条"查表回复"指令**（等价于界面上的「新建查询」向导）：/命令 + 从配置表里按某字段查一行，' +
      '把结果回给用户。适合"很多条只差数据的技能"—— 100 个技能不用画 100 条链。' +
      '配置表用 list_* 工具/项目文件确认（dbPath 是配置库文件相对项目根的路径）。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令词，如 技能' },
        table: { type: 'string', description: '配置表名（配置库里的 category，如 skills）' },
        dbPath: {
          type: 'string',
          description: '配置库文件相对项目根的路径，如 data/config/skills.db',
        },
        field: { type: 'string', description: '要回给用户的字段（绑定到回复文案的 {var1}）' },
        matchField: {
          type: 'string',
          description: '用哪个字段匹配用户输入（WHERE）；留空取第一行',
        },
        reply: {
          type: 'string',
          description: '回复文案：{var1} = 查到的字段值，{var2} = 用户输入的参数',
        },
      },
      required: ['command', 'table', 'dbPath', 'field', 'reply'],
    },
    category: 'mutation',
  },
  {
    name: 'new_command',
    description:
      '**新建一条"命令词 → 回复"指令**（等价于界面上的「新建指令」向导）：自动铺好触发器 + 发消息两个节点并连好线。' +
      '**搭一条最简单的指令时首选它**，比 add_node + connect_nodes 两步更可靠。' +
      '要记次数/读数据时用 dataMode（increment / read）+ dataKey：dataKey 只能是英文、数字、下划线。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令词，如 签到（不带斜杠）' },
        reply: {
          type: 'string',
          description: '回复文案；记数据时可用 {var1} 显示当前值，如 "已签到 {var1} 次"',
        },
        dataMode: {
          type: 'string',
          enum: ['none', 'increment', 'read'],
          description: 'none = 只回复；increment = 每次 +1 并记到 dataKey；read = 只读取 dataKey 的值',
        },
        dataKey: {
          type: 'string',
          description: '英文/数字/下划线的数据键名，如 score（dataMode 不是 none 时必填）',
        },
      },
      required: ['command', 'reply'],
    },
    category: 'mutation',
  },
];

const flowToolDefs = registeredFlowToolDefinitions();
const nodeCatalogToolDefs = registeredNodeCatalogDefinitions();
const batchToolDefs = registeredBatchDefinitions();
/** 图编辑四件套（声明在 registry.ts，实现同样在那里） */
const graphEditToolDefs = registeredGraphEditDefinitions();
const passthroughToolDefs = registeredPassthroughDefinitions();
const fileToolDefsFromRegistry = registeredFileDefinitions();
const readFileToolDefs = registeredReadFileDefinitions();
const logToolDefs = registeredLogDefinitions();
const templateToolDefs = registeredTemplateDefinitions();
const nodeExampleToolDefs = registeredNodeExampleDefinitions();
const capabilityToolDefs = registeredCapabilityDefinitions();
const capabilityDiscoveryToolDefs = registeredCapabilityDiscoveryDefinitions();
const capabilityInvokeToolDefs = registeredCapabilityInvokeDefinitions();
const runtimeTestToolDefs = registeredRunTestDefinitions();
const codegenToolDefs = registeredCodegenDefinitions();

/** 模型看到的**全部**工具（顺序 = 提示词里的顺序） */
export const ALL_TOOL_DEFINITIONS: AiToolDefinition[] = [
  ...graphEditToolDefs,
  ...composeToolDefs,
  ...flowToolDefs,
  ...nodeCatalogToolDefs,
  ...readFileToolDefs,
  ...batchToolDefs,
  ...passthroughToolDefs,
  ...fileToolDefsFromRegistry,
  ...logToolDefs,
  ...templateToolDefs,
  ...nodeExampleToolDefs,
  ...capabilityToolDefs,
  ...capabilityDiscoveryToolDefs,
  ...capabilityInvokeToolDefs,
  ...runtimeTestToolDefs,
  ...codegenToolDefs,
];

/**
 * 工具的**确认语义**：`query` = 立即执行并把结果回传；`mutation` = 累积成提案、等用户确认。
 *
 * 未命中（名字拼错/工具已删）时按**最保守**处理：当成 `mutation`，绝不立即执行。
 */
export function getToolCategory(toolName: string): ToolCategory {
  return ALL_TOOL_DEFINITIONS.find((t) => t.name === toolName)?.category ?? 'mutation';
}

export function findToolDef(name: string): AiToolDefinition | undefined {
  return ALL_TOOL_DEFINITIONS.find((t) => t.name === name);
}
