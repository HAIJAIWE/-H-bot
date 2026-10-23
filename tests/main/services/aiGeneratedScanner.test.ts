// tests/main/services/aiGeneratedScanner.test.ts
// 使用真实 tmp 目录而非 vi.mock('fs')——vitest 4 下 vi.mock('fs') 不稳定
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanAiGeneratedNodes } from '@main/services/aiGeneratedScanner'

describe('aiGeneratedScanner', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'qqbat-ai-scan-'))
    mkdirSync(join(projectPath, 'src', 'plugins', 'ai_generated'), { recursive: true })
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  /** 在 ai_generated 目录下写入一个 .py 文件 */
  function writeAiGenFile(name: string, content: string): void {
    writeFileSync(join(projectPath, 'src', 'plugins', 'ai_generated', name), content, 'utf-8')
  }

  it('扫描 ai_generated/*.py 的 @node 装饰器', async () => {
    writeAiGenFile(
      'weather_query.py',
      `from qqbat_nodes.decorator import node

@node(label="查天气", summary="查询天气信息", sideEffects=["http_request"])
async def weather_query(bot, event, city: str) -> str:
    """查询指定城市天气"""
    return "晴天"
`
    )
    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('ai_generated_weather_query')
    expect(nodes[0].label).toBe('查天气')
    expect(nodes[0].summary).toBe('查询天气信息')
    expect(nodes[0].sideEffects).toContain('http_request')
  })

  it('目录不存在返回空数组', async () => {
    // projectPath 下没有 src/plugins/ai_generated —— 用另一个空 tmp 目录
    const emptyProject = mkdtempSync(join(tmpdir(), 'qqbat-ai-empty-'))
    try {
      const nodes = await scanAiGeneratedNodes(emptyProject)
      expect(nodes).toEqual([])
    } finally {
      rmSync(emptyProject, { recursive: true, force: true })
    }
  })

  // ===== 问题 2 回归：无 docstring 也能扫描 =====

  it('无 docstring 的 AI 节点也能扫描到（C2 回归）', async () => {
    writeAiGenFile(
      'no_doc.py',
      `from qqbat_nodes.decorator import node

@node(label="无文档", summary="无docstring节点")
async def no_doc(bot, event, x: str) -> str:
    return x
`
    )
    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('ai_generated_no_doc')
    expect(nodes[0].summary).toBe('无docstring节点')
  })

  // ===== 问题 1 回归：多文件扫描 + __init__.py 重导出 =====

  it('扫描多个 .py 文件并收集所有节点（C1 回归）', async () => {
    writeAiGenFile(
      'foo.py',
      `from qqbat_nodes.decorator import node

@node(label="foo", summary="foo 节点")
async def foo(bot, event, x: str) -> str:
    """foo"""
    return x
`
    )
    writeAiGenFile(
      'bar.py',
      `from qqbat_nodes.decorator import node

@node(label="bar", summary="bar 节点")
async def bar(bot, event, y: int) -> int:
    """bar"""
    return y
`
    )
    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes).toHaveLength(2)
    const kinds = nodes.map((n) => n.kind)
    expect(kinds).toEqual(expect.arrayContaining(['ai_generated_foo', 'ai_generated_bar']))
  })

  it('扫描完成后写入 __init__.py 重新导出所有节点函数（C1 方案B 回归）', async () => {
    writeAiGenFile(
      'foo.py',
      `from qqbat_nodes.decorator import node

@node(label="foo", summary="foo 节点")
async def foo(bot, event, x: str) -> str:
    """foo"""
    return x
`
    )
    writeAiGenFile(
      'bar.py',
      `from qqbat_nodes.decorator import node

@node(label="bar", summary="bar 节点")
async def bar(bot, event, y: int) -> int:
    """bar"""
    return y
`
    )
    const initFile = join(projectPath, 'src', 'plugins', 'ai_generated', '__init__.py')
    // 扫描前 __init__.py 不存在
    expect(existsSync(initFile)).toBe(false)

    await scanAiGeneratedNodes(projectPath)

    // 扫描后 __init__.py 被写入，包含 from .<sourceFile> import <funcName> 重导出
    expect(existsSync(initFile)).toBe(true)
    const initContent = readFileSync(initFile, 'utf-8')
    expect(initContent).toContain('from .foo import foo')
    expect(initContent).toContain('from .bar import bar')
  })

  // ===== 问题 3 回归：handler 不再塞入整个文件 content =====

  it('handler.code 不再存储整个文件内容（H4 回归）', async () => {
    const longBody = 'x = 1\n' + '    '.repeat(0) + 'pass\n'.repeat(50)
    writeAiGenFile(
      'big.py',
      `from qqbat_nodes.decorator import node

@node(label="big", summary="大文件节点")
async def big(bot, event, x: str) -> str:
    """big"""
${longBody}
    return x
`
    )
    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes).toHaveLength(1)
    // handler.source 必须是 ai_generated
    expect(nodes[0].handler.source).toBe('ai_generated')
    // code 字段不应包含文件正文（不应是几 KB 的 content）
    if (nodes[0].handler.source === 'ai_generated') {
      const code = (nodes[0].handler as { code?: string }).code ?? ''
      expect(code.length).toBeLessThan(longBody.length)
      expect(code).not.toContain('pass')
    }
  })

  // ===== 问题 4 回归：funcName 含 custom_ 前缀时不应被误删 =====

  it('funcName 含 custom_ 子串时 kind 前缀正确替换（M4 回归）', async () => {
    writeAiGenFile(
      'custom_helper.py',
      `from qqbat_nodes.decorator import node

@node(label="custom_helper", summary="含 custom_ 子串的节点")
async def custom_helper(bot, event, x: str) -> str:
    """custom_helper"""
    return x
`
    )
    const nodes = await scanAiGeneratedNodes(projectPath)
    expect(nodes).toHaveLength(1)
    // funcName=custom_helper，kind 应为 ai_generated_custom_helper（不应误删 funcName 中的 custom_）
    expect(nodes[0].kind).toBe('ai_generated_custom_helper')
  })
})
