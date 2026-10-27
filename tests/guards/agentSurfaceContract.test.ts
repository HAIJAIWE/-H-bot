// tests/guards/agentSurfaceContract.test.ts
//
// 第 71 批：智能体窗口的**契约守卫**（纯静态扫描，不渲染、不 import 渲染层）。
//
// 第 70 批定义 `AgentSurfaceContext`（只读快照 + 命令）时，契约的价值全在"没人能绕过它"：
//   · 示例窗口若偷偷 `import { useAiStore }`，就等于把渲染层私有结构变成第三方依赖；
//   · 契约文件若 import 组件/React，就不再是可在 node 里跑的纯 TS 模块；
//   · 注册入口若没人 import，窗口列表里不会出现它（静默缺项，比报错更难查）。
// 三条都在这里钉住，改坏了立刻红。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_SRC = join(process.cwd(), 'src', 'renderer', 'src')
const read = (...segments: string[]): string =>
  readFileSync(join(RENDERER_SRC, ...segments), 'utf-8')

/**
 * 去掉注释行再匹配。
 * 文件头注释本身会解释"不许 import aiStore"，直接扫描会把它当成违规（第 62 批 Electron-free
 * 闸门踩过同一坑）——所以注释里的说明不算代码。
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('★ 智能体窗口契约守卫（第 70/71 批）', () => {
  it('示例窗口只用 AgentSurfaceContext，不 import aiStore', () => {
    const source = stripComments(read('components', 'ai', 'compactAgentSurface.tsx'))
    expect(source).toMatch(/AgentSurfaceContext/)
    expect(source).not.toMatch(/stores\/aiStore/)
    expect(source).not.toMatch(/\buseAiStore\b/)
  })

  it('契约文件是纯 TS：不 import components/、React、tsx', () => {
    const source = read('lib', 'ai', 'agentSurfaceContext.ts')
    expect(source).not.toMatch(/components\//)
    expect(source).not.toMatch(/from 'react'/)
    expect(source).not.toMatch(/\.tsx'/)
  })

  it('内置窗口模块 import 并调用 registerCompactAgentSurface', () => {
    const source = read('components', 'ai', 'builtinAgentSurface.tsx')
    expect(source).toMatch(
      /import \{ registerCompactAgentSurface \} from '\.\/compactAgentSurface'/,
    )
    expect(source).toMatch(/registerCompactAgentSurface\(\)/)
  })

  it('挂载点仍在：RightPanel 侧 import 内置窗口注册', () => {
    const source = read('components', 'layout', 'RightPanel.tsx')
    expect(source).toContain("import '../ai/builtinAgentSurface'")
  })
})
