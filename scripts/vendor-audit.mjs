// scripts/vendor-audit.mjs
//
// # 搬运代码的对账
//
// 三件事：目标文件在不在、目标哈希变没变（改了就说明有人手改过搬来的代码）、
// 上游快照在的话上游源文件哈希对不对（= MANIFEST 记的是不是真的）。
//
// 用法：
//   node scripts/vendor-audit.mjs            # 对账，失败退出码 1
//   node scripts/vendor-audit.mjs --update   # 重写 targetSha256（合上游改动之后用）
//
// 上游快照默认读 MANIFEST.upstream.snapshot；不在（比如 CI 没解压）就只对目标哈希，
// 并在输出里注明「上游快照不可用」。环境变量 DSH_UPSTREAM_DIR 可覆盖。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'src/main/vendor/dsh/MANIFEST.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const update = process.argv.includes('--update')

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const upstreamDir = process.env.DSH_UPSTREAM_DIR || join(root, manifest.upstream.snapshot)
const upstreamAvailable = existsSync(upstreamDir)

const failures = []
let checked = 0
let adaptationCount = 0

// 许可原文必须真的在（MIT 要求随附版权声明与许可全文）
const licensePath = join(root, manifest.upstream.licenseFile)
if (!existsSync(licensePath)) {
  failures.push(`许可原文缺失：${manifest.upstream.licenseFile}`)
} else {
  const license = readFileSync(licensePath, 'utf8')
  if (!license.includes('MIT License')) failures.push('许可原文不是 MIT 全文')
  if (!license.includes('Copyright (c) 2026 DeepSeek')) failures.push('许可原文缺上游版权行')
}

for (const entry of manifest.files) {
  const targetAbs = join(root, entry.targetPath)
  if (!existsSync(targetAbs)) {
    failures.push(`目标文件不存在：${entry.targetPath}`)
    continue
  }
  const targetHash = sha256(targetAbs)
  if (entry.kind === 'adaptation') {
    adaptationCount += 1
    if (update) entry.targetSha256 = targetHash
    continue
  }

  checked += 1
  if (update) {
    entry.targetSha256 = targetHash
    if (upstreamAvailable) entry.sourceSha256 = sha256(join(upstreamDir, entry.sourcePath))
    continue
  }
  if (entry.targetSha256 && entry.targetSha256 !== targetHash) {
    failures.push(
      `目标文件被手改过（与 MANIFEST 不一致）：${entry.targetPath}\n` +
        `  MANIFEST ${entry.targetSha256}\n` +
        `  实际     ${targetHash}`,
    )
  }
  if (upstreamAvailable && entry.sourceSha256) {
    const sourceHash = sha256(join(upstreamDir, entry.sourcePath))
    if (sourceHash !== entry.sourceSha256) {
      failures.push(`上游源文件与 MANIFEST 不一致：${entry.sourcePath}`)
    }
  }
}

if (update) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`已重写 ${manifestPath}（vendored ${checked} 个，适配层 ${adaptationCount} 个）`)
  process.exit(0)
}

console.log(
  `vendor-audit: vendored ${checked} 个文件，适配层 ${adaptationCount} 个；` +
    (upstreamAvailable
      ? `上游快照可对账（${manifest.upstream.tag}）`
      : '上游快照不可用，只对了目标哈希'),
)
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}
console.log('vendor-audit: OK')
