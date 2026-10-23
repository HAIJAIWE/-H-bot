#!/usr/bin/env node
// 重新生成 tests/guards/style-baseline.json（styleContract 闸门用）。
//
// 两条机器可判的风格：文件头注释行数预算、`as never` 次数预算。
// 基线只登记**当前超标**的：头注释 > 20 行的文件、`as never` > 0 的文件。
// 只登记超标，是因为闸门里还有一条「预算表不许有幽灵」——
// 已压回上限内的条目必须删掉，否则基线会慢慢腐烂成一份没人看的名单。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const HEADER_LIMIT = 20;
const OUT = join(ROOT, 'tests', 'guards', 'style-baseline.json');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function headerLines(src) {
  let n = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) {
      n++;
      continue;
    }
    break;
  }
  return n;
}

const headers = {};
const asNever = {};
for (const f of walk(SRC)) {
  const src = readFileSync(f, 'utf-8');
  const rel = relative(ROOT, f).split('\\').join('/');
  const h = headerLines(src);
  if (h > HEADER_LIMIT) headers[rel] = h;
  const n = (src.match(/\bas never\b/g) ?? []).length;
  if (n > 0) asNever[rel] = n;
}
const byValue = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
writeFileSync(OUT, JSON.stringify({ headers: byValue(headers), asNever: byValue(asNever) }, null, 2) + '\n');
console.log('[style-baseline] 头注释超 20 行 ' + Object.keys(headers).length + ' 个 / as never ' + Object.keys(asNever).length + ' 个文件，写入 ' + relative(ROOT, OUT));
