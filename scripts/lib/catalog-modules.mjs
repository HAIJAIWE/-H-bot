// scripts/lib/catalog-modules.mjs
//
// 把 src/shared/nodes 的 TypeScript 目录源码**编译成 CommonJS 再 require**，
// 供 scripts/*.mjs 读取真实的节点目录数据（节点数、端口、选项、英文文案）。
//
// 为什么不用 jiti / tsx / esbuild：package.json 里这几个都不是依赖，恢复树也不该为
// 了几个校验脚本新增运行时。typescript 本身是 devDependency，调用它的 CLI 最稳。
//
// 为什么要落到磁盘：tsc 没有 "emit 到内存" 的 CLI 用法；输出放在 _recovery/.catalog-out
// （临时目录，clean:cache 不管它，删掉也会自动重建）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** 仓库根目录（scripts/lib/ 往上两级） */
export const ROOT = path.resolve(import.meta.dirname, '..', '..')

/** 编译输出目录 */
export const OUT_DIR = path.join(ROOT, '_recovery', '.catalog-out')

const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/**
 * 编译指定入口（连同它的依赖）到 OUT_DIR。
 *
 * 用 module=node16 + moduleResolution=node16：package.json 没有 "type": "module"，
 * 所以 .ts 会被编译成 CommonJS，Node 的 require 能直接解析源码里的无扩展名相对导入。
 */
export function compileCatalogSources(entries, { quiet = true } = {}) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  const args = [
    TSC,
    ...entries,
    '--outDir', OUT_DIR,
    '--rootDir', 'src',
    '--module', 'node16',
    '--moduleResolution', 'node16',
    '--target', 'ES2022',
    '--esModuleInterop',
    '--skipLibCheck',
    '--noEmitOnError', 'false',
  ]
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (!quiet && output.trim()) process.stderr.write(output)
  if (!fs.existsSync(OUT_DIR)) {
    throw new Error('编译节点目录失败：没有生成任何输出。\n' + output.slice(0, 4000))
  }
  return output
}

/** 加载编译产物里的一个模块（路径相对 OUT_DIR） */
function loadModule(rel) {
  const require = createRequire(path.join(OUT_DIR, 'noop.cjs'))
  return require(path.join(OUT_DIR, rel))
}

/**
 * 编译并加载目录相关的全部模块。
 *
 * @returns {{
 *   builtinCatalog: { NODE_CATALOG_V2: any[] },
 *   catalogBuild: { buildCatalog: (locale: string) => any[], collectMissingCopy: () => string[], resetMissingCopy: () => void },
 *   catalogEn: { CATALOG_EN_US: Record<string, any> },
 *   flowNormalize: { normalizeFlow: Function, validateFlow: Function },
 * }}
 */
export function loadCatalogModules({ quiet = true } = {}) {
  const output = compileCatalogSources(
    [
      'src/shared/nodes/catalog/build.ts',
      'src/shared/nodes/i18n/catalog.en-US.ts',
      'src/shared/nodes/flowNormalize.ts',
    ],
    { quiet },
  )
  try {
    return {
      builtinCatalog: loadModule('shared/nodes/builtinCatalog.js'),
      catalogBuild: loadModule('shared/nodes/catalog/build.js'),
      catalogEn: loadModule('shared/nodes/i18n/catalog.en-US.js'),
      flowNormalize: loadModule('shared/nodes/flowNormalize.js'),
    }
  } catch (err) {
    throw new Error(`加载编译后的目录模块失败：${err.message}\n${output.slice(0, 2000)}`)
  }
}
