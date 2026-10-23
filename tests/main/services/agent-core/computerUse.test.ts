// tests/main/services/agent-core/computerUse.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CdpPage, listCdpTargets } from '@main/services/agent-core/computerUse';

/** 假 WebSocket：把请求原样回成 result（不碰网络） */
class FakeWs {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(public url: string) {}
  send(data: string): void {
    const req = JSON.parse(data) as { id: number; method: string };
    const value =
      req.method === 'Page.captureScreenshot'
        ? { data: 'BASE64PNG' }
        : req.method === 'Runtime.evaluate'
          ? { result: { value: 42 } }
          : {};
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: req.id, result: value }) }), 0);
  }
  close(): void {
    this.closed = true;
  }
}

describe('★ computer-use（CDP 客户端）', () => {
  it('列页面只保留 page', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: '1', type: 'page', title: 'App', url: 'http://x', webSocketDebuggerUrl: 'ws://a' },
        { id: '2', type: 'worker', title: 'W', url: '', webSocketDebuggerUrl: 'ws://b' },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const targets = await listCdpTargets('http://127.0.0.1:43191/');
    vi.unstubAllGlobals();
    expect(targets.map((t) => t.id)).toEqual(['1']);
  });

  it('★ evaluate / screenshot / click 都走 CDP 消息', async () => {
    const page = new CdpPage('ws://fake', { WebSocketImpl: FakeWs as never });
    expect(await page.evaluate('1+1')).toBe(42);
    expect(await page.screenshot()).toBe('BASE64PNG');
    await page.click(10, 20);
    page.close();
  });
});
