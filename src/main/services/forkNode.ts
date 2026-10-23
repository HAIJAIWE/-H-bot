// src/main/services/forkNode.ts
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export interface ForkResult {
  success: boolean
  newKind: string
  error?: string
}

// Python 关键字集合，newName 不得与之冲突（否则生成的代码语法错误）
const PYTHON_KEYWORDS = new Set([
  'if', 'else', 'elif', 'for', 'while', 'def', 'class', 'return', 'import',
  'from', 'as', 'try', 'except', 'finally', 'with', 'lambda', 'pass',
  'break', 'continue', 'global', 'nonlocal', 'yield', 'async', 'await',
  'raise', 'assert', 'del', 'in', 'is', 'not', 'and', 'or', 'None', 'True', 'False'
])

/**
 * 从源码中提取第一个顶层 `async def` 的函数体。
 *
 * 用逐行扫描 + 缩进深度 + 三引号字符串状态来判断函数体边界，
 * 比单一正则更准确：能正确处理函数体内嵌套的 def/class（缩进的），
 * 以及多行字符串中顶格的行（不会误判为下一个顶层定义）。
 *
 * @param source Python 源码
 * @param startIdx 函数体起始位置（签名 `:\n` 之后）
 * @returns 函数体文本（含缩进），到下一个顶层定义或 EOF
 */
function extractFunctionBody(source: string, startIdx: number): string {
  const remaining = source.slice(startIdx)
  const lines = remaining.split('\n')
  const bodyLines: string[] = []
  let inTripleString = false
  const tripleQuoteRe = /("""|''')/g

  for (const line of lines) {
    if (!inTripleString) {
      // 顶格非空行（列 0 开始的非空白字符）= 下一个顶层定义 → 函数体结束
      // 空行和缩进行都属于当前函数体
      if (line.length > 0 && !/\s/.test(line[0])) {
        break
      }
      // 检查是否进入三引号字符串（行内三引号出现奇数次）
      const matches = line.match(tripleQuoteRe)
      if (matches && matches.length % 2 === 1) {
        inTripleString = true
      }
    } else {
      // 在三引号字符串内，所有行都属于函数体（不检查缩进）
      // 检查是否退出三引号字符串
      const matches = line.match(tripleQuoteRe)
      if (matches && matches.length % 2 === 1) {
        inTripleString = false
      }
    }
    bodyLines.push(line)
  }

  return bodyLines.join('\n')
}

/**
 * 把内置节点 handler 复制为自定义节点：读取 `qqbat_nodes/builtin/<kind>.py` 中的
 * `async def` 函数源码，套上 `@node(label=..., summary=...)` 装饰器后追加到
 * `projects/<id>/src/plugins/custom/__init__.py`，使其可被 customNodeScanner 扫描到。
 *
 * 安全校验：
 * - newName 必须是蛇形（小写字母开头，仅含小写字母/数字/下划线），且非 Python 关键字
 * - builtinKind 仅允许字母/数字/下划线（防路径穿越 `../../etc/passwd`）
 *
 * 幂等性：
 * - 若 `__init__.py` 中已存在 `@node(label="${newName}")` 块，先删除再追加（不重复）
 *
 * @param projectPath 项目根路径
 * @param builtinKind 内置节点 kind（如 `send_message`，对应文件名 `<kind>.py`）
 * @param newName     新节点函数名（蛇形），生成的 kind 为 `custom_<newName>`
 */
export async function forkBuiltinNode(
  projectPath: string,
  builtinKind: string,
  newName: string
): Promise<ForkResult> {
  // 1. 合法性校验（在任何文件 I/O 之前）
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(newName)) {
    return {
      success: false,
      newKind: '',
      error: 'newName 必须以小写字母开头，仅含小写字母/数字/下划线'
    }
  }
  if (PYTHON_KEYWORDS.has(newName)) {
    return {
      success: false,
      newKind: '',
      error: `newName 不能是 Python 关键字: ${newName}`
    }
  }
  if (!/^[a-zA-Z0-9_]+$/.test(builtinKind)) {
    return {
      success: false,
      newKind: '',
      error: 'builtinKind 含非法字符'
    }
  }

  // 2. 定位内置 handler 源码
  const builtinPath = join(process.cwd(), 'qqbat_nodes', 'builtin', `${builtinKind}.py`)
  if (!existsSync(builtinPath)) {
    return { success: false, newKind: '', error: `内置节点 ${builtinKind} 不存在` }
  }

  const source = await readFile(builtinPath, 'utf-8')

  // 3. 提取签名：`async def name(args) [-> ReturnType]:`
  //    正则只负责签名部分（参数列表可能跨行），函数体由逐行扫描提取
  const sigMatch = source.match(
    /async\s+def\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*([\w.]+))?\s*:\s*\n/
  )
  if (!sigMatch) {
    return { success: false, newKind: '', error: `无法从内置节点 ${builtinKind} 提取函数体` }
  }
  const [, , argsStr, returnType] = sigMatch

  // 4. 逐行扫描提取函数体（处理嵌套 def / 多行字符串 / 顶层边界）
  const bodyStartIdx = (sigMatch.index ?? 0) + sigMatch[0].length
  const body = extractFunctionBody(source, bodyStartIdx)

  // 5. 重新组装：@node 装饰器 + 改名后的 async def（保留参数 / 返回类型 / 函数体）
  const rt = returnType ? ` -> ${returnType}` : ''
  const decorated =
    `@node(label="${newName}", summary="复制自 ${builtinKind}")\n` +
    `async def ${newName}(${argsStr})${rt}:\n` +
    `${body}`

  // 6. 写入 custom/__init__.py（目录不存在则递归创建）
  //    幂等：先删除已存在的 `@node(label="${newName}")` 块，再追加新的
  const customDir = join(projectPath, 'src', 'plugins', 'custom')
  const customPath = join(customDir, '__init__.py')
  await mkdir(customDir, { recursive: true })

  let existingContent = ''
  if (existsSync(customPath)) {
    existingContent = await readFile(customPath, 'utf-8')
  }

  // 按 `@node(` 装饰器分块，删除同名块（防止重复 fork 累积多个定义）
  const parts = existingContent.split(/(?=@node\()/)
  const kept = parts.filter((part) => {
    const m = part.match(/@node\(label="([^"]*)"/)
    return m?.[1] !== newName
  })
  let cleanedContent = kept.join('').replace(/^\s+/, '')
  if (cleanedContent && !cleanedContent.endsWith('\n')) {
    cleanedContent += '\n'
  }

  const newContent = cleanedContent
    ? `${cleanedContent}\n${decorated}\n`
    : `\n${decorated}\n`
  await writeFile(customPath, newContent)

  return { success: true, newKind: `custom_${newName}` }
}
