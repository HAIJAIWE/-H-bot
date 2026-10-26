// src/shared/ai/threadTitleTypes.ts
//
// 线程标题的**数据形状**。单独一个文件是为了避免循环 import：
// `threadTitle.ts`（纯函数）与主进程 `threadTitles.ts`（落盘）都要用这两个类型，
// 但纯函数模块不该依赖落盘模块。
export type ThreadTitleSource = 'fallback' | 'provider' | 'user'

export interface ThreadTitleRecord {
  title: string
  source: ThreadTitleSource
  /** ISO 时间戳：落盘时用来做"后写赢"的判据，也是排查问题的线索 */
  updatedAt: string
}
