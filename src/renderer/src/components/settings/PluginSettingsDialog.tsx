// src/renderer/src/components/settings/PluginSettingsDialog.tsx
import { useCallback, useEffect, useState } from 'react';
import type { PluginSettingSpec, PluginSettingValues } from '@shared/plugins/settings';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface Props {
  open: boolean;
  /** 宿主插件 id（= 清单里的 id，也是写盘时的键） */
  pluginId: string;
  pluginName: string;
  onClose: () => void;
  /** 保存成功回调：宿主列表可以顺手刷新（工具/权限不变，仅值变了） */
  onSaved?: (values: PluginSettingValues) => void;
}

const INPUT_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-sky-600';

/**
 * 插件参数表单（2026-10-25，插件表单化）。
 *
 * 表单**完全由插件清单驱动**：宿主不认识任何具体键，只认识四种类型
 * （string / number / boolean / select），所以新插件带参数不需要改这里。
 *
 * 值只在本机 userData 里（`plugins/plugin-settings.json`），不随项目走 ——
 * 同一台机器上所有项目共享一套插件配置，这与"插件属于应用、不属于项目"一致。
 */
export function PluginSettingsDialog({ open, pluginId, pluginName, onClose, onSaved }: Props) {
  useLocaleSubscription();
  const [specs, setSpecs] = useState<PluginSettingSpec[]>([]);
  const [values, setValues] = useState<PluginSettingValues>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (): Promise<void> => {
    if (!pluginId) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await window.qqbat.plugin.getSettings(pluginId);
      if (res.ok && res.data) {
        setSpecs(res.data.settings);
        setValues(res.data.values);
      } else {
        setError(res.error || t('settings.plugins.settingsLoadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.settingsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const setValue = (key: string, value: string | number | boolean): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await window.qqbat.plugin.saveSettings(pluginId, values);
      if (res.ok && res.data) {
        setValues(res.data.values);
        setNotice(t('settings.plugins.settingsSaved'));
        onSaved?.(res.data.values);
      } else {
        setError(res.error || t('settings.plugins.settingsSaveFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.plugins.settingsSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  /** 每个类型一个控件；未知类型本来就被 normalizeSettingSpecs 挡掉了 */
  const renderField = (spec: PluginSettingSpec) => {
    if (spec.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-sky-600"
            checked={values[spec.key] === true}
            onChange={(e) => setValue(spec.key, e.target.checked)}
          />
          <span>{spec.label}</span>
        </label>
      );
    }
    if (spec.type === 'select') {
      const current = String(values[spec.key] ?? spec.default ?? '');
      return (
        <>
          <label className="mb-1 block text-xs text-zinc-300">{spec.label}</label>
          <select
            className={INPUT_CLASS}
            value={current}
            onChange={(e) => setValue(spec.key, e.target.value)}
          >
            {(spec.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label ?? opt.value}
              </option>
            ))}
          </select>
        </>
      );
    }
    if (spec.type === 'number') {
      const current = typeof values[spec.key] === 'number' ? String(values[spec.key]) : '';
      return (
        <>
          <label className="mb-1 block text-xs text-zinc-300">{spec.label}</label>
          <input
            type="number"
            className={INPUT_CLASS}
            value={current}
            placeholder={
              typeof spec.default === 'number'
                ? String(spec.default)
                : t('settings.plugins.settingsNoDefault')
            }
            onChange={(e) => setValue(spec.key, e.target.value === '' ? '' : Number(e.target.value))}
          />
        </>
      );
    }
    return (
      <>
        <label className="mb-1 block text-xs text-zinc-300">{spec.label}</label>
        <input
          type="text"
          className={INPUT_CLASS}
          value={String(values[spec.key] ?? '')}
          placeholder={
            typeof spec.default === 'string' ? spec.default : t('settings.plugins.settingsNoDefault')
          }
          onChange={(e) => setValue(spec.key, e.target.value)}
        />
      </>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.plugins.settingsTitle', { name: pluginName })}
      width="420px"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('settings.plugins.settingsCancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={loading || saving || specs.length === 0}
            onClick={() => void save()}
          >
            {t('settings.plugins.settingsSave')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-zinc-500">{t('settings.plugins.settingsSubtitle')}</p>
      {error && (
        <div className="mb-3 rounded border border-red-800/40 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded border border-green-800/40 bg-green-900/20 px-3 py-2 text-sm text-green-400">
          {notice}
        </div>
      )}
      {loading ? (
        <div className="py-6 text-center text-sm text-zinc-500">
          {t('editor.action.loading')}
        </div>
      ) : specs.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          {t('settings.plugins.settingsEmpty')}
        </p>
      ) : (
        <div className="space-y-3">
          {specs.map((spec) => (
            <div key={spec.key}>
              {spec.type === 'boolean' ? null : spec.description && (
                <p className="mb-1 text-[11px] text-zinc-500">{spec.description}</p>
              )}
              {renderField(spec)}
              {spec.type === 'boolean' && spec.description && (
                <p className="mt-1 pl-5 text-[11px] text-zinc-500">{spec.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
