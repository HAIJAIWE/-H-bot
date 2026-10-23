import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTerminalStore } from '../../stores/terminalStore';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import '@xterm/xterm/css/xterm.css';
import { t } from '../../i18n';

const MIN_FONT = 10;
const MAX_FONT = 24;

interface MenuPos {
  x: number;
  y: number;
}

export function TerminalPanel() {
  // 组件里用了 t()，必须订阅语言变化（见 stores/i18nStore.ts 的 useLocaleSubscription 注释）
  useLocaleSubscription();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const fontSizeRef = useRef(13);
  const [loading, setLoading] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const [atBottom, setAtBottom] = useState(true);
  const sessionId = useTerminalStore((s) => s.sessionId);
  const setSessionId = useTerminalStore((s) => s.setSessionId);
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const toast = useToast();

  // 无 API 时降级显示（使用条件渲染而非早期 return）
  const apiUnavailable = !window.qqbat?.terminal;

  // 保持 ref 与 store 同步
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 清屏
  const clearTerminal = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.clear();
    // 如果后端支持清屏，发 clear 指令
    const id = sessionIdRef.current;
    if (id) {
      window.qqbat.terminal.write(id, '\x0c');
    }
  }, []);

  // 关闭右键菜单
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuPos]);

  // 初始化 xterm + 创建后端会话
  useEffect(() => {
    if (!containerRef.current) return;

    // P2 修复：切换项目时清理旧会话，避免旧 PTY 残留 + 让新项目终端正常创建。
    // 旧 guard 包含 `|| sessionId` 检查，导致切换项目时旧 sessionId 仍在 → 提前 return → 终端无法重建。
    const oldSid = sessionIdRef.current;
    if (oldSid) {
      window.qqbat.terminal.kill(oldSid).then(
        () => {},
        () => {},
      );
      sessionIdRef.current = null;
      setSessionId(null);
    }

    let disposed = false;

    const term = new XtermTerminal({
      cursorBlink: true,
      fontSize: fontSizeRef.current,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: { background: '#09090b', foreground: '#e4e4e7' },
      allowProposedApi: true,
      rightClickSelectsWord: true,
    });

    // 键盘快捷键
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+滚轮 缩放 — handled by wheel event
      // Ctrl+L — 清屏
      if (e.type === 'keydown' && e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        clearTerminal();
        return false;
      }
      // Ctrl+C / Ctrl+Insert — 选中时复制
      if (e.type === 'keydown' && e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel);
          term.focus();
          return false;
        }
      }
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'Insert') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel);
          return false;
        }
      }
      // Ctrl+Shift+V — 粘贴
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        navigator.clipboard.readText().then((text) => {
          if (text && sessionIdRef.current) {
            window.qqbat.terminal.write(sessionIdRef.current, text);
          }
        });
        return false;
      }
      // Shift+Insert — 粘贴
      if (e.type === 'keydown' && e.shiftKey && e.key === 'Insert') {
        navigator.clipboard.readText().then((text) => {
          if (text && sessionIdRef.current) {
            window.qqbat.terminal.write(sessionIdRef.current, text);
          }
        });
        return false;
      }
      return true;
    });

    // Ctrl+滚轮 缩放
    term.element?.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1 : -1;
        const next = Math.min(MAX_FONT, Math.max(MIN_FONT, fontSizeRef.current + delta));
        if (next !== fontSizeRef.current) {
          fontSizeRef.current = next;
          term.options.fontSize = next;
          setFontSize(next);
          try {
            fitAddonRef.current?.fit();
          } catch {
            /* ignore */
          }
        }
      },
      { passive: false },
    );

    // 右键菜单
    term.element?.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      setMenuPos({ x: e.clientX, y: e.clientY });
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 滚屏检测
    term.onScroll(() => {
      const buffer = term.buffer.active;
      setAtBottom(buffer.viewportY >= buffer.baseY);
    });

    // 创建后端会话
    if (projectPath) {
      setLoading(true);
      window.qqbat.terminal.create(projectPath).then((res) => {
        if (disposed) return; // 终端已销毁（项目再次切换），丢弃响应避免设置已失效的 sessionId
        setLoading(false);
        if (res.ok && res.data) {
          sessionIdRef.current = res.data; // 立即同步 ref，onData/onData 处理可用
          setSessionId(res.data);
          term.focus();
        } else {
          term.writeln(
            `\x1b[31m${t('editor.terminal.createFailed', { error: res.error ?? t('editor.error.unknown') })}\x1b[0m`,
          );
        }
      });
    }

    // 键盘输入 → IPC 写入
    term.onData((data) => {
      const id = sessionIdRef.current;
      if (id) {
        window.qqbat.terminal.write(id, data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* ignore */
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      term.dispose();
    };
    // sessionId 故意省略：终端创建成功后 sessionId 变化不应重建终端。
    // effect 仅在 projectPath 变化时执行；切换项目时先 kill 旧会话、清 sessionId，
    // 再为新项目创建新终端（见 effect 开头的旧会话清理逻辑）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // 监听主进程推送的终端数据
  useEffect(() => {
    const unsub = window.qqbat.terminal.onData(({ id: sid, data }) => {
      if (sid === sessionIdRef.current && xtermRef.current) {
        xtermRef.current.write(data);
      }
    });
    return unsub;
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-950 relative">
      {apiUnavailable ? (
        <div className="h-full flex items-center justify-center bg-zinc-950 text-zinc-500 text-xs">
          {t('editor.terminal.unavailable')}
        </div>
      ) : (
        <>
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800 bg-zinc-900 text-xs text-zinc-500 shrink-0">
            <span className="flex items-center gap-2">
              <span>
                {t('editor.tab.terminal')}{' '}
                {sessionId ? t('editor.terminal.connected') : t('editor.terminal.disconnected')}
              </span>
              <span className="text-zinc-700">{fontSize}px</span>
            </span>
            <div className="flex items-center gap-1">
              {loading && <span className="text-yellow-400">{t('editor.terminal.creating')}</span>}
              {/* 滚到底部 */}
              {!atBottom && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => xtermRef.current?.scrollToBottom()}
                  title={t('editor.terminal.scrollToBottom')}
                >
                  ↓
                </Button>
              )}
              {/* 清屏 */}
              {sessionId && (
                <Button variant="ghost" size="sm" onClick={clearTerminal} title={t('editor.terminal.clearTitle')}>
                  {t('editor.terminal.clear')}
                </Button>
              )}
              {/* 停止 */}
              {sessionId && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    // await + 错误反馈：kill 失败时不重置 sessionId，避免后端 PTY 子进程残留
                    try {
                      const res = await window.qqbat.terminal.kill(sessionId);
                      if (!res.ok) {
                        toast.error(
                          t('editor.terminal.stopFailed', {
                            error: res.error ?? t('editor.error.unknown'),
                          }),
                        );
                        return;
                      }
                      setSessionId(null);
                    } catch (e) {
                      toast.error(
                        t('editor.terminal.stopFailed', {
                          error: e instanceof Error ? e.message : String(e),
                        }),
                      );
                    }
                  }}
                >
                  {t('editor.terminal.stop')}
                </Button>
              )}
            </div>
          </div>

          {/* xterm 容器 */}
          <div ref={containerRef} className="flex-1" />

          {/* 右键菜单 */}
          {menuPos && (
            <div
              className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded shadow-xl py-1 text-sm"
              style={{ left: menuPos.x, top: menuPos.y }}
            >
              <Button
                variant="ghost"
                size="md"
                className="w-full justify-start text-left"
                onClick={() => {
                  const sel = xtermRef.current?.getSelection();
                  if (sel) navigator.clipboard.writeText(sel);
                  setMenuPos(null);
                }}
              >
                {t('editor.terminal.copy')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="w-full justify-start text-left"
                onClick={() => {
                  navigator.clipboard.readText().then((text) => {
                    if (text && sessionIdRef.current) {
                      window.qqbat.terminal.write(sessionIdRef.current, text);
                    }
                  });
                  setMenuPos(null);
                }}
              >
                {t('editor.terminal.paste')}
              </Button>
              <div className="border-t border-zinc-700 my-1" />
              <Button
                variant="ghost"
                size="md"
                className="w-full justify-start text-left"
                onClick={() => {
                  clearTerminal();
                  setMenuPos(null);
                }}
              >
                {t('editor.terminal.clear')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
