import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export interface ScannedNode {
  name: string
  funcName: string
  inputs: string[]
  outputs: string[]
  icon: string
  description: string
}

/**
 * 从 custom.py 中扫描 @node 装饰器标记的函数。
 *
 * 匹配模式：
 *   @node(name="xxx", inputs=[...], outputs=[...], icon="xxx")
 *   async def func_name(...):
 */
export async function scanCustomNodes(projectPath: string): Promise<ScannedNode[]> {
  const customPy = join(projectPath, 'src', 'plugins', 'custom', '__init__.py')
  if (!existsSync(customPy)) return []

  const content = await readFile(customPy, 'utf-8')
  return parseCustomNodes(content)
}

/**
 * 从 custom.py 扫描 @node 装饰器，返回 NodeSpecV2 列表（含 summary/sideEffects 等 AI 可读字段）。
 */
export async function scanCustomNodesV2(projectPath: string): Promise<NodeSpecV2[]> {
  const customPy = join(projectPath, 'src', 'plugins', 'custom', '__init__.py')
  if (!existsSync(customPy)) return []
  const content = await readFile(customPy, 'utf-8')
  return parseCustomNodesV2(content)
}

/**
 * 解析 custom.py 内容，提取 @node 装饰器标记的函数。
 * 使用正则匹配实现，不依赖 Python 解析器。
 */
export function parseCustomNodes(pythonCode: string): ScannedNode[] {
  const nodes: ScannedNode[] = []

  // 匹配 @node(...) 块 + 紧随的 async def 函数签名
  // 跨行匹配，一个 block = decorator + function signature
  const blockRegex = /@node\s*\(([\s\S]*?)\)\s*\n\s*async\s+def\s+(\w+)\s*\(([\s\S]*?)\):/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(pythonCode)) !== null) {
    const [, argsStr, funcName] = match

    // 解析装饰器参数
    const { name, inputs, outputs, icon, description } = parseNodeArgs(argsStr)

    nodes.push({
      name: name || funcName,
      funcName,
      inputs: inputs || [],
      outputs: outputs || [],
      icon: icon || '🔧',
      description: description || ''
    })
  }

  return nodes
}

/** 解析 @node(...) 的参数 */
function parseNodeArgs(argsStr: string): {
  name: string
  inputs: string[]
  outputs: string[]
  icon: string
  description: string
} {
  const result = {
    name: '',
    inputs: [] as string[],
    outputs: [] as string[],
    icon: '🔧',
    description: ''
  }

  // 按逗号分割顶层参数（不分割嵌套列表内的逗号）
  const parts = splitTopLevelArgs(argsStr)

  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue

    const key = part.slice(0, eqIdx).trim()
    let value = part.slice(eqIdx + 1).trim()

    switch (key) {
      case 'name': {
        const m = value.match(/"([^"]*)"/)
        if (m) result.name = m[1]
        break
      }
      case 'inputs':
      case 'outputs': {
        const list = parseStringList(value)
        if (key === 'inputs') result.inputs = list
        else result.outputs = list
        break
      }
      case 'icon': {
        const m = value.match(/"([^"]*)"/)
        if (m) result.icon = m[1]
        break
      }
      case 'description': {
        const m = value.match(/"([^"]*)"/)
        if (m) result.description = m[1]
        break
      }
    }
  }

  return result
}

/** 在顶层按逗号分割参数（忽略嵌套括号和列表内的逗号） */
function splitTopLevelArgs(s: string): string[] {
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
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  const trimmed = current.trim()
  if (trimmed) parts.push(trimmed)

  return parts
}

/** 解析 Python 字符串列表字面量 ["a", "b", "c"] 为字符串数组 */
function parseStringList(s: string): string[] {
  // 去掉外层 [] 和空白
  const trimmed = s.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []

  const inner = trimmed.slice(1, -1).trim()
  if (!inner) return []

  const items: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''

  for (const ch of inner) {
    if (inString) {
      current += ch
      if (ch === stringChar) {
        // 提取引号内的内容（去掉首尾引号）
        items.push(current.slice(1, -1))
        current = ''
        inString = false
      }
    } else if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      current = ch
    }
    // 跳过逗号和空白
  }

  return items
}

// ===== NodeSpecV2 反射 =====
import type { NodeSpecV2, PortSpec } from '@shared/types/nodeV2'

/**
 * 从 Python 代码中扫描 @node 装饰器，生成 NodeSpecV2 列表。
 * 支持字段：label/group/icon/tags/sideEffects/summary/exposedAsTool/toolName/toolArgs
 * docstring 第一行作为 summary（如果装饰器没显式指定）。
 */
export function parseCustomNodesV2(pythonCode: string): NodeSpecV2[] {
  const nodes: NodeSpecV2[] = []
  // 匹配 @node(...) + async def + 可选返回类型 + 可选 docstring
  // 问题 C2：返回类型注解和 docstring 都设为可选——AI 生成代码常省略这些
  // 返回类型支持参数化：List[str]、Optional[int]、Dict[str, int]
  // 注意：冒号后用 [ \t]* 而非 \s*，避免吞掉 docstring 前的换行
  const blockRegex = /@node\s*\(([\s\S]*?)\)\s*\n\s*async\s+def\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*([\w.]+(?:\[[^\]]*\])?))?\s*:(?:[ \t]*\n\s*"""([\s\S]*?)""")?/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(pythonCode)) !== null) {
    const [, decoArgs, funcName, sigArgs, returnType, docstring] = match
    const deco = parseDecoratorArgsV2(decoArgs) as unknown as Partial<{
      name: string; label: string; group: string; icon: string; summary: string;
      sideEffects: string[]; tags: string[]; exposedAsTool: boolean;
      toolName: string; toolArgs: string[]
    }>
    const inputs = parseInputsFromSignatureV2(sigArgs)
    const outputs = returnType && returnType !== 'None'
      ? [{ id: 'result', name: '返回值', kind: 'data' as const, dataType: pythonTypeToDataType(returnType) }]
      : []

    // 问题 C2：docstring 可能为 undefined，summary 回退链：deco.summary → docstring首行 → name → label → funcName
    // 修复 @node name= 参数 bug：qqbat.py 的 @node 用 name= 作为显示名，
    // parseDecoratorArgsV2 解析后存到 result.name，但这里之前读 deco.label 而非 deco.name
    const docstringSummary = docstring ? docstring.trim().split('\n')[0].trim() : ''
    const summary = deco.summary || docstringSummary || deco.name || deco.label || funcName
    const kind = `custom_${funcName}`

    nodes.push({
      kind,
      type: 'custom',
      label: deco.name || deco.label || funcName,
      group: deco.group || '自定义',
      icon: deco.icon || '🔧',
      description: summary,
      summary,
      sideEffects: deco.sideEffects || [],
      tags: deco.tags || [],
      handler: { source: 'custom', funcName },
      exposedAsTool: deco.exposedAsTool ?? false,
      toolName: deco.toolName,
      toolArgs: deco.toolArgs,
      defaultConfig: {},
      inputs,
      outputs
    })
  }
  return nodes
}

function parseDecoratorArgsV2(raw: string): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {}
  const simpleRegex = /(\w+)\s*=\s*("[^"]*"|true|false|True|False|\[[^\]]*\])/g
  let m: RegExpExecArray | null
  while ((m = simpleRegex.exec(raw)) !== null) {
    const [, key, val] = m
    const trimmed = val.trim()
    if (trimmed.startsWith('"')) {
      result[key] = trimmed.slice(1, -1)
    } else if (trimmed === 'true' || trimmed === 'True') {
      result[key] = true
    } else if (trimmed === 'false' || trimmed === 'False') {
      result[key] = false
    } else if (trimmed.startsWith('[')) {
      result[key] = trimmed.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    }
  }
  return result
}

function parseInputsFromSignatureV2(sig: string): PortSpec[] {
  const inputs: PortSpec[] = []
  // 问题 M3：支持参数化类型 List[str]、Optional[str]、Dict[str, int]
  // [\w.]+ 匹配基础类型名，(?:\[[^\]]*\])? 匹配可选的 [参数化] 部分
  const paramRegex = /(\w+)\s*:\s*([\w.]+(?:\[[^\]]*\])?)/g
  let m: RegExpExecArray | null
  while ((m = paramRegex.exec(sig)) !== null) {
    const [, name, pyTypeRaw] = m
    if (name === 'bot' || name === 'event') continue
    const pyType = pyTypeRaw.trim()
    // Optional[X] → required=false，内部类型 X 用于 dataType
    const isOptional = pyType.startsWith('Optional[')
    const innerType = isOptional
      ? pyType.match(/Optional\[([^\]]+)\]/)?.[1] ?? 'Any'
      : pyType
    inputs.push({
      id: name,
      name,
      kind: 'data',
      dataType: pythonTypeToDataType(innerType),
      required: !isOptional
    })
  }
  return inputs
}

function pythonTypeToDataType(pyType: string): string {
  // 问题 M3：剥离参数化部分 List[str] → List，Dict[str, int] → Dict
  const base = pyType.replace(/[<\[].*$/, '').trim()
  const map: Record<string, string> = {
    str: 'string', int: 'number', float: 'number', bool: 'boolean',
    list: 'list', List: 'list',
    dict: 'object', Dict: 'object',
    Any: 'any', Optional: 'any'
  }
  return map[base] || 'any'
}
