// scripts/benchmark.mjs
//
// 恢复版基准脚本：不依赖 jiti / 不跑真实机器人，只量『目录装配』与『流程图归一化』
// 这两个每次打开编辑器/导入 flow.json 都会走的热路径。
//
// 指标：
//   - buildCatalog: 把 76 个节点组装成指定语言目录（en-US 要克隆节点与端口）
//   - normalizeFlow: 模板风格 graph（节点没有端口定义）→ 补全端口 + 校验
//
// 用法：node scripts/benchmark.mjs [--rounds 5]
// 退出码恒为 0（基准不做通过/失败判定，避免慢机器把闸门刷红）。
import { loadCatalogModules } from './lib/catalog-modules.mjs'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function templateNode(index, kind) {
  return {
    id: 'n' + index,
    type: 'action',
    position: { x: 0, y: index * 40 },
    data: { label: kind, nodeKind: kind, config: {}, inputs: [], outputs: [] },
  }
}

function makeGraph(nodes) {
  return {
    schemaVersion: '1.1',
    systems: [],
    nodes,
    edges: [],
    variables: [],
    metadata: { name: 'benchmark', version: '1.0', runtime: 'typescript', createdAt: '', updatedAt: '' },
  }
}

function measure(rounds, fn) {
  const samples = []
  for (let i = 0; i < rounds; i += 1) {
    const start = process.hrtime.bigint()
    fn()
    samples.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  const best = samples[0]
  return { median, best, samples: samples.length }
}

function main() {
  const rounds = argValue('--rounds', 5)
  const { catalogBuild, flowNormalize } = loadCatalogModules()
  const zh = catalogBuild.buildCatalog('zh-CN')
  const kinds = zh.map((spec) => spec.kind)

  const buildZh = measure(rounds, () => catalogBuild.buildCatalog('zh-CN'))
  const buildEn = measure(rounds, () => catalogBuild.buildCatalog('en-US'))

  catalogBuild.resetMissingCopy()
  catalogBuild.buildCatalog('en-US')
  const missing = catalogBuild.collectMissingCopy().length

  const graph = makeGraph(Array.from({ length: 500 }, (_, i) => templateNode(i, kinds[i % kinds.length])))
  const normalize = measure(rounds, () => flowNormalize.normalizeFlow(graph))
  const validate = measure(rounds, () => flowNormalize.validateFlow(graph))

  const rows = [
    ['buildCatalog(zh-CN，恒等返回)', buildZh.median.toFixed(3) + ' ms'],
    ['buildCatalog(en-US，克隆节点+端口)', buildEn.median.toFixed(3) + ' ms'],
    ['normalizeFlow(500 节点，无端口定义)', normalize.median.toFixed(2) + ' ms'],
    ['validateFlow(500 节点)', validate.median.toFixed(2) + ' ms'],
  ]
  console.log('节点数: ' + zh.length + '；轮数: ' + rounds + '（取中位数）')
  console.log('缺译文: ' + missing + '（应为 0）')
  for (const [name, value] of rows) console.log('  ' + name.padEnd(38, ' ') + value)
}

main()
