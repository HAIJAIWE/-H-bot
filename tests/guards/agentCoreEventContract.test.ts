// tests/guards/agentCoreEventContract.test.ts
//
// # 闸门：两条生产者 → 一个消费者的**事件契约**（2026-10-18）
//
// 渲染层的流式显示（正文 / 工具行 / 状态栏 / 收尾 / 错误）**同时服务两条链路**：
//   · 助手链路：`services/ai/index.ts`、`chatRun.ts`、`authorRuntime.ts`
//   · agent-core 循环：`ipc/aiAgentCore.ts`（它用一个本地 `emit()` 包装）
//
// 这个"共用"以前只写在注释里。两个具体风险：
//   ① `ipcEventDelivery` 只认 `webContents.send('x'` —— `emit('x', …)` 这种包装
//      它**一行都扫不到**，循环发的通道其实是裸奔的；
//   ② 谁改了某个 payload 的键名（少一个 `text` / `id`），那一侧的界面就静默不显示，
//      测试也不会红 —— 因为两侧都不需要改类型（IPC 载荷是 unknown）。
//
// 判据（机械可判）：主进程里**每一条** `ai:` 事件发送，通道必须在 preload 有监听，
// 载荷必须带上渲染层真正要读的键；agent-core 的工具事件还必须有 name/args
// （工具行就是靠第一发把卡片立起来的）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PRELOAD = join(ROOT, 'src', 'preload', 'index.ts');

/** 渲染层读这些键（少一个就等于那一栏空白），多传不管 */
export const REQUIRED_KEYS: Record<string, string[]> = {
  'ai:chunk': ['text'],
  'ai:toolCall': ['projectPath', 'id', 'status'],
  'ai:agentState': ['projectPath', 'state'],
  // 步骤条（第 N / 共 M 步）：渲染层 aiStore.ts:1862 直接读 step/maxSteps
  'ai:agentStep': ['projectPath', 'step', 'maxSteps'],
  // 循环内压缩（aiAgentCore 独有）：渲染层要读 dropped 与两个 token 估算值
  'ai:compact': ['projectPath', 'dropped', 'tokensBefore', 'tokensAfter'],
  // 循环里的提案（旧工具攒出来的操作）：渲染层按 projectPath 分档、直接渲染 proposal
  'ai:proposal': ['projectPath', 'proposal'],
  'ai:response': ['message'],
  'ai:error': ['message'],
  'ai:warning': ['message'],
};

export interface Emission {
  file: string;
  line: number;
  channel: string;
  keys: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * 把注释与字符串字面量的内容抹成空格（保持长度不变，索引不动）。
 *
 * 为什么必须抹：`topLevelKeys` 是按括号深度切逗号的，而注释里的 `（"[工具失败] …"）`
 * 会被当成真的方括号 —— 深度一乱，「status 键被吞掉」的假红就出现了（2026-10-23 踩到）。
 */
export function blankCommentsAndStrings(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) break;
        j += 1;
      }
      // 引号本身留着（结构需要），内容抹掉
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** 从 `{` 开始配平，返回对象字面量的内容（不含外层花括号）；找不到返回 null */
function objectBody(src: string, openBrace: number): string | null {
  let depth = 0;
  for (let i = openBrace; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(openBrace + 1, i);
    }
  }
  return null;
}

/** 顶层键名（简写属性也算；嵌套对象/数组里的键不混进来） */
export function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    buf = '';
    if (!t) return;
    const colon = t.indexOf(':');
    const name = (colon >= 0 ? t.slice(0, colon) : t).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) keys.push(name);
  };
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      buf += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      flush();
    } else {
      buf += ch;
    }
  }
  flush();
  return keys;
}

/** 扫主进程里**所有** `ai:` 事件发送（`webContents.send` 与 `emit` 两种写法） */
export function collectEmissions(files: readonly string[]): Emission[] {
  const out: Emission[] = [];
  const re = /(?:webContents\.send|\bemit)\('(ai:[A-Za-z]+)'\s*,\s*\{/g;
  for (const file of files) {
    // 通道名要从未抹过的原文里取（抹过之后字符串内容全是空格）；
    // 键名提取用抹过的版本（长度不变，所以索引通用）。
    const raw = readFileSync(file, 'utf-8');
    const src = blankCommentsAndStrings(raw);
    for (const m of raw.matchAll(re)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const body = objectBody(src, open);
      if (body === null) continue;
      const line = src.slice(0, m.index ?? 0).split('\n').length;
      out.push({
        file: relative(ROOT, file).split('\\').join('/'),
        line,
        channel: m[1],
        keys: topLevelKeys(body),
      });
    }
  }
  return out;
}

function subscribedChannels(): Set<string> {
  const src = readFileSync(PRELOAD, 'utf-8');
  return new Set([...src.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]));
}

/** 返回问题清单（空 = 通过） */
export function auditEmissions(emissions: readonly Emission[], subscribed: Set<string>): string[] {
  const problems: string[] = [];
  for (const e of emissions) {
    const where = `${e.file}:${e.line} ${e.channel}`;
    if (!subscribed.has(e.channel)) problems.push(`${where}：preload 没有监听（事件发出去没人收）`);
    const need = REQUIRED_KEYS[e.channel];
    if (!need) continue;
    const missing = need.filter((k) => !e.keys.includes(k));
    if (missing.length > 0) problems.push(`${where}：payload 少了 ${missing.join(',')}（渲染层读不到）`);
  }
  return problems;
}

const MAIN_FILES = walk(join(ROOT, 'src', 'main'));

describe('★ 事件契约：主进程发 → preload 收 → 渲染层读', () => {
  const emissions = collectEmissions(MAIN_FILES);
  const subscribed = subscribedChannels();

  it('扫描确实在工作（且认得出 agent-core 的 emit 包装）', () => {
    expect(emissions.length).toBeGreaterThan(20);
    const fromLoop = emissions.filter((e) => e.file === 'src/main/ipc/aiAgentCore.ts');
    expect(fromLoop.map((e) => e.channel).sort()).toEqual([
      'ai:agentState',
      'ai:agentState',
      'ai:agentState',
      'ai:agentStep',
      'ai:chunk',
      'ai:chunk',
      'ai:compact',
      'ai:error',
      'ai:error',
      'ai:proposal',
      'ai:response',
      'ai:toolCall',
      'ai:toolCall',
      'ai:warning',
    ]);
  });

  it('★ 每条 ai: 事件都有监听，且 payload 带渲染层要的键', () => {
    const problems = auditEmissions(emissions, subscribed);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('★ agent-core 的工具事件必须有 name + args（工具行靠第一发立卡片）', () => {
    const loopTools = emissions.filter(
      (e) => e.file === 'src/main/ipc/aiAgentCore.ts' && e.channel === 'ai:toolCall',
    );
    expect(loopTools.length).toBe(2);
    for (const e of loopTools) {
      expect(e.keys, `${e.file}:${e.line}`).toEqual(expect.arrayContaining(['name', 'args']));
    }
  });

  it('★ 正控：把 chunk 的 text 删掉，audit 必须报出来', () => {
    const broken = [{ file: 'x.ts', line: 1, channel: 'ai:chunk', keys: ['projectPath'] }];
    expect(auditEmissions(broken, new Set(['ai:chunk']))).toHaveLength(1);
    // 通道没人听也要报
    expect(auditEmissions([{ file: 'x.ts', line: 1, channel: 'ai:nope', keys: [] }], subscribed)).toHaveLength(1);
  });
});
