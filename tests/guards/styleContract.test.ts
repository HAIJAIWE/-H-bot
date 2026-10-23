// tests/guards/styleContract.test.ts
//
// # 闸门：风格契约里「机器能判断」的那部分
//
// 完整约定见 docs/architecture/代码风格约定.md。这里只放两条能机械判定的：
//
// 1. **文件头注释 <= 20 行**
//    超过 20 行的文件头基本都不是「这是什么」，而是「当年为什么这样」。
//    那部分内容有价值，但它的正确位置是 docs/ —— 代码里留一行指针就够了。
//    闸门用「预算」而不是绝对值：老文件不能更长，新文件不许超；压短了可以删预算。
//
// 2. **`as never` 不许新增**
//    它是类型系统在说「这里我放弃了」。存量 14 处已登记，新增即红。
//    真要表达「这个位置没有值」，用 `as unknown as T` 至少还留着转换链，
//    或者把签名改对 —— 后者通常才是真因。
//
// 剩下的风格（命名、抽象层级、注释是否复述代码）机器判不了，留给评审。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const HEADER_LIMIT = 20;

interface StyleBaseline {
  headers: Record<string, number>;
  asNever: Record<string, number>;
}

const baseline = JSON.parse(
  readFileSync(join(ROOT, 'tests', 'guards', 'style-baseline.json'), 'utf-8'),
) as StyleBaseline;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function headerLines(src: string): number {
  let n = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (
      t === '' ||
      t.startsWith('//') ||
      t.startsWith('/*') ||
      t.startsWith('*') ||
      t.startsWith('*/')
    ) {
      n++;
      continue;
    }
    break;
  }
  return n;
}

const files = walk(SRC).map((f) => ({
  rel: relative(ROOT, f).split('\\').join('/'),
  src: readFileSync(f, 'utf-8'),
}));

describe('闸门：风格契约（机器可判的部分）', () => {
  it('扫描确实在工作（防空转）', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('★ 文件头注释不许超预算', () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      const h = headerLines(src);
      const budget = baseline.headers[rel];
      if (budget === undefined) {
        if (h > HEADER_LIMIT)
          offenders.push('  新文件 ' + h + ' 行（上限 ' + HEADER_LIMIT + '）  ' + rel);
      } else if (h > budget) {
        offenders.push('  长了 ' + (h - budget) + ' 行（' + budget + ' → ' + h + '）  ' + rel);
      }
    }
    expect(
      offenders,
      '文件头注释超预算。它不是「这是什么」，而是「当年为什么」——\n' +
        '把那段论证搬到 docs/，这里留一行 `// 背景见 docs/xxx.md`。\n' +
        '确实需要更长的，跑 node scripts/update-style-baseline.mjs 并说明理由。\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('★ as never 不许新增', () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      const count = (src.match(/\bas never\b/g) ?? []).length;
      const allowed = baseline.asNever[rel] ?? 0;
      if (count > allowed) offenders.push('  ' + allowed + ' → ' + count + '  ' + rel);
    }
    expect(
      offenders,
      '新增了 `as never`（类型逃逸）。改用正确签名或 `as unknown as T`；' +
        '确实是必要的，跑 node scripts/update-style-baseline.mjs 并说明。\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('预算表不许有幽灵（已压到上限以内 / as never 已清零）', () => {
    const ghosts: string[] = [];
    for (const { rel, src } of files) {
      const h = headerLines(src);
      const budget = baseline.headers[rel];
      if (budget !== undefined && h <= HEADER_LIMIT)
        ghosts.push('  头注释已合规（' + budget + ' → ' + h + '）  ' + rel);
      const count = (src.match(/\bas never\b/g) ?? []).length;
      const allowed = baseline.asNever[rel];
      if (allowed !== undefined && count === 0) ghosts.push('  as never 已清零  ' + rel);
    }
    expect(
      ghosts.length,
      '有 ' +
        ghosts.length +
        ' 条预算已经不需要了。跑 node scripts/update-style-baseline.mjs 更新，' +
        '让预算表反映真实情况：\n' +
        ghosts.slice(0, 10).join('\n'),
    ).toBe(0);
  });
});
