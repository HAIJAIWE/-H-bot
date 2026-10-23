#!/usr/bin/env node
// scripts/check-identity-conflicts.mjs
//
// 节点"身份"冲突闸门（npm run check:identity）。
//
// 这里的"身份"指运行期与代码生成器依赖的稳定标识：
//   · 节点 kind（写进 flow.json 的 type）
//   · 节点内端口 id（连线按 id 配对）
//   · 配置选项 value（写进 config，改动等于破坏老流程）
//   · toolName（AI 工具调用名，模型按名字选工具）
//
// 同一节点里出现两个同名端口 / 同值选项，或两个节点抢同一个 toolName，
// 都会让「点哪个都执行第一个」这类问题在运行期才暴露，必须在这里拦住。
import { loadCatalogModules } from './lib/catalog-modules.mjs'

const errors = []
const warnings = []
const { builtinCatalog } = loadCatalogModules()
const nodes = builtinCatalog.NODE_CATALOG_V2

const kindOwners = new Map()
const toolNameOwners = new Map()

for (const spec of nodes) {
  if (kindOwners.has(spec.kind)) {
    errors.push(`节点 kind 冲突：${spec.kind}（${kindOwners.get(spec.kind)} 与 ${spec.group}）`)
  } else {
    kindOwners.set(spec.kind, spec.group)
  }

  if (spec.toolName) {
    if (toolNameOwners.has(spec.toolName)) {
      errors.push(
        `toolName 冲突：${spec.toolName}（${toolNameOwners.get(spec.toolName)} 与 ${spec.kind}）——AI 调工具时会二选一，另一个永远调不到`,
      )
    } else {
      toolNameOwners.set(spec.toolName, spec.kind)
    }
  }

  const inputIds = new Set()
  const outputIds = new Set()
  for (const port of spec.inputs ?? []) {
    if (inputIds.has(port.id)) errors.push(`${spec.kind} 输入端口 id 重复：${port.id}`)
    inputIds.add(port.id)
  }
  for (const port of spec.outputs ?? []) {
    if (outputIds.has(port.id)) errors.push(`${spec.kind} 输出端口 id 重复：${port.id}`)
    outputIds.add(port.id)
  }
  for (const id of inputIds) {
    if (outputIds.has(id)) {
      warnings.push(`${spec.kind} 的输入/输出端口同名：${id}（连线时容易混，建议改名）`)
    }
  }

  const optionScopes = []
  for (const port of spec.inputs ?? []) {
    if (port.options) optionScopes.push([`inputs.${port.id}.options`, port.options])
  }
  for (const [field, options] of Object.entries(spec.configFieldOptions ?? {})) {
    optionScopes.push([`configFieldOptions.${field}`, options ?? []])
  }
  for (const [scope, options] of optionScopes) {
    const seen = new Map()
    for (const option of options) {
      if (seen.has(option.value)) {
        errors.push(`${spec.kind}.${scope} 选项 value 重复：${option.value}`)
      } else {
        seen.set(option.value, option.label)
      }
    }
  }
}

for (const item of warnings) console.warn('⚠ ' + item)
if (errors.length > 0) {
  console.error(`✖ check:identity 失败（${errors.length} 项）：`)
  for (const item of errors) console.error('  - ' + item)
  process.exit(1)
}
console.log(
  `✓ check:identity 通过：${nodes.length} 个节点 kind 唯一 / ${toolNameOwners.size} 个 toolName 唯一 / 端口与选项无冲突`,
)
