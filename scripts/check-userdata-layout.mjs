// scripts/check-userdata-layout.mjs
//
// userData 访问点闸门（ratchet）。
//
// 背景：2026-10-18 的隔离审计发现主进程有 13 处直接拼 app.getPath('userData')，
// 各自拼出 qqbat-data/official、根下平铺的 ai-config.json、templates/ 等。收敛方案是
// src/main/services/infra/paths.ts 作为唯一出入口（USER_DATA_LAYOUT + userDataPath()），
// 但恢复树里有 7 处历史调用早于收敛、且各有理由（见白名单 reason）。
//
// 这个闸门不改它们，只保证「不再变多」：
//   - 出现白名单之外的文件 → 失败（新代码必须走 paths.ts）；
//   - 某个文件的调用数超过登记数 → 失败；
//   - 登记数现在比实际多 → 失败（说明白名单过期了，删掉那行再提交）。
//
// 只扫 src/main（renderer / preload 拿不到 Electron app.getPath）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_ROOT = path.join(ROOT, 'src', 'main')
const PATTERN = /app\s*\.\s*getPath\s*\(\s*['"]userData['"]/g

/**
 * 存量白名单：file → { max, reason }。
 * max 是**现在**的调用数，不是上限；降到 0 时请连同这行一起删掉。
 */
const ALLOWED = {
  'src/main/services/infra/paths.ts': {
    max: 2,
    reason: '唯一出入口本身（userDataRoot / userDataPathOrThrow 各一次）',
  },
  'src/main/services/diagnostics.ts': {
    max: 2,
    reason: '诊断包要报 userData 根路径与占用体积，必须在路径收敛之外读根',
  },
  'src/main/services/crashReporter.ts': {
    max: 2,
    reason: 'crashReporter 在 app ready 前可能被调用，不能依赖 paths 的懒加载',
  },
  'src/main/services/official.ts': {
    max: 1,
    reason: '官方凭据旧位置（qqbat-data/official）迁移来源',
  },
  'src/main/services/templates.ts': {
    max: 1,
    reason: '模板目录（<userData>/templates）尚未纳入 USER_DATA_LAYOUT',
  },
}

/** 去掉注释，避免把说明文字里的示例当成真实调用 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile() && /\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

function main() {
  const problems = []
  const found = new Map()

  for (const file of walk(SCAN_ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    const code = stripComments(fs.readFileSync(file, 'utf8'))
    const matches = code.match(PATTERN) ?? []
    if (matches.length > 0) found.set(rel, matches.length)
  }

  for (const [file, count] of found) {
    const allowed = ALLOWED[file]
    if (!allowed) {
      problems.push(file + ': 直接调用 app.getPath("userData") ' + count + ' 次（新代码应走 services/infra/paths.ts）')
    } else if (count > allowed.max) {
      problems.push(file + ': ' + count + ' 次，超过登记的 ' + allowed.max + ' 次')
    }
  }
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    if (!found.has(file)) {
      problems.push(file + ': 白名单登记了 ' + allowed.max + ' 次，实际 0 次（删掉这条登记）')
    }
  }

  if (problems.length > 0) {
    console.error('check:userdata 失败（' + problems.length + ' 项）：')
    for (const problem of problems) console.error('  - ' + problem)
    process.exit(1)
  }

  const total = [...found.values()].reduce((sum, n) => sum + n, 0)
  console.log('check:userdata 通过：' + found.size + ' 个文件 / ' + total + ' 处直接访问（全部已登记）')
}

main()
