// src/renderer/src/components/editor/CodeEditor.tsx
import { useRef, useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { EditorFile } from './types';
import { Button } from '../ui/Button';
import { X } from 'lucide-react';
import { ensureMonacoInit } from '../../lib/infra/monacoSetup';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// 懒加载 Monaco Editor，避免阻塞首屏渲染
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })),
);

interface Props {
  files: EditorFile[];
  projectPath: string;
  /** 当前激活的文件路径（外部控制，如从文件树打开后自动切换） */
  activeFilePath?: string;
  /** 激活文件变更回调 */
  onActiveFileChange?: (path: string) => void;
  onSave?: (relativePath: string, content: string) => void;
  onCloseFile?: (relativePath: string) => void;
}

/** 文件编辑器 Tab 栏 + Monaco 编辑器 + 多文件修改状态追踪 */
export function CodeEditor({
  files,
  projectPath,
  activeFilePath,
  onActiveFileChange,
  onSave,
  onCloseFile,
}: Props) {
  useLocaleSubscription();
  const filesRef = useRef(files);
  filesRef.current = files;

  // Monaco 初始化完成，内置 TS/JS 支持已可用，无需额外注册
  useEffect(() => {
    ensureMonacoInit().catch(() => {});
  }, []);
  // 用路径追踪活动文件（避免关闭 Tab 后索引漂移）
  const [internalActivePath, setInternalActivePath] = useState<string | null>(null);
  const activePath = activeFilePath ?? internalActivePath;

  // 每个文件路径 → 修改后的内容（null 表示未修改）
  const [modifiedMap, setModifiedMap] = useState<Record<string, string | null>>({});
  // 保存期间屏蔽 onDidChangeModelContent 的回写
  const savingRef = useRef(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  // ⚠️ 源码级断点相关的 ref / store 订阅已随 Python 调试器一并移除（见下方 handleEditorMount 的说明）。

  const activeFile = files.find((f) => f.path === activePath) ?? files[0];
  const modifiedContent = activeFile ? (modifiedMap[activeFile.path] ?? null) : null;
  const displayContent = modifiedContent ?? activeFile?.content ?? '';
  const isModified =
    modifiedContent !== null && activeFile != null && modifiedContent !== activeFile.content;

  // 当 files 变化时，确保 activePath 有效
  useEffect(() => {
    if (files.length === 0) {
      setInternalActivePath(null);
      return;
    }
    if (activePath && files.some((f) => f.path === activePath)) return;
    // 当前活动文件已不存在，切换到第一个
    const newPath = files[0].path;
    setInternalActivePath(newPath);
    onActiveFileChange?.(newPath);
  }, [files, activePath, onActiveFileChange]);

  const setActivePath = useCallback(
    (path: string) => {
      setInternalActivePath(path);
      onActiveFileChange?.(path);
    },
    [onActiveFileChange],
  );

  /**
   * ⚠️ 2026-09-30：这里原本有一套**源码级断点**（Monaco glyphMargin 点击打点 +
   * 断点/当前执行行装饰器），数据来自 `sourceDebugStore` —— 那是给 **Python 源码调试器**
   * （debugpy，DAP 形状）用的，而它的通道 `debugger:*` **主进程一个处理器都没注册**，
   * Python 运行时也已按 ADR 删除。整块随那套调试器一起删掉。
   *
   * 现在的调试是**节点级**的（`debugStore` + 画布上的变量面板）：断点打在**流程节点**上，
   * 不是打在源码行上 —— 所以这个编辑器不再需要 glyphMargin 断点。
   */

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      editor.onDidChangeModelContent(() => {
        // 保存期间屏蔽回写，避免闪回
        if (savingRef.current) return;
        const val = editor.getValue();
        const currentPath = activePath ?? filesRef.current[0]?.path;
        if (currentPath) {
          setModifiedMap((prev) => ({
            ...prev,
            [currentPath]: val,
          }));
        }
      });
    },
    [activePath],
  );

  const handleSave = useCallback(() => {
    if (modifiedContent !== null && activeFile && onSave) {
      savingRef.current = true;
      onSave(activeFile.path, modifiedContent);
      setModifiedMap((prev) => ({ ...prev, [activeFile.path]: null }));
      // 延迟解除屏蔽，等 Monaco 模型更新完毕
      setTimeout(() => {
        savingRef.current = false;
      }, 100);
    }
  }, [modifiedContent, activeFile, onSave]);

  // Ctrl+S 保存
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [handleSave]);

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm bg-zinc-950">
        {t('editor.explorer.empty')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* 文件 Tab 栏 */}
      <div
        className="flex items-center bg-zinc-900 border-b border-zinc-800 overflow-x-auto shrink-0"
        role="tablist"
      >
        {files.map((f) => {
          const fileModified =
            modifiedMap[f.path] !== null &&
            modifiedMap[f.path] !== undefined &&
            modifiedMap[f.path] !== f.content;
          const isActive = f.path === activePath;
          return (
            <div
              key={f.path}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-zinc-800 cursor-pointer select-none transition-colors ${
                isActive
                  ? 'bg-zinc-950 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
              onClick={() => setActivePath(f.path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActivePath(f.path);
                }
              }}
            >
              {/* 修改状态圆点 */}
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  fileModified ? 'bg-blue-400' : f.readOnly ? 'bg-zinc-600' : 'bg-zinc-700'
                }`}
                title={
                  fileModified
                    ? t('editor.explorer.modified')
                    : f.readOnly
                      ? t('editor.explorer.readOnly')
                      : t('editor.explorer.unmodified')
                }
              />
              <span className="truncate max-w-32">{f.label}</span>
              {/* 关闭按钮（有 onCloseFile 时显示） */}
              {onCloseFile && files.length > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<X className="w-2.5 h-2.5" />}
                  className="w-3.5 h-3.5 !p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFile(f.path);
                  }}
                  title={t('editor.action.close')}
                />
              ) : null}
            </div>
          );
        })}
        <div className="flex-1" />
        {isModified && (
          <Button variant="ghost" size="sm" onClick={handleSave} className="text-blue-400 mr-1">
            {t('editor.action.save')}
          </Button>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
              {t('editor.editor.loading')}
            </div>
          }
        >
          <MonacoEditor
            key={`${activeFile.path}-${projectPath}`}
            defaultLanguage="typescript"
            theme="vs-dark"
            value={displayContent}
            options={{
              readOnly: activeFile.readOnly,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on',
              tabSize: 4,
              // 智能编辑增强
              quickSuggestions: true,
              suggestOnTriggerCharacters: true,
              parameterHints: { enabled: true },
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              scrollBeyondLastColumn: 2,
              renderWhitespace: 'selection',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              padding: { top: 8 },
              // 高代码模式：glyphMargin 区域用于点击设置断点
              glyphMargin: true,
            }}
            onMount={handleEditorMount}
          />
        </Suspense>
      </div>
    </div>
  );
}
