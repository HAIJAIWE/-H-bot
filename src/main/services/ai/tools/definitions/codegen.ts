// src/main/services/ai/tools/definitions/codegen.ts
//
// **这一族工具的声明**（2026-10-15 从 registry.ts 拆出来）。
//
// 为什么拆：registry.ts 一度约 1,300 行、超过 fileSize 闸门的 1,200 ——
// 闸门注释里作者自己留了作业：「拆的路径很清楚：把各域声明按域拆出去（已有
// registeredXxxDefinitions 的先例），dispatch 表本身保持一处」。这里就是照那条做的。
//
// 声明与实现分开放：声明是**给模型看的契约**（改文案要过 tool-description-contract 闸门），
// 实现是主进程的行为 —— 两者改动频率不同，混在一个文件里容易互相踩着。
import type { AiToolDefinition } from '@shared/types/ai';

export const CODEGEN_DEFS: AiToolDefinition[] = [
  {
    name: 'generate_code',
    description:
      '把当前流程图导出为 TypeScript 代码快照（src/plugins/generated/flow.generated.ts，仅供调试/审查，运行时不加载）。运行时由 FlowInterpreter 直接解释 .qqbat/flow.json 并按 mtime 热重载，改完流程无需重启机器人。',
    parameters: { type: 'object', properties: {} },
    category: 'mutation',
  },
  {
    name: 'create_ai_node',
    description:
      '创建一个 AI 生成的自定义节点（沙箱 JS；落到 plugins/ai-<packageName>/index.js，自动注册到步骤节点库）。生成前会做 handler 语法校验 + 干跑自检（真跑一次，拦住幻觉 API 与返回结构不符）。**同域的多个节点请传同一个 packageName**，它们会追加进同一个包，而不是各建一个包。' +
      '⚠️ **一个需求只建一个**：能用 new_command / new_lookup / 现成片段解决的，**别再额外建节点**' +
      '（真机踩过：一句「做个 /测试 指令」同时出了 new_command **加** 两个 create_ai_node —— 三份重复实现，白烧轮数）。' +
      '⚠️ 本工具**立即落盘**（不像流程改动那样要等用户确认）—— 回复时要说明「代码已写入 plugins/…」，' +
      '别写成「已加入待确认计划」：那会让用户以为代码也没落地（真机误会过）。',
    parameters: {
      type: 'object',
      properties: {
        funcName: {
          type: 'string',
          description: '节点标识，蛇形命名（小写字母/数字/下划线），如 weather_query',
        },
        label: { type: 'string', description: '节点中文显示名' },
        summary: { type: 'string', description: '30-80字摘要' },
        handler: {
          type: 'string',
          description:
            'JS 函数表达式源码字符串，形如 async (ctx) => { ... }。ctx 提供 { config, inputs, bot, event, projectPath, log, callBuiltin }；沙箱内无 require/process/Buffer，返回对象的 key 需与 outputs 端口 id 一致。',
        },
        inputs: {
          type: 'string',
          description:
            '可选：输入端口 JSON 数组字符串，如 [{"id":"text","name":"文本","kind":"data","dataType":"string"}]；不传则为单个控制端口 in',
        },
        outputs: {
          type: 'string',
          description:
            '可选：输出端口 JSON 数组字符串，如 [{"id":"result","name":"结果","kind":"data","dataType":"string"}]；不传则为单个控制端口 out',
        },
        icon: { type: 'string', description: '可选：节点图标 emoji（默认 🤖）' },
        packageName: {
          type: 'string',
          description:
            '可选：节点包名（一域一包），**安全 ASCII**（小写字母开头，含小写字母/数字/连字符，如 gacha）。同一个功能域的多个节点传同一个包名 → 追加进同一个包；不传则用 funcName（一个节点一个包）。中文只放在 label 上。',
        },
      },
      required: ['funcName', 'label', 'summary', 'handler'],
    },
    category: 'mutation',
  },
];
export const CAPABILITY_DEFS: AiToolDefinition[] = [
  {
    name: 'check_capabilities',
    description:
      '自检**当前机器人实际能用哪些能力**（群管理 / 发消息 / 频道…）。' +
      '官方文档不集中说明能力分级（认证级别、服务范围开关、接口级白名单分散在三处），' +
      '所以只能问机器人自己：本工具全程只发只读 GET，不会改动机器人状态。' +
      '⚠️ 两个前提：① **只适用于官方协议端**（NapCat 这类 第三方桥接实现会回"不适用"）；' +
      '② 需要项目已配置 AppID / AppSecret，且**要十几秒**（逐项实测）—— ' +
      '只在"这个能力到底能不能用"会影响方案时才调。',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
];
export const NODE_EXAMPLE_DEFS: AiToolDefinition[] = [
  {
    name: 'list_node_examples',
    description:
      '查询**自定义节点示例库**：几条「能抄的形状」（最小返回 / 调协议端 API 发消息 / 随机抽卡 / 复用内置节点 / 早返回防炸），' +
      '每条含**完整可运行的 handler 源码** + 端口声明 + 关键点（都过了干跑自检，能直接改）。' +
      '⚠️ 用 create_ai_node 写节点前**先查这里** —— 有相似的照它改，比从零写一次成功率高。' +
      '不传参数返回紧凑列表；传 id 看单条完整源码；传 need（用户那句话）按关键词给最相关的几条。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '可选：示例 id（如 random-pick、send-group-text）' },
        need: { type: 'string', description: '可选：用户需求原文，按关键词匹配最相关的示例' },
      },
    },
    category: 'query',
  },
];
export const TEMPLATE_DEFS: AiToolDefinition[] = [
  {
    name: 'list_templates',
    description:
      '查询**预置片段库**：项目里已经有的 21 条"常见玩法"（签到 / 抽卡 / 商店购买 / 战斗回合 / ' +
      '冷却检查 / 背包 / 排行榜 / 接任务 …），每条含**节点组合与关键配置**，以及"什么时候用、怎么接"。' +
      '⚠️ 搭流程前先查这里 —— 已有套路就照它搭（用户也认识这些套路），别从零推。' +
      '不传参数返回全部 21 条的紧凑列表（name/description/节点序列）；' +
      '传 id 返回单条完整内容（含每个节点的 config 与 usageHint）。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            '可选。片段 id（如 "signin-flow"、"gacha-pull"）。不传则返回全部片段的紧凑列表。',
        },
      },
    },
    category: 'query',
  },
];
