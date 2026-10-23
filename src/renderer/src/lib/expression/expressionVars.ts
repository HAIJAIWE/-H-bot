// src/renderer/src/lib/expression/expressionVars.ts
//
// 表达式节点「可用的变量名」—— 纯逻辑，便于单测。
//
// ## 为什么需要它
//
// `expression_eval` 是真机项目里**用得最多的节点**（51 次 / 占全部节点 22%），
// 但它同时是**最不透明**的：表达式里能写哪些名字，取决于"这个节点哪些数据端口
// 连了线、哪些在 config 里有值、当前在哪个子流程、有哪些命名变量"——
// 用户在画布上**看不出**这份清单，只能凭记忆猜 `v1` 还是 `v7`。
// gap-audit §8.2 把这件事记成"该让它变成一等公民（变量补全 / 输入输出可声明 /
// 校验器能读）"，这里做的是第一件：**把清单摆在输入框下面**。
//
// ## 规则必须与运行时一致（否则清单会骗人）
//
// 运行时的取值链（`nodeInputs.resolveInputKwargs` → `handlerRegistry.mergePortVars`）：
//
//  1. 有数据边 → 用上游值（**哪怕值是 null** 也算有值，见 `includeNull`）
//  2. 没数据边 → 用 `config[<端口id>]`
//  3. `mergePortVars` 跳过 `value === undefined` 的键
//
// 所以「端口能不能在表达式里读到」= `连了线 || config 里有这个键`。
// 没连也没配的端口**读不到**（会报 `v3 is not defined`），**故意不列出来** ——
// 列出来等于教用户写一个必然报错的名字。
//
// ⚠️ 「用到了」的判定是**词边界 + 前面不能是小数点**，不解析语法树。
// 于是字符串字面量里的同名文字（`"v1"`）会被算成"用到了"，只影响高亮的观感，
// 不会算错值。真要做精确判定得引 parser，不值当 —— 但这条限制写在这里，别当成没有。

import type { FlowEdge, Variable } from '@shared/types/flow';
import { edgePortId } from '@shared/nodes/connectionIssues';
import { nodeDisplayLabel } from '../node/nodeCatalog';
import type { FlowNode } from '@shared/types/flow';
import { EXPRESSION_CONFIG_KEYS } from '@shared/nodes/varRef';
import { t } from '../../i18n';

export interface ExprVarItem {
  /** 表达式里要写的名字 */
  name: string;
  /** `port` = 本节点的数据端口；`variable` = 命名变量 */
  kind: 'port' | 'variable';
  /** 端口是否连了数据边（false = 靠 config 里的值） */
  bound: boolean;
  /** 来源说明（放在 chip 的 title 上） */
  detail: string;
  /** 表达式里是否用到了它 */
  used: boolean;
}

/** 把名字转义成可以放进正则的字面量 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 表达式里是否**作为独立标识符**用到了这个名字。
 *
 * 前面不允许是标识符字符或 `.`（避免 `row.v1` 里的 `v1` 被算成"用了外层的 v1"），
 * 后面不允许是标识符字符（避免 `value1` 命中 `v1`）。
 */
export function isVarUsed(expression: string, name: string): boolean {
  if (!expression || !name) return false;
  return new RegExp(`(?<![A-Za-z0-9_$.])${escapeRe(name)}(?![A-Za-z0-9_$])`).test(expression);
}

/** 命名变量是否在**当前作用域**里可读（子流程参数只在自己体内可用） */
export function isVarInScope(v: Variable, enclosingSubflowId: string | null): boolean {
  if (v.sourceType !== 'subflow_param') return true;
  return Boolean(v.source) && v.source === enclosingSubflowId;
}

export interface CollectExpressionVarsInput {
  nodeId: string;
  /**
   * 本节点目录里的节点种类。用来决定"配置键要不要排除"：
   * `expression_eval` 的运行时**明确排除** `mode/expression/formulas/...`
   * （见 `EXPRESSION_CONFIG_KEYS`），所以那些键不能算可用变量 ——
   * 列出来用户会写 `mode`，而运行时报的是 `mode is not defined`（或更糟：拿到配置字符串）。
   */
  nodeKind: string;
  /**
   * 本节点的输入端口。调用方一般只传数据端口；这里**再挡一道**
   * （`kind` 有值且不是 `'data'` 就跳过）—— 契约靠调用方遵守过一次就够，
   * 多一道判断的成本是一个 `!==`，收益是控制端口永远不会出现变量清单里。
   */
  dataPorts: Array<{ id: string; name?: string; kind?: string }>;
  config: Record<string, unknown>;
  edges: FlowEdge[];
  /** `namedVariablesOf(allNodes)` 的结果 */
  namedVariables: Variable[];
  /** 当前节点所属子流程（`findEnclosingSubflowId`），不在子流程里传 null */
  enclosingSubflowId: string | null;
  /** 当前表达式文本（用于标记 used） */
  expression: string;
  /** 给命名变量标注来源用的节点表（可选，仅影响 detail 文案） */
  allNodes?: FlowNode[];
}

/** 收集这个表达式节点**能读到**的变量名清单（顺序：先端口后命名变量） */
export function collectExpressionVars(input: CollectExpressionVarsInput): ExprVarItem[] {
  const {
    nodeId,
    nodeKind,
    dataPorts,
    config,
    edges,
    namedVariables,
    enclosingSubflowId,
    expression,
  } = input;
  const items: ExprVarItem[] = [];
  const seen = new Set<string>();

  // `expression_eval` 的运行时把配置键排除在变量表之外 → 清单也必须排除（同一份表）
  const excludeConfigKeys = nodeKind === 'expression_eval';

  // ---- 1. 本节点的数据端口 ----
  //
  // 端口 id 一律走 `edgePortId(e, 'target')`（shared 里那份同时认 `targetPort` 和
  // `targetHandle` 两种形态，见 connectionIssues 的文件说明）。
  //
  // 修的是什么（2026-09-26）：这里原来写 `e.targetPort ?? e.sourceHandle ?? ''` ——
  // 兜底取的是**源**端口。缺 `targetPort` 的边于是拿到一个源端口 id，永不可能等于
  // 本节点的端口 id，结果是"这条边明明连着，变量清单却说没连"。
  // 实测 4 个真实项目的 1217 条边**没有一条**缺 `targetPort`，所以这条是**潜伏**的、
  // 当前不可达；但字段明显取错，且 shared 里已有正确实现，没有理由留着自己的版本。
  const inbound = new Set(
    edges
      .filter((e) => e.target === nodeId && e.source !== '__config_api__')
      .map((e) => edgePortId(e, 'target')),
  );
  for (const port of dataPorts) {
    if (!port.id || port.id.startsWith('__')) continue;
    if (port.kind !== undefined && port.kind !== 'data') continue;
    if (excludeConfigKeys && EXPRESSION_CONFIG_KEYS.has(port.id)) continue;
    const bound = inbound.has(port.id);
    const hasConfig = config[port.id] !== undefined;
    if (!bound && !hasConfig) continue; // 读不到，不列（见文件头）
    if (seen.has(port.id)) continue;
    seen.add(port.id);
    const portLabel = port.name ?? port.id;
    items.push({
      name: port.id,
      kind: 'port',
      bound,
      detail: bound
        ? t('exprVars.portBound', { name: portLabel })
        : t('exprVars.portFromConfig', { name: portLabel }),
      used: isVarUsed(expression, port.id),
    });
  }

  // ---- 2. 命名变量（按作用域过滤） ----
  const byId = new Map((input.allNodes ?? []).map((n) => [n.id, n]));
  for (const v of namedVariables) {
    if (!v.name || seen.has(v.name)) continue;
    if (!isVarInScope(v, enclosingSubflowId)) continue;
    seen.add(v.name);
    items.push({
      name: v.name,
      kind: 'variable',
      bound: true,
      detail: describeNamedVar(v, byId),
      used: isVarUsed(expression, v.name),
    });
  }

  return items;
}

function describeNamedVar(v: Variable, byId: Map<string, FlowNode>): string {
  const from = v.source ? byId.get(v.source) : undefined;
  const label = from ? nodeDisplayLabel(from) : '';
  const base =
    v.sourceType === 'subflow_param'
      ? t('exprVars.subflowParam')
      : v.sourceType === 'variable_set'
        ? t('exprVars.setVar')
        : t('exprVars.manual');
  // 有来源节点就把名字附上（同一个变量名可能来自多个节点，标出来才分得清）
  return label ? `${base} · ${label}` : base;
}

/**
 * 变量名能不能**在表达式里当标识符用**。
 *
 * 判据不是我们自己定的，而是运行时的硬约束：`safeEval` 把变量名当 `new Function` 的
 * **形参名**传进去（`new Function(...varNames, ...)`），并且先按这个正则过滤一遍
 * （`safeEval.ts`：`/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`）。所以：
 *
 * - 名字里有中文/空格/连字符 → 被过滤掉 → 表达式里写它报 `xxx is not defined`
 * - 名字是保留字（`class` / `in` / `new`…）→ `new Function` 直接抛 SyntaxError
 *   → **整个表达式节点失败**（不只是那一个变量读不到）
 *
 * 这正是"重命名"要做校验的原因：把一个端口改成 `血量` 或 `class`，
 * 看起来只是起个名，实际会把节点弄坏，而且报错信息离原因很远。
 */
export function isLegalExprVarName(name: string): boolean {
  return (
    /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !STRICT_RESERVED.has(name) && !HAZARD_NAMES.has(name)
  );
}

/**
 * 严格模式下**不能当形参名**的字（`new Function` 会抛 SyntaxError）。
 *
 * ⚠️ 这张表是**探针实测**出来的，不是照抄"JS 保留字"清单：
 * `tests/renderer/lib/expression/expressionVars.test.ts` 里拿真的
 * `new Function(name, '__in', '"use strict"; return 0')`（**逐字复刻** `safeEval` 的构造方式，
 * 包括那句 `"use strict"` —— 严格模式会额外禁掉一批）逐个试，断言两件事：
 *   1. 表里的每个名字都真的被拒（没有多余的）
 *   2. 语料里凡是真的被拒的，表里都有（没有漏的）
 *
 * 踩过的坑：第一版把 `await` 也列进来了，探针显示它**合法**
 * （`new Function` 建的是非 async 函数，`await` 在那儿只是普通标识符）——
 * 多余的拒绝会让用户白白换名字。改这张表时那条测试会告诉你对错。
 */
const STRICT_RESERVED: ReadonlySet<string> = new Set([
  // 关键字
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  // 严格模式下的保留字 / 受限标识符（探针确认这些在 `"use strict"` 下真的被拒）
  'let',
  'static',
  'yield',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'arguments',
  'eval',
]);

/**
 * 语法上能用、但当了变量名会把表达式**弄坏或弄糊涂**的字。
 *
 * 它们通不过"保留字"那条判据（`new Function` 接受它们），所以必须单独列：
 *
 * - `undefined` / `NaN` / `Infinity`：会**遮住全局**。端口连上值以后，
 *   表达式里写 `get(v1, "x", undefined)` 拿到的默认值就变成"这个端口的值" ——
 *   不报错、结果不对，最难查的那一类。
 * - `__in`：求值器自己注入的辅助函数名（`safeEval` 让 `x in y` 能翻译成 `__in(x,y)`）。
 *   变量占了这个名字会变成**重复形参**，严格模式下整段表达式直接抛 SyntaxError
 *   （`safeEval` 已经为白名单函数防了这个，但那个显式注入的 `__in` 漏了 —— 已一并修掉）。
 */
const HAZARD_NAMES: ReadonlySet<string> = new Set(['undefined', 'NaN', 'Infinity', '__in']);

/** 永远禁止的名字（`__proto__` 会改原型而不是加键，详见 safeEval 的 ALIAS_DENY） */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 重命名失败的原因码（由 UI 翻译，纯逻辑不碰 i18n）。
 *
 * ⚠️ 必须是 **camelCase、不能带连字符**：这些码会被拼成 i18n key
 * （`exprVars.renameError.<code>`），而 i18n 闸门要求 key 只能含字母/数字/点/下划线。
 */
export type VarRenameError =
  'empty' | 'notIdentifier' | 'reserved' | 'unsafe' | 'forbidden' | 'taken' | 'configKey' | 'same';

export interface VarRenameCheck {
  ok: boolean;
  /** `ok: false` 时的原因码 */
  error?: VarRenameError;
}

/**
 * 校验"把变量 `from` 改名为 `to`"是否可行。
 *
 * `taken` 传当前**已被占用的名字**（其它端口 id + 命名变量名）—— 同名会让
 * 变量表里后来者覆盖先到者，用户看到的是"值不对"而不是报错。
 */
export function checkVarRename(opts: {
  from: string;
  to: string;
  taken: Iterable<string>;
  /** 节点种类：`expression_eval` 要额外禁止配置键（运行时把它们排除在变量表外） */
  nodeKind?: string;
}): VarRenameCheck {
  const to = opts.to.trim();
  if (!to) return { ok: false, error: 'empty' };
  if (to === opts.from) return { ok: false, error: 'same' };
  if (FORBIDDEN_NAMES.has(to)) return { ok: false, error: 'forbidden' };
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(to)) return { ok: false, error: 'notIdentifier' };
  if (STRICT_RESERVED.has(to)) return { ok: false, error: 'reserved' };
  if (HAZARD_NAMES.has(to)) return { ok: false, error: 'unsafe' };
  // 配置键在运行时被排除在变量表之外 → 改成这个名字等于把端口变成读不到
  if (
    (opts.nodeKind === undefined || opts.nodeKind === 'expression_eval') &&
    EXPRESSION_CONFIG_KEYS.has(to)
  ) {
    return { ok: false, error: 'configKey' };
  }
  for (const name of opts.taken) {
    if (name === to) return { ok: false, error: 'taken' };
  }
  return { ok: true };
}

/**
 * 把文本里**作为独立标识符**出现的 `from` 换成 `to`。
 *
 * 边界规则与 `isVarUsed` 同一套（前面不能是标识符字符或 `.`，后面不能是标识符字符），
 * 所以 `value1`、`row.v1` 都不会被误改。重命名端口时用它改写表达式 ——
 * 改错了的后果是表达式静默算错，所以这条逻辑有专门的用例。
 */
export function renameVarInText(text: string, from: string, to: string): string {
  if (!text || !from || from === to) return text;
  return text.replace(
    new RegExp(`(?<![A-Za-z0-9_$.])${escapeRe(from)}(?![A-Za-z0-9_$])`, 'g'),
    // 用函数形式替换，避免 `to` 里的 `$&` / `$1` 被当成替换模式
    () => to,
  );
}

/**
 * 改写 `formulas`（JSON 字符串或数组两种存法）里所有公式的表达式。
 *
 * 保持原有存法：传进来是字符串就还回字符串（盘上两种都有，见
 * `handlerRegistry.parseFormulas`），不要顺手统一 —— 那会让 diff 里出现无意义的格式变化。
 */
export function renameVarInFormulas(formulas: unknown, from: string, to: string): unknown {
  const rewrite = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list;
    return list.map((f) =>
      f && typeof f === 'object'
        ? {
            ...f,
            expression: renameVarInText(
              String((f as { expression?: unknown }).expression ?? ''),
              from,
              to,
            ),
          }
        : f,
    );
  };
  if (typeof formulas === 'string') {
    try {
      const parsed = JSON.parse(formulas);
      return JSON.stringify(rewrite(parsed), null, 2);
    } catch {
      return formulas; // 坏 JSON 原样留着，不趁重命名顺手"修好"它
    }
  }
  return rewrite(formulas);
}

/**
 * 把变量名插进表达式文本（光标处，且**该加空格就加空格**）。
 *
 * 为什么需要加空格：表达式是代码。在 `v1+v2` 的光标处直接插 `lv` 会得到
 * `lvv1+v2`（一个不存在的变量名），既不报错也看不出来 —— 正是本项目最忌讳的静默错。
 * 前后紧邻标识符字符时补一个空格，插进去的东西就一定是独立的标识符。
 *
 * 纯函数：调用方负责从 textarea 读 `selectionStart/selectionEnd` 并写回选区。
 */
export function insertNameAtCursor(opts: {
  current: string;
  name: string;
  start?: number | null;
  end?: number | null;
}): { next: string; cursor: number } {
  const { current, name } = opts;
  const raw = typeof opts.start === 'number' && opts.start >= 0 ? opts.start : current.length;
  const at = Math.min(raw, current.length);
  // 选中了一段就替换掉它（用户"选中再点变量"的直觉）
  const endRaw = typeof opts.end === 'number' && opts.end >= at ? opts.end : at;
  const to = Math.min(endRaw, current.length);
  const before = current.slice(0, at);
  const after = current.slice(to);
  const needBefore = before !== '' && /[A-Za-z0-9_$]$/.test(before);
  const needAfter = after !== '' && /^[A-Za-z0-9_$]/.test(after);
  const inserted = `${needBefore ? ' ' : ''}${name}${needAfter ? ' ' : ''}`;
  return { next: before + inserted + after, cursor: at + inserted.length };
}
