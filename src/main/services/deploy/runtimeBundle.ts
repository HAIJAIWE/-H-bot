// src/main/services/deploy/runtimeBundle.ts
// TS 运行时的可移植打包：把 electron-vite 产出的 out/main 复制成部署包里的 runtime/，
// 并补一个 electron 占位模块，使 `node runtime/standalone.js <project>` 能脱离
// Electron 直接运行。
//
// 背景（ADR-003）：运行机器人不再生成 bot.py，流程由 FlowRuntime 直接解释
// .qqbat/flow.json。因此部署包 = 运行时 + 项目目录两部分，Dockerfile 也不再需要
// Python / pip / requirements.txt。
//
// 为什么不直接 import out/main 里的文件：部署到另一台机器（或镜像里）时没有
// node_modules，standalone.js 依赖的相对 chunk 必须整体带走（见 out/main/chunks）。
//
// 环境变量：QQBAT_STANDALONE_DIR 可指定运行时目录（打包前调试时用）。
import { app } from 'electron'
import { copyFile, mkdir, readdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

/** 运行时入口文件名（electron-vite 的 main 三入口之一） */
const STANDALONE_ENTRY = 'standalone.js'

/**
 * electron 占位包内容。
 *
 * standalone 链路里唯一在模块顶层执行的 `require('electron')` 在 FlowRuntime 的
 * chunk 里（`let electron = require("electron")`），拿到的对象只在 try/catch 内使用；
 * 其余 electron 引用（菜单、app.getPath 等）也都有降级分支。
 * 给它一个空对象即可让纯 Node 进程正常启动（2026-10-24 实测）。
 */
const ELECTRON_STUB_PACKAGE = JSON.stringify(
  { name: 'electron', version: '0.0.0-qqbat-stub', main: 'index.js', private: true },
  null,
  2
)
const ELECTRON_STUB_INDEX = [
  '// 部署包里的 electron 占位模块（生成逻辑见 src/main/services/deploy/runtimeBundle.ts）',
  '// standalone 运行时只需要一个对象，不需要真的 Electron。',
  'module.exports = {}',
  ''
].join('\n')

/** 运行时目录与打包统计 */
export interface RuntimeBundleResult {
  /** 源目录（out/main） */
  sourceDir: string
  /** 目标目录（<部署包>/runtime） */
  destDir: string
  /** 复制过去的文件数（含占位包） */
  fileCount: number
}

/**
 * 定位 TS 运行时目录（必须含 standalone.js）。
 *
 * 顺序：QQBAT_STANDALONE_DIR → <appPath>/out/main → <cwd>/out/main。
 * 找不到就抛错（提示先 build），而不是静默产出一个跑不起来的部署包。
 */
export function resolveRuntimeDir(): string {
  const candidates: string[] = []
  const fromEnv = process.env.QQBAT_STANDALONE_DIR
  if (fromEnv) candidates.push(fromEnv)
  try {
    candidates.push(join(app.getAppPath(), 'out', 'main'))
  } catch {
    // 纯 Node（测试 / standalone 自举）下没有 electron.app
  }
  candidates.push(join(process.cwd(), 'out', 'main'))
  for (const dir of candidates) {
    if (existsSync(join(dir, STANDALONE_ENTRY))) return dir
  }
  throw new Error(
    '找不到 TS 运行时（standalone.js）。它由 electron-vite 的 main 入口产出到 out/main，' +
      '请先执行 pnpm build；也可用环境变量 QQBAT_STANDALONE_DIR 指定。已查找: ' +
      candidates.join(', ')
  )
}

/** 递归复制目录（跳过 sourcemap 之外的临时文件；保留 chunks 子目录） */
async function copyRuntimeTree(src: string, dest: string): Promise<number> {
  await mkdir(dest, { recursive: true })
  let count = 0
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      count += await copyRuntimeTree(srcPath, destPath)
    } else if (entry.isFile()) {
      // .map 也带上：线上排查栈时能对回源码
      await copyFile(srcPath, destPath)
      count++
    }
  }
  return count
}

/**
 * 把运行时复制到 destDir，并写入 electron 占位包。
 *
 * destDir 通常是 <导出目录>/runtime；调用方负责先把项目目录复制好。
 */
export async function copyRuntimeBundle(destDir: string): Promise<RuntimeBundleResult> {
  const sourceDir = resolveRuntimeDir()
  let fileCount = await copyRuntimeTree(sourceDir, destDir)

  const stubDir = join(destDir, 'node_modules', 'electron')
  await mkdir(stubDir, { recursive: true })
  await writeFile(join(stubDir, 'package.json'), ELECTRON_STUB_PACKAGE + '\n', 'utf-8')
  await writeFile(join(stubDir, 'index.js'), ELECTRON_STUB_INDEX, 'utf-8')
  fileCount += 2

  return { sourceDir, destDir, fileCount }
}

/** 部署包内运行时的相对路径（Dockerfile / 远程启动命令共用，避免两处写死） */
export const RUNTIME_DIR_NAME = 'runtime'

/** 部署包内运行时入口的相对路径（POSIX 风格，供 shell / Dockerfile 使用） */
export function runtimeEntryRel(): string {
  return RUNTIME_DIR_NAME + '/' + STANDALONE_ENTRY
}

/**
 * 应用根目录（含 package.json 与 out/ 的目录）。
 *
 * Electron 下取 app.getAppPath()；纯 Node / 测试下回退 cwd，与 out/main 的定位口径一致。
 */
export function getAppRoot(): string {
  try {
    const root = app.getAppPath()
    if (root) return root
  } catch {
    // 纯 Node 下没有 electron.app
  }
  return process.cwd()
}

/** 探测可复现安装依赖用的锁文件（pnpm 优先，其次 npm） */
export function detectLockfile(appRoot: string = getAppRoot()): string | null {
  return ['pnpm-lock.yaml', 'package-lock.json'].find((f) => existsSync(join(appRoot, f))) ?? null
}

export interface RuntimeManifestResult {
  /** 复制过去的文件（package.json + 锁文件） */
  files: string[]
  /** 锁文件名（dockerExport / sshDeploy 用它决定安装命令） */
  lockfileName: string
}

/**
 * 把运行时依赖清单（package.json + 锁文件）复制到部署包根目录。
 *
 * 为什么必须有它：out/main 的 chunk 对 ws / zod / electron-log / better-sqlite3
 * 是 external（electron-vite 的 externalizeDepsPlugin），不会被打进包里。
 * 部署包只有运行时文件时，容器里 require("ws") 会直接 MODULE_NOT_FOUND；
 * 镜像构建阶段按这份清单 pnpm install --prod 才有 node_modules（better-sqlite3
 * 还能装上 Linux 预编译二进制，跨平台复制的 Windows .node 是不能用的）。
 */
export async function copyRuntimeManifest(destDir: string): Promise<RuntimeManifestResult> {
  const appRoot = getAppRoot()
  const lockfileName = detectLockfile(appRoot)
  if (!lockfileName) {
    throw new Error(
      '找不到锁文件（pnpm-lock.yaml / package-lock.json），无法在镜像或远程主机上可复现地安装运行时依赖'
    )
  }
  await mkdir(destDir, { recursive: true })
  const files: string[] = []
  for (const file of ['package.json', lockfileName]) {
    const src = join(appRoot, file)
    if (!existsSync(src)) {
      throw new Error('缺少运行时依赖清单: ' + src)
    }
    await copyFile(src, join(destDir, file))
    files.push(file)
  }
  return { files, lockfileName }
}

/**
 * 目标环境安装运行时依赖的 shell 片段（Dockerfile 与 SSH 远程共用同一套语义）。
 *
 * 两个必须的细节：
 * 1. `--ignore-scripts`：根 package.json 的 prepare 脚本（装 git hooks）在镜像/远程
 *    没有 .git 时不该跑，而且仓库里脚本文件不一定齐全 —— 关掉所有脚本再单独处理原生依赖。
 * 2. better-sqlite3 的原生二进制仍需现装（prebuild-install 拉当前平台的预编译），
 *    所以装完依赖后显式跑它，并 require 一遍确认真的能加载（装不上要在构建期就炸）。
 */
export function nodeInstallShell(lockfileName: string): string {
  const install =
    lockfileName === 'pnpm-lock.yaml'
      ? '(corepack enable || npm i -g pnpm@11.7.0) >/dev/null 2>&1; pnpm install --prod --frozen-lockfile --ignore-scripts'
      : 'npm ci --omit=dev --ignore-scripts'
  return (
    install +
    ' && (cd node_modules/better-sqlite3 && ./node_modules/.bin/prebuild-install)' +
    ' && node -e "require(\'better-sqlite3\')&&require(\'ws\')"'
  )
}
