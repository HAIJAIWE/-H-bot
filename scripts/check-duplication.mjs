#!/usr/bin/env node
// scripts/check-duplication.mjs
//
// 重复定义闸门（npm run check:duplication）。
//
// 两类问题分开处理：
//   · **错误**：同一个 kind 在多个节点定义文件里重复声明 —— 后注册的会覆盖先注册的，
//     而 flow.json 里只记 kind，等于用户数据会被另一份实现接管；
//   · **警告**：不同节点用了完全相同的 label / description —— 多半是复制粘贴后忘改，
//     画布上会出现两个同名节点，但运行期无歧义，所以先不挡。
//
// 只扫节点定义源（groups/*.ts 与 builtinCatalog.ts），因为这是"注册表"的唯一入口；
// 其它地方出现 'kind:' 字面量（比如代码生成器）不算重复定义。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, loadCatalogModules } from './lib/catalog-modules.mjs'

const errors = []
const warnings = []

const definitionFiles = [
  path.join(ROOT, 'src/shared/nodes/builtinCatalog.ts'),
  ...fs
    .readdirSync(path.join(ROOT, 'src/shared/nodes/groups'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(ROOT, 'src/shared/nodes/groups', name)),
]

// 端口也有 kind 字段（'control' | 'data'），不是节点定义，必须排除。
const PORT_KINDS = new Set(['control', 'data'])

const kindDeclarations = new Map()
for (const file of definitionFiles) {
  const text = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const pattern = /\bkind:\s*['"]([a-z0-9_]+)['"]/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (PORT_KINDS.has(match[1])) continue
    const line = text.slice(0, match.index).split('\n').length
    const owners = kindDeclarations.get(match[1]) ?? []
    owners.push(rel + ':' + line)
    kindDeclarations.set(match[1], owners)
  }
}
for (const [kind, owners] of kindDeclarations) {
  if (owners.length > 1) {
    errors.push(`节点 kind 被定义 ${owners.length} 次：${kind} → ${owners.join(', ')}`)
  }
}

const { builtinCatalog } = loadCatalogModules()
for (const field of ['label', 'description', 'summary']) {
  const owners = new Map()
  for (const spec of builtinCatalog.NODE_CATALOG_V2) {
    const value = spec[field]
    if (typeof value !== 'string' || value.trim() === '') continue
    const list = owners.get(value) ?? []
    list.push(spec.kind)
    owners.set(value, list)
  }
  for (const [value, kinds] of owners) {
    if (kinds.length > 1) {
      warnings.push(`${field} 完全相同：${kinds.join(' / ')} →「${value.slice(0, 40)}」`)
    }
  }
}

for (const item of warnings) console.warn('⚠ ' + item)
if (errors.length > 0) {
  console.error(`✖ check:duplication 失败（${errors.length} 项）：`)
  for (const item of errors) console.error('  - ' + item)
  process.exit(1)
}
console.log(
  `✓ check:duplication 通过：${kindDeclarations.size} 个 kind 各定义一次 / ${warnings.length} 条重复文案警告`,
)
