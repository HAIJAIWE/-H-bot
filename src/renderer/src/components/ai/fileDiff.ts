// src/renderer/src/components/ai/fileDiff.ts
//
// # 行级 diff（纯函数，零依赖）
//
// 2026-10-15 用户原话：「他不像其他的智能体，生成代码不知道怎么回事」——
// 别的编码智能体（Cursor / Claude Code）会把**改了哪些行**摊在对话里，
// 而我们这边只显示一行「写文件 plugins/x/index.js」：写了什么、覆盖了什么，一个字都没有。
//
// ## 为什么自己写而不装库
//
// 仓库里只有 monaco（2MB，给代码页用的，塞进聊天卡片太重）。
// 而这里要的只是「给人看的小改动」：常见几十到几百行，一个 LCS 足够，
// 不值得为此引入一个依赖并把它带进渲染层的首屏体积。
//
// ## 边界
//
// · 超长文件先裁到 maxLines（只给用户看个大概），并**如实说明被裁了**（不许静默）
// · 行尾 CRLF 统一按 LF 比（否则整份文件看起来全变了）
export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** 是否因为文件太长被截断（界面上要说明，否则用户以为全文就这些） */
  truncated: boolean;
}

/**
 * 按行切；CRLF / CR 都归一成 LF（不然「只改了一行」会显示成整份重写）。
 *
 * ⚠️ 空串必须切成**零行**：`''.split('\n')` 会得到 `['']`（一个空行），
 * 于是「新建文件」看起来像「删掉了一行」—— 这是测试当场抓到的（第一版就是这样）。
 */
function splitLines(s: string): string[] {
  if (s === '') return [];
  return s.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * 行级 diff：先剥掉公共前后缀，中间那段做 LCS，最后拼成 same/add/del 序列。
 *
 * 剥前后缀是关键 —— 插件文件通常只改中间几行，不剥的话 LCS 会白算一大片。
 */
export function lineDiff(before: string, after: string, maxLines = 600): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);

  // 公共前缀
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  // 公共后缀（不与前缀重叠）
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // 中间那段做 LCS（DP 表；只用于展示，尺寸可控）
  const rows = midA.length;
  const cols = midB.length;
  const dp: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i += 1) out.push({ type: 'same', text: a[i] });
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (midA[i] === midB[j]) {
      out.push({ type: 'same', text: midA[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: midA[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: midB[j] });
      j += 1;
    }
  }
  while (i < rows) {
    out.push({ type: 'del', text: midA[i] });
    i += 1;
  }
  while (j < cols) {
    out.push({ type: 'add', text: midB[j] });
    j += 1;
  }
  for (let k = endA; k < a.length; k += 1) out.push({ type: 'same', text: a[k] });

  const truncated = out.length > maxLines;
  const lines = truncated ? out.slice(0, maxLines) : out;
  return {
    lines,
    added: out.filter((l) => l.type === 'add').length,
    removed: out.filter((l) => l.type === 'del').length,
    truncated,
  };
}
