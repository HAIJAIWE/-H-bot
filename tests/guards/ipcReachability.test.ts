// tests/guards/ipcReachability.test.ts
//
// # 闸门：主进程注册的每个通道，**preload 必须能调到**（否则是死 handler）
//
// ## 为什么（2026-10-01，IPC 契约收口的实质）
//
// 既有两条闸门管的是"preload 调的，主进程注册了吗"（`channelContract`）
// 与"类型声明与 preload 一致吗"（`ipcSurfaceParity`）—— 都是**从渲染层往主进程**看。
//
// **反方向没人管**：主进程 `ipcMain.handle('x')` 注册了、但 preload 从不暴露 → 这个通道
// **任何界面都调不到**。它是**死的**，而且不报错、不占资源，只是"白注册"。
//
// ⚠️ 2026-10-01 WI-3 更正：本闸门第一版把 `bot:usageOverview` 描述成"已实现但界面从没接过"，
// **那句话是错的** —— `ipc/bot.ts` 的 `registerBotIpc` 从未被 `register.ts` 引用，
// 通道压根没注册过（台账把"没接线"写成了"接线了但没门"）。所以本文件补了第二道闸门：
// **每个 `src/main/ipc/*.ts` 导出的 `register*Ipc` 都必须被 register.ts 引用** ——
// 通道级扫描抓不到"整个文件都是死的"这一类。
//
// 与零引用闸门是同一类问题的两个面：那个管"导出了没人用"，这个管"注册了没人调"。
//
// ## 判据
//
// 每个主进程通道必须满足其一：
//   ① preload 里 invoke/send/on 了它（可达）
//   ② 在 `UNREACHABLE_OK` 里登记并写明理由（例：已实现但界面未接，待接或待删）
//
// ## 实现要点（今晚踩过的坑）
//
// ⚠️ **不能用正则扫源码**：`_shared.ts` 的注释里就写着 `ipcMain.handle('channel', …)`
// 当用法示例，正则会把 `channel` 当成一个真通道（今晚的假阳性就是这么来的）。
// 这里走 **AST 取字符串字面量**，注释不是 AST 节点。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();

/**
 * 注册了但**有意不暴露**给渲染层的通道。加条目必须写清理由与去向。
 *
 * 2026-10-01 WI-3：原本登记着 `bot:usageOverview`，理由写的是"已实现但界面从没接过" ——
 * 事实是 `ipc/bot.ts` 从未注册（`registerBotIpc` 全仓零引用），那个 handler 从来不存在。
 * 死注册已按规格 §3.3(b) 连同文件删除，台账随之清空。
 * **加新条目之前先确认它真的注册了**；如果整个文件都没接线，用文件末尾那条闸门来抓。
 */
const UNREACHABLE_OK: Record<string, string> = {
  // 2026-10-18（计划 5.4）：这套能力已改由本域自己的 launch:saveSchema 承载，
  // preload 不再调它。保留一个 minor 是为**外部脚本 / 既有调用点**兼容，
  // 下个 minor 连同这个登记一起删。
  'plugin:saveSchema': '待删：已被 launch:saveSchema 取代，保留一个 minor 兼容外部调用',
  // 2026-10-23（恢复基线）：10/18 主包里注册了、preload 从不暴露的 3 条。
  // 登记在此是为了让闸门继续盯住「新增的死 handler」，而不是默许它们。
  'launch:listLayerTemplates': '待删：模板库已移除（preload 与类型声明都写明随模板库移除），先留 handler 兼容旧调用',
  'launch:previewConfigTables': '待删：模板库已移除（preload 与类型声明都写明随模板库移除），先留 handler 兼容旧调用',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** AST：取 `ipcMain.handle/on('x')` 里的字符串字面量（注释不会被算进来） */
function channelsIn(files: string[], kind: 'main' | 'preload'): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const obj = node.expression.expression.getText(sf);
        const meth = node.expression.name.text;
        const wanted =
          kind === 'main'
            ? obj === 'ipcMain' && (meth === 'handle' || meth === 'on')
            : obj === 'ipcRenderer' && (meth === 'invoke' || meth === 'send' || meth === 'on');
        if (wanted) {
          const a = node.arguments[0];
          if (a && ts.isStringLiteralLike(a)) out.add(a.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * 标识符是不是 import/export 语句里的「名字」—— 这类出现不算「使用」。
 * 本闸门要抓的正是「register.ts 里 import 了、却从没调用」的文件级死注册，
 * 所以必须把 import 子句本身排除掉，否则永远绿。
 */
function isImportExportName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportEqualsDeclaration(parent)
  );
}

/** 收集一个 ipc 文件里 export function register*Ipc / export const register*Ipc 的名字 */
function collectRegisterFns(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const wanted = (name: string): boolean => /^register\w*Ipc$/.test(name);
  const out: string[] = [];
  for (const stmt of sf.statements) {
    const modifiers = stmt.modifiers ?? [];
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name && wanted(stmt.name.text)) out.push(stmt.name.text);
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && wanted(decl.name.text)) out.push(decl.name.text);
      }
    }
  }
  return out;
}

/** register.ts 里出现过的标识符（排除 import/export 语句里的名字） */
function usedIdentifiers(file: string): Set<string> {
  const source = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isImportExportName(node)) out.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('★ IPC 可达性（主进程 → preload）', () => {
  const main = channelsIn(walk(join(ROOT, 'src/main')), 'main');
  const preload = channelsIn(walk(join(ROOT, 'src/preload')), 'preload');

  it('扫描确实在工作（防止空转）', () => {
    expect(main.size).toBeGreaterThan(150);
    expect(preload.size).toBeGreaterThan(150);
  });

  it('★ 主进程注册的通道，preload 都能调到（或登记为有意不暴露）', () => {
    const unreachable = [...main].filter((c) => !preload.has(c) && !(c in UNREACHABLE_OK)).sort();

    expect(
      unreachable,
      unreachable.length === 0
        ? ''
        : '这些通道**主进程注册了、preload 从不暴露** → 任何界面都调不到（死 handler）。\n' +
            '两种修法：\n' +
            '  ① **接上它**（preload 暴露 + 类型声明 + 界面用）\n' +
            '  ② 在 UNREACHABLE_OK 里登记并写明"待接还是待删"\n  ' +
            unreachable.join('\n  '),
    ).toEqual([]);
  });

  it('登记项必须真的还注册着（防止删除后清单变僵尸）', () => {
    const ghost = Object.keys(UNREACHABLE_OK).filter((c) => !main.has(c));
    expect(ghost, `这些登记项已不在主进程注册，从清单删掉：\n  ${ghost.join('\n  ')}`).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 第二道：**文件级**死注册（`register*Ipc` 写了、导出了，却从没被 register.ts 引用）
  //
  // bot.ts 的教训：通道级扫描完全抓不到它 —— handler 从未注册，所以"主进程通道"集合里
  // 根本没有它，第一版台账还把它描述成"注册了但没暴露"。必须从"文件导出了什么"这一侧
  // 再扫一遍 register.ts 的引用。
  // ---------------------------------------------------------------------------
  const ipcDir = join(ROOT, 'src', 'main', 'ipc');
  const ipcRegisterFns = readdirSync(ipcDir)
    .filter((name) => name.endsWith('.ts') && name !== 'register.ts')
    .flatMap((name) => collectRegisterFns(join(ipcDir, name)).map((fn) => ({ fn, file: name })));
  const registerTsIdents = usedIdentifiers(join(ipcDir, 'register.ts'));

  it('扫描确实在工作（register 函数清单与 register.ts 标识符都非空）', () => {
    expect(ipcRegisterFns.length).toBeGreaterThan(30);
    expect(registerTsIdents.has('registerAllIpc')).toBe(true);
  });

  it('★ 每个 src/main/ipc/*.ts 导出的 register*Ipc 都必须被 register.ts 引用（防第二个 bot.ts）', () => {
    const orphans = ipcRegisterFns.filter((e) => !registerTsIdents.has(e.fn));

    expect(
      orphans,
      orphans.length === 0
        ? ''
        : '这些 register*Ipc **导出了、却从没在 register.ts 里注册** → 文件级死注册：\n' +
            '  ① 在 registerAllIpc 里注册它（并让 preload 暴露对应通道）\n' +
            '  ② 或者删掉这个文件（不要留"写好了没接线"的中间态）\n  ' +
            orphans.map((o) => `${o.file}  ${o.fn}`).join('\n  '),
    ).toEqual([]);
  });

  it('提示：主进程通道总数 / preload 暴露数 / 有意不暴露数', () => {
    console.log(
      `[ipcReachability] 主进程注册 ${main.size} 个，preload 暴露 ${preload.size} 个，` +
        `有意不暴露 ${Object.keys(UNREACHABLE_OK).length} 个`,
    );
    expect(true).toBe(true);
  });
});
