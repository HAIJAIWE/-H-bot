// src/main/services/ai/inboxStore.ts
//
// **待办队列落盘**（2026-10-18，对齐 DSH inbox 的 durable 那一半）。
//
// 循环的"插话/排队"以前只在内存里：应用崩了、或者用户手滑关了窗口，打过的字就没了，
// 而界面上还显示它"已经说进去了" —— 与"派发 ≠ 成功"同一类问题。
//
// 存 `.qqbat/agent-inbox.json`（项目内、应用自有数据）：
//   · `step`：插话队列（下一个步边界注入，跨进程没意义，启动时清掉）；
//   · `turn`：排队的下一轮（**跨进程有意义**：崩了以后还能接着跑）。
//
// 读失败一律当空（审批/对话这条路上不能因为一个可选文件把整轮卡死）。
import { readFile } from 'fs/promises';
import { join } from 'path';
import { atomicWrite } from '../infra/fileOps';

export interface PendingInbox {
  /** 插话：下一个步边界注入当前这一轮 */
  step: string[];
  /** 排队：这一轮结束后作为新的一轮开始 */
  turn: string[];
}

export function inboxPath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'agent-inbox.json');
}

function normalize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

/** 读待办队列（任何异常 → 空队列） */
export async function loadInbox(projectPath: string): Promise<PendingInbox> {
  try {
    const raw = await readFile(inboxPath(projectPath), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PendingInbox>;
    return { step: normalize(parsed.step), turn: normalize(parsed.turn) };
  } catch {
    return { step: [], turn: [] };
  }
}

/** 写待办队列（空队列也照写：删文件是一类破坏性操作，没必要为它冒险） */
export async function saveInbox(projectPath: string, inbox: PendingInbox): Promise<void> {
  const snapshot: PendingInbox = { step: normalize(inbox.step), turn: normalize(inbox.turn) };
  await atomicWrite(inboxPath(projectPath), JSON.stringify(snapshot, null, 2) + '\n');
}
