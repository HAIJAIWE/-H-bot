// tests/guards/ipcSurfaceParity.test.ts
//
// # 闸门：IPC 契约的**第三处**（渲染层类型声明）也要对账
//
// ## 背景（2026-10-01 架构评估建议②）
//
// 一条 IPC 通道要在**三处手写**：
//   ① 主进程   `ipcMain.handle('ai:chat', …)`
//   ② preload  `chat: (p, t) => ipcRenderer.invoke('ai:chat', …)`
//   ③ 渲染层   `src/renderer/src/types/ipc.ts` 的 `QqbatApi.ai.chat: (…) => …`
//
// 既有 `channelContract.test.ts` 只对了 **①↔②**（通道名字符串）。
// **③ 一直没有闸门** —— 它漂了的两种后果都很安静：
//   · 类型里有、preload 没有 → **调用即报错**（`is not a function`）
//   · preload 有、类型里没有 → TS 用户**根本调不到**（能力明明在，界面上没人用）
//
// ## 实测（2026-10-01，本闸门第一次跑）
//
// preload 暴露 **228** 个方法 / `QqbatApi` 声明 **228** 个 —— **两边完全一致**。
// 也就是说第三处**今天是对的**，但它对得"没有保证"；这条闸门就是把保证补上。
//
// ## 怎么对的
//
// 两边都走 **AST**，取**点号路径**（`launchData.list` 这种嵌套也算），
// 而不是靠字符串/正则 —— 正则分不清"对象嵌套"与"同名字段"。
// preload 侧的坑：实际写法是 `exposeInMainWorld('qqbat', api)`，
// 第二个参数是**标识符**而不是对象字面量，得先解析到它的 `const` 初始化器。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const PRELOAD = join(ROOT, 'src/preload/index.ts');
const TYPES = join(ROOT, 'src/renderer/src/types/ipc.ts');

/** 把对象字面量展开成 `a.b.c` → 成员节点 */
function flatten(node: ts.Node, prefix: string, out: Map<string, ts.Node>): void {
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
    const raw =
      prop.name && ts.isIdentifier(prop.name) ? prop.name.text : (prop.name?.getText() ?? '');
    const key = prefix ? `${prefix}.${raw.replace(/['"]/g, '')}` : raw.replace(/['"]/g, '');
    const value = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
    if (ts.isObjectLiteralExpression(value)) flatten(value, key, out);
    else out.set(key, value);
  }
}

/** ① preload 暴露面：点号路径 → 它 invoke/send 的通道 */
function preloadSurface(): Map<string, string[]> {
  const src = readFileSync(PRELOAD, 'utf-8');
  const sf = ts.createSourceFile(PRELOAD, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld' &&
      node.arguments.length >= 2
    ) {
      let target: ts.Node = node.arguments[1];
      // `exposeInMainWorld('qqbat', api)` —— 第二个参数是标识符，解析到它的初始化器
      if (ts.isIdentifier(target)) {
        for (const st of sf.statements) {
          if (!ts.isVariableStatement(st)) continue;
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === target.text && d.initializer) {
              target = d.initializer;
            }
          }
        }
      }
      const flat = new Map<string, ts.Node>();
      flatten(target, '', flat);
      for (const [path, value] of flat) {
        const chans: string[] = [];
        const scan = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
            const meth = n.expression.name.text;
            if (meth === 'invoke' || meth === 'send') {
              const a = n.arguments[0];
              if (a && ts.isStringLiteral(a)) chans.push(a.text);
            }
          }
          ts.forEachChild(n, scan);
        };
        scan(value);
        out.set(path, chans);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** ② 渲染层声明面：`QqbatApi` 的点号路径（递归进嵌套 type literal） */
function declaredSurface(): Set<string> {
  const src = readFileSync(TYPES, 'utf-8');
  const sf = ts.createSourceFile(TYPES, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = new Set<string>();
  /**
   * ⚠️ 两种写法都得算：
   *   · `chat: (…) => …`   → **PropertySignature**（本仓库主要用这种）
   *   · `chat(…): …`       → **MethodSignature**
   * 只处理前者的话，后者写法会完全不可见 ——
   * （反向对照时就是这么发现的：植入一个 MethodSignature 后闸门竟然不红）
   */
  const walkMembers = (members: ts.NodeArray<ts.TypeElement>, prefix: string): void => {
    for (const m of members) {
      if (!m.name) continue;
      const isProp = ts.isPropertySignature(m);
      const isMethod = ts.isMethodSignature(m);
      if (!isProp && !isMethod) continue;
      const name = m.name.getText().replace(/['"]/g, '');
      const key = prefix ? `${prefix}.${name}` : name;
      const type = isProp ? (m as ts.PropertySignature).type : undefined;
      if (type && ts.isTypeLiteralNode(type)) walkMembers(type.members, key);
      else out.add(key);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'QqbatApi') {
      walkMembers(node.members, '');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** ③ 全 `src/main` 里注册的通道（**不只 ipc/ 目录** —— dataNotifyService 等也在注册）*/
function registeredChannels(): Set<string> {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of ts.sys.readDirectory(dir, ['.ts'])) files.push(name);
  };
  walk(join(ROOT, 'src/main'));
  const text = files.map((f) => readFileSync(f, 'utf-8')).join('\n');
  return new Set(
    [...text.matchAll(/ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  );
}

describe('IPC 契约三处对账', () => {
  const pre = preloadSurface();
  const declared = declaredSurface();
  const channels = registeredChannels();

  it('扫描确实在工作（防止某次改动把解析变成空转）', () => {
    expect(pre.size).toBeGreaterThan(150);
    expect(declared.size).toBeGreaterThan(150);
    expect(channels.size).toBeGreaterThan(150);
  });

  it('★ preload 暴露的每个方法，类型里都声明了（否则 TS 用户调不到）', () => {
    const missing = [...pre.keys()].filter((k) => !declared.has(k));
    expect(
      missing,
      missing.length === 0
        ? ''
        : '这些方法 preload 暴露了、但 `QqbatApi` 里没声明 —— **TS 用户根本调不到**（能力在，却没人能用）：\n  ' +
            missing.join('\n  '),
    ).toEqual([]);
  });

  it('★ 类型里声明的每个方法，preload 都真的暴露了（否则调用即报错）', () => {
    const missing = [...declared].filter((k) => !pre.has(k));
    expect(
      missing,
      missing.length === 0
        ? ''
        : '这些方法在 `QqbatApi` 里声明了、但 preload 没有 —— **调用就是 `is not a function`**：\n  ' +
            missing.join('\n  '),
    ).toEqual([]);
  });

  it('★ preload 调用的每个通道，主进程都真的注册了（扫**全部** src/main，不只 ipc/）', () => {
    const missing: string[] = [];
    for (const [path, chans] of pre) {
      for (const c of chans) if (!channels.has(c)) missing.push(`${path} → ${c}`);
    }
    expect(
      missing,
      missing.length === 0
        ? ''
        : '这些通道 preload 会 invoke、主进程没人接（失败形态是 Electron 的 No handler registered，' +
            '对用户就是"点了没反应"，而 TypeScript 抓不到）：\n  ' +
            missing.join('\n  '),
    ).toEqual([]);
  });
});
