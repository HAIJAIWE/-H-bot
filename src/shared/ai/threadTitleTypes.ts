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
  /**
   * 修订号：**每次真正落盘 +1**（第 60 批）。
   *
   * 用来判"在飞的刷新是不是已经过期"：刷新请求是旁路异步的，等模型回话的这几秒里
   * 用户可能已经手动重命名了。只比 `updatedAt` 不行（时钟回拨、同毫秒），
   * 单调递增的整数才是可靠的版本号。
   *
   * 旧文件没有这个字段 → 读的时候按 1 兜底（见 threadTitles.ts 的 parseRecord），
   * 不因为一次升级把用户已经攒下的标题全丢掉。
   */
  revision: number
  /**
   * 生成这条标题时**折叠进来的用户消息条数**（仅 provider 刷新会写）。
   *
   * 同一个条数再跑一遍只会得到同一个结果，所以这是"这条标题已经算过了"的省钱判据；
   * 用户重命名（user）不写 —— 手动改的标题与"看过几条消息"无关。
   */
  inputCount?: number
}
