// src/renderer/src/lib/canvas/panelSelection.ts
//
// 「指令面板」的**纯逻辑**：从图里的指令清单，算出要发给 QQ 的面板条目。
//
// ## 它算什么
//
//   1. **挑**：哪些指令进面板（开发者亲自勾的，不是自动全塞）；
//   2. **排**：面板里的顺序；
//   3. **拼**：官方 `PanelItem`（`{type:'command', name:'/打怪', desc:'…'}`）；
//   4. **查**：官方限额（一个面板 20 条 / name ≤14 / desc ≤30）与两类漂移。
//
// ## 为什么不写在组件里
//
// 与 `commandList.ts` 同一个理由：这些全是**推导**，没有第二份数据。
// 推导写错的表现是"界面说 20 条、发出去 19 条"或"名字超长被官方静默拒绝"，
// 界面上完全看不出来 —— 所以规则必须是可测的纯函数。
//
// ## 为什么警告是**编码**不是文案
//
// 这一层是 shared 性质的推导（将来 main 进程的同步也要用），不该夹带界面文案；
// 而且本目录有"不许硬编码中文界面文案"的闸门。所以这里只回 `code` + 参数，
// 由组件用 `t()` 渲染成人话。
import type { CommandRow, PanelMeta } from '../command/commandList';

// ============================================================
// 官方硬限制（`POST /v2/panels`）
// ============================================================

/** 一个面板最多 20 个条目 */
export const QQ_PANEL_MAX_ITEMS = 20;
/** 条目名 `name` ≤14 字符（约 7 个汉字） */
export const QQ_PANEL_NAME_MAX = 14;
/** 条目描述 `desc` ≤30 字符（约 15 个汉字） */
export const QQ_PANEL_DESC_MAX = 30;

/** 面板里的一个条目（官方 `PanelItem`，本项目只用 `command` 类型） */
export interface PanelItem {
  type: 'command';
  name: string;
  desc: string;
}

/** 警告编码（组件负责翻译成人话） */
export type PanelWarningCode =
  | 'too-many' // 选超了 20 条，官方会拒
  | 'name-too-long' // 命令词太长，拼出来的 `/xxx` 超过 14 字符
  | 'desc-too-long' // 手填的描述超过 30 字符（已截断）
  | 'empty'; // 一条都没选

export interface PanelWarning {
  code: PanelWarningCode;
  /** 相关的那条指令（`triggerId`），没有具体归属时为空 */
  triggerId?: string;
  /** 出问题的文本（供界面显示"是哪一条/超了多少"） */
  detail?: string;
}

export interface PanelPlan {
  /** 按面板顺序排好的条目（已按官方限额拼好，可直接发） */
  items: PanelItem[];
  /** 勾了几条 */
  selected: number;
  /** 官方上限 */
  limit: number;
  /** 图里有、但没勾进面板的指令条数 */
  notSelected: number;
  warnings: PanelWarning[];
}

/** 把回复摘要压成一行短描述（面板里只有一格，换行会把版面撑坏） */
function replyToDesc(reply: string | null): string {
  const one = String(reply ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!one) return '';
  return cutByWidth(one, QQ_PANEL_DESC_MAX);
}

/**
 * 官方说的"字符"是**加权**的：一个汉字算 2（`name` ≤14 字符「约 7 个中文汉字」）。
 *
 * ⚠️ 用 JS 的 `.length` 会把汉字算成 1 —— 中文命令词的实际占用直接少一半，
 * 于是本地检查放行、官方拒收，而用户在界面上看不出任何异常。
 * （这条是写测试时抓到的：`/很长的命令词啊啊啊` 用 `.length` 是 10「合规」，
 * 按官方口径是 19，超了。）
 */
function qqWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
  return w;
}

/** 按官方口径截断（汉字算 2），截了就补一个省略号 */
function cutByWidth(text: string, max: number): string {
  if (qqWidth(text) <= max) return text;
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cw = (ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
    if (w + cw > max - 1) break;
    w += cw;
    out += ch;
  }
  return out + '…';
}

/**
 * 算出「要发给 QQ 的面板条目」。
 *
 * 排序规则：**给了 `order` 的按 `order` 升序在前**，没给的按图里的先后排在后面
 * （`Array.sort` 是稳定的，所以"没给 order"的那批保持图的顺序 —— 用户不填顺序时，
 * 面板顺序 = 画布顺序，符合直觉）。
 */
export function planPanelItems(rows: CommandRow[]): PanelPlan {
  const warnings: PanelWarning[] = [];
  // 子流程不是"用户能发的指令"，永远不进面板
  const pickable = rows.filter((r) => !r.isSubflow && !!r.command);
  const picked = pickable.filter((r) => r.panel.on);
  const notSelected = pickable.length - picked.length;

  const ordered = [...picked].sort((a, b) => {
    if (a.panel.order === null && b.panel.order === null) return 0;
    if (a.panel.order === null) return 1;
    if (b.panel.order === null) return -1;
    return a.panel.order - b.panel.order;
  });

  const overLimit = ordered.length > QQ_PANEL_MAX_ITEMS;
  if (overLimit) {
    warnings.push({ code: 'too-many', detail: String(ordered.length) });
  }
  if (ordered.length === 0) {
    warnings.push({ code: 'empty' });
  }

  const items: PanelItem[] = [];
  for (const row of ordered.slice(0, QQ_PANEL_MAX_ITEMS)) {
    const name = `/${row.command}`;
    if (qqWidth(name) > QQ_PANEL_NAME_MAX) {
      warnings.push({ code: 'name-too-long', triggerId: row.triggerId, detail: name });
    }
    // 手填的描述**不静默截断**：超了要报出来（静默截断会让用户以为填进去了）
    let desc = row.panel.desc;
    if (qqWidth(desc) > QQ_PANEL_DESC_MAX) {
      warnings.push({ code: 'desc-too-long', triggerId: row.triggerId, detail: desc });
      desc = cutByWidth(desc, QQ_PANEL_DESC_MAX);
    }
    // 没手填就用回复摘要兜底（它已经压过长度，不重复报）
    if (!desc) desc = replyToDesc(row.reply);
    items.push({ type: 'command', name, desc });
  }

  return { items, selected: picked.length, limit: QQ_PANEL_MAX_ITEMS, notSelected, warnings };
}

/**
 * 第二类漂移：**面板里有、图里已经没有了**。
 *
 * 这类条目**点了没反应** —— 属于本仓库反复强调的那种静默故障（用户分不清是功能坏了
 * 还是指令没了），所以必须单独报出来。
 *
 * ⚠️ 两边都要**去掉前导斜杠**再比：真机实测（2026-09-29）平台会把 `name` 的 `/` 去掉
 * （我们发 `/骰子`，`list_panels` 查回来是 `骰子`）。不归一化的话**每一条都会被判成失效**
 * —— 那比不提示更糟：一个天天喊狼来了的警告，用户第三次就不看了。
 *
 * 拿不到远端数据时**不要调用它**（调用方应显示"未获取"，不能假装"没有失效条目"）。
 */
export function findStaleItems(remoteItems: PanelItem[], rows: CommandRow[]): PanelItem[] {
  const norm = (n?: string) => String(n ?? '').replace(/^\//, '');
  const alive = new Set(
    rows.filter((r) => !r.isSubflow && r.command).map((r) => norm(r.command ?? '')),
  );
  return remoteItems.filter((it) => !alive.has(norm(it.name)));
}

/** 两边的条目是不是一模一样（决定"要不要同步"：一致就不该让用户白跑一趟） */
export function samePanelItems(a: PanelItem[], b: PanelItem[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (n?: string) => String(n ?? '').replace(/^\//, '');
  return a.every(
    (x, i) => norm(x.name) === norm(b[i].name) && (x.desc ?? '') === (b[i].desc ?? ''),
  );
}
