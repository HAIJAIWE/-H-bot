// src/renderer/src/components/blocks/configFieldModel.ts
//
// 属性面板的"字段模型"：把一个节点的 defaultConfig 展开成可渲染的字段列表，
// 并标注每个字段在当前配置下是否**适用**（供面板决定显隐）。
//
// 抽成独立模块是为了两件事：
//   1. 可被单元测试直接覆盖（属性面板组件本身依赖大量 UI 上下文，测起来很重）；
//   2. 显隐判定只有一处实现 —— 组件的渲染分支不再各写一套 if。
import type { NodeSpecV2, PortSpec } from '@shared/types/nodeV2';
import { isConfigFieldVisible, isPortApplicable } from '@shared/nodes/fieldVisibility';
import { getNodeInputDescriptions } from './propertyDrawerConstants';
import { fieldHint } from '../../i18n/fieldLabels';

/** 目录条目（渲染层用的是 `NodeSpec`，字段只用到 inputs/defaultConfig） */
type SpecLike = Pick<NodeSpecV2, 'inputs' | 'defaultConfig'>;

/**
 * 配置字段级显隐（按节点 kind）。
 *
 * ## 为什么需要这张表（D1：触发器 7 个框 → 2~4 个框）
 *
 * 其余判定都基于**端口**的 `showWhen`。但触发器这类节点的配置项（`match`/`command`/
 * `keywords`/`pattern`…）**没有对应的输入端口** —— 触发器没有上游，加数据输入端口在语义上
 * 是错的。于是查不到 `showWhen`，判定退回"永远显示"：`message_received` 的 7 个字段全堆着
 * （用户实测："选择框出现太多了，完全不知道怎么设计这个节点是干啥的"）。
 *
 * 过渡说明：规则最终应落到目录（`builtinCatalog.ts` 的 `configFieldShowWhen` 字段），
 * 使目录保持"唯一 spec 来源"；当前先集中在这一处，时机成熟再迁移。
 */
const CONFIG_FIELD_SHOW_WHEN: Record<
  string,
  Record<string, (config: Record<string, unknown>) => boolean>
> = {
  message_received: {
    command: (c) => c.match === 'command',
    prefix: (c) => c.match === 'command',
    keywords: (c) => c.match === 'keyword',
    pattern: (c) => c.match === 'regex',
    flags: (c) => c.match === 'regex',
  },
  message_send: {
    text: (c) => (c.mode ?? 'text') === 'text',
    segments: (c) => c.mode === 'segment',
    messages: (c) => c.mode === 'forward',
    user_id: (c) => c.mode === 'forward',
  },
};

/**
 * 节点配置字段的**分组**（只给"组装器"类节点用：字段是真实存在的十几种内容，平铺一屏看不过来）。
 *
 * 为什么放在渲染层而不是目录：与 CONFIG_FIELD_SHOW_WHEN 同样的过渡理由（目录应保持唯一 spec 来源，
 * 但当前先集中在这一处）。**覆盖性由测试守住**：表里必须包含该节点的每一个 defaultConfig 键，
 * 否则测试变红（防止加了字段却忘了给它分组）。
 *
 * 效果：`拼装消息`（14 项）与 `战斗面板`（17 项）在面板上从"一列平铺"变成"4~6 组"，
 * 每组一行小标题。**不改变控件本身**（绑定 / 校验 / i18n 全部复用）—— 只加标题行。
 */
export const CONFIG_FIELD_SECTIONS: Record<string, Record<string, string>> = {
  message_compose: {
    layout: 'drawer.secComposeLayout',
    title: 'drawer.secComposeTitle',
    title_level: 'drawer.secComposeTitle',
    subtitle: 'drawer.secComposeTitle',
    body: 'drawer.secComposeTitle',
    quote: 'drawer.secComposeTitle',
    stats: 'drawer.secComposeStats',
    bars: 'drawer.secComposeStats',
    items: 'drawer.secComposeList',
    empty_text: 'drawer.secComposeList',
    page: 'drawer.secComposeList',
    page_size: 'drawer.secComposeList',
    page_command: 'drawer.secComposeList',
    paging_json: 'drawer.secComposeList',
    buttons: 'drawer.secComposeButtons',
    buttons_json: 'drawer.secComposeButtons',
    inline_commands: 'drawer.secComposeButtons',
    footer: 'drawer.secComposeFooter',
    max_length: 'drawer.secComposeFooter',
  },
  // 一下四个是"字段多但没到要拆"的节点（表达式求值 18 个可见洞、数据库操作 15、查配置表 15、HTTP 13）——
  // 用分组压住：v1..v11 这种天然成组的东西不再平铺 11 行。
  expression_eval: {
    mode: 'drawer.secMode',
    expression: 'drawer.secExpression',
    v1: 'drawer.secVars',
    v2: 'drawer.secVars',
    v3: 'drawer.secVars',
    v4: 'drawer.secVars',
    v5: 'drawer.secVars',
    v6: 'drawer.secVars',
    v7: 'drawer.secVars',
    v8: 'drawer.secVars',
    v9: 'drawer.secVars',
    v10: 'drawer.secVars',
    v11: 'drawer.secVars',
    formulas: 'drawer.secAdvanced',
  },
  database_write: {
    mode: 'drawer.secTarget',
    table: 'drawer.secTarget',
    db_path: 'drawer.secTarget',
    data: 'drawer.secWriteData',
    condition: 'drawer.secFilter',
    where_params: 'drawer.secFilter',
    order: 'drawer.secFilter',
    limit: 'drawer.secFilter',
    result_field: 'drawer.secValue',
  },
  config_query: {
    mode: 'drawer.secTarget',
    table: 'drawer.secTarget',
    db_path: 'drawer.secTarget',
    where: 'drawer.secQuery',
    where_params: 'drawer.secQuery',
    order: 'drawer.secQuery',
    limit: 'drawer.secQuery',
    field: 'drawer.secValue',
  },
  http_request: {
    url: 'drawer.secRequest',
    method: 'drawer.secRequest',
    headers: 'drawer.secContent',
    body: 'drawer.secContent',
    timeout: 'drawer.secAdvanced',
    response_format: 'drawer.secAdvanced',
  },
  battle_panel: {
    monster_name: 'drawer.secBattleMonster',
    monster_level: 'drawer.secBattleMonster',
    monster_tag: 'drawer.secBattleMonster',
    monster_hp: 'drawer.secBattleMonster',
    monster_max_hp: 'drawer.secBattleMonster',
    player_name: 'drawer.secBattlePlayer',
    player_hp: 'drawer.secBattlePlayer',
    player_max_hp: 'drawer.secBattlePlayer',
    player_mp: 'drawer.secBattlePlayer',
    player_max_mp: 'drawer.secBattlePlayer',
    round: 'drawer.secBattleProcess',
    log: 'drawer.secBattleProcess',
    actions: 'drawer.secBattleLayout',
    command_prefix: 'drawer.secBattleLayout',
    footer: 'drawer.secBattleLayout',
    bar_width: 'drawer.secBattleLayout',
    max_length: 'drawer.secBattleLayout',
  },
};

/**
 * 按分组**稳定重排**字段（组序 = 该组第一次出现的顺序，组内保持原序）。
 *
 * 为什么必须重排：分组标题是"读到新组就插一行"画出来的 —— 如果同一组的字段在原始顺序里
 * **不连续**（实际就会这样：字段来自"端口 + 配置"两处合并），标题会出现好几次 ✗
 * （渲染层测试抓到过：拼装消息的「标题与正文」出现了 2 次）。
 * 稳定重排之后每组必然连续，标题也就唯一了；没登记分组的字段保持原位。
 */
export function groupFieldsBySection<T extends { key: string }>(
  fields: readonly T[],
  nodeKind: string,
): T[] {
  if (!CONFIG_FIELD_SECTIONS[nodeKind]) return [...fields];
  const order: string[] = [];
  for (const f of fields) {
    const s = sectionOf(nodeKind, f.key);
    if (s && !order.includes(s)) order.push(s);
  }
  const out: T[] = [];
  for (const s of order) {
    for (const f of fields) if (sectionOf(nodeKind, f.key) === s) out.push(f);
  }
  // 没登记分组的字段按原顺序排在最后（不丢、也不错位）
  for (const f of fields) if (!sectionOf(nodeKind, f.key)) out.push(f);
  return out;
}

/**
 * 「这个字段由**专属编辑器**统一管理」—— 通用字段渲染里要 `return null`，否则会重复渲染一份。
 *
 * 为什么抽成表：这 7 条规则原先散在 `PropertyDrawer` 那个 400 行 `.map()` 里，
 * 是 7 个独立的 `if (…) return null`，读起来像"零散的特例"；其实它们是**同一类规则**，
 * 而且和本文件的 `CONFIG_FIELD_SHOW_WHEN` 是同一形态（"某个字段该不该由通用渲染负责"）。
 *
 * 判定前先数过依赖：只用到 node / fieldKey / config 三样（< 10），所以这次能安全搬。
 */
const FIELD_OWNED_ELSEWHERE: Record<string, readonly string[]> = {
  message_compose: ['inline_commands'], // 可点指令编辑器
  expression_eval: ['formulas'], // 公式编辑器
  subflow_call: ['subflow_id'], // 专属子流程下拉（非通用 select）
};

/** 整个节点的字段都归专属编辑器的 kind */
const NODE_OWNED_ELSEWHERE = new Set(['start_node', 'end_node']);

/**
 * 该字段是否由专属编辑器管理（→ 通用渲染应跳过它）。
 *
 * 覆盖：整节点托管（start_node / end_node / 子流程定义）、按 kind 的字段表、
 * 以及 expression_eval 在 formulas 模式下连 expression 也归公式编辑器。
 */
export function isFieldOwnedElsewhere(
  node: { data?: { nodeKind?: string; config?: Record<string, unknown> } } | null | undefined,
  fieldKey: string,
  isSubflow: boolean,
): boolean {
  const kind = node?.data?.nodeKind ?? '';
  if (NODE_OWNED_ELSEWHERE.has(kind)) return true;
  if (isSubflow && fieldKey === 'params') return true; // subflow_defined：只有 params 归参数编辑器（别扩大范围）
  if (kind === 'expression_eval') {
    const mode = String(node?.data?.config?.mode ?? '');
    if (mode === 'formulas' && fieldKey === 'expression') return true;
  }
  return (FIELD_OWNED_ELSEWHERE[kind] ?? []).includes(fieldKey);
}

/** 取某字段所属分组（没登记的节点返回 null = 保持原来的平铺渲染） */
export function sectionOf(nodeKind: string, fieldKey: string): string | null {
  return CONFIG_FIELD_SECTIONS[nodeKind]?.[fieldKey] ?? null;
}

export interface ConfigFieldModel {
  key: string;
  type: string;
  value: unknown;
  required: boolean;
  description: string;
  /** 当前模式是否适用（false = 仅当用户填过值或有校验错时才显示） */
  applicable: boolean;
}

/**
 * 构建字段模型。
 *
 * `applicable` 的判定委托给 `@shared/nodes/fieldVisibility`（唯一真相层）：
 * 端口上没写 showWhen → 显示；showWhen 为真 → 显示；用户填过值或该字段当前报错 → 显示。
 * 端口查不到时（触发器这类无输入端口的节点）回退到 `CONFIG_FIELD_SHOW_WHEN`。
 * 因此隐藏只发生在"默认值 + 当前模式用不上"的字段上，不会把用户填过的参数藏起来。
 */
export function buildConfigFields(
  spec: SpecLike | null | undefined,
  nodeKind: string,
  config: Record<string, unknown>,
): ConfigFieldModel[] {
  if (!spec) return [];
  const inputDescs = getNodeInputDescriptions(nodeKind);
  const portById = new Map<string, PortSpec>((spec.inputs ?? []).map((p) => [p.id, p]));
  const fieldRules = CONFIG_FIELD_SHOW_WHEN[nodeKind];

  return Object.keys(spec.defaultConfig).map((key) => {
    const defaultValue = spec.defaultConfig[key];
    // 只有 defaultConfig 中不存在该 key 时才标记必填（空字符串 = 可选，留空即可）
    const isRequired = defaultValue === undefined;
    const rawValue = config[key];
    const empty = rawValue === undefined || rawValue === null || rawValue === '';
    const port = portById.get(key);
    // 端口优先（目录里声明的 showWhen）；没有端口时用配置字段级规则（触发器/发消息）
    const rule = port ? undefined : fieldRules?.[key];
    const applicable = rule
      ? isConfigFieldVisible({ id: key, showWhen: rule }, config, defaultValue, isRequired && empty)
      : isConfigFieldVisible(port, config, defaultValue, isRequired && empty);
    return {
      key,
      type: typeof defaultValue,
      value: rawValue ?? defaultValue,
      required: isRequired,
      description: inputDescs[key] || fieldHint(key) || '',
      applicable,
    };
  });
}

/**
 * 数据端口是否要在「数据来源」区渲染一行**绑定控件**。
 *
 * 数据来源区曾把每个 data 端口都渲染成绑定行（类型图标 + 端口名 + 手动输入下拉 + 提示），
 * `group_op` 15 个端口就是 15 行；而其中大多数参数在「完整配置」区还有一个值输入框 ——
 * 同一个参数出现两次（用户实测："选择框那么多…专家版我也看不懂"）。
 *
 * 规则：
 *   1. 已绑定上游 → 显示（否则用户看不到、也解不开绑定）；
 *   2. 当前模式用不上 → 不显示；
 *   3. 在「完整配置」里有对应字段 → 交给那边（字段旁的「🔗 绑定」按钮负责绑定）；
 *   4. 其余（纯数据输入，如 v1..v11、variables_json）→ 显示绑定行。
 */
export function isBindingRowPort(
  port: { id: string; kind?: string; showWhen?: (config: Record<string, unknown>) => boolean },
  opts: { config: Record<string, unknown>; configKeys: Set<string>; isBound: boolean },
): boolean {
  if (opts.isBound) return true;
  if (!isPortApplicable(port, opts.config)) return false;
  return !opts.configKeys.has(port.id);
}

/**
 * 按当前模式与配置字段覆盖面，把数据端口分成"需要在数据来源区显示"的两组。
 *
 * @param configKeys 「完整配置」区覆盖的字段集合（通常取 `Object.keys(spec.defaultConfig)`；
 *                   注意不要用当前 config 对象的键 —— 它可能只填了部分字段）
 */
export function partitionBindingRows<T extends { id: string; kind?: string; required?: boolean }>(
  dataInputs: T[],
  opts: {
    config: Record<string, unknown>;
    configKeys: Set<string>;
    isBound: (portId: string) => boolean;
  },
): { required: T[]; optional: T[]; hidden: T[] } {
  const required: T[] = [];
  const optional: T[] = [];
  const hidden: T[] = [];
  for (const port of dataInputs) {
    if (
      isBindingRowPort(port, {
        config: opts.config,
        configKeys: opts.configKeys,
        isBound: opts.isBound(port.id),
      })
    ) {
      (port.required ? required : optional).push(port);
    } else {
      hidden.push(port);
    }
  }
  return { required, optional, hidden };
}
