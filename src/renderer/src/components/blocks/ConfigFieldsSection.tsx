// src/renderer/src/components/blocks/ConfigFieldsSection.tsx
//
// **配置字段区**（PropertyDrawer 的配置 Section，398 行）—— 拆分 Step 3。
//
// 这是抽屉的**核心**：按 spec 展开配置字段、按 section 分组、逐字段渲染（含 switch/case 的特殊
// 分支、连线绑定入口）。它一直是抽屉里最大的一块（占 1,353 行中的近三分之一）。
//
// 做法与 Step 1/2 一致：**整块 byte-for-byte 搬**，只加一层 props 解构 —— 行为必须完全一致，
// 由 `propertyDrawer.test.tsx`（Step 0 的行为级安全网）盯着 ✓
//
// ⚠️ 用了 `t()` → 必须 useLocaleSubscription() ✓
import React from 'react';
import { useLocaleSubscription } from '@renderer/stores/i18nStore';
import { useFlowStore } from '@renderer/stores/flowStore';
import { findSpec } from '../../lib/node/nodeCatalog';
import { namedVariablesOf } from '../../lib/expression/variableRegistry';
import type { ConfigApiBinding } from '@shared/types/flow';
import type { ConfigFieldModel } from './configFieldModel';
import { isSubflowDefine } from '../../lib/canvas/executionOrder';
import { createEmptyKeyboard } from '@shared/types/keyboard';
import { DataBindingSelect } from './DataBindingSelect';
import { isFieldOwnedElsewhere, sectionOf } from './configFieldModel';
import { ConfigFieldRow } from './ConfigFieldRow';
import { IfBranchBuilder } from './IfBranchBuilder';
import { ExpressionVarHelper, insertIntoFieldTextarea } from './ExpressionVarHelper';
import { Switch } from '../ui/Switch';
import { SECTION_ICONS } from './iconMap';
import { Dropdown } from '../ui/Dropdown';
import { Table } from 'lucide-react';
import { MULTILINE_FIELDS, JSON_FIELDS, JSON_EXAMPLES } from './propertyDrawerConstants';
import { fieldHint, fieldLabel } from '../../i18n/fieldLabels';
import { t } from '../../i18n';
import { getFieldOptions } from '@shared/nodes/portOptions';
import { DebouncedTextInput, DebouncedTextarea } from './DebouncedInputs';
import { Section, HelpIcon } from './PropertyDrawerParts';
import type { FlowEdge, FlowNode } from '@shared/types/flow';

/** 配置字段的最小形状（真正的类型由 configFieldModel 推导；这里只取用到的部分） */
export interface ConfigFieldLike {
  key: string;
  type?: string;
  required?: boolean;
  label?: string;
  description?: string;
  [k: string]: unknown;
}

export interface ConfigFieldsSectionProps {
  allNodes: FlowNode[];
  collapsedSections: Set<string>;
  describeBinding: (key: string) => string | null;
  edges: FlowEdge[];
  enclosingSubflowId: string | null;
  handleBinding: (key: string, sourceNodeId: string, sourcePortId: string) => void;
  handleClearBinding: (key: string) => void;
  handleConfigApiBinding: (key: string, configApi: ConfigApiBinding) => void;
  hiddenFieldCount: number;
  highlightField: string | null;
  inlineBindingPort: string | null;
  isDbWriteNode: boolean;
  isPersistentNode: boolean;
  namedVariables: ReturnType<typeof namedVariablesOf>;
  node: FlowNode;
  nodeId: string | undefined;
  setCollapsedSections: (v: Set<string> | ((p: Set<string>) => Set<string>)) => void;
  setInlineBindingPort: (v: string | null | ((cur: string | null) => string | null)) => void;
  setShowAllConfigFields: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowTablePicker: (v: boolean | ((p: boolean) => boolean)) => void;
  showAllConfigFields: boolean;
  spec: NonNullable<ReturnType<typeof findSpec>>;
  storeEdges: FlowEdge[];
  templateKeyOptions: { value: string; label?: string }[];
  updateNodeConfig: ReturnType<typeof useFlowStore.getState>['updateNodeConfig'];
  upstreamNodes: FlowNode[];
  visibleConfigFields: ConfigFieldModel[];
}

export function ConfigFieldsSection(props: ConfigFieldsSectionProps) {
  const {
    allNodes,
    collapsedSections,
    describeBinding,
    edges,
    enclosingSubflowId,
    handleBinding,
    handleClearBinding,
    handleConfigApiBinding,
    hiddenFieldCount,
    highlightField,
    inlineBindingPort,
    isDbWriteNode,
    isPersistentNode,
    namedVariables,
    node,
    nodeId,
    setCollapsedSections,
    setInlineBindingPort,
    setShowAllConfigFields,
    setShowTablePicker,
    showAllConfigFields,
    spec,
    storeEdges,
    templateKeyOptions,
    updateNodeConfig,
    upstreamNodes,
    visibleConfigFields,
  } = props;
  useLocaleSubscription();

  return (
    <Section
      title={t('drawer.fullConfig')}
      icon={SECTION_ICONS.config}
      collapsible
      defaultOpen={true}
    >
      {/* 模式相关的参数收敛提示：默认只显示当前模式用得上的字段，
                  与当前模式无关、但用户填过值/当前有错的字段仍然显示（见 fieldVisibility.ts） */}
      {hiddenFieldCount > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded border border-zinc-700/60 bg-zinc-800/40 px-2 py-1.5">
          <span className="text-[11px] leading-tight text-zinc-400">
            {t('drawer.collapsedHint', { count: String(hiddenFieldCount) })}
          </span>
          <button
            type="button"
            onClick={() => setShowAllConfigFields((v) => !v)}
            className="shrink-0 rounded border border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-400 hover:text-zinc-100"
          >
            {showAllConfigFields ? t('drawer.onlyCurrentMode') : t('drawer.showAllParams')}
          </button>
        </div>
      )}
      <div className="space-y-2.5">
        {visibleConfigFields.map((field, fieldIdx) => {
          // 组装器类节点（拼装消息 / 战斗面板）：字段按分组插一行小标题，
          // 免得十几个内容槽平铺一屏看不出结构。控件本身不动（绑定/校验/i18n 全复用）。
          const section = sectionOf(node.data.nodeKind ?? '', field.key);
          const prevSection =
            fieldIdx > 0
              ? sectionOf(node.data.nodeKind ?? '', visibleConfigFields[fieldIdx - 1]?.key ?? '')
              : null;
          const sectionHeader = section && section !== prevSection ? section : null;
          const sectionCollapsed = Boolean(section && collapsedSections.has(section));
          const sectionCount = section
            ? visibleConfigFields.filter(
                (f) => sectionOf(node.data.nodeKind ?? '', f.key) === section,
              ).length
            : 0;
          const sectionHeaderEl = sectionHeader ? (
            <button
              type="button"
              onClick={() =>
                setCollapsedSections((prev) => {
                  const next = new Set(prev);
                  if (next.has(sectionHeader)) next.delete(sectionHeader);
                  else next.add(sectionHeader);
                  return next;
                })
              }
              className="mb-1 mt-3 flex w-full items-center gap-1 border-t border-zinc-700/60 pt-2 text-left text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
            >
              <span className="w-3 shrink-0 text-zinc-500">{sectionCollapsed ? '▸' : '▾'}</span>
              <span>{t(sectionHeader)}</span>
              <span className="text-zinc-600">（{sectionCount}）</span>
            </button>
          ) : null;
          // 折叠时：**只画标题，不画字段**（标题那一行自己也不能画字段，否则折了等于没折）
          if (section && sectionCollapsed) {
            return sectionHeaderEl ? (
              <React.Fragment key={field.key}>{sectionHeaderEl}</React.Fragment>
            ) : null;
          }
          // B 组「两段式」：切换字段（要做什么）在第一屏单独成「①」，
          // 其余参数归到「② 填参数」—— 打开节点先看到"选什么动作"，
          // 而不是一列并列的输入框（用户实测："不知道怎么设计这个节点是干啥的"）。
          const switchKeys = ['mode', 'segment_type', 'trigger_type'];
          const switchIdx = visibleConfigFields.findIndex((f) => switchKeys.includes(f.key));
          const restCount = switchIdx >= 0 ? visibleConfigFields.length - switchIdx - 1 : 0;
          const showSwitchLabel = switchIdx >= 0 && fieldIdx === switchIdx;
          const showParamLabel = switchIdx >= 0 && fieldIdx === switchIdx + 1 && restCount > 0;
          // branch_switch 的 cases / default 由「分支编辑器」统一管理
          if (
            node.data.nodeKind === 'branch_switch' &&
            (field.key === 'cases' || field.key === 'default')
          ) {
            return null;
          }
          // message_send 的 markdown / keyboard 由「按钮消息编辑器」统一管理
          if (
            node.data.nodeKind === 'message_send' &&
            (field.key === 'markdown' || field.key === 'keyboard')
          ) {
            return null;
          }
          // message_send 在按钮UI模式下隐藏 text 字段（由按钮编辑器管理 markdown）
          if (
            node.data.nodeKind === 'message_send' &&
            field.key === 'text' &&
            node.data.config?.mode === 'keyboard'
          ) {
            return null;
          }
          // 这些字段由**专属编辑器**统一管理 → 通用渲染跳过（规则集中在 configFieldModel）
          if (isFieldOwnedElsewhere(node, field.key, isSubflowDefine(node))) return null;
          const isKeyField = isPersistentNode && field.key === 'key';
          const labelText = fieldLabel(field.key);
          const hint = fieldHint(field.key);
          // 选项从目录读（数据端口 options / 节点级 configFieldOptions）
          const selectOpts = getFieldOptions(node.data.nodeKind, field.key);
          const isMultiline = MULTILINE_FIELDS.has(field.key);
          const isJson = JSON_FIELDS.has(field.key);
          const fieldValue = String(node.data.config[field.key] ?? '');
          // 该字段是否对应一个数据端口（有端口才能绑定上游数据）
          const portForField = (spec.inputs ?? []).find(
            (p) => p.id === field.key && p.kind === 'data',
          );
          const boundSource = portForField ? describeBinding(field.key) : null;

          // branch_if 条件表达式：用可视化构建器代替纯文本输入
          const isIfBranchExpr = node.data.nodeKind === 'branch_if' && field.key === 'expression';
          if (isIfBranchExpr) {
            return (
              <IfBranchBuilder
                key={field.key}
                config={node.data.config}
                nodeId={node.id}
                onChange={(k, v) => updateNodeConfig(node.id, { [k]: v })}
              />
            );
          }

          // expression_eval 单表达式模式：纯文本输入 + 提示与 branch_if 高级模式一致
          const isExprEvalSingle =
            node.data.nodeKind === 'expression_eval' &&
            field.key === 'expression' &&
            node.data.config?.mode !== 'formulas';

          return (
            <React.Fragment key={field.key}>
              {showSwitchLabel && (
                <div className="mb-1 mt-0.5 text-[11px] text-zinc-500">
                  {t('drawer.pickAction')}
                </div>
              )}
              {showParamLabel && (
                <div className="mb-1 mt-3 text-[11px] text-zinc-500">
                  {t('drawer.fillParams', { count: String(restCount) })}
                </div>
              )}
              {/* 组装器类节点的分组标题（拼装消息 / 战斗面板 / 表达式求值 …）—— 只加标题与折叠，不动控件。
                          默认全部展开（不藏东西），想看清结构时可以把组折起来。 */}
              {sectionHeaderEl}
              <ConfigFieldRow
                key={field.key}
                fieldKey={field.key}
                label={labelText}
                hint={hint}
                required={field.required}
                highlighted={highlightField === field.key}
                showRequiredError={field.required && !fieldValue && field.type !== 'boolean'}
                labelExtra={
                  <>
                    {field.description && <HelpIcon text={field.description} />}
                    {/* 数据来源：该字段对应一个数据端口时，在这里提供一个紧凑的绑定入口。
                              过去同一个参数会在「数据来源」区再渲染一整行绑定控件（下拉 + 提示），
                              两处重复 → 面板堆成墙。现在只有这一个入口，绑定后就地显示来源。 */}
                    {portForField && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const binding = describeBinding(field.key);
                          if (binding) {
                            handleClearBinding(field.key);
                            return;
                          }
                          setInlineBindingPort((cur) => (cur === field.key ? null : field.key));
                        }}
                        title={
                          boundSource
                            ? t('drawer.boundHint', { source: boundSource })
                            : t('drawer.bindHint')
                        }
                        className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] flex items-center gap-1 border transition-colors ${
                          boundSource
                            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20'
                            : 'text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:border-zinc-500'
                        }`}
                      >
                        {boundSource ? `← ${boundSource}` : t('drawer.bind')}
                      </button>
                    )}
                    {/* database_write 的 table 字段：加表结构浏览按钮 */}
                    {isDbWriteNode && field.key === 'table' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowTablePicker(true);
                        }}
                        className={`${portForField ? '' : 'ml-auto '}text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 px-1.5 py-0.5 rounded flex items-center gap-1`}
                        title={t('drawer.browseTableSchema')}
                      >
                        <Table className="w-3.5 h-3.5" />
                        {t('drawer.browse')}
                      </button>
                    )}
                  </>
                }
              >
                {/* 绑定选择器：已绑定或用户主动点开时才渲染（不占默认版面） */}
                {portForField && (boundSource || inlineBindingPort === field.key) && (
                  <DataBindingSelect
                    currentNodeId={node.id}
                    portId={field.key}
                    edges={edges}
                    upstreamNodes={upstreamNodes}
                    onSelect={(srcId, srcPort) => handleBinding(field.key, srcId, srcPort)}
                    onClear={() => handleClearBinding(field.key)}
                    onConfigApiBind={(api) => handleConfigApiBinding(field.key, api)}
                    targetDataType={portForField.dataType}
                  />
                )}
                {field.type === 'boolean' ? (
                  <Switch
                    checked={Boolean(node.data.config[field.key] ?? false)}
                    onChange={(checked) => updateNodeConfig(node.id, { [field.key]: checked })}
                    aria-label={labelText}
                  />
                ) : field.type === 'number' ? (
                  <DebouncedTextInput
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={fieldValue}
                    onChange={(v) =>
                      updateNodeConfig(node.id, {
                        [field.key]: v === '' ? undefined : Number(v),
                      })
                    }
                    placeholder={hint ? hint.slice(0, 40) : ''}
                    ariaLabel={labelText}
                    className={`w-full bg-zinc-800 border rounded px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 ${
                      field.required && !fieldValue ? 'border-red-500/60' : 'border-zinc-700'
                    }`}
                  />
                ) : selectOpts ? (
                  <Dropdown
                    value={fieldValue}
                    ariaLabel={labelText}
                    onChange={(v) => {
                      const newMode = v;
                      // 智能迁移：message_send 切换模式时自动迁移数据
                      if (node.data.nodeKind === 'message_send' && field.key === 'mode') {
                        const oldMode = String(node.data.config?.mode ?? 'text');
                        const patch: Record<string, unknown> = { mode: newMode };
                        if (newMode === 'keyboard' && oldMode === 'text') {
                          // text → keyboard：将 text 迁移到 markdown（若 markdown 为空）
                          const currentText = String(node.data.config?.text ?? '');
                          const currentMd = String(node.data.config?.markdown ?? '');
                          if (currentText && !currentMd) {
                            patch.markdown = currentText;
                          }
                          // 确保 keyboard 有初始结构
                          if (!node.data.config?.keyboard) {
                            patch.keyboard = createEmptyKeyboard();
                          }
                        } else if (newMode === 'text' && oldMode === 'keyboard') {
                          // keyboard → text：将 markdown 迁移到 text（若 text 为空）
                          const currentMd = String(node.data.config?.markdown ?? '');
                          const currentText = String(node.data.config?.text ?? '');
                          if (currentMd && !currentText) {
                            patch.text = currentMd;
                          }
                        }
                        updateNodeConfig(node.id, patch);
                      } else {
                        updateNodeConfig(node.id, { [field.key]: v });
                      }
                    }}
                    options={selectOpts}
                    className={`w-full ${field.required && !fieldValue ? 'border-red-500/60' : ''}`}
                  />
                ) : isKeyField && templateKeyOptions.length > 0 ? (
                  <>
                    <DebouncedTextInput
                      list={`drawer-tpl-keys-${node.id}`}
                      value={String(fieldValue ?? '')}
                      onChange={(v) => updateNodeConfig(node.id, { [field.key]: v })}
                      placeholder={t('drawer.fieldNamePlaceholder')}
                      ariaLabel={labelText}
                      className={`w-full bg-zinc-800 border rounded px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 ${
                        field.required && !fieldValue ? 'border-red-500/60' : 'border-zinc-700'
                      }`}
                    />
                    <datalist id={`drawer-tpl-keys-${node.id}`}>
                      {templateKeyOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </datalist>
                  </>
                ) : isJson ? (
                  <DebouncedTextarea
                    value={String(fieldValue ?? '')}
                    onChange={(v) => updateNodeConfig(node.id, { [field.key]: v })}
                    placeholder={JSON_EXAMPLES[field.key] || hint || t('drawer.jsonPlaceholder')}
                    ariaLabel={labelText}
                    rows={5}
                    className={`w-full bg-zinc-800 border rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono resize-y ${
                      field.required && !fieldValue ? 'border-red-500/60' : 'border-zinc-700'
                    }`}
                  />
                ) : isMultiline ? (
                  <>
                    <DebouncedTextarea
                      value={String(fieldValue ?? '')}
                      onChange={(v) => updateNodeConfig(node.id, { [field.key]: v })}
                      placeholder={hint || t('drawer.inputPlaceholder', { label: labelText })}
                      ariaLabel={labelText}
                      rows={3}
                      className={`w-full bg-zinc-800 border rounded px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 font-mono resize-y ${
                        field.required && !fieldValue ? 'border-red-500/60' : 'border-zinc-700'
                      }`}
                    />
                    {isExprEvalSingle && (
                      <div className="text-xs text-zinc-500 leading-relaxed">
                        {t('drawer.expressionHint')}{' '}
                        <code className="text-blue-300 font-mono">v1 + v2 * 2</code>、
                        <code className="text-blue-300 font-mono">Math.max(v1, v2)</code>。
                        {t('drawer.expressionHintTail')}
                      </div>
                    )}
                    {isExprEvalSingle && (
                      <ExpressionVarHelper
                        nodeId={node.id}
                        nodeKind={node.data.nodeKind}
                        dataPorts={(node.data.inputs ?? []).filter((p) => p.kind === 'data')}
                        config={node.data.config ?? {}}
                        edges={storeEdges}
                        namedVariables={namedVariables}
                        enclosingSubflowId={enclosingSubflowId}
                        allNodes={allNodes}
                        expression={String(fieldValue ?? '')}
                        onInsert={(name) => {
                          // 光标处插入（纯逻辑在 lib/expression/expressionVars.ts，DOM 定位在组件里）。
                          // 找不到输入框就什么都不做 —— 不盲插末尾、不整段替换。
                          const r = insertIntoFieldTextarea(field.key, name);
                          if (!r.ok || r.next === undefined) return;
                          updateNodeConfig(node.id, { [field.key]: r.next });
                        }}
                      />
                    )}
                  </>
                ) : (
                  <DebouncedTextInput
                    value={String(fieldValue ?? '')}
                    onChange={(v) => updateNodeConfig(node.id, { [field.key]: v })}
                    placeholder={hint ? hint.slice(0, 40) + '...' : ''}
                    ariaLabel={labelText}
                    className={`w-full bg-zinc-800 border rounded px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 ${
                      field.required && !fieldValue ? 'border-red-500/60' : 'border-zinc-700'
                    }`}
                  />
                )}
                {/* 必填字段错误文本：与红边框配套，明确告诉用户为什么配置无效。
                          boolean 字段有默认 false，不需要此提示；专属编辑器管理的字段
                          （branch_if.expression / branch_switch.cases 等）走自己的 return 分支，不会到这里。 */}
              </ConfigFieldRow>
            </React.Fragment>
          );
        })}
      </div>
    </Section>
  );
}
