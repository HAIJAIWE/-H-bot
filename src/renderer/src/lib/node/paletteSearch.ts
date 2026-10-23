// src/renderer/src/lib/node/paletteSearch.ts
//
// 节点库（palette）搜索：让用户**用自己脑子里的词**找到节点，而不是只认节点名。
//
// ## 为什么需要单独一个模块（而不是就地写个 includes）
//
// 节点数到 57 之后，"翻分组找一个节点"成了主要成本，搜索是唯一的捷径。
// 而它最初只匹配 label/kind/description，于是用户真会打的词全都搜不到：
//
//   · 「按钮」   → 发消息（能力在**端口选项**里：「Markdown / 按钮」「按钮配置」）
//   · 「群黑名单」→ 获取上下文（是 mode 的一个**选项**）
//   · 「批量踢出」 → 群管理（同样是选项）
//   · 「输入中状态」→ 发消息（同样是选项）
//
// 用户记得的是**能力**，不是节点名。所以语料必须覆盖：
//   label / kind / description / summary / tags /
//   端口名 + 端口选项 / 非端口配置字段的选项
//
// ## 两条不能破的约束（都有闸门守着）
//
// 1. **通用端口不进语料**：每个节点都有「入口/出口/成功/错误」这些端口，
//    收进来之后搜「入口」会命中一大片 —— 搜索反而变得更没用。见 `GENERIC_PORT_IDS`。
// 2. **端口「说明」不进语料**：那是给 AI 看的长句（如「按需要提取上下文」），
//    收进来会让"搜什么都有一堆"。只收 `name`。
/**
 * 搜索只需要这几个字段。
 *
 * 刻意**不写成 `NodeSpecV2`**：左栏节点库传的是已弃用的 `NodeSpec`，测试传的是 `NodeSpecV2`，
 * 两者这些字段同形（只差 `configFieldOptions` 等可选字段）。用最小结构类型两边都能编译，
 * 而且比在两个具体类型之间做联合/断言更稳 —— 少一处将来会漂移的耦合。
 */
export interface PaletteSearchable {
  kind: string;
  label: string;
  description: string;
  summary?: string;
  tags?: readonly string[];
  inputs?: readonly PaletteSearchPort[];
  outputs?: readonly PaletteSearchPort[];
  /** 无端口配置字段的选项（触发器这类）；旧类型没有，故可选 */
  configFieldOptions?: Record<string, readonly { label: string }[] | undefined>;
}

interface PaletteSearchPort {
  id: string;
  name: string;
  options?: readonly { label: string }[];
}

/**
 * 通用端口 id 白名单（按 **id** 排除，不按名字）。
 *
 * 这些是控制流/结果类的标准端口，几乎每个节点都有；它们的**名字**（入口/出口/成功/错误/结果）
 * 是高频中文词，进语料就会让搜索退化。而各节点自己的业务端口（群号/怪物血量/命令前缀…）要保留。
 */
const GENERIC_PORT_IDS = new Set([
  'in',
  'out',
  'success',
  'error',
  'result',
  'data',
  'value',
  'ok',
  'done',
  'next',
  'else',
  'true',
  'false',
  'default',
]);

/**
 * 取一个节点用于搜索的全部文本（空格连接）。**不缓存**：
 * 目录是注入式的，语言切换后派生数据要跟着变，缓存反而制造脏读。
 */
export function nodePaletteSearchText(spec: PaletteSearchable): string {
  // `summary` 是可选的（旧 NodeSpec 类型上就缺），所以最后要 filter(Boolean)
  const parts: string[] = [spec.label, spec.kind, spec.description, spec.summary ?? ''];
  parts.push(...(spec.tags ?? []));

  for (const port of [...(spec.inputs ?? []), ...(spec.outputs ?? [])]) {
    if (GENERIC_PORT_IDS.has(port.id)) continue;
    // 只收端口名，**不收 description**（长句，见文件头注释）
    parts.push(port.name);
    for (const opt of port.options ?? []) parts.push(opt.label);
  }

  // 无端口配置字段的选项（触发器这类）—— 同样是"用户会打的词"
  for (const opts of Object.values(spec.configFieldOptions ?? {})) {
    for (const opt of opts ?? []) parts.push(opt.label);
  }

  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * 查询是否命中该节点。
 *
 * 规则：大小写不敏感；**空格分词，全部词都要命中**（AND）。
 * AND 是刻意的 —— 「群 黑名单」这种分开打的写法与「群黑名单」应当都命中，
 * 而 OR 会让多打一个词反而搜出更多结果。
 *
 * 空查询（或只有空白）命中**全部** —— 清空搜索等于不做过滤。
 */
export function matchesNodePaletteQuery(spec: PaletteSearchable, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = nodePaletteSearchText(spec);
  return terms.every((t) => text.includes(t));
}
