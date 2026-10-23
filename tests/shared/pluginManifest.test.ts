// tests/shared/pluginManifest.test.ts
//
// 插件身份字段的**共享校验**：渲染层 / 主进程 / 外部清单三处共用一份规则。
import { describe, it, expect } from 'vitest';
import { validatePluginIdentity } from '../../src/shared/plugins/manifest';

describe('★ 插件身份校验（shared）', () => {
  it('合法清单归一化（trim name、保留 requires/permissions）', () => {
    const r = validatePluginIdentity({
      id: 'me.p',
      name: '  My Plugin  ',
      version: '0.1.0',
      permissions: ['slot'],
      requires: '>=0.1.0',
      extra: 'ignored',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('My Plugin');
      expect(r.value.requires).toBe('>=0.1.0');
      expect(r.value.permissions).toEqual(['slot']);
      expect('extra' in r.value).toBe(false);
    }
  });

  it('缺字段 / 非法 id / 版本不是 x.y.z / 能力不是字符串 → 拒', () => {
    expect(validatePluginIdentity(null).ok).toBe(false);
    expect(validatePluginIdentity({ id: 'bad id!', name: 'n', version: '1.0.0' }).ok).toBe(false);
    expect(validatePluginIdentity({ id: 'a.b', name: ' ', version: '1.0.0' }).ok).toBe(false);
    expect(validatePluginIdentity({ id: 'a.b', name: 'n', version: '1.0' }).ok).toBe(false);
    expect(validatePluginIdentity({ id: 'a.b', name: 'n', version: '1.0.0', permissions: [1] }).ok).toBe(false);
  });
});
