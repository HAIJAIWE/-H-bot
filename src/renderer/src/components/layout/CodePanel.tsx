// src/renderer/src/components/layout/CodePanel.tsx
import { useState, useEffect, useCallback, useMemo, lazy, Suspense, memo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useTestStore } from '../../stores/testStore';
import { useDebugStore } from '../../stores/debugStore';
import { useFlowStore } from '../../stores/flowStore';
import { useUiStore } from '../../stores/uiStore';
import { pickActiveFile, useEditorStore } from '../../stores/editorStore';
import { useToast } from '../ui/Toast';
import { Spinner } from '../ui/Spinner';
import { Button } from '../ui/Button';
import { FileExplorer } from '../editor/FileExplorer';
import { isAppManagedReadOnly } from '../editor/readOnlyPaths';
import { Modal } from '../ui/Modal';
// 指南打包进渲染层（打包后 app.asar 里没有 docs/，但仍要能看）——
// 唯一真相是 docs/guides/plugin-authoring.md，两者由测试断言逐字节一致。
import nodeAuthoringGuide from '../../assets/node-authoring.md?raw';
import type { EditorFile } from '../editor/types';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// 懒加载 CodeEditor（Monaco 编辑器，~2MB），仅在代码编辑 tab 激活时加载
const CodeEditor = lazy(() =>
  import('../editor/CodeEditor').then((m) => ({ default: m.CodeEditor })),
);

export const CodePanel = memo(function CodePanel() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const [files, setFiles] = useState<EditorFile[]>([]);
  /**
   * 当前打开的文件（2026-10-15 从**组件局部 state** 提到 `editorStore`，P1-5）。
   *
   * 为什么必须提出来：编程智能体要说得出「用户打开的是哪个文件」，
   * 而 `aiStore` 读不到组件内部的 state。为什么不塞进 uiStore —— 见 editorStore.ts 文件头。
   */
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFilePath = useEditorStore((s) => s.setActiveFilePath);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);
  /** 展示「怎么写自定义节点」参考指南 */
  const [showNodeGuide, setShowNodeGuide] = useState(false);
  /** 新建自定义节点弹窗（给**人**用的入口：一键拿到可编辑骨架） */
  const [showNewNode, setShowNewNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [creatingNode, setCreatingNode] = useState(false);
  /** 资源管理器刷新用：创建新文件后换 key 让它重新列目录 */
  const [explorerKey, setExplorerKey] = useState(0);
  /**
   * 本次会话里**手动解锁**的文件（应用管理的文件默认只读）。
   *
   * 为什么要有它：一刀切锁死不合适 —— 有些场景用户就是要手改（批量改 flow.json 的配置、
   * 临时修生成物）。设计成"默认安全 + 主动解锁"，而不是"你想改？不行"。
   * 只存在会话内存里：下次打开要再解锁一次（避免永久放开而忘了它会**被应用覆盖**）。
   */
  const [unlockedPaths, setUnlockedPaths] = useState<Set<string>>(new Set());
  const openTestDialog = useTestStore((s) => s.openDialog);
  const botRunning = useTestStore((s) => s.botRunning);
  // 节点级调试器（**不是**已删除的 Python 源码调试器 / debugpy 那套）：
  // 断点打在**流程节点**上，状态由主进程经 `debug:stateChanged` 推送，数据来自运行时日志标记。
  const isDebugActive = useDebugStore((s) => s.isDebugging);
  const debugStatus = useDebugStore((s) => s.debugState.status);
  const startDebugSession = useDebugStore((s) => s.startDebug);
  const stopDebugSession = useDebugStore((s) => s.stopDebug);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const toast = useToast();
  /** 当前打开的文件（用来显示"为什么这个不能改"） */
  const activeFile = files.find((f) => f.path === activeFilePath);
  /** 当前文件是否仍处于"锁定"状态（解锁过的就不再拦） */
  const activeFileLocked = !!activeFile?.readOnly && !unlockedPaths.has(activeFile.path);
  /** 交给编辑器的文件列表：解锁过的把 readOnly 置为 false（CodeEditor 按它设 Monaco） */
  const editorFiles = useMemo(
    () =>
      unlockedPaths.size === 0
        ? files
        : files.map((f) =>
            f.readOnly && unlockedPaths.has(f.path) ? { ...f, readOnly: false } : f,
          ),
    [files, unlockedPaths],
  );

  // 加载项目核心代码文件（固定列表）
  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    setError('');

    async function loadProjectFiles() {
      const result: EditorFile[] = [];

      // 要加载的固定文件列表（path, label, readOnly）
      // 迁移说明：运行时已改为纯 TypeScript —— 代码生成产物是 flow.generated.ts
      // 快照（仅用于调试/审查，运行时直接解释 .qqbat/flow.json）。
      // （2026-10-02 删除了「导出为可读 TypeScript」：它写在 Python 时代遗留的 src/plugins/ 下、
      //   输出既非合法 TS 也不接插件契约，两个月零使用 —— 见设计文档的架构审查。）
      const fixedFiles: { path: string; label: string; readOnly: boolean }[] = [
        // ⚠️ 这是**派生物**，不是用户的工程文件：
        //   · 每次"生成代码"都会**整体覆盖**
        //   · 运行时不加载它（解释器直接读 .qqbat/flow.json）
        // 所以这里必须是只读 —— 否则就是在代码编辑器里邀请用户改一个"改了会白改"的文件
        // （2026-10-02：用户指出"这是代码编辑器那边，不是低代码那边"，位置放错了）。
        {
          path: 'src/plugins/generated/flow.generated.ts',
          label: t('editor.code.snapshot'),
          readOnly: true,
        },
        { path: '.env', label: '.env', readOnly: false },
        { path: '.qqbat/flow.json', label: 'flow.json', readOnly: true },
      ];

      // 并行读取固定文件
      const fixedResults = await Promise.all(
        fixedFiles.map(async (f) => {
          const res = await window.qqbat.file.read(projectPath, f.path);
          return { ...f, content: res.ok ? (res.data ?? '') : '', exists: res.ok };
        }),
      );
      for (const f of fixedResults) {
        if (f.exists) {
          result.push({ path: f.path, label: f.label, content: f.content, readOnly: f.readOnly });
        }
      }

      // 列出插件包目录（plugins/<pkg>/index.js），每个包可编辑其 index.js
      try {
        const listRes = await window.qqbat.file.list(projectPath, 'plugins');
        if (listRes.ok && listRes.data) {
          const dirs = (listRes.data as { name: string; path: string; isDirectory: boolean }[])
            .filter((p) => p.isDirectory)
            .map((p) => `${p.path.replace(/\\/g, '/')}/index.js`);
          const pkgResults = await Promise.all(
            dirs.map(async (p) => {
              const res = await window.qqbat.file.read(projectPath, p);
              return { path: p, content: res.ok ? (res.data ?? '') : '', exists: res.ok };
            }),
          );
          for (const f of pkgResults) {
            if (f.exists) {
              // 标签取插件包名（plugins/<pkg>/index.js → <pkg>）
              const parts = f.path.split('/');
              const label = parts.length >= 3 ? parts[parts.length - 2] : f.path;
              result.push({
                path: f.path,
                label: `🧩 ${label}`,
                content: f.content,
                readOnly: false,
              });
            }
          }
        }
      } catch {
        // plugins 目录可能不存在，忽略
      }

      return result;
    }

    loadProjectFiles()
      .then((loaded) => {
        setFiles(loaded);
        if (loaded.length === 0) setError(t('editor.code.noFiles'));
        // ⚠️ 默认选中**可编辑**的文件。原来停在列表第一个，而第一个是"生成代码快照"（只读的派生物）——
        // 用户一进「代码」页就撞墙："不能输入"（2026-10-02 反馈）。只有全是只读时才退回第一个。
        // 用 getState() 而不是闭包里的值：这个 effect 只在换项目时跑，
        // 把 activeFilePath 列进依赖会让它每切一次文件就重新读盘一遍。
        setActiveFilePath(pickActiveFile(loaded, useEditorStore.getState().activeFilePath));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // setActiveFilePath 是 zustand 的 action（引用恒定，不会引起重跑）—— 列进依赖只是为了
    // 让 react-hooks 的 lint 认得这个不变式；**不要**把 activeFilePath 也放进来（见上面那句）。
  }, [projectPath, setActiveFilePath]);

  const handleSave = useCallback(
    (relativePath: string, content: string) => {
      if (!projectPath) return;
      window.qqbat.file.write(projectPath, relativePath, content).then((res) => {
        if (res.ok) {
          setFiles((prev) => prev.map((f) => (f.path === relativePath ? { ...f, content } : f)));
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
          // 手动解锁后保存"应用管理的文件"：明确告知它**会被应用覆盖**，别以为是持久改动
          if (isAppManagedReadOnly(relativePath)) {
            toast.warning(t('editor.code.savedManagedWarning'));
          }
          /**
           * **护栏可见性**（2026-10-16）：这次写的是安全关键文件（禁区/备份/模式值域…）——
           * 与普通保存**区分开**报警：用户可能几轮之后才发现"护栏被改薄了"。
           * 判据完全来自主进程（它知道目标在不在框架根内），渲染层不自己重算。
           */
          if (res.data?.securityCritical) {
            toast.warning(
              t('editor.code.savedSecurityCritical', { file: res.data.securityCritical.path }),
            );
          }
        } else {
          setError(res.error || t('editor.code.saveFailed'));
        }
      });
    },
    [projectPath, toast],
  );

  /** 从文件资源管理器打开文件 */
  const handleOpenFile = useCallback(
    async (relativePath: string) => {
      if (!projectPath) return;
      // 如果已在文件列表中，直接切换
      if (files.some((f) => f.path === relativePath)) {
        setActiveFilePath(relativePath);
        return;
      }
      const res = await window.qqbat.file.read(projectPath, relativePath);
      if (res.ok) {
        const label = relativePath.split('/').pop() || relativePath;
        const isReadOnly = isAppManagedReadOnly(relativePath);
        setFiles((prev) => [
          ...prev,
          { path: relativePath, label, content: res.data ?? '', readOnly: isReadOnly },
        ]);
        setActiveFilePath(relativePath);
      }
    },
    [projectPath, files, setActiveFilePath],
  );

  /**
   * 新建自定义节点：在 `plugins/<名>/` 下写 manifest.json + index.js，然后**直接打开**给用户改。
   * 这是"人工怎么写代码"的入口 —— 以前代码面板里只有只读文件，用户无处下笔。
   */
  const handleCreateNode = useCallback(async () => {
    if (!projectPath) return;
    const name = newNodeName.trim();
    setCreatingNode(true);
    try {
      const res = await window.qqbat.plugin.createNode(
        projectPath,
        name,
        newNodeLabel.trim() || undefined,
      );
      if (!res.ok) {
        toast.error(res.error || t('editor.code.nodeCreateFailed'));
        return;
      }
      const created = res.data;
      if (!created) {
        toast.error(t('editor.code.nodeCreateFailed'));
        return;
      }
      toast.success(t('editor.code.nodeCreated', { path: created.dir }));
      setShowNewNode(false);
      setNewNodeName('');
      setNewNodeLabel('');
      setExplorerKey((k) => k + 1); // 让资源管理器重新列目录，新文件立刻可见
      await handleOpenFile(created.entryRelPath);
    } finally {
      setCreatingNode(false);
    }
  }, [projectPath, newNodeName, newNodeLabel, toast, handleOpenFile]);

  /** 关闭文件 Tab */
  const handleCloseFile = useCallback((relativePath: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== relativePath));
  }, []);

  return (
    <div className="@container h-full flex flex-col bg-zinc-950">
      {/* 中栏被挤窄时（三栏最小宽度收敛到 380 左右）这一排按钮会互相压缩成竖排单字，
          所以宁可换行：按钮一律 nowrap + 允许 wrap，次要提示按容器宽度隐藏。 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 @md:px-3 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <Button
          variant={showExplorer ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowExplorer(!showExplorer)}
          title={showExplorer ? t('editor.explorer.hide') : t('editor.explorer.show')}
          leftIcon="☰"
        />
        <span className="text-xs text-zinc-500 font-mono whitespace-nowrap">
          {files.length > 0
            ? t('editor.count.files', { count: files.length })
            : t('editor.code.projectCode')}
        </span>
        <div className="flex-1 min-w-2" />
        {loading && (
          <span className="flex items-center text-xs text-zinc-500">
            <Spinner size="sm" />
            <span className="ml-1.5">{t('editor.action.loading')}</span>
          </span>
        )}
        {saved && <span className="text-xs text-green-400">{t('editor.code.saved')}</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
        {!loading && !error && (
          <span className="hidden @2xl:inline text-xs text-zinc-500 whitespace-nowrap">
            {t('editor.code.saveHint')}
          </span>
        )}
        {activeFile?.readOnly && (
          // 只读不能只是"改不动"—— 必须说明**为什么**（2026-10-02 用户反馈"不能编辑"）
          <span
            className="text-xs text-amber-400 whitespace-nowrap"
            title={t('editor.code.readOnlyTitle')}
          >
            🔒 {t('editor.code.readOnlyHint')}
          </span>
        )}
        {activeFileLocked && (
          // 解锁入口放两处（这里 + 编辑器横幅）：横幅里的按钮一度被长文案挤出去过，
          // 用户找不到入口就只会说"点啥都没反应"。
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 whitespace-nowrap"
            title={t('editor.code.unlockHint')}
            onClick={() => {
              if (!activeFile) return;
              setUnlockedPaths((prev) => new Set(prev).add(activeFile.path));
              toast.warning(t('editor.code.unlockedToast'));
            }}
          >
            🔓 {t('editor.code.unlock')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          disabled={!projectPath}
          onClick={() => setShowNewNode(true)}
          title={t('editor.code.newNodeTitle')}
        >
          ➕ {t('editor.code.newNode')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setShowNodeGuide(true)}
          title={t('editor.code.nodeGuideTitle')}
        >
          📘 {t('editor.code.nodeGuide')}
        </Button>
        <Button
          variant={botRunning ? 'success' : 'primary'}
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={openTestDialog}
          title={botRunning ? t('editor.test.sendHint') : t('editor.test.openTitle')}
        >
          {t('editor.test.open')}
        </Button>
        <Button
          variant={isDebugActive ? 'danger' : 'secondary'}
          size="sm"
          className="shrink-0 whitespace-nowrap"
          disabled={!projectPath}
          onClick={async () => {
            if (isDebugActive) {
              await stopDebugSession();
            } else {
              // 启动前先切到调试器 Tab，便于看到状态变化
              setRightTab('debugger');
              await startDebugSession(projectPath);
            }
          }}
          title={
            !projectPath
              ? t('editor.code.noProject')
              : isDebugActive
                ? t('editor.debug.stopTitle')
                : t('editor.debug.startTitle')
          }
        >
          {isDebugActive
            ? t('editor.debug.running', {
                status:
                  debugStatus === 'paused' ? t('editor.debug.paused') : t('editor.status.running'),
              })
            : t('editor.debug.start')}
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex">
        {/* 文件资源管理器侧边栏 */}
        {showExplorer && (
          <FileExplorer
            key={explorerKey}
            projectPath={projectPath}
            onOpenFile={handleOpenFile}
            openFilePaths={files.map((f) => f.path)}
            className="w-28 @2xl:w-52 shrink-0"
          />
        )}
        {/* 编辑器主区域 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {activeFileLocked && (
            // 只读**必须显眼地说**：否则用户只会觉得"编辑器坏了、不能输入"
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-amber-900/50 bg-amber-950/30 text-xs min-w-0">
              <span className="text-amber-300 shrink-0">🔒 {t('editor.code.readOnlyBanner')}</span>
              {/* ⚠️ 长说明必须能收缩/截断并留 tooltip —— 否则它会把右边两个按钮**挤出可视区**，
                  用户看到的就是"只有一行字、点什么都没反应"（2026-10-02 用户截图实际撞到）。 */}
              <span
                className="text-amber-500/80 truncate min-w-0 flex-1"
                title={t('editor.code.readOnlyBannerWhy')}
              >
                {t('editor.code.readOnlyBannerWhy')}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                title={t('editor.code.unlockHint')}
                onClick={() => {
                  if (!activeFile) return;
                  setUnlockedPaths((prev) => new Set(prev).add(activeFile.path));
                  toast.warning(t('editor.code.unlockedToast'));
                }}
              >
                🔓 {t('editor.code.unlock')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="shrink-0"
                disabled={!projectPath}
                onClick={() => setShowNewNode(true)}
              >
                ➕ {t('editor.code.newNode')}
              </Button>
            </div>
          )}
          {loading ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
              <Spinner size="md" />
              <span className="ml-2">{t('editor.action.loading')}</span>
            </div>
          ) : files.length === 0 ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
              {error || t('editor.explorer.pickFile')}
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                  <Spinner size="md" />
                  <span className="ml-2">{t('editor.editor.loading')}</span>
                </div>
              }
            >
              <CodeEditor
                files={editorFiles}
                projectPath={projectPath}
                activeFilePath={activeFilePath}
                onActiveFileChange={setActiveFilePath}
                onSave={handleSave}
                onCloseFile={handleCloseFile}
              />
            </Suspense>
          )}
        </div>
      </div>

      {/* 新建自定义节点：一键得到**可编辑**的骨架（否则代码面板里只有只读文件） */}
      <Modal
        open={showNewNode}
        onClose={() => setShowNewNode(false)}
        title={t('editor.code.newNodeTitle')}
        width="560px"
      >
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">{t('editor.code.newNodeIntro')}</p>
          <label className="block text-xs text-zinc-400" htmlFor="new-node-name">
            {t('editor.code.newNodeName')}
          </label>
          <input
            id="new-node-name"
            value={newNodeName}
            onChange={(e) => setNewNodeName(e.target.value)}
            placeholder="my-node"
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono"
          />
          <label className="block text-xs text-zinc-400" htmlFor="new-node-label">
            {t('editor.code.newNodeLabel')}
          </label>
          <input
            id="new-node-label"
            value={newNodeLabel}
            onChange={(e) => setNewNodeLabel(e.target.value)}
            placeholder={t('editor.code.newNodeLabelPlaceholder')}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setShowNewNode(false)}>
              {t('editor.code.newNodeCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={creatingNode}
              disabled={creatingNode || !/^[a-z][a-z0-9-]*$/.test(newNodeName.trim())}
              onClick={() => void handleCreateNode()}
            >
              {t('editor.code.newNodeCreate')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 「怎么写自定义节点」—— 把 docs/guides/plugin-authoring.md 搬到应用内，作者不用去翻仓库 */}
      <Modal
        open={showNodeGuide}
        onClose={() => setShowNodeGuide(false)}
        title={t('editor.code.nodeGuideTitle')}
        width="820px"
      >
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">{t('editor.code.nodeGuideIntro')}</p>
          <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
            {nodeAuthoringGuide}
          </pre>
        </div>
      </Modal>
    </div>
  );
});
