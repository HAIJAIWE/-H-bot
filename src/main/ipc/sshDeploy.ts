// src/main/ipc/sshDeploy.ts
// SSH 部署 IPC 处理器
//
// 注册通道：
//   - ssh:deploy         部署项目到远程服务器（全流程）
//   - ssh:testConnection 测试 SSH 连接（仅建立连接并立即断开）
//
// 进度推送：
//   - ssh:log             实时推送部署日志行（line: string）

import { ipcMain, BrowserWindow } from 'electron'
import { deployProjectViaSsh } from '../services/sshDeploy'
import { tryLoadSsh2 } from '../services/sshDeploy'
import { sshDeploySchema, sshTestConnectionSchema } from '../schemas/deploy'
import { tryIpcAsync } from './_shared'

const SSH_READY_TIMEOUT_MS = 15_000
const SSH_EXEC_TIMEOUT_MS = 18_000

export function registerSshDeployIpc(): void {
  ipcMain.handle('ssh:deploy', async (event, args: unknown) => {
    const parsed = sshDeploySchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const opts = parsed.data

    return tryIpcAsync(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const sendLog = (line: string) => {
        win?.webContents.send('ssh:log', { line })
      }

      const result = await deployProjectViaSsh(
        opts.projectPath,
        {
          host: opts.host,
          port: opts.port,
          username: opts.username,
          password: opts.password,
          privateKey: opts.privateKey,
          passphrase: opts.passphrase,
          remotePath: opts.remotePath,
          adapter: opts.adapter,
          imageName: opts.imageName,
          containerPort: opts.containerPort,
          mode: opts.mode
        },
        sendLog
      )

      if (!result.success) {
        // P0-C3 修复：失败时不携带 data 字段（违反 IpcErr 联合类型）。
        // 将 logs 合并到 error 消息中，确保用户仍能看到部署日志。
        const logsStr = result.logs?.length ? result.logs.join('\n') : ''
        const error = logsStr
          ? `${result.error}\n\n部署日志:\n${logsStr}`
          : result.error
        throw new Error(error)
      }
      return result
    })
  })

  ipcMain.handle('ssh:testConnection', async (_event, args: unknown) => {
    const parsed = sshTestConnectionSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const opts = parsed.data

    return tryIpcAsync(async () => {
      // 检测 ssh2 是否可用
      const ssh2 = tryLoadSsh2()
      if (!ssh2) {
        throw new Error('未安装 ssh2 库。请在项目根目录执行 `npm install ssh2` 后重试。')
      }

      // 尝试建立连接并立即断开
      const start = Date.now()
      await new Promise<void>((resolve, reject) => {
        const client = new ssh2.Client()
        const connectOpts: Record<string, unknown> = {
          host: opts.host,
          port: opts.port,
          username: opts.username,
          readyTimeout: SSH_READY_TIMEOUT_MS
        }
        if (opts.privateKey) {
          connectOpts.privateKey = opts.privateKey
          if (opts.passphrase) connectOpts.passphrase = opts.passphrase
        } else if (opts.password) {
          connectOpts.password = opts.password
        }

        const timer = setTimeout(() => {
          try { client.end() } catch { /* noop */ }
          reject(new Error(`连接超时（${SSH_EXEC_TIMEOUT_MS / 1000}s）`))
        }, SSH_EXEC_TIMEOUT_MS)

        client.on('ready', () => {
          clearTimeout(timer)
          try { client.end() } catch { /* noop */ }
          resolve()
        })
        client.on('error', (err: Error) => {
          clearTimeout(timer)
          reject(err)
        })
        try {
          client.connect(connectOpts)
        } catch (e: unknown) {
          clearTimeout(timer)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })

      const latency = Date.now() - start
      return { connected: true, latency }
    })
  })
}
