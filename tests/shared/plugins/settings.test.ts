// tests/shared/plugins/settings.test.ts
//
// 插件设置共享契约：清单声明 → 表单能画的项 / 用户提交的值 → 能被插件读的标量。
// 这里的规则同时被主进程（校验/落盘）与渲染层（画表单）使用，写错一处两边就漂移。
import { describe, it, expect } from 'vitest';
import {
  MAX_PLUGIN_SETTINGS,
  coerceSettingValues,
  defaultSettingValues,
  mergeSettingValues,
  normalizeSettingSpecs,
} from '@shared/plugins/settings';

describe('★ normalizeSettingSpecs：第三方清单不可信，坏项直接丢', () => {
  it('★ 留下合法项，丢掉坏键名/坏类型/无 label/重复键', () => {
    const specs = normalizeSettingSpecs([
      { key: 'greeting', label: '问候语', type: 'string' },
      { key: 'Bad-Key', label: 'x', type: 'string' },
      { key: 'other', label: '', type: 'string' },
      { key: 'kind', label: 'x', type: 'magic' },
      { key: 'greeting', label: '重复', type: 'string' },
      { key: 'retries', label: '重试次数', type: 'number' },
    ]);
    expect(specs.map((s) => s.key)).toEqual(['greeting', 'retries']);
  });

  it('select 没有可选项 = 没法选，整项丢弃；有选项则去重去空', () => {
    expect(normalizeSettingSpecs([{ key: 'mode', label: '模式', type: 'select' }])).toEqual([]);
    const ok = normalizeSettingSpecs([
      {
        key: 'mode',
        label: '模式',
        type: 'select',
        options: [{ value: 'a' }, { value: 'a' }, { value: '  ' }, { value: 'b', label: 'B' }],
      },
    ]);
    expect(ok[0]?.options).toEqual([{ value: 'a' }, { value: 'b', label: 'B' }]);
  });

  it('坏默认值丢掉，不带着坏值进表单', () => {
    const specs = normalizeSettingSpecs([
      { key: 'n', label: 'N', type: 'number', default: 'NaN' },
      { key: 'flag', label: 'F', type: 'boolean', default: 'true' },
    ]);
    expect(specs[0]?.default).toBeUndefined();
    expect(specs[1]?.default).toBe(true);
  });

  it('项数上限', () => {
    const raw = Array.from({ length: MAX_PLUGIN_SETTINGS + 5 }, (_, i) => ({
      key: `k${i}`,
      label: `K${i}`,
      type: 'string',
    }));
    expect(normalizeSettingSpecs(raw)).toHaveLength(MAX_PLUGIN_SETTINGS);
  });

  it('不是数组 → 空（老清单没有 settings 字段）', () => {
    expect(normalizeSettingSpecs(undefined)).toEqual([]);
    expect(normalizeSettingSpecs({ key: 'a' })).toEqual([]);
  });
});

describe('★ coerceSettingValues：类型不对就整体失败，不静默回退', () => {
  const specs = normalizeSettingSpecs([
    { key: 'greeting', label: '问候语', type: 'string', default: '你好' },
    { key: 'retries', label: '重试', type: 'number', default: 3 },
    { key: 'loud', label: '大声', type: 'boolean', default: false },
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      default: 'fast',
      options: [{ value: 'fast' }, { value: 'slow' }],
    },
  ]);

  it('★ 合法提交原样收下；数字串/布尔串也能收（表单回传都是字符串）', () => {
    const res = coerceSettingValues(specs, {
      greeting: '  hi  ',
      retries: '5',
      loud: 'true',
      mode: 'slow',
    });
    expect(res).toEqual({
      ok: true,
      values: { greeting: 'hi', retries: 5, loud: true, mode: 'slow' },
    });
  });

  it('未提交的键用出厂值；声明外的键丢掉（插件删过的项不该继续流进去）', () => {
    const res = coerceSettingValues(specs, { mode: 'slow', removed_key: 'x' });
    expect(res).toEqual({
      ok: true,
      values: { greeting: '你好', retries: 3, loud: false, mode: 'slow' },
    });
  });

  it('类型不对 → ok:false 并指出是哪个键', () => {
    const res = coerceSettingValues(specs, { retries: 'abc' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('retries');
    expect(res.error).toContain('number');
  });

  it('select 只接受声明里的值；超长文本拒绝', () => {
    expect(coerceSettingValues(specs, { mode: 'turbo' }).ok).toBe(false);
    expect(coerceSettingValues(specs, { greeting: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('非对象输入 = 空提交（全用出厂值）', () => {
    const res = coerceSettingValues(specs, null);
    expect(res.ok && res.values).toEqual({ greeting: '你好', retries: 3, loud: false, mode: 'fast' });
  });
});

describe('★ defaultSettingValues / mergeSettingValues', () => {
  const specs = normalizeSettingSpecs([
    { key: 'a', label: 'A', type: 'string', default: 'x' },
    { key: 'b', label: 'B', type: 'number' },
  ]);

  it('★ 没写 default 的项不出现（插件读到 null，不是空串）', () => {
    expect(defaultSettingValues(specs)).toEqual({ a: 'x' });
  });

  it('★ 已存值覆盖出厂值；已存值坏了就整份回落到出厂值', () => {
    expect(mergeSettingValues(specs, { a: 'y', b: 2 })).toEqual({ a: 'y', b: 2 });
    expect(mergeSettingValues(specs, { a: 'y', b: 'nope' })).toEqual({ a: 'x' });
  });
});
