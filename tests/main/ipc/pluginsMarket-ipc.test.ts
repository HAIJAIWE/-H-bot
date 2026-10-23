// tests/main/ipc/pluginsMarket-ipc.test.ts
//
// 插件市场 IPC 通道：入参校验 + 服务结果展开（{ok,value} → ApiResult）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
  market: {
    listMarketPlugins: vi.fn(),
    addMarketSource: vi.fn(),
    removeMarketSource: vi.fn(),
    installMarketPlugin: vi.fn(),
    uninstallMarketPlugin: vi.fn(),
  },
  scanner: { scanPlugins: vi.fn(), loadPluginPackage: vi.fn() },
  loader: {
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
    setPluginEnabled: vi.fn(),
    getPluginInfos: vi.fn(),
    getAllPluginSpecs: vi.fn(),
  },
  dataService: { saveSchema: vi.fn() },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandle },
  BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));
vi.mock('@main/services/plugins/pluginScanner', () => mocks.scanner);
vi.mock('@main/services/plugins/pluginLoader', () => mocks.loader);
vi.mock('@main/services/project/dataService', () => mocks.dataService);
vi.mock('@main/services/plugins/market', () => mocks.market);
vi.mock('fs', () => {
  const m = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    constants: { F_OK: 0 },
  };
  return { ...m, default: m };
});
vi.mock('fs/promises', () => {
  const m = {
    access: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
  };
  return { ...m, default: m };
});

import { registerPluginIpc } from '@main/ipc/plugins';

interface IpcResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

const mockEvent = { sender: {} };

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.ipcMainHandle.mock.calls.find((c: unknown[]) => c[0] === channel);
  if (!call) throw new Error('handler not registered: ' + channel);
  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

beforeEach(() => {
  mocks.ipcMainHandle.mockReset();
  for (const fn of Object.values(mocks.market)) fn.mockReset();
  registerPluginIpc();
});

describe('plugin:market* IPC', () => {
  it('marketList 透传服务结果', async () => {
    const data = { plugins: [], sources: [{ source: 'bundled://official' }] };
    mocks.market.listMarketPlugins.mockResolvedValue(data);
    const res = (await getHandler('plugin:marketList')(mockEvent)) as IpcResult;
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(data);
  });

  it('marketList 抛错 → ok:false', async () => {
    mocks.market.listMarketPlugins.mockRejectedValue(new Error('boom'));
    const res = (await getHandler('plugin:marketList')(mockEvent)) as IpcResult;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
  });

  it('marketAddSource 校验空来源，不调服务', async () => {
    const res = (await getHandler('plugin:marketAddSource')(mockEvent, {
      source: '',
    })) as IpcResult;
    expect(res.ok).toBe(false);
    expect(mocks.market.addMarketSource).not.toHaveBeenCalled();
  });

  it('marketAddSource 服务拒绝 → 把 error 抛回渲染层', async () => {
    mocks.market.addMarketSource.mockResolvedValue({ ok: false, error: '来源必须是 http(s) 地址或本地路径' });
    const res = (await getHandler('plugin:marketAddSource')(mockEvent, {
      source: 'ftp://x',
    })) as IpcResult;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('来源必须是 http(s) 地址或本地路径');
  });

  it('marketRemoveSource 成功返回新来源表', async () => {
    mocks.market.removeMarketSource.mockResolvedValue({ ok: true, value: ['bundled://official'] });
    const res = (await getHandler('plugin:marketRemoveSource')(mockEvent, {
      source: 'https://example.com/market.json',
    })) as IpcResult;
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(['bundled://official']);
  });

  it('marketInstall 成功返回安装信息；校验空 id', async () => {
    mocks.market.installMarketPlugin.mockResolvedValue({
      ok: true,
      value: { id: 'clock', pluginId: 'ai.market-clock', name: 'market-clock', version: '1.0.0' },
    });
    const res = (await getHandler('plugin:marketInstall')(mockEvent, {
      id: 'clock',
    })) as IpcResult;
    expect(res.ok).toBe(true);
    expect((res.data as { pluginId: string }).pluginId).toBe('ai.market-clock');

    const bad = (await getHandler('plugin:marketInstall')(mockEvent, { id: '' })) as IpcResult;
    expect(bad.ok).toBe(false);
  });

  it('marketUninstall 成功返回被卸载的 id', async () => {
    mocks.market.uninstallMarketPlugin.mockResolvedValue({ ok: true, value: { id: 'clock' } });
    const res = (await getHandler('plugin:marketUninstall')(mockEvent, {
      id: 'clock',
    })) as IpcResult;
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ id: 'clock' });
  });
});
