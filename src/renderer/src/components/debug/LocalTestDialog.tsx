// src/renderer/src/components/debug/LocalTestDialog.tsx
//
// 本地测试（流程预览）—— **不需要 QQ，跑的是真解释器**。
//
// 迁移说明：这里原先把流程交给渲染层的 `mockRunner`（1600 行、自己一套 per-node 实现）
// 模拟执行。两套实现必然漂移，"本地测试通过、真机不响"就是这么来的。
// 现在改为调用主进程 `flow:preview`：在项目的**临时克隆**上跑真 `FlowInterpreter`，
// 副作用（发消息/写文件/写库）全部被挡在克隆内，因此：
//   - 预览结果 = 真实行为（同一个引擎、同一份节点目录）
//   - 编辑器里的未保存改动也能直接预览（图随请求一起发过去）
//   - 读到的是真实数据的副本，不再需要手工填"模拟持久化数据"
import { useState, useEffect } from 'react';
import { useFlowStore } from '../../stores/flowStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { PreviewResult, PreviewActionRecord } from '@shared/types/preview';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 把记录到的 action 渲染成人类可读的一行 */
function describeAction(action: PreviewActionRecord): string {
  const p = action.params;
  const target = (p.group_id as string) ?? (p.user_id as string) ?? (p.openid as string) ?? '';
  const body =
    (p.message as string) ??
    (p.markdown as string) ??
    (typeof p.message === 'object' ? JSON.stringify(p.message) : '');
  const head = target ? `→ ${target}` : '';
  return `${action.api} ${head}${body ? `: ${String(body).slice(0, 200)}` : ''}`.trim();
}

/**
 * 从当前图里挑一个"指令匹配"触发器，作为测试命令的默认值。
 *
 * 事故（真应用实测）：对话框原来把默认命令硬编码成「战斗」，而用户项目里的指令是
 * `/技能 /修炼 /收获 …` —— 小白点开就能按的按钮，结果永远是"无匹配触发器 动作 0"，
 * 看起来像"我的流程坏了"。默认值必须来自用户自己的流程。
 */
export function pickDefaultTestCommand(
  nodes: Array<{ data?: { nodeKind?: string; config?: Record<string, unknown> } }>,
): { command: string; prefix: string } | null {
  for (const n of nodes) {
    if (n.data?.nodeKind !== 'message_received') continue;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    if (String(cfg.match ?? '') !== 'command') continue;
    const command = String(cfg.command ?? '').trim();
    if (!command) continue;
    return { command, prefix: String(cfg.prefix ?? '/') || '/' };
  }
  return null;
}

export function LocalTestDialog({ open, onClose }: Props) {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path);
  const nodes = useFlowStore((s) => s.nodes);

  const [triggerType, setTriggerType] = useState<
    'command' | 'text' | 'at_me' | 'scheduled' | 'on_ready'
  >('command');
  const [command, setCommand] = useState('战斗');
  const [prefix, setPrefix] = useState('/');
  const [text, setText] = useState('你好');
  const [userId, setUserId] = useState('123456');
  const [groupId, setGroupId] = useState('654321');

  const [result, setResult] = useState<PreviewResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // 默认命令取当前流程里的真实指令（没有就保持原样，不硬塞一个用户项目里不存在的值）
      const picked = pickDefaultTestCommand(useFlowStore.getState().nodes);
      if (picked) {
        setCommand(picked.command);
        setPrefix(picked.prefix);
      }
      setResult(null);
      setRunning(false);
      setError('');
    }
  }, [open]);

  const handleRun = async () => {
    if (!projectPath || nodes.length === 0 || running) return;
    setRunning(true);
    setResult(null);
    setError('');
    try {
      // 用 exportGraph 取当前图（剥离 UI 临时态），未保存的改动也会被预览
      const graph = useFlowStore.getState().exportGraph();
      const payload = {
        projectPath,
        graph,
        event: {
          triggerType,
          command,
          prefix,
          text,
          userId,
          groupId,
        },
        timeoutMs: 8000,
      };
      const res = await window.qqbat.flow.preview(payload);
      if (!res?.ok || !res.data) {
        setError(res?.error ?? t('debug.local.previewFailed'));
        return;
      }
      setResult(res.data as PreviewResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const copyResult = () => {
    if (!result) return;
    const lines: string[] = [];
    lines.push(
      t('debug.local.copyHeader', {
        status: result.matched ? t('debug.local.matched') : t('debug.local.noMatch'),
        ms: result.durationMs,
        count: result.actions.length,
        timeout: result.timedOut ? t('debug.local.timeoutSuffix') : '',
      }),
    );
    if (result.normalizedNodes > 0) {
      lines.push(t('debug.local.copyNormalized', { count: result.normalizedNodes }));
    }
    if (result.actions.length > 0) {
      lines.push('', t('debug.local.actionsHeader'));
      result.actions.forEach((a, i) => lines.push(`${i + 1}. ${describeAction(a)}`));
    }
    const exits = result.nodes.filter((n) => n.status === 'exit');
    if (exits.length > 0) {
      lines.push('', t('debug.local.traceHeader'));
      exits.forEach((n) => lines.push(`- ${n.nodeId} (${n.durationMs ?? 0}ms)`));
    }
    if (result.errors.length > 0) {
      lines.push('', t('debug.local.errorHeader'), ...result.errors.map((e) => `! ${e}`));
    }
    const vars = Object.entries(result.variables).filter(([k]) => k.includes(':'));
    if (vars.length > 0) {
      lines.push('', t('debug.local.varsHeader'));
      vars.forEach(([k, v]) => lines.push(`${k} = ${JSON.stringify(v)}`));
    }
    navigator.clipboard.writeText(lines.join('\n'));
  };

  const blocking = result?.issues.filter((i) => i.severity === 'error') ?? [];

  return (
    <Modal open={open} onClose={onClose} title={t('debug.local.open')} width="680px">
      <div className="space-y-4">
        <p className="text-xs text-zinc-500 leading-relaxed">{t('debug.local.hint')}</p>

        {/* 触发方式 */}
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">
            {t('debug.local.triggerType')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: 'command', label: t('debug.local.trigger.command') },
                { value: 'text', label: t('debug.local.trigger.message') },
                { value: 'at_me', label: t('debug.local.trigger.mention') },
                // 生命周期触发：不看消息内容，预览会像真实运行时那样派发一次
                { value: 'scheduled', label: t('debug.local.trigger.schedule') },
                { value: 'on_ready', label: t('debug.local.trigger.ready') },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.value}
                variant="secondary"
                size="sm"
                className={`text-left border ${
                  triggerType === opt.value
                    ? 'bg-blue-900/30 border-blue-600 text-blue-200'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
                onClick={() => setTriggerType(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {/* 参数区 */}
        <div className="grid grid-cols-2 gap-3">
          {triggerType === 'command' && (
            <>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">
                  {t('debug.local.command')}
                </label>
                <input
                  className="w-full px-2 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-200"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">
                  {t('debug.local.prefix')}
                </label>
                <input
                  className="w-full px-2 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-200"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </div>
            </>
          )}
          {(triggerType === 'text' || triggerType === 'at_me') && (
            <div className="col-span-2">
              <label className="text-xs text-zinc-500 mb-1 block">
                {t('debug.local.messageContent')}
              </label>
              <textarea
                className="w-full px-2 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-200 resize-none"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}
          {(triggerType === 'scheduled' || triggerType === 'on_ready') && (
            <div className="col-span-2 px-3 py-2 rounded bg-zinc-800/60 border border-zinc-700 text-xs text-zinc-400 leading-relaxed">
              {triggerType === 'scheduled'
                ? t('debug.local.scheduleHint')
                : t('debug.local.readyHint')}
            </div>
          )}
          {triggerType !== 'scheduled' && triggerType !== 'on_ready' && (
            <>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">
                  {t('debug.local.userId')}
                </label>
                <input
                  className="w-full px-2 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-200"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">
                  {t('debug.local.groupId')}
                </label>
                <input
                  className="w-full px-2 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-200"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {/* 运行 */}
        <div className="flex gap-2">
          <Button
            variant="success"
            size="lg"
            className="flex-1 font-semibold"
            disabled={running || nodes.length === 0 || !projectPath}
            title={
              !projectPath
                ? t('debug.local.noProject')
                : nodes.length === 0
                  ? t('debug.local.noNodes')
                  : undefined
            }
            onClick={handleRun}
          >
            {running ? t('debug.local.running') : t('debug.local.run')}
          </Button>
          {result && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setResult(null)}
                title={t('debug.local.clearResult')}
              >
                {t('editor.action.clear')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={copyResult}
                title={t('debug.local.copyResult')}
              >
                {t('debug.local.copy')}
              </Button>
            </>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 rounded bg-red-900/20 border border-red-800/50 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* 结果 */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-3 py-1.5 rounded bg-zinc-800/50 text-xs text-zinc-400 flex-wrap">
              <span>
                {result.matched ? t('debug.local.resultTriggered') : t('debug.local.resultNoMatch')}
              </span>
              <span>{t('debug.local.elapsed', { ms: result.durationMs })}</span>
              <span>{t('debug.local.actionCount', { count: result.actions.length })}</span>
              {result.normalizedNodes > 0 && (
                <span className="text-amber-400/80">
                  {t('debug.local.normalized', { count: result.normalizedNodes })}
                </span>
              )}
              {result.timedOut && (
                <span className="text-amber-400">{t('debug.local.timedOut')}</span>
              )}
            </div>

            {/* 阻断问题 */}
            {blocking.length > 0 && (
              <div className="px-3 py-2 rounded bg-red-900/20 border border-red-800/50">
                <div className="text-xs text-red-300 font-medium mb-1">
                  {t('debug.local.blocking', { count: blocking.length })}
                </div>
                <ul className="text-xs text-red-300/80 space-y-0.5">
                  {blocking.slice(0, 8).map((i, idx) => (
                    <li key={idx}>· {i.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 会发送什么 */}
            <div>
              <div className="text-xs text-zinc-500 mb-1">{t('debug.local.actions')}</div>
              {result.actions.length === 0 ? (
                <div className="text-xs text-zinc-600 px-3 py-2 rounded bg-zinc-800/30">
                  {t('debug.local.noActions')}
                </div>
              ) : (
                <ul className="space-y-1">
                  {result.actions.map((a) => (
                    <li
                      key={a.seq}
                      className="text-xs px-3 py-1.5 rounded bg-zinc-800/40 border border-zinc-700/50 text-zinc-200 font-mono break-all"
                    >
                      {describeAction(a)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 执行轨迹 */}
            {result.nodes.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 mb-1">{t('debug.local.nodeTrace')}</div>
                <ul className="space-y-0.5">
                  {result.nodes
                    .filter((n) => n.status !== 'enter')
                    .map((n, idx) => (
                      <li key={idx} className="text-xs text-zinc-400">
                        {n.status === 'exit' ? '✅' : '❌'} {n.nodeId}
                        {n.durationMs !== undefined ? ` (${n.durationMs}ms)` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {/* 变量快照 */}
            {Object.keys(result.variables).length > 0 && (
              <details>
                <summary className="text-xs text-zinc-500 cursor-pointer">
                  {t('debug.local.varsSnapshot', {
                    count: Object.keys(result.variables).length,
                  })}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(result.variables)
                    .filter(([k]) => k.includes(':'))
                    .map(([k, v]) => (
                      <li key={k} className="text-xs text-zinc-400 font-mono break-all">
                        {k} = {JSON.stringify(v)}
                      </li>
                    ))}
                </ul>
              </details>
            )}

            {/* 错误 */}
            {result.errors.length > 0 && (
              <div className="px-3 py-2 rounded bg-red-900/20 border border-red-800/50">
                <div className="text-xs text-red-300 font-medium mb-1">
                  {t('editor.filter.error')}
                </div>
                <ul className="text-xs text-red-300/80 space-y-0.5">
                  {result.errors.map((e, idx) => (
                    <li key={idx}>· {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {nodes.length === 0 && (
          <span className="text-xs text-zinc-500">{t('debug.local.noNodesExecuted')}</span>
        )}
      </div>
    </Modal>
  );
}
