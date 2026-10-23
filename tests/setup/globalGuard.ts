// tests/setup/globalGuard.ts
//
// vitest.config.ts 的 globalSetup：整次运行前后给 `projects/` 下的用户项目拍哈希。
// 任何一处变动 → 整次运行以非 0 退出。
//
// 为什么需要：测试里大量用例会跑 FlowRuntime / botManager / 数据服务，它们默认往「当前工作目录下的
// projects/」写东西；一旦某个用例没把临时目录换掉，就会把用户真实项目改坏，而且单看某个用例是绿的。
// 这个守卫把「有没有污染用户数据」变成整轮的硬闸门。
//
// 判据：路径集合 + 每个文件的内容哈希（sha256 取前 16 位）相同 → 通过；任何新增/删除/改动都算违规。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const PROJECTS_DIR = join(process.cwd(), 'projects')

/** 跳过高频且无意义的目录：依赖、构建产物、git 内部、python venv。 */
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', '__pycache__', '.venv', 'venv'])

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
}

function snapshot(): Map<string, string> {
  const snap = new Map<string, string>()
  if (!existsSync(PROJECTS_DIR)) return snap
  const files: string[] = []
  walk(PROJECTS_DIR, files)
  for (const file of files) {
    try {
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
      snap.set(relative(PROJECTS_DIR, file).split('\\').join('/'), hash)
    } catch {
      // 运行中被删掉的文件也算违规：记成 <unreadable>，两边比对时自然会不等。
      snap.set(relative(PROJECTS_DIR, file).split('\\').join('/'), '<unreadable>')
    }
  }
  return snap
}

function diff(before: Map<string, string>, after: Map<string, string>): string[] {
  const problems: string[] = []
  for (const [path, hash] of after) {
    const old = before.get(path)
    if (old === undefined) problems.push(`新增：projects/${path}`)
    else if (old !== hash) problems.push(`改动：projects/${path}`)
  }
  for (const path of before.keys()) {
    if (!after.has(path)) problems.push(`删除：projects/${path}`)
  }
  return problems
}

export async function setup(): Promise<void> {
  const before = snapshot()
  // globalSetup 的 teardown 通过闭包拿 before；vitest 会先 setup 再 teardown，顺序有保证。
  const state = globalThis as { __qqbatProjectsBefore?: Map<string, string> }
  state.__qqbatProjectsBefore = before
}

export async function teardown(): Promise<void> {
  const state = globalThis as { __qqbatProjectsBefore?: Map<string, string> }
  const before = state.__qqbatProjectsBefore
  if (!before) return
  const problems = diff(before, snapshot())
  if (problems.length === 0) return
  const head = problems.slice(0, 20)
  const more = problems.length > head.length ? `\n…另有 ${problems.length - head.length} 处` : ''
  throw new Error(
    '测试污染了用户项目目录（projects/），本次运行判为失败：\n' + head.map((p) => `  · ${p}`).join('\n') + more,
  )
}
