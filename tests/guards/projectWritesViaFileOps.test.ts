// tests/guards/projectWritesViaFileOps.test.ts
//
// # 闸门：**项目内的写必须走 fileOps**（源码级，P1-10）
//
// ## 为什么要有它（来源是 task-14 交付里自查出的两条）
//
// ① `atomicWrite` 自身**没有路径 / 禁区校验**：它现在只被主进程用**计算好的**路径调用，
//    所以当下不是洞；但将来谁把用户输入接上去，`writeProjectFile` 那道兜底与路径护栏会
//    **一起**被绕过。
// ② 「新写者复用 `writeProjectFile` 就自动受保护，自己 `writeFile` 就绕过去了」——
//    这是唯一的结构性口子，而"靠约定"在本仓库被反复证明会失败。
//
// 所以：扫 `src/main/**` 里**所有直接的 fs 写入 / 搬运 / 删除调用**，逐个登记并写明形态。
//
// ## 判据（能自动判的近似 + 判不准的显式登记）
//
// 源码级判据只能看"**调了哪个 fs API、绑定是怎么来的**"，看不出路径从哪来（那是数据流）。
// 所以判据是：
//   · **扫到的每一个调用点都必须登记**（默认禁止），且登记时必须选一个**形态标签**
//     （权威列表 = 下方 `SHAPES`，两边不许各写一份）：
//       【fileOps 本体】 = 它就是那条通道本身；
//       【应用自有数据】 = .qqbat/、data/ 下的应用数据（路径由应用拼，不由用户输入决定）；
//       【系统/非项目】   = appData / tmp / 用户选定的导出路径等；
//       【框架/备份】     = 框架根、devBackup、历史快照目录；
//       【沙箱夹具】      = 预览/测试用的临时克隆；
//       【自带护栏】      = 路径来自用户/项目，但这处**自己**做了路径校验（写清是哪道）；
//       【待确认】        = **判不准**（路径可能来自用户/项目）—— 显式登记，不许含糊过去；
//   · 登记带**计数**：文件里多一个 / 少一个写点就必须改这个数字。少了它，闸门会把
//     「往一个已登记文件里**新加**一个绕过 fileOps 的写」静默放过 —— 那正是假绿；
//   · 检测要认得出**各种写法**（正控逐条钉住）：具名导入、别名导入、命名空间导入、
//     `fs.promises.x`、`require` 解构、`await import(fs).then((m) => m.x(...))`、
//     **再导出**（`export { writeFile } from 'fs/promises'`），以及（2026-10-18 补）
//     **变量中转 / 解构 / bind**：`const w = fs.writeFile`、`const { writeFile: w } = fs`、
//     `const w = require('fs').writeFile`、`const w = fs.writeFile.bind(fs)`、
//     `import { promises as fsp } from 'fs'` —— 都能解析成写点；
//     跨模块的同类包装（`export const w = fs.writeFile` / `export { w }`）记**合成项**。
//
// ## 明确**不在**扫描范围内（写在这里，别让后来人以为它管了）
//
//   · `mkdir / mkdirSync`（当前 68 处 = `src/main` 排除 `__tests__` 后的调用行数）：
//     **不构成洞** —— 它只创建空目录，**不改文件内容、不删任何东西**；数据丢失的必要条件是
//     「写内容」或「删 / 改名」，这两类 API 全在扫描内，而递归删除的危险形态是 `rm` / `rmSync`
//     （已扫）。mkdir 的最坏后果是建出一个空目录（或 EEXIST 报错），毁不了数据；把 68 处
//     目录创建也列进来只会把登记表淹成噪音（与 fileSize 闸门同一个教训：表一失去信息量就没人看）。
//     残余风险：**mkdir 不校验路径** —— 若将来有人拿未校验的路径建目录，本闸门不会报；
//     路径校验由各服务自己的 `assertWithinProject` 负责（那是另一个维度）。
//   · `readFile` 系列（只读）、`chmod/chown`；
//   · **非 fs 的写入**（本闸门只管 fs 调用；下面这些是另一个维度的写通道，列出来免得以为漏了）：
//       - `better-sqlite3`：SQL 层写 `.db`（`.qqbat/state.db` / `data/**/*.db`）—— 走
//         `baseSqliteStore` 与各 Service，不走 fs（源码级闸门看不到 SQL）；
//       - `child_process`：`git autoCommit`、`ssh`/`scp`、`docker`、终端 `node-pty` ——
//         真正的写发生在**那个程序**里，本闸门看不到；
//       - 插件沙箱内：**没有 `fs` / `require` / `process`**（见 `src/main/runtime/sandbox.ts`），
//         插件代码无法直接写盘；
//       - `fs-extra`：当前**零引用**（依赖里也没有）。它的写入 API 不在 `MUTATING_APIS` 里，
//         引入即等于绕过本闸门 ⇒ 下方有断言**禁止引入**（要用就改用 `node:fs`）。
//   · 经过**变量中转**的调用：**已纳入**（同文件能解析的都解析，跨模块导出记合成项）。
//     仍未覆盖（残余风险）：从**已登记**的包装模块 import 后使用（源头登记了，不再追下游）；
//     `fs[name]` 动态属性访问；把模块对象整个塞进数组 / 对象再取出的深层中转。
//   `open(path, 'w'|'a')` **已纳入** —— 它在语义上就是写。
import { describe, it, expect } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()

/** 会**改文件内容**的 fs API（含拷贝 / 搬运 / 删除 —— 它们同样能毁用户数据） */
const MUTATING_APIS = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'createWriteStream',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'truncate',
  'truncateSync',
])

/** 条件 API：第二参数是写模式时才算写点 */
const WRITE_MODES = /^[wa]/

/** fs 模块的说明符（含 node: 前缀与 promises 子路径） */
const FS_SPECIFIER = /^(node:)?fs(\/promises)?$/

export interface Offender {
  /** 归一化成 `/` 的相对路径（跨平台稳定） */
  file: string
  /** fs API 名；合成项见 SYNTHETIC_* */
  api: string
  count: number
}

interface Bindings {
  /** 本地名 → fs API 名（具名导入 / require 解构） */
  named: Map<string, string>
  /** 命名空间 / 默认导入 / `.then((m) => …)` 的本地名 */
  namespaces: Set<string>
  /** 有 import('fs') / require('fs') 但没解析出绑定 ⇒ 必须登记（判不准） */
  unresolved: boolean
  /** `export { … } from 'fs'` / `export * from 'fs'` ⇒ 包装器，必须登记 */
  reexports: boolean
  /** 把 fs 写 API 存进变量再导出（跨模块包装）⇒ 合成项，必须登记 */
  aliasExport: boolean
}

const SYNTHETIC_DYNAMIC = '<动态 fs 导入：无法静态解析>'
const SYNTHETIC_REEXPORT = '<re-export fs 写入 API>'
/** 把 fs 写 API 存进变量再**导出**（跨模块无法追踪使用方）⇒ 该文件必须登记 */
const SYNTHETIC_ALIAS_EXPORT = '<导出了 fs 写入 API 的别名：跨模块无法追踪>'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

function relOf(file: string): string {
  return relative(ROOT, file).split(sep).join('/')
}

/** `require('fs')` / `import('fs')` 这类**内联模块表达式** —— 它本身就是命名空间 */
function isInlineFsModule(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  const arg = node.arguments[0]
  if (!arg || !ts.isStringLiteral(arg) || !FS_SPECIFIER.test(arg.text)) return false
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  )
}

/**
 * `X.then((m) => …)` 里那个回调参数名。
 *
 * 为什么单列：`await import('fs/promises').then((m) => m.writeFile(...))` 是本仓库**真实存在**的
 * 写法（bot/policy.ts）—— 不认它，这条写点就会从闸门底下溜过去（假绿）。
 */
function thenParamOf(node: ts.CallExpression): string | null {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'then') return null
  const cb = node.arguments[0]
  const p0 =
    cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) ? cb.parameters[0] : undefined
  return p0 && ts.isIdentifier(p0.name) ? p0.name.text : null
}

/**
 * 解析一个表达式指向的 fs 能力：`{ api }` = 某个写 API；`{ ns }` = fs 命名空间本身；null = 不认。
 *
 * 认的形态（2026-10-18 补的「变量中转」盲区）：
 *   · 标识符 —— 之前解析出的具名绑定 / 命名空间（如 `const w = writeFile`）
 *   · `fs.writeFile` / `fs.promises.writeFile` / `require('fs').writeFile`
 *   · `fs.promises`（命名空间）· `require('fs')`（命名空间）
 *   · `fs.writeFile.bind(fs)`（bind 之后仍指向那个 API）
 */
function resolveFsRef(
  expr: ts.Expression,
  named: ReadonlyMap<string, string>,
  namespaces: ReadonlySet<string>,
): { api?: string; ns?: boolean } | null {
  if (ts.isIdentifier(expr)) {
    const api = named.get(expr.text)
    if (api) return { api }
    return namespaces.has(expr.text) ? { ns: true } : null
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression
    // X.bind(...) —— 句柄式绑定后仍是同一个 API
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'bind') {
      return resolveFsRef(callee.expression, named, namespaces)
    }
    // require('fs') / require('fs/promises')
    if (ts.isIdentifier(callee) && callee.text === 'require') {
      const arg = expr.arguments[0]
      if (arg && ts.isStringLiteral(arg) && FS_SPECIFIER.test(arg.text)) return { ns: true }
    }
    return null
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const objRef = resolveFsRef(expr.expression, named, namespaces)
    if (!objRef?.ns) return null
    const name = expr.name.text
    if (name === 'promises') return { ns: true }
    if (MUTATING_APIS.has(name) || name === 'open') return { api: name }
  }
  return null
}

/** 收集一个文件里的 fs 绑定（**所有导入写法**，正控会逐条验它） */
function collectBindings(sf: ts.SourceFile): Bindings {
  const named = new Map<string, string>()
  const namespaces = new Set<string>()
  let unresolved = false
  let reexports = false

  const bindNamed = (local: string, imported: string): void => {
    if (!MUTATING_APIS.has(imported) && imported !== 'open') return
    named.set(local, imported)
  }

  const visit = (n: ts.Node): void => {
    // —— 静态 import / export … from 'fs' ——
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      FS_SPECIFIER.test(n.moduleSpecifier.text)
    ) {
      const clause = n.importClause
      if (clause?.name) namespaces.add(clause.name.text) // import fs from 'fs/promises'
      const nb = clause?.namedBindings
      if (nb && ts.isNamespaceImport(nb)) namespaces.add(nb.name.text) // import * as fs from 'fs'
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const imported = (el.propertyName ?? el.name).text
          // `import { promises as fsp } from 'fs'` —— 拿到的是**命名空间**，不是某个 API
          if (imported === 'promises') {
            namespaces.add(el.name.text)
            continue
          }
          bindNamed(el.name.text, imported)
        }
      }
    }
    if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      FS_SPECIFIER.test(n.moduleSpecifier.text)
    ) {
      reexports = true
    }
    // —— require('fs') ——
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer)) {
      const call = n.initializer
      if (
        ts.isIdentifier(call.expression) &&
        call.expression.text === 'require' &&
        ts.isStringLiteral(call.arguments[0]) &&
        FS_SPECIFIER.test(call.arguments[0].text)
      ) {
        if (ts.isIdentifier(n.name)) namespaces.add(n.name.text) // const fs = require('fs')
        if (ts.isObjectBindingPattern(n.name)) {
          for (const el of n.name.elements) {
            if (!ts.isIdentifier(el.name)) continue
            const imported = ((el.propertyName as ts.Identifier | undefined) ?? el.name).text
            // `const { promises: fsp } = require('fs')` —— 同样是命名空间
            if (imported === 'promises') {
              namespaces.add(el.name.text)
              continue
            }
            bindNamed(el.name.text, imported)
          }
        }
      }
      void call
    }
    // —— await import('fs').then((m) => m.writeFile(...)) ——
    // 只认**对象是 fs 模块**的 .then —— 别的 thenable（fetch、promise 链）与这里无关
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'then' &&
      isInlineFsModule(n.expression.expression)
    ) {
      const thenParam = thenParamOf(n)
      if (thenParam) namespaces.add(thenParam)
      else unresolved = true // fs 的 .then 但取不出参数名（形态看不懂）⇒ 判不准
    }
    // —— 裸的 import('fs') / require('fs')（**没被解析出绑定**的才算无法解析）——
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0]
      if (ts.isStringLiteral(arg) && FS_SPECIFIER.test(arg.text)) {
        /** 它是不是 `import('fs').then((m) => …)` 的被调用者？那种形态上面已经解析出绑定了 */
        const parent = n.parent
        const handledByThen =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === n &&
          ts.isCallExpression(parent.parent) &&
          thenParamOf(parent.parent) !== null
        if (!handledByThen) unresolved = true
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'require'
    ) {
      const arg = n.arguments[0]
      if (arg && ts.isStringLiteral(arg) && FS_SPECIFIER.test(arg.text)) {
        // 三种已被解析的形态不算：`const fs = require(...)`、`const { a } = require(...)`、
        // `require('fs').api(...)`（属性访问由 apiOfProperty 处理）
        const parent = n.parent
        const bound =
          (ts.isVariableDeclaration(parent) &&
            parent.initializer === n &&
            (ts.isIdentifier(parent.name) || ts.isObjectBindingPattern(parent.name))) ||
          (ts.isPropertyAccessExpression(parent) && parent.expression === n)
        if (!bound) unresolved = true
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  /**
   * ── 变量中转 / 解构 / 再导出（2026-10-18 补的盲区）────────────────────────
   *
   * 以前只认「直接调用导入名」，于是 `const w = fs.writeFile; w(...)` 这种中转写法
   * 能整条从闸门底下溜过去（假绿）。这里做一次**不动点**解析：
   *   · `const w = fs.writeFile` / `const { writeFile: w } = fs` / `const p = fs.promises`
   *   · `const w = require('fs').writeFile` / `const w = fs.writeFile.bind(fs)`
   *   · `const { promises: fsp } = require('fs')`
   * 解析出来的名字写回 named / namespaces ⇒ 后面的调用扫描自然就认得。
   *
   * 跨模块的包装（`export const w = fs.writeFile` / `export { w }`）静态追不到使用方，
   * 所以记成**合成项**，让那个文件必须登记（源头登记了，下游才允许 import）。
   */
  const decls: ts.VariableDeclaration[] = []
  const exportDecls: ts.ExportDeclaration[] = []
  const collectDecls = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n)) decls.push(n)
    else if (ts.isExportDeclaration(n) && !n.moduleSpecifier) exportDecls.push(n)
    ts.forEachChild(n, collectDecls)
  }
  collectDecls(sf)

  let aliasExport = false
  const isExported = (d: ts.VariableDeclaration): boolean => {
    const list = d.parent
    if (!ts.isVariableDeclarationList(list)) return false
    const stmt = list.parent
    return (
      ts.isVariableStatement(stmt) &&
      (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0
    )
  }

  for (let pass = 0; pass <= decls.length + 1; pass += 1) {
    let changed = false
    /** 把 ref 解析结果登记到 local（幂等；真的新增了才置 changed） */
    const adopt = (local: string, ref: { api?: string; ns?: boolean } | null): void => {
      if (!ref) return
      if (ref.api && named.get(local) !== ref.api) {
        named.set(local, ref.api)
        changed = true
      }
      if (ref.ns && !namespaces.has(local)) {
        namespaces.add(local)
        changed = true
      }
    }
    for (const d of decls) {
      const init = d.initializer
      if (!init) continue
      // ① `const w = …`：标识符 / 属性访问 / 解构出的调用
      if (ts.isIdentifier(d.name)) {
        const ref = resolveFsRef(init, named, namespaces)
        adopt(d.name.text, ref)
        if (ref && isExported(d)) aliasExport = true
        continue
      }
      // ② `const { writeFile: w, promises: p } = fs`
      if (ts.isObjectBindingPattern(d.name)) {
        const base = resolveFsRef(init, named, namespaces)
        if (!base?.ns) continue
        for (const el of d.name.elements) {
          if (!ts.isIdentifier(el.name)) continue
          const prop = ((el.propertyName as ts.Identifier | undefined) ?? el.name).text
          if (prop === 'promises') adopt(el.name.text, { ns: true })
          else if (MUTATING_APIS.has(prop) || prop === 'open') {
            adopt(el.name.text, { api: prop })
          }
          if (isExported(d)) aliasExport = true
        }
      }
    }
    // ③ `export { w }`：导出的名字若是 fs 写 API 的别名 ⇒ 同样是跨模块包装
    for (const ed of exportDecls) {
      const clause = ed.exportClause
      if (!clause || !ts.isNamedExports(clause)) continue
      for (const el of clause.elements) {
        const local = (el.propertyName ?? el.name).text
        if (named.has(local) || namespaces.has(local)) aliasExport = true
      }
    }
    if (!changed) break
  }

  return { named, namespaces, unresolved, reexports, aliasExport }
}

/** 扫一个文件，返回 (api → 次数) */
export function scanSource(file: string, text: string): Offender[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const b = collectBindings(sf)
  const counts = new Map<string, number>()
  const bump = (api: string): void => {
    counts.set(api, (counts.get(api) ?? 0) + 1)
  }

  /** ns.api / ns.promises.api / require('fs').api 里的 api 名（不是写法就返回 null） */
  const apiOfProperty = (expr: ts.PropertyAccessExpression): string | null => {
    const obj = expr.expression
    if (isInlineFsModule(obj)) return expr.name.text // require('fs').writeFileSync(...)
    if (ts.isIdentifier(obj)) {
      if (b.namespaces.has(obj.text)) return expr.name.text
      return null
    }
    // ns.promises.api
    if (
      ts.isPropertyAccessExpression(obj) &&
      obj.name.text === 'promises' &&
      ts.isIdentifier(obj.expression) &&
      b.namespaces.has(obj.expression.text)
    ) {
      return expr.name.text
    }
    return null
  }

  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      // ① 具名绑定：writeFile(...) / open(...)
      if (ts.isIdentifier(callee)) {
        const api = b.named.get(callee.text)
        if (api && api !== 'open') bump(api)
        if (api === 'open') {
          const mode = n.arguments[1]
          if (mode && ts.isStringLiteral(mode) && WRITE_MODES.test(mode.text)) bump('open:write')
        }
      }
      // ③ 恢复产物的序列调用形态：(0, fs_promises.writeFile)(...)
      //    这是 tsc/rollup 把命名空间导入拆开后留下的写法（逗号表达式 + 括号），语义与 ② 相同。
      {
        const unwrapped = ts.isParenthesizedExpression(callee) ? callee.expression : callee
        const seq =
          ts.isBinaryExpression(unwrapped) &&
          unwrapped.operatorToken.kind === ts.SyntaxKind.CommaToken
            ? unwrapped.right
            : null
        if (seq && ts.isPropertyAccessExpression(seq)) {
          const api = apiOfProperty(seq)
          if (api && api !== 'open' && MUTATING_APIS.has(api)) bump(api)
          if (api === 'open') {
            const mode = n.arguments[1]
            if (mode && ts.isStringLiteral(mode) && WRITE_MODES.test(mode.text)) bump('open:write')
          }
        }
      }
      // ② 命名空间：fs.writeFile(...) / fs.promises.writeFile(...)
      if (ts.isPropertyAccessExpression(callee)) {
        const api = apiOfProperty(callee)
        if (api && api !== 'open' && MUTATING_APIS.has(api)) bump(api)
        if (api === 'open') {
          const mode = n.arguments[1]
          if (mode && ts.isStringLiteral(mode) && WRITE_MODES.test(mode.text)) bump('open:write')
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  if (b.unresolved) counts.set(SYNTHETIC_DYNAMIC, 1)
  if (b.reexports) counts.set(SYNTHETIC_REEXPORT, 1)
  if (b.aliasExport) counts.set(SYNTHETIC_ALIAS_EXPORT, 1)

  const fileRel = relOf(file)
  return [...counts.entries()].map(([api, count]) => ({ file: fileRel, api, count }))
}

/** 扫一批文件，把同 (file, api) 合并 */
export function scan(files: string[]): Offender[] {
  const merged = new Map<string, Offender>()
  for (const f of files) {
    for (const o of scanSource(f, readFileSync(f, 'utf-8'))) {
      const key = o.file + '|' + o.api
      const prev = merged.get(key)
      if (prev) prev.count += o.count
      else merged.set(key, { ...o })
    }
  }
  return [...merged.values()].sort((a, b) => (a.file + a.api).localeCompare(b.file + b.api))
}
// =============================================================================
// ALLOWED：每个直写点的**形态**与理由
// =============================================================================
//
// `counts` 是**这个文件里允许出现的直写点数**（按 API 计数）。它的作用不是文档，
// 而是**堵住假绿**：往一个已登记文件里新加一个绕过 fileOps 的写 ⇒ 计数对不上 ⇒ 闸门红。
// `why` 必须以形态标签开头（见 SHAPES）。
// =============================================================================
// ALLOWED：每个直写点的**形态**与理由
// =============================================================================
//
// counts 是**这个文件里允许出现的直写点数**（按 API 计数）。它的作用不是文档，
// 而是**堵住假绿**：往一个已登记文件里新加一个绕过 fileOps 的写 ⇒ 计数对不上 ⇒ 闸门红。
// why 必须以形态标签开头（见 SHAPES）。
const SHAPES = [
  '【fileOps 本体】',
  '【应用自有数据】',
  '【系统/非项目】',
  '【框架/备份】',
  '【沙箱夹具】',
  '【自带护栏】',
  '【待确认】',
] as const

interface Allowed {
  why: string
  counts: Record<string, number>
}

const ALLOWED: Record<string, Allowed> = {
  'src/main/services/agent-core/core.ts': {
    why: '【自带护栏】agent-core 的 write_file：路径先过 resolveInWorkspace（禁绝对/越界），再过写闸门 gate（未批准不落盘）—— 比 fileOps 兜底更严，且闸门就是产品要的审批',
    counts: { writeFile: 1 },
  },
  'src/main/runtime/waitRegistry.ts': {
    why: '【应用自有数据】跨事件挂起表 .qqbat/runtime/pending-waits.json（路径 = projectPath + 固定名）。写/删都是**同步**的（异步写会与\"删项目\"赛跑，撞 ENOTEMPTY）；删除只出现在\"正常停止\"时清文件',
    counts: { rmSync: 1, writeFileSync: 1 },
  },
  'src/main/services/ai/rag.ts': {
    why: '【应用自有数据】长期记忆 .qqbat/memory/vectors.jsonl（路径 = projectPath + 固定目录/文件名，不由用户输入决定）；只追加，写入失败一律静默（记忆是增益，不能影响对话）',
    counts: { appendFile: 1 },
  },
  'src/main/services/ai/spillStore.ts': {
    why: '【应用自有数据】工具结果溢出文件 .qqbat/ai-spill/**：同样的固定拼法',
    counts: { writeFile: 1 },
  },
  'src/main/services/ai/trace.ts': {
    why: '【应用自有数据】结构化 trace .qqbat/ai-trace*：复盘用，固定路径',
    counts: { appendFile: 1, writeFile: 1 },
  },
  'src/main/services/ai/presets.ts': {
    why: '【应用自有数据】会话预设（.qqbat/agent-presets.json）：预设文件本身就是内容，写入不需要 fileOps 的流程联动/冲刷屏障',
    counts: { writeFile: 1 },
  },
  'src/main/services/plugins/patchFile.ts': {
    why: '【应用自有数据】插件覆盖层（.qqbat/plugins.patch.json）：配置本身就是内容，不需要 fileOps 的流程联动',
    counts: { writeFile: 1 },
  },
  'src/main/services/plugins/pluginSettingsStore.ts': {
    why: '【系统/非项目】插件设置（<userData>/plugins/plugin-settings.json）：路径 = userData + 固定目录/文件名，**不在任何项目里**（插件是应用级能力，不跟项目走），因此不需要 fileOps 的项目联动/冲刷屏障',
    counts: { writeFile: 1 },
  },
  'src/main/services/builtinNodes/fileOperate.ts': {
    why: '【自带护栏】流程节点 file_operate：路径来自用户流程配置，节点自己按项目根解析并拒绝越界（见 fileOperateModes 测试）',
    counts: { copyFileSync: 1, renameSync: 1, unlinkSync: 1, writeFile: 1 },
  },
  'src/main/services/plugins/market.ts': {
    why: '【系统/非项目】插件市场：来源表/安装记录/插件目录都在 userData/market（不是项目目录）；安装先写目标目录、校验清单与哈希后才登记，失败回滚删除，不经过项目写通道',
    counts: { writeFile: 3, rm: 3 },
  },
  'src/main/ipc/plugins.ts': {
    why: '【自带护栏】插件导入：来源目录先过 assertOpenPathSafe（第 117 行，拒绝系统关键目录 / 可执行路径），目标 targetDir = plugins/<源目录 basename> 由应用拼接（basename 不可能是 ..），且再过 assertWithinProject(projectPath, targetDir)（第 152 行），并要求目标目录**不存在**（不覆盖已有插件）。不走 writeProjectFile 是刻意的：这里是**整目录复制**、且目标目录必须允许「不存在」，不是单文件写通道 —— 两道路径护栏已在，所以它不是【待确认】',
    counts: { copyFile: 1 },
  },
  'src/main/services/fileOps.ts': {
    why: '【fileOps 本体】它就是「项目内写」那条通道本身：writeProjectFile（含路径护栏/禁区/应用管理文件兜底）与 atomicWrite',
    counts: { writeFile: 2, rename: 1 },
  },
  'src/main/services/backupService.ts': {
    why: '【框架/备份】项目备份/恢复：读写 .qqbat/backups/** 或用户选定的备份目录 —— 它就是备份机制本身',
    counts: { copyFile: 3, unlink: 2, writeFile: 2 },
  },
  'src/main/services/baseSqliteStore.ts': {
    why: '【应用自有数据】删 SQLite 主库 + -wal/-shm（清空项目状态 / 用备份覆盖活库）：路径由各 store 自己拼好再交进来，删完由 store 重开',
    counts: { unlinkSync: 2 },
  },
  'src/main/services/benchmark.ts': {
    why: '【系统/非项目】性能基准：只在系统临时目录里造/删测试文件，并把结果写用户指定的报告路径',
    counts: { unlink: 2, writeFile: 2 },
  },
  'src/main/services/buttonPanelService.ts': {
    why: '【应用自有数据】按钮面板 .qqbat/button_panels.json：应用自己整体重写它（readOnly 清单里那个文件的应用侧写者）',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/configService.ts': {
    why: '【应用自有数据】配置表服务：写 data/config/**（项目根 + 表名拼出来），配置表自己的持久化层；rename/unlink 用于原子替换与删表',
    counts: { renameSync: 2, unlinkSync: 5, writeFileSync: 6 },
  },
  'src/main/services/crashReporter.ts': {
    why: '【系统/非项目】崩溃报告：写 appData 下的日志/转储，并清理旧文件',
    counts: { createWriteStream: 1, unlink: 2, writeFile: 1 },
  },
  'src/main/services/dataTemplateService.ts': {
    why: '【应用自有数据】数据模板服务：写 .qqbat/data-templates.json（固定名）',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/dataTransferService.ts': {
    why: '【应用自有数据】数据导入导出：写配置库/数据文件（目标由项目根拼）',
    counts: { writeFileSync: 3 },
  },
  'src/main/services/diagnostics.ts': {
    why: '【系统/非项目】诊断导出：流式写到用户选定的导出文件',
    counts: { createWriteStream: 1 },
  },
  'src/main/services/dockerExport.ts': {
    why: '【系统/非项目】Docker 部署包导出：写到用户选定的导出目录（含 package.json 与锁文件）',
    counts: { copyFile: 2, writeFile: 6 },
  },

  'src/main/services/deploy/runtimeBundle.ts': {
    why: '【系统/非项目】部署包装配：复制 out/main 到导出目录、写 electron 占位包与 package.json/锁文件清单；目标由部署流程指定，不是项目目录',
    counts: { copyFile: 2, writeFile: 2 },
  },
  'src/main/services/flow/forkNode.ts': {
    why: '【应用自有数据】「复制内置节点」：在项目 plugins/<plugin_custom-名_名>/ 下写 manifest.json + index.js 脚手架（名称经 JS_RESERVED / isValidPluginNodeKind 校验，目录由用户输入拼出）',
    counts: { writeFile: 2 },
  },
  'src/main/services/history.ts': {
    why: '【应用自有数据】流程历史快照（.qqbat/history/**）：历史就是已落盘的版本本身',
    counts: { copyFile: 2, unlink: 1 },
  },
  'src/main/services/ai/index.ts': {
    why: '【应用自有数据】清空对话记忆：删 .qqbat/ai-history*.jsonl（记忆是锦上添花，删失败只记日志）',
    counts: { rmSync: 1 },
  },
  'src/main/services/ai/tokenBudget.ts': {
    why: '【应用自有数据】工具结果溢出落盘：写 <项目>/.qqbat/ai-spill/<时间戳>.txt（未带项目时退到系统临时目录）',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/builtinNodes/persistentStore.ts': {
    why: '【应用自有数据】玩家存档 <项目>/data/players/persistent.db：copyFileSync 只出现在旧版全局库一次性迁移的**降级分支**（注入的测试后端没有 SQLite backup()），且仅在项目库不存在时复制、绝不覆盖、也绝不删除旧库；真实后端用 backup() 把 WAL 一起落盘',
    counts: { copyFileSync: 1 },
  },
  'src/main/services/project/configService.ts': {
    why: '【应用自有数据】配置表/表结构持久化：写 <项目>/data/config/** 的 JSON 与 schema，unlink 用于删表；与扁平 configService.ts 是同一职责的两份实现，去重前先按现状登记',
    counts: { unlinkSync: 3, writeFileSync: 7 },
  },
  'src/main/services/project/dataService.ts': {
    why: '【应用自有数据】数据层本体：rename 用于 .qqbat/backups 轮转归档，writeFileSync 写表结构快照（<项目>/data/schema.json）',
    counts: { renameSync: 1, writeFileSync: 1 },
  },
  'src/main/services/metricsExport.ts': {
    why: '【系统/非项目】指标导出（用户选定路径 / appData）',
    counts: { writeFileSync: 2 },
  },
  'src/main/services/bot/policy.ts': {
    why: '【应用自有数据】机器人用量记账与调用日志：.qqbat/bot-usage/<date>.json 与 .qqbat/bot-calls/<date>.log，路径 = projectPath + 固定目录/日期文件名；写失败只 warn，不影响回复',
    counts: { writeFile: 1 },
  },
  'src/main/services/ops/errorMonitoring.ts': {
    why: '【系统/非项目】错误监控：写 appData 下的日志目录（userDataPath(logs)），不是项目目录；这里用 require(fs/promises) 解构',
    counts: { writeFile: 1 },
  },
  'src/main/services/project.ts': {
    why: '【系统/非项目】项目生命周期：新建项目的 .env、克隆到新目录、删除项目目录 —— 目标是用户选定的路径，不是当前项目的通用写通道',
    counts: { cp: 1, rm: 1, writeFile: 1 },
  },

  'src/main/services/sshDeploy.ts': {
    why: '【系统/非项目】SSH 部署：只在系统临时目录打部署包（含 runtime+依赖清单），传完即删',
    counts: { rm: 2 },
  },
  'src/main/services/templates.ts': {
    why: '【系统/非项目】模板库：模板文件在 userData/templates（不是项目目录），导入/导出目标由用户选择',
    counts: { unlink: 2, writeFile: 3 },
  },
  'src/main/services/uidMappingService.ts': {
    why: '【应用自有数据】UID 映射表（.qqbat/ 下，固定名）',
    counts: { writeFileSync: 1 },
  },

  // ── 2026-10-24：闸门补认「(0, fs.writeFile)(...)」序列调用形态后暴露的存量登记 ──
  // 这些都是 10/18 产物原样还原的模块（@ts-nocheck，tsc 拆命名空间导入），
  // 以前整批从闸门底下漏过去（假绿）。逐条按真实写入目标登记；新加写点仍会被计数拦住。
  'src/main/runtime/previewRunner.ts': {
    why: '【系统/非项目】预览运行：把项目（含 .qqbat）复制到系统临时工作区，flow.json 改的是副本，不碰用户项目',
    counts: { cp: 2, writeFile: 1 },
  },
  'src/main/services/ai/historyStore.ts': {
    why: '【应用自有数据】对话历史 .qqbat/ai-history*.jsonl：追加、压缩后重写、清空',
    counts: { appendFile: 2, rm: 1, writeFile: 2 },
  },
  'src/main/services/bot/pending.ts': {
    why: '【应用自有数据】待确认动作 .qqbat/bot-pending/**.json：落盘 / 确认或作废时删除',
    counts: { rm: 1, writeFile: 1 },
  },
  'src/main/services/bot/policy.ts': {
    why: '【应用自有数据】用量账本 .qqbat/bot-usage/<date>.json 重写（动态 import fs.promises）+ 调用日志 .qqbat/bot-calls/<date>.log 追加，写失败只 warn',
    counts: { appendFile: 1, writeFile: 1 },
  },
  'src/main/services/devBackup/devBackup.ts': {
    why: '【框架/备份】开发模式备份：复制到用户选定的备份根（先写 tmp 再 rename，旧备份轮转删除），就是备份机制本身',
    counts: { copyFile: 2, rename: 1, rm: 3, writeFile: 1 },
  },
  'src/main/services/devBackup/devMode.ts': {
    why: '【系统/非项目】开发模式开关写 appData 下的 dev-mode.json',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/flow/flow.ts': {
    why: '【应用自有数据】schema 迁移后重写 .qqbat/flow.json（迁移前已 historyService.backup 落快照；flow.json 属应用管理文件）',
    counts: { writeFile: 1 },
  },
  'src/main/services/flow/history.ts': {
    why: '【应用自有数据】流程历史快照 .qqbat/history/**：复制快照、恢复覆盖、清理旧快照',
    counts: { copyFile: 2, unlink: 1 },
  },
  'src/main/services/flow/turnJournal.ts': {
    why: '【应用自有数据】轮次日志 .qqbat/history/turns/**：写 turn、撤回时还原 before 内容、清理旧轮次与数据快照',
    counts: { cp: 2, rm: 3, writeFile: 2 },
  },
  'src/main/services/infra/fileOps.ts': {
    why: '【fileOps 本体】writeProjectFile 与 atomicWrite 的实现：写、tmp→rename、失败清理 tmp',
    counts: { rename: 1, rm: 1, writeFile: 2 },
  },
  'src/main/services/infra/portLease.ts': {
    why: '【系统/非项目】端口租约 appData/port-leases/**：原子写 + 过期租约删除',
    counts: { renameSync: 1, unlinkSync: 1, writeFileSync: 1 },
  },
  'src/main/services/infra/sqliteFiles.ts': {
    why: '【应用自有数据】删 SQLite 主库旁的 -wal/-shm 辅助文件（store 开库前调用，路径由 store 给出）',
    counts: { unlinkSync: 1 },
  },
  'src/main/services/infra/tempWorkspace.ts': {
    why: '【系统/非项目】临时工作区创建与销毁（系统临时目录）',
    counts: { rm: 1 },
  },
  'src/main/services/infra/userDataMigration.ts': {
    why: '【系统/非项目】userData 迁移：整目录复制到新位置、写迁移标记、记录最近迁移清单（全在 appData 下）',
    counts: { cpSync: 2, writeFileSync: 3 },
  },
  'src/main/services/official/config.ts': {
    why: '【系统/非项目】官方协议端配置在 appData/official/**：删旧版本遗留配置文件',
    counts: { rm: 1 },
  },
  'src/main/services/ops/crashReporter.ts': {
    why: '【系统/非项目】崩溃报告写 appData 崩溃目录、轮转删旧报告、导出转储用流写用户选定路径',
    counts: { createWriteStream: 1, unlink: 2, writeFile: 1 },
  },
  'src/main/services/ops/git.ts': {
    why: '【应用自有数据】项目 git 仓库维护：补 .gitignore、撤销改动前备份/回写目标文件、坏 .git 目录归档改名',
    counts: { copyFile: 1, rename: 1, writeFile: 2 },
  },
  'src/main/services/plugins/aiNodeScaffold.ts': {
    why: '【应用自有数据】AI 生成节点包 plugins/ai-*/**：往 index.js 追加节点、写 manifest、覆盖包源（调用方已 recordFileBefore）',
    counts: { writeFile: 3 },
  },
  'src/main/services/plugins/customNodeScaffold.ts': {
    why: '【应用自有数据】新建自定义节点：写 plugins/<名>/manifest.json + index.js（目录名经 isValidPluginDirName 校验）',
    counts: { writeFile: 2 },
  },
  'src/main/services/project/buttonPanelService.ts': {
    why: '【应用自有数据】按钮面板库 .qqbat/button_panels.json 整体重写',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/project/panelSync.ts': {
    why: '【应用自有数据】面板同步日志 .qqbat/panel_sync.log 追加（只记同步事件）',
    counts: { appendFileSync: 1 },
  },
  'src/main/services/project/project.ts': {
    why: '【系统/非项目】项目生命周期：新建项目写 .env、删除项目目录、克隆到用户选定路径',
    counts: { cp: 1, rm: 1, writeFile: 1 },
  },
  'src/main/services/runner/eventBus.ts': {
    why: '【应用自有数据】翻译器 UID 映射 .qqbat/uid-map.json：重写并留 .bak 备份（写临时文件辅助函数在 :31）',
    counts: { writeFileSync: 3 },
  },
  // ── 2026-10-24：内建模块具名导入修成命名空间导入后，这三处写才被扫描器认出来 ──
  // 它们原先是 `import { fs } from "fs"`（拿到 undefined，调用直接抛
  // "Cannot read properties of undefined (reading 'join')"），修好后闸门立刻看见写入。
  'src/main/services/bot/uidMappingService.ts': {
    why: '【应用自有数据】玩家 UID 映射表 .qqbat/uid_mapping.json 整体重写（QQ 号 ↔ openid 对照）',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/project/dataTemplateService.ts': {
    why: '【应用自有数据】数据模板 .qqbat/data_template.json 整体重写（字段定义快照）',
    counts: { writeFileSync: 1 },
  },
  'src/main/services/project/playerSchemaService.ts': {
    why: '【应用自有数据】玩家字段表 data/players/player.schema.json 整体重写（玩家库表结构）',
    counts: { writeFileSync: 1 },
  },
}

// =============================================================================
// 检查
// =============================================================================

describe('★ 闸门：项目内的写必须走 fileOps（源码级）', () => {
  const files = walk(join(ROOT, 'src', 'main'))
  const offenders = scan(files)

  it('扫描确实在工作（防空转）', () => {
    expect(files.length, 'src/main 下的 .ts 文件数不对，闸门可能在空转').toBeGreaterThan(100)
    expect(offenders.length, '一个直写点都没扫到 —— 扫描逻辑坏了').toBeGreaterThan(20)
  })

  it('★ 每个直写点都登记了形态（新增的必须想清楚：为什么它可以不经过 fileOps）', () => {
    const unregistered = offenders
      .filter(o => !(o.file in ALLOWED) || !(o.api in (ALLOWED[o.file]?.counts ?? {})))
      .map(o => `${o.file}  →  ${o.api}（${o.count} 次）`)
    expect(
      unregistered,
      unregistered.length === 0
        ? ''
        : '这些地方**直接调用了 fs 写入/搬运/删除**，但没有登记形态。\n' +
            '项目内的写应当走 `writeProjectFile`（它带路径护栏 + 禁区 + 应用管理文件兜底）；\n' +
            '确实不该走的，请挑一个形态标签写进 ALLOWED 并给出理由：\n  ' +
            SHAPES.join(' / ') +
            '\n未登记：\n  ' +
            unregistered.join('\n  '),
    ).toEqual([])
  })

  it('★ 计数必须与登记一致（这条专堵"往已登记文件里偷偷加一个写"）', () => {
    const drift: string[] = []
    for (const o of offenders) {
      const allowed = ALLOWED[o.file]
      if (!allowed) continue
      const want = allowed.counts[o.api]
      if (want === undefined) continue // 未登记由上面那条用例报
      if (want !== o.count) drift.push(`${o.file} → ${o.api}：登记 ${want} 次，实际 ${o.count} 次`)
    }
    expect(
      drift,
      drift.length === 0
        ? ''
        : '写点数量与登记不一致 —— **新增/删除写点必须是有意识的**：\n' +
            '先确认它属于哪种形态（该走 fileOps 的改成 writeProjectFile），再改 ALLOWED 里的数字。\n  ' +
            drift.join('\n  '),
    ).toEqual([])
  })

  it('登记项不许是僵尸（文件没了 / 那个 API 不调了）', () => {
    const byFile = new Map<string, Map<string, number>>()
    for (const o of offenders) {
      const m = byFile.get(o.file) ?? new Map<string, number>()
      m.set(o.api, o.count)
      byFile.set(o.file, m)
    }
    const ghosts: string[] = []
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      const actual = byFile.get(file)
      if (!actual) {
        ghosts.push(`${file}（这个文件已经不再直写，或已被删除）`)
        continue
      }
      for (const api of Object.keys(allowed.counts)) {
        if (!actual.has(api)) ghosts.push(`${file} → ${api}`)
      }
    }
    expect(
      ghosts,
      `这些登记已经不成立了，删掉它们（否则闸门会慢慢失去意义）：\n  ${ghosts.join('\n  ')}`,
    ).toEqual([])
  })

  it('每个登记项都要有形态标签（判不准的必须写【待确认】，不许含糊）', () => {
    const bad = Object.entries(ALLOWED)
      .filter(([, v]) => !SHAPES.some(s => v.why.startsWith(s)))
      .map(([k]) => k)
    expect(bad, `这些登记项没写形态标签（${SHAPES.join(' / ')}）：\n  ${bad.join('\n  ')}`).toEqual(
      [],
    )
  })

  it('提示：当前直写点分布（供排期，不失败）', () => {
    let pending = 0
    for (const o of offenders) {
      if ((ALLOWED[o.file]?.why ?? '').startsWith('【待确认】')) pending += 1
    }
    console.log(
      `[projectWrites] 扫了 ${files.length} 个文件；直写点 ${offenders.reduce((s, o) => s + o.count, 0)} 处（` +
        `${offenders.length} 个 file|api 组合），登记 ${Object.keys(ALLOWED).length} 个文件；【待确认】条目 ${pending} 个。`,
    )
    expect(true).toBe(true)
  })
})

// =============================================================================
// 正控：检测器必须认得出**所有导入写法**（否则闸门就是假绿的）
// =============================================================================

describe('★ 正控：各种写法都要被抓到（防假绿）', () => {
  const cases: Array<{ name: string; code: string; expectApis: string[] }> = [
    {
      name: '具名导入',
      code: "import { writeFile } from 'fs/promises';\nwriteFile('a', 'x');",
      expectApis: ['writeFile'],
    },
    {
      name: '别名导入（正则最容易漏的那种）',
      code: "import { writeFile as wf } from 'node:fs/promises';\nawait wf('a', 'x');",
      expectApis: ['writeFile'],
    },
    {
      name: '命名空间导入 + promises',
      code: "import * as fs from 'fs';\nfs.writeFileSync('a', 'x');\nawait fs.promises.writeFile('b', 'y');",
      expectApis: ['writeFileSync', 'writeFile'],
    },
    {
      // 恢复树里大量 @ts-nocheck 文件是打包产物原样：tsc 会把命名空间调用拆成 (0, fs.writeFile)(...)
      name: '序列调用：(0, fs_promises.writeFile)(...)',
      code: "import * as fs_promises from 'fs/promises';\nawait (0, fs_promises.writeFile)('a', 'x');\nawait (0, fs_promises.mkdir)('b');",
      expectApis: ['writeFile'],
    },
    {
      name: '默认导入',
      code: "import fs from 'fs/promises';\nawait fs.rm('a');",
      expectApis: ['rm'],
    },
    {
      name: 'require 解构',
      code: "const { writeFile, unlink } = require('fs/promises');\nawait writeFile('a','x');\nawait unlink('a');",
      expectApis: ['writeFile', 'unlink'],
    },
    {
      name: 'await import(fs).then((m) => m.x(...))',
      code: "await import('fs/promises').then((m) => m.appendFile('a', 'x'));",
      expectApis: ['appendFile'],
    },
    {
      name: '无法静态解析的动态导入（判不准 ⇒ 必须登记）',
      code: "const fsMod = await import('fs/promises');\nawait fsMod.writeFile('a', 'x');",
      expectApis: [SYNTHETIC_DYNAMIC],
    },
    {
      name: '再导出（包装器）',
      code: "export { writeFile } from 'fs/promises';",
      expectApis: [SYNTHETIC_REEXPORT],
    },
    {
      name: "open(path, 'w') 也算写",
      code: "import { open } from 'fs/promises';\nconst h = await open('a', 'w');",
      expectApis: ['open:write'],
    },
    {
      name: "open(path, 'r') 不算写",
      code: "import { open } from 'fs/promises';\nconst h = await open('a', 'r');",
      expectApis: [],
    },
    // ── 2026-10-18 补：变量中转 / 解构 / bind（以前这些能整条绕过闸门 = 假绿）──
    {
      name: '变量中转：const wf = fs.writeFile; wf(...)',
      code: "import * as fs from 'fs/promises';\nconst wf = fs.writeFile;\nawait wf('a', 'x');",
      expectApis: ['writeFile'],
    },
    {
      name: '中转链：const a = writeFile; const b = a; b(...)',
      code: "import { writeFile } from 'fs/promises';\nconst a = writeFile;\nconst b = a;\nawait b('x', 'y');",
      expectApis: ['writeFile'],
    },
    {
      name: '解构中转：const { writeFile: w } = fs',
      code: "import * as fs from 'fs/promises';\nconst { writeFile: w } = fs;\nawait w('a', 'x');",
      expectApis: ['writeFile'],
    },
    {
      name: 'bind：const w = fs.writeFile.bind(fs)',
      code: "import * as fs from 'fs/promises';\nconst w = fs.writeFile.bind(fs);\nawait w('a', 'x');",
      expectApis: ['writeFile'],
    },
    {
      name: "import { promises as fsp } from 'fs' ⇒ fsp.writeFile 是写点",
      code: "import { promises as fsp } from 'fs';\nawait fsp.writeFile('a', 'x');",
      expectApis: ['writeFile'],
    },
    {
      name: "const { promises: fsp } = require('fs') ⇒ fsp.rm 是写点",
      code: "const { promises: fsp } = require('fs');\nawait fsp.rm('a');",
      expectApis: ['rm'],
    },
    {
      name: '跨模块包装：export const w = fs.writeFile ⇒ 合成项（必须登记）',
      code: "import * as fs from 'fs/promises';\nexport const w = fs.writeFile;",
      expectApis: [SYNTHETIC_ALIAS_EXPORT],
    },
    {
      name: '跨模块包装：const w = fs.writeFile; export { w } ⇒ 合成项',
      code: "import * as fs from 'fs/promises';\nconst w = fs.writeFile;\nexport { w };",
      expectApis: [SYNTHETIC_ALIAS_EXPORT],
    },
    // ── 明确**不扫**的：mkdir（只建空目录，见文件头）──
    {
      name: 'mkdir 刻意不报（它不改内容、不删数据）',
      code: "import { mkdir, mkdirSync } from 'fs';\nawait mkdir('a', { recursive: true });\nmkdirSync('b');",
      expectApis: [],
    },
    // ── 删除 / 递归复制 —— 最能毁数据的那一类，必须报 ──
    {
      name: '删除与递归复制都要报（rm / unlink / cp）',
      code: "import { rm, unlink, cp } from 'fs/promises';\nawait rm('a');\nawait unlink('a');\nawait cp('a', 'b');",
      expectApis: ['cp', 'rm', 'unlink'],
    },
  ]

  for (const c of cases) {
    it(`${c.name} ⇒ ${c.expectApis.length > 0 ? c.expectApis.join('+') : '不报'}`, () => {
      const found = scanSource('src/main/fixture.ts', c.code)
        .map(o => o.api)
        .sort()
      expect(found).toEqual([...c.expectApis].sort())
    })
  }

  it('★ 走 fileOps / atomicWrite 的写**不报**（合法写法不能被误伤）', () => {
    const code = [
      "import { writeProjectFile, atomicWrite } from '../services/infra/fileOps';",
      "await writeProjectFile(p, '.qqbat/flow.json', 'x');",
      "await atomicWrite('/abs/path/flow.json', 'x');",
    ].join('\n')
    expect(scanSource('src/main/fixture.ts', code)).toEqual([])
  })

  it('★ 端到端正控：临时目录里放一个未登记写点 ⇒ 扫描必须报出来', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-writegate-'))
    try {
      mkdirSync(join(dir, 'src', 'main', 'services', 'rogue'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'main', 'services', 'rogue', 'evil.ts'),
        "import { writeFileSync } from 'fs';\nwriteFileSync(process.env.HOME + '/x', 'boom');",
        'utf-8',
      )
      const found = scan(walk(join(dir, 'src', 'main')))
      expect(found.map(o => o.api)).toEqual(['writeFileSync'])
      expect(found[0].file).toContain('rogue/evil.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// =============================================================================
// 盘点：非 fs 的写通道（本闸门**管不到** —— 列清单 + 堵住「引入即绕过」的那一种）
// =============================================================================
//
// 为什么要有这一段：本闸门的判据是「调了哪个 fs API」，而项目里还有**不经过 fs** 的写。
// 它们不该被塞进 ALLOWED（那不是同一种东西），但也不能装作不存在 —— 所以在这里**机器盘点**：
//   · 清单型（better-sqlite3 / child_process）：只打印分布，不失败（数量随功能增长，不该红）；
//   · 禁止型（fs-extra）：**红了才对** —— 它的写入 API 不在 MUTATING_APIS 里，引入即静默绕过。

describe('★ 非 fs 写通道盘点（本闸门只管 fs；这些是另一个维度）', () => {
  const files = walk(join(ROOT, 'src', 'main'))
  const filesMatching = (re: RegExp): string[] =>
    files.filter(f => re.test(readFileSync(f, 'utf-8'))).map(relOf)

  it('提示：better-sqlite3 / child_process / mkdir 的当前分布（不失败，供监督）', () => {
    const sqlite = filesMatching(/better-sqlite3/)
    const child = filesMatching(/child_process/)
    const mkdirLines = files.reduce(
      (n, f) => n + (readFileSync(f, 'utf-8').match(/\bmkdir(Sync)?\s*\(/g) ?? []).length,
      0,
    )
    console.log(
      `[projectWrites] 非 fs 写通道：better-sqlite3 ${sqlite.length} 个文件、` +
        `child_process ${child.length} 个文件；mkdir/mkdirSync ${mkdirLines} 处（**未扫**，理由见文件头）。`,
    )
    // 防空转：正则失效时清单会变成 0，这条提示就失去信息量
    expect(sqlite.length).toBeGreaterThan(0)
    expect(child.length).toBeGreaterThan(0)
  })

  it('★ fs-extra 不许引入（它的写入 API 不在 MUTATING_APIS 里 ⇒ 会静默绕过闸门）', () => {
    const hit = filesMatching(/['\"]fs-extra['\"]/)
    expect(
      hit,
      '这些文件 import 了 fs-extra —— 它的 outputFile/writeJson 等不在扫描表里，闸门会静默放过。' +
        '改用 node:fs（或先扩展 MUTATING_APIS）：\n  ' +
        hit.join('\n  '),
    ).toEqual([])
  })
})
