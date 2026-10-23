// tests/shared/nodes/legacyCarriersRemoved.test.ts
//
// 闸门：**旧的字段元数据载体不许复活**。
//
// ## 为什么要有这条闸门
// 字段中文名 / 提示 / 内联规则曾有一套 YAML 载体：
//   `src/shared/nodes/nodeMetadata.ts` 读 `config/labels.yaml` / `hints.yaml` / `fieldUI.yaml`，
//   唯一的消费方是 `src/renderer/src/lib/inferConfigSchema.ts`，而它全仓 0 个调用点
//   —— 整条链是死代码，却仍被文档与注释反复引用，像个还活着的真相源。
// 后来字段文案改由 i18n 表承担（`field.label.*` / `field.hint.*`，中英各一份），
// 枚举选项统一在 `fieldOptions.ts`，这条链整体删除。
//
// 危险不在于"删了"，而在于**复活**：只要有人再写回一个 `labels.yaml`，
// 就会出现第二份字段名真相源 —— 与 `modeListConsistency` 防的漂移是同一类事故。
// 所以照它写一条闸门：旧载体一旦回来就红。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

/** 已删除的旧载体文件（见 git 历史） */
const REMOVED_FILES = [
  'src/shared/nodes/nodeMetadata.ts',
  'src/shared/nodes/config/labels.yaml',
  'src/shared/nodes/config/hints.yaml',
  'src/shared/nodes/config/fieldUI.yaml',
  'src/renderer/src/lib/inferConfigSchema.ts',
  'src/renderer/src/stores/localeStore.ts',
  'src/shared/domain/flow/flow.ts',
  'src/shared/domain/flow/nodeV2.ts',
];

/** 已整个删除的旧载体目录 */
const REMOVED_DIRS = ['src/shared/nodes/config', 'src/shared/domain/flow'];

/** 被删模块的名字：不允许再出现在任何 import / require 的字面量里 */
const REMOVED_MODULES =
  /['"][^'"]*(?:nodeMetadata|inferConfigSchema|localeStore|domain\/flow)['"]/;

/** 被删的 YAML 文件名：不允许再被代码按名字读取 */
const REMOVED_YAML = /['"][^'"]*(?:labels|hints|fieldUI)\.yaml['"]/;

/**
 * 已删除的「声明式字段模型」死类型。
 *
 * 这三个类型（FieldWidget / FieldShowWhen / ConfigField）是"由 schema 自动渲染表单"那条
 * 路线的产物：唯一渲染器 `SchemaForm.tsx` 与唯一数据源 `inferConfigSchema()` 都已删，
 * 类型本身 0 消费方，留着就是**第二份字段模型真相源**（真正的字段模型是
 * `components/blocks/configFieldModel.ts` 的 `ConfigFieldModel`）。
 * 注意用词边界：`ConfigFieldModel` / `ConfigFieldRow` / `isConfigFieldVisible` 都是活代码，不匹配。
 */
const REMOVED_FIELD_MODEL_TYPES = /\b(?:FieldWidget|FieldShowWhen|ConfigField)\b/;

/** 扫描范围（只扫源码与脚本；文档/历史记录里提到它们是允许的） */
const SCAN_DIRS = ['src', 'scripts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.') || f === 'dist' || f === 'out') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(f)) out.push(p);
  }
  return out;
}

const scanned = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d))).filter((p) => !p.includes('.dsh-backup'));

describe('字段元数据旧载体已清除', () => {
  it('扫描范围非空（防止路径写错导致测试空转通过）', () => {
    expect(scanned.length).toBeGreaterThan(100);
  });

  it('旧载体文件都不存在了', () => {
    const back = REMOVED_FILES.filter((f) => existsSync(resolve(ROOT, f)));
    expect(
      back,
      `这些旧载体又被加回来了：\n${back.join('\n')}\n` +
        '字段文案请写进 src/renderer/src/i18n/（field.label.* / field.hint.*），' +
        '枚举选项请写进 src/shared/nodes/fieldOptions.ts。',
    ).toEqual([]);
  });

  it('旧载体目录已整个删除', () => {
    const back = REMOVED_DIRS.filter((d) => existsSync(resolve(ROOT, d)));
    expect(
      back,
      `这些旧载体目录又被加回来了：\n${back.join('\n')}\n` +
        '目录流程的类型只应定义在 src/shared/types/flow.ts 与 src/shared/types/nodeV2.ts' +
        '（第二份副本会让 FLOW_SCHEMA_VERSION 这类常量各说各话，见 docs/lowcode-design.md 原则 18）。',
    ).toEqual([]);
  });

  it('源码里不再有人 import 这些旧模块', () => {
    const hits = scanned
      .filter((p) => REMOVED_MODULES.test(readFileSync(p, 'utf-8')))
      .map((p) => p.slice(ROOT.length + 1));
    expect(hits, `这些文件还在引用已删除的模块：\n${hits.join('\n')}`).toEqual([]);
  });

  it('源码里不再有人按文件名读这些 YAML', () => {
    const hits = scanned
      .filter((p) => REMOVED_YAML.test(readFileSync(p, 'utf-8')))
      .map((p) => p.slice(ROOT.length + 1));
    expect(hits, `这些文件还在读已删除的 YAML：\n${hits.join('\n')}`).toEqual([]);
  });

  it('「声明式字段模型」的死类型没有复活', () => {
    const hits = scanned
      .filter((p) => REMOVED_FIELD_MODEL_TYPES.test(readFileSync(p, 'utf-8')))
      .map((p) => p.slice(ROOT.length + 1));
    expect(
      hits,
      `这些文件又重新定义/引用了 FieldWidget / FieldShowWhen / ConfigField：\n${hits.join('\n')}\n` +
        '字段模型请用 components/blocks/configFieldModel.ts 的 buildConfigFields()，' +
        '字段显隐请用 shared/nodes/fieldVisibility.ts。',
    ).toEqual([]);
  });
});
