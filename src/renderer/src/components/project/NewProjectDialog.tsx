import { useState, useCallback } from 'react';
import type { ProjectMeta } from '@shared/types/project';
import { BOT_TYPES, type BotType } from '@shared/domain/project/botTypeConfig';
import { Dropdown } from '../ui/Dropdown';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { inputForm } from '../ui/inputStyles';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// 机器人类型的选项**只有 shared/domain/project/botTypeConfig.ts 一处定义**。
// 以前这里另写了一份（还承诺"签到/积分/RPG/修仙"），但选完建出来的永远是空画布 ——
// 文案与行为不符，用户以为工具坏了。现在统一引用，描述只讲它真正影响什么。

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (meta: ProjectMeta) => void;
}

/** 文件系统不允许的字符 */
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * 非法字符提示。写成函数而不是模块级常量：常量在 import 时求值一次，
 * 切语言不会重算，用户会看到上一次语言的提示。
 */
function invalidNameHint(): string {
  return t('launch.newProject.invalidChars');
}

export function NewProjectDialog({ open, onClose, onCreated }: Props) {
  useLocaleSubscription();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  // 默认「QQ 官方机器人」：这是本工具的主场景（节点库会只显示 QQ 相关节点 ✓）
  const [botType, setBotType] = useState<BotType>('qq');

  // 实时校验：输入时即检查非法字符。
  // 不用 useMemo 缓存：提示语要跟随界面语言，缓存反而会留下上一次语言的旧提示。
  const nameError = name && INVALID_NAME_CHARS.test(name) ? invalidNameHint() : '';

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('launch.newProject.nameRequired'));
      return;
    }
    if (INVALID_NAME_CHARS.test(trimmed)) {
      setError(invalidNameHint());
      return;
    }
    setLoading(true);
    setError('');
    if (!window.qqbat?.project) {
      setError(t('launch.newProject.notReady'));
      setLoading(false);
      return;
    }
    try {
      const res = await window.qqbat.project.create({
        name: trimmed,
        adapter: 'official',
        botType: botType,
      });
      if (!res.ok) {
        setError(res.error || t('launch.common.createFailed'));
        return;
      }
      onCreated(res.data as ProjectMeta);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('launch.common.createFailed'));
    } finally {
      setLoading(false);
    }
  }, [name, botType, onCreated]);

  return (
    <Modal open={open} onClose={onClose} title={t('launch.newProject.title')} width="400px">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">
            {t('launch.newProject.name')} <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('launch.newProject.namePlaceholder')}
            className={`w-full px-3 ${inputForm} placeholder-zinc-600 focus:border-blue-600`}
            autoFocus
          />
          {nameError && <div className="mt-1 text-xs text-red-400">{nameError}</div>}
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">
            {t('launch.config.botType')} <span className="text-red-400">*</span>
          </label>
          <Dropdown
            value={botType}
            ariaLabel={t('launch.config.botType')}
            onChange={(v) => setBotType(v as BotType)}
            options={BOT_TYPES.map(function (opt) {
              return { value: opt.value, label: t(`launch.botType.${opt.value}`) };
            })}
          />
          <div className="mt-1 text-xs text-zinc-500">{t(`launch.botType.${botType}Desc`)}</div>
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded">{error}</div>
        )}

        <Button
          variant="primary"
          size="lg"
          onClick={handleSubmit}
          disabled={loading || !name.trim() || !!nameError}
          className="w-full"
        >
          {loading ? t('launch.common.creating') : t('launch.newProject.create')}
        </Button>
      </div>
    </Modal>
  );
}
