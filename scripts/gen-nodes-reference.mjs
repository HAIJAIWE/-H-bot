// scripts/gen-nodes-reference.mjs
//
// 生成 docs/nodes-reference.md：把 NODE_CATALOG_V2 的契约字段摊平成一张可检索的表。
//
// 为什么需要：节点目录拆成 17 个 group 分片之后，「某个 kind 的端口/工具名/是否弃用」
// 在单文件里已经看不全了；这份文档给人和 AI 一个稳定的查询面，也是 docs:nodes:check
// 的比对目标。
//
// 用法：
//   node scripts/gen-nodes-reference.mjs          # 写文件
//   node scripts/gen-nodes-reference.mjs --check  # 只校验磁盘是否最新
//
// 恢复说明：原脚本依赖 jiti（恢复树没装），这里改用 scripts/lib/catalog-modules.mjs
// 的 tsc 编译方案，语义一致且不新增依赖。文档内容不写时间戳/绝对路径，保证可复现。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, loadCatalogModules } from './lib/catalog-modules.mjs'

const OUT_PATH = path.join(ROOT, 'docs', 'nodes-reference.md')
const HELP = '\u0060node scripts/gen-nodes-reference.mjs\u0060'

function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function portList(ports) {
  const list = (ports ?? []).map((port) => (port.dataType ? port.id + '(' + port.dataType + ')' : port.id))
  return list.length > 0 ? list.join('、') : '—'
}

function handlerText(spec) {
  if (spec.execution === 'handler') {
    const mod = spec.handler && spec.handler.module ? spec.handler.module : '?'
    return 'handler:' + mod
  }
  return spec.execution ?? 'graph'
}

function render(nodes) {
  const groups = new Map()
  for (const spec of nodes) {
    const group = spec.group ?? '未分组'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(spec)
  }

  const deprecated = nodes.filter((spec) => spec.deprecated)
  const out = [
    '<!-- 本文件由 scripts/gen-nodes-reference.mjs 生成，请勿手改；改节点请改 src/shared/nodes/groups/ 后重新生成 -->',
    '',
    '# 节点参考',
    '',
    '> 数据源：' + '\u0060src/shared/nodes/groups/*.ts\u0060' + ' 的 NODE_CATALOG_V2，共 **' + nodes.length + '** 个节点（其中弃用 **' + deprecated.length + '** 个）。',
    '>',
    '> 重新生成：' + HELP + '；校验：' + '\u0060node scripts/gen-nodes-reference.mjs --check\u0060' + '。',
    '',
    '## 分组一览',
    '',
    '| 分组 | 节点数 |',
    '| --- | --- |',
  ]
  for (const [group, specs] of groups) {
    out.push('| ' + cell(group) + ' | ' + specs.length + ' |')
  }

  for (const [group, specs] of groups) {
    out.push('', '## ' + group + '（' + specs.length + '）', '')
    out.push('| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |')
    out.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const spec of specs) {
      const tool = spec.exposedAsTool ? spec.toolName ?? spec.kind : '—'
      const note = spec.deprecated ? '已弃用（' + spec.deprecated.since + '）' : ''
      out.push(
        '| ' + '\u0060' + spec.kind + '\u0060' + ' | ' + cell(spec.label) + ' | ' + cell(handlerText(spec)) + ' | ' + cell(tool) + ' | ' + cell(portList(spec.inputs)) + ' | ' + cell(portList(spec.outputs)) + ' | ' + cell(note) + ' |',
      )
    }
  }

  out.push('', '## 已弃用节点', '')
  out.push('| kind | 名称 | 弃用版本 | 替代节点 | 原因 |')
  out.push('| --- | --- | --- | --- | --- |')
  for (const spec of deprecated) {
    const replaced = (spec.deprecated.replacedBy ?? []).map((kind) => '\u0060' + kind + '\u0060').join('、')
    out.push(
      '| ' + '\u0060' + spec.kind + '\u0060' + ' | ' + cell(spec.label) + ' | ' + cell(spec.deprecated.since) + ' | ' + cell(replaced) + ' | ' + cell(spec.deprecated.reason) + ' |',
    )
  }

  return out.join('\n') + '\n'
}

function main() {
  const check = process.argv.includes('--check')
  const { catalogBuild } = loadCatalogModules()
  const nodes = catalogBuild.buildCatalog('zh-CN')
  const next = render(nodes)

  if (check) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error('docs:nodes:check 失败：' + path.relative(ROOT, OUT_PATH) + ' 不存在')
      process.exit(1)
    }
    const disk = fs.readFileSync(OUT_PATH, 'utf8').replace(/\r\n/g, '\n')
    if (disk !== next) {
      console.error('docs:nodes:check 失败：docs/nodes-reference.md 不是最新')
      console.error('修法：node scripts/gen-nodes-reference.mjs')
      process.exit(1)
    }
    console.log('docs:nodes:check 通过：' + nodes.length + ' 个节点，文档最新')
    return
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, next, 'utf8')
  console.log('docs:nodes 完成: ' + nodes.length + ' 个节点 → ' + path.relative(ROOT, OUT_PATH))
}

main()
