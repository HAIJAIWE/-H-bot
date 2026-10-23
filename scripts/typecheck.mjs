#!/usr/bin/env node
/**
 * 类型检查：node 与 web 两个 tsconfig 串行执行并汇总（恢复期重写版）。
 *
 * 用法：
 *   node scripts/typecheck.mjs           # 两个都查
 *   node scripts/typecheck.mjs node      # 只查主进程/测试
 *   node scripts/typecheck.mjs web       # 只查渲染层
 *
 * 与 package.json 里 typecheck:node / typecheck:web 等价，只是把两份输出
 * 汇总成一张表，并在失败时给出完整日志路径，方便直接定位。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const LOG_DIR = path.join(ROOT, '_recovery')

const TARGETS = [
  { name: 'node', config: 'tsconfig.node.json' },
  { name: 'web', config: 'tsconfig.web.json' },
]

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const picked = only.length ? TARGETS.filter((t) => only.includes(t.name)) : TARGETS
if (!picked.length) {
  console.error(`✖ 未知目标：${only.join(', ')}（只接受 node / web）`)
  process.exit(2)
}
if (!fs.existsSync(TSC)) {
  console.error('✖ 找不到 node_modules/typescript，先跑 pnpm install')
  process.exit(2)
}

fs.mkdirSync(LOG_DIR, { recursive: true })
let failed = 0
const rows = []

for (const t of picked) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [TSC, '--noEmit', '-p', t.config, '--pretty', 'false'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const stdout = String(res.stdout || '')
  const stderr = String(res.stderr || '')
  const errors = [...(stdout + stderr).matchAll(/error TS\d+/g)].length
  const logFile = path.join(LOG_DIR, `typecheck-${t.name}.log`)
  fs.writeFileSync(logFile, stdout + stderr, 'utf8')
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  rows.push({ ...t, status: res.status === 0 ? '✔' : '✖', errors, seconds, logFile })
  if (res.status !== 0) {
    failed += 1
    const first = (stdout + stderr)
      .split('\n')
      .filter((line) => /error TS\d+/.test(line))
      .slice(0, 15)
    if (first.length) console.log(`${t.name} 前 15 条错误：\n  ${first.join('\n  ')}`)
  }
}

console.log('')
for (const r of rows) {
  console.log(`${r.status} ${r.name.padEnd(4)} ${String(r.errors).padStart(4)} 个错误  ${r.seconds}s  日志：${path.relative(ROOT, r.logFile)}`)
}

if (failed) {
  console.error(`\n✖ 类型检查未通过（${failed}/${rows.length} 个目标）`)
  process.exit(1)
}
console.log('\n✔ 类型检查全部通过')
