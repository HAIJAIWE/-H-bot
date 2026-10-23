// src/renderer/src/components/launch/PlayerStoreBar.tsx
//
// 「玩家存档在哪」的一行提示 —— 带**一键打开文件夹**与**复制路径**。
//
// ## 为什么需要它（用户实测反馈）
//
// 玩家存档从全局 `%APPDATA%` 搬到项目里之后（见 docs/game/player-data-location.md），
// 用户仍然**看不到它在哪**：备份时不知道该拷什么，出问题也不知道从哪看。
// 这一条把"存档位置"从文档搬进界面。
//
// 路径在渲染层推导即可（与 `DataBrowserPanel.buildFilePath` 同一规则：
// `{项目}/data/players/`），不需要新增 IPC —— 打开文件夹复用已有的
// `window.qqbat.project.openFolder`（主进程侧有 `assertOpenPathSafe` 兜底）。
import { useState } from 'react';
import { FolderOpen, Copy, Check } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { useToast } from '../ui/Toast';

/** 存档相对项目的目录（与主进程 persistentStore 的路径规则一致） */
export const PLAYER_STORE_REL_DIR = 'data/players';

/** 把项目路径统一成 `/` 分隔（界面展示与复制都更好读） */
export function playerStoreDir(projectPath: string): string {
  if (!projectPath) return '';
  return `${projectPath.replace(/\\/g, '/')}/${PLAYER_STORE_REL_DIR}`;
}

/** 存档库文件路径 */
export function playerStoreFile(projectPath: string): string {
  const dir = playerStoreDir(projectPath);
  return dir ? `${dir}/persistent.db` : '';
}

export function PlayerStoreBar({ projectPath }: { projectPath: string }) {
  useLocaleSubscription();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);
  const dir = playerStoreDir(projectPath);

  if (!dir) return null;

  const handleOpen = async () => {
    setOpening(true);
    try {
      const res = await window.qqbat.project.openFolder(dir.replace(/\//g, '\\'));
      // openFolder 用 shell.openPath：失败时返回 ok:false（例如目录还不存在）
      if (res && 'ok' in res && !res.ok) {
        toast.error(res.error || t('data.store.openFailed'));
        return;
      }
      toast.success(t('data.store.opened'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(dir);
      setCopied(true);
      toast.success(t('data.store.copied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('data.store.copyFailed'));
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/60">
      <span className="text-xs text-zinc-500 shrink-0">{t('data.store.label')}</span>
      <code
        className="text-xs text-zinc-300 truncate font-mono flex-1"
        title={playerStoreFile(projectPath)}
      >
        {dir}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        title={t('data.store.copyHint')}
        aria-label={t('data.store.copyHint')}
        className="shrink-0 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? t('data.store.copiedShort') : t('data.store.copy')}
      </button>
      <button
        type="button"
        onClick={handleOpen}
        disabled={opening}
        title={t('data.store.openHint')}
        aria-label={t('data.store.openHint')}
        className="shrink-0 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 disabled:opacity-50"
      >
        <FolderOpen className="w-3 h-3" />
        {t('data.store.open')}
      </button>
    </div>
  );
}
