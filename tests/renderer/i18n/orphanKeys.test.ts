// tests/renderer/i18n/orphanKeys.test.ts
//
// 闸门：**语言包里不许留没人用的键**（孤儿键）。
//
// ## 为什么要有这条闸门
// 语言包由 `scripts/i18n/inject.mjs` 按源码实际用到的 key 注入，但它**绝不清空命名空间**
// （理由见该脚本：动态拼接的 key 无法静态枚举，清空会误删）。于是**删组件不会删文案** ——
// 组件删掉了、调用点没了，语言包里那一条还在。
// 实测代价：P4–P6 双语改造跑完，语言包里积了 39 条这样的孤儿键，其中两个命名空间整片是死的。
// 危害不是"浪费几 KB"，而是**冒充"还有这个功能"**：后来的人（包括 AI）看到一堆像是活的文案，
// 会据此判断某能力存在。
//
// ## 判据：什么算"有人用"
//   1. 任何 `t('x')` / `hasKey('x')` 的静态字面量；
//   2. 任何**带引号形式出现**的 key 字面量 —— 覆盖"键写在映射表里、用 `t(map[k])` 取值"的用法
//      （如 `palette.type*` / `inline.placeholder.*`），它们不出现在 `t()` 的参数位置；
//   3. `DYNAMIC_PREFIXES` 里的动态家族 —— key 由运行时数据拼出来，静态扫不到（见下方注释）。
//
// ## 已知边界（白名单的固有代价）
// 白名单按**前缀族**整族放行，所以族内部真没人用的键（例如 `field.label.<已删端口的 id>`）
// 这条闸门看不出来 —— 那类"目录与文案对不上"由 `fieldLabels` 的目录对照兜。
// 它与 `legacyCarriersRemoved`（防复活）、`noHardcodedCopy`（防硬编码）、`i18n.test.ts`（键集合/空值/
// 占位符）合起来才是完整的；单看任何一条都不足以说明语言包是干净的。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import zhCN from '@renderer/i18n/zh-CN.json';
import enUS from '@renderer/i18n/en-US.json';

const ROOT = process.cwd();

/** 本文件不参与扫描：它自己要写白名单前缀和 `t(`x.${y}`)` 的说明，参与进来等于给死键"自我认证" */
const SELF = resolve(ROOT, 'tests/renderer/i18n/orphanKeys.test.ts');

/**
 * 动态 key 家族：这些 key 由运行时数据（端口 id / botType 取值）拼出来，静态源码里看不见。
 * 每条都要写清"谁在拼" —— 说不清的就不该进白名单。
 */
const DYNAMIC_PREFIXES: Array<{ prefix: string; why: string }> = [
  {
    prefix: 'field.label.',
    why: 'renderer/i18n/fieldLabels.ts 用 fieldLabel()：key = 端口 id / 配置项名',
  },
  { prefix: 'field.hint.', why: '同上（字段提示）' },
  { prefix: 'field.portHint.', why: '同上（端口提示）' },
  {
    prefix: 'launch.botType.',
    why: 'ConfigPanel / NewProjectDialog：key = `launch.botType.${取值}`',
  },
  {
    prefix: 'data.field.',
    why: 'renderer/i18n/fieldLabels.ts:40 拼 `data.field.${字段 key}`（玩家数据/模板字段的通用显示名）',
  },
  {
    prefix: 'data.usage.',
    why: 'components/launch/playerFieldsModel.ts:184 拼 `data.usage.${mode}`（可增减/读取/保存等用法说明）',
  },
  {
    prefix: 'data.configCategory.',
    why: 'components/launch/configCategoryLabels.ts 拼 `data.configCategory.${分类键}`（label 与 .desc）',
  },
  {
    prefix: 'exprVars.renameError.',
    why: 'components/blocks/ExpressionVarHelper.tsx:265 拼 `exprVars.renameError.${code}`（重命名失败原因）',
  },
];

/** 扫描范围：凡是能调用 t() 的地方都要算（含测试里的 t() 行为用例） */
const SCAN_DIRS = ['src', 'tests', 'scripts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.') || f === 'dist' || f === 'out') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(f)) out.push(p);
  }
  return out;
}

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v))
      keys.push(...flattenKeys(v, fullKey));
    else keys.push(fullKey);
  }
  return keys;
}

/** 抽成纯函数，便于用反向用例证明"这条闸门有牙齿" */
function findOrphans(keys: readonly string[], isReferenced: (key: string) => boolean): string[] {
  return keys.filter((k) => !isReferenced(k));
}

const scanned = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d))).filter((p) => p !== SELF);
const sourceText = scanned.map((p) => readFileSync(p, 'utf-8')).join('\n');

const calledKeys = new Set<string>();
for (const m of sourceText.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_.]+)\1/g)) calledKeys.add(m[2]);
for (const m of sourceText.matchAll(/hasKey\(\s*(['"])([A-Za-z0-9_.]+)\1/g)) calledKeys.add(m[2]);

/** 键是否以**带引号的完整 key** 出现在源码里（映射表用法，见文件头判据 2） */
function appearsQuoted(key: string): boolean {
  return sourceText.includes(`'${key}'`) || sourceText.includes(`"${key}"`);
}

function isReferenced(key: string): boolean {
  if (calledKeys.has(key) || appearsQuoted(key)) return true;
  return DYNAMIC_PREFIXES.some((d) => key.startsWith(d.prefix));
}

const zhKeys = flattenKeys(zhCN);
const enKeys = flattenKeys(enUS);

describe('语言包孤儿键闸门', () => {
  it('扫描范围非空（防止路径写错导致测试空转通过）', () => {
    expect(scanned.length).toBeGreaterThan(100);
    expect(zhKeys.length).toBeGreaterThan(1000);
  });

  it('语言包里没有"没人用的键"', () => {
    const orphans = findOrphans(zhKeys, isReferenced).sort();
    expect(
      orphans,
      `这些键在源码里找不到任何使用点（含映射表用法与动态家族）：\n${orphans.join('\n')}\n` +
        '多半是删组件时留下的残留 —— 从 zh-CN.json 与 en-US.json 里一起删掉；\n' +
        '若确实是**由运行时数据拼出来**的 key，把它的前缀加进本文件顶部的 DYNAMIC_PREFIXES 并写明谁在拼。',
    ).toEqual([]);
  });

  it('动态家族白名单每一项都真的还在被动态拼接（防止白名单变成孤儿键的藏身地）', () => {
    const templates = [...sourceText.matchAll(/\bt\(\s*`([^`]*)\$\{/g)].map((m) => m[1]);
    const dead = DYNAMIC_PREFIXES.filter((d) => !templates.some((tpl) => tpl.startsWith(d.prefix)));
    expect(
      dead.map((d) => `${d.prefix}（${d.why}）`),
      '这些前缀已不再被动态拼接 —— 请从 DYNAMIC_PREFIXES 删除，否则它会一直给同族孤儿键放行',
    ).toEqual([]);
  });

  // 反向用例：上面第一条断言在 isReferenced 写坏（例如恒返回 true）时会空转通过。
  it('反向用例：真没人用的键会被认出来，动态家族不会被误报', () => {
    const probeKeys = flattenKeys({
      zzzNeverUsed: 'x',
      field: { label: { somePortId: 'x' } },
    });
    expect(findOrphans(probeKeys, isReferenced)).toEqual(['zzzNeverUsed']);
    expect(isReferenced('field.label.somePortId')).toBe(true);
  });
});
