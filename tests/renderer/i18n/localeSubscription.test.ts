// tests/renderer/i18n/localeSubscription.test.ts
//
// 闸门：**组件里**用了 t() 就必须订阅语言变化。
//
// ## 为什么这条闸门值钱
// `t()` 是普通函数，读的是 i18n 模块里的当前语言；React 不知道这个依赖。
// 组件写了 t('...') 却没订阅 locale，症状是「切到 English 之后，别的部分变了、
// 这个组件还是旧语言」——单测里语言固定，测不出来；只有真机切一遍才看得见。
//
// P4-3 批次实测：迁移完 27 个文件后，真机从 English 切回中文，
// 玩家浏览面板整片还是英文，才暴露出漏订阅。所以把这条约束自动化。
//
// ## 判定范围（刻意收窄，避免误报）
// 只检查**组件函数**（大写名函数声明 / memo(...) 的实参 / 大写名 const 的初始化函数）
// 的函数体里是否出现 t()。纯工具模块（如 dataBrowserConstants 的 getter、
// iconMap 的 getDataTypeMeta）本身不该、也不能调 hook —— 它们由调用方负责订阅。
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const COMPONENTS_DIR = 'src/renderer/src/components';
const SRC = 'src/renderer/src';

// 只检查**从 main.tsx 可达**的组件：
// 恢复树里有一批没有挂载点的面板（调试器 / 时间机器 / 资源限制 / NapCat 配置页），
// 它们就算漏订阅，用户也看不到；混进来只会把闸门变成噪音。接回页面后自动纳入检查。
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@renderer/')) base = join(ROOT, SRC, spec.slice('@renderer/'.length));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function reachableFiles(): Set<string> {
  const seen = new Set<string>();
  const queue = [join(ROOT, SRC, 'main.tsx')];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolveSpec(file, m[1]);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const REACHABLE = reachableFiles();

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** 函数体（含嵌套）里是否调用了 t('...') */
function bodyCallsT(node: ts.Node): boolean {
  let found = false;
  const scan = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 't' &&
      n.arguments.length > 0
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, scan);
  };
  scan(node);
  return found;
}

/** 是否 React 组件：大写名函数声明 / memo|forwardRef 的实参 / 大写名 const 的初始化函数 */
function isComponentFunction(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) {
    return !!node.name && /^[A-Z]/.test(node.name.text);
  }
  const parent = node.parent;
  if (ts.isCallExpression(parent)) {
    const callee = ts.isIdentifier(parent.expression)
      ? parent.expression.text
      : ts.isPropertyAccessExpression(parent.expression)
        ? parent.expression.name.text
        : '';
    if (callee === 'memo' || callee === 'forwardRef') return true;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return /^[A-Z]/.test(parent.name.text);
  }
  return false;
}

const offenders: string[] = [];
let scanned = 0;

for (const file of walk(resolve(ROOT, COMPONENTS_DIR))) {
  if (!REACHABLE.has(file)) continue;
  const src = readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let componentUsesT = false;
  const visit = (node: ts.Node): void => {
    const isFn =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
    if (isFn && isComponentFunction(node) && bodyCallsT(node)) componentUsesT = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!componentUsesT) continue;

  scanned++;
  // 组件里只要订阅了语言（用 useLocaleSubscription() 或直接读 useI18nStore）就算过
  if (!src.includes('useLocaleSubscription(') && !src.includes('useI18nStore(')) {
    offenders.push(file.slice(ROOT.length + 1).replace(/\\/g, '/'));
  }
}

describe('组件必须订阅语言变化', () => {
  it('每个使用 t() 的组件都调用了 useLocaleSubscription()', () => {
    expect(offenders).toEqual([]);
  });

  it('扫描到足够多的组件文件（防止判定逻辑写错导致测试空转通过）', () => {
    expect(scanned).toBeGreaterThan(20);
  });

  it('入口可达性解析正常（可达文件数不为 0）', () => {
    expect(REACHABLE.size).toBeGreaterThan(200);
  });
});
