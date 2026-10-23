// tests/main/services/ai/agents.test.ts
//
// # 闸门：按模式分专家（M5）—— 工具子集必须**互不越界**
//
// 用户原话："一个管低代码开发，一个管代码编辑器里开发"。
// 这条闸门钉住：Builder 不写源码、Coder 不动流程节点，两个角色都能读（自检/排查需要）。
import { describe, it, expect } from 'vitest';
import {
  AGENT_TOOLS,
  AGENT_ROLE_HINT,
  roleForMode,
  toolsForOnboarding,
  toolsForRole,
} from '@main/services/ai/agents';
// 真源是 registry 聚合出的 defs（10/18 起）；`ai/tools.ts` 里那份是旧静态表，别拿它当全局表
import { ALL_TOOL_DEFINITIONS } from '@main/services/ai/tools/defs';

const names = (defs: { name: string }[]) => defs.map((d) => d.name);

describe('按模式分专家', () => {
  it('模式 → 角色：未传/未知一律低代码（创作只能显式选）', () => {
    expect(roleForMode(undefined)).toBe('builder');
    expect(roleForMode('blocks')).toBe('builder');
    expect(roleForMode('code')).toBe('coder');
    expect(roleForMode('duo')).toBe('duo');
    expect(roleForMode('creator')).toBe('creator');
    // 拼错/新增值不许静默落到 creator
    expect(roleForMode('creatr' as never)).toBe('builder');
  });

  it('Builder 不写源码，Coder 不动流程节点（互不越界）', () => {
    const builder = names(toolsForRole('builder'));
    const coder = names(toolsForRole('coder'));

    for (const t of ['write_code', 'write_file']) {
      expect(builder, `builder 不该有 ${t}`).not.toContain(t);
      expect(coder, `coder 该有 ${t}`).toContain(t);
    }
    for (const t of ['add_node', 'update_node', 'delete_node', 'connect_nodes', 'apply_template']) {
      expect(coder, `coder 不该有 ${t}`).not.toContain(t);
      expect(builder, `builder 该有 ${t}`).toContain(t);
    }
  });

  it('两个角色都能读（自检/排查要靠它）', () => {
    for (const role of ['builder', 'coder'] as const) {
      const tools = names(toolsForRole(role));
      for (const t of ['read_flow', 'read_code', 'read_logs', 'read_file', 'run_test', 'check_capabilities']) {
        expect(tools, `${role} 缺 ${t}`).toContain(t);
      }
    }
  });

  it('duo = 两边并集（去重）；creator 只有改文件的活', () => {
    const builder = new Set(names(toolsForRole('builder')));
    const coder = new Set(names(toolsForRole('coder')));
    const duo = names(toolsForRole('duo'));
    expect(new Set(duo).size).toBe(duo.length); // 不许重复
    for (const t of [...builder, ...coder]) expect(duo).toContain(t);

    const creator = names(toolsForRole('creator'));
    expect(creator).toContain('write_code');
    expect(creator).toContain('write_file');
    for (const t of ['add_node', 'connect_nodes', 'generate_code', 'create_ai_node', 'apply_template']) {
      expect(creator, `creator 不该有 ${t}（那是用户项目的活）`).not.toContain(t);
    }
  });

  it('AGENT_TOOLS 里每个名字都真实存在（拼错 = 工具静默消失）', () => {
    const all = new Set(names(ALL_TOOL_DEFINITIONS));
    const unknown: string[] = [];
    for (const list of Object.values(AGENT_TOOLS)) {
      for (const t of list) if (!all.has(t)) unknown.push(t);
    }
    expect(unknown, `这些名字在 ALL_TOOL_DEFINITIONS 里查不到：${unknown.join(', ')}`).toEqual([]);
  });

  it('toolsForRole 按全局表顺序输出（描述/分类不许另一份）', () => {
    const order = names(ALL_TOOL_DEFINITIONS);
    const picked = names(toolsForRole('duo'));
    const idx = picked.map((t) => order.indexOf(t));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    // 输出的是全局表里的**同一个对象**，不是重建的定义
    const byName = new Map(ALL_TOOL_DEFINITIONS.map((d) => [d.name, d]));
    expect(toolsForRole('duo')[0]).toBe(byName.get(picked[0]));
  });

  it('开荒模式：没有项目 ⇒ 只能查/看/提议', () => {
    expect(names(toolsForOnboarding())).toEqual([
      'search_capabilities',
      'describe_capability',
      'propose_capability',
    ]);
  });
});

describe('角色提示词：说清"该干什么 / 怎么才能做到"', () => {
  it('每个角色都有提示词，且都提到这台应用自己的能力', () => {
    for (const role of ['builder', 'coder', 'duo', 'creator'] as const) {
      const hint = AGENT_ROLE_HINT[role];
      expect(hint.length).toBeGreaterThan(50);
      expect(hint).toContain('search_capabilities');
      expect(hint).toContain('propose_capability');
    }
  });

  it('builder/coder 都指路"切到双向"，不是只说不能做', () => {
    for (const role of ['builder', 'coder'] as const) {
      expect(AGENT_ROLE_HINT[role]).toContain('双向');
      expect(AGENT_ROLE_HINT[role]).toContain('别只说');
    }
  });

  it('creator 六条纪律都在（精简提示词时不许删）', () => {
    const hint = AGENT_ROLE_HINT.creator;
    expect(hint).toContain('框架工作区');
    expect(hint).toContain('读');
    expect(hint).toContain('tsconfig.node.json');
    expect(hint).toContain('tsconfig.web.json');
    expect(hint).toContain('重启');
    expect(hint).toContain('可回退');
    // ⑥ 只指向清单文件，不抄清单内容
    expect(hint).toContain('securityCriticalPaths.ts');
    expect(hint).not.toContain('pathGuard');
    expect(hint).not.toContain('fileOps');
  });
});
