// src/renderer/src/components/settings/PluginManager.tsx
import { useState, useEffect, useCallback } from 'react';
import type { PluginInfo } from '@shared/types/plugin-sdk';
import { useProjectStore } from '../../stores/projectStore';
import { setPluginNodes } from '../../lib/node/nodeCatalog';
import { Modal, ModalFooter } from '../ui/Modal';
import { PluginMarket } from './PluginMarket';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PluginManager({ open, onClose }: Props) {
  useLocaleSubscription();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');

  // 加载插件列表
  const loadPlugins = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError('');
    try {
      const [scanResult, loadedResult] = await Promise.all([
        window.qqbat.plugin.scan(projectPath),
        window.qqbat.plugin.listInstalled(),
      ]);

      const scannedMap = new Map<string, PluginInfo>();
      if (scanResult.ok && scanResult.data) {
        for (const p of scanResult.data) {
          scannedMap.set(p.name, p);
        }
      }

      if (loadedResult.ok && loadedResult.data) {
        for (const p of loadedResult.data) {
          scannedMap.set(p.name, p);
        }
      }

      setPlugins(Array.from(scannedMap.values()));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.listFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // 初始化加载
  useEffect(() => {
    if (open && projectPath) {
      loadPlugins();
    }
    if (open) {
      // 重启后按安装记录重放（幂等）；没记录就是空列表
      void restoreAiPlugins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restoreAiPlugins 每次渲染都是新引用，进依赖会死循环
  }, [open, projectPath, loadPlugins]);

  // 加载插件
  const handleLoad = async (pluginPath: string) => {
    setError('');
    setSuccessMsg('');
    try {
      const result = await window.qqbat.plugin.load(pluginPath);
      if (result.ok) {
        setSuccessMsg(t('settings.plugins.loadedMsg', { name: result.data?.name ?? '' }));
        // 刷新节点列表
        const specsResult = await window.qqbat.plugin.getAllSpecs();
        if (specsResult.ok && specsResult.data) {
          setPluginNodes(specsResult.data);
        }
        loadPlugins();
      } else {
        setError(result.error || t('settings.crash.loadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.crash.loadFailed'));
    }
  };

  /**
   * **装载 AI 插件**（2026-10-19）：选一个目录 → plugin:loadAi（沙箱 activate）。
   * 与节点插件的"安装/加载"分开命名：AI 插件不改项目目录，也不注册节点，
   * 它贡献的是**循环里的工具**与提示段落。
   */
  /** 宿主插件（应用级能力）只读清单：只展示随包 builtin 的（AI 插件另有运行时列表） */
  const [hostPlugins, setHostPlugins] = useState<
    Array<{
      id: string;
      name: string;
      version: string;
      enabled: boolean;
      source: 'builtin' | 'runtime';
      readOnlyReason?: string;
    }>
  >([]);
  const loadHostPlugins = useCallback(async (): Promise<void> => {
    const res = await window.qqbat.plugin.listHost();
    if (res.ok && res.data) setHostPlugins(res.data.filter((p) => p.source === 'builtin'));
  }, []);
  useEffect(() => {
    if (!open) return;
    void loadHostPlugins();
  }, [open, loadHostPlugins]);

  /** 宿主插件开关：停用 = 内核级卸载（它贡献的工具真的从注册表消失） */
  const toggleHostPlugin = async (id: string, enabled: boolean): Promise<void> => {
    setError('');
    const res = await window.qqbat.plugin.setHostEnabled(id, enabled);
    if (!res.ok) {
      setError(res.error ?? t('settings.plugins.loadFailed'));
      return;
    }
    await loadHostPlugins();
  };

  /** 本次运行装载的 AI 插件（运行时装载、不落盘；与节点包不同，它们不进项目目录） */
  const [aiPlugins, setAiPlugins] = useState<
    Array<{ id: string; name: string; enabled: boolean; dir: string }>
  >([]);
  /**
   * AI 安装记录（渲染层 localStorage）：记的是**目录**，不是插件内容。
   * 重启后按记录逐个重放 loadAi（handler 幂等）—— 这样"重启后列表还在"成立，
   * 而插件代码仍然只在装载时进沙箱，不存在"静默常驻"。
   */
  const AI_RECORD_KEY = 'qqbat.aiPlugins';
  const readAiRecords = (): string[] => {
    try {
      const raw = localStorage.getItem(AI_RECORD_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const writeAiRecords = (dirs: string[]): void => {
    try {
      localStorage.setItem(AI_RECORD_KEY, JSON.stringify([...new Set(dirs)]));
    } catch {
      // 记不住只影响"下次启动还列不列出"，不该让装载本身失败
    }
  };
  /** 按记录重放装载（幂等，不重复 activate） */
  const restoreAiPlugins = async (): Promise<void> => {
    const dirs = readAiRecords();
    const restored: Array<{ id: string; name: string; enabled: boolean; dir: string }> = [];
    for (const dir of dirs) {
      const res = await window.qqbat.plugin.loadAi(dir);
      if (res.ok && res.data) {
        restored.push({ id: res.data.pluginId, name: res.data.name, enabled: true, dir });
      }
    }
    setAiPlugins(restored);
  };
  const handleLoadAi = async () => {
    setError('');
    setSuccessMsg('');
    try {
      const dir = await window.qqbat.project.pickDirectory();
      if (!dir.ok || !dir.data) return;
      const pickedDir = dir.data;
      const result = await window.qqbat.plugin.loadAi(pickedDir);
      if (result.ok) {
        setSuccessMsg(t('settings.plugins.loadedAiMsg', { id: result.data?.pluginId ?? '' }));
        const loaded = result.data;
        if (loaded) {
          setAiPlugins((prev) =>
            prev.some((x) => x.id === loaded.pluginId)
              ? prev
              : [
                  ...prev,
                  { id: loaded.pluginId, name: loaded.name, enabled: true, dir: pickedDir },
                ],
          );
          writeAiRecords([...readAiRecords(), pickedDir]);
        }
      } else {
        setError(result.error || t('settings.plugins.loadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.loadFailed'));
    }
  };

  // 卸载插件
  const [pendingUnload, setPendingUnload] = useState<string | null>(null);
  const handleUnload = async (pluginName: string) => {
    setError('');
    setSuccessMsg('');
    try {
      const result = await window.qqbat.plugin.unload(pluginName);
      if (result.ok) {
        setSuccessMsg(t('settings.plugins.unloadedMsg', { name: pluginName }));
        const specsResult = await window.qqbat.plugin.getAllSpecs();
        if (specsResult.ok && specsResult.data) {
          setPluginNodes(specsResult.data);
        } else {
          setPluginNodes([]);
        }
        loadPlugins();
      } else {
        setError(result.error || t('settings.plugins.unloadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.unloadFailed'));
    } finally {
      setPendingUnload(null);
    }
  };

  // 启用/禁用插件
  const handleToggleEnabled = async (pluginName: string, enabled: boolean) => {
    setError('');
    try {
      const result = await window.qqbat.plugin.setEnabled(pluginName, enabled);
      if (result.ok) {
        const specsResult = await window.qqbat.plugin.getAllSpecs();
        if (specsResult.ok && specsResult.data) {
          setPluginNodes(specsResult.data);
        }
        loadPlugins();
      } else {
        setError(result.error || t('settings.plugins.opFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.opFailed'));
    }
  };

  // 安装插件
  const handleInstall = async () => {
    if (!projectPath) return;
    setError('');
    setSuccessMsg('');
    setScanning(true);
    try {
      const result = await window.qqbat.plugin.install(projectPath);
      if (result.ok) {
        setSuccessMsg(
          t('settings.plugins.installedMsg', {
            name: result.data?.name ?? '',
            version: result.data?.version ?? '',
          }),
        );
        loadPlugins();
      } else {
        // 主进程用 `new Error('用户取消')` 表示用户关掉了文件选择框，
        // 这里是拿它做**契约判断**而不是显示文案，所以必须保持原文、不能翻译。
        if (result.error !== '用户取消') {
          setError(result.error || t('settings.plugins.installFailed'));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.installFailed'));
    } finally {
      setScanning(false);
    }
  };

  // 扫描并加载所有已安装插件
  const handleScanAndLoad = async () => {
    if (!projectPath) return;
    setError('');
    setSuccessMsg('');
    setScanning(true);
    try {
      const scanResult = await window.qqbat.plugin.scan(projectPath);
      if (!scanResult.ok || !scanResult.data) {
        setError(t('settings.plugins.scanFailed'));
        return;
      }

      let loadedCount = 0;
      for (const plugin of scanResult.data) {
        if (plugin.loaded) {
          const result = await window.qqbat.plugin.load(plugin.path);
          if (result.ok) loadedCount++;
        }
      }

      const specsResult = await window.qqbat.plugin.getAllSpecs();
      if (specsResult.ok && specsResult.data) {
        setPluginNodes(specsResult.data);
      }

      setSuccessMsg(t('settings.plugins.scanDone', { count: loadedCount }));
      loadPlugins();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.scanLoadFailed'));
    } finally {
      setScanning(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('settings.plugins.title')} width="640px">
        <p className="text-xs text-zinc-500 mb-4">{t('settings.plugins.subtitle')}</p>

        {/* 操作栏 */}
        <div className="flex gap-2 mb-4">
          <Button
            variant="primary"
            size="md"
            disabled={!projectPath || scanning}
            onClick={handleInstall}
          >
            {scanning ? t('settings.plugins.busy') : t('settings.plugins.install')}
          </Button>
          <Button variant="secondary" size="md" onClick={handleLoadAi}>
            {t('settings.plugins.loadAi')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={!projectPath || scanning}
            onClick={handleScanAndLoad}
          >
            {scanning ? t('settings.plugins.scanning') : t('settings.plugins.scanAndLoad')}
          </Button>
        </div>

        {/* 状态消息 */}
        {error && (
          <div className="mb-3 px-3 py-2 rounded bg-red-900/20 border border-red-800/40 text-sm text-red-400">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-3 px-3 py-2 rounded bg-green-900/20 border border-green-800/40 text-sm text-green-400">
            {successMsg}
          </div>
        )}

        {/* 系统插件（只读）：随包内置能力，展示"有什么、为什么不能停" */}
        {hostPlugins.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-zinc-400 mb-2">{t('settings.plugins.hostTitle')}</p>
            <ul className="space-y-1">
              {hostPlugins.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded border border-zinc-700/60 px-2 py-1 text-xs"
                >
                  <span className="truncate text-zinc-200">{p.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{p.id}</span>
                  {p.readOnlyReason ? (
                    <span
                      className="text-[11px] text-amber-300"
                      title={t('settings.plugins.hostReadOnlyHint')}
                    >
                      {t('settings.plugins.hostReadOnly')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void toggleHostPlugin(p.id, !p.enabled)}
                      title={t('settings.plugins.hostToggleHint')}
                    >
                      {p.enabled
                        ? t('settings.plugins.hostDisable')
                        : t('settings.plugins.hostEnable')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI 插件（本次运行装载；运行时贡献工具，不落项目目录） */}
        {aiPlugins.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-zinc-400 mb-2">{t('settings.plugins.aiTitle')}</p>
            <ul className="space-y-1">
              {aiPlugins.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded border border-zinc-700/60 px-2 py-1 text-xs"
                >
                  <span className="truncate text-zinc-200">{p.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{p.id}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const next = !p.enabled;
                      const res = await window.qqbat.plugin.setEnabled(p.name, next);
                      if (res.ok) {
                        setAiPlugins((prev) =>
                          prev.map((x) => (x.id === p.id ? { ...x, enabled: next } : x)),
                        );
                      }
                    }}
                  >
                    {p.enabled ? t('settings.plugins.aiDisable') : t('settings.plugins.aiEnable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const res = await window.qqbat.plugin.unload(p.name);
                      if (res.ok) {
                        setAiPlugins((prev) => prev.filter((x) => x.id !== p.id));
                        writeAiRecords(readAiRecords().filter((dir) => dir !== p.dir));
                      }
                    }}
                  >
                    {t('settings.plugins.aiUnload')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 插件市场：装的是 AI 插件（工具进循环），与上面的节点包是两种东西 */}
        <PluginMarket open={open} />

        {/* 插件列表 */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="text-center py-8 text-zinc-500 text-sm">
              {t('editor.action.loading')}
            </div>
          ) : plugins.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-sm">
              {t('settings.plugins.empty')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="text-left py-2 px-2 font-medium">
                    {t('settings.plugins.colName')}
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    {t('settings.plugins.colVersion')}
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    {t('settings.plugins.colAuthor')}
                  </th>
                  <th className="text-left py-2 px-2 font-medium">
                    {t('settings.plugins.colNodes')}
                  </th>
                  <th className="text-center py-2 px-2 font-medium">
                    {t('settings.plugins.colStatus')}
                  </th>
                  <th className="text-right py-2 px-2 font-medium">
                    {t('settings.plugins.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plugins.map((plugin) => (
                  <tr
                    key={plugin.name}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="py-2 px-2 text-zinc-200">{plugin.name}</td>
                    <td className="py-2 px-2 text-zinc-400">{plugin.version}</td>
                    <td className="py-2 px-2 text-zinc-400">{plugin.author || '-'}</td>
                    <td className="py-2 px-2 text-zinc-400">{plugin.nodeCount}</td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          plugin.loaded
                            ? plugin.enabled
                              ? 'bg-green-500'
                              : 'bg-yellow-500'
                            : 'bg-zinc-600'
                        }`}
                        title={
                          plugin.loaded
                            ? plugin.enabled
                              ? t('settings.plugins.statusLoaded')
                              : t('settings.plugins.statusDisabled')
                            : t('settings.plugins.statusNotLoaded')
                        }
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="flex gap-1 justify-end">
                        {plugin.loaded ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              className={`px-2 py-0.5 ${
                                plugin.enabled
                                  ? 'bg-yellow-700 hover:bg-yellow-600 text-yellow-200'
                                  : 'bg-green-700 hover:bg-green-600 text-green-200'
                              }`}
                              onClick={() => handleToggleEnabled(plugin.name, !plugin.enabled)}
                            >
                              {plugin.enabled
                                ? t('settings.plugins.disable')
                                : t('settings.plugins.enable')}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setPendingUnload(plugin.name)}
                            >
                              {t('settings.plugins.uninstall')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleLoad(plugin.path)}
                          >
                            {t('settings.plugins.load')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-800 text-xs text-zinc-500">
          <p>{t('settings.plugins.hint')}</p>
        </div>
      </Modal>

      {/* 卸载确认弹窗 */}
      <Modal
        open={!!pendingUnload}
        onClose={() => setPendingUnload(null)}
        title={t('settings.plugins.confirmUnload')}
        width="384px"
        footer={
          <ModalFooter
            onCancel={() => setPendingUnload(null)}
            onConfirm={() => pendingUnload && handleUnload(pendingUnload)}
            cancelText={t('editor.action.cancel')}
            confirmText={t('settings.plugins.confirmUnload')}
            confirmVariant="danger"
          />
        }
      >
        <p className="text-xs text-zinc-400">
          {t('settings.plugins.unloadConfirm', { name: pendingUnload ?? '' })}
        </p>
      </Modal>
    </>
  );
}
