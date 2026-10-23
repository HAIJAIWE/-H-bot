// tests/main/services/ai/promptSections.test.ts
//
// # 闸门：系统提示的**分段预算**
//
// ## 背景（2026-10-01 架构复盘）
//
// 在此之前系统提示是 `context.ts` 里**一个 96 行的模板字面量**：10 个语义段平铺，
// 没有优先级、没有分段预算。当天就露馅了 —— 新增「可用协议端 API」一节（1,238 字符）
// 把真项目提示从 19,330 顶到 20,568，撞破了体量闸门，而**当时的处置只能是人工调阈值**。
//
// 那是"靠人算总账"：每加一段都在赌长度，而且**没有哪一段是"可以先砍的"**。
//
// ## 本文件钉住三条规则
//
// 1. **分层**：priority 0 的段**永不裁**（工具约定/注入边界/创建节点指引/当前流程）
// 2. **砍完必须交代**：末尾列出被省略的段，并给出"怎么补回来"
// 3. **顺序稳定**：少一段不该让其余段落重排
//
// 另有一条 2026-10-16 真机撞出来的**净收益**判据，与 2026-10-18 的 **P0 可截断段**：
// 丢弃会额外产生交代文案，所以"丢了反而更长"时必须停手（如实报 stillOverBudget）；
// 而 P0 本身太大时，只截**动态且能用工具查回来**的段（trimmable），静态契约段一概不动。
import { describe, it, expect } from 'vitest';
import {
  assembleSystemPrompt,
  PROMPT_BUDGET_CHARS,
  renderSection,
  type PromptSection,
} from '@main/services/ai/promptSections';

const sec = (id: string, priority: 0 | 1 | 2, size = 100, extra: Partial<PromptSection> = {}): PromptSection => ({
  id,
  title: `标题-${id}`,
  body: 'x'.repeat(size),
  priority,
  ...extra,
});

/**
 * ★ 2026-10-16 真机事故：**丢了一段反而更长**。
 *
 * P0+P1 合计 21,923（余量 77），一个非空的 P2 段把总量顶过 22,000 ——
 * 装配器丢掉它（省 ~80），又加上 141 字符的交代文案 ⇒ 22,064，比不丢还糟。
 * 判据：丢弃必须**看净收益**（省下的 > 交代文案），否则不许丢、如实报「关键段太大」。
 */
describe('★ 净收益：丢了不会更短就不许丢', () => {
  it('省下的比交代文案还少 ⇒ 一段都不丢，如实报 stillOverBudget', () => {
    const tinyP2 = sec('tiny', 2, 1);
    const result = assembleSystemPrompt({
      header: 'H',
      sections: [sec('core', 0, 990), tinyP2],
      budgetChars: 1000,
    });
    expect(result.omitted).toEqual([]);
    // 没丢 ⇒ 段还在（模型仍能看见），失败如实上报，交给体量闸门去催人精简
    expect(result.content).toContain('## 标题-tiny');
    expect(result.stillOverBudget).toBe(true);
  });
});

describe('★ 规则 1：P0 永不裁（先砍 P2，再砍 P1）', () => {
  const sections = [sec('p0', 0, 500), sec('p1', 1, 500), sec('p2a', 2, 500), sec('p2b', 2, 500)];

  it('预算只够 P0+P1 时，两个 P2 都被丢、P0 与 P1 一个不少', () => {
    const result = assembleSystemPrompt({ header: 'H', sections, budgetChars: 1200 });
    // 丢弃动作是「同优先级里后注册的先丢」（p2b 先走、再 p2a），
    // 但返回值按注册顺序报，所以这里是 p2a → p2b
    expect(result.omitted).toEqual(['p2a', 'p2b']);
    expect(result.content).toContain('## 标题-p0');
    expect(result.content).toContain('## 标题-p1');
    expect(result.content).not.toContain('## 标题-p2a');
    expect(result.content).not.toContain('## 标题-p2b');
    expect(result.stillOverBudget).toBe(false);
  });

  it('预算充足时一段都不丢', () => {
    const result = assembleSystemPrompt({ header: 'H', sections, budgetChars: 10_000 });
    expect(result.omitted).toEqual([]);
    expect(result.stillOverBudget).toBe(false);
  });
});

describe('★ 规则 2：砍完必须交代（哪些没附上 + 怎么补回来）', () => {
  it('末尾列出被省略段的标题，并给出"用工具查"的交代', () => {
    const result = assembleSystemPrompt({
      header: 'H',
      sections: [sec('p0', 0, 500), sec('p2a', 2, 500), sec('p2b', 2, 500)],
      budgetChars: 900,
    });
    expect(result.omitted.length).toBeGreaterThan(0);
    expect(result.content).toContain('本次未附上');
    for (const id of result.omitted) expect(result.content).toContain(`标题-${id}`);
    // 光"没附上"不够 —— 必须告诉模型怎么补（否则它会把没列出来的当成不存在）
    expect(result.content).toContain('需要时用工具查');
  });

  it('omitted 按**注册顺序**报（稳定、便于读）', () => {
    const result = assembleSystemPrompt({
      header: 'H',
      sections: [sec('first', 2, 500), sec('second', 2, 500), sec('third', 2, 500)],
      budgetChars: 700,
    });
    // 丢弃顺序是「后注册先丢」（third → second；first 在预算内保住了），
    // 上报顺序按**注册顺序**（second 排在 third 前面）
    expect(result.omitted).toEqual(['second', 'third']);
  });
});

describe('★ 规则 3：顺序稳定（少一段不该让其余段落重排）', () => {
  it('未超预算时，输出顺序 = 注册顺序', () => {
    const sections = [sec('a', 0), sec('b', 1), sec('c', 2)];
    const content = assembleSystemPrompt({ header: 'H', sections, budgetChars: 10_000 }).content;
    const order = ['a', 'b', 'c'].map((id) => content.indexOf(`## 标题-${id}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('丢掉中间一段后，其余段落的相对顺序不变', () => {
    const sections = [sec('a', 0, 400), sec('b', 2, 400), sec('c', 0, 400)];
    const result = assembleSystemPrompt({ header: 'H', sections, budgetChars: 1000 });
    expect(result.omitted).toEqual(['b']);
    expect(result.content.indexOf('## 标题-a')).toBeLessThan(result.content.indexOf('## 标题-c'));
  });
});

describe('★ 2026-10-18：P0 本身太大时，只截"能用工具查回来"的段', () => {
  const dynamic = sec('dynamic', 0, 5000, { trimmable: true, trimHint: '用 read_flow 查完整流程' });
  const contract = sec('contract', 0, 300);

  it('可截断的 P0 被截到预算内，并交代完整内容怎么查', () => {
    const result = assembleSystemPrompt({
      header: 'H',
      sections: [contract, dynamic],
      budgetChars: 2500,
    });
    expect(result.omitted).toEqual([]);
    expect(result.stillOverBudget).toBe(false);
    expect(result.chars).toBeLessThanOrEqual(2500);
    expect(result.content).toContain('此段过长，已截断');
    expect(result.content).toContain('用 read_flow 查完整流程');
    // 静态契约段**一个字都不许动**
    expect(result.content).toContain(`## 标题-contract\n${'x'.repeat(300)}`);
  });

  it('预算再小也保留 MIN_TRIM_KEEP（1200 字符）—— 宁可接着超，也不截成没用的一段', () => {
    const result = assembleSystemPrompt({
      header: 'H',
      sections: [contract, dynamic],
      budgetChars: 1000,
    });
    expect(result.content).toContain('此段过长');
    expect(result.stillOverBudget).toBe(true);
    // keep 至少 1200 字符（其中含 "\n## 标题-dynamic\n" 这十来个字符），连续 x 约 1185 个
    const run = /x{1100,}/.exec(result.content);
    expect(run).not.toBeNull();
  });

  it('没标 trimmable 的 P0 段不截（静态契约段删不得也截不得）', () => {
    const result = assembleSystemPrompt({
      header: 'H',
      sections: [sec('big', 0, 3000)],
      budgetChars: 1000,
    });
    expect(result.content).not.toContain('此段过长');
    expect(result.stillOverBudget).toBe(true);
  });
});

describe('renderSection', () => {
  it('有标题渲染成 "## 标题"，空标题表示"续上一段"（不单独成节）', () => {
    expect(renderSection(sec('a', 0, 3))).toBe('\n## 标题-a\nxxx');
    expect(renderSection({ id: 'cont', title: '', body: 'yyy', priority: 0 })).toBe('\nyyy');
  });
});

describe('预算常量', () => {
  it('默认预算是 22000（真项目实测 ~20.5k，留余量）', () => {
    expect(PROMPT_BUDGET_CHARS).toBe(22_000);
  });
});

describe('★ 接线：真项目提示走的是这套装配', () => {
  it('buildSystemMessage 的输出在预算内，且关键段一个不少', async () => {
    const { buildSystemMessage } = await import('@main/services/ai/context.js');
    const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'qqbat-prompt-'));
    try {
      await mkdir(join(dir, '.qqbat'), { recursive: true });
      const message = await buildSystemMessage({
        projectPath: dir,
        name: '提示装配测试',
        qq: '10000',
        adapter: 'official',
        model: 'test-model',
        botModel: null,
      });
      expect(message.role).toBe('system');
      const content = String(message.content);
      // P0 的段一个都不能少：当前流程 + 能力索引是"模型不许瞎猜"的底线
      expect(content).toContain('## 当前流程');
      expect(content).toContain('## 能力索引');
      expect(content).toContain('## 当前项目');
      // 装配器不许自己破预算（真破了说明 P0 单段太大，得人工精简）
      expect(content.length).toBeLessThanOrEqual(PROMPT_BUDGET_CHARS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
