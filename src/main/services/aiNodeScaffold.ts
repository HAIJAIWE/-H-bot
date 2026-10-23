// src/main/services/aiNodeScaffold.ts
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { parseCustomNodesV2, scanCustomNodesV2 } from './customNodeScanner'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { logger } from './logger'

const execFileP = promisify(execFile)

export interface CreateAiNodeRequest {
  projectPath: string
  funcName: string
  label: string
  summary: string
  code: string
}

export interface CreateAiNodeResult {
  ok: boolean
  nodeKind?: string
  error?: string
  validationErrors?: string[]
}

/** 蛇形命名校验：小写字母开头，仅含小写字母/数字/下划线 */
const FUNC_NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * 创建一个 AI 生成的自定义节点。
 *
 * 流程：
 * 1. 命名冲突检测（ai_generated/*.py 已有函数名 + custom/__init__.py 函数名 + builtinCatalog 所有 kind）
 * 2. Python AST 语法校验（调用子进程 python -c "ast.parse(...)"；python 不可用时降级为仅做正则校验）
 * 3. 签名规范性校验（正则）：必须 @node 装饰器、async def、前两参 bot: Any, event: Any
 * 4. 写入 <projectPath>/src/plugins/ai_generated/<funcName>.py
 *
 * 写入后由 aiGeneratedScanner 在下次扫描时自动重写 __init__.py 重导出并注册到步骤节点库。
 */
export async function createAiNode(
  projectPath: string,
  funcName: string,
  label: string,
  summary: string,
  code: string
): Promise<CreateAiNodeResult> {
  // 0. 基础字段校验
  if (!funcName || !FUNC_NAME_RE.test(funcName)) {
    return {
      ok: false,
      error: `funcName 不合法：必须为蛇形命名（小写字母开头，仅含小写字母/数字/下划线），收到: ${funcName}`
    }
  }
  if (!code || code.trim().length === 0) {
    return { ok: false, error: 'code 不能为空' }
  }

  // 1. 命名冲突检测
  try {
    const conflict = await detectNamingConflict(projectPath, funcName)
    if (conflict) {
      return { ok: false, error: conflict }
    }
  } catch (e) {
    return {
      ok: false,
      error: `命名冲突检测失败: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const validationErrors: string[] = []

  // 2. Python AST 语法校验
  // 注意：python 命令在部分环境不可用；不可用时降级为只做正则签名校验（见 validatePythonAst 注释）
  const astResult = await validatePythonAst(code)
  if (!astResult.ok) {
    validationErrors.push(`Python 语法错误: ${astResult.error}`)
  }

  // 3. 签名规范性校验（正则）
  const sigErrors = validateSignature(code, funcName)
  validationErrors.push(...sigErrors)

  if (validationErrors.length > 0) {
    return { ok: false, validationErrors }
  }

  // 4. 写文件
  const aiGenDir = join(projectPath, 'src', 'plugins', 'ai_generated')
  const targetFile = join(aiGenDir, `${funcName}.py`)
  try {
    if (!existsSync(aiGenDir)) {
      await mkdir(aiGenDir, { recursive: true })
    }
    await writeFile(targetFile, code, 'utf-8')
  } catch (e) {
    return {
      ok: false,
      error: `写入文件失败: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const nodeKind = `ai_generated_${funcName}`
  logger.info(`[aiNodeScaffold] 已创建 AI 节点: ${nodeKind} (label=${label}, summary=${summary})`)
  return { ok: true, nodeKind }
}

/**
 * 命名冲突检测：funcName 不得与已有 ai_generated 函数名/文件名、custom 函数名、内置 kind 冲突，
 * 生成的 nodeKind `ai_generated_<funcName>` 也不得与任何已有 kind 冲突。
 */
async function detectNamingConflict(projectPath: string, funcName: string): Promise<string | null> {
  const existingFuncNames = new Set<string>()
  const existingKinds = new Set<string>()

  // 内置节点 kind
  for (const n of NODE_CATALOG_V2) {
    existingKinds.add(n.kind)
  }

  // custom/__init__.py 函数名
  try {
    const customNodes = await scanCustomNodesV2(projectPath)
    for (const n of customNodes) {
      const fn = n.kind.replace(/^custom_/, '')
      existingFuncNames.add(fn)
      existingKinds.add(n.kind)
    }
  } catch {
    /* custom 不存在或解析失败时忽略 */
  }

  // ai_generated/*.py 函数名 + 文件名
  const aiGenDir = join(projectPath, 'src', 'plugins', 'ai_generated')
  if (existsSync(aiGenDir)) {
    const files = await readdir(aiGenDir)
    for (const f of files) {
      if (!f.endsWith('.py') || f === '__init__.py') continue
      existingFuncNames.add(f.replace(/\.py$/, ''))
      try {
        const content = await readFile(join(aiGenDir, f), 'utf-8')
        const nodes = parseCustomNodesV2(content)
        for (const n of nodes) {
          const fn = n.kind.replace(/^custom_/, '')
          existingFuncNames.add(fn)
          existingKinds.add(`ai_generated_${fn}`)
        }
      } catch {
        /* 单个文件解析失败时忽略 */
      }
    }
  }

  if (existingFuncNames.has(funcName)) {
    return `命名冲突：函数名 "${funcName}" 已存在（ai_generated 或 custom 目录）`
  }
  const nodeKind = `ai_generated_${funcName}`
  if (existingKinds.has(nodeKind)) {
    return `命名冲突：节点 kind "${nodeKind}" 已存在`
  }
  // 文件已存在（即使解析失败也避免覆盖）
  if (existsSync(join(aiGenDir, `${funcName}.py`))) {
    return `命名冲突：文件 ai_generated/${funcName}.py 已存在`
  }
  return null
}

/**
 * 调用子进程 python 校验 Python 语法（Windows 下使用 python 命令）。
 *
 * 降级策略：若 python 命令不可用（ENOENT），返回 { ok: true } 不作为致命错误，
 * 由调用方继续依赖正则签名校验（validateSignature）做基础把关。
 * 这是 MVP 的折中——AST 校验最准确，但不应因 python 缺失而阻断节点创建。
 */
async function validatePythonAst(code: string): Promise<{ ok: boolean; error?: string }> {
  const tmpFile = join(tmpdir(), `ai_node_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
  try {
    await writeFile(tmpFile, code, 'utf-8')
  } catch (e) {
    return { ok: false, error: `无法写入临时文件: ${e instanceof Error ? e.message : String(e)}` }
  }

  try {
    const script =
      'import ast,sys\n' +
      'try:\n' +
      '    ast.parse(open(sys.argv[1],encoding="utf-8").read())\n' +
      'except SyntaxError as e:\n' +
      '    print(f"{e.lineno}:{e.offset}: {e.msg}")\n' +
      '    sys.exit(1)'
    await execFileP('python', ['-c', script, tmpFile], { timeout: 10000 })
    return { ok: true }
  } catch (e: unknown) {
    const err = e as { code?: string; stdout?: string; stderr?: string; message?: string }
    // python 命令不可用：降级为正则校验，不算语法错误
    if (err.code === 'ENOENT') {
      logger.info('[aiNodeScaffold] python 命令不可用，跳过 AST 校验，仅做正则签名校验')
      return { ok: true }
    }
    const detail = (err.stdout || err.stderr || err.message || String(e)).toString().trim()
    return { ok: false, error: detail || 'python 校验失败' }
  } finally {
    try {
      await unlink(tmpFile)
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }
}

/**
 * 签名规范性校验（正则）：
 * - 必须有 @node 装饰器
 * - 必须 async def <funcName>
 * - 前两参必须为 bot: Any, event: Any
 */
function validateSignature(code: string, funcName: string): string[] {
  const errors: string[] = []

  // @node 装饰器
  if (!/@node\s*\(/.test(code)) {
    errors.push('缺少 @node 装饰器')
  }

  // async def <funcName>(...)
  const paramsRaw = extractSignatureParams(code, funcName)
  if (paramsRaw === null) {
    errors.push(`缺少 async def ${funcName}(...) 函数定义`)
    return errors
  }

  const params = splitTopLevelParams(paramsRaw)
  if (params.length < 2) {
    errors.push('函数参数不足：前两参必须为 bot: Any, event: Any')
    return errors
  }
  if (!isParamNamed(params[0], 'bot')) {
    errors.push(`第一个参数必须为 "bot: Any"，收到: ${params[0].trim()}`)
  } else if (!isParamTyped(params[0], 'Any')) {
    errors.push(`第一个参数类型必须为 Any，收到: ${params[0].trim()}`)
  }
  if (!isParamNamed(params[1], 'event')) {
    errors.push(`第二个参数必须为 "event: Any"，收到: ${params[1].trim()}`)
  } else if (!isParamTyped(params[1], 'Any')) {
    errors.push(`第二个参数类型必须为 Any，收到: ${params[1].trim()}`)
  }

  return errors
}

/** 提取 async def <funcName>(...) 括号内的参数字符串（支持嵌套括号/中括号的类型注解） */
function extractSignatureParams(code: string, funcName: string): string | null {
  const startRegex = new RegExp(`async\\s+def\\s+${escapeRegExp(funcName)}\\s*\\(`)
  const startMatch = code.match(startRegex)
  if (!startMatch || startMatch.index === undefined) return null
  let i = startMatch.index + startMatch[0].length
  let depth = 1
  let buf = ''
  while (i < code.length && depth > 0) {
    const ch = code[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) break
    }
    buf += ch
    i++
  }
  return depth === 0 ? buf : null
}

/** 判断参数是否为指定名称（如 bot / event） */
function isParamNamed(param: string, name: string): boolean {
  return new RegExp(`^\\s*${name}\\b`).test(param)
}

/** 判断参数类型注解是否为指定类型（如 Any） */
function isParamTyped(param: string, type: string): boolean {
  const m = param.match(/:\s*([\w.]+)/)
  if (!m) return false
  return m[1] === type
}

/** 在顶层按逗号分割参数（忽略嵌套括号/中括号/大括号内的逗号） */
function splitTopLevelParams(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      current += ch
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  const trimmed = current.trim()
  if (trimmed) parts.push(trimmed)
  return parts
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
