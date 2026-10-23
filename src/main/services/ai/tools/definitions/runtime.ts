// src/main/services/ai/tools/definitions/runtime.ts
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

export const RUNTIME_TEST_DEFS: AiToolDefinition[] = [
  {
    name: 'run_test',
    description:
      '**跑一次测试**：往正在运行的机器人注入一条测试消息（例如 /签到），等几秒后把这段时间的运行日志交回来。' +
      '**改完流程后自验的第一选择** —— 你搭的链到底能不能跑、机器人回了什么，看这里。' +
      '⚠️ 它会**真的执行流程**（可能写项目数据），不是只读操作。机器人必须先 run_bot 起来。',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '要注入的消息，例如 /签到（带命令词才会触发流程）',
        },
        chatType: {
          type: 'string',
          enum: ['group', 'private'],
          description: '群聊还是私聊，默认群聊',
        },
        chatId: { type: 'number', description: '群号/用户号；不填用测试占位值' },
        waitMs: { type: 'number', description: '等多久收日志（毫秒，默认 3000，最多 10000）' },
      },
      required: ['message'],
    },
    category: 'query',
  },
];
export const BATCH_DEFS: AiToolDefinition[] = [
  {
    name: 'begin_batch',
    description:
      '开始一个事务性 batch 操作。在开始批量修改流程前调用，这样后续任何写操作失败时系统能自动回滚到当前状态',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
  {
    name: 'commit_batch',
    description:
      '提交当前 batch 操作。在所有流程修改完成后调用，确认修改生效。如果在 30 秒内没有提交，系统将自动提交',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
  {
    name: 'rollback_batch',
    description: '回滚当前 batch 操作。放弃本次 batch 中的所有修改，恢复到 begin_batch 时的状态',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
];
export const PASSTHROUGH_DEFS: AiToolDefinition[] = [
  {
    name: 'run_bot',
    description:
      '启动机器人进程。**异步生效** —— 返回「操作已提交」只代表指令已下达，' +
      '是否真的起来要用 read_logs 确认（连接失败、缺依赖都在日志里）。' +
      '⚠️ 手上还没有可跑的东西（流程是空的、节点没接好）时**别启动** —— 只会白跑一轮。',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
  {
    name: 'stop_bot',
    description: '停止机器人进程。同样异步生效 —— 停止后用 read_logs 确认，不要只看返回值。',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
];
export const LOG_DEFS: AiToolDefinition[] = [
  {
    name: 'read_logs',
    description:
      '读取最近的运行日志（默认 50 行，**真实内容**，来自主进程的运行日志缓冲）。' +
      '**排查「机器人为什么没反应」的第一站** —— 启动失败、节点抛错、翻译器没连上都在这里。' +
      '机器人必须先启动过（run_bot）才有日志。' +
      '⚠️ **一次给足行数**（要看就 lines=200），**别反复读** —— 真机连读 6 次（30→50→50→100→200→50）纯烧轮数。',
    parameters: {
      type: 'object',
      properties: {
        lines: { type: 'number', description: '行数，默认 50' },
      },
    },
    category: 'query',
  },
];
