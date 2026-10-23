import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Dropdown } from '../ui/Dropdown';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** Official 适配器：消息调试器 */
function OfficialConsole({ projectPath }: { projectPath: string }) {
  useLocaleSubscription();
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<
    { id: number; text: string; type: 'sent' | 'result' | 'error' }[]
  >([]);
  const [sending, setSending] = useState(false);
  const [chatType, setChatType] = useState<'c2c' | 'group'>('c2c');
  const bottomRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const pushLog = (text: string, type: 'sent' | 'result' | 'error') => {
    setLogs((prev) => [...prev, { id: ++seqRef.current, text, type }]);
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || !projectPath) return;
    setInput('');
    const label =
      chatType === 'c2c' ? t('launch.console.privateChat') : t('launch.console.groupChat');
    pushLog(`[${label}] ${msg}`, 'sent');
    setSending(true);
    try {
      // 透传 chatType 给 IPC：原实现仅传 projectPath+message，后端硬编码 group，
      // 导致私聊/群聊切换无效，UI 显示「私聊」但实际仍是群聊消息
      const res = await window.qqbat.runtime.injectTestMessage(projectPath, msg, chatType);
      if (res.ok) {
        pushLog(t('launch.console.injected'), 'result');
      } else {
        pushLog(res.error ?? t('launch.console.injectFailed'), 'error');
      }
    } catch (e) {
      pushLog(t('launch.console.errorPrefix', { msg: String(e) }), 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRestart = async () => {
    if (!projectPath) return;
    try {
      await window.qqbat.botManager.restart(projectPath);
      pushLog(t('launch.console.restartSent'), 'result');
    } catch (e) {
      pushLog(t('launch.console.restartFailed', { msg: String(e) }), 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-950">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
        <span className="text-xs text-zinc-500">{t('launch.console.title')}</span>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => setLogs([])}>
          {t('launch.console.clear')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="px-2 py-0.5 rounded text-xs bg-yellow-700 hover:bg-yellow-600 text-white"
          onClick={handleRestart}
        >
          {t('launch.console.restart')}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs space-y-1">
        {logs.length === 0 && (
          <div className="text-zinc-600 text-center mt-8">{t('launch.console.hint')}</div>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className={`break-all ${log.type === 'sent' ? 'text-blue-400' : log.type === 'result' ? 'text-zinc-400' : 'text-red-400'}`}
          >
            {log.type === 'sent' ? '> ' : ''}
            {log.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-zinc-800 p-2 space-y-2">
        <div className="flex gap-2">
          <Dropdown
            value={chatType}
            ariaLabel={t('launch.console.messageType')}
            onChange={(v) => setChatType(v as 'c2c' | 'group')}
            options={[
              { value: 'c2c', label: t('launch.console.privateChat') },
              { value: 'group', label: t('launch.console.groupChat') },
            ]}
          />
          <input
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500"
            placeholder={t('launch.console.inputPlaceholder')}
            aria-label={t('launch.console.inputAria')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <Button
            variant="primary"
            size="md"
            onClick={handleSend}
            disabled={sending || !input.trim()}
          >
            {sending ? t('launch.common.injecting') : t('launch.console.send')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConsolePanel() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');

  if (!projectPath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title={t('launch.common.selectProject')}
          description={t('launch.console.selectProjectHint')}
        />
      </div>
    );
  }

  return <OfficialConsole projectPath={projectPath} />;
}
