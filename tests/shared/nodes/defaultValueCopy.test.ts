// tests/shared/nodes/defaultValueCopy.test.ts
//
// 闸门：节点目录里的**中文默认值**只许出现在已登记的字段上。
//
// ## 这条闸门为什么存在
// 目录里的默认值有两处会"露中文"给用户：
//   1. `spec.defaultConfig` —— 建节点时被节点工厂深拷贝进用户 flow.json，之后用户随便改
//      （新建节点的 config 初始值就是它）；
//   2. `spec.inputs/outputs[].default` —— 端口默认值，界面上以「默认值: xxx」展示
//      （PropertyDrawerParts / CanvasNode 悬停），也是"有空就表示这个必填项不算缺失"的依据。
// 这两处都**不随语言切换**（`catalog.en-US.ts` 只翻 label/description/summary/tags/端口名，
// 见 catalogI18n.test.ts「契约字段不随语言变化」），所以它们一旦写中文，英文界面也会一直显示中文。
//
// ## 为什么"不翻译"才是对的
// 判据（与本仓库其它文案闸门一致）：**这段字用户能不能改？能改的就是数据，不翻译。**
//   - `format_text` 的模板、`subflow_defined` 的参数表，是给用户"起个手"的样例内容，
//     会被写进 flow.json 由用户随便改；
//   - `wait_input.invalid_message` / `error_op.message` 是**发给玩家看**的默认提示，
//     但它是流程作者的配置项（能改），且本项目以中文玩家为主 —— 默认值给中文最省事；
//   - 端口 `default` 同理（且它不落盘，只是"有默认值"的标记 + 展示）。
// 真正的界面文案（字段名、提示、按钮）走 i18n，由 noHardcodedCopy.test.ts 守。
//
// ## 闸门的形状：白名单 + 双向校验
// 只做"新增即报警"这一半是不够的 —— 白名单会变成藏尸地（原值删了、白名单还留着）。
// 所以每条登记项既要在目录里**真实存在**，也要写明"它为什么是数据不是文案"。
//
// ## 已知边界
// 本闸门只管**节点目录**。用户项目里的 flow.json、插件包的 defaultConfig、数据模板的
// 字段默认值是纯用户数据，不在扫描范围（也不该管）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog';
import type { NodeSpecV2 } from '@shared/types/nodeV2';

const ROOT = resolve(__dirname, '../../..');
const CJK = /[\u4e00-\u9fff]/;

interface Hit {
  /** `<kind>.defaultConfig.<key>` 或 `<kind>.<inputs|outputs>.<portId>.default` */
  where: string;
  value: string;
}

/** 递归取出值里所有含中文的字符串（默认值可能是对象/数组，如 message_send 的 keyboard） */
function cjkStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (CJK.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) cjkStrings(v, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) cjkStrings(v, out);
  }
  return out;
}

/** 抽成纯函数：反向用例靠它证明"这条闸门有牙齿" */
function collectDefaultHits(specs: readonly NodeSpecV2[]): Hit[] {
  const hits: Hit[] = [];
  for (const spec of specs) {
    for (const [key, value] of Object.entries(spec.defaultConfig)) {
      for (const s of cjkStrings(value)) hits.push({ where: `${spec.kind}.defaultConfig.${key}`, value: s });
    }
    for (const dir of ['inputs', 'outputs'] as const) {
      for (const port of spec[dir]) {
        for (const s of cjkStrings(port.default)) {
          hits.push({ where: `${spec.kind}.${dir}.${port.id}.default`, value: s });
        }
      }
    }
  }
  return hits;
}

/**
 * 已登记的中文默认值。新增一条之前先问自己：**这段字用户能不能改？**
 * 能改 → 它是数据，把理由写清楚加进来；不能改 → 它是文案，应该走 i18n 而不是加这里。
 */
const ALLOWED: Array<{ where: string; why: string }> = [
  {
    where: 'format_text.defaultConfig.template',
    why: '文本模板的样例内容，建节点后就是用户输入框里的初值，用户随便改成自己的话',
  },
  {
    where: 'wait_input.defaultConfig.invalid_message',
    why: '「输入不合格式」时发给玩家的默认提示，属流程作者的配置项（有 invalid_message 端口可绑定）',
  },
  {
    where: 'error_op.defaultConfig.message',
    why: '断言失败/抛异常的默认消息，同上：作者的配置项，运行时可被 message 端口覆盖',
  },
  {
    where: 'error_op.inputs.message.default',
    why: '上面那条的端口默认值（同一句话的第二种落法，只用于展示与"有默认值不算缺失"）',
  },
  {
    where: 'battle_panel.defaultConfig.command_prefix',
    why: '战斗面板里点行动按钮时发回的指令前缀（"/战斗 "），属可改的样例数据：作者按自己的指令改；真要换掉时改这里不会影响别的节点',
  },
  {
    where: 'subflow_defined.defaultConfig.params',
    why: '子流程参数表的样例（atk/def 示例），是 JSON 数据，用户建子流程时会整体替换',
  },
];

/**
 * 同类残留：**主进程里与目录默认值同义的硬编码兜底**。
 * 它们只在"用户手改过 flow.json、把该字段删了"时才会用到，值必须与目录默认值一致，
 * 否则会漂移成两套提示。这里不重构成引用目录（改动运行时热路径不值当），而是用
 * "目录里的值必须原样出现在这个文件里"来锁住一致性：目录改了这边就得跟着改。
 */
const RUNTIME_FALLBACKS: Array<{ file: string; from: string; why: string }> = [
  {
    file: 'src/main/codegen/graphPreprocess.ts',
    from: 'wait_input.defaultConfig.invalid_message',
    why: '旧 wait_reply 迁移到 wait_input 时，老配置缺 invalid_message 的兜底',
  },
  {
    // 2026-10 拆分后 error_op 的 kwargs 实现在 handlers/kwargs.ts（装配在 handlerRegistry）
    file: 'src/main/runtime/handlers/kwargs.ts',
    from: 'error_op.defaultConfig.message',
    why: 'error_op handler 里 kwargs.message 缺失时的兜底',
  },
];

const allowedWhere = new Set(ALLOWED.map((a) => a.where));

const catalogHits = collectDefaultHits(NODE_CATALOG_V2);

describe('目录中文默认值：只许出现在已登记的数据字段上', () => {
  it('扫描范围非空（防止目录加载不到导致测试空转通过）', () => {
    expect(NODE_CATALOG_V2.length).toBeGreaterThan(40);
    expect(catalogHits.length).toBeGreaterThan(0);
  });

  it('没有未登记的中文默认值', () => {
    const offenders = catalogHits.filter((h) => !allowedWhere.has(h.where));
    expect(
      offenders.map((h) => `${h.where} = ${JSON.stringify(h.value)}`),
      '这些默认值含中文但没登记。先判断它是数据还是文案：\n' +
        '  - 是用户能改的数据（样例内容 / 默认提示）→ 连同理由加进本文件顶部的 ALLOWED；\n' +
        '  - 是界面文案（字段名、按钮、提示标题）→ 它不该以中文默认值的形式存在，走 i18n。',
    ).toEqual([]);
  });

  it('登记表里每一项目前都真实存在，且都写了理由（防止登记表变成藏尸地）', () => {
    const problems: string[] = [];
    for (const entry of ALLOWED) {
      const hit = catalogHits.find((h) => h.where === entry.where);
      if (!hit) problems.push(`${entry.where} —— 目录里已经没有这个中文默认值了，请从 ALLOWED 删除`);
      if (entry.why.trim().length < 10) problems.push(`${entry.where} —— 理由太短，说不清为什么它是数据`);
    }
    expect(problems).toEqual([]);
  });

  it('登记表没有重复项', () => {
    expect(ALLOWED.length).toBe(allowedWhere.size);
  });

  it('反向用例：未登记的中文默认值会被认出来，已登记的不会误报', () => {
    // 借 format_text 这个真节点来造探针：template 是已登记的，extra 是没登记的，
    // 断言只有 extra 被认出来 —— 同时证明"有牙齿"和"不误伤登记项"。
    const base = NODE_CATALOG_V2.find((n) => n.kind === 'format_text')!;
    const probe: NodeSpecV2[] = [
      { ...base, defaultConfig: { template: '你好', extra: '未登记的中文' } },
    ];
    const offenders = collectDefaultHits(probe).filter((h) => !allowedWhere.has(h.where));
    expect(offenders.map((h) => `${h.where}=${h.value}`)).toEqual([
      'format_text.defaultConfig.extra=未登记的中文',
    ]);
  });
});

describe('主进程硬编码兜底与目录默认值保持一致', () => {
  it('每处兜底的字面量都原样取自目录（目录一改，这里就红）', () => {
    const problems: string[] = [];
    for (const fb of RUNTIME_FALLBACKS) {
      const [kind, ...rest] = fb.from.split('.');
      let cur: unknown = NODE_CATALOG_V2.find((n) => n.kind === kind);
      for (const seg of rest) {
        cur = (cur as Record<string, unknown> | undefined)?.[seg];
      }
      if (typeof cur !== 'string' || !CJK.test(cur)) {
        problems.push(`${fb.from} —— 目录里取不到中文默认值（登记项已失效）`);
        continue;
      }
      const src = readFileSync(resolve(ROOT, fb.file), 'utf-8');
      // 兜底字面量用哪种引号都行（拆文件后 kwargs.ts 是双引号、graphPreprocess 是单引号）
      if (!src.includes(`'${cur}'`) && !src.includes(`"${cur}"`)) {
        problems.push(
          `${fb.file} 里找不到 ${JSON.stringify(cur)} —— ${fb.why}。目录默认值改了就得同步这处兜底。`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
