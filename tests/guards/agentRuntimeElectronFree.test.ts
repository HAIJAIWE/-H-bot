// tests/guards/agentRuntimeElectronFree.test.ts
//
// P1 的硬不变量：`src/main/services/agent-runtime/**` 不许出现任何 Electron 依赖。
// 这条守卫比"跑一遍测试"更早失效：只要有人顺手 import 一下 app/win，这里就红，
// 不用等某个平台相关测试在 CI 上偶发失败。
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src/main/services/agent-runtime')

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return listFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/** 去掉注释行再匹配：本模块头注释里就写着"不碰 BrowserWindow/ipcMain"，那不是依赖。 */
function codeOf(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('守卫：AgentRuntime 目录与 Electron 无关', () => {
  it('没有 electron 导入 / BrowserWindow / webContents', () => {
    const bad = listFiles(DIR).filter(file => {
      const code = codeOf(readFileSync(file, 'utf-8'))
      return /from ['"]electron['"]|require\(['"]electron['"]\)|\bBrowserWindow\b|\.webContents\b/.test(
        code,
      )
    })
    expect(bad, `这些文件碰到了 Electron：\n${bad.join('\n')}`).toEqual([])
  })

  it('运行时只认 runAgentTurn（不直连 ipcMain / 不自己调模型）', () => {
    const code = codeOf(readFileSync(join(DIR, 'index.ts'), 'utf-8'))
    expect(code).toContain("from '../agent-core/runTurn'")
    expect(code).not.toMatch(/\bipcMain\b/)
    expect(code).not.toMatch(/\bcallLlm\b/)
  })
})
