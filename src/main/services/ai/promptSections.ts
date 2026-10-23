// src/main/services/ai/promptSections.ts
//
// # 系统提示的**分段装配**（有预算、有优先级、有交代）
//
// ## 为什么需要（2026-10-01 架构复盘的结论）
//
// 在此之前，整个系统提示是 `context.ts` 里**一个模板字面量**拼出来的 ——
// 10 个语义段平铺在 96 行字符串里，**没有优先级、没有分段预算**。
// 后果在当天就露出来了：新增「可用协议端 API」一节（1,238 字符）把真项目的提示
// 从 19,330 顶到 20,568，撞破了既有的体量闸门 —— 而当时的处置只能是**人工把阈值调大**。
//
// 那是"靠人算总账"的写法：每加一段都在赌总长度，而且**没有哪一段是"可以先砍的"**。
//
// ## 三条规则（本文件就是这三条的实现）
//
// 1. **分层**：`priority: 0` 的段**永不裁**（工具约定、注入边界、创建节点指引、
//    当前流程 —— 少了它们模型会做错事）；1 是可以按需查的（节点目录、API 词表）；
//    2 是锦上添花（项目词汇、插件包、收尾说明）。
// 2. **按优先级砍，砍完必须交代**：超预算时从最低优先级开始丢，
//    并在末尾用一节列出**哪些段被省略了** —— 本仓库一贯的原则：
//    **不能让模型把"没列出来的"当成"不存在"**。
// 3. **顺序稳定**：输出顺序 = 注册顺序（不是优先级顺序）——
//    少一段不该让其余的段落重新排列（提示词的位置变化会影响模型注意力，也会让日志难比对）。
import { logger } from '../infra/logger';

/** 0 = 永不裁；1 = 可按需查；2 = 锦上添花 */
export type SectionPriority = 0 | 1 | 2;

export interface PromptSection {
  /** 稳定 id（测试与日志用它，改文案不该改 id） */
  id: string;
  /** 段落标题（渲染成 `## 标题`）；空串表示"续上一段"，不单独成节 */
  title: string;
  body: string;
  priority: SectionPriority;
  /**
   * P0 里**允许被截断**的段（2026-10-18 实盘补）。
   *
   * 只有"动态、且模型能用工具查回来"的段才该标：当前流程、能力索引。
   * 静态契约段（工具参数表、注入边界、自定义节点指引）**不许标** ——
   * 截掉它们不是"省上下文"，是让模型做错事。
   */
  trimmable?: boolean;
  /** 截断后告诉模型"完整内容怎么查"（一句话） */
  trimHint?: string;
}

export interface AssembleResult {
  content: string;
  /** 因预算被省略的段 id（**按注册顺序**，便于稳定断言） */
  omitted: string[];
  chars: number;
  /**
   * 已经把 1/2 优先级的都砍光了还是超预算（说明 0 优先级的段本身就太大）。
   * 这时**不裁 0 优先级**（宁可超一点，也不让模型缺关键约定），但要把事实报出来。
   */
  stillOverBudget: boolean;
}

/** 系统提示的总预算（字符）。真项目实测约 20.5k，留一点余量 */
export const PROMPT_BUDGET_CHARS = 22_000;

/**
 * 省略段的交代文案 —— 必须给出「怎么补回来」，**但必须短**。
 *
 * ⚠️ 2026-10-16 真机：这段话原来 141 字符，而 P0+P1 段合计 21,923（余量只有 77）——
 * 于是「丢掉一个 P2 段（省约 2000）+ 这段话（141）」之后**仍然超预算**（22,064 > 22,000）。
 * 交代文案是必需的（不能让模型把没列出来的当成不存在），但它不该成为压垮预算的那一项：
 * 同样的信息压到约 70 字符就够。
 */
function omissionNote(titles: string[]): string {
  return (
    `\n## 本次未附上：${titles.join('、')}\n` +
    '**需要时用工具查**，别凭记忆猜 —— 猜错的字段名不会报错，只会静默失效。'
  );
}

/** 渲染一段（标题 + 正文）；标题为空则只输出正文 */
export function renderSection(s: PromptSection): string {
  return s.title ? `\n## ${s.title}\n${s.body}` : `\n${s.body}`;
}

/**
 * 装配系统提示。
 *
 * @param header 头部（身份 + 当前项目）—— 永远在最前，不参与裁剪
 */
export function assembleSystemPrompt(input: {
  header: string;
  sections: readonly PromptSection[];
  budgetChars?: number;
}): AssembleResult {
  const budget = input.budgetChars ?? PROMPT_BUDGET_CHARS;
  const parts = input.sections.map((s) => ({ s, text: renderSection(s) }));
  const headerText = `${input.header}\n`;
  let total = headerText.length + parts.reduce((n, p) => n + p.text.length, 0);

  const kept = new Set(parts.map((p) => p.s.id));
  const omittedIds: string[] = [];

  // 从**最低优先级**开始丢；同优先级里**后注册的先丢**（后面的通常更次要）
  const droppable = parts
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.s.priority > 0)
    .sort((a, b) => b.s.priority - a.s.priority || b.index - a.index);

  for (const p of droppable) {
    if (total <= budget) break;
    /**
     * ⚠️ **丢弃会额外产生一段交代文案**（`omissionNote`）—— 判据必须把它算进去。
     *
     * 否则会出现「丢了反而更长」：2026-10-16 真机就是这么撞的 ——
     * P0+P1 合计 21,923（余量 77），一个非空的 P2 段把总量顶过 22,000，
     * 装配器丢掉它（省 ~80 字符），却又加上 141 字符的交代文案 ⇒ 22,064 > 22,000，
     * 比不丢还糟。丢弃的**意义**是让总量回到预算内；做不到就不该丢。
     */
    const projectedOmitted = [...omittedIds, p.s.id];
    const projectedTitles = parts
      .filter((q) => projectedOmitted.includes(q.s.id))
      .map((q) => q.s.title || q.s.id);
    const projected = total - p.text.length + omissionNote(projectedTitles).length;
    // 丢了只会更长（或一样长）⇒ 停手：这已经不是「靠丢弃能解决」的局面了，
    // 后面会由 stillOverBudget 如实报出「关键段本身太大了」。
    if (projected >= total) break;
    kept.delete(p.s.id);
    total -= p.text.length;
    omittedIds.push(p.s.id);
  }

  /**
   * **P0 仍超预算 ⇒ 只截可截断的动态段**（2026-10-18 实盘）。
   *
   * 实盘现场：44 节点的项目，P0 合计 22,351 字符 > 22,000 —— 静态契约段删不得，
   * 动态的「当前流程」又不能整段丢（模型不看就是盲改）。所以给它一个上限：
   * 截断 + 交代"完整内容怎么查"，让总量回到预算内，而不是放任超限。
   */
  const MIN_TRIM_KEEP = 1200;
  /**
   * 截断时要把**末尾那段"本次未附上"的交代**算进去 ——
   * 2026-10-18 实盘第二次跑：截完 22,051，差的 51 正是交代文案
   * （total 只算 header+sections，交代是最后拼上去的）。
   */
  const noteReserve = omittedIds.length > 0 ? 160 : 0;
  const trimBudget = budget - noteReserve;
  if (total > trimBudget) {
    const trimmable = parts
      .filter((p) => kept.has(p.s.id) && p.s.priority === 0 && p.s.trimmable)
      .sort((a, b) => b.text.length - a.text.length);
    for (const p of trimmable) {
      if (total <= trimBudget) break;
      const overflow = total - trimBudget;
      const keep = Math.max(MIN_TRIM_KEEP, p.text.length - overflow - 80);
      if (keep >= p.text.length) continue;
      const note = `\n（此段过长，已截断 ${p.text.length - keep} 字符；${p.s.trimHint ?? '完整内容用工具查'}）`;
      const next = p.text.slice(0, keep).trimEnd() + note;
      total += next.length - p.text.length;
      p.text = next;
    }
  }

  // 交代用：按**注册顺序**列出被省略的段标题（稳定、便于读）
  const omittedTitles = parts
    .filter((p) => omittedIds.includes(p.s.id))
    .map((p) => p.s.title || p.s.id);

  const body = [
    headerText,
    ...parts.filter((p) => kept.has(p.s.id)).map((p) => p.text),
    omittedTitles.length > 0 ? omissionNote(omittedTitles) : '',
  ].join('');

  const content = body.trimEnd() + '\n';
  const stillOverBudget = content.length > budget;

  if (omittedIds.length > 0) {
    logger.warn(
      `[ai] 系统提示超预算（${budget} 字符），已省略 ${omittedIds.length} 段：${omittedTitles.join('、')}`,
    );
  }
  if (stillOverBudget) {
    logger.warn(
      `[ai] 系统提示在省略非关键段、并截断可截断段之后**仍为 ${content.length} 字符**（预算 ${budget}）—— ` +
        '静态契约段（工具约定/注入边界/自定义节点指引）本身太大了，需要人工精简',
    );
  }

  /**
   * 上报顺序 = **注册顺序**，不是丢弃顺序。
   *
   * 丢弃顺序是「后注册的先丢」（third → second → first），直接把它当返回值会让调用方的
   * 断言与日志随裁剪轮次抖动；接口注释承诺的是注册顺序。
   * 2026-10-23 由 promptSections.test.ts 的用例抓出：实现原先直接 return omittedIds。
   */
  const omittedInRegistrationOrder = parts
    .filter((p) => omittedIds.includes(p.s.id))
    .map((p) => p.s.id);

  return { content, omitted: omittedInRegistrationOrder, chars: content.length, stillOverBudget };
}
