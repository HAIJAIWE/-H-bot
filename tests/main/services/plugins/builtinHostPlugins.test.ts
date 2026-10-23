// tests/main/services/plugins/builtinHostPlugins.test.ts
//
// 内置工具集作为"随包插件"注册：默认层有真实对象，可寻址/启停/覆盖才有对象可作用。
import { describe, it, expect, afterAll } from 'vitest';
import {
  BUILTIN_CORE_TOOLS_ID,
  registerBuiltinHostPlugins,
} from '@main/services/plugins/builtinHostPlugins';
import { listMainPlugins, setMainPluginEnabled, unregisterMainPlugin } from '@main/services/plugins/host';
import { listTools } from '@main/services/agent-core/core';
import { DEFAULT_HOST_PLUGINS } from '@main/services/plugins/defaults';

describe('★ 内置工具集 = 随包插件', () => {
  it('注册后：默认清单可寻址、清单带 builtin 来源、工具仍在', () => {
    registerBuiltinHostPlugins();
    expect(DEFAULT_HOST_PLUGINS.some((p) => p.id === BUILTIN_CORE_TOOLS_ID)).toBe(true);
    const info = listMainPlugins().find((p) => p.id === BUILTIN_CORE_TOOLS_ID);
    expect(info).toMatchObject({ enabled: true, source: 'builtin' });
    expect(listTools().map((t) => t.name)).toContain('read_file');
  });

  it('★ 核心工具 shipped → 服务层拒绝停用（not-removable），工具不受影响', () => {
    registerBuiltinHostPlugins();
    expect(() => setMainPluginEnabled(BUILTIN_CORE_TOOLS_ID, false)).toThrow(/not-removable/);
    expect(listTools().map((t) => t.name)).toContain('read_file');
  });

  it('幂等：重复注册不会抛 already registered', () => {
    registerBuiltinHostPlugins();
    expect(() => registerBuiltinHostPlugins()).not.toThrow();
  });

  it('★ 模块系统语义：可停用的域插件卸载后工具真的消失，启用后回来', () => {
    registerBuiltinHostPlugins();
    const ids = listMainPlugins().map((p) => p.id);
    expect(ids).toContain('builtin.tool-registry');
    expect(ids).toContain('builtin.tools.runtime');
    expect(ids).toContain('builtin.tools.flow');
    // 工具插件依赖 tools 服务：注册表在，它们才是 active
    expect(listMainPlugins().find((p) => p.id === 'builtin.tools.runtime')).toMatchObject({
      active: true,
      inject: ['tools'],
      missing: [],
    });
    setMainPluginEnabled('builtin.tools.runtime', false);
    expect(listTools().map((t) => t.name)).not.toContain('run_command');
    setMainPluginEnabled('builtin.tools.runtime', true);
    expect(listTools().map((t) => t.name)).toContain('run_command');
  });

  afterAll(() => {
    // 恢复默认可用状态（本文件内后续若有测试仍拿得到核心工具）
    registerBuiltinHostPlugins();
    const info = listMainPlugins().find((p) => p.id === BUILTIN_CORE_TOOLS_ID);
    if (info && !info.enabled) setMainPluginEnabled(BUILTIN_CORE_TOOLS_ID, true);
    // 不 unregister：core.ts 的自动注册已被插件覆盖，卸载会让本进程后续用例失去核心工具
    void unregisterMainPlugin;
  });
});
