// src/main/services/crashLogger.ts
import { app, Notification } from 'electron'
import { saveReport, makeId, collectOsString } from './crashReporter'
import type { CrashReport } from './crashReporter'

// ====== 崩溃日志收集器 ======
// 监听 Node.js 进程级未捕获异常和未处理 Promise 拒绝

export function initCrashLogger(): void {
  // 启动时检查上次崩溃，显示系统通知
  checkPreviousCrash()

  process.on('uncaughtException', (error: Error) => {
    const report: CrashReport = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      type: 'uncaughtException',
      message: error.message,
      stack: error.stack ?? '',
      version: app.getVersion(),
      os: collectOsString(),
      extra: {
        node: process.version,
        electron: process.versions.electron ?? 'unknown',
        pid: process.pid
      }
    }
    saveReport(report).catch(() => {})

    // 等待写入完成后退出
    setTimeout(() => {
      process.exit(1)
    }, 1000)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? (reason.stack ?? '') : ''
    const report: CrashReport = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      type: 'unhandledRejection',
      message,
      stack,
      version: app.getVersion(),
      os: collectOsString(),
      extra: {
        node: process.version,
        electron: process.versions.electron ?? 'unknown',
        pid: process.pid
      }
    }
    saveReport(report).catch(() => {})
  })
}

async function checkPreviousCrash(): Promise<void> {
  try {
    // 从 crashReporter 导入获取报告列表
    const { getRecentReports } = await import('./crashReporter.js')
    const reports = await getRecentReports(1)
    if (reports.length > 0) {
      showCrashNotification(reports[0].timestamp)
    }
  } catch {
    // 崩溃日志写入失败不应二次抛出
  }
}

function showCrashNotification(lastCrashTime: string): void {
  try {
    const notification = new Notification({
      title: 'QQ bat',
      body: `QQ bat 上次异常退出（${formatTime(lastCrashTime)}），点击查看详情`,
      silent: false
    })
    notification.on('click', () => {
      // 通知点击后通知渲染进程打开崩溃报告面板
      const { BrowserWindow } = require('electron')
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.webContents.send('crash:showPanel')
      }
    })
    notification.show()
  } catch {
    // 通知不可用时静默忽略
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    // Date 解析失败时返回原始 ISO 字符串
    return iso
  }
}
