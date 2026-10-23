// src/main/services/ai/spillStore.ts
//
// # 溢出存储：把"裁掉的东西"挪到磁盘，而不是丢掉
//
// ## 为什么（对 DSH 的实证 + 本项目的既有取舍）
//
// 本项目的工具结果预算（`toolResultBudget.ts`）原本是"**裁了就没了**"——
// 省略标记里写的是「完整内容不在上下文里，请用更窄的参数重查」。
// 而 §15.1 曾拍板「工具结果默认无上限」，动机之一正是怕裁掉之后**看不到、也找不回**。
// （2026-10-01：这个动机被本文件化解了 —— 所以默认上限**已经恢复**，
//   见 `toolResultBudget.ts` 里 `activeBudget` 的说明。）
//
// 本机 DSH 的 `dsh-spill-policy` 对同一问题的做法（原文）：
//
// > 过大的结果保持原始顺序……模型收到按原顺序保留的首尾内容，以及**完整结果文件的路径**。
// > (Omitted N bytes. Full formatted result stored at: /…/…-web_fetch.txt.
// >  Use read with offset/limit, or grep this path to search within it.)
//
// 并且它有两条硬规则：
//
// > **无法保存可恢复内容时保留原结果。**
// > **策略不会用无法读取的路径替换图片。**
//
// 也就是 **fail-open**：宁可让上下文大一点，也不给一个**没有出路的省略**。
// 本文件就是那个"存下来"的后端；`fail-open` 的判定在 `toolResultBudget.ts` 里。
//
// ## 存到哪
//
// `.qqbat/ai-spill/<时间>-<工具名>.txt` —— **跟项目走**（不是跟会话走）：
// 用户能自己在项目目录里翻到，删项目就一起删了，也不会散落在系统临时目录里。
// 文件名里的工具名会做白名单归一（工具名来自代码，但仍不直接拼进路径）。
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../infra/logger';

/** 溢出目录（相对项目根） */
export function spillDir(projectPath: string): string {
  return join(projectPath, '.qqbat', 'ai-spill');
}

/** 把工具名归一成安全的文件名片段：只留字母数字下划线短横，其余变 `-` */
function safeName(toolName: string): string {
  return toolName.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'tool';
}

/** 文件名里的时间戳：`20261001-011530-123`（本地时间，可读优先） */
function stamp(now = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-` +
    `${p(now.getMilliseconds(), 3)}`
  );
}

/**
 * 把完整结果写到磁盘。
 *
 * @returns 成功时返回**可读的绝对路径**；任何失败都返回 `undefined`（调用方据此走 fail-open）
 *
 * ⚠️ **绝不抛错**：写不成只是"这次没有恢复路径"，不该让一次工具调用失败。
 * 这与 DSH 的「存储失败……记录警告并保留原内容」是同一条规则。
 */
export async function saveSpillText(
  projectPath: string,
  toolName: string,
  text: string,
): Promise<string | undefined> {
  if (!projectPath || !text) return undefined;
  try {
    const dir = spillDir(projectPath);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${stamp()}-${safeName(toolName)}.txt`);
    await writeFile(file, text, 'utf-8');
    return file;
  } catch (e) {
    logger.warn(`[ai] 溢出入库失败（本次将保留原结果，不做不可恢复的裁剪）: ${String(e)}`);
    return undefined;
  }
}
