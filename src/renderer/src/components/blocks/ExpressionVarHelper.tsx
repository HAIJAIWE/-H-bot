// src/renderer/src/components/blocks/ExpressionVarHelper.tsx
//
// 表达式输入框下面的「可用变量名」清单 —— 点一下就插到表达式里。
//
// 为什么需要它：`expression_eval` 是使用次数最多的节点（真机 51 次 / 22%），
// 但表达式里能写哪些名字取决于"哪些端口连了线、哪些在配置里有值、当前在哪个子流程、
// 有哪些命名变量" —— 用户在画布上看不出来，只能凭记忆猜 `v1` 还是 `v7`。
// 猜错的表现是运行时报 `v7 is not defined`（或者更糟：写成一个恰好存在的别的名字，
// 于是**静默算错**）。把清单摆在输入框下面，这一整类错误就不用靠记忆避免了。
//
// 清单规则与运行时逐条对齐，见 `lib/expression/expressionVars.ts` 的头注。
import { useEffect, useMemo, useState } from 'react';
import type { FlowEdge, FlowNode, Variable } from '@shared/types/flow';
import {
  checkVarRename,
  collectExpressionVars,
  insertNameAtCursor,
  renameVarInFormulas,
  renameVarInText,
  type ExprVarItem,
  type VarRenameError,
} from '../../lib/expression/expressionVars';
import { checkExprStructure } from '../../lib/expression/exprStructure';
import { checkExprSyntax, type ExprSyntaxResult } from '../../lib/expression/exprSyntax';
import {
  beginHistoryBatch,
  endHistoryBatch,
  pushHistoryPoint,
  useFlowStore,
} from '../../stores/flowStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface ExpressionVarHelperProps {
  nodeId: string;
  nodeKind: string;
  /** 本节点目录里的**数据**输入端口（控制端口由调用方过滤掉） */
  dataPorts: Array<{ id: string; name?: string }>;
  config: Record<string, unknown>;
  edges: FlowEdge[];
  namedVariables: Variable[];
  enclosingSubflowId: string | null;
  allNodes: FlowNode[];
  expression: string;
  /** 把名字插进表达式（调用方负责读/写输入框的光标位置） */
  onInsert: (name: string) => void;
}

export function ExpressionVarHelper({
  nodeId,
  nodeKind,
  dataPorts,
  config,
  edges,
  namedVariables,
  enclosingSubflowId,
  allNodes,
  expression,
  onInsert,
}: ExpressionVarHelperProps) {
  useLocaleSubscription();

  // 结构检查（括号/引号配对）—— 零误报、纯本地、零延迟，先跑它当快速路径
  const structure = useMemo(() => checkExprStructure(expression), [expression]);

  // 完整语法校验（翻译 + 语法）—— 判定在**主进程**做（渲染层 CSP 没有 unsafe-eval，
  // 在这里 `new Function` 只会把合法写法误判成错的，理由见 lib/expression/exprSyntax.ts 文件头）。
  // 所以它是异步的：防抖 250ms 再发一次，避免每个按键都过一次 IPC。
  //
  // ⚠️ 结论必须**跟着表达式走**（`forExpr`）—— 不匹配就当作"还没有结论"，什么都不显示。
  // 真机验证时抓到过现形：把一句写坏、再改成另一句之后，红字会短暂地仍然显示**上一句**的
  // 报错（读到的是 `Unexpected token ';'`，而用 Electron 自带的 V8 复现可知：
  // 只有"少一个右括号"那句才报得出来，当时输入框里已经不是那句了）。
  // 红字是**断言**：宁可晚 250ms 到，也不能替别的句子说话。
  const [syntax, setSyntax] = useState<{ forExpr: string; result: ExprSyntaxResult }>({
    forExpr: '',
    result: { ok: true },
  });
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void checkExprSyntax(expression).then((r) => {
        if (alive) setSyntax({ forExpr: expression, result: r });
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [expression]);
  const syntaxResult: ExprSyntaxResult =
    syntax.forExpr === expression ? syntax.result : { ok: true };

  const items = useMemo(
    () =>
      collectExpressionVars({
        nodeId,
        nodeKind,
        dataPorts,
        config,
        edges,
        namedVariables,
        enclosingSubflowId,
        expression,
        allNodes,
      }),
    [
      nodeId,
      nodeKind,
      dataPorts,
      config,
      edges,
      namedVariables,
      enclosingSubflowId,
      expression,
      allNodes,
    ],
  );

  const usedCount = items.filter((i) => i.used).length;

  // ---- 重命名（只对**端口**开放：命名变量的名字来自 variable_set / 子流程参数，
  //      改它得去改那个节点的配置，不属于"表达式节点的输入"这件事）----
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<VarRenameError | null>(null);

  const startRename = (name: string) => {
    setRenaming(name);
    setDraft(name);
    setError(null);
  };

  const confirmRename = () => {
    if (renaming === null) return;
    const taken = items.map((i) => i.name).filter((n) => n !== renaming);
    const check = checkVarRename({ from: renaming, to: draft, taken, nodeKind });
    if (!check.ok) {
      if (check.error === 'same') {
        setRenaming(null);
        return;
      }
      setError(check.error ?? null);
      return;
    }
    const to = draft.trim();
    // 一次操作 = 一次撤销：端口、边、表达式三处必须落在**同一个**历史点里。
    // 顺序照 `BlockEditor.handleCreateConfigQuery` 的既有约定：先压批前快照，再进批。
    const before = useFlowStore.getState();
    pushHistoryPoint(before.nodes, before.edges);
    beginHistoryBatch();
    try {
      useFlowStore.getState().renameNodeInputPort(nodeId, renaming, to);
      const patch: Record<string, unknown> = {};
      if (typeof config.expression === 'string') {
        patch.expression = renameVarInText(config.expression, renaming, to);
      }
      if (config.formulas !== undefined) {
        patch.formulas = renameVarInFormulas(config.formulas, renaming, to);
      }
      if (Object.keys(patch).length > 0) updateNodeConfig(nodeId, patch);
    } finally {
      endHistoryBatch();
    }
    setRenaming(null);
    setError(null);
  };

  // 表达式问题（红字）：**结构错优先**。
  // 结构检查（括号/引号配对）零误报、零延迟，一发现就报 —— 它比语法检查更早、
  // 也更贴用户当下的动作（少打一个右括号）。结构对了才轮到完整语法检查的结果。
  // ⚠️ 语法检查只报"翻译/语法"错，**不报未定义变量**（那是误报重灾区）；判定在主进程
  // （渲染层 CSP 没有 unsafe-eval），所以它比结构检查晚约 250ms 到 —— 这是刻意的。
  // 两个结果的详细理由见 lib/expression/exprStructure.ts 与 lib/expression/exprSyntax.ts 的文件头。
  //
  // ⚠️⚠️ 必须算在下面 `items.length === 0` 的**提前返回之前**，两条路径都要渲染它。
  // 理由：变量清单为空 = "刚拖出来的节点、一个端口都没连、项目里也还没有命名变量"，
  // 那正是用户**第一次写表达式**的时刻 —— 恰恰这时候写错了最需要提示。
  // 原来这个返回在红字之前，于是功能在最常见的场景里是哑的（2026-09-26 审查指出）。
  const problem = !structure.ok
    ? t('exprVars.structureError', { msg: structure.error })
    : !syntaxResult.ok
      ? t('exprVars.syntaxError', { msg: syntaxResult.error })
      : null;

  if (items.length === 0) {
    return (
      <div className="space-y-1">
        <ExprProblemLine text={problem} />
        <div className="text-xs text-zinc-600 leading-relaxed">{t('exprVars.empty')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <ExprProblemLine text={problem} />
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span>{t('exprVars.title')}</span>
        <span className="text-zinc-600">
          {t('exprVars.usedCount', { used: String(usedCount), total: String(items.length) })}
        </span>
        <span className="text-zinc-600 ml-auto">{t('exprVars.clickToInsert')}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <VarChip
            key={`${item.kind}:${item.name}`}
            item={item}
            active={renaming === item.name}
            onInsert={onInsert}
            onStartRename={startRename}
          />
        ))}
      </div>

      {renaming !== null && (
        <div className="rounded border border-zinc-700 bg-zinc-800/60 p-1.5 space-y-1">
          <div className="text-[11px] text-zinc-400">
            {t('exprVars.renameTitle', { from: renaming })}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={draft}
              autoFocus
              aria-label={t('exprVars.renameLabel')}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={confirmRename}
              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
            >
              {t('exprVars.renameConfirm')}
            </button>
            <button
              type="button"
              onClick={() => setRenaming(null)}
              className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              {t('exprVars.renameCancel')}
            </button>
          </div>
          <div className={`text-[11px] ${error ? 'text-red-400' : 'text-zinc-600'}`}>
            {error ? renameErrorMessage(error) : t('exprVars.renameHint')}
          </div>
        </div>
      )}
    </div>
  );
}

/** 重命名失败原因码 → 界面文案 */
function renameErrorMessage(code: VarRenameError): string {
  return t(`exprVars.renameError.${code}`);
}

/**
 * 表达式问题红字（`text` 为空时不渲染任何东西）。
 *
 * 抽成一个组件只为一件事：**清单为空/不为空这两条返回路径必须渲染同一段标记** ——
 * 复制两份 JSX 迟早会漂移（其中一份漏了 `role="alert"`，测试和读屏器就都看不见它了）。
 */
function ExprProblemLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="text-[11px] text-red-400 leading-relaxed" role="alert">
      {text}
    </div>
  );
}

function VarChip({
  item,
  active,
  onInsert,
  onStartRename,
}: {
  item: ExprVarItem;
  active: boolean;
  onInsert: (name: string) => void;
  onStartRename: (name: string) => void;
}) {
  const chipClass = item.used
    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
    : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700/40';
  return (
    // 「按钮里嵌按钮」是非法 HTML，也会让读屏器把两层都念一遍 ——
    // 所以外面是 span + flex，里面两个各自独立的 button。
    <span
      className={`inline-flex items-stretch overflow-hidden rounded border transition-colors ${
        active ? 'border-blue-500' : chipClass
      }`}
    >
      <button
        type="button"
        title={item.detail}
        className="px-1.5 py-0.5 font-mono text-[11px]"
        onClick={() => onInsert(item.name)}
      >
        {item.name}
        {item.kind === 'variable' && <span className="ml-1 text-[10px] opacity-70">$</span>}
      </button>
      {item.kind === 'port' && (
        <button
          type="button"
          title={t('exprVars.renameTooltip')}
          aria-label={t('exprVars.renameTooltip')}
          className="border-l border-current/20 px-1 py-0.5 text-[10px] opacity-60 hover:opacity-100"
          onClick={() => onStartRename(item.name)}
        >
          ✎
        </button>
      )}
    </span>
  );
}

/**
 * 把名字插进"某个字段的输入框"的光标处，并返回是否插成功。
 *
 * 为什么要 DOM 查询：这个字段的控件是 `ConfigFieldRow` 的 children（调用方传入），
 * 而 `DebouncedTextarea` **不接受 ref**（见 `DebouncedInputs.tsx`）。与其为了一处插入
 * 去改公共输入件的签名，不如按渲染契约定位：字段外壳上有 `data-field-key`。
 * 找不到输入框时返回 false，调用方**不做任何修改**（宁可什么都不做，也不要盲插到末尾
 * 或整段替换 —— 那会把用户正在写的表达式弄坏）。
 */
export function insertIntoFieldTextarea(
  fieldKey: string,
  name: string,
): { ok: boolean; next?: string; cursor?: number } {
  const row = document.querySelector(`[data-field-key="${fieldKey}"]`);
  const el = row?.querySelector('textarea');
  if (!el) return { ok: false };
  const { next, cursor } = insertNameAtCursor({
    current: el.value,
    name,
    start: el.selectionStart,
    end: el.selectionEnd,
  });
  return { ok: true, next, cursor };
}
