#!/usr/bin/env node
/**
 * 清理可再生的构建/缓存目录（恢复期重写版）。
 *
 * 删除：out/、release/、node_modules/.vite、node_modules/.cache、
 *       根目录 *.tsbuildinfo
 * 保留：node_modules 本体、_baseline/、_recovery/、projects/、
 *       任何项目数据（.qqbat/ 在 projects 下面，不在清理范围）。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const targets = [
  'out',
  'release',
  path.join('node_modules', '.vite'),
  path.join('node_modules', '.cache'),
]

function dirSize(p) {
  let total = 0
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else if (entry.isFile()) total += fs.statSync(full).size
  }
  return total
}

let freed = 0
for (const rel of targets) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) continue
  const size = dirSize(full)
  fs.rmSync(full, { recursive: true, force: true })
  freed += size
  console.log(`✖ 已删除 ${rel}（${(size / 1024 / 1024).toFixed(2)} MB）`)
}

for (const name of fs.readdirSync(ROOT)) {
  if (!name.endsWith('.tsbuildinfo')) continue
  const full = path.join(ROOT, name)
  freed += fs.statSync(full).size
  fs.rmSync(full, { force: true })
  console.log(`✖ 已删除 ${name}`)
}

console.log(`✔ 清理完成，释放 ${(freed / 1024 / 1024).toFixed(2)} MB`)
