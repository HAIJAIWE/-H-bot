// src/main/services/agent-core/computerUse.ts
//
// **computer-use**（2026-10-18，复用应用已有的 CDP 基建）。
//
// 应用在开发期用 --remote-debugging-port 暴露 CDP（QQBAT_CDP_PORT=1 → 43191）。
// 这里把「列页面 / 求值 / 截图 / 点击」收成一个薄客户端，agent 就能：
//   打开自己的窗口 → 截图 → 点按钮 → 断言界面对不对。
//
// 为什么不做成 Worker 内部实现：CDP 是**调试协议**，只有主进程该拿它；
// 工具层通过这个客户端调用，别的地方不直接碰 WebSocket。

export interface CdpTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/** 列出可调试页面（只取 type=page） */
export async function listCdpTargets(baseUrl: string): Promise<CdpTarget[]> {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + '/json');
  if (!res.ok) throw new Error('CDP /json 返回 ' + String(res.status));
  const all = (await res.json()) as Array<CdpTarget & { type?: string }>;
  return all.filter((t) => t.type === undefined || t.type === 'page');
}

type WsLike = {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
};
type WsCtor = new (url: string) => WsLike;

export class CdpPage {
  private ws: WsLike;
  private nextId = 0;
  private pending = new Map<number, (v: unknown) => void>();

  constructor(
    url: string,
    opts: { WebSocketImpl?: WsCtor } = {},
  ) {
    const Impl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WsCtor);
    this.ws = new Impl(url);
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown };
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        this.pending.get(msg.id)?.(msg.result);
        this.pending.delete(msg.id);
      }
    };
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里求值（返回 JSON 可序列化的值） */
  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.send('Runtime.evaluate', { expression, returnByValue: true })) as {
      result?: { value?: unknown };
    };
    return result?.result?.value;
  }

  /** 截当前页面，返回 base64 PNG */
  async screenshot(): Promise<string> {
    const result = (await this.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
    return result?.data ?? '';
  }

  /** 点击页面坐标（设备无关像素） */
  async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // 已断开
    }
    this.pending.clear();
  }
}
