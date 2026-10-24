// src/main/codegen/nodeRegistry.ts
// 代码生成用节点注册表 - 映射 nodeKind -> 发射器模块

import type { FlowNode } from '@shared/types/flow';
import type { EmitContext } from './emitters';
import { indentStr, tsLiteral } from './typescriptUtils';

/** 节点发射器规格 */
export interface NodeEmitterSpec {
  /** 节点类型标识 */
  kind: string;
  /** 处理器模块名（对应 builtinHandlers 键名） */
  handlerModule: string;
  /** 导入路径 */
  importPath?: string;
  /** 自定义发射函数（可选，默认使用 emitBuiltinCall） */
  emit?: (node: FlowNode, ctx: EmitContext, indent: number) => string;
  /** 配置 Schema 引用（用于生成期校验） */
  configSchema?: unknown;
  /** 输入端口定义 */
  inputs?: unknown[];
  /** 输出端口定义 */
  outputs?: unknown[];
}

/** 内置节点发射器注册表 */
class NodeEmitterRegistry {
  private specs = new Map<string, NodeEmitterSpec>();

  /** 注册发射器 */
  register(spec: NodeEmitterSpec): void {
    if (this.specs.has(spec.kind)) {
      console.warn(`[NodeEmitterRegistry] 发射器 "${spec.kind}" 重复注册，覆盖旧定义`);
    }
    this.specs.set(spec.kind, spec);
  }

  /** 查找发射器 */
  find(kind: string): NodeEmitterSpec | undefined {
    return this.specs.get(kind);
  }

  /** 获取所有注册的类型 */
  listAll(): NodeEmitterSpec[] {
    return [...this.specs.values()];
  }

  /** 检查是否已注册 */
  has(kind: string): boolean {
    return this.specs.has(kind);
  }
}

/** 全局单例 */
let _emitterRegistry: NodeEmitterRegistry | null = null;

export function getNodeEmitterRegistry(): NodeEmitterRegistry {
  if (!_emitterRegistry) {
    _emitterRegistry = new NodeEmitterRegistry();
    registerBuiltinEmitters(_emitterRegistry);
  }
  return _emitterRegistry;
}

/** 注册所有内置节点发射器 */
function registerBuiltinEmitters(registry: NodeEmitterRegistry): void {
  // ===== 触发器 =====
  registry.register({
    kind: 'message_received',
    handlerModule: 'message_received',
    importPath: '../services/builtinNodes/builtinNodes',
  });

  registry.register({
    kind: 'scheduled',
    handlerModule: 'scheduled',
    importPath: '../services/builtinNodes/builtinNodes',
  });






  // ===== 动作 =====








  // ===== 逻辑 =====
  // branch_switch：catalog 的规范 kind（旧名 switch_case 由 graphPreprocess 迁移而来）。
  // 这里刻意不设自定义 emit —— 控制流结构由 controlFlowEmitter.emitSwitchCase 负责，
  // 它内部会调用 emitNode 取「内置调用」的发射结果；若此处再设 emit 会重复发射 switch。
  // handlerModule 用真实导出名（builtinNodes 导出 switchCase，非 snake_case）。
  registry.register({
    kind: 'branch_switch',
    handlerModule: 'switchCase',
    importPath: '../services/builtinNodes/builtinNodes',
  });

  // 兼容未经迁移的旧 flow.json（graphPreprocess 会把 switch_case 改名为 branch_switch）
  registry.register({
    kind: 'switch_case',
    handlerModule: 'switchCase',
    importPath: '../services/builtinNodes/builtinNodes',
    // 自定义 emit：生成 switch 语句
    emit: emitSwitchCase,
  });

  // wait_input：等待用户输入（catalog 规范 kind）。
  // 跨事件等待（挂起 / 唤醒 / 超时出口）由解释器实现（runtime/FlowInterpreter 的 suspendForWaitInput
  // + runtime/waitRegistry），本表只声明"没能挂起时"的兜底 handler。
  registry.register({
    kind: 'wait_input',
    handlerModule: 'waitInput',
    importPath: '../services/builtinNodes/builtinNodes',
  });


  // message_op：catalog 中的「消息段构造」节点（at/image/face/record/share/music/poke/reply/forward）。
  // 纯构造函数，运行时由 handlerRegistry 分派到 builtinNodes/messageOp（不发送），
  // 输出 segment 供 message_send(mode=segment) 发送。
  registry.register({
    kind: 'message_op',
    handlerModule: 'messageOp',
    importPath: '../services/builtinNodes/messageOp',
    emit: emitMessageOp,
  });




  // ===== 数据/变量 =====









  // ===== AI =====



  // ===== 控制流/高级 =====






  // ===== 其它 =====






  // ===== 自定义 emit 实现（高频核心节点）=====
  registry.register({
    kind: 'variable_set',
    handlerModule: 'variable_set',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitVariableSet,
  });

  registry.register({
    kind: 'variable_persist',
    handlerModule: 'variable_persist',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitVariablePersist,
  });

  registry.register({
    kind: 'message_send',
    handlerModule: 'message_send',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitMessageSend,
  });

  registry.register({
    kind: 'format_text',
    handlerModule: 'format_text',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitFormatText,
  });

  registry.register({
    kind: 'expression_eval',
    handlerModule: 'expression_eval',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitExpressionEval,
  });

  registry.register({
    kind: 'message_recall',
    handlerModule: 'message_recall',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitMessageRecall,
  });

  registry.register({
    kind: 'message_edit',
    handlerModule: 'message_edit',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitMessageEdit,
  });

  registry.register({
    kind: 'group_op',
    handlerModule: 'group_op',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitGroupOp,
  });

  registry.register({
    kind: 'file_operate',
    handlerModule: 'file_operate',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitFileOperate,
  });

  registry.register({
    kind: 'database_write',
    handlerModule: 'database_write',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitDatabaseWrite,
  });

  registry.register({
    kind: 'http_request',
    handlerModule: 'http_request',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitHttpRequest,
  });

  registry.register({
    kind: 'delay',
    handlerModule: 'delay',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitDelay,
  });

  registry.register({
    kind: 'random',
    handlerModule: 'random',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitRandom,
  });

  registry.register({
    kind: 'time_op',
    handlerModule: 'time_op',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitTimeOp,
  });

  registry.register({
    kind: 'list_op',
    handlerModule: 'list_op',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitListOp,
  });


  registry.register({
    kind: 'loop_control',
    handlerModule: 'loop_control',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitLoopControl,
  });

  registry.register({
    kind: 'try_catch',
    handlerModule: 'try_catch',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitTryCatch,
  });

  registry.register({
    kind: 'retry_exec',
    handlerModule: 'retry_exec',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitRetryExec,
  });


  registry.register({
    kind: 'timer',
    handlerModule: 'timer',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitTimer,
  });

  registry.register({
    kind: 'subflow_call',
    handlerModule: 'subflow_call',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitSubflowCall,
  });

  registry.register({
    kind: 'subflow_defined',
    handlerModule: 'subflow_defined',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitSubflowDefined,
  });

  registry.register({
    kind: 'system_log',
    handlerModule: 'system_log',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitSystemLog,
  });

  registry.register({
    kind: 'check_permission',
    handlerModule: 'check_permission',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitCheckPermission,
  });

  registry.register({
    kind: 'agent_chat',
    handlerModule: 'agent_chat',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitAgentChat,
  });

  registry.register({
    kind: 'intent_classify',
    handlerModule: 'intent_classify',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitIntentClassify,
  });

  registry.register({
    kind: 'regex_extract',
    handlerModule: 'regex_extract',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitRegexExtract,
  });

  registry.register({
    kind: 'json_op',
    handlerModule: 'json_op',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitJsonOp,
  });

  registry.register({
    kind: 'llm_chat',
    handlerModule: 'llm_chat',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitLlmChat,
  });

  registry.register({
    kind: 'embedding',
    handlerModule: 'embedding',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitEmbedding,
  });

  registry.register({
    kind: 'persistent_store',
    handlerModule: 'persistent_store',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitPersistentStore,
  });

  registry.register({
    kind: 'query',
    handlerModule: 'query',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitQuery,
  });







  registry.register({
    kind: 'memory_op',
    handlerModule: 'memory_op',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitMemoryOp,
  });

  registry.register({
    kind: 'parallel_exec',
    handlerModule: 'parallel_exec',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitParallelExec,
  });



  registry.register({
    kind: 'get_context',
    handlerModule: 'get_context',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitGetContext,
  });

  registry.register({
    kind: 'error_op',
    handlerModule: 'error_op',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitErrorOp,
  });


  registry.register({
    kind: 'api_call',
    handlerModule: 'api_call',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitApiCall,
  });



  registry.register({
    kind: 'variable_merge',
    handlerModule: 'variable_merge',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitVariableMerge,
  });

  registry.register({
    kind: 'on_ready',
    handlerModule: 'on_ready',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitOnReady,
  });

  registry.register({
    kind: 'on_startup',
    handlerModule: 'on_startup',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitOnStartup,
  });

  registry.register({
    kind: 'on_request',
    handlerModule: 'on_request',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitOnRequest,
  });

  registry.register({
    kind: 'on_notice',
    handlerModule: 'on_notice',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitOnNotice,
  });

  registry.register({
    kind: 'on_button_click',
    handlerModule: 'on_button_click',
    importPath: '../services/builtinNodes/builtinNodes',
    emit: emitOnButtonClick,
  });
}

/** 导出用于测试 */
export function _resetRegistryForTesting(): void {
  _emitterRegistry = null;
}

/** ===== 核心节点自定义 emit 实现 ===== */

/**
 * 把「原样片段」（表达式 / 模板 / SQL / 文本）安全地写成**注释**。
 *
 * ⚠️ 为什么不能直接当语句写：这些片段来自用户配置，是 Python 风格表达式、中文文案或 SQL，
 * 直接拼进代码就是**语法错**。实测：一条 RPG 主线（含 17 个 `expression_eval`）让快照
 * 报出 25 处语法错误，而 `generateCode` 的 `errors` 仍是空的（静默产坏码）。
 * 快照的定位是「只读大纲」，把原文放进注释既保留信息，又不会污染 IDE 的 Problems 面板。
 *
 * 多行片段逐行加前缀，避免第二行裸奔成语句。
 */
function outlineComment(ind: string, label: string, raw: unknown): string {
  const text = String(raw ?? '');
  const head = `${ind}// ${label}`;
  if (!text.trim()) return head;
  const body = text
    .split(/\r?\n/)
    .map((l) => `${ind}//   ${l}`)
    .join('\n');
  return `${head}\n${body}`;
}

/** 变量设置节点发射器 */
function emitVariableSet(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 var_name / value（旧实现读 config.expression，永远取到默认值）
  const varName = config.var_name || 'temp_var';
  const value = config.value ?? config.expression ?? '';
  return `${outlineComment(ind, `设置变量: ${varName} =`, value)}\n${ind}setVariable(${tsLiteral(varName)}, ${tsLiteral(value)});`;
}

/** 变量持久化节点发射器 */
function emitVariablePersist(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode / key / scope（旧实现读 config.var_name → 每个节点都渲染成 temp_var，
  // 那是**错误信息**，比不渲染更糟）
  const mode = String(config.mode ?? 'load');
  const key = String(config.key ?? '');
  const scope = String(config.scope ?? 'user');
  const label = `持久化: mode=${mode} key=${key || '(批量)'} scope=${scope}`;
  const arg = key ? tsLiteral(key) : '/* keys */ []';
  return `${ind}// ${label}\n${ind}saveVariable(${arg});`;
}

/** 消息发送节点发射器 */
function emitMessageSend(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // 修复：旧实现读的是 config.target/content/at_user，而 catalog 与全部内置模板
  // 用的是 mode/text/markdown/keyboard —— 导致每条 message_send 都退化成字面量
  // "msg.text"。这里按 catalog 的真实键读取。
  const mode = (config.mode as string) || 'text';
  const target = (config.target_type as string) || 'friend';
  const content = (config.text as string) ?? '';
  return `${ind}// 发送消息 (${mode}) to ${target}\n${ind}sendMessage(${tsLiteral(target)}, ${tsLiteral(content)})`;
}

/** 文本格式化节点发射器 */
function emitFormatText(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const template = (config.template as string) || '';
  // 模板是中文文案，直接当语句写就是语法错 —— 放进注释保留原文
  return `${outlineComment(ind, '文本格式化:', template)}\n${ind}formatText(${tsLiteral(template)});`;
}

/** 表达式评估节点发射器 */
function emitExpressionEval(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const mode = String(config.mode ?? 'single');
  const expr = config.expression || '';
  // 表达式是 Python 风格（`clamp(...)` / `A if C else B`），当语句写必错 —— 放进注释
  if (mode === 'formulas' && Array.isArray(config.formulas)) {
    const rows = (config.formulas as Array<{ name?: string; expression?: string }>)
      .map((f) => `${f.name ?? '?'} = ${f.expression ?? ''}`)
      .join('\n');
    return `${outlineComment(ind, '多公式批量计算:', rows)}\n${ind}evalFormulas();`;
  }
  return `${outlineComment(ind, '表达式:', expr)}\n${ind}evalExpression(${tsLiteral(expr)});`;
}

/** 消息撤回节点发射器 */
function emitMessageRecall(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 message_id（旧实现读 msg_id，永远取到空）
  const msgId = (config.message_id as string) || '';
  return `${ind}// 撤回消息: ${msgId}\n${ind}recallMessage(${tsLiteral(msgId)});`;
}

/** 消息编辑节点发射器 */
function emitMessageEdit(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // 修复：catalog 的键是 message_id / new_text（旧实现读 msg_id / new_content）
  const msgId = (config.message_id as string) || '';
  const newContent = (config.new_text as string) ?? '';
  return `${ind}// 编辑消息: ${msgId}\n${ind}editMessage(${tsLiteral(msgId)}, ${tsLiteral(newContent)})`;
}

/** 群组操作节点发射器 */
function emitGroupOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode（旧实现读 op → 渲染成 `undefinedMessage(...)`）
  const mode = String(config.mode ?? '');
  const groupId = String(config.group_id ?? '');
  return `${ind}// 群组操作: mode=${mode}\n${ind}groupOp(${tsLiteral(mode)}, ${tsLiteral(groupId)});`;
}

/** 文件操作节点发射器 */
function emitFileOperate(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode / file_path（旧实现读 op）
  const mode = String(config.mode ?? '');
  const filePath = String(config.file_path ?? '');
  return `${ind}// 文件操作: mode=${mode}\n${ind}fileOperate(${tsLiteral(mode)}, ${tsLiteral(filePath)});`;
}

/** 数据库写入节点发射器 */
function emitDatabaseWrite(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode / table / data / db_path（旧实现读 fields → 永远渲染成 {}）
  const mode = String(config.mode ?? '');
  const table = String(config.table ?? '');
  const data = config.data ?? '';
  return `${ind}// 数据库操作: mode=${mode} table=${table}\n${ind}dbInsert(${tsLiteral(table)}, ${tsLiteral(data)});`;
}

/** HTTP 请求节点发射器 */
function emitHttpRequest(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const method = String(config.method ?? 'GET');
  const url = String(config.url ?? '');
  // 旧实现写成 `${method}(url)` → `GET("...")`：语法合法但是**假代码**（没有 GET 这个函数）
  return `${ind}// HTTP 请求: ${method} ${url}\n${ind}httpRequest(${tsLiteral(method)}, ${tsLiteral(url)});`;
}

/** 延时节点发射器 */
function emitDelay(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // 修复：catalog 的键是 seconds（旧实现读 duration，永远取到默认值）
  const seconds = config.seconds ?? 1;
  return `${ind}// 延时 ${seconds}s\n${ind}await sleep(${seconds} * 1000);`;
}

/** 随机节点发射器 */
function emitRandom(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 min_value / max_value（旧实现读 min/max → 永远渲染成 [0, 100]）。
  // 保留 `Math.random()` 这个形状：它是快照里"随机节点"的可读标志（既有测试也按它断言）
  const min = String(config.min_value ?? 0);
  const max = String(config.max_value ?? 100);
  return `${ind}// 生成随机数 [${min}, ${max}]\n${ind}Math.floor(Math.random() * (${max} - ${min} + 1)) + ${min};`;
}

/** 时间操作节点发射器 */
function emitTimeOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode（旧实现读 op → 渲染成 `undefined("YYYY-MM-DD")`）
  const mode = String(config.mode ?? 'now');
  return `${ind}// 时间操作: mode=${mode}\n${ind}timeOp(${tsLiteral(mode)});`;
}

/** 列表操作节点发射器 */
function emitListOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode（旧实现读 op）
  const mode = String(config.mode ?? 'append');
  return `${ind}// 列表操作: mode=${mode}\n${ind}listOp(${tsLiteral(mode)});`;
}

/** 开关案例节点发射器 */
function emitSwitchCase(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const config = node.data?.config || {};
  const matchVar = config.match_var || 'msg.text';
  // config 来自 flow.json（Record<string, unknown>），此处按 switch 分支的结构断言
  const cases = (config.cases || []) as Array<{ match: string; label: string }>;
  const defaultCase = config.default || 'default';

  let code = `${ind}// 多重判断\n${ind}switch (${matchVar}) {\n`;

  for (const c of cases) {
    const match = c.match;
    const label = c.label;
    if (match === '*') {
      code += `${indBody}default:\n`;
    } else if (match.startsWith('>=') || match.startsWith('<=') || match.startsWith('>') || match.startsWith('<')) {
      code += `${indBody}case (${matchVar} ${match}):\n`;
    } else {
      code += `${indBody}case ${JSON.stringify(match)}:\n`;
    }
    code += `${indBody}  // ${label}\n`;
    code += `${indBody}  break;\n`;
  }

  code += `${indBody}default:\n`;
  code += `${indBody}  // ${defaultCase}\n`;
  code += `${ind}}\n`;

  return code;
}

/**
 * 循环控制节点发射器。
 *
 * ⚠️ 旧实现把模式字面量写成 `' times'` / `' while'` / `' iterate'`（**带前导空格**），
 * 而 catalog 里是 `times`/`while`/`iterate` —— 三个分支永远匹配不上，一律掉进 default，
 * 渲染出 `times(10) { ... }` 这种**语法错**的假代码。这里按真实键与取值重写，
 * 并把"循环体在画布连线上、快照里看不到"如实写出来（不再假装有 body）。
 */
function emitLoopControl(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const config = node.data?.config || {};
  const mode = String(config.mode ?? 'times');
  const hint = `${indBody}// 循环体见画布连线（快照不展开）`;

  switch (mode) {
    case 'times': {
      const count = String(config.max_iterations ?? config.count ?? 10);
      return `${ind}// 循环 ${count} 次\n${ind}for (let i = 0; i < ${count}; i++) {\n${hint}\n${ind}}`;
    }
    case 'while': {
      const condition = String(config.expression ?? config.condition ?? 'true');
      return `${outlineComment(ind, '循环直到条件满足:', condition)}\n${ind}while (/* 见上方条件 */ true) {\n${hint}\n${ind}}`;
    }
    case 'iterate': {
      const list = String(config.list ?? '[]');
      return `${ind}// 遍历列表: ${list}\n${ind}for (const item of ${list}) {\n${hint}\n${ind}}`;
    }
    default:
      return `${ind}// 循环控制: mode=${mode}\n${hint}`;
  }
}

/** Try/Catch 节点发射器 */
function emitTryCatch(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const config = node.data?.config || {};
  const tryBody = config.try_body || '';
  const catchBody = config.catch_body || '';

  return `${ind}try {\n${indBody}${tryBody}\n${ind}} catch (e) {\n${indBody}${catchBody}\n${ind}}`;
}

/** 重试执行节点发射器 */
function emitRetryExec(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const config = node.data?.config || {};
  const maxRetries = config.max_retries || '3';
  const delay = config.delay || '1000';
  const body = config.body || '';

  return (
    `${ind}// 重试执行 (最多 ${maxRetries} 次)\n` +
    `${ind}for (let attempt = 0; attempt < ${maxRetries}; attempt++) {\n` +
    `${indBody}${body}\n` +
    `${indBody}if (attempt < ${maxRetries} - 1) {\n` +
    `${indBody}  await sleep(${delay});\n` +
    `${indBody}}\n` +
    `${ind}}`
  );
}

/** 系统日志节点发射器 */
function emitSystemLog(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const level = String(config.level ?? 'info');
  // message 是用户填的文本，必须当字面量；否则 `console.info(你好)` 是语法错
  const message = String(config.message ?? '');
  const method = ['info', 'warn', 'error', 'debug'].includes(level) ? level : 'log';
  return `${ind}// 系统日志 [${level}]\n${ind}console.${method}(${tsLiteral(message)});`;
}

/** 检查权限节点发射器 */
function emitCheckPermission(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const permission = config.permission || 'send_message';
  return `${ind}// 检查权限: ${permission}\n${ind}checkPermission('${permission}')`;
}

/** 机器人聊天节点发射器 */
function emitAgentChat(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const prompt = config.prompt || '""';
  return `${ind}// 机器人聊天\n${ind}callLLMAgent(${JSON.stringify(prompt)})`;
}

/** 意图分类节点发射器 */
function emitIntentClassify(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const text = config.text || 'msg.text';
  return `${ind}// 意图分类\n${ind}classifyIntent(${text})`;
}

/** 正则提取节点发射器 */
function emitRegexExtract(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const input = config.input || 'msg.text';
  const pattern = config.pattern || '""';
  const group = config.group || '0';
  return `${ind}// 正则提取\n${ind}regexMatch(${input}, ${JSON.stringify(pattern)}, ${group})`;
}

/** JSON 操作节点发射器 */
function emitJsonOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const op = config.op || 'parse';
  const data = config.data || '{}';
  return `${ind}// JSON 操作: ${op}\n${ind}${op}JSON(${data})`;
}

/** LLM 聊天节点发射器 */
function emitLlmChat(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const prompt = config.prompt || '""';
  const model = config.model || 'gpt-3.5-turbo';
  return `${ind}// LLM 聊天 (${model})\n${ind}callLLM(${JSON.stringify(prompt)}, '${model}')`;
}

/** 嵌入节点发射器 */
function emitEmbedding(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // text 是用户填的文本，必须当字面量
  const text = String(config.text ?? '');
  return `${ind}// 计算嵌入\n${ind}getEmbedding(${tsLiteral(text)});`;
}

/** 持久化存储节点发射器 */
function emitPersistentStore(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // catalog 的键是 mode（旧实现读 op）；value 也必须当字面量
  const mode = String(config.mode ?? 'save');
  const key = String(config.key ?? '');
  const value = config.value ?? '';
  return `${ind}// 持久化存储: mode=${mode} key=${key}\n${ind}saveVariable(${tsLiteral(key)}, ${tsLiteral(value)});`;
}

/** 查询节点发射器 */
function emitQuery(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  // ⚠️ 旧实现读 config.type / config.sql（那是已删除的 `sqlite_query` 时代的键），
  // 而现在的 `query` 节点面向配置表/键值存储、**没有 sql 键** —— 于是每张图都渲染出
  // 一句 `SELECT * FROM table`，既是假信息、又被当语句写（语法错）。这里按真实配置渲染成注释。
  const mode = String(config.mode ?? 'list');
  const detail = [
    config.key_pattern ? `key_pattern=${config.key_pattern}` : '',
    config.scope ? `scope=${config.scope}` : '',
    config.filter_expr ? `filter_expr=${config.filter_expr}` : '',
    config.sort_by ? `sort_by=${config.sort_by}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${ind}// 查询: mode=${mode}${detail ? ' ' + detail : ''}`;
}

/** 表定义节点发射器 */

/** 内存添加节点发射器 */

/** 内存搜索节点发射器 */

/** 内存清除节点发射器 */

/** 内存列表节点发射器 */

/** 内存操作节点发射器 */
function emitMemoryOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const op = config.op || 'get';
  const key = config.key || 'temp';
  return `${ind}// 内存操作: ${op}\n${ind}${op}Memory('${key}')`;
}

/** 并行执行节点发射器 */
function emitParallelExec(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const indBody = indentStr(indent + 1);
  const config = node.data?.config || {};
  const tasks = config.tasks || '[]';
  return `${ind}// 并行执行\n${ind}Promise.all([${tasks}].map(async (task) => {\n${indBody}${indBody}return task;\n${ind}})).then(() => {\n${ind}})`;
}

/** 系统就绪节点发射器 */
function emitOnReady(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  return `${ind}// 机器人就 ready\n${ind}onReady()`;
}

/** 启动节点发射器 */
function emitOnStartup(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  return `${ind}// 机器启动\n${ind}onStartup()`;
}

/** 请求节点发射器 */
function emitOnRequest(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  return `${ind}// HTTP 请求事件\n${ind}onRequest()`;
}

/** 通知节点发射器 */
function emitOnNotice(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  return `${ind}// 收到通知事件\n${ind}onNotice()`;
}

/** 按钮点击节点发射器 */
function emitOnButtonClick(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  return `${ind}// 按钮点击事件\n${ind}onButtonClick()`;
}

/** 定时器节点发射器：对应 builtinNodes.timer(mode, callback, ms) */
function emitTimer(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const mode = config.mode || 'setTimeout';
  const timerId = config.timer_id || '';
  if (mode === 'clearInterval' || mode === 'clearTimeout') {
    return `${ind}// 清除定时器: ${timerId}\n${ind}timer('${mode}', () => {}, 0)`;
  }
  const ms = config.ms || '1000';
  return `${ind}// ${mode} 定时器 (${ms}ms)\n${ind}timer('${mode}', () => {}, ${ms})`;
}

/** 子流程调用节点发射器：对应 builtinNodes.subflowCall(subflowId, input) */
function emitSubflowCall(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const subflowId = config.subflow_id || '';
  // 与 emitters.emitSubflowCall 一致：子流程调用由控制流发射器内联展开，
  // 这里只保留一条可读注释，避免生成未定义的调用。
  return `${ind}// 调用子流程: ${subflowId}`;
}

/** 子流程定义节点发射器：对应 builtinNodes.subflowDefined()（占位实现） */
function emitSubflowDefined(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const subflowId = config.subflow_id || '';
  return `${ind}// 子流程定义: ${subflowId}`;
}

/** 上下文获取节点发射器：对应 builtinNodes.getContext(bot, event, key) */
function emitGetContext(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const key = config.key || '';
  return `${ind}// 获取上下文: ${key}\n${ind}await getContext(bot, event, ${JSON.stringify(key)})`;
}

/** 错误处理节点发射器：对应 builtinNodes.errorOp(error, mode) */
function emitErrorOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const mode = config.mode || 'return';
  const message = config.message || '""';
  return `${ind}// 错误处理 (${mode})\n${ind}errorOp(${message}, '${mode}')`;
}

/** API 调用节点发射器：对应 builtinNodes.apiCall(bot, event, url, method, ...) */
function emitApiCall(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const action = config.action || '';
  const params = config.params || '{}';
  return `${ind}// API 调用: ${action}\n${ind}await apiCall(bot, event, ${JSON.stringify(action)}, 'POST', {}, ${params})`;
}

/** 变量合并节点发射器：对应 builtinNodes.variableMerge(bot, event, target, source, mode) */
function emitVariableMerge(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const target = config.target || '""';
  const source = config.source || '""';
  const mode = config.mode || 'merge';
  return `${ind}// 合并变量 (${mode})\n${ind}await variableMerge(bot, event, ${target}, ${source}, '${mode}')`;
}

/** 面板注册节点发射器（声明式节点，无运行时代码） */

/**
 * 消息段构造节点发射器。
 *
 * 与运行时 `builtinNodes/messageOp` 一致：按 segment_type 生成一个消息段对象，
 * 输出到 `segment` 变量供 `message_send(mode=segment)` 使用。
 */
function emitMessageOp(node: FlowNode, ctx: EmitContext, indent: number): string {
  const ind = indentStr(indent);
  const config = node.data?.config || {};
  const segmentType = String(config.segment_type || 'at');
  const fields = [
    'user_id',
    'url',
    'file',
    'face_id',
    'title',
    'content',
    'image_url',
    'music_type',
    'audio_url',
    'singer',
    'message_id',
    'forward_id',
  ];
  const entries = fields
    .filter((key) => config[key] !== undefined && config[key] !== '' && config[key] !== 0)
    .map((key) => `${key}: ${tsLiteral(String(config[key]))}`);

  // 构造参数内联为对象字面量（只包含显式配置过的字段，与运行时的 kwargs 语义一致）
  const args = [`segment_type: ${tsLiteral(segmentType)}`, ...entries].join(', ');
  return (
    `${ind}// 构造消息段: ${segmentType}\n` +
    `${ind}const segment = constructSegment({ ${args} });`
  );
}