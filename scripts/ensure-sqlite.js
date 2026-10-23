#!/usr/bin/env node
/**
 * 确保 better-sqlite3 原生绑定在当前运行时可用。
 *
 * 用法：node scripts/ensure-sqlite.js <node|electron>
 *
 * 为什么需要它：better-sqlite3 早期版本按 ABI 编译，node 与 electron 的
 * NODE_MODULE_VERSION 不同，切 dev/test 时会报 "was compiled against a
 * different Node.js version"。12.x 之后改走 N-API，同一份 .node 两边都能
 * 加载，所以多数情况下这里只做探测后直接放行；只有探测失败时才用
 * prebuild-install 拉对应运行时的预编译包。
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

/** 在目标运行时里 require 一次 better-sqlite3。 */
function probe(runtime) {
  const res = spawnSync(
    runtime.exe,
    ['-e', "require('better-sqlite3'); console.log(process.versions.modules)"],
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

const prebuild = path.join(MODULE_DIR, 'node_modules', 'prebuild-install', 'bin.js')
if (!fs.existsSync(prebuild)) {
  fail('找不到 prebuild-install，无法自动重建；请检查依赖安装是否完整')
}

const install = spawnSync(
  process.execPath,
  [prebuild, `--runtime=${runtime.label}`, `--target=${runtime.version}`],
  { cwd: MODULE_DIR, stdio: 'inherit', timeout: 300_000 },
)
if (install.status !== 0) {
  fail(
    `prebuild-install 失败（退出码 ${install.status}）：多半是网络问题或该平台没有预编译包；` +
      '可先删掉 node_modules/better-sqlite3/build 再用本机构建工具重试',
  )
}

const after = probe(runtime)
if (!after.ok) {
  fail(`重建后仍不可用：\n${after.detail}`)
}
console.log(`✔ better-sqlite3 已在 ${runtime.label} 下就绪（ABI ${after.abi}）`)
