// src/renderer/src/components/layout/RightPanel.tsx
import { AiSidebar } from '../ai/AiSidebar';
import { ChatPanel } from '../ai/ChatPanel';
import { useAiStore } from '../../stores/aiStore';
import { useUiStore } from '../../stores/uiStore';
import { DebugVariablePanel } from '../canvas/DebugVariablePanel';
import { VariablePanel } from '../panels/VariablePanel';
import { useEffect } from 'react';
import { useDebugStore } from '../../stores/debugStore';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

// ⚠️ 2026-09-30：这个标签原来渲染的是 `debugger/DebuggerPanel.tsx` —— 一套**按源码行号
// 打断点**的调试器（DAP 形状：callStack / frameId / watch / REPL / 函数断点），
// 它调的是 `debugger:*` 通道，而**主进程一个处理器都没注册**；更要紧的是它调试的是
// **Python 源码**（`toggleBreakpoint('src/foo.py', 10)`、函数断点 `handle_message`、
// 会话失败报「venv 不存在」）—— 而 Python 运行时早已按 ADR 删除。
// 也就是说：那套 UI 调试的是一个**不存在的运行时**，整块已删。
//
// 现在标签指向**真正在用**的那套：`DebugVariablePanel` + `debugStore`（5KB），
// 它的数据来自运行时日志标记（`[NODE:enter:x]` → `runtimeLogParser` → `debuggerService`
// → `debug:stateChanged`），能看到"流程跑到哪个节点、当时变量是什么"。
//
// 注意它**不是**能停住流程的单步调试器：主进程里没有任何暂停/恢复机制
// （`isActive`/`hasBreakpoint`/`pausedNodeId` 在 `services/debugger.ts` 之外零引用）。
const RIGHT_TABS = [
  {
    id: 'ai' as const,
    get label() {
      return t('panel.right.ai');
    },
  },
  {
    id: 'variables' as const,
    get label() {
      return t('panel.right.variables');
    },
  },
  {
    id: 'debugger' as const,
    get label() {
      return t('panel.right.debugger');
    },
  },
];

export function RightPanel() {
  useLocaleSubscription();
  const agentState = useAiStore((s) => s.agentState);
  const rightTab = useUiStore((s) => s.rightTab);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const initDebugListener = useDebugStore((s) => s.initDebugListener);

  // 订阅主进程的 `debug:stateChanged`。
  //
  // ⚠️ 这一步此前**没有任何地方调用**（`initDebugListener` 定义在 debugStore 里、
  // 零调用点）→ 调试面板永远显示初始的 idle 状态，看不到"现在跑到哪个节点"。
  // 也就是说那套"能用的"调试器其实只通了**发**的一半、没收的一半。这里补上。
  // （被删掉的那套 Python 调试器原来在同一个位置订阅它自己的 `debugger:*` 事件。）
  useEffect(() => {
    return initDebugListener();
  }, [initDebugListener]);

  const statusLabel = (() => {
    switch (agentState.state) {
      case 'thinking':
        return t('panel.right.status.thinking');
      case 'executing':
        return t('panel.right.status.running');
      case 'warning':
        return t('panel.right.status.attention');
      case 'error':
        return t('panel.right.status.error');
      default:
        return '';
    }
  })();

  return (
    // ⚠️ `min-h-0` 是这一列的**滚动前提**：它是 flex 列里的 flex 子项，
    // 默认 `min-height:auto` = 内容高度 ⇒ 它会撑到消息那么高，把外层
    // `overflow-hidden` 的裁剪当"终点"，于是里面的消息区永远拿不到有界高度、
    // 滚动条永远不出现（实测：aside clientHeight 1601 / 外层 813，全应用没有一个可滚动元素）。
    // 左边那栏（LeftPanel）一直有 min-h-0，右边少了 —— 2026-10-06 用 CDP 实测定位。
    <aside
      className="flex-1 min-h-0 border-l border-zinc-800 bg-zinc-950 flex flex-col"
      aria-label={t('panel.right.title')}
    >
      {/* Tab 栏 */}
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        {RIGHT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              rightTab === t.id
                ? 'text-zinc-100 border-b-2 border-blue-500 bg-zinc-950'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
            onClick={() => setRightTab(t.id)}
          >
            {t.label}
            {t.id === 'ai' && statusLabel && (
              <span className="text-zinc-600 font-normal ml-1">{statusLabel}</span>
            )}
          </button>
        ))}
      </div>
      {/* 内容区 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {rightTab === 'ai' && (
          /**
           * ⚠️ **必须是横向 flex**（2026-10-15 真机）：AiSidebar 的根是
           * `<aside className="relative shrink-0 self-stretch">` —— `self-stretch` 只在
           * **横向**容器里才有意义。我第一版直接塞进父层那个 `flex flex-col` 里，
           * 结果它被竖着堆到**输入框下面**去了（用户截图：侧边条跑到底部）。
           * 另外 ChatPanel 要自己 `flex-1 min-w-0`，否则宽度会被侧栏挤掉、内容不换行。
           */
          <div className="flex-1 min-h-0 flex min-w-0">
            {/* min-h-0 是滚动链要求的：flex 列缺了它，内部就滚不动（panelScrollChain 闸门） */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <ChatPanel />
            </div>
            <AiSidebar />
          </div>
        )}
        {rightTab === 'variables' && <VariablePanel />}
        {rightTab === 'debugger' && <DebugVariablePanel />}
      </div>
    </aside>
  );
}
