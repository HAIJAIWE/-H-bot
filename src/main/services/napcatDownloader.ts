// src/main/services/napcatDownloader.ts
//
// NapCat Shell（Windows）一键下载 + 解压到 {projectPath}/napcat。
//
// 还原说明：10/18 打包产物里这个模块被 bundler 裁掉了（没有任何 chunk 含字符串
// 'NapCat.Shell' / 'downloadNapCat'），所以算法是**按 IPC 契约与 UI 行为重建**的：
//   - ipc/napcat.ts: 需要 downloadNapCat(projectPath, onProgress)、isNapcatDownloaded(projectPath)、
//     class NapcatDownloadError；
//   - NapcatSetupDialog.tsx:44-47 下载成功后把 {projectPath}\napcat 设为 NapCat 路径，
//     因此这里必须解压到该目录；
//   - 本文件不依赖第三方解压库：zip 用中央目录 + zlib.inflateRaw 自己解（NapCat.Shell.zip 是标准 deflate）。

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:https'
import { inflateRawSync } from 'node:zlib'
import { dirname, join, resolve, sep } from 'node:path'

/** 官方发布地（latest 重定向到当前最新 tag） */
const NAPCAT_RELEASE_URL =
  'https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.zip'

/** 下载失败时抛它；IPC 层按类型区分"网络问题"与"内部错误" */
export class NapcatDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NapcatDownloadError'
  }
}

/** 判断项目里是否已经有可用的 NapCat（Shell 版会带 napcat.bat） */
export function isNapcatDownloaded(projectPath: string): boolean {
  const dir = join(projectPath, 'napcat')
  return existsSync(join(dir, 'napcat.bat')) || existsSync(join(dir, 'napcat.ps1'))
}

/**
 * 下载并解压 NapCat Shell。
 *
 * @param projectPath 项目根目录；产物落在 {projectPath}/napcat
 * @param onProgress  进度回调（0-100）：下载占 0-75，解压占 75-100
 */
export async function downloadNapCat(
  projectPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const targetDir = join(projectPath, 'napcat')
  if (isNapcatDownloaded(projectPath)) {
    onProgress(100)
    return
  }

  const zipPath = join(dirname(targetDir), '.napcat-download-' + Date.now() + '.zip')
  mkdirSync(dirname(zipPath), { recursive: true })

  try {
    await downloadToFile(NAPCAT_RELEASE_URL, zipPath, (pct) => onProgress(Math.round(pct * 0.75)))
    mkdirSync(targetDir, { recursive: true })
    extractZip(zipPath, targetDir, (pct) => onProgress(75 + Math.round(pct * 0.25)))
    if (!isNapcatDownloaded(projectPath)) {
      throw new NapcatDownloadError('下载完成但压缩包里没有 napcat.bat，可能上游改了发布结构')
    }
    onProgress(100)
  } catch (e) {
    // 失败不留下半个目录，避免下次 isNapcatDownloaded 误判
    try {
      rmSync(targetDir, { recursive: true, force: true })
    } catch {
      /* 清理失败不掩盖原始错误 */
    }
    if (e instanceof NapcatDownloadError) throw e
    throw new NapcatDownloadError('NapCat 下载失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    try {
      rmSync(zipPath, { force: true })
    } catch {
      /* 临时文件删不掉不影响结果 */
    }
  }
}

/** 带重定向跟随的下载；按 Content-Length 回报 0-100 */
function downloadToFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  redirectsLeft = 5
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { headers: { 'User-Agent': 'qqbat' }, timeout: 30_000 }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (redirectsLeft <= 0) {
          rejectPromise(new NapcatDownloadError('重定向次数过多'))
          return
        }
        downloadToFile(res.headers.location, dest, onProgress, redirectsLeft - 1).then(
          resolvePromise,
          rejectPromise
        )
        return
      }
      if (status !== 200) {
        res.resume()
        rejectPromise(new NapcatDownloadError('下载返回 HTTP ' + status))
        return
      }

      const total = Number(res.headers['content-length'] ?? 0)
      let received = 0
      const out = createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total > 0) onProgress(Math.min(100, (received / total) * 100))
      })
      res.pipe(out)
      out.on('finish', () => {
        out.close()
        resolvePromise()
      })
      out.on('error', rejectPromise)
      res.on('error', rejectPromise)
    })
    req.on('timeout', () => {
      req.destroy(new NapcatDownloadError('下载超时'))
    })
    req.on('error', rejectPromise)
    req.end()
  })
}

/** 读取 zip 的中央目录并逐个解出（标准 deflate，足够覆盖 NapCat.Shell.zip） */
function extractZip(zipPath: string, destDir: string, onProgress: (percent: number) => void): void {
  const buf = readFileSync(zipPath)

  // 1) 从尾部找 End Of Central Directory（最长 65535 + 22 字节）
  const eocd = findEocd(buf)
  const entryCount = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new NapcatDownloadError('zip 中央目录损坏（第 ' + (i + 1) + ' 项）')
    }
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen).replace(/\\/g, '/')

    const rel = safeEntryPath(name)
    if (rel && !name.endsWith('/')) {
      writeEntry(buf, localOffset, rel, method, compressedSize, destDir)
    }

    offset += 46 + nameLen + extraLen + commentLen
    onProgress(((i + 1) / entryCount) * 100)
  }
}

/** 找 EOCD 签名（0x06054b50），从后往前扫（zip 注释最长 65535） */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 65535 - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new NapcatDownloadError('不是有效的 zip 文件（找不到中央目录）')
}

/** 归一化条目路径，拒绝绝对路径与 ../，返回相对路径或 null（跳过） */
function safeEntryPath(name: string): string | null {
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  const parts = normalized.split('/').filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/** 解出单个条目（method 0=store，8=deflate） */
function writeEntry(
  buf: Buffer,
  localOffset: number,
  relPath: string,
  method: number,
  compressedSize: number,
  destDir: string
): void {
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) return
  const nameLen = buf.readUInt16LE(localOffset + 26)
  const extraLen = buf.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + nameLen + extraLen
  const raw = buf.subarray(dataStart, dataStart + compressedSize)

  let data: Buffer
  if (method === 0) data = Buffer.from(raw)
  else if (method === 8) data = inflateRawSync(raw)
  else throw new NapcatDownloadError('不支持的 zip 压缩方式 #' + method + '（' + relPath + '）')

  const outPath = resolve(destDir, relPath)
  const root = resolve(destDir)
  if (outPath !== root && !outPath.startsWith(root + sep)) {
    throw new NapcatDownloadError('压缩包条目越界：' + relPath)
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, data)
}

/** 供诊断用：已下载目录的大小（字节） */
export function napcatDirSize(projectPath: string): number {
  const dir = join(projectPath, 'napcat')
  try {
    return statSync(dir).size
  } catch {
    return 0
  }
}
