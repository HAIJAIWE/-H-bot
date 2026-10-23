// src/shared/message/compose.ts
//
// 「消息内容层」—— 把**布局意图**变成 QQ 官方能渲染的 markdown 与 InlineKeyboard。
//
// ## 为什么要有这一层（而不是让用户手拼字符串）
//
// 官方发送侧只有三种消息类型（`msg_type` 0 文本 / 2 markdown / 7 富媒体），
// 其中 markdown 是唯一能带排版和按钮的：支持标题、加粗、斜体、删除线、链接、
// **带尺寸的图片**、有序/无序列表、嵌套列表、块引用、水平分割线
// （见 https://bot.qq.com/wiki/develop/api-v2/server-inter/message/type/markdown.html）。
//
// 问题在于这些语法**漏进了用户的公式里**：加一条分割线要写 `***`、排列表要手拼 `·` 和换行、
// 对齐 `生命 821/821` 要自己数字符。真机事故也出在这里 —— `/商店` 的文案我用
// `JSON.stringify(lines.join('\\n'))` 拼，双重转义后渲染出的是**字面反斜杠 n**，菜单挤成一行。
//
// 这一层的职责：用户说"我要一张卡、标题是这个、这两行是属性、按钮排两列"，
// 由这里决定 markdown 长什么样、按钮怎么排、超限怎么办。
//
// ## 与传输层的关系
//
// 本模块**不发送任何东西**，只产出 `{ markdown, keyboard }`：
//   · `markdown` 给 `message_send(mode='keyboard')` 的 markdown 端口（必须非空，否则 QQ 不渲染按钮）
//   · `keyboard` 给它同名的端口（QQ 要求自定义键盘包在 `content` 里并带 `bot_appid`，
//     那一步由传输层 `wrapKeyboardForApi` 负责，这里只给 `{ rows }`）

// ============================================================
// QQ 官方硬限制（写在这里，超限时由本层主动裁剪，而不是让 API 报错）
// ============================================================

/** 单条消息最多 5 行按钮（QQ 官方限制） */
export const QQ_KEYBOARD_MAX_ROWS = 5;

/** 每行最多 5 个按钮（QQ 官方限制） */
export const QQ_KEYBOARD_MAX_PER_ROW = 5;

/** 按钮 `action.data` 的最大长度（官方要求 ≤ 200，我们留余量） */
export const QQ_BUTTON_DATA_MAX = 180;

/** 按钮文字的最大长度（太长官方会截断，截断位置不可控，所以自己截） */
export const QQ_BUTTON_LABEL_MAX = 12;

// ============================================================
// Markdown 片段
// ============================================================

/**
 * 一行文本。
 *
 * ⚠️ **换行必须交给这里拼**，不要在公式里写 `+ "\\n"`。
 * 用 `JSON.stringify` 包一次字符串会把 `\n` 变成字面反斜杠 n（实测踩过），
 * 而本模块内部用的是**真实的行数组 + join**，不存在二次转义。
 */
export function mdLine(text: string): string {
  return String(text ?? '');
}

/** `# 标题`：QQ 渲染成加粗大字（图里的「世界的回响」就是这个） */
export function mdTitle(text: string, level: 1 | 2 | 3 = 1): string {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return `${'#'.repeat(level)} ${t}`;
}

/** `**加粗**`：正文里的强调（图里的「【哥布林战士】达成」） */
export function mdBold(text: string): string {
  const t = String(text ?? '');
  return t ? `**${t}**` : '';
}

/** `_斜体_` */
export function mdItalic(text: string): string {
  const t = String(text ?? '');
  return t ? `_${t}_` : '';
}

/** `~~删除线~~` */
export function mdStrike(text: string): string {
  const t = String(text ?? '');
  return t ? `~~${t}~~` : '';
}

/** `[文字](url)`：可点击链接 */
export function mdLink(label: string, url: string): string {
  const l = String(label ?? '');
  const u = String(url ?? '').trim();
  if (!l || !u) return l;
  return `[${l}](${u})`;
}

/**
 * `![alt #宽px #高px](url)`：markdown 内图片。
 *
 * 官方要求 url **公网可访问**（开放平台会下载转存）。宽高可省略，
 * 给了尺寸才不会被渲染成原始大小撑满屏幕 —— 卡片头图基本都要给。
 */
export function mdImage(
  url: string,
  opts: { alt?: string; width?: number; height?: number } = {},
): string {
  const u = String(url ?? '').trim();
  if (!u) return '';
  const size = [opts.width ? `#${opts.width}px` : '', opts.height ? `#${opts.height}px` : ''].join(
    '',
  );
  return `![${opts.alt ?? ''}${size}](${u})`;
}

/**
 * `> 引用`：图1 里「海岸很宽，也不是每一步都归它管。」那根灰竖线的效果。
 *
 * 官方语法是**逐行**加 `> `，多行要给每一行都加，否则只有第一行进引用块。
 */
export function mdQuote(text: string): string {
  const raw = String(text ?? '');
  if (!raw.trim()) return '';
  return raw
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n');
}

/** `***`：水平分割线（图2 里各属性组之间的横线） */
export function mdDivider(): string {
  return '***';
}

/** 无序列表；`items` 里的元素是**单行文本**（多行请自己拆成多项） */
export function mdBullets(items: readonly unknown[]): string {
  return (items ?? [])
    .map((i) => String(i ?? '').trim())
    .filter(Boolean)
    .map((i) => `- ${i}`)
    .join('\n');
}

/** 有序列表（QQ 支持 `1.` 自动编号，这里显式写序号更可控） */
export function mdNumbered(items: readonly unknown[]): string {
  return (items ?? [])
    .map((i) => String(i ?? '').trim())
    .filter(Boolean)
    .map((i, idx) => `${idx + 1}. ${i}`)
    .join('\n');
}

/**
 * 一组 `名称 值` 行（图2 的「等级：Lv3 / 经验：0/100」那种排版）。
 *
 * ## 对齐怎么算的（真机 + 计算都调过）
 *
 * 直觉做法是"把中文按 2 个宽度算，再用**半角**空格补齐"—— **那样是不齐的**：
 * 实测 `等级/经验/生命` 排出 9/11/13 的显示宽度。QQ 是**比例字体**，
 * 一个中文字 ≈ 两个拉丁字但**不精确**，误差行行累积。
 *
 * 现在用**全角空格**（U+3000）跳到目标列：全角空格 ≈ 一个汉字宽，与标签本身同一量级，
 * 误差不会累积。目标列取 `maxW + 2`，保证每个标签后至少一个全角空格（不会贴住）。
 *
 * 换算成"U+3000 个数"时按 2 宽 = 1 个全角空格折算，并对**奇数差**取整 ——
 * 于是各行结束时的显示宽度最多相差 1（比例字体下这是能达到的最优，再追求严格等宽没有意义）。
 */
export function mdKeyValues(pairs: readonly (readonly [unknown, unknown])[]): string {
  const rows = (pairs ?? [])
    .map((p) => [String(p?.[0] ?? '').trim(), String(p?.[1] ?? '').trim()] as const)
    .filter(([k]) => k);
  if (!rows.length) return '';
  const target = Math.max(...rows.map(([k]) => displayWidth(k))) + 2;
  return rows
    .map(([k, v]) => {
      const pad = Math.max(1, Math.round((target - displayWidth(k)) / 2));
      return `${k}${'　'.repeat(pad)}${v}`;
    })
    .join('\n');
}

/**
 * 条形进度（图2 里名字下面那排点）。
 *
 * 官方 markdown 没有进度条语法，只能用字符画 —— 但效果就是图里那种。
 * `filled` 用实心块、其余用浅色块，宽度固定，避免不同数值下行宽跳动。
 */
export function mdBar(current: unknown, max: unknown, width = 12): string {
  const cur = Math.max(0, Number(current) || 0);
  const top = Math.max(1, Number(max) || 1);
  const w = Math.max(1, Math.min(40, Math.floor(width)));
  const filled = Math.max(0, Math.min(w, Math.round((cur / top) * w)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(w - filled)}`;
}

/** 把多个片段拼成 markdown，**空片段自动跳过**（不会留下空行；空行在 QQ 里会拉开很大间距） */
export function mdJoin(parts: readonly (string | null | undefined)[]): string {
  return (parts ?? [])
    .map((p) => (p === null || p === undefined ? '' : String(p)))
    .filter((p) => p.trim() !== '')
    .join('\n');
}

/**
 * 段间距：QQ 的 markdown **一个空行**就能拉开明显间距（官方文档专门讲了"换多行"）。
 * 用来在卡片的分组之间插白，比堆 `\n\n\n` 可控。
 */
export const MD_GAP = '\u200B';

/**
 * 显示宽度（中文/全角算 2，其余算 1）。
 *
 * 用于 `mdKeyValues` 的对齐：QQ 的字体不是等宽，但对齐到"全角宽度"在手机上看起来是齐的。
 * 用 `String.length` 会把中文算 1，导致「等级」和「经验」两行差半格。
 */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x2e80 ? 2 : 1;
  }
  return w;
}

// ============================================================
// 按钮（InlineKeyboard）
// ============================================================

/** QQ 按钮动作类型：0=链接跳转，1=回调后台，2=发送指令（当前运行时只支持 0 与 2） */
export type ButtonActionType = 0 | 1 | 2;

/** 用户写按钮时能给的形状（宽进严出：渲染前一律归一化成 QQ 要求的完整结构） */
export interface ButtonInput {
  /** 按钮文字 */
  label?: string;
  /** 简写：等价于 `label` */
  text?: string;
  /** 点击后发出的指令文本（`type=2`），例如 `/购买 金创药` */
  data?: string;
  /** 点击后打开的链接（`type=0`），给了 url 且没给 type 时自动判定为 0 */
  url?: string;
  /** 显式指定动作类型；不填时按 `url` / `data` 推断 */
  type?: ButtonActionType;
  /** 0=灰色线框（次要），1=蓝色线框（主要）；默认 1 */
  style?: 0 | 1;
  /** 点击后显示的文字（QQ 必填字段）；默认与 label 相同 */
  visitedLabel?: string;
  /** 按钮 id（QQ 要求字符串；不填自动生成 `btn_<行>_<列>`） */
  id?: string;
  /** 客户端不支持按钮时的兜底提示（QQ 必填字段）；默认按 data/url 生成 */
  unsupportTips?: string;
}

/** QQ 要求的按钮结构（渲染结果） */
export interface QQButton {
  id: string;
  render_data: { label: string; visited_label: string; style: 0 | 1 };
  action: {
    type: ButtonActionType;
    permission: { type: 2 };
    data: string;
    unsupport_tips: string;
  };
}

export interface QQKeyboard {
  rows: { buttons: QQButton[] }[];
}

export interface BuildKeyboardResult {
  keyboard: QQKeyboard;
  /** 因超限被丢掉、或参数不完整被跳过的按钮说明（**不静默丢**，交给调用方报出来） */
  warnings: string[];
}

function cut(text: string, max: number): string {
  const t = String(text ?? '');
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

/**
 * 把用户写的按钮行归一化成 QQ 的 InlineKeyboard。
 *
 * 宽进的三种写法都认：
 *   · `"金创药"`                          → 文字与 data 相同
 *   · `"/购买 金创药"`                     → 文字=data
 *   · `["搜一下", "https://example.com"]`  → [文字, 链接]
 *   · `{ label, data }` / `{ label, url }` → 完整写法
 *
 * 严出的地方（都是官方硬要求，漏了按钮就不渲染或点了没反应）：
 *   · `render_data.visited_label` 与 `action.unsupport_tips` **必填**，这里自动补
 *   · `action.permission.type = 2`（所有人可点）
 *   · 行数 ≤ 5、每行 ≤ 5、label ≤ 12 字、data ≤ 180 字
 *
 * **空按钮行会被整行丢掉**（`[]` 或全是空值），这样"根据状态决定有没有按钮"不需要额外分支。
 */
export function buildKeyboard(rows: readonly unknown[]): BuildKeyboardResult {
  const warnings: string[] = [];
  const out: QQKeyboard['rows'] = [];

  for (const rawRow of rows ?? []) {
    // `rows` 的元素**必须是一行按钮的数组**。给单个按钮对象/字符串也容忍（当成一行一个）。
    const rowItems: unknown[] = Array.isArray(rawRow) ? rawRow : [rawRow];
    const buttons: QQButton[] = [];

    for (const raw of rowItems) {
      // 元素只能是"单个按钮"（字符串或对象）。数组不在这里展开 ——
      // 展开是**行**语义，见本函数上方 `rows` 的处理。
      const b = normalizeOne(raw);
      if (!b) {
        if (raw !== null && raw !== undefined && raw !== '') {
          warnings.push(`跳过无效按钮: ${JSON.stringify(raw).slice(0, 60)}`);
        }
        continue;
      }
      if (buttons.length >= QQ_KEYBOARD_MAX_PER_ROW) {
        warnings.push(
          `一行最多 ${QQ_KEYBOARD_MAX_PER_ROW} 个按钮，「${b.render_data.label}」被丢掉`,
        );
        continue;
      }
      buttons.push(b);
    }

    if (!buttons.length) continue;
    if (out.length >= QQ_KEYBOARD_MAX_ROWS) {
      warnings.push(
        `一条消息最多 ${QQ_KEYBOARD_MAX_ROWS} 行按钮，第 ${out.length + 1} 行（${buttons[0].render_data.label}…）被丢掉`,
      );
      continue;
    }
    out.push({ buttons });
  }

  // 补 id（QQ 要求唯一；放在最后是为了让"被丢掉的行"不占用列号）
  for (let r = 0; r < out.length; r++) {
    for (let c = 0; c < out[r].buttons.length; c++) {
      if (!out[r].buttons[c].id) out[r].buttons[c].id = `btn_${r}_${c}`;
    }
  }

  // 纯展示按钮（既没 data 也没 url）：点下去客户端不会做任何事。
  // 不拦（有人确实要个"标签"），但必须说出来 —— 否则用户会以为点了会有反应。
  for (const row of out) {
    for (const b of row.buttons) {
      if (!b.action.data) {
        warnings.push(`按钮「${b.render_data.label}」没有命令也没有链接，点了不会有反应`);
      }
    }
  }

  return { keyboard: { rows: out }, warnings };
}

/**
 * 归一化**单个**按钮；无法识别的形状返回 null（由调用方记 warning）。
 *
 * 「一行按钮」是数组，这件事在 `buildKeyboard` 处理 —— 这里**只认单个按钮**：
 * 字符串（文字=命令）、数字、对象。
 *
 * ⚠️ 不要在这里猜 `['文字', 'https://…']` 是"一个带链接的按钮"：
 * 它和 `['/攻击', '/防御']`（两个按钮）在语法上无法区分，而猜错的后果是
 * 按钮文字变成第一个字符（实测 `String(raw[0])` 取出 `'官'`，因为 `raw[0]` 已经是 `'官网'`，
 * 外层再取一次 `[0]` 就拿到了字符串的首字符）。
 * 要"文字 + 链接"请写对象：`{ label: '官网', url: 'https://…' }`。
 */
function normalizeOne(raw: unknown): QQButton | null {
  let label = '';
  let data = '';
  let url = '';
  /** 用户**显式给了** url 字段（哪怕值是空串）。区分"没给"与"给了但是空" —— 两件事不一样 */
  let urlProvided = false;
  let style: 0 | 1 = 1;
  let type: ButtonActionType | undefined;
  let id = '';
  let visitedLabel = '';
  let unsupportTips = '';

  if (typeof raw === 'string' || typeof raw === 'number') {
    label = String(raw);
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as ButtonInput;
    label = String(o.label ?? o.text ?? '');
    data = o.data === undefined || o.data === null ? '' : String(o.data);
    urlProvided = o.url !== undefined && o.url !== null;
    url = urlProvided ? String(o.url) : '';
    style = o.style === 0 ? 0 : 1;
    type = o.type;
    id = o.id ? String(o.id) : '';
    visitedLabel = o.visitedLabel ? String(o.visitedLabel) : '';
    unsupportTips = o.unsupportTips ? String(o.unsupportTips) : '';
  } else {
    return null;
  }

  label = label.trim();
  data = data.trim();
  url = url.trim();

  // 空值兜底分两步，因为"文字就是命令"与"文字就是链接"是不同意图：
  //   1) 文字为空 → 用 data/url 顶上（`{ data: '/购买 铁剑' }` 这种写法）
  //   2) 既没 data 也没 url **且用户没打算做链接** → 把文字当命令（`'金创药'` 这种写法）
  // ⚠️ 第 2 步必须排除 `urlProvided`：写了 `url: ''` 的人意图是"链接按钮但没填地址"，
  // 悄悄把它改成"点了发一条消息"是**换语义**；留着"没有动作"、由 warning 报出来才对。
  if (!label) label = data || url;
  if (label && !data && !url && !urlProvided) data = label;

  if (!label && !data && !url) return null;

  const actionType: ButtonActionType = type ?? (url ? 0 : 2);
  // 链接按钮取 url；其余取 data。两者都空时 actionType 是 2、data 也是空 ——
  // 这种按钮点了没反应，由下面的 warning 说出来（不静默）。
  const payload = actionType === 0 ? url : data;

  return {
    id,
    render_data: {
      label: cut(label, QQ_BUTTON_LABEL_MAX),
      visited_label: cut(visitedLabel || label, QQ_BUTTON_LABEL_MAX),
      style,
    },
    action: {
      type: actionType,
      permission: { type: 2 },
      data: cut(payload, QQ_BUTTON_DATA_MAX),
      unsupport_tips: cut(
        unsupportTips ||
          (actionType === 0 ? `请手动打开 ${url}` : `当前客户端不支持按钮，请直接发送 ${data}`),
        60,
      ),
    },
  };
}

/**
 * 按钮预算检查（**发送前**告诉用户哪里超了，而不是让 QQ 静默不渲染）。
 * 返回空数组 = 没问题。
 */
export function checkKeyboardBudget(keyboard: QQKeyboard): string[] {
  const problems: string[] = [];
  const rows = keyboard?.rows ?? [];
  if (rows.length > QQ_KEYBOARD_MAX_ROWS) {
    problems.push(`按钮 ${rows.length} 行，超过官方上限 ${QQ_KEYBOARD_MAX_ROWS} 行`);
  }
  rows.forEach((r, i) => {
    if (r.buttons.length > QQ_KEYBOARD_MAX_PER_ROW) {
      problems.push(
        `第 ${i + 1} 行有 ${r.buttons.length} 个按钮，超过上限 ${QQ_KEYBOARD_MAX_PER_ROW} 个`,
      );
    }
  });
  return problems;
}

// ============================================================
// 可点指令（markdown 内嵌文本交互）
// ============================================================

/**
 * 可点指令的文本长度上限（官方：`text` / `show` 各 ≤ 100 字符）。
 *
 * 注意这个 100 是**原文**长度 —— 官方要求"传值时需要 urlencode"，
 * 编码后会更长（中文 1 字 → 9 个字符），所以不能拿编码后的长度去卡。
 */
export const QQ_INLINE_CMD_MAX = 100;

/**
 * 两种可点指令（官方名见
 * https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html）：
 *
 *   · `input` —— **参数指令** `<qqbot-cmd-input>`：点一下把指令**填进输入框**，用户自己按发送。
 *   · `enter` —— **回车指令** `<qqbot-cmd-enter>`：点一下**直接发出去**。
 *     ⚠️ 官方原文：「群聊和文字子频道**不支持**该能力」—— 群里发出去客户端不渲染成可点标签。
 */
export type InlineCommandMode = 'input' | 'enter';

/** 用户写「可点指令」时能给的形状（与 `ButtonInput` 同一套宽进习惯） */
export interface InlineCommandInput {
  /** 消息里**显示**的那段文字（官方 `show`）。不填时取 `data`/`command` */
  label?: string;
  /** 简写：等价于 `label` */
  show?: string;
  /** 点击后填入/发出的指令文本，例如 `/签到` */
  data?: string;
  /** 简写：等价于 `data` */
  command?: string;
  /** 默认 `input`（参数指令，全场景可用）；`enter`（回车指令，群聊不支持） */
  mode?: InlineCommandMode;
  /** 仅 `input`：插入输入框时是否带原消息的引用回复（官方 `reference`，默认 false） */
  reference?: boolean;
}

/** `InlineCommandInput` 认得的字段名 —— 用来把"少写一个字母"的笔误查出来（见 `normalizeInlineOne`） */
const INLINE_COMMAND_KEYS = new Set(['label', 'show', 'data', 'command', 'mode', 'reference']);

/**
 * `<qqbot-cmd-input … />` / `<qqbot-cmd-enter … />` —— 消息正文里**可以点的一段文字**。
 *
 * 与「按钮」（`keyboard`）的区别（这是两套完全不同的官方能力，别混）：
 *   · 按钮：消息**下方**客户端画的方块，结构化字段，走 `keyboard`；
 *   · 可点指令：写在**正文里**的一段字，纯 markdown 文本，随消息内容一起发出去。
 *
 * 两个参数**都必须 urlencode**（官方原文），否则客户端不认；`/` 会被编码成 `%2F`，这是对的。
 *
 * @param command 点击后填入/发出的指令，如 `/签到`
 * @param opts.show 消息里显示的文字（默认与 command 相同）
 * @param opts.mode `input`（默认）或 `enter`
 */
export function mdInlineCommand(
  command: unknown,
  opts: { show?: unknown; mode?: InlineCommandMode; reference?: unknown } = {},
): string {
  const cmd = cut(String(command ?? '').trim(), QQ_INLINE_CMD_MAX);
  if (!cmd) return '';
  const encoded = encodeURIComponent(cmd);

  if (opts.mode === 'enter') {
    return `<qqbot-cmd-enter text="${encoded}" />`;
  }

  const show = cut(String(opts.show ?? '').trim() || cmd, QQ_INLINE_CMD_MAX);
  const reference = opts.reference === true || opts.reference === 'true' ? ' reference="true"' : '';
  return `<qqbot-cmd-input text="${encoded}" show="${encodeURIComponent(show)}"${reference} />`;
}

export interface BuildInlineCommandsResult {
  /** 每一项是**一行**（同一行里的多个标签用空格隔开） */
  lines: string[];
  warnings: string[];
}

/**
 * 把用户写的「可点指令」归一化成 markdown 行。
 *
 * 行/列语义与 `buildKeyboard` 的 `buttons` **完全一致**（同一套记忆）：
 *   · 外层数组 = 每项一行；内层数组 = 同一行里的多个标签
 *   · `"/签到"`                            → 显示与指令都是 `/签到`
 *   · `{ label: "[签到]", data: "/签到" }`  → 显示「[签到]」，点一下填 `/签到`
 *   · 空行/空值自动跳过（这样"根据状态决定有没有这一行"不需要额外分支）
 *
 * 两种失败**不静默**：`enter`（群聊点了没反应）、以及"看着像标签但其实没给指令"。
 */
export function buildInlineCommands(rows: readonly unknown[]): BuildInlineCommandsResult {
  const warnings: string[] = [];
  const lines: string[] = [];

  for (const rawRow of rows ?? []) {
    const rowItems: unknown[] = Array.isArray(rawRow) ? rawRow : [rawRow];
    const tags: string[] = [];
    for (const raw of rowItems) {
      const tag = normalizeInlineOne(raw, warnings);
      if (tag) tags.push(tag);
    }
    if (tags.length) lines.push(tags.join(' '));
  }

  // 同一句话按标签重复报没有意义（一行 5 个回车指令 = 5 条一模一样的提示）
  return { lines, warnings: [...new Set(warnings)] };
}

/** 归一化**单个**可点指令；空值返回空串（静默跳过），形状不认识时记 warning */
function normalizeInlineOne(raw: unknown, warnings: string[]): string {
  let show = '';
  let data = '';
  let mode: InlineCommandMode = 'input';
  let reference: unknown;

  if (typeof raw === 'string' || typeof raw === 'number') {
    show = String(raw);
    data = String(raw);
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as InlineCommandInput;
    show = String(o.show ?? o.label ?? '');
    data = String(o.data ?? o.command ?? '');
    if (o.mode === 'enter') mode = 'enter';
    reference = o.reference;
    // 认不出的字段是笔误（`{lable:"[签到]"}` 少写一个 e）。**不管后面能不能拼出标签都要说** ——
    // 拼出来了说明用户想要的显示文字被悄悄丢了（客户端只会显示命令本身）。
    const unknownKeys = Object.keys(raw as Record<string, unknown>).filter(
      (k) => !INLINE_COMMAND_KEYS.has(k),
    );
    if (unknownKeys.length) {
      warnings.push(
        `可点指令里有认不出的字段 ${unknownKeys.join('/')}（已忽略）: ${JSON.stringify(raw).slice(0, 60)}`,
      );
    }
  } else {
    if (raw !== null && raw !== undefined && raw !== '') {
      warnings.push(`跳过无效的可点指令: ${JSON.stringify(raw).slice(0, 60)}`);
    }
    return '';
  }

  show = show.trim();
  data = data.trim();
  // 与按钮同一套兜底：只给一边时另一边用同一个值（`"/签到"` 这种写法）
  if (!data) data = show;
  if (!show) show = data;
  if (!data) {
    // 空值静默跳过：这既是"根据状态决定有没有这一行"，也是编辑器里**还没填完**的那一行。
    // （笔误已经在上面按字段名报过了，不重复报。）
    return '';
  }

  if (data.length > QQ_INLINE_CMD_MAX) {
    warnings.push(`可点指令「${data.slice(0, 20)}…」超过官方上限 ${QQ_INLINE_CMD_MAX} 字，已截断`);
  }
  if (show.length > QQ_INLINE_CMD_MAX) {
    warnings.push(
      `可点指令的文字「${show.slice(0, 20)}…」超过官方上限 ${QQ_INLINE_CMD_MAX} 字，已截断`,
    );
  }

  // 「[签到]」这种写法只给了显示文字，没给指令 —— 点下去填进输入框的是 `[签到]` 本身，
  // 不是一条能用的命令。这是最容易犯的错（方括号本来就是本功能的书写习惯），必须说出来。
  if (data.startsWith('[')) {
    warnings.push(
      `可点指令「${data}」没单独给命令 —— 点击后填进输入框的就是「${data}」这串字本身。` +
        `要发 \`/签到\` 请写成 { label: "${data}", data: "/签到" }`,
    );
  }

  if (mode === 'enter') {
    warnings.push(
      '用了「回车指令」（点击直接发送）：官方明确**群聊和文字子频道不支持**，群里发了不会渲染成可点标签。' +
        '群聊请用默认的「参数指令」（点击填入输入框）。',
    );
  }

  return mdInlineCommand(data, { show, mode, reference });
}

// ============================================================
// 组合：卡片 / 列表
// ============================================================

/** 状态条（血条/经验条那种），挂在某一行下面 */
export interface ComposeBar {
  current: unknown;
  max: unknown;
  width?: number;
}

export interface ComposeCardOptions {
  title?: unknown;
  /** 标题下的一行小字，常用于 `【哥布林战士】达成` 这种"谁/什么状态" */
  subtitle?: unknown;
  /** 正文行（数组，每项一行） */
  body?: readonly unknown[];
  /** `名称 值` 属性表（自动对齐） */
  stats?: readonly (readonly [unknown, unknown])[];
  /** 进度条（放在 stats 之后） */
  bars?: readonly ComposeBar[];
  /**
   * 正文里的「可点指令」标签行（点一下填指令 / 发指令），放在进度条之后、引用之前。
   *
   * 与 `buttons` 是**两套不同的官方能力**：这里产出的是 markdown 正文里的一段可点文字，
   * 不占用按钮 5 行的预算，客户端不支持按钮时也能用。形状见 `buildInlineCommands`。
   */
  inlineCommands?: readonly unknown[];
  /** 引用块（图1 那根灰竖线） */
  quote?: unknown;
  /** 底部的奖励/结果行 */
  footer?: unknown;
  /** 按钮行；空行自动丢弃 */
  buttons?: readonly unknown[];
  /** 标题级别，默认 1 */
  titleLevel?: 1 | 2 | 3;
}

export interface ComposeResult {
  markdown: string;
  keyboard: QQKeyboard;
  warnings: string[];
}

/**
 * 拼一张卡片：标题 + 副标题 + 正文 + 属性表 + 进度条 + 引用 + 页脚 + 按钮。
 *
 * 只给真正有内容的段落留位置（空段落不产生空行）—— 这是"看起来像卡片"的关键：
 * 图1/图2 之所以干净，是因为没有一堆空行把内容冲散。
 */
export function composeCard(opts: ComposeCardOptions = {}): ComposeResult {
  const parts: string[] = [];

  const title = String(opts.title ?? '').trim();
  if (title) parts.push(mdTitle(title, opts.titleLevel ?? 1));

  const subtitle = String(opts.subtitle ?? '').trim();
  if (subtitle) parts.push(mdBold(subtitle));

  const body = (opts.body ?? []).map((l) => String(l ?? '').trim()).filter(Boolean);
  if (body.length) parts.push(body.join('\n'));

  const stats = (opts.stats ?? []).filter((p) => String(p?.[0] ?? '').trim());
  if (stats.length) parts.push(mdKeyValues(stats));

  const bars = (opts.bars ?? []).filter((b) => b && (Number(b.max) || 0) > 0);
  if (bars.length) parts.push(bars.map((b) => mdBar(b.current, b.max, b.width)).join('\n'));

  const inline = buildInlineCommands(opts.inlineCommands ?? []);
  if (inline.lines.length) parts.push(inline.lines.join('\n'));

  const quote = String(opts.quote ?? '').trim();
  if (quote) {
    parts.push(MD_GAP);
    parts.push(mdQuote(quote));
  }

  const footer = String(opts.footer ?? '').trim();
  if (footer) {
    parts.push(MD_GAP);
    parts.push(footer);
  }

  const { keyboard, warnings } = buildKeyboard(opts.buttons ?? []);
  warnings.push(...inline.warnings);
  return { markdown: mdJoin(parts), keyboard, warnings };
}

// ============================================================
// 组合：回合制战斗面板
// ============================================================

/** 战斗双方的一方（怪物 / 玩家） */
export interface BattleSide {
  /** 显示名（缺省时怪物叫「怪物」、玩家叫「你」） */
  name?: unknown;
  /** 等级；给了就拼到标题/名称里 */
  level?: unknown;
  /** 血量 */
  hp?: unknown;
  /** 血量上限 */
  maxHp?: unknown;
  /** 蓝量（可选，只有玩家常配） */
  mp?: unknown;
  maxMp?: unknown;
  /** 血条格数，默认 12 */
  barWidth?: unknown;
}

export interface ComposeBattleOptions {
  monster?: BattleSide;
  player?: BattleSide;
  /** 当前回合数 */
  round?: unknown;
  /** 本回合战斗日志（每项一行） */
  log?: readonly unknown[];
  /** 怪物名下面那行小字，如「普通怪物」「精英」「BOSS」 */
  monsterTag?: unknown;
  /** 页脚：掉落 / 奖励 / 提示 */
  footer?: unknown;
  /**
   * 行动按钮。默认 `普攻 / 技能 / 道具 / 逃跑`。
   *
   * 元素可以是字符串（文字=点击后发出的命令），也可以是 `{label, data}` 对象
   * —— 与 `composeCard` 的按钮同一套写法，`buildKeyboard` 负责归一化与超限处理。
   */
  actions?: readonly unknown[];
  /**
   * 按钮命令前缀：最终 `data = prefix + 按钮文字`。
   *
   * 例：前缀填 `/战斗 `，按钮「普攻」点击后发出的是 `/战斗 普攻`。
   * 留空则直接发出按钮文字（适合已有"上一条消息即命令"的流程）。
   */
  commandPrefix?: unknown;
  /** 标题级别，默认 1 */
  titleLevel?: 1 | 2 | 3;
}

/** 一方的「名字 + 血条」行；血条上限为 0 时不出这条（避免 0/0 的假条） */
function battleSideLine(
  side: BattleSide | undefined,
  fallbackName: string,
): readonly [string, string] | null {
  const name = String(side?.name ?? '').trim() || fallbackName;
  const max = Number(side?.maxHp ?? 0) || 0;
  if (max <= 0) return null;
  const cur = Math.max(0, Math.min(max, Number(side?.hp ?? 0) || 0));
  const bar = mdBar(cur, max, Number(side?.barWidth ?? 0) || 12);
  return [name, `${bar} ${cur}/${max}`] as const;
}

/**
 * 拼一张**回合制战斗面板**：怪物信息 + 玩家信息 + 回合日志 + 行动按钮。
 *
 * ## 为什么是这个形状（官方能力的硬约束，不是设计偏好）
 *
 *   1. **改不了已发出的消息**：官方没有「编辑消息」接口（只能撤回重发），
 *      所以每一回合都是**发一条新的完整面板**，而不是"原地刷新数值"；
 *   2. **按钮文字在发出时就固定了**：`render_data.label` 不能事后改，
 *      所以按钮上不能显示"血量/次数"这类会变的东西 —— 它们放在正文里；
 *   3. markdown 没有表格/代码块，能用的是标题、加粗、引用、列表、分割线，
 *      进度条只能用字符画（`mdBar`）。这里只用了官方明确列出的语法。
 *
 * 于是"动态数值"是这样实现的：**每回合重发一条**，数值在正文里更新。
 */
export function composeBattle(opts: ComposeBattleOptions = {}): ComposeResult {
  const parts: string[] = [];

  const monster = opts.monster ?? {};
  const mName = String(monster.name ?? '').trim() || '怪物';
  const mLevel = String(monster.level ?? '').trim();
  parts.push(mdTitle(`⚔️ ${mName}${mLevel ? ` Lv.${mLevel}` : ''}`, opts.titleLevel ?? 1));

  const tag = String(opts.monsterTag ?? '').trim();
  if (tag) parts.push(mdBold(tag));

  // 怪物与玩家的血条对齐成一列（mdKeyValues 会按显示宽度补全角空格）
  const lines = [battleSideLine(monster, '怪物'), battleSideLine(opts.player, '你')].filter(
    (l): l is readonly [string, string] => l !== null,
  );
  const mpLine = battleSideLine(
    {
      name: '法力',
      hp: opts.player?.mp,
      maxHp: opts.player?.maxMp,
      barWidth: opts.player?.barWidth,
    },
    '法力',
  );
  if (mpLine) lines.push(mpLine);
  if (lines.length) parts.push(mdKeyValues(lines));

  const round = String(opts.round ?? '').trim();
  const log = (opts.log ?? []).map((l) => String(l ?? '').trim()).filter(Boolean);
  if (round || log.length) {
    parts.push(mdDivider());
    if (round) parts.push(mdBold(`第 ${round} 回合`));
    if (log.length) parts.push(log.join('\n'));
  }

  const footer = String(opts.footer ?? '').trim();
  if (footer) {
    parts.push(MD_GAP);
    parts.push(mdQuote(footer));
  }

  // 行动按钮：默认四件套；前缀拼在文字前面（`/战斗 ` + `普攻`）
  const prefix = String(opts.commandPrefix ?? '');
  const rawActions =
    opts.actions && opts.actions.length ? opts.actions : ['普攻', '技能', '道具', '逃跑'];
  const buttons = rawActions.map((a) => {
    if (a && typeof a === 'object' && !Array.isArray(a)) return a;
    return { label: String(a ?? ''), data: `${prefix}${String(a ?? '')}` };
  });

  const { keyboard, warnings } = buildKeyboard([buttons]);
  return { markdown: mdJoin(parts), keyboard, warnings };
}

export interface ComposeListOptions {
  title?: unknown;
  /** 列表项（每项一行，自动加 `- `） */
  items?: readonly unknown[];
  /** 页脚（如"用法：/购买 物品名"） */
  footer?: unknown;
  /** 空列表时的提示文案 */
  emptyText?: unknown;
  buttons?: readonly unknown[];
  /** 正文里的「可点指令」标签行，放在条目之后、页脚之前（语义同 `ComposeCardOptions.inlineCommands`） */
  inlineCommands?: readonly unknown[];
  titleLevel?: 1 | 2 | 3;
  /**
   * 分页。给了就按页切 `items` **和** `buttons`，并在按钮最后追加一行翻页按钮。
   *
   * 为什么要有：QQ 一条消息最多 **5 行按钮**（见 `QQ_KEYBOARD_MAX_ROWS`）。
   * 条目一多就必然装不下 —— 要么裁掉（用户看得见却点不到），
   * 要么分页。`/商店` 现在用"分类"解决，但分类也会满，分页是通用解。
   */
  paging?: ListPaging;
}

export interface ListPaging {
  /** 当前页（**1 起**；越界会被夹到有效范围） */
  page?: unknown;
  /** 每页几条（默认 8）。会被压到"翻页行 + 固定行"之外还剩的预算内 */
  pageSize?: unknown;
  /** 生成翻页按钮发出的指令，如 `/商店 weapon`（会自动补 " 第几页"） */
  commandPrefix?: unknown;
  /** 固定行（每页都出现，如「« 返回分类」）。它们**占用按钮行预算**，分页时会先扣掉 */
  fixedRows?: readonly unknown[];
  /** 页脚后缀，如"发 /商店 回分类" */
  footerHint?: unknown;
}

/**
 * 拼一个列表消息（`/商店`、`/排行` 这类）。
 *
 * 与 `composeCard` 分开是因为列表有**空态**语义：没有数据时要给一句提示，
 * 而不是渲染一个空标题。卡片不需要空态（卡片本身就是"某件事发生的结果"）。
 */
export function composeList(opts: ComposeListOptions = {}): ComposeResult {
  const allItems = (opts.items ?? []).map((i) => String(i ?? '').trim()).filter(Boolean);

  if (!opts.paging) {
    const parts: string[] = [];
    const title = String(opts.title ?? '').trim();
    if (title) parts.push(mdTitle(title, opts.titleLevel ?? 1));
    parts.push(allItems.length ? mdBullets(allItems) : String(opts.emptyText ?? '').trim() || '—');
    const inline = buildInlineCommands(opts.inlineCommands ?? []);
    if (inline.lines.length) parts.push(inline.lines.join('\n'));
    const footer = String(opts.footer ?? '').trim();
    if (footer) {
      parts.push(MD_GAP);
      parts.push(footer);
    }
    const { keyboard, warnings } = buildKeyboard(opts.buttons ?? []);
    warnings.push(...inline.warnings);
    return { markdown: mdJoin(parts), keyboard, warnings };
  }

  // ── 分页 ──────────────────────────────────────────────────────
  const warnings: string[] = [];
  const paging = opts.paging;
  const fixedRows = (paging.fixedRows ?? []) as unknown[];

  // 行预算：总 5 行 − 翻页 1 行 − 固定行 N 行；至少留 1 行给内容
  const contentRows = Math.max(1, QQ_KEYBOARD_MAX_ROWS - 1 - fixedRows.length);
  if (fixedRows.length + 1 >= QQ_KEYBOARD_MAX_ROWS) {
    warnings.push(
      `固定按钮行 ${fixedRows.length} 行 + 翻页 1 行已经占满 ${QQ_KEYBOARD_MAX_ROWS} 行，本页没有内容按钮的位置`,
    );
  }
  /** 每行最多 QQ_KEYBOARD_MAX_PER_ROW 个 → 一页最多这么多条 */
  const maxPageSize = contentRows * QQ_KEYBOARD_MAX_PER_ROW;

  const requested = Number(paging.pageSize);
  let pageSize = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 8;
  if (pageSize > maxPageSize) {
    warnings.push(`每页 ${pageSize} 条放不进 ${contentRows} 行按钮，已压到 ${maxPageSize} 条`);
    pageSize = maxPageSize;
  }

  const total = allItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number(paging.page);
  let page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
  if (page > totalPages) {
    // 越界不报错（用户可能从旧消息点进来）——夹到最后一页，但要说出来
    warnings.push(`第 ${page} 页不存在（共 ${totalPages} 页），已显示最后一页`);
    page = totalPages;
  }

  const start = (page - 1) * pageSize;
  const pageItems = allItems.slice(start, start + pageSize);
  const allRows = (opts.buttons ?? []) as unknown[];
  // 按钮与条目一一对应时一起切；否则（按钮不是按条目给的）原样保留
  const pageRows =
    allRows.length && allItems.length && allRows.length !== allItems.length
      ? allRows.slice(
          Math.floor(start / QQ_KEYBOARD_MAX_PER_ROW),
          Math.floor(start / QQ_KEYBOARD_MAX_PER_ROW) + contentRows,
        )
      : allRows;

  // 翻页行
  const prefix = String(paging.commandPrefix ?? '').trim();
  const pageCmd = (p: number) => (prefix ? `${prefix} ${p}` : String(p));
  const pagerButtons: unknown[] = [];
  if (page > 1) pagerButtons.push({ label: '« 上一页', data: pageCmd(page - 1), style: 0 });
  pagerButtons.push({ label: `${page}/${totalPages}`, data: pageCmd(page) });
  if (page < totalPages)
    pagerButtons.push({ label: '下一页 »', data: pageCmd(page + 1), style: 0 });

  const { keyboard, warnings: kbWarnings } = buildKeyboard([
    ...pageRows,
    ...fixedRows,
    pagerButtons,
  ]);
  warnings.push(...kbWarnings);

  const parts: string[] = [];
  const title = String(opts.title ?? '').trim();
  if (title) parts.push(mdTitle(title, opts.titleLevel ?? 1));

  if (pageItems.length) {
    parts.push(mdBullets(pageItems));
  } else {
    // 不给中文兜底：本模块是 shared 层，界面文案由调用方（main 的节点实现）提供。
    // 分页时空页只可能是"总数为 0"，让调用方自己说清楚"还没有内容"更合适。
    const empty = String(opts.emptyText ?? '').trim();
    parts.push(empty || '—');
  }

  const inline = buildInlineCommands(opts.inlineCommands ?? []);
  if (inline.lines.length) parts.push(inline.lines.join('\n'));
  warnings.push(...inline.warnings);

  // 页脚：分页信息 + 调用方给的页脚/提示
  const footerBits = [`第 ${page}/${totalPages} 页`, `共 ${total} 条`];
  const givenFooter = String(opts.footer ?? '').trim();
  if (givenFooter) footerBits.push(givenFooter);
  const hint = String(paging.footerHint ?? '').trim();
  if (hint) footerBits.push(hint);
  parts.push(MD_GAP);
  parts.push(footerBits.join('　'));

  return { markdown: mdJoin(parts), keyboard, warnings };
}
