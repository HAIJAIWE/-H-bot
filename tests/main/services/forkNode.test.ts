// tests/main/services/forkNode.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { forkBuiltinNode } from '@main/services/forkNode'

/**
 * forkBuiltinNode 的测试策略：
 * 1. 在 tmp 目录中伪造一个 qqbat_nodes/builtin 目录结构（通过 chdir 切到 tmp）；
 * 2. 用真实文件系统验证 fork 流程端到端正确。
 *
 * 这样能避免复杂的 fs 模块 mock，与 fileOps.test.ts 的模式一致。
 *
 * 注意：process.chdir 是进程级状态，本文件串行执行三个测试，
 * 每个 beforeEach 重新切到独立的 tmp 目录，afterEach 还原 prevCwd。
 */

let tmpRoot: string
let prevCwd: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qqbat-fork-'))
  prevCwd = process.cwd()
  process.chdir(tmpRoot)
})

afterEach(async () => {
  process.chdir(prevCwd)
  // Windows 下偶尔会因为文件句柄未释放导致 rm 失败，重试一次
  try {
    await rm(tmpRoot, { recursive: true, force: true })
  } catch {
    await new Promise((r) => setTimeout(r, 50))
    await rm(tmpRoot, { recursive: true, force: true })
  }
})

describe('forkBuiltinNode', () => {
  it('复制内置 handler 到 custom/__init__.py', async () => {
    // 伪造内置节点源码文件
    await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
    await writeFile(
      join(tmpRoot, 'qqbat_nodes', 'builtin', 'send_message.py'),
      `async def send_message(bot, event, text: str):\n    await bot.send(event, str(text))\n`
    )

    const projectPath = join(tmpRoot, 'project1')

    const result = await forkBuiltinNode(projectPath, 'send_message', 'my_send')

    expect(result.success).toBe(true)
    expect(result.newKind).toBe('custom_my_send')

    // custom/__init__.py 应该被创建并包含 forked 函数
    const customPy = join(projectPath, 'src', 'plugins', 'custom', '__init__.py')
    expect(existsSync(customPy)).toBe(true)
    const content = await readFile(customPy, 'utf-8')
    expect(content).toContain('@node(')
    expect(content).toContain('label="my_send"')
    expect(content).toContain('复制自 send_message')
    expect(content).toContain('async def my_send(')
    expect(content).toContain('await bot.send(event, str(text))')
  }, 15000)

  it('内置节点不存在时返回失败', async () => {
    const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'no_such_node', 'foo')

    expect(result.success).toBe(false)
    expect(result.newKind).toBe('')
    expect(result.error).toContain('no_such_node')
  })

  it('源码无法提取 async def 时返回失败', async () => {
    await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
    await writeFile(
      join(tmpRoot, 'qqbat_nodes', 'builtin', 'broken.py'),
      '# just a comment, no function here\n'
    )

    const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'broken', 'foo')

    expect(result.success).toBe(false)
    expect(result.newKind).toBe('')
    expect(result.error).toContain('函数')
  })

  // ===== 问题 3：forkBuiltinNode 缺少合法性校验（Critical C5） =====
  describe('newName 合法性校验', () => {
    it('拒绝含大写字母的 newName', async () => {
      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'send_message', 'MySend')
      expect(result.success).toBe(false)
      expect(result.newKind).toBe('')
      expect(result.error).toMatch(/newName|小写字母|非法/)
    })

    it('拒绝含空格的 newName', async () => {
      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'send_message', 'my send')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/newName|非法/)
    })

    it('拒绝含双引号的 newName（防止注入 Python 代码）', async () => {
      const result = await forkBuiltinNode(
        join(tmpRoot, 'proj'),
        'send_message',
        'evil")\nimport os\nos.system("rm -rf /'
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/newName|非法/)
    })

    it('拒绝 Python 关键字作为 newName', async () => {
      for (const kw of ['class', 'def', 'return', 'import', 'lambda', 'yield', 'async', 'await']) {
        const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'send_message', kw)
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Python|关键字/)
      }
    })

    it('拒绝以数字开头的 newName', async () => {
      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'send_message', '1evil')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/newName|小写字母/)
    })

    it('接受合法的蛇形 newName', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'send_message.py'),
        `async def send_message(bot, event):\n    pass\n`
      )
      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'send_message', 'my_send_123')
      expect(result.success).toBe(true)
      expect(result.newKind).toBe('custom_my_send_123')
    })
  })

  describe('builtinKind 合法性校验（防路径穿越）', () => {
    it('拒绝含 ../ 的路径穿越 builtinKind', async () => {
      // 即便目标文件存在，也不应被读取
      await writeFile(join(tmpRoot, 'secret.txt'), 'SECRET_CONTENT')
      const result = await forkBuiltinNode(
        join(tmpRoot, 'proj'),
        '../../../secret',
        'my_node'
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/builtinKind|非法/)
    })

    it('拒绝含路径分隔符的 builtinKind', async () => {
      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'a/b/c', 'my_node')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/builtinKind|非法/)
    })

    it('拒绝含特殊字符的 builtinKind', async () => {
      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'send;rm -rf /', 'my_node')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/builtinKind|非法/)
    })
  })

  // ===== 问题 4：forkBuiltinNode 正则误识别嵌套函数（High H1） =====
  describe('函数体提取（正则修复）', () => {
    it('正确处理函数体内嵌套的 def（不截断外层函数体）', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'with_nested.py'),
        [
          'async def with_nested(bot, event):',
          '    x = 1',
          '    def helper():',
          '        return 2',
          '    return x + helper()',
          ''
        ].join('\n')
      )

      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'with_nested', 'my_nested')
      expect(result.success).toBe(true)

      const content = await readFile(
        join(tmpRoot, 'proj', 'src', 'plugins', 'custom', '__init__.py'),
        'utf-8'
      )
      // 嵌套 def helper() 应被完整保留在外层函数体内
      expect(content).toContain('def helper():')
      expect(content).toContain('return 2')
      expect(content).toContain('return x + helper()')
    })

    it('正确处理函数体内嵌套的 async def', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'with_nested_async.py'),
        [
          'async def with_nested_async(bot, event):',
          '    async def helper():',
          '        return 42',
          '    return await helper()',
          ''
        ].join('\n')
      )

      const result = await forkBuiltinNode(
        join(tmpRoot, 'proj'),
        'with_nested_async',
        'my_nested_async'
      )
      expect(result.success).toBe(true)

      const content = await readFile(
        join(tmpRoot, 'proj', 'src', 'plugins', 'custom', '__init__.py'),
        'utf-8'
      )
      expect(content).toContain('async def helper():')
      expect(content).toContain('return await helper()')
    })

    it('正确处理多行字符串（行首非空白的多行字符串不截断函数体）', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      // 多行字符串中存在顶格的行（line at column 0）
      // 旧正则的 \n\S 会在顶格行处误判为下一个顶层定义，截断函数体
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'with_multiline_str.py'),
        [
          'async def with_multiline_str(bot, event):',
          '    msg = """multi',
          'line docstring',
          'at col 0"""',
          '    return msg',
          ''
        ].join('\n')
      )

      const result = await forkBuiltinNode(
        join(tmpRoot, 'proj'),
        'with_multiline_str',
        'my_multiline'
      )
      expect(result.success).toBe(true)

      const content = await readFile(
        join(tmpRoot, 'proj', 'src', 'plugins', 'custom', '__init__.py'),
        'utf-8'
      )
      // 整个多行字符串应被完整保留
      expect(content).toContain('multi')
      expect(content).toContain('line docstring')
      expect(content).toContain('at col 0')
      expect(content).toContain('return msg')
    })

    it('正确停止于下一个顶层 async def', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'two_funcs.py'),
        [
          'async def first(bot, event):',
          '    return 1',
          '',
          'async def second(bot, event):',
          '    return 2',
          ''
        ].join('\n')
      )

      const result = await forkBuiltinNode(join(tmpRoot, 'proj'), 'two_funcs', 'my_first')
      expect(result.success).toBe(true)

      const content = await readFile(
        join(tmpRoot, 'proj', 'src', 'plugins', 'custom', '__init__.py'),
        'utf-8'
      )
      // 只应 fork 第一个函数 first，不应包含 second
      expect(content).toContain('async def my_first(')
      expect(content).toContain('return 1')
      expect(content).not.toContain('async def second(')
      expect(content).not.toContain('return 2')
    })
  })

  // ===== 问题 5：多次 fork 同一节点重复追加（High H2） =====
  describe('重复 fork 幂等性', () => {
    it('多次 fork 同一 newName 不应重复追加 async def 块', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'send_message.py'),
        `async def send_message(bot, event):\n    pass\n`
      )

      const projectPath = join(tmpRoot, 'proj')
      const customPy = join(projectPath, 'src', 'plugins', 'custom', '__init__.py')

      // 第一次 fork
      const r1 = await forkBuiltinNode(projectPath, 'send_message', 'my_send')
      expect(r1.success).toBe(true)

      // 第二次 fork 同一 newName
      const r2 = await forkBuiltinNode(projectPath, 'send_message', 'my_send')
      expect(r2.success).toBe(true)

      const content = await readFile(customPy, 'utf-8')
      // 应该只有一个 `async def my_send` 定义
      const defCount = (content.match(/async def my_send\(/g) || []).length
      expect(defCount).toBe(1)
      // 应该只有一个 @node 装饰器
      const decoratorCount = (content.match(/@node\(label="my_send"/g) || []).length
      expect(decoratorCount).toBe(1)
    })

    it('fork 不同 newName 应分别保留', async () => {
      await mkdir(join(tmpRoot, 'qqbat_nodes', 'builtin'), { recursive: true })
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'send_message.py'),
        `async def send_message(bot, event):\n    pass\n`
      )
      await writeFile(
        join(tmpRoot, 'qqbat_nodes', 'builtin', 'http_request.py'),
        `async def http_request(bot, event):\n    pass\n`
      )

      const projectPath = join(tmpRoot, 'proj')
      await forkBuiltinNode(projectPath, 'send_message', 'my_send')
      await forkBuiltinNode(projectPath, 'http_request', 'my_http')

      const content = await readFile(
        join(projectPath, 'src', 'plugins', 'custom', '__init__.py'),
        'utf-8'
      )
      expect(content).toContain('async def my_send(')
      expect(content).toContain('async def my_http(')
    })
  })
})
