#!/usr/bin/env node
/**
 * 安装 git 提交钩子（恢复期重写版）。
 *
 * 原始的 scripts/install-hooks.mjs 随源码丢失，10/18 打包产物里也没有。
 * 这里装一个最小、不会误伤历史提交的 pre-commit：
 *   1) 拒绝提交 node_modules / out / release / dist / _recovery / _baseline
 *   2) 拒绝提交单个超过 5MB 的文件（_baseline 里那份 asar 就是 70MB）
 *
 * 刻意不跑 prettier：仓库目前没有 .prettierrc（配置在恢复中丢失），用默认
 * 配置 --check 会把整库判红，--write 则会把几千个文件重排一遍。等格式化
 * 配置补回来再在钩子里加回格式化检查。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

let hasGit = true
try {
  git(['rev-parse', '--is-inside-work-tree'])
} catch {
  hasGit = false
}

if (!hasGit) {
  console.log('… 当前目录不是 git 仓库，跳过 git hooks 安装')
  process.exit(0)
}

const hooksDir = path.resolve(ROOT, git(['rev-parse', '--git-path', 'hooks']))
fs.mkdirSync(hooksDir, { recursive: true })

const hook = `#!/bin/sh
# 由 scripts/install-hooks.mjs 生成，请勿手改（改脚本后重跑 pnpm install / node scripts/install-hooks.mjs）。
set -e
staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0
bad=$(printf '%s\\n' "$staged" | grep -E '^(node_modules|out|release|dist|_recovery|_baseline)/' || true)
if [ -n "$bad" ]; then
  echo "✖ 拒绝提交构建/恢复产物（这些目录不随源码入库）："
  printf '%s\\n' "$bad"
  exit 1
fi
for f in $staged; do
  if [ -f "$f" ]; then
    size=$(wc -c < "$f" | tr -d ' ')
    if [ "$size" -gt 5242880 ]; then
      echo "✖ 单个文件超过 5MB：$f（$size 字节）"
      exit 1
    fi
  fi
done
exit 0
`

const target = path.join(hooksDir, 'pre-commit')
fs.writeFileSync(target, hook, { encoding: 'utf8', mode: 0o755 })
try {
  fs.chmodSync(target, 0o755)
} catch {
  // Windows 上 chmod 基本是空操作，git for windows 按 shebang 执行即可。
}
console.log(`✔ 已安装 pre-commit 钩子：${target}`)
