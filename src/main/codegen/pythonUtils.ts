// src/main/codegen/pythonUtils.ts

/** 生成 Python 缩进字符串（4 空格/级） */
export function indentStr(level: number): string {
  return '    '.repeat(Math.max(0, level))
}

/** 将 JS 值转为 Python 字面量字符串 */
export function pythonLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    return `"${escaped}"`
  }
  if (Array.isArray(value)) {
    return `[${value.map(pythonLiteral).join(', ')}]`
  }
  if (typeof value === 'object') {
    const pairs = Object.entries(value).map(
      ([k, v]) => `"${k}": ${pythonLiteral(v)}`
    )
    return `{${pairs.join(', ')}}`
  }
  return 'None'
}

/**
 * Python 关键字集合（PEP 8 惯例：变量名冲突时末尾加下划线避让）。
 * 来源：keyword.kwlist（Python 3.10+）
 */
const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
  'with', 'yield', 'match', 'case'
])

/**
 * 将节点 ID + 端口 ID 转为合法 Python 标识符（变量名）。
 *
 * 生成规则（v2 - 可读性优先）：
 *   1. 主格式：`{nodeId}_{portId}`（如 `load1_result`、`u1_response`）
 *   2. 清理：非 `[a-zA-Z0-9_]` 字符替换为 `_`
 *   3. 数字开头处理：前缀加 `n`（避免 Python 标识符以数字开头）
 *   4. Python 关键字冲突：末尾加 `_`（PEP 8 惯例，如 `class_out` 仍合法）
 *
 * 三大保证：
 *   - 唯一性：由 nodeId 唯一 + portId 唯一共同保证
 *   - 合法性：清理 + 数字开头 + 关键字检测确保符合 Python 标识符规则
 *   - 稳定性：纯函数，同输入同输出（同一节点同一端口的变量名在所有引用处一致）
 */
export function pyIdentifier(nodeId: string, portId: string): string {
  const cleanNode = nodeId.replace(/[^a-zA-Z0-9_]/g, '_')
  const cleanPort = portId.replace(/[^a-zA-Z0-9_]/g, '_')
  let name = `${cleanNode}_${cleanPort}`
  // 数字开头处理：Python 标识符不能以数字开头，加 n 前缀（比 _ 前缀更可读）
  if (/^[0-9]/.test(name)) {
    name = `n${name}`
  }
  // Python 关键字冲突：末尾加下划线（PEP 8 惯例）
  if (PY_KEYWORDS.has(name)) {
    name = `${name}_`
  }
  return name
}

/** 收集 Python import 语句，去重并排序 */
export class ImportCollector {
  private imports = new Set<string>()

  add(stmt: string): void {
    this.imports.add(stmt)
  }

  toCode(): string {
    return Array.from(this.imports)
      .sort((a, b) => {
        const aIsFrom = a.startsWith('from ')
        const bIsFrom = b.startsWith('from ')
        if (aIsFrom !== bIsFrom) {
          return aIsFrom ? 1 : -1
        }
        return a < b ? -1 : a > b ? 1 : 0
      })
      .join('\n')
  }

  size(): number {
    return this.imports.size
  }

  // 以下是 TS 侧 EmitContext（typescriptUtils.createImportCollector 的形状）要的方法：
  // generator.ts 目前仍用本类收集 import，两套 collector 形状必须对齐才能互换。
  has(stmt: string): boolean {
    return this.imports.has(stmt)
  }

  toArray(): string[] {
    return Array.from(this.imports).sort()
  }

  clear(): void {
    this.imports.clear()
  }
}
