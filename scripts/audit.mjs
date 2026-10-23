// scripts/audit.mjs
//
// 恢复版 `pnpm audit` 的替代：**依赖声明 × 源码实际 import 的对账**。
//
// 为什么不是 `npm audit`：恢复树没有 package-lock.json（用的是 pnpm），`npm audit` 直接
// 报错；纯离线环境下也拿不到漏洞库。这个脚本做的是本地可判定、不会误报红的那部分：
//   1. src/main / src/preload / src/shared 里 import 的每个第三方包都必须声明在
//      dependencies（运行期依赖）里 —— 只写在 devDependencies 的包打包后会 ERR_MODULE_NOT_FOUND；
//   2. 完全没声明的包直接失败（幽灵依赖，靠 node_modules 扁平化碰运气）；
//   3. 生产依赖里没有任何源码 import 的，只警告（可能被动态 require / 构建期用）。
//
// src/renderer 是 Vite 打包进 bundle 的，它 import 的包可以放 devDependencies；
// 但 main / preload / shared 是运行期直接 require 的，必须在 dependencies 里。
//
// 扫描范围刻意不含 tests/ 与 scripts/：那里用 devDependencies 是正常的；
// src 下的 __tests__/ 与 *.d.ts 也跳过（它们是开发期文件，会被打包配置排除）。
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['src/main', 'src/preload', 'src/shared', 'src/renderer']
const SOURCE_EXT = /\.(ts|tsx|js|cjs|mjs)$/
const ALIAS_PREFIXES = ['@main/', '@shared/', '@renderer/', '@preload/', '@qqbot/', '@/']
const PROVIDED_BY_ELECTRON = new Set(['electron'])
// 生产依赖里确实没有源码 import、但必须保留的包（与 10/18 客户端声明一致）
const KNOWN_UNUSED = new Map([
  ['@types/react-window', '纯类型依赖（renderer 只 import 类型，编译期用）'],
  ['node-pty', '客户端同样声明；终端当前实现用 child_process（与客户端一致），留给后续升级'],
  ['yaml', '恢复期加入用于解析 electron-builder.yml（脚本用），运行期未 import；唯一多出客户端的依赖'],
])
const BUILTINS = new Set(builtinModules)
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i

const IMPORT_PATTERNS = [
  /(?:^|[^\w$.])(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"\n]+)['\"]/g,
  /(?:^|[^\w$.])require\s*\(\s*['\"]([^'\"\n]+)['\"]\s*\)/g,
  /(?:^|[^\w$.])import\s*\(\s*['\"]([^'\"\n]+)['\"]\s*\)/g,
]

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...walk(full))
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/** 取裸包名：@scope/pkg/sub → @scope/pkg；pkg/sub → pkg；非包说明符返回 null */
function packageName(specifier) {
  if (!specifier || specifier.includes('${') || /\s/.test(specifier)) return null
  if (specifier.startsWith('.')) return null
  if (/^(node|data|file|http|https):/.test(specifier)) return null
  for (const prefix of ALIAS_PREFIXES) if (specifier.startsWith(prefix)) return null
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return PACKAGE_NAME.test(name) ? name : null
}

function importsOf(source) {
  const found = new Set()
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) found.add(match[1])
  }
  return found
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const deps = new Set(Object.keys(pkg.dependencies ?? {}))
  const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}))
  const errors = []
  const warnings = []

  const usedBySource = new Map()
  let files = 0
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const file of walk(abs)) {
      files += 1
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
        const name = packageName(specifier)
        if (!name || BUILTINS.has(name)) continue
        if (!usedBySource.has(name)) usedBySource.set(name, { files: new Set(), runtime: false })
        const record = usedBySource.get(name)
        record.files.add(rel)
        if (!rel.startsWith('src/renderer/')) record.runtime = true
      }
    }
  }

  for (const [name, record] of usedBySource) {
    if (PROVIDED_BY_ELECTRON.has(name)) continue
    const where = [...record.files].slice(0, 3).join(', ')
    if (!deps.has(name) && !devDeps.has(name)) {
      errors.push('未声明的依赖: ' + name + '（' + where + '）')
    } else if (record.runtime && !deps.has(name) && devDeps.has(name)) {
      errors.push('运行期源码 import 了 devDependency: ' + name + '（' + where + '）')
    }
  }

  for (const name of deps) {
    if (usedBySource.has(name)) continue
    const reason = KNOWN_UNUSED.get(name)
    warnings.push(reason ? '生产依赖未在源码里 import（已知）: ' + name + ' —— ' + reason : '生产依赖没有被源码 import（确认是否动态 require / 构建期使用）: ' + name)
  }

  if (!fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml')) && !fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
    warnings.push('没有锁文件：pnpm-lock.yaml / package-lock.json 都不存在，部署脚本无法复现安装')
  }
  if (!pkg.engines || !pkg.engines.node) warnings.push('package.json 缺 engines.node（运行期要求 Node 22+）')

  console.log('依赖审计: ' + deps.size + ' 个生产依赖 / ' + devDeps.size + ' 个开发依赖；扫描 ' + files + ' 个源码文件，引用 ' + usedBySource.size + ' 个第三方包')
  for (const warning of warnings) console.warn('  ! ' + warning)
  if (errors.length > 0) {
    console.error('审计失败（' + errors.length + ' 项）：')
    for (const error of errors) console.error('  - ' + error)
    process.exit(1)
  }
  console.log('审计通过：源码 import 全部有声明')
}

main()