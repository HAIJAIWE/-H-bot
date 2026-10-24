// tests/guards/noPythonStack.test.ts
// 守卫：Python 技术栈已整体退役（ADR-003：运行时是 TS，机器人不再 spawn Python 子进程）。
// 仓库里不该再有可执行的 Python 资产，也不该再有 Python 专用校验/路径/缓存忽略项。
// 历史迁移注释里出现的「Python」是叙事（说明删了什么），不算违规；下面这些**代码级标识**
// 一旦回来，就说明有人把旧栈从产物里搬了回来。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '_recovery', '_baseline', 'dist', 'out', 'projects'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const repoFiles = walk(ROOT)
const tsFiles = repoFiles.filter((f) => /[\\/]src[\\/].*\.tsx?$/.test(f))

function rel(file: string): string {
  return file.slice(ROOT.length + 1)
}

describe('Python 技术栈不再存在', () => {
  it('仓库里没有 .py 文件（tests/python 已随旧栈删除）', () => {
    expect(repoFiles.filter((f) => f.endsWith('.py')).map(rel)).toEqual([])
  })

  it('src 里没有 Python 专用标识（pythonPath / __pycache__ / qqbat_nodes / nonebot）', () => {
    const banned = ['pythonPath', '__pycache__', '.pytest_cache', 'qqbat_nodes', 'nonebot', '.pyc', 'python3']
    const offenders: string[] = []
    for (const file of tsFiles) {
      const text = readFileSync(file, 'utf-8')
      for (const token of banned) {
        if (text.includes(token)) offenders.push(`${rel(file)} → ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('Python 专用校验函数没有回来', () => {
    const banned = ['isCommandAllowed', 'assessCodeRisk', 'assertPythonPathSafe', 'RUN_COMMAND_WHITELIST']
    const offenders: string[] = []
    for (const file of tsFiles) {
      const text = readFileSync(file, 'utf-8')
      for (const token of banned) {
        if (text.includes(token)) offenders.push(`${rel(file)} → ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('导出/资源管理器不再列 Python 缓存目录', () => {
    expect(readFileSync(join(ROOT, 'src/renderer/src/components/editor/FileExplorer.tsx'), 'utf-8')).not.toContain('__pycache__')
    expect(readFileSync(join(ROOT, 'src/main/services/dockerExport.ts'), 'utf-8')).not.toContain('pytest_cache')
    expect(readFileSync(join(ROOT, 'src/main/services/sshDeploy.ts'), 'utf-8')).not.toContain('.pyo')
  })

  it('流程运行时只认一种实现（没有 NoneBot 历史值）', () => {
    expect(readFileSync(join(ROOT, 'src/shared/types/flow.ts'), 'utf-8')).not.toContain('nonebot')
    expect(readFileSync(join(ROOT, 'src/main/schemas/flow.ts'), 'utf-8')).not.toContain('nonebot')
  })
})
