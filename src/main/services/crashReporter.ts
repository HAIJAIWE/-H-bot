// src/main/services/crashReporter.ts
import { app, crashReporter } from 'electron'
import { readFile, readdir, writeFile, unlink, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'
import * as os from 'os'
import { createWriteStream } from 'fs'
import { createDeflateRaw, constants as zlibConstants } from 'zlib'
import { Writable } from 'stream'
import { logger } from './logger'

const MAX_REPORTS = 20
const REPORTS_DIR = 'crashes'

// ====== 类型 ======

export interface CrashReport {
  id: string
  timestamp: string
  type: 'uncaughtException' | 'unhandledRejection' | 'renderer' | 'captured'
  message: string
  stack: string
  version: string
  os: string
  extra?: Record<string, unknown>
}

export interface CrashReportMeta {
  id: string
  timestamp: string
  type: CrashReport['type']
  message: string
}

// ====== 路径 ======

function getReportsDir(): string {
  const dir = join(app.getPath('userData'), REPORTS_DIR)
  if (!existsSync(dir)) {
    try {
      require('fs').mkdirSync(dir, { recursive: true })
    } catch {
      // 清理 electron crashReporter 单例失败不影响主流程
    }
  }
  return dir
}

function reportFilePath(id: string): string {
  return join(getReportsDir(), `crash-${id}.json`)
}

export function makeId(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function collectOsString(): string {
  return `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`
}

// ====== 写入报告 ======

export async function saveReport(report: CrashReport): Promise<void> {
  const dir = getReportsDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  const filePath = reportFilePath(report.id)
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8')
  await pruneOldReports()
}

async function pruneOldReports(): Promise<void> {
  try {
    const dir = getReportsDir()
    if (!existsSync(dir)) return
    const files = await readdir(dir)
    const jsonFiles = files
      .filter((f) => f.startsWith('crash-') && f.endsWith('.json'))
      .sort()
      .reverse()

    if (jsonFiles.length > MAX_REPORTS) {
      const toRemove = jsonFiles.slice(MAX_REPORTS)
      await Promise.all(toRemove.map((f) => unlink(join(dir, f)).catch(() => {})))
    }
  } catch {
    // 不阻塞主流程
  }
}

// ====== 公共 API ======

export function initCrashReporter(): void {
  // 初始化 Electron 原生崩溃报告（仅本地落盘，不自动上传）
  try {
    crashReporter.start({
      submitURL: '',
      uploadToServer: false,
      ignoreSystemCrashHandler: true
    })
  } catch {
    // electron crashReporter 在开发模式下可能不可用
  }
}

export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const report: CrashReport = {
    id: makeId(),
    timestamp: new Date().toISOString(),
    type: 'captured',
    message,
    stack,
    version: app.getVersion(),
    os: collectOsString(),
    extra: {
      ...extra,
      node: process.version,
      electron: process.versions.electron ?? 'unknown',
      pid: process.pid
    }
  }
  saveReport(report).catch(() => {})
}

export async function getRecentReports(count?: number): Promise<CrashReportMeta[]> {
  try {
    const dir = getReportsDir()
    if (!existsSync(dir)) return []
    const files = await readdir(dir)
    const jsonFiles = files
      .filter((f) => f.startsWith('crash-') && f.endsWith('.json'))
      .sort()
      .reverse()

    const limit = count ?? MAX_REPORTS
    const targets = jsonFiles.slice(0, limit)

    const reports: CrashReportMeta[] = []
    for (const filename of targets) {
      const filePath = join(dir, filename)
      try {
        const content = await readFile(filePath, 'utf-8')
        const parsed: CrashReport = JSON.parse(content)
        reports.push({
          id: parsed.id,
          timestamp: parsed.timestamp,
          type: parsed.type,
          message: parsed.message
        })
      } catch {
        // 跳过损坏的文件
      }
    }
    return reports
  } catch (e) {
    logger.warn('[crashReporter] 读取崩溃报告列表失败:', e)
    return []
  }
}

export async function readReport(id: string): Promise<CrashReport | null> {
  try {
    const dir = getReportsDir()
    const filePath = reportFilePath(id)
    // 严格校验：规范化后必须在 reports 目录内（防止 `../` 前缀攻击绕过 startsWith）
    const resolvedPath = resolve(filePath)
    const rel = relative(dir, resolvedPath)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as CrashReport
  } catch (e) {
    logger.warn('[crashReporter] 读取崩溃报告失败:', e)
    return null
  }
}

export async function clearReports(): Promise<void> {
  try {
    const dir = getReportsDir()
    if (!existsSync(dir)) return
    const files = await readdir(dir)
    const jsonFiles = files.filter((f) => f.startsWith('crash-') && f.endsWith('.json'))
    await Promise.all(jsonFiles.map((f) => unlink(join(dir, f)).catch(() => {})))
  } catch {
    // 删除已上报的崩溃报告失败可忽略
  }
}

// ====== 诊断包导出 ======

/** CRC32 */
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

function dosTime(date: Date): number {
  return ((date.getSeconds() / 2) | 0) | (date.getMinutes() << 5) | (date.getHours() << 11)
}

function dosDate(date: Date): number {
  return date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9)
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

  writeToStream(outputStream: Writable): void {
    const localHeaders: Buffer[] = []
    const centralEntries: Buffer[] = []
    let offset = 0

    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf-8')

      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(0x04034b50, 0)
      localHeader.writeUInt16LE(20, 4)
      localHeader.writeUInt16LE(0, 6)
      localHeader.writeUInt16LE(8, 8)
      localHeader.writeUInt16LE(entry.dosTime, 10)
      localHeader.writeUInt16LE(entry.dosDate, 12)
      localHeader.writeUInt32LE(entry.crc, 14)
      localHeader.writeUInt32LE(entry.compressedSize, 18)
      localHeader.writeUInt32LE(entry.uncompressedSize, 22)
      localHeader.writeUInt16LE(nameBuf.length, 26)
      localHeader.writeUInt16LE(0, 28)

      localHeaders.push(localHeader)
      localHeaders.push(nameBuf)
      localHeaders.push(entry.compressed)

      const centralHeader = Buffer.alloc(46)
      centralHeader.writeUInt32LE(0x02014b50, 0)
      centralHeader.writeUInt16LE(20, 4)
      centralHeader.writeUInt16LE(20, 6)
      centralHeader.writeUInt16LE(0, 8)
      centralHeader.writeUInt16LE(8, 10)
      centralHeader.writeUInt16LE(entry.dosTime, 12)
      centralHeader.writeUInt16LE(entry.dosDate, 14)
      centralHeader.writeUInt32LE(entry.crc, 16)
      centralHeader.writeUInt32LE(entry.compressedSize, 20)
      centralHeader.writeUInt32LE(entry.uncompressedSize, 24)
      centralHeader.writeUInt16LE(nameBuf.length, 28)
      centralHeader.writeUInt16LE(0, 30)
      centralHeader.writeUInt16LE(0, 32)
      centralHeader.writeUInt16LE(0, 34)
      centralHeader.writeUInt16LE(0, 36)
      centralHeader.writeUInt32LE(0, 38)
      centralHeader.writeUInt32LE(offset, 42)

      centralEntries.push(centralHeader)
      centralEntries.push(nameBuf)

      offset += 30 + nameBuf.length + entry.compressedSize
    }

    const centralSize = Buffer.concat(centralEntries).length
    const centralOffset = Buffer.concat(localHeaders).length

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(this.entries.length, 8)
    eocd.writeUInt16LE(this.entries.length, 10)
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(centralOffset, 16)
    eocd.writeUInt16LE(0, 20)

    for (const buf of localHeaders) outputStream.write(buf)
    for (const buf of centralEntries) outputStream.write(buf)
    outputStream.write(eocd)
  }
}

interface ExportResult {
  outputPath: string
  fileSize: number
}

export async function exportDiagnostic(
  outputPath: string
): Promise<ExportResult> {
  const zip = new ZipWriter()

  // 1. 收集崩溃报告
  const reportsDir = getReportsDir()
  if (existsSync(reportsDir)) {
    const files = await readdir(reportsDir)
    const jsonFiles = files.filter((f) => f.startsWith('crash-') && f.endsWith('.json'))
    for (const name of jsonFiles) {
      try {
        const content = await readFile(join(reportsDir, name))
        await zip.addFile(`crash-reports/${name}`, content)
      } catch {
        // 跳过无法解析的崩溃元数据
      }
    }
  }

  // 2. 采集环境信息
  const envInfo = {
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
    node: process.version,
    electron: process.versions.electron ?? 'unknown',
    app: {
      name: app.getName(),
      version: app.getVersion(),
      userData: app.getPath('userData'),
      logs: app.getPath('logs')
    },
    memory: process.memoryUsage(),
    uptime: process.uptime()
  }
  await zip.addFile('environment.json', JSON.stringify(envInfo, null, 2))

  // 3. 收集应用日志
  const logsDir = app.getPath('logs')
  if (existsSync(logsDir)) {
    const logEntries = await readdir(logsDir, { withFileTypes: true })
    for (const entry of logEntries) {
      if (!entry.isFile()) continue
      try {
        const content = await readFile(join(logsDir, entry.name))
        await zip.addFile(`app-logs/${entry.name}`, content)
      } catch {
        // 清理过期报告失败不影响新报告写入
      }
    }
  }

  // 4. 写入 ZIP
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(outputPath)
    ws.on('finish', resolve)
    ws.on('error', reject)
    zip.writeToStream(ws)
    ws.end()
  })

  const fileStat = await stat(outputPath)
  return { outputPath, fileSize: fileStat.size }
}
