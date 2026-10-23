import { useEffect, useState, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useGitStore, type GitDiffResult, type VersionTagInfo } from '../../stores/gitStore';
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  FileText,
  RotateCcw,
  Trash2,
  Pencil,
  Tag,
} from 'lucide-react';
import { formatFullDateTime as formatTimestamp } from '../../lib/infra/format';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface GitHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}

function shortHash(hash: string): string {
  return hash ? hash.slice(0, 7) : '';
}

/** diff patch 按行着色渲染 */
function DiffPatch({ patch }: { patch: string }) {
  const lines = patch.split('\n');
  return (
    <pre className="text-xs font-mono overflow-x-auto bg-zinc-950 rounded p-2 max-h-80 overflow-y-auto border border-zinc-800">
      {lines.map((line, idx) => {
        let cls = 'text-zinc-400';
        if (line.startsWith('+++') || line.startsWith('+++ ')) cls = 'text-green-400 font-bold';
        else if (line.startsWith('---') || line.startsWith('--- ')) cls = 'text-red-400 font-bold';
        else if (line.startsWith('@@')) cls = 'text-cyan-400';
        else if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-300';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-300';
        else if (line.startsWith('commit ')) cls = 'text-yellow-400 font-bold';
        else if (line.startsWith('Author:') || line.startsWith('Date:')) cls = 'text-zinc-300';
        else if (line.startsWith('diff --git')) cls = 'text-blue-400 font-bold';
        else if (line.startsWith('index ')) cls = 'text-zinc-600';
        return (
          <div key={idx} className={`whitespace-pre ${cls}`}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** 单条提交行（可展开 diff） */
function CommitRow({
  entry,
  isLast,
  projectPath,
  selected,
  onToggleSelect,
  versions,
}: {
  entry: { hash: string; message: string; timestamp: string };
  isLast: boolean;
  projectPath: string;
  selected: boolean;
  onToggleSelect: (hash: string) => void;
  /** 这个提交上的版本标签（一个提交可以有多个版本名） */
  versions: VersionTagInfo[];
}) {
  useLocaleSubscription();
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchDiff = useGitStore((s) => s.fetchDiff);
  // 读取失败的原因（undefined = 没失败过）。有它才能把「读不出来」和「这次提交没有 diff」分开。
  const diffError = useGitStore((s) => s.diffErrors[entry.hash]);
  const restoreFlow = useGitStore((s) => s.restoreFlow);
  const restoring = useGitStore((s) => s.restoreLoading === entry.hash);
  // 只在**真正失败的那一行**显示原因（store 里只有一个 error 槽，不分行的话每行都会挂一遍）
  const restoreErrorHash = useGitStore((s) => s.restoreErrorHash);
  const restoreError = useGitStore((s) => s.restoreError);

  // 点击两次才真恢复：读档会覆盖当前 flow.json，值得一次确认。
  // 用两段式而不是弹确认框 —— 这个组件本身就在 Modal 里，再叠一层体验很糟。
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  const handleRestore = useCallback(async () => {
    if (!confirmingRestore) {
      setConfirmingRestore(true);
      return;
    }
    setConfirmingRestore(false);
    const ok = await restoreFlow(projectPath, entry.hash);
    if (ok) setExpanded(false);
  }, [confirmingRestore, restoreFlow, projectPath, entry.hash]);

  const deleteCommits = useGitStore((s) => s.deleteCommits);
  const rewordCommit = useGitStore((s) => s.rewordCommit);
  const rewriteLoading = useGitStore((s) => s.rewriteLoading);
  // 删除与清空历史同样走两段式确认：改写提交历史不可逆（虽有备份 ref，但用户不一定懂怎么回滚）
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rewording, setRewording] = useState(false);
  const [draft, setDraft] = useState('');
  const renameVersion = useGitStore((s) => s.renameVersion);
  const deleteVersion = useGitStore((s) => s.deleteVersion);
  const versionLoading = useGitStore((s) => s.versionLoading);
  const [renamingVersion, setRenamingVersion] = useState<string | null>(null);
  const [versionDraft, setVersionDraft] = useState('');
  const [confirmingDeleteVersion, setConfirmingDeleteVersion] = useState<string | null>(null);
  /** 正在确认"回到这个版本"的版本名（两段式，与「恢复到此版本」一致） */
  const [confirmingRestoreVersion, setConfirmingRestoreVersion] = useState<string | null>(null);
  const restoreFlowForVersion = useGitStore((s) => s.restoreFlow);

  const handleDelete = useCallback(async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    const ok = await deleteCommits(projectPath, [entry.hash]);
    if (ok) setExpanded(false);
  }, [confirmingDelete, deleteCommits, projectPath, entry.hash]);

  const handleReword = useCallback(async () => {
    const ok = await rewordCommit(projectPath, entry.hash, draft);
    if (ok) {
      setRewording(false);
      setDraft('');
    }
  }, [rewordCommit, projectPath, entry.hash, draft]);

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!diff) {
      setLoading(true);
      try {
        const result = await fetchDiff(projectPath, entry.hash);
        setDiff(result);
      } catch {
        // fetchDiff reject 时 setLoading(false) 不会执行，loading 永久卡住
        // GitDiffResult 无 error 字段，失败时置 null 让 UI 显示空状态
        setDiff(null);
      } finally {
        setLoading(false);
      }
    }
  }, [expanded, diff, fetchDiff, projectPath, entry.hash]);

  return (
    <div className={isLast ? '' : 'border-b border-zinc-800'}>
      {/* 选择框是展开按钮的**兄弟节点**，不是子节点：
          把 checkbox 嵌进 button 是非法 HTML（与下面那句"不要把 button 嵌套进 button"同一个约束）。 */}
      <div className="flex items-start gap-1 pl-2 pr-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(entry.hash)}
          aria-label={t('settings.git.selectCommitAria', { hash: shortHash(entry.hash) })}
          className="mt-2.5 h-3.5 w-3.5 shrink-0 accent-blue-500 cursor-pointer"
        />
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 flex items-start gap-2 px-2 py-2 hover:bg-zinc-800/50 text-left justify-start"
          onClick={handleToggle}
          aria-label={t('settings.git.viewDiffAria', { hash: shortHash(entry.hash) })}
          aria-expanded={expanded}
        >
          <ChevronRight
            aria-hidden="true"
            className={`w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <GitCommit className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <div className="text-zinc-200 break-words">
              {entry.message || t('settings.git.noMessage')}
            </div>
            <div className="flex items-center gap-2 mt-1 text-zinc-500 flex-wrap">
              <span className="font-mono text-zinc-400">{shortHash(entry.hash)}</span>
              <span>|</span>
              <span>{formatTimestamp(entry.timestamp)}</span>
              {/* 版本标签：提交自动记每一步，**版本**才是要找的那一个 */}
              {versions.map((v) => (
                <span
                  key={v.name}
                  className="inline-flex items-center gap-1 px-1.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30"
                >
                  <Tag aria-hidden="true" className="w-2.5 h-2.5" />
                  {v.name}
                </span>
              ))}
            </div>
          </div>
        </Button>
      </div>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {loading && (
            <div className="text-xs text-zinc-500 py-2">{t('settings.git.loadingDiff')}</div>
          )}
          {!loading && diff && (
            <>
              {diff.files.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 flex-wrap">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="text-zinc-500">
                    {t('settings.git.changedFiles', { count: diff.files.length })}
                  </span>
                  {diff.files.map((f, i) => (
                    <span
                      key={i}
                      className="font-mono text-zinc-400 bg-zinc-800 px-1 rounded text-xs"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <DiffPatch patch={diff.patch} />
            </>
          )}
          {!loading && !diff && (
            <div className="text-xs py-2">
              {diffError !== undefined ? (
                // 有原因就把它显示出来 —— 原来只有一句笼统的 diffFailed，
                // 「不是 git 仓库」「hash 不存在」「PATH 上没有 git」全被压成同一句话。
                <span className="text-red-400">
                  {t('settings.git.diffFailedDetail', {
                    error: diffError || t('settings.git.diffFailed'),
                  })}
                </span>
              ) : (
                <span className="text-zinc-500">{t('settings.git.diffFailed')}</span>
              )}
            </div>
          )}

          {/* 读档入口放在展开区里：一列提交只有展开后才"选中"了某一版，
              而且不能把 button 嵌进上面那个切换用的 button（嵌套 button 是非法 HTML）。 */}
          <div className="pt-1 space-y-1">
            <Button
              variant={confirmingRestore ? 'danger' : 'secondary'}
              size="sm"
              disabled={restoring}
              onClick={handleRestore}
              aria-label={t('settings.git.restoreAria', { hash: shortHash(entry.hash) })}
            >
              <RotateCcw className="w-3 h-3 mr-1" aria-hidden="true" />
              {restoring
                ? t('settings.git.restoring')
                : confirmingRestore
                  ? t('settings.git.restoreConfirm')
                  : t('settings.git.restore')}
            </Button>
            {restoreErrorHash === entry.hash && (
              <div className="text-xs text-red-400">
                {t('settings.git.restoreFailedDetail', {
                  error: restoreError || t('settings.git.restoreFailed'),
                })}
              </div>
            )}

            {/* 删除 / 重命名这一条。位置与"恢复到此版本"同层 —— 展开区里才是"选中了某一版"。 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant={confirmingDelete ? 'danger' : 'secondary'}
                size="sm"
                disabled={rewriteLoading}
                onClick={handleDelete}
                aria-label={t('settings.git.deleteCommitAria', { hash: shortHash(entry.hash) })}
              >
                <Trash2 className="w-3 h-3 mr-1" aria-hidden="true" />
                {rewriteLoading
                  ? t('settings.git.deleting')
                  : confirmingDelete
                    ? t('settings.git.deleteCommitConfirm')
                    : t('settings.git.deleteCommit')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={rewriteLoading}
                onClick={() => {
                  setDraft(entry.message);
                  setRewording((v) => !v);
                }}
                aria-label={t('settings.git.rewordAria', { hash: shortHash(entry.hash) })}
              >
                <Pencil className="w-3 h-3 mr-1" aria-hidden="true" />
                {t('settings.git.reword')}
              </Button>
            </div>
            {rewording && (
              <div className="flex items-center gap-1.5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('settings.git.rewordPlaceholder')}
                  aria-label={t('settings.git.rewordAria', { hash: shortHash(entry.hash) })}
                  className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                />
                <Button size="sm" disabled={rewriteLoading || !draft.trim()} onClick={handleReword}>
                  {rewriteLoading ? t('settings.git.saving') : t('settings.git.rewordSave')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRewording(false)}>
                  {t('settings.git.rewordCancel')}
                </Button>
              </div>
            )}

            {/* 版本（tag）：与「提交」不同 —— 这是要找的那个"版本"，可改名、可删除。
                删除只删标签，提交本身不动。 */}
            {versions.length > 0 && (
              <div className="space-y-1 pt-1">
                {versions.map((v) => (
                  <div key={v.name} className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 text-xs">
                      <Tag aria-hidden="true" className="w-3 h-3" />
                      {v.name}
                    </span>
                    {renamingVersion === v.name ? (
                      <>
                        <input
                          value={versionDraft}
                          onChange={(e) => setVersionDraft(e.target.value)}
                          aria-label={t('settings.git.versionRenameAria', { name: v.name })}
                          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                        />
                        <Button
                          size="sm"
                          disabled={versionLoading || !versionDraft.trim()}
                          onClick={async () => {
                            const ok = await renameVersion(
                              projectPath,
                              v.name,
                              versionDraft.trim(),
                            );
                            if (ok) setRenamingVersion(null);
                          }}
                        >
                          {t('settings.git.versionSave')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenamingVersion(null)}>
                          {t('settings.git.rewordCancel')}
                        </Button>
                      </>
                    ) : (
                      <>
                        {/* 回到这个版本 —— 这才是版本存在的意义。走的是既有的 restoreFlow
                            （会先备份当前文件、再写回、并追加一条 restore 提交）。 */}
                        <Button
                          size="sm"
                          variant={confirmingRestoreVersion === v.name ? 'danger' : 'secondary'}
                          disabled={versionLoading}
                          aria-label={t('settings.git.restoreVersionAria', { name: v.name })}
                          onClick={async () => {
                            if (confirmingRestoreVersion !== v.name) {
                              setConfirmingRestoreVersion(v.name);
                              return;
                            }
                            setConfirmingRestoreVersion(null);
                            const ok = await restoreFlowForVersion(projectPath, v.hash);
                            if (ok) setExpanded(false);
                          }}
                        >
                          <RotateCcw aria-hidden="true" className="w-3 h-3 mr-1" />
                          {confirmingRestoreVersion === v.name
                            ? t('settings.git.restoreConfirm')
                            : t('settings.git.restoreVersion')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={versionLoading}
                          aria-label={t('settings.git.versionRenameAria', { name: v.name })}
                          onClick={() => {
                            setVersionDraft(v.name);
                            setRenamingVersion(v.name);
                          }}
                        >
                          {t('settings.git.reword')}
                        </Button>
                        <Button
                          size="sm"
                          variant={confirmingDeleteVersion === v.name ? 'danger' : 'ghost'}
                          disabled={versionLoading}
                          aria-label={t('settings.git.versionDeleteAria', { name: v.name })}
                          onClick={async () => {
                            if (confirmingDeleteVersion !== v.name) {
                              setConfirmingDeleteVersion(v.name);
                              return;
                            }
                            setConfirmingDeleteVersion(null);
                            await deleteVersion(projectPath, v.name);
                          }}
                        >
                          <Trash2 aria-hidden="true" className="w-3 h-3 mr-1" />
                          {confirmingDeleteVersion === v.name
                            ? t('settings.git.versionDeleteConfirm')
                            : t('settings.git.versionDelete')}
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GitHistoryDialog({ open, onClose, projectPath }: GitHistoryDialogProps) {
  useLocaleSubscription();
  const branch = useGitStore((s) => s.branch);
  const commitCount = useGitStore((s) => s.commitCount);
  const clean = useGitStore((s) => s.clean);
  const logEntries = useGitStore((s) => s.logEntries);
  const logLoading = useGitStore((s) => s.logLoading);
  const logError = useGitStore((s) => s.logError);
  const fetchLog = useGitStore((s) => s.fetchLog);
  const clearHistory = useGitStore((s) => s.clearHistory);
  const clearLoading = useGitStore((s) => s.clearLoading);
  const clearError = useGitStore((s) => s.clearError);
  const deleteCommits = useGitStore((s) => s.deleteCommits);
  const rewriteLoading = useGitStore((s) => s.rewriteLoading);
  const rewriteError = useGitStore((s) => s.rewriteError);
  const lastBackupRef = useGitStore((s) => s.lastBackupRef);
  const lastWorktreeDirty = useGitStore((s) => s.lastWorktreeDirty);
  const versionTags = useGitStore((s) => s.versionTags);
  const versionNext = useGitStore((s) => s.versionNext);
  const versionLoading = useGitStore((s) => s.versionLoading);
  const versionError = useGitStore((s) => s.versionError);
  const fetchVersions = useGitStore((s) => s.fetchVersions);
  const versionHeadHash = useGitStore((s) => s.versionHeadHash);
  /** 当前提交是否已经有版本：有的话就不能再起第二个名字（版本必须能定位到一份代码） */
  const headHasVersion =
    versionHeadHash !== null && versionTags.some((v) => v.hash === versionHeadHash);
  const tagVersionNow = useGitStore((s) => s.tagVersionNow);
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** 多选：hash 集合。单删走每行的按钮，批量删走这里 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBatchDelete, setConfirmingBatchDelete] = useState(false);

  useEffect(() => {
    if (open && projectPath) {
      void fetchLog(projectPath, 50);
      void fetchVersions(projectPath);
    }
  }, [open, projectPath, fetchLog, fetchVersions]);

  /** 提交 hash → 该提交上的版本标签（一个提交可以有多个版本名） */
  const versionsByHash = new Map<string, typeof versionTags>();
  for (const v of versionTags) {
    const list = versionsByHash.get(v.hash) ?? [];
    list.push(v);
    versionsByHash.set(v.hash, list);
  }

  // 换项目 / 重新打开时清空选择：留着上一个项目的 hash 会指向不存在的提交
  useEffect(() => {
    setSelected(new Set());
    setConfirmingBatchDelete(false);
  }, [projectPath, open]);

  const toggleSelect = useCallback((hash: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  const handleRefresh = () => {
    setSelected(new Set());
    setConfirmingBatchDelete(false);
    if (projectPath) void fetchLog(projectPath, 50);
  };

  /** 批量删除同样两段式确认 */
  const handleBatchDelete = async () => {
    if (!confirmingBatchDelete) {
      setConfirmingBatchDelete(true);
      return;
    }
    setConfirmingBatchDelete(false);
    const ok = await deleteCommits(projectPath, [...selected]);
    if (ok) setSelected(new Set());
  };

  // 清空历史同样是两段式确认（它会把整个 .git 挪走，虽然留了档但值得一次停顿）
  const handleClearHistory = async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    if (projectPath) await clearHistory(projectPath);
  };

  return (
    <Modal open={open} onClose={onClose} title={t('settings.git.title')} width="720px">
      <div className="space-y-3">
        {/* 仓库概要 */}
        <div className="flex items-center gap-3 text-xs px-3 py-2 bg-zinc-800/50 rounded border border-zinc-700">
          <span className="inline-flex items-center gap-1 text-zinc-300">
            <GitBranch aria-hidden="true" className="w-3.5 h-3.5" />
            {branch || t('settings.git.unknownBranch')}
          </span>
          <span className="text-zinc-500">|</span>
          <span className="text-zinc-400">
            {t('settings.git.commitCount', { count: commitCount })}
          </span>
          <span className="text-zinc-500">|</span>
          <span
            className={`inline-flex items-center gap-1 ${clean ? 'text-green-400' : 'text-yellow-400'}`}
          >
            {clean ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            {clean ? t('settings.git.clean') : t('settings.git.dirty')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1 hover:text-white hover:bg-zinc-700"
            onClick={handleRefresh}
            disabled={logLoading}
            aria-label={t('settings.git.refreshAria')}
          >
            <RefreshCw
              aria-hidden="true"
              className={`w-3 h-3 ${logLoading ? 'animate-spin' : ''}`}
            />
            {t('editor.action.refresh')}
          </Button>
          {/* 版本：提交每次保存都会有，**版本**才是你要找的那个。
              点「生成代码」时会自动打一个；这里也可以手动把当前提交标记为版本。 */}
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={versionLoading || commitCount === 0 || headHasVersion}
            title={headHasVersion ? t('settings.git.markVersionDisabledHint') : undefined}
            onClick={() => void tagVersionNow(projectPath, versionNext)}
            aria-label={t('settings.git.markVersionAria', { name: versionNext })}
          >
            <Tag aria-hidden="true" className="w-3 h-3" />
            {t('settings.git.markVersion', { name: versionNext })}
          </Button>
          <Button
            variant={confirmingClear ? 'danger' : 'ghost'}
            size="sm"
            className="gap-1"
            onClick={handleClearHistory}
            disabled={clearLoading || commitCount === 0}
            aria-label={t('settings.git.clearHistoryAria')}
          >
            <Trash2 aria-hidden="true" className="w-3 h-3" />
            {clearLoading
              ? t('settings.git.clearing')
              : confirmingClear
                ? t('settings.git.clearHistoryConfirm')
                : t('settings.git.clearHistory')}
          </Button>
        </div>
        {clearError !== undefined && clearError !== null && (
          <div className="text-xs text-red-400 px-3">
            {t('settings.git.clearHistoryFailedDetail', { error: clearError })}
          </div>
        )}

        {/* 改写结果：备份 ref 是**给用户的后路**，必须显式告诉他，
            否则"删错了"就只能干看着 */}
        {rewriteError !== undefined && rewriteError !== null && (
          <div className="text-xs text-red-400 px-3">
            {t('settings.git.rewriteFailedDetail', {
              error: rewriteError || t('settings.git.rewriteFailed'),
            })}
          </div>
        )}
        {versionError !== null && (
          <div className="text-xs text-red-400 px-3">
            {t('settings.git.versionFailedDetail', {
              error: versionError || t('settings.git.versionFailed'),
            })}
          </div>
        )}
        {lastBackupRef !== null && (
          <div className="text-xs text-zinc-500 px-3">
            {t('settings.git.backupHint', { ref: lastBackupRef })}
            {lastWorktreeDirty ? ' · ' + t('settings.git.worktreeDirtyHint') : ''}
          </div>
        )}

        {/* 多选工具条：只在有选中时出现，不常驻占空间 */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs bg-zinc-800/50 rounded border border-zinc-700">
            <span className="text-zinc-300">
              {t('settings.git.selectedCount', { count: selected.size })}
            </span>
            <Button
              variant={confirmingBatchDelete ? 'danger' : 'secondary'}
              size="sm"
              className="ml-auto gap-1"
              disabled={rewriteLoading}
              onClick={handleBatchDelete}
              aria-label={t('settings.git.deleteSelectedAria', { count: selected.size })}
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              {rewriteLoading
                ? t('settings.git.deleting')
                : confirmingBatchDelete
                  ? t('settings.git.deleteSelectedConfirm', { count: selected.size })
                  : t('settings.git.deleteSelected')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set());
                setConfirmingBatchDelete(false);
              }}
            >
              {t('settings.git.rewordCancel')}
            </Button>
          </div>
        )}

        {/* 提交列表（可展开 diff） */}
        <div className="max-h-[480px] overflow-y-auto border border-zinc-700 rounded">
          {logEntries.length === 0 && !logLoading && (
            <div className="px-3 py-8 text-center text-xs">
              {logError ? (
                // 「读不出来」和「没有提交」是两件事。原来两者都显示"暂无提交记录" ——
                // 于是 git 一旦出问题，用户看到的是一片空白加上一句误导性的说明。
                <span className="text-red-400">
                  {t('settings.git.logFailed', { error: logError })}
                </span>
              ) : (
                <span className="text-zinc-500">{t('settings.git.empty')}</span>
              )}
            </div>
          )}
          {logLoading && logEntries.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-zinc-500">
              {t('editor.action.loading')}
            </div>
          )}
          {logEntries.map((entry, idx) => (
            <CommitRow
              key={entry.hash}
              entry={entry}
              isLast={idx === logEntries.length - 1}
              projectPath={projectPath}
              selected={selected.has(entry.hash)}
              onToggleSelect={toggleSelect}
              versions={versionsByHash.get(entry.hash) ?? []}
            />
          ))}
        </div>

        {/* 提示 */}
        <div className="text-xs text-zinc-500 px-1">{t('settings.git.hint')}</div>
      </div>
    </Modal>
  );
}
