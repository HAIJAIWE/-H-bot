// src/main/services/diagnostics.ts
import { app } from 'electron'
import { readFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { createWriteStream } from 'fs'
import { createDeflateRaw, constants as zlibConstants } from 'zlib'
import { Writable } from 'stream'
import * as os from 'os'
import { botManager } from './botManager'

// ====== 类型 ======

export type DiagnosticsProgressPhase =
  | 'collecting_logs'
  | 'collecting_config'
  | 'collecting_flow'
  | 'collecting_env'
  | 'collecting_runtime'
  | 'collecting_crashes'
  | 'packaging'
  | 'done'
  | 'error'

export interface DiagnosticsProgress {
  phase: DiagnosticsProgressPhase
  message: string
  error?: string
}

type ProgressCallback = (progress: DiagnosticsProgress) => void

// ====== ZIP 写入器（纯内置模块，无额外依赖） ======

/** 计算 CRC32 */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 将 Date 转换为 DOS 时间格式 */
function dosTime(date: Date): number {
  return (
    ((date.getSeconds() / 2) | 0) |
    (date.getMinutes() << 5) |
    (date.getHours() << 11)
  )
}

function dosDate(date: Date): number {
  return (
    date.getDate() |
    ((date.getMonth() + 1) << 5) |
    ((date.getFullYear() - 1980) << 9)
  )
}

interface ZipEntry {
  name: string
  buffer: Buffer
  compressed: Buffer
  crc: number
  dosTime: number
  dosDate: number
  compressedSize: number
  uncompressedSize: number
}

class ZipWriter {
  private entries: ZipEntry[] = []

  async addFile(name: string, data: string | Buffer): Promise<void> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    const now = new Date()
    const crc = crc32(buf)

    // 压缩
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      const deflater = createDeflateRaw({ level: zlibConstants.Z_BEST_COMPRESSION })
      const chunks: Buffer[] = []
      deflater.on('data', (chunk: Buffer) => chunks.push(chunk))
      deflater.on('end', () => resolve(Buffer.concat(chunks)))
      deflater.on('error', reject)
      deflater.end(buf)
    })

    this.entries.push({
      name: name.replace(/\\/g, '/'),
      buffer: buf,
      compressed,
      crc,
      dosTime: dosTime(now),
      dosDate: dosDate(now),
      compressedSize: compressed.length,
      uncompressedSize: buf.length
    })
  }

  /** 将 ZIP 写入输出流 */
  writeToStream(outputStream: Writable): void {
    const localHeaders: Buffer[] = []
    const centralEntries: Buffer[] = []
    let offset = 0

    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf-8')

      // Local file header
      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(0x04034b50, 0) // signature
      localHeader.writeUInt16LE(20, 4) // version needed
      localHeader.writeUInt16LE(0, 6) // flags
      localHeader.writeUInt16LE(8, 8) // compression: deflate
      localHeader.writeUInt16LE(entry.dosTime, 10)
      localHeader.writeUInt16LE(entry.dosDate, 12)
      localHeader.writeUInt32LE(entry.crc, 14)
      localHeader.writeUInt32LE(entry.compressedSize, 18)
      localHeader.writeUInt32LE(entry.uncompressedSize, 22)
      localHeader.writeUInt16LE(nameBuf.length, 26) // file name length
      localHeader.writeUInt16LE(0, 28) // extra field length

      localHeaders.push(localHeader)
      localHeaders.push(nameBuf)
      localHeaders.push(entry.compressed)

      // Central directory entry
      const centralHeader = Buffer.alloc(46)
      centralHeader.writeUInt32LE(0x02014b50, 0) // signature
      centralHeader.writeUInt16LE(20, 4) // version made by
      centralHeader.writeUInt16LE(20, 6) // version needed
      centralHeader.writeUInt16LE(0, 8) // flags
      centralHeader.writeUInt16LE(8, 10) // compression: deflate
      centralHeader.writeUInt16LE(entry.dosTime, 12)
      centralHeader.writeUInt16LE(entry.dosDate, 14)
      centralHeader.writeUInt32LE(entry.crc, 16)
      centralHeader.writeUInt32LE(entry.compressedSize, 20)
      centralHeader.writeUInt32LE(entry.uncompressedSize, 24)
      centralHeader.writeUInt16LE(nameBuf.length, 28) // file name length
      centralHeader.writeUInt16LE(0, 30) // extra field length
      centralHeader.writeUInt16LE(0, 32) // file comment length
      centralHeader.writeUInt16LE(0, 34) // disk number start
      centralHeader.writeUInt16LE(0, 36) // internal file attributes
      centralHeader.writeUInt32LE(0, 38) // external file attributes
      centralHeader.writeUInt32LE(offset, 42) // relative offset

      centralEntries.push(centralHeader)
      centralEntries.push(nameBuf)

      offset += 30 + nameBuf.length + entry.compressedSize
    }

    const centralSize = Buffer.concat(centralEntries).length
    const centralOffset = Buffer.concat(localHeaders).length

    // EOCD record
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0) // signature
    eocd.writeUInt16LE(0, 4) // disk number
    eocd.writeUInt16LE(0, 6) // disk with central directory
    eocd.writeUInt16LE(this.entries.length, 8) // entries on this disk
    eocd.writeUInt16LE(this.entries.length, 10) // total entries
    eocd.writeUInt32LE(centralSize, 12) // central directory size
    eocd.writeUInt32LE(centralOffset, 16) // central directory offset
    eocd.writeUInt16LE(0, 20) // comment length

    // 写入所有内容
    for (const buf of localHeaders) outputStream.write(buf)
    for (const buf of centralEntries) outputStream.write(buf)
    outputStream.write(eocd)
  }
}

// ====== 脱敏处理 ======

/** 脱敏敏感字段 */
function desensitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = new Set(['apiKey', 'appSecret', 'token'])
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = desensitizeConfig(value as Record<string, unknown>)
    } else if (SENSITIVE_KEYS.has(key)) {
      result[key] = '***'
    } else {
      result[key] = value
    }
  }

  return result
}

// ====== 环境信息采集 ======

function collectEnvironment(): Record<string, unknown> {
  return {
    os: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      type: os.type(),
      version: os.version(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
      freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`
    },
    node: {
      version: process.version,
      arch: process.arch
    },
    electron: {
      version: process.versions.electron ?? 'unknown'
    },
    app: {
      name: app.getName(),
      version: app.getVersion(),
      userData: app.getPath('userData'),
      logs: app.getPath('logs')
    }
  }
}

// ====== 运行状态采集 ======

/**
 * 采集运行状态。
 *
 * 10/18 基线是 TS-only + 官方通道：Python 子进程与 NapCat 都退役了，诊断包再去探测它们
 * 只会写进「python 没装 / NapCat 未连接」这种误导性的假信息；真状态在 botManager 里。
 */
async function collectRuntimeStatus(projectPath: string): Promise<Record<string, unknown>> {
  let botStatus: Record<string, unknown> = { running: false }
  try {
    const status = botManager.getBotStatus(projectPath)
    if (status) {
      botStatus = {
        running: status.status === 'running',
        status: status.status,
        adapter: status.adapter,
        startedAt: status.startedAt,
        uptime: status.uptime,
        pid: status.pid
      }
    }
  } catch {
    botStatus = { running: false, error: '无法获取 bot 状态' }
  }

  return {
    runtime: 'ts',
    node: process.versions.node,
    bot: botStatus
  }
}

// ====== 日志收集 ======

async function collectAppLogs(): Promise<Map<string, Buffer>> {
  const logsDir = app.getPath('logs')
  const files = new Map<string, Buffer>()

  if (!existsSync(logsDir)) return files

  const entries = await readdir(logsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile()) continue

    const fullPath = join(logsDir, entry.name)
    try {
      const content = await readFile(fullPath)
      files.set(entry.name, content)
    } catch {
      // 跳过无法读取的文件
    }
  }

  return files
}

// ====== 崩溃报告收集 ======

/**
 * 收集崩溃报告，同时覆盖两个来源：
 *   1. JS 层崩溃（crashes/crash-*.json）—— 由 crashReporter.saveReport 写入，
 *      记录 uncaughtException / unhandledRejection / captureException，内容可读
 *   2. Electron 原生崩溃（crash-reports/*.dmp）—— 由 crashReporter.start() 写入，
 *      记录 C++ 层崩溃（如 segfault），二进制 dump
 *
 * 修复：原实现只读 crash-reports/，导致 JS 层可读的 crash-*.json 不被诊断包收集。
 * 现用前缀区分来源，避免文件名冲突，便于排查时分类查看。
 */
async function collectCrashReports(): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const userData = app.getPath('userData')

  // 1. JS 层崩溃报告（可读 json）
  await collectCrashFilesFromDir(join(userData, 'crashes'), 'js/', files)

  // 2. Electron 原生崩溃 dump（二进制 .dmp）
  await collectCrashFilesFromDir(join(userData, 'crash-reports'), 'native/', files)

  return files
}

/** 遍历目录收集文件到 Map，文件名加前缀以区分来源 */
async function collectCrashFilesFromDir(dir: string, prefix: string, files: Map<string, Buffer>): Promise<void> {
  if (!existsSync(dir)) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = join(dir, entry.name)
    try {
      const content = await readFile(fullPath)
      files.set(`${prefix}${entry.name}`, content)
    } catch {
      // 跳过无法读取的文件
    }
  }
}

// ====== 主导出函数 ======

interface ExportResult {
  outputPath: string
  fileSize: number
}

export async function exportDiagnostics(
  projectPath: string,
  outputPath: string,
  onProgress?: ProgressCallback
): Promise<ExportResult> {
  const zip = new ZipWriter()

  function report(phase: DiagnosticsProgressPhase, message: string): void {
    onProgress?.({ phase, message })
  }

  try {
    // 1. 收集应用日志
    report('collecting_logs', '正在收集日志...')
    const logFiles = await collectAppLogs()
    for (const [name, content] of logFiles) {
      zip.addFile(`app-logs/${name}`, content)
    }
    report('collecting_logs', `已收集 ${logFiles.size} 个日志文件`)

    // 2. 收集项目配置（脱敏）
    report('collecting_config', '正在收集项目配置...')
    const configPath = join(projectPath, '.qqbat', 'project.json')
    if (existsSync(configPath)) {
      const raw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(raw)
      const desensitized = desensitizeConfig(config)
      await zip.addFile('project-config.json', JSON.stringify(desensitized, null, 2))
    }
    report('collecting_config', '已完成配置脱敏')

    // 3. 收集 flow.json
    report('collecting_flow', '正在收集流程数据...')
    const flowPath = join(projectPath, '.qqbat', 'flow.json')
    if (existsSync(flowPath)) {
      const flowContent = await readFile(flowPath, 'utf-8')
      await zip.addFile('flow.json', flowContent)
    }
    report('collecting_flow', '已完成流程数据收集')

    // 4. 收集环境信息
    report('collecting_env', '正在收集环境信息...')
    const envInfo = collectEnvironment()
    await zip.addFile('environment.json', JSON.stringify(envInfo, null, 2))
    report('collecting_env', '已完成环境信息收集')

    // 5. 收集运行状态
    report('collecting_runtime', '正在收集运行状态...')
    const runtimeStatus = await collectRuntimeStatus(projectPath)
    await zip.addFile('runtime-status.json', JSON.stringify(runtimeStatus, null, 2))
    report('collecting_runtime', '已完成运行状态收集')

    // 6. 收集崩溃报告
    report('collecting_crashes', '正在收集崩溃报告...')
    const crashFiles = await collectCrashReports()
    for (const [name, content] of crashFiles) {
      await zip.addFile(`crashes/${name}`, content)
    }
    report('collecting_crashes', `已收集 ${crashFiles.size} 个崩溃报告`)

    // 7. 打包写入
    report('packaging', '正在压缩打包...')
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(outputPath)
      ws.on('finish', resolve)
      ws.on('error', reject)
      zip.writeToStream(ws)
      ws.end()
    })

    // 获取文件大小
    const fileStat = await stat(outputPath)

    report('done', `诊断包已导出: ${outputPath}`)
    return {
      outputPath,
      fileSize: fileStat.size
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'error', message, error: message })
    throw e
  }
}
