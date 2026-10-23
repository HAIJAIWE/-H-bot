// src/renderer/src/components/ai/PresetEditor.tsx
//
// **会话预设编辑**（2026-10-19）：直接编辑 .qqbat/agent-presets.json 的 JSON。
//
// 为什么用 JSON 而不是一堆复选框：预设是**权限配置**，字段还在演进（tools/plugins/permissionMode），
// 复选框界面会把"还没做的字段"藏起来，反而更容易配错；JSON + 保存时校验 + 警告更诚实。
// 保存走主进程 ai:savePresets（写入前归一化/去重；未知工具/插件回 warnings，不拒绝 ——
// 预设允许"先写、后装"）。
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const PRESETS_FILE = '.qqbat/agent-presets.json';

export function PresetEditor({
  open,
  projectPath,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectPath: string | undefined;
  onClose: () => void;
  /** 保存成功后通知调用方刷新预设列表 */
  onSaved: () => void;
}): React.ReactNode {
  useLocaleSubscription();
  const [text, setText] = useState('[]');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !projectPath) return;
    setError('');
    setWarnings([]);
    void (async () => {
      const res = await window.qqbat.file.read(projectPath, PRESETS_FILE);
      if (res.ok && typeof res.data === 'string') {
        try {
          setText(JSON.stringify(JSON.parse(res.data), null, 2));
        } catch {
          setText(res.data); // 坏文件原样显示，让用户自己修
        }
      } else {
        setText('[\n  { "name": "read-only", "allowedTools": ["read_file", "list_dir"] }\n]');
      }
    })();
  }, [open, projectPath]);

  const save = async (): Promise<void> => {
    if (!projectPath) return;
    setError('');
    setWarnings([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(
        t('ai.agentCore.presetInvalidJson', { message: e instanceof Error ? e.message : '' }),
      );
      return;
    }
    if (!Array.isArray(parsed)) {
      setError(t('ai.agentCore.presetMustBeArray'));
      return;
    }
    setSaving(true);
    try {
      const res = await window.qqbat.ai.savePresets(
        projectPath,
        parsed as Array<{
          name: string;
          allowedTools?: string[];
          plugins?: string[];
          permissionMode?: 'ask' | 'full';
          description?: string;
        }>,
      );
      if (!res.ok) {
        setError(res.error ?? t('ai.agentCore.presetMustBeArray'));
        return;
      }
      onSaved();
      if (res.data && res.data.warnings.length > 0) {
        setWarnings(res.data.warnings);
        return; // 有警告就不关窗：让用户看见再决定
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('ai.agentCore.presetEditTitle')} width="640px">
      <p className="mb-2 text-xs text-zinc-500">{t('ai.agentCore.presetEditHint')}</p>
      <textarea
        className="h-64 w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-200"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label={t('ai.agentCore.presetEditTitle')}
      />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-300">
          {w}
        </p>
      ))}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
