// src/main/services/pathGuard.ts
import { existsSync } from 'fs'
import { resolve, relative, isAbsolute, basename } from 'path'

/**
 * 规范化项目路径，用作**凭据文件名**的键。
 *
 * 为什么需要它（真机踩到）：路径字符串差一个分隔符/盘符大小写，就会生成两个不同的
 * base64url 文件名，表现为「未配置 AppID 和 AppSecret」。这里只做纯字符串归一化：
 * resolve 成绝对路径 → 去掉结尾分隔符 → Windows 下统一小写。
 * 旧文件名（原始路径）的兼容由调用方按候选列表回退（official.ts:296）。
 */
export function canonicalProjectPath(projectPath: string): string {
  if (!projectPath) return ''
  let p = resolve(projectPath)
  p = p.replace(/[\\/]+$/, '')
  if (!p) p = resolve(projectPath)
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/**
 * 判断目标路径是否在项目根目录内。
 * 通过 resolve 规范化后检查 relative 结果不以 `..` 开头且非绝对路径。
 *
 * @param projectRoot 项目根目录绝对路径
 * @param targetPath 待检查路径（相对或绝对）
 * @returns true 表示在项目内，false 表示越界
 */
export function isWithinProject(projectRoot: string, targetPath: string): boolean {
  const resolvedRoot = resolve(projectRoot)
  const resolvedTarget = resolve(resolvedRoot, targetPath)
  if (!isAbsolute(resolvedTarget)) return false
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 断言目标路径在项目根目录内，否则抛出路径越界错误。
 *
 * @param projectRoot 项目根目录绝对路径
 * @param targetPath 待检查路径（相对或绝对）
 * @throws {Error} 路径越界时抛出
 */
export function assertWithinProject(projectRoot: string, targetPath: string): void {
  if (!isWithinProject(projectRoot, targetPath)) {
    throw new Error(`路径越界：${targetPath} 不在项目 ${projectRoot} 内`)
  }
}

/**
 * 安全拼接路径：先校验 relativePath 不越界，再返回 resolve 结果。
 *
 * @param projectRoot 项目根目录绝对路径
 * @param relativePath 项目内的相对路径
 * @returns 拼接后的绝对路径
 * @throws {Error} 路径越界时抛出
 */
export function joinSafe(projectRoot: string, relativePath: string): string {
  assertWithinProject(projectRoot, relativePath)
  return resolve(projectRoot, relativePath)
}

/**
 * 断言文件路径在指定基准目录内，且后缀在白名单中。
 *
 * 用于校验项目数据文件（如 dbPath），防止越界读取/写入任意文件。
 * 校验三层：
 *   1. 非空字符串 + 必须绝对路径
 *   2. resolve 规范化后 relative 到 basePath 不以 `..` 开头（防路径穿越）
 *   3. 后缀在白名单中（防读取非数据文件类型）
 *
 * @param basePath 基准目录（如 process.cwd() 或项目根路径）
 * @param filePath 待校验文件绝对路径
 * @param allowedExts 允许的后缀列表（如 ['.db', '.sqlite']）
 */
export function assertPathWithinBase(basePath: string, filePath: string, allowedExts: string[]): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('文件路径不能为空')
  }
  if (!isAbsolute(filePath)) {
    throw new Error('文件路径必须是绝对路径')
  }
  const normalized = resolve(filePath)
  const rel = relative(basePath, normalized)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界：${filePath} 不在 ${basePath} 内`)
  }
  const lower = normalized.toLowerCase()
  if (!allowedExts.some(ext => lower.endsWith(ext.toLowerCase()))) {
    throw new Error(`不支持的文件类型：${filePath}（允许：${allowedExts.join(', ')}）`)
  }
}

/**
 * 系统关键目录黑名单（小写），用于拒绝写入/读取系统目录。
 * Windows 与 POSIX 分别维护。
 */
const SYSTEM_DIR_BLACKLIST: string[] = process.platform === 'win32'
  ? ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata', 'c:\\boot']
  : ['/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/root', '/lib', '/lib64']

/**
 * 断言外部文件路径安全：白名单后缀 + 拒绝系统关键目录。
 *
 * 用于校验用户选择的导入/导出路径（允许任意合法用户目录，但防止
 * 写入系统目录造成破坏，并限制后缀防止误操作）。
 *
 * 注意：本函数允许路径在 basePath 之外（用户可导出到桌面等任意位置），
 * 仅做后缀与系统目录黑名单校验。`..` 段会被 resolve 自动消化，
 * 因此不额外检查（符号链接穿越需 fs.realpathSync，属更高级防御，暂不处理）。
 *
 * @param filePath 待校验文件绝对路径
 * @param allowedExts 允许的后缀列表（如 ['.json', '.csv']）
 */
export function assertExternalPathSafe(filePath: string, allowedExts: string[]): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('文件路径不能为空')
  }
  if (!isAbsolute(filePath)) {
    throw new Error('文件路径必须是绝对路径')
  }
  const normalized = resolve(filePath)
  const lower = normalized.toLowerCase()
  // 拒绝系统关键目录及其子目录
  for (const sysDir of SYSTEM_DIR_BLACKLIST) {
    if (lower === sysDir || lower.startsWith(sysDir + (process.platform === 'win32' ? '\\' : '/'))) {
      throw new Error(`禁止访问系统目录：${filePath}`)
    }
  }
  if (!allowedExts.some(ext => lower.endsWith(ext.toLowerCase()))) {
    throw new Error(`不支持的文件类型：${filePath}（允许：${allowedExts.join(', ')}）`)
  }
}

/**
 * 可执行文件扩展名黑名单（小写）。
 *
 * `shell.openPath` 在 Windows 上会调用系统默认处理器，直接执行这些扩展名的文件
 * 会带来安全风险（任意代码执行）。用于 `assertOpenPathSafe` 校验。
 */
const EXECUTABLE_EXTS: string[] = [
  '.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.ps1',
  '.sh', '.bin', '.run', '.app', '.action', '.workflow'
]

/**
 * 断言通过 `shell.openPath` 打开的路径安全。
 *
 * 用于 `docker:openFolder` / `project:openFolder` 等 IPC handler，防止：
 *   1. 打开系统关键目录（C:\\Windows、/etc 等）
 *   2. 直接执行可执行文件（.exe/.bat/.sh 等，shell.openPath 可触发系统默认处理器）
 *   3. 相对路径（可能被构造为指向意外位置）
 *
 * 注意：本函数不限制路径必须在项目内（导出目录可在任意用户目录），
 * 仅做系统目录黑名单 + 可执行扩展名黑名单校验。
 *
 * @param targetPath 待校验的目录/文件绝对路径
 */
export function assertOpenPathSafe(targetPath: string): void {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('路径不能为空')
  }
  if (!isAbsolute(targetPath)) {
    throw new Error('路径必须是绝对路径')
  }
  const normalized = resolve(targetPath)
  const lower = normalized.toLowerCase()
  // 拒绝系统关键目录及其子目录
  for (const sysDir of SYSTEM_DIR_BLACKLIST) {
    if (lower === sysDir || lower.startsWith(sysDir + (process.platform === 'win32' ? '\\' : '/'))) {
      throw new Error(`禁止打开系统目录：${targetPath}`)
    }
  }
  // 拒绝可执行文件扩展名（shell.openPath 可触发系统默认处理器执行）
  if (EXECUTABLE_EXTS.some(ext => lower.endsWith(ext))) {
    throw new Error(`禁止打开可执行文件：${targetPath}`)
  }
}

/**
 * 断言可执行文件路径安全。
 *
 * 用于 `napcat:setPath` / `python:setPath` 等保存外部可执行程序路径的场景，防止：
 *   1. 指向系统关键目录（C:\Windows、/bin 等）的可执行文件
 *   2. 相对路径（可能被构造为指向意外位置）
 *   3. 空路径或非字符串路径
 *
 * 与 `assertOpenPathSafe` 不同：本函数允许可执行文件扩展名（因为目标就是保存可执行程序），
 * 但同样拒绝系统目录黑名单。调用方若需进一步校验，可在保存前检查文件是否存在。
 *
 * @param targetPath 待校验的可执行文件绝对路径
 * @param requireExists 是否要求文件/目录在磁盘上真实存在（默认 false，避免选择对话框尚未确认时误报）
 */
export function assertExecutablePathSafe(targetPath: string, requireExists: boolean = false): void {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('路径不能为空')
  }
  if (!isAbsolute(targetPath)) {
    throw new Error('路径必须是绝对路径')
  }
  const normalized = resolve(targetPath)
  const lower = normalized.toLowerCase()
  // 拒绝系统关键目录及其子目录
  for (const sysDir of SYSTEM_DIR_BLACKLIST) {
    if (lower === sysDir || lower.startsWith(sysDir + (process.platform === 'win32' ? '\\' : '/'))) {
      throw new Error(`禁止将可执行路径指向系统目录：${targetPath}`)
    }
  }
  if (requireExists && !existsSync(normalized)) {
    throw new Error(`路径不存在：${targetPath}`)
  }
}

/** Python 解释器可接受的文件名（不含扩展名，小写）。 */
const PYTHON_BASE_NAMES: Set<string> = new Set(['python', 'python3', 'py'])

/** 危险 shell 文件名黑名单（不含扩展名，小写），用于拒绝伪装成 Python 的系统 shell。 */
const DANGEROUS_SHELL_NAMES: Set<string> = new Set([
  'cmd', 'cmd.exe',
  'powershell', 'pwsh', 'powershell.exe', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'fish', 'csh', 'ksh',
  'explorer', 'explorer.exe',
  'wt', 'wt.exe'
])

/**
 * 断言 Python 解释器路径安全。
 *
 * 用于 `python:setPath` 保存自定义 Python 解释器路径。校验：
 *   1. 非空字符串 + 必须绝对路径
 *   2. 文件名（不含扩展名）必须是 python / python3 / py
 *   3. 拒绝常见系统 shell 文件名（防止把 cmd.exe / powershell.exe 伪造成 Python 路径）
 *   4. 可选校验文件在磁盘上存在
 *
 * 注意：本函数不限制路径必须在用户目录内，因为系统安装的 Python（如 /usr/bin/python3、
 * C:\Python312\python.exe）是合法且常见的选择。
 *
 * @param targetPath 待校验的 Python 解释器绝对路径
 * @param requireExists 是否要求文件真实存在（默认 false）
 */
export function assertPythonPathSafe(targetPath: string, requireExists: boolean = false): void {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('路径不能为空')
  }
  if (!isAbsolute(targetPath)) {
    throw new Error('路径必须是绝对路径')
  }
  const normalized = resolve(targetPath)
  const baseName = basename(normalized)
  const baseNameLower = baseName.toLowerCase()
  const nameWithoutExt = baseNameLower.replace(/\.exe$/, '')

  if (DANGEROUS_SHELL_NAMES.has(baseNameLower)) {
    throw new Error(`禁止将 Python 路径设置为系统 shell：${targetPath}`)
  }
  if (!PYTHON_BASE_NAMES.has(nameWithoutExt)) {
    throw new Error(
      `Python 解释器文件名必须是 python / python3 / py 之一：${targetPath}`
    )
  }
  if (requireExists && !existsSync(normalized)) {
    throw new Error(`路径不存在：${targetPath}`)
  }
}
