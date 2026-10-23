// scripts/gen-capability-catalog.mjs
//
// 从「能力三层归位表」的机器附录生成能力目录（单一真相 → 生成物）。
//
// 为什么要有这一步：AI 侧要能"发现这台应用能做什么"，但这份清单**不能手抄** ——
// 手抄就是第三份真相源（本仓库已为"两份真相源"付过多次代价）。
// 所以：文档附录是**人写的那份**，本脚本把它编译成代码可 import 的常量，
// 再由 `tests/guards/capabilityLayering.test.ts` 断言"生成物 == 附录 == preload"。
//
// 用法：
//   node scripts/gen-capability-catalog.mjs           # 写入
//   node scripts/gen-capability-catalog.mjs --check   # 只校验（CI / 闸门用），不一致则退出码 1
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs', 'ai', 'ai-capability-layering-2026-10-08.md');
const OUT = join(ROOT, 'src', 'main', 'services', 'ai', 'capabilityCatalog.generated.ts');
/**
 * 第二份产物：**共享策略**。
 *
 * 为什么要有它：执行能力的两个时点在不同进程里 ——
 *   · 主进程在**提案期**判断"这条能不能提议"；
 *   · 渲染层在**执行期**复检"这条能不能真的调"。
 * 两侧必须读**同一份**白名单，否则渲染层就成了"拿到什么 op 就调什么"的裸通道
 * （2026-10-08 自查发现：上一版白名单只在主进程，渲染层确实会照调 terminal.create）。
 */
const OUT_POLICY = join(ROOT, 'src', 'shared', 'ai', 'capabilityPolicy.generated.ts');

/** 层取值见 docs 附录 A */
const LAYERS = ['R', 'Q', 'M', 'P', 'F', 'X'];

/**
 * 作用对象（domain）：这个能力**碰到什么**。
 *
 * 与「层」（模型能不能动）是**正交的另一把尺子**：
 *   · 层回答"能不能"  · 作用对象回答"碰什么"  · 角色回答"谁在什么场景用"。
 * 取值由文档「命名空间 → 作用对象」表给出，生成器逐条标到能力上。
 */
const DOMAINS = ['界面', '代码', '数据', '对外', '观测', '工程', '终端', '内部'];

/** 取出「命名空间 → 作用对象」表，要求**每个命名空间恰好一次** */
export function parseDomains(doc) {
  const marker = doc.indexOf('命名空间 → 作用对象');
  if (marker < 0) throw new Error('文档里找不到「命名空间 → 作用对象」表');
  const fence = doc.indexOf('```text', marker);
  const body = doc.indexOf('\n', fence);
  const end = doc.indexOf('```', body);
  if (fence < 0 || body < 0 || end < 0) throw new Error('作用对象表的 text 代码块不完整');
  const out = new Map();
  for (const raw of doc.slice(body, end).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(\S+)$/);
    if (!m) throw new Error(`作用对象表里有无法解析的行: ${line}`);
    const [, ns, domain] = m;
    if (!DOMAINS.includes(domain)) {
      throw new Error(`非法作用对象 "${domain}"（${ns}）—— 只能是 ${DOMAINS.join(' / ')}`);
    }
    if (out.has(ns)) throw new Error(`作用对象表里 ${ns} 出现了两次`);
    out.set(ns, domain);
  }
  if (out.size === 0) throw new Error('作用对象表是空的');
  return out;
}

/** 给每条能力补作用对象；漏一个就报错（这正是"统计时漏掉 2 个命名空间"那个坑） */
function attachDomains(entries, domains) {
  const unused = [...domains.keys()].filter((ns) => !entries.some((e) => e.ns === ns));
  if (unused.length) throw new Error(`作用对象表里有不存在的命名空间: ${unused.join(', ')}`);
  for (const e of entries) {
    const d = domains.get(e.ns);
    if (!d) {
      throw new Error(
        `命名空间 ${e.ns} 没有作用对象 —— 请在文档的「命名空间 → 作用对象」表里补一行`,
      );
    }
    e.domain = d;
  }
}

/** 每层"模型该怎么用它"的一句话 —— 由层**派生**，不是手写散文（避免描述与实现漂移） */
const ACCESS = {
  R: '应用会自动把这项数据放进上下文，通常不需要主动查询',
  Q: '只读，可直接调用',
  M: '有副作用：只能提出提案，用户确认后才生效',
  P: '需要用户在界面上亲自操作，模型不能代劳',
  F: '禁止模型调用',
  X: '助手自身或内部管道，不对外开放',
};

/** 取出文档里 `## 附录 A` 的 ```text 代码块 */
export function extractAppendix(doc) {
  const start = doc.indexOf('## 附录 A');
  if (start < 0) throw new Error('文档里找不到 ## 附录 A');
  const fence = doc.indexOf('```text', start);
  const body = doc.indexOf('\n', fence);
  const end = doc.indexOf('```', body);
  if (fence < 0 || body < 0 || end < 0) throw new Error('附录 A 的 text 代码块不完整');
  return doc.slice(body, end);
}

/** 取出 `## 附录 B` 里的 `- id` 清单（可直接调用 = 无副作用） */
/** 解析「附录 B/C」共用的条目格式：- <id> (参数1, 参数2?, …) */
export function parseEntries(section) {
  const out = [];
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const m = line.match(
      /^-\s+([A-Za-z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*(?:\[target=([A-Za-z_][A-Za-z0-9_]*)\])?\s*$/,
    );
    if (!m) {
      throw new Error(
        `附录条目没有写调用约定：${line}\n` +
          '必须写成「- <id> (参数1, 参数2, …)」，零参数写「- <id> ()」，可选参数加 ?。',
      );
    }
    const rawParams = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({
      id: m[1],
      params: rawParams.map((p) => p.replace(/\?$/, '')),
      optional: rawParams.filter((p) => p.endsWith('?')).map((p) => p.replace(/\?$/, '')),
      // 附录 D 专用：这条能力的「目标」是哪个参数（用于白名单校验）
      target: m[3] ?? null,
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

export function extractDirectSafe(doc) {
  const start = doc.indexOf('## 附录 B');
  if (start < 0) throw new Error('文档里找不到 ## 附录 B');
  const end = doc.indexOf('\n## ', start + 1);
  return parseEntries(doc.slice(start, end < 0 ? undefined : end));
}

/** `ns.method = L` → [{ id, ns, method, layer }]，按 id 排序 */
/** 取出「附录 C」的 - id 清单（可提议 = M 层走提案） */
export function extractProposable(doc) {
  const start = doc.indexOf('## 附录 C');
  if (start < 0) throw new Error('文档里找不到 ## 附录 C');
  const end = doc.indexOf('\n## ', start + 1);
  return parseEntries(doc.slice(start, end < 0 ? undefined : end));
}

const PRELOAD = join(ROOT, 'src', 'preload', 'index.ts');

/**
 * 从 preload 里抽出每个 \`ns.method\` 真正调用的 IPC 通道。
 *
 * 为什么需要它：**直接调用**（附录 B）走的是主进程 → 已注册的 IPC handler，
 * 所以必须知道 id 对应哪条通道。手抄通道名必然会漂，所以从源头抽。
 *
 * 抽法：逐行扫，遇到 \`  name: {\` 换命名空间、遇到 \`    method:\` 换方法，
 * 然后在该方法的**整个函数体**里找第一条 \`ipcRenderer.invoke/send/on('...')\`。
 * （早先用"往后看固定行数"漏掉了多行签名的方法——official.* / ssh.* 就是那么漏的。）
 */
export function extractChannels() {
  const lines = readFileSync(PRELOAD, 'utf-8').split('\n');
  const out = new Map();
  let ns = null;
  let method = null;
  let body = [];
  const flush = () => {
    if (!ns || !method) return;
    const text = body.join('\n');
    const m = text.match(/ipcRenderer\.(invoke|send|on)\(\s*'([^']+)'/);
    if (m) out.set(ns + '.' + method, { channel: m[2], kind: m[1] });
    else out.set(ns + '.' + method, { channel: null, kind: null });
  };
  for (const line of lines) {
    const nsMatch = line.match(/^  ([a-zA-Z]+): \{$/);
    if (nsMatch) {
      flush();
      method = null;
      body = [];
      ns = nsMatch[1];
      continue;
    }
    if (/^  \},?$/.test(line)) {
      flush();
      method = null;
      body = [];
      ns = null;
      continue;
    }
    const mMatch = line.match(/^    ([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (mMatch) {
      flush();
      method = mMatch[1];
      body = [line];
      continue;
    }
    if (method) body.push(line);
  }
  flush();
  return out;
}

/** 取出「附录 D」：高危能力（退不回去的那些） */
export function extractDestructive(doc) {
  const start = doc.indexOf('## 附录 D');
  if (start < 0) throw new Error('文档里找不到 ## 附录 D');
  const end = doc.indexOf('\n## ', start + 1);
  return parseEntries(doc.slice(start, end < 0 ? undefined : end));
}

export function parseAppendix(block) {
  const out = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z]+)$/);
    if (!m) throw new Error(`附录里有无法解析的行: ${line}`);
    const [, ns, method, layer] = m;
    if (!LAYERS.includes(layer)) throw new Error(`非法层 ${layer}（${ns}.${method}）`);
    out.push({ id: `${ns}.${method}`, ns, method, layer });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

export function render(entries, directSafe, proposable, CHANNELS) {
  const rows = entries
    .map((e) => {
      const ch = CHANNELS.get(e.id);
      const channel = ch && ch.channel ? `'${ch.channel}'` : 'null';
      const kind = ch && ch.kind ? `'${ch.kind}'` : 'null';
      return `  { id: '${e.id}', ns: '${e.ns}', method: '${e.method}', layer: '${e.layer}', domain: '${e.domain}', channel: ${channel}, channelKind: ${kind} },`;
    })
    .join('\n');
  const count = Object.fromEntries(
    LAYERS.map((L) => [L, entries.filter((e) => e.layer === L).length]),
  );
  return `// src/main/services/ai/capabilityCatalog.generated.ts
//
// ⚠️ 本文件由 \`scripts/gen-capability-catalog.mjs\` 生成，**不要手改**。
//    改层归属请改 docs/ai/ai-capability-layering-2026-10-08.md 的**能力台账**（附录 A），然后重跑：
//      node scripts/gen-capability-catalog.mjs
//    \`tests/guards/capabilityLayering.test.ts\` 会断言"本文件 == 附录 == preload"。
//
// 它回答一个问题：**这台应用能做什么、每件事归谁管**。
// 层的含义（MCP 三层控制分工 + 本项目的扩展）：
//   R 应用注入 / Q 模型可直接查 / M 模型可提议(需确认) / P 用户操作 / F 禁止模型 / X 内部

/** 能力所属的控制层 */
export type CapabilityLayer = 'R' | 'Q' | 'M' | 'P' | 'F' | 'X';

export interface CapabilityEntry {
  /** \`<命名空间>.<方法>\`，与 preload 暴露面一一对应 */
  id: string;
  ns: string;
  method: string;
  layer: CapabilityLayer;
  /** 作用对象：这个能力**碰到什么**（界面/代码/数据/对外/观测/工程/终端/内部） */
  domain: string;
  /** preload 真正调用的 IPC 通道；事件订阅类为 null */
  channel: string | null;
  /** invoke / send / on；null = 没有通道 */
  channelKind: 'invoke' | 'send' | 'on' | null;
}

/** 每层"模型该怎么用它"的一句话（派生自层，不手写） */
export const CAPABILITY_ACCESS: Record<CapabilityLayer, string> = {
  R: '${ACCESS.R}',
  Q: '${ACCESS.Q}',
  M: '${ACCESS.M}',
  P: '${ACCESS.P}',
  F: '${ACCESS.F}',
  X: '${ACCESS.X}',
};

/** 台账：${entries.length} 条（R ${count.R} / Q ${count.Q} / M ${count.M} / P ${count.P} / F ${count.F} / X ${count.X}） */
export const CAPABILITY_CATALOG: CapabilityEntry[] = [
${rows}
];

/**
 * 白名单（可直接调用 / 可提议 / 禁止）**不在这里** —— 它们产在
 * src/shared/ai/capabilityPolicy.generated.ts。
 *
 * 为什么分家：执行一个能力有**两个时点、分处两个进程** ——
 * 主进程在提案期判断、渲染层在执行期复检。两侧必须读同一份白名单，
 * 所以白名单必须落在 shared/。本文件只管「目录与层的台账」。
 */
`;
}

export function renderPolicy(entries, directSafe, proposable, destructive, namespaceDomains) {
  const forbidden = entries
    .filter((e) => e.layer === 'F')
    .map((e) => e.id)
    .sort();
  return `// src/shared/ai/capabilityPolicy.generated.ts
//
// ⚠️ 本文件由 \`scripts/gen-capability-catalog.mjs\` 生成，**不要手改**。
//    权威来源：docs/ai/ai-capability-layering-2026-10-08.md（附录 A / B / C）。
//
// 三档授权：Read Grant（附录 B）/ Reversible Grant（附录 C）/ Escalation Grant（附录 D）。\n//\n// 为什么要单独产一份到 shared：**执行能力有两个时点，分处两个进程** ——
// 主进程在提案期判断、渲染层在执行期复检。两侧必须读同一份白名单，
// 否则渲染层就成了"拿到什么 op 就调什么"的裸通道。

/** 只读直调授权（Read Grant，附录 B）：可直接调用、无副作用 */
export const DIRECT_CALL_SAFE: string[] = [
${directSafe.map((e) => `  '${e.id}',`).join('\n')}
];

/**
 * 每条**可直接调用**能力的调用约定（主进程按它把具名参数翻成位置参数，
 * 再调那条 IPC 通道）。与附录 C 同一套格式。
 */
export const DIRECT_SIGNATURES: Record<string, string[]> = {
${directSafe.map((e) => `  '${e.id}': [${e.params.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
};

/** 其中哪些参数是可选的（附录里写作 参数?） */
export const DIRECT_OPTIONAL: Record<string, string[]> = {
${directSafe.map((e) => `  '${e.id}': [${e.optional.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
};

/** 可逆提案授权（Reversible Grant，附录 C）：走提案 + 用户确认 */
export const PROPOSABLE_CAPABILITIES: string[] = [
${proposable.map((e) => `  '${e.id}',`).join('\n')}
];

/**
 * 每条可提议能力的**位置参数表**（决定渲染层怎么调用它）。
 *
 * 与 preload 方法形参同名、同序。**projectPath 是特殊参数**：
 * 由渲染层用当前项目注入，模型给了也会被忽略 —— 否则模型能提议去改另一个项目。
 */
export const PROPOSABLE_SIGNATURES: Record<string, string[]> = {
${proposable.map((e) => `  '${e.id}': [${e.params.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
};

/** 其中哪些参数是**可选**的（附录 C 里写作 参数?）。模型可以省略它们。 */
export const PROPOSABLE_OPTIONAL: Record<string, string[]> = {
${proposable.map((e) => `  '${e.id}': [${e.optional.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
};

/** 高危升级授权（Escalation Grant，附录 D）：退不回去。默认禁用，且目标要过白名单。 */
export const DESTRUCTIVE_CAPABILITIES: string[] = [
${destructive.map((e) => `  '${e.id}',`).join('\n')}
];

/** 高危能力的调用约定（与附录 B/C 同一套格式） */
export const DESTRUCTIVE_SIGNATURES: Record<string, string[]> = {
${destructive.map((e) => `  '${e.id}': [${e.params.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
};

/** 高危能力里哪些参数可选 */
export const DESTRUCTIVE_OPTIONAL: Record<string, string[]> = {
${destructive.map((e) => `  '${e.id}': [${e.optional.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
};

/** 其中哪些参数是「目标」（必须命中用户设的白名单；没标的 = 无目标参数） */
export const DESTRUCTIVE_TARGETS: Record<string, string> = {
${destructive
  .filter((e) => e.target)
  .map((e) => `  '${e.id}': '${e.target}',`)
  .join('\n')}
};

/**
 * **命名空间 → 作用对象**。角色分派按它授权（而不是维护一份手写的工具/能力数组 ——
 * 手写数组已经漂移过一次：加了 4 个工具却没进任何角色表）。
 */
export const DOMAIN_BY_NAMESPACE: Record<string, string> = {
${[...namespaceDomains.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([ns, d]) => `  '${ns}': '${d}',`)
  .join('\n')}
};

/** 作用对象的全集（顺序即文档里的顺序：界面 → 代码 → 数据 → 对外 → 观测 → 工程 → 终端 → 内部） */
export const DOMAINS: string[] = [${DOMAINS.map((d) => `'${d}'`).join(', ')}];

/** 按作用对象分组的能力 id（给"能力清单"这类界面用） */
export const CAPABILITIES_BY_DOMAIN: Record<string, string[]> = {
${DOMAINS.map(
  (d) =>
    `  '${d}': [${entries
      .filter((e) => e.domain === d)
      .map((e) => `'${e.id}'`)
      .join(', ')}],`,
).join('\n')}
};

/** 明确禁止模型调用（F 层）—— 执行期复检要能单独认出它们 */
export const FORBIDDEN_CAPABILITIES: string[] = [
${forbidden.map((id) => `  '${id}',`).join('\n')}
];
`;
}

const doc = readFileSync(DOC, 'utf-8');
const entries = parseAppendix(extractAppendix(doc));
const domains = parseDomains(doc);
attachDomains(entries, domains);
/** 去重后的「命名空间 → 作用对象」（策略产物按它授权） */
const namespaceDomains = new Map(
  [...new Set(entries.map((e) => e.ns))].map((ns) => [ns, entries.find((e) => e.ns === ns).domain]),
);
const directSafe = extractDirectSafe(doc);

// 对账：附录 B 里的能力必须真实存在，且**必须是 Q 层**
// （安全方向必须是"反的错就报错"，而不是默默放行 —— 见附录 B 的说明）
const byId = new Map(entries.map((e) => [e.id, e]));
for (const { id } of directSafe) {
  const entry = byId.get(id);
  if (!entry) throw new Error(`附录 B 里的 ${id} 在附录 A 里不存在`);
  if (entry.layer !== 'Q') {
    throw new Error(`附录 B 里的 ${id} 层是 ${entry.layer}，只有 Q 层才允许直接调用`);
  }
}

const proposable = extractProposable(doc);
for (const { id } of proposable) {
  const entry = byId.get(id);
  if (!entry) throw new Error(`附录 C 里的 ${id} 在附录 A 里不存在`);
  if (entry.layer !== 'M') {
    throw new Error(`附录 C 里的 ${id} 层是 ${entry.layer}，只有 M 层才允许作为提案项`);
  }
}

const CHANNELS = extractChannels();
const destructive = extractDestructive(doc);
for (const { id } of destructive) {
  const entry = byId.get(id);
  if (!entry) throw new Error(`附录 D 里的 ${id} 在附录 A 里不存在`);
  if (entry.layer !== 'M') {
    throw new Error(`附录 D 里的 ${id} 层是 ${entry.layer}，高危能力必须是 M 层`);
  }
}

/**
 * ⚠️ 生成物必须**过一遍 prettier**再落盘/比对。
 *
 * 2026-10-18 教训：通道名从 `runtime:statusChange` 改成 `runtime:statusChanged` 之后
 * 有一行超过 printWidth，于是「生成器 --check 通过」与「pnpm format:check 通过」
 * 变成互斥的两件事 —— 谁都不该要求改代码的人手工把生成物排版成恰好两全。
 * 生成器自己格式化，两个闸门就永远一致。
 */
const pretty = async (code, filepath) =>
  prettierFormat(code, { ...(await resolveConfig(filepath)), filepath });

const next = await pretty(render(entries, directSafe, proposable, CHANNELS), OUT);

// --print：把生成物打到 stdout（不落盘）。给"运行进程没有工作区写权限"的环境用
// （本仓库实测过：沙箱里 node 写 D:\QQ bot 会 EPERM），CI 也可以用 `--print > 文件`。
if (process.argv.includes('--print-policy')) {
  process.stdout.write(
    renderPolicy(entries, directSafe, proposable, destructive, namespaceDomains),
  );
} else if (process.argv.includes('--print')) {
  process.stdout.write(next);
} else if (process.argv.includes('--check')) {
  const readOr = (p) => {
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      return '';
    }
  };
  const policy = await pretty(
    renderPolicy(entries, directSafe, proposable, destructive, namespaceDomains),
    OUT_POLICY,
  );
  const stale = [];
  if (readOr(OUT) !== next) stale.push('capabilityCatalog.generated.ts');
  if (readOr(OUT_POLICY) !== policy) stale.push('capabilityPolicy.generated.ts');
  if (stale.length) {
    console.error(
      `[capability-catalog] 生成物与文档不一致（${stale.join('、')}）：` +
        '请运行 node scripts/gen-capability-catalog.mjs',
    );
    process.exit(1);
  }
  console.log(`[capability-catalog] OK：${entries.length} 条 + 策略两份与文档一致`);
} else {
  writeFileSync(OUT, next, 'utf-8');
  writeFileSync(
    OUT_POLICY,
    await pretty(renderPolicy(entries, directSafe, proposable, destructive, namespaceDomains), OUT_POLICY),
    'utf-8',
  );
  console.log(`[capability-catalog] 已写入两份（${entries.length} 条）：${OUT}、${OUT_POLICY}`);
}
