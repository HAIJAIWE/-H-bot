// scripts/i18n-extract-copy.mjs
//
// 从**中文节点目录**提取文案，与现有英文表比对，产出 scripts/i18n/zh-en-map.json
// （英文文案的单一真相）。scripts/i18n-build-catalog.mjs 再由这份 map 生成
// src/shared/nodes/i18n/catalog.en-US.ts。
//
// 为什么是「反向重建」：10/18 打包客户端里只有生成结果（catalog.en-US.ts）与
// 使用方（build.ts），i18n 脚本与 scripts/i18n/ 目录在恢复树里整份缺失。这里按
// catalog.en-US.ts 的真实结构把 map 反推出来，之后新增/改文案都只动 map。
//
// 校验（任一不满足 exit 1，不给「静默回退中文」打掩护）：
//   - 中文目录里每个 kind 都要有英文条目，反之英文表不许有幽灵 kind；
//   - label 必须有；zh 有 description/summary 时英文也要有；
//   - 端口 id 集合、configFieldOptions 的 field/value 集合必须与中文目录一致；
//   - buildCatalog('en-US') 之后 collectMissingCopy() 必须为空。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, loadCatalogModules } from './lib/catalog-modules.mjs'

export const MAP_PATH = path.join(ROOT, 'scripts', 'i18n', 'zh-en-map.json')

const FIELD_ORDER = ['label', 'description', 'summary', 'tags', 'ports', 'options']

/** 固定字段顺序，保证 map 与生成文件每次都是同一份字节（check 才能直接比文本） */
function orderEntry(entry) {
  const out = {}
  for (const key of FIELD_ORDER) {
    if (entry[key] !== undefined) out[key] = entry[key]
  }
  for (const key of Object.keys(entry)) {
    if (!FIELD_ORDER.includes(key)) out[key] = entry[key]
  }
  return out
}

/** 端口条目里 name 是契约检查点，放最前面；其余字段保持原顺序 */
function orderPort(port) {
  const out = {}
  if (port.name !== undefined) out.name = port.name
  if (port.description !== undefined) out.description = port.description
  for (const key of Object.keys(port)) {
    if (key !== 'name' && key !== 'description') out[key] = port[key]
  }
  return out
}

function portIds(spec) {
  const ids = []
  for (const port of spec.inputs ?? []) ids.push('inputs.' + port.id)
  for (const port of spec.outputs ?? []) ids.push('outputs.' + port.id)
  return ids
}

/**
 * 选项文案的 key 集合。
 *
 * 英文表里的 options[field][value] 同时服务两类选项：
 *   - 端口的 options：key 是**端口 id**（build.ts: localizeOptions(port.options, copy, kind, port.id)）；
 *   - configFieldOptions：key 是字段名。
 * 两者可能同 key（如 mode 既是端口又是配置字段），value 集合按并集处理。
 */
function optionSlots(spec) {
  const slots = new Map()
  const add = (key, options) => {
    if (!Array.isArray(options)) return
    const values = slots.get(key) ?? new Set()
    for (const option of options) values.add(option.value)
    slots.set(key, values)
  }
  for (const port of spec.inputs ?? []) add(port.id, port.options)
  for (const port of spec.outputs ?? []) add(port.id, port.options)
  for (const [field, options] of Object.entries(spec.configFieldOptions ?? {})) add(field, options)
  return slots
}

function validate(zhCatalog, enCopy) {
  const problems = []
  const zhKinds = zhCatalog.map((spec) => spec.kind)
  const zhSet = new Set(zhKinds)
  const enKinds = Object.keys(enCopy)
  const enSet = new Set(enKinds)

  for (const kind of zhKinds) {
    if (!enSet.has(kind)) problems.push('缺少英文条目: ' + kind)
  }
  for (const kind of enKinds) {
    if (!zhSet.has(kind)) problems.push('英文表有幽灵条目（中文目录里没有这个 kind）: ' + kind)
  }

  for (const spec of zhCatalog) {
    const en = enCopy[spec.kind]
    if (!en) continue
    if (!en.label || !String(en.label).trim()) problems.push(spec.kind + ': 英文 label 为空')
    if (spec.description && !en.description) problems.push(spec.kind + ': 中文有 description，英文缺失')
    if (spec.summary && !en.summary) problems.push(spec.kind + ': 中文有 summary，英文缺失')

    const zhPorts = new Set(portIds(spec))
    const enPorts = new Set(Object.keys(en.ports ?? {}))
    for (const id of zhPorts) {
      if (!enPorts.has(id)) problems.push(spec.kind + ': 端口 ' + id + ' 缺英文')
    }
    for (const id of enPorts) {
      if (!zhPorts.has(id)) problems.push(spec.kind + ': 端口 ' + id + ' 是英文表里的幽灵')
    }

    const zhOptions = optionSlots(spec)
    const enOptions = en.options ?? {}
    for (const [field, values] of zhOptions) {
      const enField = enOptions[field] ?? {}
      for (const value of values) {
        if (!enField[value]) problems.push(spec.kind + ': 选项 ' + field + '=' + value + ' 缺英文')
      }
      for (const value of Object.keys(enField)) {
        if (!values.has(value)) problems.push(spec.kind + ': 选项 ' + field + '=' + value + ' 是英文表里的幽灵')
      }
    }
    for (const field of Object.keys(enOptions)) {
      if (!zhOptions.has(field)) problems.push(spec.kind + ': 选项字段 ' + field + ' 是英文表里的幽灵')
    }
  }

  return problems
}

export function buildMap(catalogBuild, catalogEn) {
  catalogBuild.resetMissingCopy()
  const zhCatalog = catalogBuild.buildCatalog('zh-CN')
  const enCopy = catalogEn.CATALOG_EN_US ?? {}

  const problems = validate(zhCatalog, enCopy)
  if (problems.length > 0) {
    return { problems, copy: null }
  }

  // 按中文目录顺序写出，字段/端口/选项顺序沿用英文表（客户端即此顺序）
  const copy = {}
  for (const spec of zhCatalog) {
    const en = enCopy[spec.kind]
    const entry = orderEntry(en)
    if (entry.ports) {
      entry.ports = Object.fromEntries(Object.entries(entry.ports).map(([id, port]) => [id, orderPort(port)]))
    }
    if (entry.options) {
      entry.options = Object.fromEntries(
        Object.entries(entry.options).map(([field, values]) => [
          field,
          Object.fromEntries(Object.entries(values).map(([value, option]) => [value, orderEntry(option)])),
        ]),
      )
    }
    copy[spec.kind] = entry
  }

  catalogBuild.resetMissingCopy()
  catalogBuild.buildCatalog('en-US')
  const missing = catalogBuild.collectMissingCopy()
  return { problems: missing.map((key) => 'buildCatalog 之后仍缺译文: ' + key), copy }
}

function main() {
  const { catalogBuild, catalogEn } = loadCatalogModules()
  const { problems, copy } = buildMap(catalogBuild, catalogEn)
  if (problems.length > 0) {
    console.error('i18n extract 失败（' + problems.length + ' 项）：')
    for (const problem of problems.slice(0, 80)) console.error('  - ' + problem)
    if (problems.length > 80) console.error('  …还有 ' + (problems.length - 80) + ' 项')
    process.exit(1)
  }

  const map = {
    version: 1,
    source: {
      zh: 'src/shared/nodes/groups/*.ts → NODE_CATALOG_V2（buildCatalog("zh-CN")）',
      en: '本文件是英文文案的单一真相；src/shared/nodes/i18n/catalog.en-US.ts 由 scripts/i18n-build-catalog.mjs 生成',
    },
    copy,
  }
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true })
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n', 'utf8')

  const kinds = Object.keys(copy).length
  let ports = 0
  let options = 0
  for (const entry of Object.values(copy)) {
    ports += Object.keys(entry.ports ?? {}).length
    for (const values of Object.values(entry.options ?? {})) options += Object.keys(values).length
  }
  console.log('i18n extract 完成: ' + kinds + ' 个节点 / ' + ports + ' 个端口 / ' + options + ' 个选项 → ' + path.relative(ROOT, MAP_PATH))
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main()
