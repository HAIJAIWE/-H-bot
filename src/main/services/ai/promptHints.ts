// src/main/services/ai/promptHints.ts
//
// 助手链路（services/ai/index.ts）与智能体循环入口（ipc/aiAgentCore.ts）**共用**的两段
// 提示小件。抽出来的理由不是复用好看，而是**加载面**：
// 循环入口若直接 import services/ai/index.ts，就会顺带拉起工具注册表 → 流程解释器 →
// 提案校验 → 自洽校验器整条链，连单测都得 mock 一大片；这两件只需要 node:fs / node:path。
//
// 两个函数都遵循同一条纪律：**拿不准就什么都不加**。提示里出现空路径、假路径或
// 不合规的内容，比没有这段提示更糟 —— 模型会照着它推理。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRole } from '@shared/ai/roleDomains';

/** 一轮最多接受几张图（多了既贵又没用；界面侧也会先拦一道） */
export const MAX_ROUND_IMAGES = 4;

/**
 * 记忆里给「这一轮贴过图」留个痕。
 *
 * 图片**不落盘**（一张截图 base64 就几 MB，会撑爆 1MB 上限的 JSONL）；
 * 但下一轮模型翻记忆时得知道「当时他还给我看了图」，
 * 否则它会把「你没说清楚」怪到用户头上。
 */
export function withImageNote(text: string, count: number): string {
  return count > 0 ? `${text}\n（附了 ${count} 张图，仅那一轮可见）` : text;
}

/**
 * 把「用户当前在代码编辑器里打开的是哪个文件」补进角色提示（P1-5，2026-10-15）。
 *
 * ## 为什么要有它（用户原话：「他不在代码编辑器那边工作，也就是编程智能体」）
 *
 * 用户站在代码编辑器里说「帮我改这个文件」—— 在此之前助手**没有指代对象**，
 * 只能反问「是哪个文件」或者猜一个。这份上下文只有界面知道（见 editorStore）。
 *
 * ## 三条纪律
 * · **只对代码页 / 双向（coder / duo）有意义** —— 低代码页的助手不写源码文件，
 *   塞进去只会引它去动代码，正是 M5 防串味要避免的。
 * · **拿不准就什么都不加**（绝不让提示里出现空路径 / 假路径）：空、绝对路径、
 *   带 `..` 的越界路径、含换行或反引号的路径（会撕裂提示里的引用格式）、
 *   磁盘上不存在的文件 —— 一律返回空串。
 * · 文案要**能据以行动**：明说「他说『这个文件』时指的就是它」，否则模型照样会反问。
 *
 * ⚠️ 路径来自渲染层（界面可以被绕过），所以这里再核一遍形状 —— 纵深防御，
 * 而且**丢弃比报错好**：一个不合规的路径绝不该让整轮对话发不出去。
 */
export function activeFileHintFor(role: AgentRole, projectPath: string, activeFilePath?: string): string {
  if (role !== 'coder' && role !== 'duo') return '';
  const rel = (activeFilePath ?? '').trim().replace(/\\/g, '/');
  if (!rel || !projectPath.trim() || rel.length > 300) return '';
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return ''; // 必须是项目内相对路径
  if (rel.split('/').includes('..')) return ''; // 不许越出项目
  if (/[\r\n`]/.test(rel)) return ''; // 换行/反引号会撕裂提示里的引用
  // 「打开着」是渲染层的说法，文件真在磁盘上才认（被删掉/改名后别再指着它）
  if (!existsSync(join(projectPath, rel))) return '';
  return (
    `\n\n**用户当前在代码编辑器里打开的文件**：\`${rel}\`。` +
    `他说「这个文件」「这个脚本」「它」时，指的就是这个文件 —— ` +
    `直接读写它，不要再反问是哪一个。`
  );
}
