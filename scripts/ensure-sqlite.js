#!/usr/bin/env node
/**
 * 确保 better-sqlite3 原生绑定在当前运行时可用。
 *
 * 用法：node scripts/ensure-sqlite.js <node|electron>
 *
 * 为什么需要它：better-sqlite3 的 .node 是按 ABI 编译的，node 与 electron 的
 * NODE_MODULE_VERSION 不同（本机：Node 24 = 137，Electron 42 = 146），切 dev/test
 * 会报 "was compiled against a different Node.js version"。
 *
 * 注意：**只 require 测不出来** —— lib/database.js 把原生 addon 放在首次
 * new Database() 时才加载。探测必须真的建一个内存库（2026-10-24 踩过：脚本
 * 报可用，真机一开库就炸）。探测失败才用 prebuild-install 拉对应运行时的预编译包。
 *
 * 本文件是恢复期重写版（10/18 打包产物不含源码脚本，原始实现已不可得），
 * 语义按 package.json 的用法还原：dev/pack 依赖 electron 目标，test 依赖 node 目标。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const MODULE_DIR = path.join(ROOT, 'node_modules', 'better-sqlite3')
const target = String(process.argv[2] || 'node').toLowerCase()

function fail(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (target !== 'node' && target !== 'electron') {
  fail(`未知目标 "${target}"，只接受 node 或 electron`)
}
if (!fs.existsSync(MODULE_DIR)) {
  fail('node_modules/better-sqlite3 不存在，先跑 pnpm install')
}

/** @returns {{ label: string, exe: string, env: NodeJS.ProcessEnv, version: string }} */
function runtimeInfo() {
  if (target === 'node') {
    return { label: 'node', exe: process.execPath, env: { ...process.env }, version: process.versions.node }
  }
  let electronPath
  try {
    electronPath = require('electron')
  } catch {
    fail('未安装 electron，无法探测 Electron ABI')
  }
  if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
    fail(`electron 可执行文件不存在：${electronPath}`)
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'))
  return {
    label: 'electron',
    exe: electronPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    version: String(pkg.version),
  }
}

/**
 * 在目标运行时里真的**建一个内存库**。
 *
 * 只 require 是测不出 ABI 的：better-sqlite3 的 lib/database.js 把原生 addon 放在
 * 首次 new Database() 时才加载（DEFAULT_ADDON 懒加载）。2026-10-24 就因此假绿过：
 * 脚本报「electron 下可用（ABI 146）」，可真机一开库就 NODE_MODULE_VERSION 137/146 不匹配。
 */
function probe(runtime) {
  const res = spawnSync(
    runtime.exe,
    [
      '-e',
      "try { const D = require('better-sqlite3'); const db = new D(':memory:'); db.close(); console.log(process.versions.modules) } catch (e) { console.error(String((e && e.message) || e)); process.exit(1) }",
    ],
    { cwd: ROOT, env: runtime.env, encoding: 'utf8', timeout: 60_000 },
  )
  if (res.status === 0) return { ok: true, abi: String(res.stdout || '').trim() }
  return { ok: false, detail: `${res.stdout || ''}${res.stderr || res.error?.message || ''}`.trim() }
}

const runtime = runtimeInfo()
const before = probe(runtime)
if (before.ok) {
  console.log(`✔ better-sqlite3 在 ${runtime.label} 下可用（ABI ${before.abi}）`)
  process.exit(0)
}

console.log(`… better-sqlite3 在 ${runtime.label} 下不可用（version ${runtime.version}，ABI ${before.abi || '未知'}）`)
console.log(`  ${before.detail.split('\n').slice(0, 3).join('\n  ')}`)
console.log('… 尝试用 prebuild-install 安装对应运行时的预编译包')

const prebuild = findPrebuildInstall()
if (!prebuild) {
  giveUp('找不到 prebuild-install，无法自动重建', runtime)
  process.exit(0)
}

/**
 * 找 prebuild-install 的 bin.js。
 *
 * pnpm 布局下它**不是** better-sqlite3 的子依赖，而是 .pnpm 虚拟目录里的兄弟：
 *   node_modules/.pnpm/better-sqlite3@x/node_modules/prebuild-install/bin.js
 *   node_modules/.pnpm/prebuild-install@y/node_modules/prebuild-install/bin.js
 * 根 node_modules 通常也没有提升（所以 require.resolve 也会失败）。
 */
function findPrebuildInstall() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'prebuild-install', 'bin.js'),
    path.join(MODULE_DIR, 'node_modules', 'prebuild-install', 'bin.js'),
  ]
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('prebuild-install@')) {
        candidates.push(path.join(pnpmDir, entry, 'node_modules', 'prebuild-install', 'bin.js'))
      }
      if (entry.startsWith('better-sqlite3@')) {
        candidates.push(path.join(pnpmDir, entry, 'node_modules', 'prebuild-install', 'bin.js'))
      }
    }
  }
  return candidates.find((file) => fs.existsSync(file)) || null
}

/**
 * 目标运行时里有没有内置 node:sqlite（应用会用它兜底）。
 * 必须真的建一个内存库：Node 24 中它是内置的，但旧版本（如 Node 22 未开 flag）会抛。
 */
function fallbackAvailable(runtime) {
  const res = spawnSync(
    runtime.exe,
    [
      '-e',
      "try { const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('create table t(a)'); db.close(); console.log('ok') } catch (e) { console.error(String((e && e.message) || e)); process.exit(1) }",
    ],
    { cwd: ROOT, env: runtime.env, encoding: 'utf8', timeout: 60_000 },
  )
  return res.status === 0
}

/** 重建不了时的统一收尾：有 node:sqlite 兜底就放行（exit 0），否则失败 */
function giveUp(message, runtime) {
  if (fallbackAvailable(runtime)) {
    console.warn('⚠ ' + message)
    console.warn('  → 应用会自动使用 Node 内置的 node:sqlite 兜底，功能可用，可以继续 pnpm dev。')
    console.warn('  → 要换回原生模块：装好编译工具链后重跑本脚本（node scripts/ensure-sqlite.js electron）。')
    process.exit(0)
  }
  fail(message + '；当前运行时也没有 node:sqlite 兜底')
}

const install = spawnSync(
  process.execPath,
  [prebuild, `--runtime=${runtime.label}`, `--target=${runtime.version}`],
  { cwd: MODULE_DIR, stdio: 'inherit', timeout: 300_000 },
)
if (install.status !== 0) {
  giveUp(
    `prebuild-install 失败（退出码 ${install.status}）：多半是网络问题、该平台没有预编译包，或本机没有编译工具链`,
    runtime,
  )
  process.exit(0)
}

const after = probe(runtime)
if (!after.ok) {
  giveUp(`重建后仍不可用：
${after.detail}`, runtime)
  process.exit(0)
}
console.log(`✔ better-sqlite3 已在 ${runtime.label} 下就绪（ABI ${after.abi}）`)