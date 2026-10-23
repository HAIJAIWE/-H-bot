// src/shared/nodes/varRef.ts
//
// 命名变量的**键格式**：单一来源。
//
// ## 为什么需要它
//
// 引擎里"取一个值"有三条通道，历史上各自发明了键格式，于是同一个变量在三处写法不同：
//
// | 通道 | 键格式 | 谁在用 |
// | --- | --- | --- |
// | 节点输出端口 | `<节点id>:<端口id>` | 数据边、`whereParamRef` |
// | 命名变量 | `__var__:<名>` | `variable_set` / `wait_input` / 子流程参数 写入，`ExecContext` 读取 |
// | 表达式里的引用 | 变量名当 JS 形参名（**没有冒号**） | `safeEval`（见 `safeEval.ts` 的别名层） |
//
// 前两行是**存储键**，第三行是**用户写法**。把存储键的构造与解析收在这里，
// 是为了避免"某一处少写/多写了 `__var__:` 前缀"这类静默失配 —— 那类 bug 不报错，
// 只是值取不到（分支走错、模板留空），排查成本极高。
//
// ⚠️ 这不是抽象层，故意做得很小：只有前缀、构造、判定、解析四件事。
// 别在这里加作用域/类型/求值逻辑 —— 那些分别属于 `ExecContext`、节点目录和 `safeEval`。

/** 命名变量在 `ctx.variables` 里的键前缀 */
export const NAMED_VAR_PREFIX = '__var__:';

/**
 * 配置绑定（`ConfigApiBinding.whereParamRef`）里代表"命名变量空间"的**伪节点 id**。
 *
 * 为什么用伪节点而不是给 `whereParamRef` 加一个 `varName` 字段：
 * 该结构已经支持字面量与 `<节点id>:<端口id>` 两种来源，再加一个字段就变成三态联合，
 * 而它在 `flow.json` 里是**已落盘的数据**（真机 11 条绑定在用）—— 改形状要迁移。
 * `__var__:<名>` 只是把已有的"节点:端口"寻址**复用**到命名变量空间上，零新增概念。
 *
 * 不会与真实节点 id 相撞：节点 id 由 `createNode` 生成（`node-`/`action-` 前缀或 uuid），
 * 不以 `__` 开头。
 */
export const NAMED_VAR_REF_NODE = '__var__';

/** 变量名 → 存储键 */
export function namedVarKey(name: string): string {
  return NAMED_VAR_PREFIX + name;
}

/** 存储键 → 变量名（非命名变量键时返回 null） */
export function namedVarNameOf(key: string): string | null {
  if (!key.startsWith(NAMED_VAR_PREFIX)) return null;
  const name = key.slice(NAMED_VAR_PREFIX.length);
  return name ? name : null;
}

/** 判断一个 `ctx.variables` 的键是不是命名变量 */
export function isNamedVarKey(key: string): boolean {
  return key.startsWith(NAMED_VAR_PREFIX) && key.length > NAMED_VAR_PREFIX.length;
}

/**
 * 解析 `whereParamRef` 指向的存储键。
 *
 * - `{ nodeId: '__var__', portId: 'lv' }` → `__var__:lv`（命名变量）
 * - `{ nodeId: 'rpg_enc', portId: 'result' }` → `rpg_enc:result`（节点输出端口）
 * - 缺 `nodeId`/`portId` → `null`（调用方应视为"没配来源"，而不是去猜一个）
 */
export function refToVarKey(
  ref: { nodeId?: unknown; portId?: unknown } | null | undefined,
): string | null {
  const nodeId = typeof ref?.nodeId === 'string' ? ref.nodeId : '';
  const portId = typeof ref?.portId === 'string' ? ref.portId : '';
  if (!nodeId || !portId) return null;
  return nodeId === NAMED_VAR_REF_NODE ? namedVarKey(portId) : `${nodeId}:${portId}`;
}

/** `whereParamRef` 的对象形式（与 `ConfigApiBinding` 保持一致，避免循环依赖） */
export interface ParamRefLike {
  nodeId?: unknown;
  portId?: unknown;
  literalValue?: unknown;
}

/**
 * 这个 `whereParamRef` 是不是指向命名变量？
 *
 * UI 用它决定"选中的是变量还是端口"（两者的提示文案与作用域校验不同）。
 */
export function isNamedVarRef(ref: ParamRefLike | null | undefined): boolean {
  return ref?.nodeId === NAMED_VAR_REF_NODE;
}

/**
 * `whereParamRef` → 下拉框选项值（`'__var__:lv'` / `'rpg_enc:result'`）。
 *
 * UI 侧**必须**用它来拼字符串，不要自己写模板字面量：选项值是"用户选了什么"的编码，
 * 它和上面 `refToVarKey` 的存储键是同一套语法。两边各拼一次，就会出现
 * "面板里存进去的是 A、运行时读的是 B"这种静默失配。
 */
export function refToOptionValue(ref: ParamRefLike | null | undefined): string {
  const nodeId = typeof ref?.nodeId === 'string' ? ref.nodeId : '';
  const portId = typeof ref?.portId === 'string' ? ref.portId : '';
  if (!nodeId || !portId) return '';
  return `${nodeId}:${portId}`;
}

/** 下拉框选项值 → `whereParamRef`（`refToOptionValue` 的逆运算） */
export function optionValueToRef(value: string): { nodeId: string; portId: string } | null {
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const nodeId = value.slice(0, idx);
  const portId = value.slice(idx + 1);
  if (!portId) return null;
  return { nodeId, portId };
}

/**
 * 表达式节点里**不是变量**的配置键。
 *
 * `expression_eval` 的端口是**动态的**（按公式名/用户命名生成，目录里只声明了
 * `expression` / `variables_json`），所以"哪些 kwargs 键是变量"没法查目录，只能排除法：
 * 除了这些配置键与 `__` 前缀的内部键，其余都当变量（见 `handlerRegistry.mergePortVars`）。
 *
 * ⚠️ 放这里（而不是留在 `handlerRegistry` 里）是因为它同时是**界面契约**：
 * 「可用的变量名」清单（`renderer/lib/expression/expressionVars.ts`）必须用同一份排除表，
 * 否则界面会把 `mode` 列成一个可用变量，而用户在表达式里写 `mode` 其实什么也读不到 ——
 * 更糟的是 `get(mode,"x",1)` 会拿到字符串 `"single"` 而不报错
 * （用户以为在读数据、其实在读自己的配置）。
 */
export const EXPRESSION_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'mode',
  'expression',
  'formulas',
  'variables_json',
  'variables',
]);

/**
 * 解析子流程定义（`subflow_defined`）的 `config.params` → 参数名列表。
 *
 * ⚠️ 这个字段在盘上有**两种存法**，调用方只认一种就会静默失效：
 * - **JSON 字符串** —— 面板的参数编辑器（`SubflowParamsEditor`）与 `builtinCatalog`
 *   的 `defaultConfig` 都存这种；
 * - **数组** —— 早期版本/手工编辑的 `flow.json` 里存在。
 *
 * 只判 `Array.isArray` 的代码在真机上**永远走不到**（运行时注入子流程参数时踩过，
 * 见 `FlowInterpreter.execSubflowCall` 的注释）。两种都收，是这里存在的全部理由。
 *
 * 无名的行直接丢掉：没有名字就没有变量可注入。
 */
export function parseSubflowParams(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  for (const item of list) {
    const name = typeof item === 'string' ? item : (item as { name?: unknown } | null)?.name;
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed) names.push(trimmed);
  }
  return names;
}
