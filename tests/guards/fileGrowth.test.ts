// tests/guards/fileGrowth.test.ts
//
// # 闸门：大文件不许再悄悄长大
//
// ## 为什么还要一条（已经有 fileSize 了）
//
// fileSize 管的是**绝对红线**（>1200 行必须登记）与**优先队列**（行数 × 提交次数）。
// 它挡不住真正的问题：一个 900 行的文件今天加 40 行、明天加 60 行 ——
// 每次都没越线，但**每次都没人做决定**。半年后它就成了下一个 1762 行的 DataBrowserPanel。
//
// 所以这里管**增长**：
//   · 新文件 >= 800 行且没登记 → 红（不许再造巨石）
//   · 已登记的文件涨了 10% 且至少 80 行 → 红（要么拆，要么写明「为什么还要长」并更新快照）
//   · 已登记的文件降到 800 行以下 → 红一条「可以删登记了」，让基线不腐烂
//
// ## 为什么分成「可增长」与「跟着一起长」两类
//
// 生成物/数据表（i18n 目录、能力台账、字段映射表）的增长是**内容变多**，不是结构变差，
// 拦它只会逼人做无意义的拆分。这类文件登记成 data，只做提示。
//
// 快照用 scripts/update-file-size-baseline.mjs 重新生成 —— 但**只在决定让它继续长时**跑。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readdirSync } from 'node:fs';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const BASELINE_FILE = join(ROOT, 'tests', 'guards', 'file-size-baseline.json');

/** 内容型文件：长是因为「条目多」，不是因为「逻辑绕」 */
const DATA_LIKE = [
  'src/shared/nodes/i18n/',
  'src/shared/nodes/builtinCatalog.ts',
  'src/renderer/src/components/launch/dataBrowserData.ts',
  'src/renderer/src/types/ipc.ts',
];
const isDataLike = (p: string): boolean =>
  p.endsWith('.generated.ts') || DATA_LIKE.some((d) => p.startsWith(d));

const HARD = 800;
const GROWTH_PCT = 0.1;
const GROWTH_ABS = 80;

interface Snap {
  [path: string]: { lines: number };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const current = new Map<string, number>();
for (const f of walk(SRC)) {
  const rel = relative(ROOT, f).split('\\').join('/');
  current.set(rel, readFileSync(f, 'utf-8').split('\n').length);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Snap;

describe('闸门：大文件增长', () => {
  it('★ 新文件不许超过 800 行（没登记的巨石）', () => {
    const offenders = [...current.entries()]
      .filter(([p, n]) => n >= HARD && !(p in baseline))
      .map(([p, n]) => '  ' + n + ' 行  ' + p);
    expect(
      offenders,
      '新文件超过 ' +
        HARD +
        ' 行。先拆，或者跑 scripts/update-file-size-baseline.mjs 登记' +
        '（登记 = 承认它要长期存在，请顺手在提交信息里写一句为什么）：\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('★ 已登记的大文件不许无理由增长', () => {
    const offenders: string[] = [];
    for (const [p, snap] of Object.entries(baseline)) {
      if (isDataLike(p)) continue;
      const now = current.get(p);
      if (now === undefined) continue;
      const grew = now - snap.lines;
      if (grew > GROWTH_ABS && grew / snap.lines > GROWTH_PCT) {
        offenders.push('  ' + snap.lines + ' → ' + now + ' (+' + grew + ')  ' + p);
      }
    }
    expect(
      offenders,
      '已登记的大文件又长了（超过 80 行且涨幅 >10%）。两种修法：\n' +
        '  ① 拆：把这次新增的那块抽出去（通常就是它让文件越线的）\n' +
        '  ② 认：确实要长，跑 node scripts/update-guard-baselines.mjs 更新快照，并在提交信息里写清为什么\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('登记表不许有幽灵（已降到 800 行以下的可以删登记）', () => {
    const ghosts: string[] = [];
    for (const [p, snap] of Object.entries(baseline)) {
      const now = current.get(p);
      if (now === undefined) {
        ghosts.push('  文件已不存在  ' + p + '（登记 ' + snap.lines + ' 行）');
        continue;
      }
      if (now < HARD) ghosts.push('  ' + snap.lines + ' → ' + now + '  ' + p);
    }
    expect(
      ghosts.length,
      '这些登记已经不需要了（文件变小或没了）。跑 node scripts/update-guard-baselines.mjs 让基线反映真实情况：\n' +
        ghosts.slice(0, 20).join('\n'),
    ).toBe(0);
  });

  it('提示：当前超限文件数', () => {
    const big = [...current.entries()].filter(([, n]) => n >= HARD).length;
    console.log('[fileGrowth] 超过 800 行：' + big + ' 个（已登记 ' + Object.keys(baseline).length + ' 个）');
    expect(true).toBe(true);
  });
});
