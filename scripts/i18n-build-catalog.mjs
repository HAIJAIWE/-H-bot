// scripts/i18n-build-catalog.mjs
//
// 由 scripts/i18n/zh-en-map.json 生成 src/shared/nodes/i18n/catalog.en-US.ts。
//
// 两种用法：
//   node scripts/i18n-build-catalog.mjs          # 写文件
//   node scripts/i18n-build-catalog.mjs --check  # 只校验磁盘与 map 是否一致（不依赖 git）
//
// --check 直接比文本：map 的字段顺序固定（extract 已排序），生成器输出是确定的，
// 所以同一份 map 永远得到同一份字节。恢复树没有 .git，原来的 check:i18n 用
// `git diff --exit-code` 判漂移在这条线上永远失败，这里换成语义等价的文本比对。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/catalog-modules.mjs'

const MAP_PATH = path.join(ROOT, 'scripts', 'i18n', 'zh-en-map.json')
const OUT_PATH = path.join(ROOT, 'src', 'shared', 'nodes', 'i18n', 'catalog.en-US.ts')

const HEADER = [
  '// src/shared/nodes/i18n/catalog.en-US.ts',
  '//',
  '// 英文节点文案（**由 scripts/i18n-build-catalog.mjs 生成，请勿手改**）。',
  '//',
  '// 结构由中文目录逐项映射而来，与契约层（builtinCatalog.ts）的 kind / 端口 id /',
  '// 选项 value 一一对应；改文案请改 scripts/i18n/zh-en-map.json 后重新生成。',
  '//',
  '// 契约字段（handler / toolName / showWhen / 选项 value / defaultConfig）不在此文件：',
  '// 它们被运行时与代码生成器依赖，**必须**单一真相，见 copy.types.ts 的说明。',
  "import type { CatalogCopy } from './copy.types';",
  '',
  '',
]

export function renderCatalogSource(copy) {
  return HEADER.join('\n') + 'export const CATALOG_EN_US: CatalogCopy = ' + JSON.stringify(copy, null, 2) + ';\n'
}

export function loadMap() {
  if (!fs.existsSync(MAP_PATH)) {
    throw new Error('缺少 ' + path.relative(ROOT, MAP_PATH) + '，先跑 node scripts/i18n-extract-copy.mjs')
  }
  const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))
  if (!map || typeof map !== 'object' || !map.copy || typeof map.copy !== 'object') {
    throw new Error('zh-en-map.json 结构不对：缺 copy 对象')
  }
  return map
}

/** 把两边都解析成对象再比，避免换行符差异（CRLF/末尾换行）造成假红 */
function sameText(a, b) {
  const normalize = (text) => JSON.stringify(JSON.parse(text.slice(text.indexOf('= {') + 2).replace(/;\s*$/, '')))
  try {
    return normalize(a) === normalize(b)
  } catch {
    return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
  }
}

function firstDiffLine(a, b) {
  const left = a.replace(/\r\n/g, '\n').split('\n')
  const right = b.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return { line: i + 1, fromMap: left[i] ?? '', onDisk: right[i] ?? '' }
    }
  }
  return null
}

function main() {
  const check = process.argv.includes('--check')
  let map
  try {
    map = loadMap()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  const next = renderCatalogSource(map.copy)
  if (check) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error('i18n check 失败：' + path.relative(ROOT, OUT_PATH) + ' 不存在')
      process.exit(1)
    }
    const disk = fs.readFileSync(OUT_PATH, 'utf8')
    if (!sameText(next, disk)) {
      const diff = firstDiffLine(next, disk)
      console.error('i18n check 失败：catalog.en-US.ts 与 zh-en-map.json 不一致')
      if (diff) {
        console.error('  第一处差异在第 ' + diff.line + ' 行')
        console.error('  map 生成: ' + diff.fromMap)
        console.error('  磁盘上  : ' + diff.onDisk)
      }
      console.error('修法：node scripts/i18n-build-catalog.mjs（会重写该文件）')
      process.exit(1)
    }
    console.log('i18n check 通过：catalog.en-US.ts 与 zh-en-map.json 一致（' + Object.keys(map.copy).length + ' 个节点）')
    return
  }

  fs.writeFileSync(OUT_PATH, next, 'utf8')
  console.log('i18n build 完成: ' + Object.keys(map.copy).length + ' 个节点 → ' + path.relative(ROOT, OUT_PATH))
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main()
