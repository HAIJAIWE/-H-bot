// tests/guards/capabilityLayering.test.ts
//
// # 闸门：每个前端能力都必须登记「归哪一层」，且三层分工不得互相越界
//
// ## 为什么（2026-10-08）
//
// 目标是「AI 能操作前端任意功能」。但**不是**把 228 个方法都做成模型工具：
//   · 只读域做成工具 → 上下文爆炸（Anthropic 实测 58 工具 ≈55K tokens）+ 选择准确率下降
//   · 任意命令执行做成工具 → 等于把主机交出去
// 所以先做归位：R(应用注入) / Q(模型主动查) / M(模型可提议,需确认) / P(用户触发) / F(禁止) / X(元域)。
// 依据：`docs/ai/ai-capability-layering-2026-10-08.md`（MCP 三层控制分工 + Anthropic 工具检索阈值）。
//
// ## 判据（五条，全部机械可判）
//
// 1. **双向完整**：preload 暴露面的每个 `ns.method` 都必须在附录里登记层；
//    附录里的每条也必须在 preload 里真实存在（防"码加了表没改"与"表写了码没有"）。
// 2. **层取值合法**：只能是 `R/Q/M/P/F/X`。
// 3. **人看的汇总表 = 机器附录**：`## 二、总表` 每行的分项数必须等于附录里该域的聚合
//    （写法与 `capabilityClaimsMatchCode` 一致：**改清单 = 同时改表**，想偷懒不可能）。
// 4. **F 层（禁止）不得进 AI 面**：`src/main/services/ai/` 与 `src/main/mcp/` 里
//    不得出现任何 F 层通道（当前是 `terminal:*`）。
// 5. **正控**：合成一段"漏登记 / 层取值非法"的附录，解析函数必须报出来
//    （否则闸门可能因为解析器坏了而永远绿）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { CAPABILITY_CATALOG } from '@main/services/ai/capabilityCatalog.generated';
import {
  CAPABILITIES_BY_DOMAIN,
  DOMAIN_BY_NAMESPACE,
  DOMAINS,
} from '@shared/ai/capabilityPolicy.generated';
import {
  DIRECT_CALL_SAFE,
  DIRECT_SIGNATURES,
  PROPOSABLE_CAPABILITIES,
  PROPOSABLE_SIGNATURES,
} from '@shared/ai/capabilityPolicy.generated';

const ROOT = process.cwd();
const PRELOAD = join(ROOT, 'src/preload/index.ts');
const DOC = join(ROOT, 'docs/ai/ai-capability-layering-2026-10-08.md');
const AI_DIRS = [join(ROOT, 'src/main/services/ai'), join(ROOT, 'src/main/mcp')];

const LAYERS = ['R', 'Q', 'M', 'P', 'F', 'X'] as const;
type Layer = (typeof LAYERS)[number];

/* ------------------------------------------------------------------ *
 * ① preload 暴露面（AST，点号路径）
 * 与 ipcSurfaceParity 同一套写法 —— 正则分不清"对象嵌套"与"同名字段"，
 * 这里刻意复制而不是跨测试 import，保持每条闸门自洽可单独阅读。
 * ------------------------------------------------------------------ */

/** 把对象字面量展开成 `a.b.c` → 成员节点 */
function flatten(node: ts.Node, prefix: string, out: Map<string, ts.Node>): void {
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
    const raw =
      prop.name && ts.isIdentifier(prop.name) ? prop.name.text : (prop.name?.getText() ?? '');
    const key = prefix ? `${prefix}.${raw.replace(/['"]/g, '')}` : raw.replace(/['"]/g, '');
    const value = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
    if (ts.isObjectLiteralExpression(value)) flatten(value, key, out);
    else out.set(key, value);
  }
}

/** preload 暴露的 `ns.method` 全集 */
export function preloadSurface(): Set<string> {
  const sf = ts.createSourceFile(
    PRELOAD,
    readFileSync(PRELOAD, 'utf-8'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld' &&
      node.arguments.length >= 2
    ) {
      let target: ts.Node = node.arguments[1];
      // `exposeInMainWorld('qqbat', api)` —— 第二个参数是标识符，解析到它的初始化器
      if (ts.isIdentifier(target)) {
        for (const st of sf.statements) {
          if (!ts.isVariableStatement(st)) continue;
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === target.text && d.initializer) {
              target = d.initializer;
            }
          }
        }
      }
      const flat = new Map<string, ts.Node>();
      flatten(target, '', flat);
      // ⚠️ 只算**可调用的**成员：能力 = 能调的东西。
      // preload 里还有非函数的常量（如 `ai.guardOptions` 的两个布尔/数组字段），
      // 它们不是能力，塞进归位表只会让表失真。
      for (const [path, value] of flat) {
        if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) out.add(path);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/* ------------------------------------------------------------------ *
 * ② 附录解析（纯函数，便于正控）
 * ------------------------------------------------------------------ */

/** 从文档正文里取出 `## 附录 A` 的 ```text 代码块 */
export function extractAppendixBlock(doc: string): string {
  const start = doc.indexOf('## 附录 A');
  if (start < 0) return '';
  const fence = doc.indexOf('```text', start);
  if (fence < 0) return '';
  const body = doc.indexOf('\n', fence);
  const end = doc.indexOf('```', body);
  if (body < 0 || end < 0) return '';
  return doc.slice(body, end);
}

/** `ns.method = L` → Map；非法行/非法层单独报出来 */
/**
 * preload 每个 `ns.method` 的**形参名**（AST 取）。
 *
 * 用途：与附录 C 声明的**调用约定**逐条对账 —— 声明与真实签名一漂移，
 * 渲染层就会按错的顺序传参（表现为"能力调用了但行为莫名其妙"，极难排查）。
 * 这种事必须机器钉住，不能靠人记得同步。
 */
export function preloadParamNames(): Map<string, string[]> {
  const sf = ts.createSourceFile(
    PRELOAD,
    readFileSync(PRELOAD, 'utf-8'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const out = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld' &&
      node.arguments.length >= 2
    ) {
      let target: ts.Node = node.arguments[1];
      if (ts.isIdentifier(target)) {
        for (const st of sf.statements) {
          if (!ts.isVariableStatement(st)) continue;
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === target.text && d.initializer) {
              target = d.initializer;
            }
          }
        }
      }
      const flat = new Map<string, ts.Node>();
      flatten(target, '', flat);
      for (const [path, value] of flat) {
        if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
          out.set(
            path,
            value.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText())),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function parseAppendix(block: string): {
  map: Map<string, Layer>;
  badLines: string[];
  badLayers: string[];
} {
  const map = new Map<string, Layer>();
  const badLines: string[] = [];
  const badLayers: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z]+)$/);
    if (!m) {
      badLines.push(line);
      continue;
    }
    const [, ns, method, layer] = m;
    if (!(LAYERS as readonly string[]).includes(layer)) {
      badLayers.push(`${ns}.${method} = ${layer}`);
      continue;
    }
    map.set(`${ns}.${method}`, layer as Layer);
  }
  return { map, badLines, badLayers };
}

/** `## 二、总表` 的每行 → { ns, counts } */
/** 取出「附录 B」的 - id 清单（可直接调用 = 无副作用） */
export function parseDirectSafe(doc: string): string[] {
  const start = doc.indexOf('## 附录 B');
  if (start < 0) return [];
  const end = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, end < 0 ? undefined : end);
  const ids: string[] = [];
  for (const raw of section.split('\n')) {
    // 附录 B 与附录 C 同一套格式：- <id> (参数1, 参数2?, …)
    const m = raw.trim().match(/^-\s+([A-Za-z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\(.*\)\s*$/);
    if (m) ids.push(m[1]);
  }
  return ids.sort();
}

/** 取出「附录 C」的 - id 清单（可提议 = M 层走提案） */
export function parseProposable(doc: string): string[] {
  const start = doc.indexOf('## 附录 C');
  if (start < 0) return [];
  const end = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, end < 0 ? undefined : end);
  const ids: string[] = [];
  for (const raw of section.split('\n')) {
    // 附录 C 的格式带调用约定：- <id> (参数1, 参数2, …)
    const m = raw
      .trim()
      .match(/^-\s+([A-Za-z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/);
    if (m) ids.push(m[1]);
  }
  return ids.sort();
}

export function parseSummaryTable(doc: string): { ns: string; counts: Record<Layer, number> }[] {
  const start = doc.indexOf('## 二、总表');
  const end = doc.indexOf('## 三、', start);
  const section = start < 0 ? '' : doc.slice(start, end < 0 ? undefined : end);
  const rows: { ns: string; counts: Record<Layer, number> }[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 8) continue;
    const [ns] = cells;
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(ns)) continue;
    const num = (v: string) => {
      if (v === '–' || v === '-' || v === '') return 0;
      const n = Number(v.replace(/\*/g, ''));
      return Number.isFinite(n) ? n : NaN;
    };
    rows.push({
      ns,
      counts: {
        R: num(cells[2]),
        Q: num(cells[3]),
        M: num(cells[4]),
        P: num(cells[5]),
        F: num(cells[6]),
        X: num(cells[7]),
      },
    });
  }
  return rows;
}

/** 递归收集目录下所有文本文件的全文（用于第 4 条） */
function readDirText(dir: string): string {
  const parts: string[] = [];
  const walk = (d: string): void => {
    for (const e of require('node:fs').readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      // ⚠️ 排除生成的数据表：能力目录**列出**所有通道（含 F 层）是它的职责，
      // 那不是"AI 侧去调它"。这条规则要抓的是**调用点**，不是台账。
      if (e.name.endsWith('.generated.ts')) continue;
      try {
        parts.push(readFileSync(p, 'utf-8'));
      } catch {
        /* 读不动就跳过 */
      }
    }
  };
  walk(dir);
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */

const doc = readFileSync(DOC, 'utf-8');
const appendix = parseAppendix(extractAppendixBlock(doc));
const surface = preloadSurface();

describe('能力三层归位：清单与实现互相对账', () => {
  it('附录可解析，且没有非法行 / 非法层', () => {
    expect(appendix.badLines).toEqual([]);
    expect(appendix.badLayers).toEqual([]);
    expect(appendix.map.size).toBeGreaterThan(200);
  });

  it('★ 双向完整：preload 的每个能力都登记了层，且登记的都真实存在', () => {
    const unclassified = [...surface].filter((k) => !appendix.map.has(k)).sort();
    const stale = [...appendix.map.keys()].filter((k) => !surface.has(k)).sort();
    // 打印出来便于直接照抄到文档里
    expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
  });

  it('★ 人看的汇总表 = 机器附录（改一处必须改另一处）', () => {
    const rows = parseSummaryTable(doc);
    expect(rows.length).toBeGreaterThan(30);
    const mismatch: string[] = [];
    for (const row of rows) {
      const agg: Record<Layer, number> = { R: 0, Q: 0, M: 0, P: 0, F: 0, X: 0 };
      for (const [key, layer] of appendix.map) {
        if (key.startsWith(`${row.ns}.`)) agg[layer]++;
      }
      for (const L of LAYERS) {
        if (agg[L] !== row.counts[L]) {
          mismatch.push(`${row.ns}.${L}: 表里 ${row.counts[L]} / 附录 ${agg[L]}`);
        }
      }
    }
    expect(mismatch).toEqual([]);
  });

  it('★ 生成的能力目录 == 文档附录（目录不许手抄成第三份真相）', () => {
    const generated = Object.fromEntries(CAPABILITY_CATALOG.map((e) => [e.id, e.layer]));
    expect(generated).toEqual(Object.fromEntries(appendix.map));
  });

  it('★ 附录 B（可直接调用）↔ 生成的白名单一致，且只允许 Q 层', () => {
    const inDoc = parseDirectSafe(doc);
    expect(inDoc.length).toBeGreaterThan(0); // 空了说明解析坏了
    expect([...DIRECT_CALL_SAFE].sort()).toEqual(inDoc);
    // 安全方向：白名单里的每一条都必须是 Q 层（不是 Q 就不该直接调）
    const notQ = inDoc.filter((id) => appendix.map.get(id) !== 'Q');
    expect(notQ, '这些在"可直接调用"白名单里却不是 Q 层：' + notQ.join(', ')).toEqual([]);
  });

  it('★ 附录 C（可提议）↔ 生成的白名单一致，且只允许 M 层', () => {
    const inDoc = parseProposable(doc);
    expect(inDoc.length).toBeGreaterThan(0);
    expect([...PROPOSABLE_CAPABILITIES].sort()).toEqual(inDoc);
    // 安全方向：可提议的必须是 M 层（Q 层该走 invoke_capability，R/P/F/X 一律不给）
    const notM = inDoc.filter((id) => appendix.map.get(id) !== 'M');
    expect(notM, '这些在"可提议"白名单里却不是 M 层：' + notM.join(', ')).toEqual([]);
  });

  it('★ 附录 B / C 的调用约定都 == preload 的真实形参（漂移即红）', () => {
    const params = preloadParamNames();
    const mismatch: string[] = [];
    const all = { ...DIRECT_SIGNATURES, ...PROPOSABLE_SIGNATURES };
    for (const [id, declared] of Object.entries(all)) {
      const actual = params.get(id);
      if (!actual) {
        mismatch.push(`${id}: preload 里找不到这个方法`);
        continue;
      }
      if (JSON.stringify(actual) !== JSON.stringify(declared)) {
        mismatch.push(`${id}: 附录声明 [${declared.join(', ')}] vs preload [${actual.join(', ')}]`);
      }
    }
    expect(mismatch, mismatch.join('\n')).toEqual([]);
  });

  it('★ R 层必须是空的（否则就是又一次"悬空承诺"）', () => {
    // 2026-10-08 自查：上一版把 69 个只读能力标成 R（"应用注入"），但**没有任何代码注入它们**,
    // 于是它们既不在附录 B/C、模型也取不到 —— 处于"谁也够不着"的悬空状态，而文档写着"会注入"。
    // 根因是把"提示词分段"（真的在注入）与"IPC 只读能力"（该按需取）混成了一类。
    //
    // 所以这里钉一条棘轮：**R 要么为空，要么先去把注入实现了再来改这条闸门**。
    const rLayer = [...appendix.map.entries()].filter(([, L]) => L === 'R').map(([k]) => k);
    expect(
      rLayer,
      'R 层不为空，但没有任何代码会注入它们（见 docs §1.1）。' +
        '要么把这些能力改成 Q（按需取），要么先把注入实现出来再动这条闸门：' +
        rLayer.join(', '),
    ).toEqual([]);
  });

  it('★ F 层（禁止进模型）不得出现在 AI 面里', () => {
    const forbidden = [...appendix.map.entries()]
      .filter(([, L]) => L === 'F')
      .map(([k]) => k.split('.')[0]);
    expect(forbidden.length).toBeGreaterThan(0); // terminal 必须还在 F 层
    const haystacks = AI_DIRS.map((d) => ({ d, text: readDirText(d) }));
    const hits: string[] = [];
    for (const ns of new Set(forbidden)) {
      for (const { d, text } of haystacks) {
        // 只在"AI 侧真的去调这个域"时报：出现 `<ns>:` 通道串
        if (new RegExp(`'${ns}:`).test(text)) hits.push(`${ns}: ← ${d}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('★ 正控：漏登记的附录 / 非法层必须被解析器抓出来', () => {
    const synthetic = 'flow.save = M\nterminal.create = ZZZ\n这行根本不是条目\n';
    const parsed = parseAppendix(synthetic);
    expect(parsed.map.has('flow.save')).toBe(true);
    expect(parsed.badLayers).toEqual(['terminal.create = ZZZ']);
    expect(parsed.badLines).toEqual(['这行根本不是条目']);
  });
});

describe('★ 作用对象（domain）：碰什么 —— 三把正交尺子的第二把', () => {
  it('★ 每条能力都有作用对象，且取值合法', () => {
    const bad = CAPABILITY_CATALOG.filter((e) => !DOMAINS.includes(e.domain));
    expect(
      bad.map((e) => e.id + ' → ' + e.domain),
      '这些能力的作用对象非法或缺失',
    ).toEqual([]);
  });

  it('★ 每个命名空间恰好一个作用对象（防"漏掉两个命名空间"那类错）', () => {
    const fromCatalog = new Set(CAPABILITY_CATALOG.map((e) => e.ns));
    const fromMap = new Set(Object.keys(DOMAIN_BY_NAMESPACE));
    expect(
      [...fromCatalog].filter((ns) => !fromMap.has(ns)),
      '目录里有、映射表里没有',
    ).toEqual([]);
    expect(
      [...fromMap].filter((ns) => !fromCatalog.has(ns)),
      '映射表里有、目录里没有',
    ).toEqual([]);
    expect(fromCatalog.size).toBe(fromMap.size);
  });

  it('★ 按作用对象分组的并集 = 全部能力（不重不漏）', () => {
    const grouped = Object.values(CAPABILITIES_BY_DOMAIN).flat();
    expect(grouped.length, '分组后有重复').toBe(new Set(grouped).size);
    expect([...grouped].sort()).toEqual(CAPABILITY_CATALOG.map((e) => e.id).sort());
  });

  it('★ 分组与逐条标注一致（两份数据不许打架）', () => {
    for (const [domain, ids] of Object.entries(CAPABILITIES_BY_DOMAIN)) {
      for (const id of ids) {
        const entry = CAPABILITY_CATALOG.find((e) => e.id === id);
        expect(entry?.domain, id + ' 在 ' + domain + ' 组里，但标注是 ' + entry?.domain).toBe(
          domain,
        );
      }
    }
  });

  it('正控：作用对象表里的每个命名空间都真实存在于目录', () => {
    for (const ns of Object.keys(DOMAIN_BY_NAMESPACE)) {
      expect(
        CAPABILITY_CATALOG.some((e) => e.ns === ns),
        ns + ' 在映射表里却没有能力',
      ).toBe(true);
    }
  });
});
