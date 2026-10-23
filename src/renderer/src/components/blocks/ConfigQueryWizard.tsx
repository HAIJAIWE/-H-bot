// src/renderer/src/components/blocks/ConfigQueryWizard.tsx
//
// 「查表指令」向导：把「命令词 + 配置表 + 字段」变成一条能跑的链
// （`/技能 火球术` → 去 skills 表里查 火球术 → 回复它的说明）。
//
// 这是 docs/architecture/large-project-design.md 里"数据驱动"那一步的入口：
// 100 个技能 = 1 条链 + 100 行数据，而不是 100 条链。
//
// 表编辑器的入口在「启动 → 配置编辑」，离画布很远 —— 所以这里**必须**同时给出
// "去建表/改表"的跳转，否则用户看到"选配置表"却不知道表在哪（文档 §七 的提醒）。
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Package, Settings2 } from 'lucide-react';
import { Modal, ModalFooter } from '../ui/Modal';
import { Dropdown } from '../ui/Dropdown';
import { Button } from '../ui/Button';
import { useProjectStore } from '../../stores/projectStore';
import { useUiStore } from '../../stores/uiStore';
import {
  buildConfigQueryChain,
  isConfigQueryReady,
  type ConfigQueryInput,
} from '../../lib/command/configQueryChain';
import { normalizeCommand } from '../../lib/command/commandWizard';
import type { ConfigCategory, FieldSchema, TableSchema } from '@shared/types/launch';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export function ConfigQueryWizard({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (input: ConfigQueryInput) => void;
}) {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');

  const [command, setCommand] = useState('');
  const [table, setTable] = useState('');
  const [field, setField] = useState('');
  const [matchField, setMatchField] = useState('');
  const [reply, setReply] = useState('');

  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [schema, setSchema] = useState<TableSchema[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开都重新拉表列表：用户可能刚在配置编辑里建了表
  useEffect(() => {
    if (!open || !projectPath) return;
    setLoading(true);
    setError(null);
    window.qqbat.launchConfig
      .listCategories(projectPath)
      .then((res) => {
        if (res.ok && res.data) setCategories(res.data);
        else setError(res.error || t('blocks.configApi.loadCategoriesFailed'));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, projectPath]);

  // 选定表后拉字段
  useEffect(() => {
    if (!open || !projectPath || !table) {
      setSchema(null);
      return;
    }
    setLoading(true);
    setError(null);
    window.qqbat.launchConfig
      .getSchema(projectPath, table)
      .then((res) => {
        if (res.ok && res.data) {
          setSchema(res.data);
          // 换表后原来的字段可能不存在了，清掉避免生成无效绑定
          const names = new Set(res.data.flatMap((s) => s.fields.map((f) => f.name)));
          if (field && !names.has(field)) setField('');
          if (matchField && !names.has(matchField)) setMatchField('');
        } else {
          setError(res.error || t('blocks.configApi.loadSchemaFailed'));
          setSchema(null);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSchema(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在换表时校验字段有效性
  }, [open, projectPath, table]);

  const fieldOptions = useMemo(() => {
    if (!schema) return [];
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const s of schema) {
      for (const f of s.fields as FieldSchema[]) {
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        options.push({ value: f.name, label: f.label ? `${f.name}（${f.label}）` : f.name });
      }
    }
    return options;
  }, [schema]);

  const selectedCategory = categories.find((c) => c.name === table);
  const dbPath = selectedCategory ? `data/config/${selectedCategory.file}` : '';

  const input: ConfigQueryInput = { command, table, dbPath, field, matchField, reply };
  const ready = isConfigQueryReady(input);
  const cmd = normalizeCommand(command);
  // 依赖逐个列出（而不是整个 input 对象）：对象每次渲染都是新的，会让 useMemo 完全失效
  const chain = useMemo(
    () => buildConfigQueryChain({ command, table, dbPath, field, matchField, reply }),
    [command, table, dbPath, field, matchField, reply],
  );

  /** 画布 → 配置表的桥：跳到「启动 → 配置编辑」（表编辑器所在处） */
  const openConfigPanel = () => {
    onCancel();
    useUiStore.getState().setLaunchTab('config');
    useUiStore.getState().setMode('launch');
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('blocks.configQuery.title')}
      width="560px"
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
        <div className="text-xs text-zinc-500 leading-relaxed bg-zinc-800/50 rounded p-2">
          {t('blocks.configQuery.introPrefix')}
          <span className="text-zinc-300">{t('blocks.configQuery.table')}</span>
          {t('blocks.configQuery.introSuffix')}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">{t('blocks.configQuery.commandLabel')}</label>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
              /
            </span>
            <input
              autoFocus
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('blocks.configQuery.commandPlaceholder')}
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="text-xs text-zinc-500">
            {cmd ? (
              <>
                {t('blocks.configQuery.triggerPrefix')}{' '}
                <span className="text-zinc-300">
                  {t('blocks.configQuery.triggerExample', { cmd })}
                </span>{' '}
                {t('blocks.configQuery.triggerSuffix')}
              </>
            ) : (
              t('blocks.wizard.commandHint')
            )}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-400">
              {t('blocks.configQuery.tableLabel')} <span className="text-red-400">*</span>
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400 hover:text-zinc-200"
              leftIcon={<Settings2 className="w-3 h-3" />}
              onClick={openConfigPanel}
              title={t('blocks.configQuery.openConfigTitle')}
            >
              {t('blocks.configQuery.openConfig')}
            </Button>
          </div>
          {!loading && categories.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-800/60 rounded p-2">
              <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t('blocks.configQuery.noTables')}</span>
            </div>
          ) : (
            <Dropdown
              value={table}
              onChange={setTable}
              options={categories.map((c) => ({
                value: c.name,
                label: c.displayName ? `${c.displayName}（${c.name}）` : c.name,
              }))}
              placeholder={loading ? t('editor.action.loading') : t('blocks.configApi.selectTable')}
              disabled={loading}
              className="w-full"
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">
              {t('blocks.configQuery.fieldLabel')} <span className="text-red-400">*</span>
            </label>
            <Dropdown
              value={field}
              onChange={setField}
              options={fieldOptions}
              placeholder={
                schema ? t('blocks.configApi.selectField') : t('blocks.configApi.selectTableFirst')
              }
              disabled={!schema}
              className="w-full"
            />
            <p className="text-xs text-zinc-500">
              {t('blocks.configQuery.fieldHint')} {'{var1}'}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">
              {t('blocks.configQuery.matchFieldLabel')}
            </label>
            <Dropdown
              value={matchField}
              onChange={setMatchField}
              options={[{ value: '', label: t('blocks.configQuery.noFilter') }, ...fieldOptions]}
              placeholder={t('blocks.configQuery.matchFieldPlaceholder')}
              disabled={!schema}
              className="w-full"
            />
            <p className="text-xs text-zinc-500">
              {matchField
                ? t('blocks.configQuery.matchHint', { field: matchField })
                : t('blocks.configQuery.matchFieldHint')}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">{t('blocks.configQuery.replyLabel')}</label>
          <textarea
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="【{var2}】{var1}"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <button
              type="button"
              className="px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => setReply((v) => `${v}{var1}`)}
              title={t('blocks.configQuery.insertVar1Title')}
            >
              {t('common.insert')} {'{var1}'}
            </button>
            <button
              type="button"
              className="px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => setReply((v) => `${v}{var2}`)}
              title={t('blocks.configQuery.insertVar2Title')}
            >
              {t('common.insert')} {'{var2}'}
            </button>
            <span>{t('blocks.configQuery.varLegend', { v1: '{var1}', v2: '{var2}' })}</span>
          </div>
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-400">
          {t('blocks.configQuery.autoCreate')}{' '}
          <span className="text-zinc-200">
            {t('blocks.configQuery.nodeCount', { count: chain.nodes.length })}
          </span>
          <span className="text-zinc-200">
            {t('blocks.configQuery.edgeCount', { count: chain.edges.length })}
          </span>
          {chain.configApiEdges.length > 0 && (
            <>
              {t('blocks.configQuery.andBindings')}
              <span className="text-amber-300">
                {t('blocks.configQuery.bindingCount', { count: chain.configApiEdges.length })}
              </span>
            </>
          )}
          {t('blocks.configQuery.summarySeparator')}
          <span className="text-zinc-300">
            {' '}
            {cmd ? `/${cmd}` : '/…'} {t('blocks.configQuery.takeParam')}{' '}
            {table || t('blocks.configQuery.table')}
            {field ? `.${field}` : ''} {t('blocks.configQuery.replyStep')}
          </span>
          {t('blocks.configQuery.noManualWork')}
        </div>
      </div>
    </Modal>
  );
}
