import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ProposalOperation } from '@shared/types/proposal';
import type { ToolExecutionContext } from './tools';
import { applyPendingOperations, pendingNote } from './pendingGraph';
import { logger } from '../logger';

/**
 * 组装自检工具要用的上下文。
 *
 * @returns 没有待确认操作时返回 `undefined`（**连盘都不读** —— 这是热路径，
 *          多数轮次没有 mutation，不该为此白白读一次 flow.json）
 *
 * 读盘失败等异常一律降级为 `undefined`（工具退回读磁盘），
 * 绝不因为自检上下文而中断整轮对话。
 */
export async function buildPendingContext(
  projectPath: string,
  ops: readonly ProposalOperation[],
): Promise<ToolExecutionContext | undefined> {
  if (ops.length === 0) return undefined;
  try {
    const flowPath = join(projectPath, '.qqbat', 'flow.json');
    if (!existsSync(flowPath)) return undefined;
    const base = JSON.parse(await readFile(flowPath, 'utf-8')) as Parameters<
      typeof applyPendingOperations
    >[0];
    const overlay = applyPendingOperations(base, ops);
    return { pendingGraph: overlay.graph, pendingNote: pendingNote(overlay) };
  } catch (e) {
    logger.warn(`[ai] 构造预览图失败（自检工具将退回读磁盘）: ${String(e)}`);
    return undefined;
  }
}
