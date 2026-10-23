#!/usr/bin/env node
// 重新生成 tests/guards/file-size-baseline.json（fileGrowth 闸门用）。
//
// 只在**决定让一个大文件继续长**时跑：快照即「承认它要长期存在」，请顺手在提交信息里写一句为什么。
// 与 fileSize 闸门的分工：那边是绝对红线 + 又长又热队列（判据写在测试里），
// 这里是「已登记的 800+ 行文件不许悄悄再长 10%」。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const HARD = 800;
const OUT = join(ROOT, 'tests', 'guards', 'file-size-baseline.json');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const next = {};
for (const f of walk(SRC)) {
  const lines = readFileSync(f, 'utf-8').split('\n').length;
  if (lines < HARD) continue;
  const rel = relative(ROOT, f).split('\\').join('/');
  next[rel] = { lines };
}
const sorted = Object.fromEntries(Object.entries(next).sort((a, b) => b[1].lines - a[1].lines));
writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
console.log('[file-size-baseline] ' + Object.keys(sorted).length + ' 个 >= 800 行的文件写入 ' + relative(ROOT, OUT));
