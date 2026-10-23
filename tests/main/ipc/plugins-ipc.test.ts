// tests/main/ipc/plugins-ipc.test.ts
// 覆盖 plugins IPC handler
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===========================================================================
// vi.hoisted —— 保证 mock 引用在 vi.mock 工厂中可用
// ===========================================================================
const mocks = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn();
  const browserWindowFromWebContents = vi.fn();
  const dialogShowOpenDialog = vi.fn();
  const shellOpenPath = vi.fn();

  // ---- pluginScanner ----
  const pluginScanner = {
    scanPlugins: vi.fn(),
    loadPluginPackage: vi.fn(),
  };

  // ---- pluginLoader ----
  const pluginLoader = {
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
    setPluginEnabled: vi.fn(),
    getPluginInfos: vi.fn(),
    getAllPluginSpecs: vi.fn(),
  };

  // ---- dataService（plugin:saveSchema 用）----
  const dataService = {
    saveSchema: vi.fn(),
  };

  // ---- fs (plugins.ts 用) ----
  const fsExistsSync = vi.fn();
  const fsMkdirSync = vi.fn();
  const fsCopyFileSync = vi.fn();
  const fsReaddirSync = vi.fn();
  const fsReadFileSync = vi.fn();

  // ---- fs/promises (plugins.ts 用，异步 API) ----
  const fsPromisesAccess = vi.fn();
  const fsPromisesMkdir = vi.fn();
  const fsPromisesCopyFile = vi.fn();
  const fsPromisesReaddir = vi.fn();
  const fsPromisesReadFile = vi.fn();

  return {
    ipcMainHandleMock,
    browserWindowFromWebContents,
    dialogShowOpenDialog,
    shellOpenPath,
    pluginScanner,
    pluginLoader,
    dataService,
    fsExistsSync,
    fsMkdirSync,
    fsCopyFileSync,
    fsReaddirSync,
    fsReadFileSync,
    fsPromisesAccess,
    fsPromisesMkdir,
    fsPromisesCopyFile,
    fsPromisesReaddir,
    fsPromisesReadFile,
  };
});

// ===========================================================================
// vi.mock —— 模块级 mock，对所有 import 生效
// ===========================================================================
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.ipcMainHandleMock },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: mocks.browserWindowFromWebContents,
  },
  dialog: { showOpenDialog: mocks.dialogShowOpenDialog },
  shell: { openPath: mocks.shellOpenPath },
}));

vi.mock('@main/services/plugins/pluginScanner', () => mocks.pluginScanner);
vi.mock('@main/services/plugins/pluginLoader', () => mocks.pluginLoader);
vi.mock('@main/services/project/dataService', () => mocks.dataService);
vi.mock('fs', () => {
  const m = {
    existsSync: mocks.fsExistsSync,
    mkdirSync: mocks.fsMkdirSync,
    copyFileSync: mocks.fsCopyFileSync,
    readdirSync: mocks.fsReaddirSync,
    readFileSync: mocks.fsReadFileSync,
    constants: { F_OK: 0 },
  };
  return { ...m, default: m };
});
vi.mock('fs/promises', () => {
  const m = {
    access: mocks.fsPromisesAccess,
    mkdir: mocks.fsPromisesMkdir,
    copyFile: mocks.fsPromisesCopyFile,
    readdir: mocks.fsPromisesReaddir,
    readFile: mocks.fsPromisesReadFile,
  };
  return { ...m, default: m };
});

// ===========================================================================
// 导入被测 IPC 注册函数
// ===========================================================================
import { registerPluginIpc } from '@main/ipc/plugins';
import { registerBuiltinHostPlugins } from '@main/services/plugins/builtinHostPlugins';
import { listTools } from '@main/services/agent-core/core';

// ===========================================================================
// 辅助
// ===========================================================================
interface IpcResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
}

/** 从 ipcMain.handle 的调用记录里提取指定 channel 的 handler */
function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mocks.ipcMainHandleMock.mock.calls.find((c: unknown[]) => c[0] === channel);
  if (!call) throw new Error(`handler ${channel} 未注册`);
  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

/** mock event，含 sender 供 BrowserWindow.fromWebContents 使用 */
const mockEvent = { sender: {} };
/** mock 窗口 */
const mockWin = {
  isDestroyed: vi.fn(() => false),
  webContents: { send: vi.fn() },
};

/** 所有 vi.fn mock 列表，用于 beforeEach 统一 reset */
const allMockFns: Array<{ mockReset: () => void }> = [
  mocks.ipcMainHandleMock,
  mocks.browserWindowFromWebContents,
  mocks.dialogShowOpenDialog,
  mocks.shellOpenPath,
  ...Object.values(mocks.pluginScanner),
  ...Object.values(mocks.pluginLoader),
  mocks.dataService.saveSchema,
  mocks.fsExistsSync,
  mocks.fsMkdirSync,
  mocks.fsCopyFileSync,
  mocks.fsReaddirSync,
  mocks.fsReadFileSync,
  mocks.fsPromisesAccess,
  mocks.fsPromisesMkdir,
  mocks.fsPromisesCopyFile,
  mocks.fsPromisesReaddir,
  mocks.fsPromisesReadFile,
];

beforeEach(() => {
  // 重置所有 mock
  for (const fn of allMockFns) fn.mockReset();

  // 默认实现
  mocks.browserWindowFromWebContents.mockReturnValue(mockWin);

  // 注册 IPC handler
  registerPluginIpc();
});

// ===========================================================================
// plugins IPC
// ===========================================================================
describe('plugins IPC', () => {
  describe('plugin:scan', () => {
    it('正常路径返回插件列表和 errors', async () => {
      const plugins = [{ name: 'p1', version: '1.0.0' }];
      const errors: unknown[] = [];
      // ScanResult 继承 Array，含 errors 属性
      const scanResult = Object.assign([...plugins], { errors, plugins });
      mocks.pluginScanner.scanPlugins.mockResolvedValue(scanResult);
      const res = (await getHandler('plugin:scan')(mockEvent, {
        projectPath: '/proj',
      })) as IpcResult;
      expect(res.ok).toBe(true);
      expect(res.data).toEqual(plugins);
      expect(mocks.pluginScanner.scanPlugins).toHaveBeenCalledWith('/proj');
    });

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginScanner.scanPlugins.mockRejectedValue(new Error('scan-fail'));
      const res = (await getHandler('plugin:scan')(mockEvent, {
        projectPath: '/proj',
      })) as IpcResult;
      expect(res.ok).toBe(false);
      expect(res.error).toBe('scan-fail');
    });
  });

  describe('plugin:load', () => {
    it('正常路径返回 ok:true', async () => {
      const pkg = { name: 'p1', version: '1.0.0' };
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({ package: pkg, errors: [] });
      mocks.pluginLoader.registerPlugin.mockReturnValue(true);
      const res = (await getHandler('plugin:load')(mockEvent, {
        pluginPath: '/proj/plugins/p1',
      })) as IpcResult;
      expect(res.ok).toBe(true);
      expect(res.data).toEqual(pkg);
    });

    it('package 为 null 返回 ok:false', async () => {
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({
        package: null,
        errors: [{ type: 'manifest', message: 'bad manifest' }],
      });
      const res = (await getHandler('plugin:load')(mockEvent, {
        pluginPath: '/proj/plugins/p1',
      })) as IpcResult;
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/bad manifest/);
    });

    it('registerPlugin 返回 false 返回 ok:false', async () => {
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({
        package: { name: 'p1', version: '1.0.0' },
        errors: [],
      });
      mocks.pluginLoader.registerPlugin.mockReturnValue(false);
      const res = (await getHandler('plugin:load')(mockEvent, {
        pluginPath: '/proj/plugins/p1',
      })) as IpcResult;
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/已加载/);
    });

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginScanner.loadPluginPackage.mockRejectedValue(new Error('load-fail'));
      const res = (await getHandler('plugin:load')(mockEvent, {
        pluginPath: '/proj/plugins/p1',
      })) as IpcResult;
      expect(res.ok).toBe(false);
      expect(res.error).toBe('load-fail');
    });
  });

  describe('plugin:unload', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.pluginLoader.unregisterPlugin.mockReturnValue(true);
      const res = (await getHandler('plugin:unload')(mockEvent, { pluginName: 'p1' })) as IpcResult;
      expect(res.ok).toBe(true);
      expect((res.data as { name: string }).name).toBe('p1');
    });

    it('unregisterPlugin 返回 false 返回 ok:false', async () => {
      mocks.pluginLoader.unregisterPlugin.mockReturnValue(false);
      const res = (await getHandler('plugin:unload')(mockEvent, { pluginName: 'p1' })) as IpcResult;
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/未加载/);
    });
  });

  describe('plugin:install', () => {
    it('所选目录无 manifest.json 返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      mocks.fsPromisesAccess.mockRejectedValue(new Error('ENOENT')) // manifest 不存在
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/manifest\.json/)
    })

    it('manifest 缺少 name/version 返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      // manifest 存在（access 成功）
      mocks.fsPromisesAccess.mockResolvedValue(undefined)
      mocks.fsPromisesReadFile.mockResolvedValue(JSON.stringify({ description: 'no name' }))
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/name.*version/)
    })

    it('目标目录已存在返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      // manifest 存在、有效；plugins 目录存在；target 目录已存在（access 全部成功）
      mocks.fsPromisesAccess.mockResolvedValue(undefined)
      mocks.fsPromisesReadFile.mockResolvedValue(JSON.stringify({ name: 'p1', version: '1.0.0' }))
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/已存在/)
    })

    it('正常路径返回 ok:true', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/source/p1'] })
      // access(manifestPath) 成功、access(pluginsDir) 成功、access(targetDir) 失败（不存在）
      mocks.fsPromisesAccess.mockImplementation((p: unknown) => {
        const path = String(p)
        if (path.endsWith('p1')) return Promise.reject(new Error('ENOENT')) // targetDir 不存在
        return Promise.resolve()
      })
      mocks.fsPromisesReadFile.mockResolvedValue(JSON.stringify({ name: 'p1', version: '1.0.0' }))
      mocks.fsPromisesReaddir.mockResolvedValue([])
      mocks.fsPromisesMkdir.mockResolvedValue(undefined)
      const pkg = { name: 'p1', version: '1.0.0' }
      mocks.pluginScanner.loadPluginPackage.mockResolvedValue({ package: pkg, errors: [] })
      mocks.pluginLoader.registerPlugin.mockReturnValue(true)
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { name: string }).name).toBe('p1')
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.dialogShowOpenDialog.mockRejectedValue(new Error('dialog-fail'))
      const res = (await getHandler('plugin:install')(mockEvent, { projectPath: '/proj' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('dialog-fail')
    })
  })

  describe('plugin:listInstalled', () => {
    it('正常路径返回已加载插件列表', async () => {
      const plugins = [{ name: 'p1', version: '1.0.0', enabled: true }]
      mocks.pluginLoader.getPluginInfos.mockReturnValue(plugins)
      const res = (await getHandler('plugin:listInstalled')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(plugins)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.getPluginInfos.mockImplementation(() => { throw new Error('list-fail') })
      const res = (await getHandler('plugin:listInstalled')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('list-fail')
    })
  })

  describe('plugin:setEnabled', () => {
    it('正常路径返回 ok:true', async () => {
      mocks.pluginLoader.setPluginEnabled.mockReturnValue(true)
      const res = (await getHandler('plugin:setEnabled')(mockEvent, { pluginName: 'p1', enabled: false })) as IpcResult
      expect(res.ok).toBe(true)
      expect((res.data as { enabled: boolean }).enabled).toBe(false)
    })

    it('setPluginEnabled 返回 false 返回 ok:false', async () => {
      mocks.pluginLoader.setPluginEnabled.mockReturnValue(false)
      const res = (await getHandler('plugin:setEnabled')(mockEvent, { pluginName: 'p1', enabled: true })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/未加载/)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.setPluginEnabled.mockImplementation(() => { throw new Error('enable-fail') })
      const res = (await getHandler('plugin:setEnabled')(mockEvent, { pluginName: 'p1', enabled: true })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('enable-fail')
    })
  })

  describe('plugin:getAllSpecs', () => {
    it('正常路径返回 NodeSpec 列表', async () => {
      const specs = [{ kind: 'p1_node1', type: 'custom', label: 'N1', summary: '', sideEffects: [] }]
      mocks.pluginLoader.getAllPluginSpecs.mockReturnValue(specs)
      const res = (await getHandler('plugin:getAllSpecs')()) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toEqual(specs)
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.pluginLoader.getAllPluginSpecs.mockImplementation(() => { throw new Error('specs-fail') })
      const res = (await getHandler('plugin:getAllSpecs')()) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('specs-fail')
    })
  })

  describe('plugin:saveSchema', () => {
    it('正常路径', async () => {
      mocks.dataService.saveSchema.mockReturnValue(true)
      const res = (await getHandler('plugin:saveSchema')({}, '/proj', 'players', { name: 'text' })) as IpcResult
      expect(res.ok).toBe(true)
      expect(res.data).toBe(true)
      expect(mocks.dataService.saveSchema).toHaveBeenCalledWith('/proj', 'players', { name: 'text' })
    })

    it('service 抛异常返回 ok:false', async () => {
      mocks.dataService.saveSchema.mockImplementation(() => {
        throw new Error('save-schema-fail')
      })
      const res = (await getHandler('plugin:saveSchema')({}, '/proj', 'players', { name: 'text' })) as IpcResult
      expect(res.ok).toBe(false)
      expect(res.error).toBe('save-schema-fail')
    })
  })

  // ---------------------------------------------------------------------------
  // 宿主插件启停：走的是真内核（registerBuiltinHostPlugins 贡献的工具会真的消失）
  // ---------------------------------------------------------------------------
  describe('plugin:setHostEnabled', () => {
    it('未登记的 id ⇒ ok:false 且错误里带 not found（别静默当成功）', async () => {
      const res = (await getHandler('plugin:setHostEnabled')(mockEvent, {
        id: 'builtin.tools.nope',
        enabled: false,
      })) as IpcResult;
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/);
  });

  it('★ 可停用的域插件：停用后 run_command 消失，启用后回来（真内核路径）', async () => {
    registerBuiltinHostPlugins();
    expect(listTools().map((t) => t.name)).toContain('run_command');
    const off = (await getHandler('plugin:setHostEnabled')(mockEvent, {
      id: 'builtin.tools.runtime',
      enabled: false,
    })) as IpcResult;
    expect(off.ok).toBe(true);
    expect(listTools().map((t) => t.name)).not.toContain('run_command');
    const on = (await getHandler('plugin:setHostEnabled')(mockEvent, {
      id: 'builtin.tools.runtime',
      enabled: true,
    })) as IpcResult;
    expect(on.ok).toBe(true);
    expect(listTools().map((t) => t.name)).toContain('run_command');
  });
  });
});
