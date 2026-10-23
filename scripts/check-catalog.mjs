#!/usr/bin/env node
// scripts/check-catalog.mjs
//
// 节点目录闸门（npm run check:catalog）：
//   1. 契约层 builtinCatalog.ts 里的 kind 必须唯一；
//   2. 英文文案层 catalog.en-US.ts 必须与契约逐项对齐：
//      节点 / 端口（inputs.* / outputs.*）/ 选项（configFieldOptions 与端口 options）/
//      zh 有 description 或 summary 时 en 也必须有（buildCatalog 会登记到 missingCopy）；
//   3. 反向检查"多出来的文案"——契约里已经没有的 kind / 端口 / 选项值不许留文案，
//      否则删节点后英文表会悄悄烂掉。
//
// 历史：10/18 打包客户端里这个脚本存在，但源码已随恢复丢失（见
// docs/restore/client-diff-audit-2026-10-24.md）。本文件按 catalog/build.ts 里
// 「缺失由 collectMissingCopy 报出、供 scripts/check-catalog.mjs 断言为 0」的约定重建。
import { loadCatalogModules } from './lib/catalog-modules.mjs'

const errors = []
const warnings = []

function fail(message) {
  errors.push(message)
}

const { builtinCatalog, catalogBuild, catalogEn } = loadCatalogModules()
const nodes = builtinCatalog.NODE_CATALOG_V2
const copy = catalogEn.CATALOG_EN_US

// —— 1. 契约层：kind 唯一 ——
const seenKinds = new Map()
for (const spec of nodes) {
  const prev = seenKinds.get(spec.kind)
  if (prev) fail(`契约层 kind 重复：${spec.kind}（${prev.group} / ${spec.group}）`)
  else seenKinds.set(spec.kind, spec)
}

// —— 2. 文案层：跑一次英文目录，收集 buildCatalog 登记的缺译文 ——
catalogBuild.resetMissingCopy()
catalogBuild.buildCatalog('en-US')
const missing = catalogBuild.collectMissingCopy()
for (const item of missing) fail(`缺英文文案：${item}`)

// —— 3. 文案层：逐节点结构对齐 + 反向多余检查 ——
const expectedPortKeys = new Set()
const expectedOptionPaths = new Set()
for (const spec of nodes) {
  const nodeCopy = copy[spec.kind]
  if (!nodeCopy) {
    fail(`英文文案缺节点：${spec.kind}`)
    continue
  }
  if (!nodeCopy.label) fail(`英文文案缺 label：${spec.kind}`)
  if (spec.description && !nodeCopy.description) {
    fail(`英文文案缺 description：${spec.kind}`)
  }
  if (spec.summary && !nodeCopy.summary) fail(`英文文案缺 summary：${spec.kind}`)
  if (spec.tags.length > 0 && (!nodeCopy.tags || nodeCopy.tags.length === 0)) {
    warnings.push(`英文文案没有 tags（中文有 ${spec.tags.length} 个）：${spec.kind}`)
  }

  for (const dir of ['inputs', 'outputs']) {
    for (const port of spec[dir] ?? []) {
      const key = `${dir}.${port.id}`
      expectedPortKeys.add(`${spec.kind}::${key}`)
      if (!nodeCopy.ports?.[key]) fail(`英文文案缺端口：${spec.kind}.${key}`)
      if (port.description && !nodeCopy.ports?.[key]?.description) {
        fail(`英文文案缺端口说明：${spec.kind}.${key}.description`)
      }
      for (const option of port.options ?? []) {
        expectedOptionPaths.add(`${spec.kind}::${port.id}::${option.value}`)
        if (!nodeCopy.options?.[port.id]?.[option.value]) {
          fail(`英文文案缺端口选项：${spec.kind}.options.${port.id}=${option.value}`)
        }
      }
    }
  }

  for (const [field, options] of Object.entries(spec.configFieldOptions ?? {})) {
    for (const option of options ?? []) {
      expectedOptionPaths.add(`${spec.kind}::${field}::${option.value}`)
      if (!nodeCopy.options?.[field]?.[option.value]) {
        fail(`英文文案缺选项：${spec.kind}.options.${field}=${option.value}`)
      }
    }
  }
}

for (const kind of Object.keys(copy)) {
  if (!seenKinds.has(kind)) fail(`英文文案多出节点（契约层没有）：${kind}`)
}
for (const [kind, nodeCopy] of Object.entries(copy)) {
  for (const key of Object.keys(nodeCopy.ports ?? {})) {
    if (!expectedPortKeys.has(`${kind}::${key}`)) {
      fail(`英文文案多出端口：${kind}.${key}`)
    }
  }
  for (const [field, values] of Object.entries(nodeCopy.options ?? {})) {
    for (const value of Object.keys(values ?? {})) {
      if (!expectedOptionPaths.has(`${kind}::${field}::${value}`)) {
        fail(`英文文案多出选项：${kind}.options.${field}=${value}`)
      }
    }
  }
}

for (const item of warnings) console.warn('⚠ ' + item)
if (errors.length > 0) {
  console.error(`✖ check:catalog 失败（${errors.length} 项）：`)
  for (const item of errors.slice(0, 60)) console.error('  - ' + item)
  if (errors.length > 60) console.error(`  … 其余 ${errors.length - 60} 项省略`)
  process.exit(1)
}
console.log(`✓ check:catalog 通过：${nodes.length} 个节点 / ${Object.keys(copy).length} 份英文文案 / 0 缺译文`)
