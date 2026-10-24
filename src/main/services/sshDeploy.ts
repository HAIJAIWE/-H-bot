// src/main/services/sshDeploy.ts
// SSH 部署服务：通过 SSH/SFTP 将项目上传到远程服务器并执行 docker build/run
//
// 依赖说明：
// - 本服务依赖 ssh2 库（npm install ssh2），但采用"动态 require + 运行时降级"策略：
//   * 若 ssh2 未安装，部署会在连接阶段失败，并返回清晰的错误信息提示用户安装
//   * 这样既允许项目在未安装 ssh2 时仍能编译运行（Docker 导出功能不受影响），
//     又能在用户安装 ssh2 后立即启用 SSH 部署能力，无需修改代码。
// - 不在 import 顶部直接 import ssh2，避免 TypeScript 在缺少类型时编译失败。
//
// 部署流程：
//   1. 测试 SSH 连接（探测网络可达性与凭证有效性）
//   2. 在远程创建部署目录（递归 mkdir -p）
//   3. 通过 SFTP 上传项目文件（.qqbat/ / data/ / plugins/ / src/ / .env）与 TS 运行时（runtime/）
//   4. 上传 Dockerfile / docker-compose.yml / start.sh / .dockerignore / .env.example
//   5. 在远程执行 docker compose up -d --build（或 docker build + docker run）
//   6. 实时回传每一步的 stdout/stderr 给前端展示
//   7. 返回汇总结果（成功/失败、累计日志、错误信息）

import { readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { exportProjectToDocker, type DockerExportOptions, type DeployAdapter } from './dockerExport'
import {
  copyRuntimeBundle,
  copyRuntimeManifest,
  nodeInstallShell,
  runtimeEntryRel,
  RUNTIME_DIR_NAME
} from './deploy/runtimeBundle'

/** SSH 握手超时（等待服务器 ready 事件） */
const SSH_READY_TIMEOUT_MS = 30000
/** SSH 连接总超时（含认证，超过此时间强制断开） */
const SSH_CONNECT_TIMEOUT_MS = 35000

/** SSH 认证方式 */
export interface SshAuthConfig {
  host: string
  port: number
  username: string
  /** 密码（与 privateKey 二选一） */
  password?: string
  /** 私钥内容（PEM 格式字符串，与 password 二选一） */
  privateKey?: string
  /** 私钥口令（若私钥已加密） */
  passphrase?: string
}

/** 部署配置 */
export interface SshDeployConfig extends SshAuthConfig {
  /** 远程部署目录（绝对路径，如 /opt/qqbat/my-bot） */
  remotePath: string
  /** 适配器类型 */
  adapter: DeployAdapter
  /** 镜像名（默认 qqbat-bot） */
  imageName?: string
  /** 容器对外端口（注意：与 SshAuthConfig.port 不同，此处为容器端口） */
  containerPort?: number
  /**
   * 部署模式：
   *   - 'docker'   远程构建并运行 Docker 镜像（默认，推荐）
   *   - 'node'     远程直接 node runtime/standalone.js（要求远程已装好 Node 22；不需要 Python）
   */
  mode?: 'docker' | 'node'
}

/** 部署结果 */
export interface SshDeployResult {
  success: boolean
  /** 摘要信息 */
  message: string
  /** 累计日志（按时间顺序） */
  logs: string[]
  /** 错误信息（success=false 时存在） */
  error: string
  /** 远程容器 ID 或 PID（可选） */
  remoteId?: string
}

/** 进度回调：实时推送日志行 */
export type SshDeployProgress = (line: string) => void

/**
 * 远程 shell 字符串安全转义：用单引号包裹并把内部单引号转义。
 *
 * 修复 SSH 命令注入：旧实现直接 `mkdir -p "${remotePath}"` 把 remotePath/imageName
 * 拼入远程 shell 命令，双引号内的 `"`、`$`、`` ` ``、`\` 仍会被远端 sh 解析。
 * 配合 schemas/deploy.ts 的字符白名单（第一道防御），此处做第二道防御。
 *
 * 用法：`execRemote(client, \`mkdir -p ${shellQuote(remotePath)}\`, emit)`
 */
function shellQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

/**
 * 部署项目到远程服务器
 *
 * @param projectPath 本地项目路径
 * @param config      SSH 部署配置
 * @param onProgress  实时日志回调
 */
export async function deployProjectViaSsh(
  projectPath: string,
  config: SshDeployConfig,
  onProgress?: SshDeployProgress
): Promise<SshDeployResult> {
  const logs: string[] = []
  const emit = (line: string) => {
    logs.push(line)
    onProgress?.(line)
  }

  const fail = (error: string, message = '部署失败'): SshDeployResult => {
    emit(`[ERROR] ${error}`)
    return { success: false, message, logs, error }
  }

  // 1. 校验输入
  if (!projectPath || !existsSync(projectPath)) {
    return fail(`项目路径不存在: ${projectPath}`)
  }
  if (!existsSync(join(projectPath, '.qqbat', 'flow.json'))) {
    return fail('项目缺少 .qqbat/flow.json（先在低代码画布保存一次）')
  }
  if (!config.host || !config.username) {
    return fail('SSH 主机或用户名为空')
  }
  if (!config.password && !config.privateKey) {
    return fail('必须提供密码或私钥进行认证')
  }
  if (!config.remotePath) {
    return fail('远程部署目录为空')
  }

  // 2. 动态加载 ssh2
  emit('[1/6] 加载 ssh2 库...')
  const ssh2 = tryLoadSsh2()
  if (!ssh2) {
    return fail(
      '未安装 ssh2 库。请在项目根目录执行 `npm install ssh2` 后重试。',
      '缺少 ssh2 依赖'
    )
  }
  emit('[1/6] ssh2 已就绪')

  // 3. 建立连接
  emit(`[2/6] 连接到 ${config.username}@${config.host}:${config.port}...`)
  let client: Ssh2Client
  try {
    client = await connectSsh(ssh2, config, emit)
  } catch (e: unknown) {
    return fail(`SSH 连接失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  emit('[2/6] SSH 连接已建立')

  // node 模式：远程依赖安装用哪个包管理器，由上传的锁文件决定
  let nodeLockfileName: string | null = null

  try {
    // 4. 创建远程目录
    emit(`[3/6] 创建远程目录: ${config.remotePath}`)
    await execRemote(client, `mkdir -p ${shellQuote(config.remotePath)}`, emit)

    // 5. 上传项目文件 + Docker 部署文件
    emit('[4/6] 上传项目文件...')
    const sftp = await openSftp(client, emit)

    try {
      // 5.1 上传项目核心文件
      const uploaded = await uploadProjectFiles(sftp, projectPath, config.remotePath, emit)
      emit(`[4/6] 已上传 ${uploaded} 个项目文件`)

      // 5.2 生成并上传 Docker 部署文件（Dockerfile / compose / start.sh / .dockerignore / .env.example / README.md）
      // node 模式不需要 Docker 文件；只有 docker 模式才生成并上传
      if (config.mode !== 'node') {
        emit('[4/6] 生成 Docker 部署文件...')
        const dockerOptions: DockerExportOptions = {
          adapter: config.adapter,
          outputDir: '', // 占位：uploadDockerFiles 内部会重新指定 tmpRoot
          imageName: config.imageName,
          port: config.containerPort
        }
        await uploadDockerFiles(sftp, projectPath, config.remotePath, dockerOptions, emit)
      }

      // 5.3 node 模式：把本地 TS 运行时整包传上去（docker 模式由 uploadDockerFiles 负责）
      if (config.mode === 'node') {
        emit('[4/6] 上传 TS 运行时（runtime/）与依赖清单...')
        const bundle = await uploadRuntimeDir(sftp, config.remotePath, emit)
        nodeLockfileName = bundle.lockfileName
      }
    } finally {
      await closeSftp(sftp, emit)
    }

    // 6. 远程启动
    if (config.mode === 'node') {
      const remotePath = shellQuote(config.remotePath)
      // 运行时依赖（ws/zod/electron-log/better-sqlite3）是 external，必须先在远程装好；
      // better-sqlite3 只能在目标平台装预编译，不能直接上传 Windows 的 .node。
      const installCmd = nodeInstallShell(nodeLockfileName ?? '')
      emit(`[5/6] 远程安装运行时依赖（${nodeLockfileName ?? '无锁文件'}，首次需下载 node_modules）...`)
      await execRemote(client, `cd ${remotePath} && ${installCmd} && echo QQBAT_DEPS_OK`, emit)
      emit('[5/6] 依赖安装完成，启动 runtime/standalone.js（直接 node 模式）...')
      const cmd =
        `cd ${remotePath} && QQBOT_PROJECT_ROOT=${remotePath} ` +
        `nohup node ${runtimeEntryRel()} . > bot.log 2>&1 & echo "PID=$!"`
      const result = await execRemote(client, cmd, emit)
      const pidMatch = result.match(/PID=(\d+)/)
      if (pidMatch) {
        emit(`[6/6] standalone 已启动，PID=${pidMatch[1]}`)
        return {
          success: true,
          message: `远程启动成功，PID=${pidMatch[1]}`,
          logs,
          error: '',
          remoteId: pidMatch[1]
        }
      }
      return {
        success: true,
        message: '启动命令已发送（PID 未捕获，请通过日志确认）',
        logs,
        error: ''
      }
    }

    // Docker 模式
    emit('[5/6] 远程构建 Docker 镜像（这一步可能耗时几分钟）...')
    const imageName = config.imageName || 'qqbat-bot'
    const port = config.containerPort ?? 8080
    await execRemote(
      client,
      `cd ${shellQuote(config.remotePath)} && docker build -t ${shellQuote(imageName)} .`,
      emit
    )

    emit('[6/6] 停止旧容器并启动新容器...')
    await execRemote(client, `docker rm -f ${shellQuote(imageName)} 2>/dev/null || true`, emit)
    const runCmd = `docker run -d --name ${shellQuote(imageName)} ` +
      `-p ${port}:${port} ` +
      `--env-file ${shellQuote(config.remotePath + '/.env')} ` +
      `-v ${shellQuote(config.remotePath + '/data')}:/app/data ` +
      `-v ${shellQuote(config.remotePath + '/.qqbat')}:/app/.qqbat ` +
      `--restart unless-stopped ` +
      `${shellQuote(imageName)}`
    const runOut = await execRemote(client, runCmd, emit)
    const cid = runOut.trim().split('\n').pop()?.trim()
    if (cid) {
      emit(`[6/6] 容器已启动，ID=${cid.slice(0, 12)}`)
      return {
        success: true,
        message: `远程部署成功，容器 ${cid.slice(0, 12)} 已启动`,
        logs,
        error: '',
        remoteId: cid.slice(0, 12)
      }
    }
    return {
      success: true,
      message: '部署命令已发送（容器 ID 未捕获，请通过 docker ps 确认）',
      logs,
      error: ''
    }
  } catch (e: unknown) {
    return fail(`部署过程出错: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    try {
      client.end()
      emit('[cleanup] SSH 连接已关闭')
    } catch {
      // ignore
    }
  }
}

// ====== SSH 操作封装（基于 ssh2 的动态类型） ======

interface Ssh2Module {
  Client: new () => Ssh2Client
}

interface Ssh2Client {
  connect(opts: unknown): Ssh2Client
  on(event: 'ready', cb: () => void): Ssh2Client
  on(event: 'error', cb: (err: Error) => void): Ssh2Client
  on(event: 'close', cb: () => void): Ssh2Client
  end(): void
  exec(cmd: string, cb: (err: Error | null, stream: Ssh2Stream) => void): void
  sftp(cb: (err: Error | null, sftp: Ssh2Sftp) => void): void
}

interface Ssh2Stream {
  on(event: 'data', cb: (data: Buffer) => void): Ssh2Stream
  on(event: 'close', cb: () => void): Ssh2Stream
  on(event: 'exit', cb: (code: number, signal: string) => void): Ssh2Stream
  stderr: { on(event: 'data', cb: (data: Buffer) => void): void }
}

interface Ssh2Sftp {
  mkdir(path: string, cb: (err: Error | null) => void): void
  readdir(path: string, cb: (err: Error | null, list: Array<{ filename: string; longname: string; attrs: unknown }>) => void): void
  fastPut(localPath: string, remotePath: string, cb: (err: Error | null) => void): void
  stat(path: string, cb: (err: Error | null, stats: { isDirectory(): boolean }) => void): void
  end(): void
}

/**
 * 尝试动态加载 ssh2 模块
 *
 * 使用 createRequire 而不是 require，以兼容 ESM 环境（虽然本项目是 CJS）。
 * 失败时返回 null，调用方据此给出清晰的错误提示。
 */
export function tryLoadSsh2(): Ssh2Module | null {
  try {
    // 优先使用 createRequire（Node 12.2+），保证 ESM/CJS 通用
    const mod = require('module')
    if (typeof mod.createRequire === 'function') {
      const req = mod.createRequire(__filename)
      return req('ssh2') as Ssh2Module
    }
    // 兜底：直接 require（CJS 环境）
    return require('ssh2') as Ssh2Module
  } catch {
    return null
  }
}

/** 建立 SSH 连接 */
function connectSsh(
  ssh2: Ssh2Module,
  config: SshDeployConfig,
  emit: (line: string) => void
): Promise<Ssh2Client> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client()
    const connectOpts: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: SSH_READY_TIMEOUT_MS,
      keepaliveInterval: 10000
    }
    if (config.privateKey) {
      connectOpts.privateKey = config.privateKey
      if (config.passphrase) connectOpts.passphrase = config.passphrase
    } else if (config.password) {
      connectOpts.password = config.password
    }

    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try { client.end() } catch { /* noop */ }
        reject(new Error('SSH 连接超时（30s）'))
      }
    }, SSH_CONNECT_TIMEOUT_MS)

    client.on('ready', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(client)
    })
    client.on('error', (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    client.on('close', () => {
      emit('[ssh] 连接关闭')
    })
    try {
      client.connect(connectOpts)
    } catch (e: unknown) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
  })
}

/** 远程执行命令并收集输出 */
function execRemote(
  client: Ssh2Client,
  command: string,
  emit: (line: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let resolved = false

    client.exec(command, (err, stream) => {
      if (err) {
        reject(err)
        return
      }
      stream.on('data', (data: Buffer) => {
        const text = data.toString('utf-8')
        stdout += text
        for (const line of text.split('\n')) {
          if (line.trim()) emit(`  [remote] ${line}`)
        }
      })
      stream.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8')
        stderr += text
        for (const line of text.split('\n')) {
          if (line.trim()) emit(`  [remote:err] ${line}`)
        }
      })
      // 记录 exit code，供 close 事件兜底判断（ssh2 网络异常时可能只触发 close 不触发 exit）
      let exitCode: number | null = null
      stream.on('close', () => {
        if (resolved) return
        resolved = true
        // 修复：旧实现无条件 resolve(stdout)，exit 事件丢失时失败的命令被当成功，
        // 后续步骤（docker build 失败后继续 docker run）连锁错误难定位
        if (exitCode === 0 || exitCode === null) {
          // exit === null 时无法确认，保守按成功处理（保持向后兼容）
          resolve(stdout)
        } else {
          reject(new Error(`命令异常关闭 (exit=${exitCode}): ${command}\n${stderr}`))
        }
      })
      stream.on('exit', (code: number) => {
        exitCode = code
        if (resolved) return
        resolved = true
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`命令退出码 ${code}: ${command}\n${stderr}`))
        }
      })
    })
  })
}

/** 打开 SFTP 通道 */
function openSftp(client: Ssh2Client, emit: (line: string) => void): Promise<Ssh2Sftp> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        emit(`[sftp] 打开失败: ${err.message}`)
        reject(err)
      } else {
        resolve(sftp)
      }
    })
  })
}

/** 关闭 SFTP 通道 */
function closeSftp(sftp: Ssh2Sftp, _emit: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    try {
      sftp.end()
    } catch {
      // ignore
    }
    resolve()
  })
}

/** 递归确保远程目录存在 */
function ensureRemoteDir(sftp: Ssh2Sftp, remoteDir: string): Promise<void> {
  return new Promise((resolve) => {
    // 先尝试 stat，存在则直接返回
    sftp.stat(remoteDir, (statErr, stats) => {
      if (!statErr && stats.isDirectory()) {
        resolve()
        return
      }
      // 不存在则递归创建（按 / 拆分逐层 mkdir）
      const parts = remoteDir.split('/').filter(Boolean)
      let current = remoteDir.startsWith('/') ? '/' : ''
      const next = (idx: number) => {
        if (idx >= parts.length) {
          resolve()
          return
        }
        current = current === '/' ? `/${parts[idx]}` : `${current}/${parts[idx]}`
        sftp.mkdir(current, () => {
          // 忽略已存在的错误，继续下一层
          next(idx + 1)
        })
      }
      next(0)
    })
  })
}

/** 上传单个文件（fastPut） */
function uploadFile(
  sftp: Ssh2Sftp,
  localPath: string,
  remotePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/** 上传项目核心文件 */
async function uploadProjectFiles(
  sftp: Ssh2Sftp,
  projectPath: string,
  remotePath: string,
  emit: (line: string) => void
): Promise<number> {
  let count = 0
  await ensureRemoteDir(sftp, remotePath)

  // 上传白名单目录：.qqbat/、data/、plugins/、src/（TS 运行时由 uploadRuntimeDir 单独传）
  const dirsToUpload = ['.qqbat', 'data', 'plugins', 'src']
  for (const dirName of dirsToUpload) {
    const localDir = join(projectPath, dirName)
    if (existsSync(localDir)) {
      const remoteDir = `${remotePath}/${dirName}`
      count += await uploadDir(sftp, localDir, remoteDir, emit)
    }
  }

  // 上传白名单文件
  const filesToUpload = ['.env']
  for (const fileName of filesToUpload) {
    const localFile = join(projectPath, fileName)
    if (existsSync(localFile)) {
      const remoteFile = `${remotePath}/${fileName}`
      await uploadFile(sftp, localFile, remoteFile)
      emit(`  [upload] ${fileName}`)
      count++
    }
  }

  return count
}

/**
 * 本地打包 TS 运行时并上传（node 模式）。
 *
 * 复用 deploy/runtimeBundle：out/main → 临时目录 runtime/（含 electron 占位包）+
 * package.json + 锁文件（远程 pnpm install --prod 需要）→ SFTP。
 * 临时目录一定清理：里面有 .env 之外也可能有 sourcemap，不留痕。
 */
async function uploadRuntimeDir(
  sftp: Ssh2Sftp,
  remotePath: string,
  emit: (line: string) => void
): Promise<{ lockfileName: string }> {
  const tmpRoot = join(tmpdir(), `qqbat-runtime-${Date.now()}`)
  try {
    // 依赖清单放包根：远程 `cd <remote> && pnpm install` 读的就是它
    const manifest = await copyRuntimeManifest(tmpRoot)
    for (const file of manifest.files) {
      await uploadFile(sftp, join(tmpRoot, file), `${remotePath}/${file}`)
      emit(`  [upload] ${file}`)
    }
    const bundle = await copyRuntimeBundle(join(tmpRoot, RUNTIME_DIR_NAME))
    emit(`  运行时源目录: ${bundle.sourceDir}（${bundle.fileCount} 个文件）`)
    await uploadDir(sftp, join(tmpRoot, RUNTIME_DIR_NAME), `${remotePath}/${RUNTIME_DIR_NAME}`, emit)
    return { lockfileName: manifest.lockfileName }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {
      /* ignore */
    })
  }
}

/** 递归上传目录 */
async function uploadDir(
  sftp: Ssh2Sftp,
  localDir: string,
  remoteDir: string,
  emit: (line: string) => void
): Promise<number> {
  let count = 0
  await ensureRemoteDir(sftp, remoteDir)

  const entries = await readdir(localDir, { withFileTypes: true })
  for (const entry of entries) {
    const localEntry = join(localDir, entry.name)
    const remoteEntry = `${remoteDir}/${entry.name}`

    if (entry.isDirectory()) {
      // 跳过缓存目录（node_modules 不能跳：runtime/ 里的 electron 占位包就在其中）
      if (entry.name === '.git') {
        continue
      }
      count += await uploadDir(sftp, localEntry, remoteEntry, emit)
    } else if (entry.isFile()) {
      await uploadFile(sftp, localEntry, remoteEntry)
      const rel = relative(localDir, localEntry).split('\\').join('/')
      emit(`  [upload] ${rel}`)
      count++
    }
  }
  return count
}

/**
 * 生成 Docker 部署文件并上传到远程
 *
 * 这里复用 DockerExporter 的内容生成逻辑，但绕过本地文件系统，
 * 直接把生成的字符串内容通过 SFTP 写到远程目录。
 */
async function uploadDockerFiles(
  sftp: Ssh2Sftp,
  projectPath: string,
  remotePath: string,
  options: DockerExportOptions,
  emit: (line: string) => void
): Promise<void> {
  // 复用 dockerExport 模块的导出能力：先导出到临时目录，再读取上传
  // 这里采用更简单的策略：直接调用 exportProjectToDocker 导出到一个本地临时目录，
  // 然后读取其中生成的 Docker 相关文件并上传。
  // 注意：项目源码已经通过 uploadProjectFiles 上传，这里只需上传 Docker 文件。

  const tmpRoot = join(tmpdir(), `qqbat-deploy-${Date.now()}`)
  // DockerExportOptions 用 port 字段表示容器端口
  const exportOpts: DockerExportOptions = {
    adapter: options.adapter,
    outputDir: tmpRoot,
    imageName: options.imageName,
    port: options.port
  }

  // 修复临时目录泄漏：旧实现 exportProjectToDocker 后无清理，
  // 每次部署在 os.tmpdir() 留下一份项目快照（含 .env 凭证），长期堆积
  try {
    await exportProjectToDocker(projectPath, exportOpts)

    const dockerFiles = [
      'Dockerfile',
      'docker-compose.yml',
      'start.sh',
      '.dockerignore',
      '.env.example',
      'README.md'
    ]

    for (const fileName of dockerFiles) {
      const localFile = join(tmpRoot, fileName)
      if (existsSync(localFile)) {
        const remoteFile = `${remotePath}/${fileName}`
        try {
          await uploadFile(sftp, localFile, remoteFile)
          emit(`  [upload] ${fileName}`)
        } catch (e: unknown) {
          emit(`  [upload] ${fileName} 失败: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    // 远程构建上下文需要 runtime/（Dockerfile 里 COPY . /app 后由 CMD 执行）
    if (existsSync(join(tmpRoot, RUNTIME_DIR_NAME))) {
      emit(`  [upload] ${RUNTIME_DIR_NAME}/`)
      await uploadDir(sftp, join(tmpRoot, RUNTIME_DIR_NAME), `${remotePath}/${RUNTIME_DIR_NAME}`, emit)
    }
  } finally {
    // 无论成功失败都清理临时目录，避免凭证残留与磁盘堆积
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => { /* ignore */ })
  }
}

// 兼容性导出：支持 `new SshDeployer()` 风格
export class SshDeployer {
  async deploy(
    projectPath: string,
    config: SshDeployConfig,
    onProgress?: SshDeployProgress
  ): Promise<SshDeployResult> {
    return deployProjectViaSsh(projectPath, config, onProgress)
  }
}

// 重新导出 DeployAdapter 方便调用方
export type { DeployAdapter } from './dockerExport'
