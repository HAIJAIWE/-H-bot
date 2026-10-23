// src/renderer/src/components/blocks/ConfigApiPicker.tsx
// 配置 API 绑定选择器：让用户选配置表 + 字段 + 可选 WHERE 条件 + 参数来源
// 选中后通过 onConfirm 回传 ConfigApiBinding，由调用方创建 __config_api__ 边

import { useEffect, useMemo, useState } from 'react';
import type { FlowNode, FlowEdge, ConfigApiBinding } from '@shared/types/flow';
import { isNamedVarRef, optionValueToRef, refToOptionValue } from '@shared/nodes/varRef';
import { useProjectStore } from '../../stores/projectStore';
import { useFlowStore } from '../../stores/flowStore';
import { findEnclosingSubflowId, namedVariablesOf } from '../../lib/expression/variableRegistry';
import { buildParamSourceOptions } from '../../lib/expression/paramSourceOptions';
import { Modal, ModalFooter } from '../ui/Modal';
import { Dropdown } from '../ui/Dropdown';
import { inputFormSm } from '../ui/inputStyles';
import { collectBindingOptions } from './DataBindingSelect';
import type { ConfigCategory, TableSchema } from '@shared/types/launch';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface ConfigApiPickerProps {
  currentNodeId: string;
  portId: string;
  upstreamNodes: FlowNode[];
  edges: FlowEdge[];
  initial?: ConfigApiBinding;
  onConfirm: (api: ConfigApiBinding) => void;
  onCancel: () => void;
}

/** WHERE 参数来源选项（上游节点的数据输出端口 或 命名变量） */
type ParamRefOption = ReturnType<typeof buildParamSourceOptions>[number];

export function ConfigApiPicker({
  currentNodeId,
  portId: _portId,
  upstreamNodes,
  edges,
  initial,
  onConfirm,
  onCancel,
}: ConfigApiPickerProps) {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const flowNodes = useFlowStore((s) => s.nodes);

  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [schema, setSchema] = useState<TableSchema[] | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单状态
  const [tableName, setTableName] = useState(initial?.table ?? '');
  const [fieldName, setFieldName] = useState(initial?.field ?? '');
  const [where, setWhere] = useState(initial?.where ?? '');
  const [paramRefValue, setParamRefValue] = useState(
    initial?.whereParamRef ? refToOptionValue(initial.whereParamRef) : '',
  );
  /** 查询方式：取一个字段 / 取一行对象 / 取全部行 */
  const [mode, setMode] = useState<NonNullable<ConfigApiBinding['mode']>>(initial?.mode ?? 'query');
  /** 排序子句：'' = 取第一行；'RANDOM()' = 随机一行；'列名 ASC|DESC' = 按列排序 */
  const [order, setOrder] = useState(initial?.order ?? '');

  // 加载配置表列表
  useEffect(() => {
    if (!projectPath) return;
    setLoadingCats(true);
    setError(null);
    window.qqbat.launchConfig
      .listCategories(projectPath)
      .then((res) => {
        if (res.ok && res.data) {
          setCategories(res.data);
        } else {
          setError(res.error || t('blocks.configApi.loadCategoriesFailed'));
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingCats(false));
  }, [projectPath]);

  // 当选定表时，加载 schema
  useEffect(() => {
    if (!projectPath || !tableName) {
      setSchema(null);
      return;
    }
    setLoadingSchema(true);
    setError(null);
    window.qqbat.launchConfig
      .getSchema(projectPath, tableName)
      .then((res) => {
        if (res.ok && res.data) {
          setSchema(res.data);
          // 切换表时清空字段选择
          if (fieldName && !res.data.some((s) => s.fields.some((f) => f.name === fieldName))) {
            setFieldName('');
          }
        } else {
          setError(res.error || t('blocks.configApi.loadSchemaFailed'));
          setSchema(null);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSchema(null);
      })
      .finally(() => setLoadingSchema(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在切换表时校验 fieldName 有效性，fieldName 变化不应重拉 schema
  }, [projectPath, tableName]);

  // 参数来源选项：上游节点输出端口 + 命名变量（子流程参数按作用域过滤）
  const enclosingSubflowId = useMemo(
    () => findEnclosingSubflowId(currentNodeId, flowNodes, edges),
    [currentNodeId, flowNodes, edges],
  );
  const namedVariables = useMemo(() => namedVariablesOf(flowNodes), [flowNodes]);

  const paramRefOptions: ParamRefOption[] = useMemo(
    () =>
      buildParamSourceOptions({
        portOptions: collectBindingOptions(upstreamNodes).map((opt) => ({
          value: `${opt.nodeId}:${opt.portId}`,
          label: opt.label,
        })),
        namedVariables,
        enclosingSubflowId,
      }),
    [upstreamNodes, namedVariables, enclosingSubflowId],
  );

  // 字段选项：从 schema 提取所有字段（跨多张表合并，通常配置库每个 .db 只有一张表）
  const fieldOptions = useMemo(() => {
    if (!schema) return [];
    const fields = schema.flatMap((s) => s.fields);
    // 去重（同名字段只显示一次）
    const seen = new Set<string>();
    return fields
      .filter((f) => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      })
      .map((f) => ({
        value: f.name,
        label: f.label ? `${f.name}（${f.label}）` : f.name,
      }));
  }, [schema]);

  // 当前选中的配置表对象（用于获取 file 字段，构造 dbPath）
  const selectedCategory = categories.find((c) => c.name === tableName);
  const dbPath = selectedCategory ? `data/config/${selectedCategory.file}` : '';

  /** 排序选项：不排序 / 随机一行 / 按各字段升降序 */
  const orderOptions = useMemo(() => {
    const opts = [
      { value: '', label: t('blocks.configApi.orderNone') },
      { value: 'RANDOM()', label: t('blocks.configApi.orderRandom') },
    ];
    for (const f of fieldOptions) {
      opts.push({
        value: `${f.value} ASC`,
        label: t('blocks.configApi.orderAsc', { field: f.label }),
      });
      opts.push({
        value: `${f.value} DESC`,
        label: t('blocks.configApi.orderDesc', { field: f.label }),
      });
    }
    return opts;
  }, [fieldOptions]);

  // 确认按钮可用条件：表和库路径必须有；只有"取一个字段"模式才需要选字段
  const canConfirm = tableName !== '' && dbPath !== '' && (mode !== 'query' || fieldName !== '');

  const handleConfirm = () => {
    if (!canConfirm) return;
    const api: ConfigApiBinding = {
      table: tableName,
      field: mode === 'query' ? fieldName : '',
      dbPath,
      mode,
    };
    if (where.trim()) {
      api.where = where.trim();
    }
    if (paramRefValue) {
      // 用 `optionValueToRef` 解析，**不要**在这里手写 indexOf 切片：
      // 选项值有两种形态（`<节点id>:<端口id>` 与 `__var__:<名>`），
      // 解析规则必须与运行时 `refToVarKey` 是同一套（见 shared/nodes/varRef.ts）。
      const ref = optionValueToRef(paramRefValue);
      if (ref) api.whereParamRef = ref;
    }
    if (order.trim()) {
      api.order = order.trim();
    }
    onConfirm(api);
  };

  return (
    <Modal
      open={true}
      onClose={onCancel}
      title={t('blocks.configApi.title')}
      width="480px"
      footer={
        <ModalFooter
          onCancel={onCancel}
          onConfirm={handleConfirm}
          confirmText={t('blocks.configApi.confirm')}
          confirmDisabled={!canConfirm}
        />
      }
    >
      <div className="space-y-3 text-xs">
        {/* 说明 */}
        <div className="text-zinc-500 leading-relaxed bg-zinc-800/50 rounded p-2">
          {t('blocks.configApi.intro')}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
            {error}
          </div>
        )}

        {/* 配置表 */}
        <div>
          <label className="block text-zinc-400 mb-1">
            {t('blocks.configQuery.table')} <span className="text-red-400">*</span>
          </label>
          <Dropdown
            value={tableName}
            onChange={setTableName}
            options={categories.map((c) => ({
              value: c.name,
              label: c.displayName ? `${c.displayName}（${c.name}）` : c.name,
            }))}
            placeholder={
              loadingCats ? t('editor.action.loading') : t('blocks.configApi.selectTable')
            }
            disabled={loadingCats}
            className="w-full"
          />
        </div>

        {/* 查询方式 */}
        <div>
          <label className="block text-zinc-400 mb-1">{t('blocks.configApi.queryMode')}</label>
          <Dropdown
            value={mode}
            onChange={(v) => setMode(v as NonNullable<ConfigApiBinding['mode']>)}
            options={[
              { value: 'query', label: t('blocks.configApi.modeField') },
              { value: 'query_row', label: t('blocks.configApi.modeRow') },
              { value: 'query_all', label: t('blocks.configApi.modeAll') },
            ]}
            className="w-full"
          />
          <div className="text-zinc-600 mt-1">
            {mode === 'query'
              ? t('blocks.configApi.modeFieldHint')
              : mode === 'query_row'
                ? t('blocks.configApi.modeRowHint')
                : t('blocks.configApi.modeAllHint')}
          </div>
        </div>

        {/* 字段（只有"取一个字段"模式需要） */}
        {mode === 'query' && (
          <div>
            <label className="block text-zinc-400 mb-1">
              {t('blocks.configApi.fieldLabel')} <span className="text-red-400">*</span>
            </label>
            <Dropdown
              value={fieldName}
              onChange={setFieldName}
              options={fieldOptions}
              placeholder={
                loadingSchema
                  ? t('editor.action.loading')
                  : schema
                    ? t('blocks.configApi.selectField')
                    : t('blocks.configApi.selectTableFirst')
              }
              disabled={loadingSchema || !schema}
              className="w-full"
            />
          </div>
        )}

        {/* 排序 / 随机取一行 */}
        <div>
          <label className="block text-zinc-400 mb-1">{t('blocks.configApi.whichRow')}</label>
          <Dropdown
            value={order}
            onChange={setOrder}
            options={orderOptions}
            placeholder={t('blocks.configApi.orderNone')}
            disabled={!schema}
            className="w-full"
          />
          <div className="text-zinc-600 mt-1">
            {order === 'RANDOM()'
              ? t('blocks.configApi.orderRandomHint')
              : order
                ? t('blocks.configApi.orderHint', { order })
                : t('blocks.configApi.orderNoneHint')}
          </div>
        </div>

        {/* WHERE 条件（可选） */}
        <div>
          <label className="block text-zinc-400 mb-1">{t('blocks.configApi.whereLabel')}</label>
          <input
            type="text"
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder={t('blocks.configApi.wherePlaceholder')}
            className={`w-full ${inputFormSm}`}
          />
          <div className="text-zinc-600 mt-1">{t('blocks.configApi.whereHint')}</div>
        </div>

        {/* WHERE 参数来源（可选） */}
        <div>
          <label className="block text-zinc-400 mb-1">
            {t('blocks.configApi.paramSourceLabel')}
          </label>
          <Dropdown
            value={paramRefValue}
            onChange={setParamRefValue}
            options={[
              // 「不指定」刻意不带 group：Dropdown 遇到"部分选项有 group"才分组渲染，
              // 这里给它一个空组，它就落在组标题之前，读起来像"以上都不是"
              { value: '', label: t('blocks.configApi.none') },
              ...paramRefOptions.map((opt) => ({
                value: opt.value,
                label: opt.label,
                group: opt.group,
              })),
            ]}
            placeholder={t('blocks.configApi.selectParamSource')}
            className="w-full"
          />
          <div className="text-zinc-600 mt-1">
            {isNamedVarRef(optionValueToRef(paramRefValue))
              ? t('blocks.configApi.paramSourceVarHint')
              : t('blocks.configApi.paramSourceHint')}
          </div>
        </div>

        {/* 预览 */}
        {canConfirm && (
          <div className="bg-zinc-800/70 border border-zinc-700 rounded p-2 font-mono text-zinc-300">
            <div className="text-zinc-500 mb-1">{t('blocks.configApi.preview')}</div>
            {/* 下面是**生成的代码**预览，必须与 codegen 实际产出一致，不能翻译 */}
            <div className="text-green-400">
              {'# 配置 API: '}
              {tableName}.{fieldName}
            </div>
            <div className="text-blue-400">
              v_{currentNodeId}_{_portId} = await database_write(..., table="{tableName}",
              result_field="
              {fieldName}", db_path="{dbPath}"{where ? `, condition="${where}"` : ''})
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
