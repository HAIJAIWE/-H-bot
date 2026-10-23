// src/renderer/src/components/blocks/NewCommandWizard.tsx
//
// 「新建指令」向导：填三样（命令词 / 回复内容 / 要不要记数据）就得到一条能跑的指令。
// 节点与连线由 `lib/command/commandWizard.ts` 生成后交给 store 一次性铺好 —— 用户全程不碰画布。
import { useMemo, useState } from 'react';
import { Modal, ModalFooter } from '../ui/Modal';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import {
  buildCommandChain,
  DEFAULT_DATA_KEY,
  isCommandWizardReady,
  isValidDataKey,
  normalizeCommand,
  type CommandDataMode,
  type CommandWizardInput,
} from '../../lib/command/commandWizard';

const DATA_MODES: Array<{ value: CommandDataMode; label: string; hint: string }> = [
  {
    value: 'none',
    get label() {
      return t('blocks.wizard.step.none');
    },
    get hint() {
      return t('blocks.wizard.step.noneDesc');
    },
  },
  {
    value: 'increment',
    get label() {
      return t('blocks.wizard.step.increment');
    },
    get hint() {
      return t('blocks.wizard.step.incrementDesc');
    },
  },
  {
    value: 'read',
    get label() {
      return t('blocks.wizard.step.read');
    },
    get hint() {
      return t('blocks.wizard.step.readDesc');
    },
  },
];

export function NewCommandWizard({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (input: CommandWizardInput) => void;
}) {
  useLocaleSubscription();
  const [command, setCommand] = useState('');
  const [reply, setReply] = useState('');
  const [dataMode, setDataMode] = useState<CommandDataMode>('none');
  const [dataKey, setDataKey] = useState(DEFAULT_DATA_KEY);

  const input: CommandWizardInput = { command, reply, dataMode, dataKey };
  const ready = isCommandWizardReady(input);
  const cmd = normalizeCommand(command);
  const needsValue = dataMode !== 'none';
  // 预览里报的节点/连线数与真正生成的一致（同一个函数）
  const chain = useMemo(
    () => buildCommandChain({ command, reply, dataMode, dataKey }),
    [command, reply, dataMode, dataKey],
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('blocks.editor.wizard.command')}
      width="520px"
      footer={
        <ModalFooter
          onCancel={onCancel}
          onConfirm={() => onConfirm(input)}
          cancelText={t('editor.action.cancel')}
          confirmText={t('blocks.wizard.create')}
          confirmDisabled={!ready}
        />
      }
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">{t('blocks.wizard.commandLabel')}</label>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
              /
            </span>
            <input
              autoFocus
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('blocks.wizard.commandPlaceholder')}
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="text-xs text-zinc-500">
            {cmd ? (
              <>
                {t('blocks.wizard.triggerPrefix')} <span className="text-zinc-300">/{cmd}</span>{' '}
                {t('blocks.wizard.triggerSuffix')}
              </>
            ) : (
              t('blocks.wizard.commandHint')
            )}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">{t('blocks.wizard.replyLabel')}</label>
          <textarea
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={
              needsValue
                ? t('blocks.wizard.replyPlaceholder')
                : t('blocks.wizard.replyPlaceholderSimple')
            }
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500 resize-none"
          />
          {needsValue && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>
                {t('blocks.wizard.varHintPrefix')} <span className="text-zinc-300">{'{var1}'}</span>{' '}
                {t('blocks.wizard.varHintSuffix')}
              </span>
              <button
                type="button"
                className="px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                onClick={() => setReply((v) => `${v}{var1}`)}
              >
                {t('common.insert')} {'{var1}'}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">{t('blocks.wizard.dataLabel')}</label>
          <div className="grid grid-cols-3 gap-1.5">
            {DATA_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setDataMode(m.value)}
                className={`px-2 py-1.5 rounded border text-xs transition-colors ${
                  dataMode === m.value
                    ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            {DATA_MODES.find((m) => m.value === dataMode)!.hint}
          </p>
          {needsValue && (
            <>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-zinc-400 shrink-0">
                  {t('blocks.wizard.dataName')}
                </span>
                <input
                  value={dataKey}
                  onChange={(e) => setDataKey(e.target.value)}
                  placeholder={DEFAULT_DATA_KEY}
                  className={`flex-1 px-2 py-1.5 bg-zinc-800 border rounded text-xs text-zinc-200 focus:outline-none ${
                    isValidDataKey(dataKey)
                      ? 'border-zinc-700 focus:border-blue-500'
                      : 'border-red-600/60 focus:border-red-500'
                  }`}
                />
              </div>
              {isValidDataKey(dataKey) ? (
                <p className="text-xs text-zinc-500">
                  {t('blocks.wizard.sameDataPrefix')}{' '}
                  <span className="text-zinc-300"> {dataKey.trim()} </span>{' '}
                  {t('blocks.wizard.sameDataSuffix')}
                </p>
              ) : (
                <p className="text-xs text-red-400">{t('blocks.wizard.dataNameHint')}</p>
              )}
            </>
          )}
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-400">
          {t('blocks.wizard.autoCreatePrefix')}{' '}
          <span className="text-zinc-200">
            {t('blocks.wizard.autoCreateNodes', { count: chain.nodes.length })}
          </span>
          {chain.edges.length > 0 && (
            <span>
              {t('blocks.wizard.autoCreateAnd')}
              <span className="text-zinc-200">
                {t('blocks.wizard.autoCreateEdges', { count: chain.edges.length })}
              </span>
            </span>
          )}
          {t('blocks.wizard.autoCreateColon')}
          <span className="text-zinc-300">
            {' '}
            {cmd ? `/${cmd}` : '/…'} → {needsValue ? t('blocks.wizard.willStore') : ''}
            {t('blocks.wizard.autoCreateReply')}
          </span>
          {t('blocks.wizard.autoCreateSuffix')}
        </div>
      </div>
    </Modal>
  );
}
