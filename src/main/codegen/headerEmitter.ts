// @ts-nocheck
/**
 * 头部生成器 - TypeScript 版本
 * 生成代码头部（导入、docstring 等）和可用工具列表
 */

import type { FlowGraph } from '@shared/types/flow';
import type { ImportCollector } from './typescriptUtils';
import { getNodeRegistry } from '../nodes/registry';

/** H5 工具参数过滤 */
function sanitizeToolArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  return args.filter((a): a is string => typeof a === 'string');
}

/** 生成可用工具列表
 * 根据 graph 中节点的 exposedAsTool 配置生成 _available_tools
 */
export function generateAvailableTools(graph: FlowGraph, errors: string[]): string {
  // 获取节点规格
  let registry: ReturnType<typeof getNodeRegistry> | null = null;
  try {
    registry = getNodeRegistry();
  } catch {
    // registry 未初始化
  }

  const tools = graph.nodes
    .filter((n) => n.data.config?.exposedAsTool === true)
    .filter((n) => {
      if (!registry) return true;
      const spec = registry.find(n.data.nodeKind);
      if (!spec) {
        errors.push(`节点 ${n.id} 非法工具规格: ${n.data.nodeKind}`);
        return false;
      }
      return true;
    })
    .map((n) => {
      const toolName = (n.data.config?.toolName as string | undefined) || n.data.label;
      if (!toolName) {
        errors.push(`节点 ${n.id} 缺少 toolName/label`);
      }
      return {
        kind: n.data.nodeKind,
        toolName: toolName || '',
        toolArgs: sanitizeToolArgs(n.data.config?.toolArgs),
      };
    });

  if (tools.length === 0) {
    return '// 没有可用的 flow AI 工具\nconst _available_tools: Array<any> = []\n';
  }

  // 使用 tsLiteral 生成 JSON 字面量
  const toolsLiteral = JSON.stringify(tools, null, 2);
  return `// 可用的 flow AI 工具\nconst _available_tools = ${toolsLiteral}\n`;
}

/**
 * 核心框架导入（模块 → 具名成员）。
 *
 * ⚠️ 以前这里是 7 行**写死的字符串**，其中 `@qqbot/core` 与 `@qqbot/rule` 各导入了
 * 一遍 `onMessage/onCommand/...` —— 同名从两个模块导入 = 重复标识符，生成的文件
 * 一进 IDE 就报错。现在按模块归并去重，一个模块只出一行 import。
 */
const CORE_IMPORTS: Array<[string, string[]]> = [
  ['@qqbot/core', ['Bot', 'Event', 'MessageEvent', 'GroupMessageEvent', 'PrivateMessageEvent', 'driver', 'onMessage', 'onCommand', 'onNotice', 'onRequest', 'onSchedule', 'onStartup', 'onBotConnect']],
  ['@qqbot/router', ['createRouter']],
  ['@qqbot/middleware', ['cooldown', 'rateLimit', 'permission', 'logger', 'privateOnly', 'groupOnly', 'toMeOnly']],
  ['@qqbot/events', ['ScheduleEvent', 'StartupEvent']],
  ['@qqbot/rule', ['isPrivate', 'isGroup', 'isGuild', 'toMe', 'keyword', 'regex', 'Rule']],
];

/** 生成代码头部
 * 生成 docstring 和 import 语句
 */
export function generateHeader(imports: ImportCollector, customCalls: Set<string>): string {
  const lines: string[] = [];

  // 文件头：**先把这个文件是什么说清楚**。
  //
  // 它**不是可运行代码**：运行时不加载它（`FlowInterpreter` 直接解释 `.qqbat/flow.json`），
  // 它只是「节点顺序 + 配置」的可读快照，供调试、审查与交接。所以：
  //   · 里面的 `sendMessage` / `saveVariable` 等是**占位调用**，没有对应实现；
  //   · 引用的框架包（`@qqbot/*`）在当前仓库里并不存在；
  //   · 表达式与模板**原样展示**（写成注释），不保证是合法 TS。
  // 少了它，一个"大纲"会往 Problems 面板灌几十条错，用户分不清哪条才是真问题。
  lines.push('// @ts-nocheck');
  lines.push('/**');
  lines.push(' * QQ Bot 流程快照 —— **只读大纲，不是可运行代码**');
  lines.push(' *');
  lines.push(' * 运行时不加载本文件（解释器直接读 .qqbat/flow.json），');
  lines.push(' * 这里只保留一份可读的节点顺序与配置，供调试 / 审查 / 交接。');
  lines.push(' * 占位调用（sendMessage / saveVariable …）与 @qqbot/* 包都是示意，不参与编译。');
  lines.push(' */');
  lines.push('');

  // 基础导入
  lines.push('import { randomUUID } from "crypto";');

  // 核心框架导入（按模块归并去重，见 CORE_IMPORTS 的说明）
  const byModule = new Map<string, string[]>();
  for (const [mod, names] of CORE_IMPORTS) {
    const list = byModule.get(mod) ?? [];
    for (const n of names) if (!list.includes(n)) list.push(n);
    byModule.set(mod, list);
  }
  for (const [mod, names] of byModule) {
    lines.push(`import { ${names.join(', ')} } from "${mod}";`);
  }

  // 追加收集到的 import 语句。
  // emitBuiltinCall 会为「无自定义发射器」的节点注册 `import { x } from '...'` 形式，
  // 旧实现忽略了 imports 收集器，导致这些 handler 在生成代码里没有导入（符号无法解析）。
  // 这里同样按模块归并去重：同一模块被多次 add 时不再重复出 import 行。
  const collected = new Map<string, string[]>();
  for (const imp of imports.toArray()) {
    if (!imp.startsWith('import ')) continue;
    const m = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?$/.exec(imp.trim());
    if (!m) {
      lines.push(imp);
      continue;
    }
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const list = collected.get(m[2]) ?? [];
    for (const n of names) if (!list.includes(n)) list.push(n);
    collected.set(m[2], list);
  }
  for (const [mod, names] of collected) {
    lines.push(`import { ${names.join(', ')} } from "${mod}";`);
  }

  lines.push('');

  // 添加自定义调用导入
  for (const fn of customCalls) {
    lines.push(`import { ${fn} } from "@/custom";`);
  }

  lines.push('');

  return lines.join('\n');
}