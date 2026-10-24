// tests/main/services/plugins/aiGeneratedScanner.test.ts
// AI 生成节点扫描（10/18 基线形态）：plugins/ai-<名>/ 里的插件包 → NodeSpecV2
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanAiGeneratedNodes } from '@main/services/plugins/aiGeneratedScanner'

const MANIFEST = JSON.stringify(
  { name: 'ai-hello', version: '1.0.0', entry: 'index.js' },
  null,
  2
)

const INDEX_JS = `
module.exports = {
  nodes: [
    {
      kind: 'hello',
      type: 'action',
      label: '打个招呼',
      group: 'AI 生成',
      description: '测试节点',
      inputs: [{ id: 'in', name: '入', kind: 'control' }],
      outputs: [{ id: 'out', name: '出', kind: 'control' }],
      handler: "async (ctx) => ({ ok: true })"
    }
  ]
}
`

describe('scanAiGeneratedNodes（plugins/ai-* 插件包）', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'qqbat-ai-scan-'))
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('项目没有 plugins/ 目录时返回空数组', async () => {
    await expect(scanAiGeneratedNodes(projectPath)).resolves.toEqual([])
  })

  it('扫描 plugins/ai-<名> 包，kind 带包名前缀', async () => {
    const dir = join(projectPath, 'plugins', 'ai-hello')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), MANIFEST, 'utf-8')
    writeFileSync(join(dir, 'index.js'), INDEX_JS, 'utf-8')

    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('plugin_ai-hello_hello')
    expect(nodes[0].label).toBe('打个招呼')
    expect(nodes[0].group).toBe('AI 生成')
  })

  it('非 ai- 前缀的插件包不在扫描范围', async () => {
    const dir = join(projectPath, 'plugins', 'my-node')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), MANIFEST, 'utf-8')
    writeFileSync(join(dir, 'index.js'), INDEX_JS, 'utf-8')

    await expect(scanAiGeneratedNodes(projectPath)).resolves.toEqual([])
  })

  it('manifest 坏掉的包被跳过，不影响其它包', async () => {
    const badDir = join(projectPath, 'plugins', 'ai-bad')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'manifest.json'), '{ not json', 'utf-8')
    writeFileSync(join(badDir, 'index.js'), INDEX_JS, 'utf-8')

    const goodDir = join(projectPath, 'plugins', 'ai-hello')
    mkdirSync(goodDir, { recursive: true })
    writeFileSync(join(goodDir, 'manifest.json'), MANIFEST, 'utf-8')
    writeFileSync(join(goodDir, 'index.js'), INDEX_JS, 'utf-8')

    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes.map((n: { kind: string }) => n.kind)).toEqual(['plugin_ai-hello_hello'])
  })
})