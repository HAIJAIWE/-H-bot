// src/main/ipc/launchTransfer.ts
// 数据导入导出 IPC 处理器
//
// 注册通道：
//   - data:exportJson      导出表到 JSON
//   - data:exportCsv       导出表到 CSV
//   - data:importJson      从 JSON 导入表
//   - data:importCsv       从 CSV 导入表
//
// 安全修复：原实现将 dbPath / outputPath / jsonPath / csvPath 完全裸传给
// dataTransferService，未做任何路径校验，存在路径越界漏洞（恶意/异常
// 参数可读写任意路径文件）。对比 launchData.ts 的 assertDataFileSafe，
// 本文件此前缺失同等防护。
//
// 现修复方案（路径校验统一收口在 pathGuard.ts）：
//   - dbPath：用 assertPathWithinBase 严格校验必须在 process.cwd() 内
//     且后缀为 .db/.sqlite（防越界读取任意 sqlite 文件）
//   - outputPath / jsonPath / csvPath：用 assertExternalPathSafe 宽松校验
//     （允许用户导出/导入到任意合法用户目录，但拒绝系统关键目录 + 白名单后缀）

import { ipcMain } from 'electron'
import { exportTableToJson, exportTableToCsv, importFromJson, importFromCsv } from '../services/dataTransferService'
import { assertPathWithinBase, assertExternalPathSafe } from '../services/pathGuard'
import { tryIpc } from './_shared'
import {
  dataExportJsonSchema,
  dataExportCsvSchema,
  dataImportJsonSchema,
  dataImportCsvSchema
} from '../schemas/launchTransfer'

/** 允许的数据库文件后缀（防止越界读取任意文件） */
const DATA_FILE_EXTS = ['.db', '.sqlite']

export function registerLaunchTransferIpc(): void {
  ipcMain.handle('data:exportJson', async (_e, dbPath: string, tableName: string, outputPath: string) => {
    const parsed = dataExportJsonSchema.safeParse([dbPath, tableName, outputPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS)
      assertExternalPathSafe(parsed.data[2], ['.json'])
      exportTableToJson(parsed.data[0], parsed.data[1], parsed.data[2])
    })
  })
  ipcMain.handle('data:exportCsv', async (_e, dbPath: string, tableName: string, outputPath: string) => {
    const parsed = dataExportCsvSchema.safeParse([dbPath, tableName, outputPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS)
      assertExternalPathSafe(parsed.data[2], ['.csv'])
      exportTableToCsv(parsed.data[0], parsed.data[1], parsed.data[2])
    })
  })
  ipcMain.handle('data:importJson', async (_e, dbPath: string, tableName: string, jsonPath: string) => {
    const parsed = dataImportJsonSchema.safeParse([dbPath, tableName, jsonPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS)
      assertExternalPathSafe(parsed.data[2], ['.json'])
      return importFromJson(parsed.data[0], parsed.data[1], parsed.data[2])
    })
  })
  ipcMain.handle('data:importCsv', async (_e, dbPath: string, tableName: string, csvPath: string) => {
    const parsed = dataImportCsvSchema.safeParse([dbPath, tableName, csvPath])
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS)
      assertExternalPathSafe(parsed.data[2], ['.csv'])
      return importFromCsv(parsed.data[0], parsed.data[1], parsed.data[2])
    })
  })
}
