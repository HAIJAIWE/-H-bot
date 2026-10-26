// src/main/services/ai/threadExport.ts
//
// 第 57 批：**会话导出 Markdown** 的主进程侧（读记忆 → 渲染纯函数）。
//
// 落盘不在这里：`dialog.showSaveDialog` 属于 IPC 层（要拿到发起窗口 parent），
// 这里只负责"把该导出的东西按口径组装好"，方便单测不起 Electron。
import { basename } from 'node:path'
import { loadHistory } from './historyStore'
import { listThreads, threadFile } from './threads'
import { exportThreadFileName, renderThreadMarkdown } from '@shared/ai/threadExport'

export interface ThreadExportPayload {
  title: string
  threadId: string
  /** 默认文件名（界面与 IPC 都用它，别处不要再拼一遍） */
  fileName: string
  text: string
  /** 导出的条目数（回执里给人看） */
  entries: number
  /** 字节数（写完盘要核对"文件不是空的"） */
  bytes: number
}

/** 本地时间，秒级 —— 纯函数不碰时区，所以格式化放在这里做 */
function formatLocalTime(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * 把一条线程组装成可保存的 Markdown。
 *
 * `includeUi: true` 是为了拿到 `trace`（工具名与状态）与 `turnMs`（用时）——
 * 导出里只用到它们的**摘要**（名称/状态/秒数），参数与结果原文不进导出（见设计文档 §57.2）。
 *
 * @param now 导出时间（测试注入固定值；缺省=当前时间）
 */
export async function buildThreadMarkdown(
  projectPath: string,
  threadId: string,
  now: Date = new Date(),
): Promise<ThreadExportPayload> {
  const threads = await listThreads(projectPath)
  const info = threads.find(t => t.id === threadId)
  // 找不到就明确失败：导出一份"没有标题的对话"没有价值，反而会让人以为导出成功了
  if (!info) throw new Error('找不到这条会话（可能已经被清空或删除）')
  const entries = await loadHistory(projectPath, threadFile(projectPath, threadId), {
    includeUi: true,
  })
  const text = renderThreadMarkdown({
    title: info.title,
    threadId,
    projectName: basename(projectPath) || projectPath,
    exportedAtLabel: formatLocalTime(now),
    entries,
  })
  return {
    title: info.title,
    threadId,
    fileName: exportThreadFileName(info.title, threadId),
    text,
    entries: entries.length,
    bytes: Buffer.byteLength(text, 'utf-8'),
  }
}
