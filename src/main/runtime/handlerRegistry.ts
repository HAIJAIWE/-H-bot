// src/main/runtime/handlerRegistry.ts
//
// **组合根 + 对外 API**：节点 kind → handler 的那张表在这里被"装起来"，也在这里被查询。
//
// 结构（与 10/18 打包产物一致）：
//   · handlers/registry.ts      —— 注册表本体 + 注册原语（PARAM_KEYS 也在那）
//   · handlers/kwargs.ts        —— kwargs 型 handler 的实现表
//   · handlers/support.ts       —— 实现与登记共用的纯支撑
//   · handlers/registration.ts  —— 各域登记（4 个函数）
//   · 本文件                    —— 按客户端顺序装起来 + getHandler/listHandlers
//
// ⚠️ 本文件**曾经**手写注册表与参数顺序表（PARAM_ORDER），只覆盖 18 个节点；目录里另外
// 22 个（官方能力 7 + 文件 2 + 玩家数据 7 + 时间 3 + 上下文 3）运行期没有 handler ——
// 目录/画布/测试全绿，真跑却是「找不到节点实现」。旧参数表还丢了 agent_chat 的
// mode/history/max_rounds/confirm_high_risk，check_permission 用 permission 而非 role。
// 现在只按客户端顺序调用 handlers/ 下的拆分实现，细节不再从这里绕一圈。

import { getDynamicHandler, listDynamicHandlerKinds, setBuiltinResolver } from './dynamicHandlers';
import { HANDLERS, registerKwargs } from './handlers/registry';
import { KWARGS_HANDLERS } from './handlers/kwargs';
import {
  registerOfficialNodes,
  registerPositionalNodes,
  registerServiceNodes,
  registerTimeNodes,
} from './handlers/registration';
import type { ExecContext } from './ExecContext';

/** 运行时 bot 接口（与 builtinNodes.ts 的 BotInterface 兼容） */
export interface HandlerBot {
  callApi(api: string, params: Record<string, unknown>): Promise<unknown>;
  self_id?: string | number;
  [key: string]: unknown;
}

/** handler 调用上下文 */
export interface HandlerContext {
  projectPath: string;
  ctx: ExecContext;
  event: unknown;
}

/** 统一 handler 签名：handler(bot, event, kwargs, ctx) */
export type RuntimeHandler = (
  bot: HandlerBot,
  event: unknown,
  kwargs: Record<string, unknown>,
  ctx: HandlerContext,
) => unknown;

/** 静态表（收窄 `{}` → `Record` 一次，后面不再逐点断言） */
const table = HANDLERS as unknown as Record<string, RuntimeHandler>;

// ---- 装配：顺序照客户端（`FlowRuntime-LedUoDmO.js` 的 handlerRegistry region）----
//
// 1. 位置参数节点（触发器 / 变量 / 上下文 / 玩家数据…）
// 2. kwargs 型节点（end_node / delay / expression_eval / message_send…）
// 3. 时间节点（time_read / time_check / time_calc）
// 4. 服务节点（数据库 / 文件 / 群操作 / 配置表查询）
// 5. 官方能力（bot_info / 菜单 / 互动 / 战斗面板…）
registerPositionalNodes();
for (const [kind, fn] of Object.entries(KWARGS_HANDLERS)) {
  registerKwargs(kind, fn as unknown as RuntimeHandler);
}
registerTimeNodes();
registerServiceNodes();
registerOfficialNodes();

/**
 * `getHandler` 返回的可调用形状。
 *
 * 每个节点返回自己的结构（`{ success, error }` / `{ result }` / …），调用方按记录读取字段，
 * 解释器拿到后再按输出端口分发（见 `FlowInterpreter.assignOutputs`）。
 * 内部注册表仍用 `RuntimeHandler`（返回 `unknown`）约束实现 —— 实现允许返回任意形状。
 */
export type CallableHandler = (
  bot: HandlerBot,
  event: unknown,
  kwargs: Record<string, unknown>,
  ctx: HandlerContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * 查找 handler。
 *
 * 先查内置静态表；未命中时回退到动态（沙箱）handler —— 用户/AI 自建节点
 * 以插件包形式提供 `async (ctx) => {...}` 实现，由 dynamicHandlers 编译注册。
 */
export function getHandler(nodeKind: string): CallableHandler | null {
  return (table[nodeKind] ?? getDynamicHandler(nodeKind) ?? null) as CallableHandler | null;
}

// 向沙箱暴露「调用内置节点」的能力：自建节点 handler 里的 ctx.callBuiltin(kind, kwargs)。
// 只解析静态内置表 —— 不含动态 handler，避免递归。
setBuiltinResolver((kind: string) => table[kind] ?? null);

/** 列出所有已注册 handler（含动态注册的自建节点） */
export function listHandlers(): string[] {
  return [...Object.keys(table), ...listDynamicHandlerKinds()];
}
