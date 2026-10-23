// src/main/services/ai/instructionBridge.ts
//
// **写指令的派发与回执**（P1-1，2026-10-18）。
//
// 一对一：dispatchInstruction 发一条 → 渲染层执行 → resolveInstruction 回一条。
// 三条边界（写在这里，免得以后有人以为它管得更多）：
//   1. **超时 = 失败**，不是成功。默认 15s（一个文件写入/画布操作远用不了这么久）。
//   2. **取消/关闭**：settleInstructionsFor 按项目一次性把挂起的指令判失败，
//      避免聊天被停止后还有 Promise 永远悬着。
//   3. 本模块**不碰 Electron 生命周期**、不读盘、不做业务判断 —— 只做收发。
//
// 为什么要单独一层：MCP、作者助手、将来的 headless 通道都要用同一套语义。
// 各写一遍的结果就是"有的地方等回执、有的地方发完就当成功"（改造前正是如此）。

import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { InstructionRequest, InstructionResult } from '@shared/protocol/instruction';
import { logger } from '../infra/logger';

/** 渲染层在这段时间内没有任何回执 → 判失败（宁可失败，也不许假成功） */
export const INSTRUCTION_TIMEOUT_MS = 15_000;

interface PendingInstruction {
  resolve: (result: InstructionResult) => void;
  timer: NodeJS.Timeout;
  projectPath: string;
  name: string;
}

/** 模块级单例：同一个主进程里只有一个渲染层（多窗口时按 projectPath 区分即可） */
const pending = new Map<string, PendingInstruction>();

export interface DispatchOptions {
  /** 覆盖默认超时（MCP 的批量操作可能更久，调用方可自行放宽） */
  timeoutMs?: number;
}

/**
 * 下发一条写指令并**等回执**。
 *
 * 绝不 reject：所有失败都收敛成 { status: 'failed', reason } ——
 * 调用方（工具循环 / MCP）只需要看 outcome，不必再写一层 try/catch。
 */
export async function dispatchInstruction(
  win: BrowserWindow | null | undefined,
  req: { name: string; args: Record<string, unknown>; projectPath: string },
  opts: DispatchOptions = {},
): Promise<InstructionResult> {
  const requestId = randomUUID();
  const timeoutMs = opts.timeoutMs ?? INSTRUCTION_TIMEOUT_MS;

  if (!win || win.isDestroyed()) {
    // 没有窗口 = 这条指令没人执行。与 MCP 侧同一条判据（server.ts 的"指令未执行"）。
    return {
      requestId,
      outcome: { status: 'failed', reason: '没有可用的应用窗口来执行这条指令' },
    };
  }

  return new Promise<InstructionResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      logger.warn(
        '[instruction] 渲染层 ' + timeoutMs + 'ms 内没有回执，判失败：' + req.name + '（' + requestId + '）',
      );
      resolve({
        requestId,
        outcome: { status: 'failed', reason: timeoutMs + 'ms 内没有收到渲染层回执' },
      });
    }, timeoutMs);
    // 不让一个挂起的指令拖住进程退出（Electron 主进程退出时常见）
    if (typeof timer.unref === 'function') timer.unref();

    pending.set(requestId, { resolve, timer, projectPath: req.projectPath, name: req.name });

    const payload: InstructionRequest = {
      requestId,
      projectPath: req.projectPath,
      instruction: { name: req.name, args: req.args },
    };
    try {
      win.webContents.send('ai:clientInstruction', payload);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(requestId);
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn('[instruction] 下发失败：' + req.name + '：' + reason);
      resolve({ requestId, outcome: { status: 'failed', reason: '下发失败：' + reason } });
    }
  });
}

/**
 * 渲染层回执。返回 false = 没有这条挂起指令（超时后迟到的回执、或伪造的 id）。
 * 迟到回执**必须被丢弃**，否则会把已经判失败的调用又改成成功。
 */
export function resolveInstruction(result: InstructionResult): boolean {
  const entry = pending.get(result.requestId);
  if (!entry) {
    logger.info('[instruction] 收到没有挂起项的回执（可能已超时）：' + result.requestId);
    return false;
  }
  clearTimeout(entry.timer);
  pending.delete(result.requestId);
  entry.resolve(result);
  return true;
}

/** 把这个项目下所有挂起的指令判失败（停止对话 / 窗口关闭 / 切项目时调用） */
export function settleInstructionsFor(projectPath: string, reason: string): number {
  let settled = 0;
  for (const [requestId, entry] of pending) {
    if (entry.projectPath !== projectPath) continue;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve({ requestId, outcome: { status: 'failed', reason } });
    settled += 1;
  }
  if (settled > 0) {
    logger.info('[instruction] 已结算 ' + settled + ' 条挂起指令（' + projectPath + '）：' + reason);
  }
  return settled;
}

/** 观测用：当前挂起多少条（诊断包/测试用） */
export function pendingInstructionCount(): number {
  return pending.size;
}
