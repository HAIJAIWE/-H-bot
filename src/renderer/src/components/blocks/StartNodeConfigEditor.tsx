// src/renderer/src/components/blocks/StartNodeConfigEditor.tsx
import { Dropdown } from '../ui/Dropdown';
import { inputSm } from '../ui/inputStyles';
import { SubflowParamsEditor } from './SubflowParamsEditor';
import { DebouncedTextInput } from './DebouncedInputs';
import { useFlowStore } from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 触发器类型选项 */
const TRIGGER_TYPE_OPTIONS = [
  {
    value: 'message_received',
    get label() {
      return t('canvas.summary.triggerMessageReceived');
    },
  },
  {
    value: 'scheduled',
    get label() {
      return t('canvas.summary.triggerScheduled');
    },
  },
  {
    value: 'request_received',
    get label() {
      return t('blocks.startNode.triggerRequest');
    },
  },
  {
    value: 'notice_received',
    get label() {
      return t('blocks.startNode.triggerNotice');
    },
  },
  {
    value: 'subflow_defined',
    get label() {
      return t('canvas.summary.triggerSubflowDefined');
    },
  },
];

/**
 * 各触发器类型的默认 trigger_config。
 * 与 builtinCatalog 各触发器节点 defaultConfig 保持一致。
 * 切换 trigger_type 时重置 trigger_config 为对应默认值，避免旧字段残留。
 */
const TRIGGER_TYPE_DEFAULTS: Record<string, Record<string, unknown>> = {
  message_received: {
    match: 'any',
    message_type: 'any',
    command: '',
    prefix: '/',
    keywords: [],
    pattern: '',
    flags: '',
  },
  scheduled: { cron: '0 * * * *', interval_seconds: 0 },
  request_received: {},
  notice_received: {},
  subflow_defined: {},
};

const MATCH_OPTIONS = [
  {
    value: 'any',
    get label() {
      return t('blocks.startNode.matchAny');
    },
  },
  {
    value: 'at_me',
    get label() {
      return t('canvas.summary.atMe');
    },
  },
  {
    value: 'command',
    get label() {
      return t('blocks.startNode.matchCommand');
    },
  },
  {
    value: 'keyword',
    get label() {
      return t('field.label.keywords');
    },
  },
  {
    value: 'regex',
    get label() {
      return t('blocks.startNode.matchRegex');
    },
  },
];

const MESSAGE_TYPE_OPTIONS = [
  {
    value: 'any',
    get label() {
      return t('editor.filter.all');
    },
  },
  {
    value: 'group',
    get label() {
      return t('blocks.startNode.msgGroup');
    },
  },
  {
    value: 'private',
    get label() {
      return t('launch.console.privateChat');
    },
  },
];

/**
 * start_node 专属编辑器：三段式布局。
 * 1. 触发器类型下拉（trigger_type）
 * 2. 动态触发参数表（trigger_config，按 trigger_type 切换字段）
 * 3. 子流程参数编辑器（仅 subflow_defined 模式，复用 SubflowParamsEditor）
 *
 * trigger_config 是嵌套 object，必须整体替换回写（updateNodeConfig 浅合并）。
 * trigger_type 切换时重置 trigger_config 为对应默认值。
 */
export function StartNodeConfigEditor({
  config,
  nodeId,
  onConfigChange,
}: {
  config: Record<string, unknown>;
  nodeId?: string;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  useLocaleSubscription();
  const triggerType = String(config.trigger_type ?? 'message_received');
  const triggerConfig = (config.trigger_config ?? {}) as Record<string, unknown>;

  // 切换触发器类型：重置 trigger_config 为对应默认值，避免旧类型字段污染新类型
  const handleTypeChange = (newType: string) => {
    onConfigChange({
      trigger_type: newType,
      trigger_config: { ...(TRIGGER_TYPE_DEFAULTS[newType] ?? {}) },
    });
  };

  // 更新 trigger_config 的单个字段：必须整体替换 trigger_config（updateNodeConfig 浅合并）
  const updateTriggerConfig = (key: string, value: unknown) => {
    onConfigChange({
      trigger_config: { ...triggerConfig, [key]: value },
    });
  };

  /** 防抖提交路径：从 store 读最新 trigger_config 合并单键，避免旧闭包覆盖其他字段（C 修复） */
  const commitTriggerConfigFromStore = (key: string, value: unknown) => {
    if (!nodeId) return;
    const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const latest = (node.data.config?.trigger_config ?? {}) as Record<string, unknown>;
    onConfigChange({
      trigger_config: { ...latest, [key]: value },
    });
  };

  return (
    <div className="space-y-3">
      {/* 触发器类型 */}
      <div className="space-y-1">
        <label className="text-xs text-zinc-300">{t('blocks.startNode.triggerType')}</label>
        <Dropdown
          value={triggerType}
          ariaLabel={t('blocks.startNode.triggerType')}
          onChange={handleTypeChange}
          options={TRIGGER_TYPE_OPTIONS}
          className="w-full"
        />
      </div>

      {/* ===== 动态触发参数（按 trigger_type 切换） ===== */}
      {triggerType === 'message_received' && (
        <div className="space-y-2 pl-2 border-l-2 border-zinc-700">
          <div className="text-xs text-zinc-500">{t('blocks.startNode.matchSection')}</div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-300">{t('blocks.startNode.matchMode')}</label>
            <Dropdown
              value={String(triggerConfig.match ?? 'any')}
              ariaLabel={t('blocks.startNode.matchMode')}
              onChange={(v) => updateTriggerConfig('match', v)}
              options={MATCH_OPTIONS}
              className="w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-300">{t('field.label.message_type')}</label>
            <Dropdown
              value={String(triggerConfig.message_type ?? 'any')}
              ariaLabel={t('field.label.message_type')}
              onChange={(v) => updateTriggerConfig('message_type', v)}
              options={MESSAGE_TYPE_OPTIONS}
              className="w-full"
            />
          </div>
          {String(triggerConfig.match ?? '') === 'command' && (
            <div className="space-y-1">
              <label className="text-xs text-zinc-300">{t('blocks.startNode.commandLabel')}</label>
              <DebouncedTextInput
                value={String(triggerConfig.command ?? '')}
                onChange={(v) => commitTriggerConfigFromStore('command', v)}
                placeholder={t('blocks.startNode.commandPlaceholder')}
                ariaLabel={t('blocks.startNode.command')}
                className={`w-full ${inputSm}`}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-zinc-300">{t('blocks.startNode.prefixLabel')}</label>
            <DebouncedTextInput
              value={String(triggerConfig.prefix ?? '/')}
              onChange={(v) => commitTriggerConfigFromStore('prefix', v)}
              placeholder="/"
              ariaLabel={t('blocks.startNode.prefixLabel')}
              className={`w-full ${inputSm}`}
            />
          </div>
          {String(triggerConfig.match ?? '') === 'keyword' && (
            <div className="space-y-1">
              <label className="text-xs text-zinc-300">{t('blocks.startNode.keywordsLabel')}</label>
              <DebouncedTextInput
                value={
                  Array.isArray(triggerConfig.keywords)
                    ? (triggerConfig.keywords as string[]).join(',')
                    : ''
                }
                onChange={(v) =>
                  commitTriggerConfigFromStore(
                    'keywords',
                    v
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                placeholder={t('blocks.startNode.keywordsPlaceholder')}
                ariaLabel={t('field.label.keywords')}
                className={`w-full ${inputSm}`}
              />
            </div>
          )}
          {String(triggerConfig.match ?? '') === 'regex' && (
            <>
              <div className="space-y-1">
                <label className="text-xs text-zinc-300">{t('field.label.pattern')}</label>
                <DebouncedTextInput
                  value={String(triggerConfig.pattern ?? '')}
                  onChange={(v) => commitTriggerConfigFromStore('pattern', v)}
                  placeholder={t('blocks.startNode.patternPlaceholder')}
                  ariaLabel={t('field.label.pattern')}
                  className={`w-full ${inputSm} font-mono`}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-300">{t('blocks.startNode.flagsLabel')}</label>
                <DebouncedTextInput
                  value={String(triggerConfig.flags ?? '')}
                  onChange={(v) => commitTriggerConfigFromStore('flags', v)}
                  placeholder={t('blocks.startNode.flagsPlaceholder')}
                  ariaLabel={t('blocks.startNode.flagsLabel')}
                  className={`w-full ${inputSm} font-mono`}
                />
              </div>
            </>
          )}
        </div>
      )}

      {triggerType === 'scheduled' && (
        <div className="space-y-2 pl-2 border-l-2 border-zinc-700">
          <div className="text-xs text-zinc-500">{t('blocks.startNode.scheduleSection')}</div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-300">{t('blocks.startNode.cronLabel')}</label>
            <DebouncedTextInput
              value={String(triggerConfig.cron ?? '0 * * * *')}
              onChange={(v) => commitTriggerConfigFromStore('cron', v)}
              placeholder="0 * * * *"
              ariaLabel={t('blocks.startNode.cronLabel')}
              className={`w-full ${inputSm} font-mono`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-300">{t('blocks.startNode.intervalLabel')}</label>
            <DebouncedTextInput
              type="number"
              step="any"
              value={
                triggerConfig.interval_seconds == null || triggerConfig.interval_seconds === ''
                  ? ''
                  : String(Number(triggerConfig.interval_seconds))
              }
              onChange={(v) =>
                commitTriggerConfigFromStore('interval_seconds', v === '' ? undefined : Number(v))
              }
              ariaLabel={t('field.label.interval_seconds')}
              className={`w-full ${inputSm}`}
            />
          </div>
        </div>
      )}

      {triggerType === 'request_received' && (
        <div className="text-xs text-zinc-500 italic pl-2 border-l-2 border-zinc-700">
          {t('blocks.startNode.requestNote')}
        </div>
      )}

      {triggerType === 'notice_received' && (
        <div className="text-xs text-zinc-500 italic pl-2 border-l-2 border-zinc-700">
          {t('blocks.startNode.noticeNote')}
        </div>
      )}

      {triggerType === 'subflow_defined' && (
        <div className="space-y-2 pl-2 border-l-2 border-zinc-700">
          <div className="text-xs text-zinc-500">{t('blocks.startNode.subflowParamsSection')}</div>
          <SubflowParamsEditor config={config} nodeId={nodeId} onConfigChange={onConfigChange} />
        </div>
      )}
    </div>
  );
}
