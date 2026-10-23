// src/main/services/batcher.ts
//
// 批处理累加器：把高频小事件（日志、终端输出）攒成一批再推给渲染层，
// 避免每个字符/每行都走一次 IPC（一次 IPC 的序列化 + 跨进程唤醒远贵于合并数组）。
//
// 语义与行为（10/18 打包产物 `runner/batcher` 一致）：
//   · 第一条 add() 时启动一个 windowMs 定时器；
//   · 窗口结束时把当时的缓冲整批交给 flushFn，并清空；
//   · flush() 可手动提前冲刷（例如进程退出、窗口失焦）；
//   · destroy() = 最后一次冲刷，之后不再定时。

export class BatchAccumulator<T> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly windowMs: number,
    private readonly flushFn: (items: T[]) => void,
  ) {}

  /** 收一条；窗口未开则开一个 */
  add(item: T): void {
    this.buffer.push(item);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }

  /** 立即冲刷（缓冲为空时只清定时器） */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const items = this.buffer;
      this.buffer = [];
      this.flushFn(items);
    }
  }

  /** 销毁前冲刷，防止最后一批还压在缓冲里 */
  destroy(): void {
    this.flush();
  }
}
