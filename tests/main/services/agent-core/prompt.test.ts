// tests/main/services/agent-core/prompt.test.ts
//
// 系统提示的**段落注册**：能加段、能排序、空段不留空行、重名直接报错。
// 判据只有一条：加一段提示不该动 prompt.ts —— 注册了就出现在组装结果里。
import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  listPromptSections,
  registerPromptSection,
} from '@main/services/agent-core/prompt';
import { registerTool } from '@main/services/agent-core/core';

describe('★ 系统提示：段落注册与组装', () => {
  it('内置段落齐全，工作区与工具名都在里面', () => {
    const ids = listPromptSections().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['role', 'tools', 'rules']));
    const text = buildSystemPrompt('D:/ws');
    expect(text).toContain('D:/ws');
    expect(text).toContain('read_file');
    expect(text).toContain('规矩：');
  });

  it('★ 注册一段就出现在组装结果里，顺序由 order 决定', () => {
    registerPromptSection({
      id: 'project-notes',
      order: 15,
      render: () => '项目约定：包管理器用 pnpm，不要用 npm。',
    });
    const text = buildSystemPrompt('D:/ws');
    expect(text).toContain('项目约定');
    // order 15 在 role(10) 之后、tools(20) 之前
    const roleAt = text.indexOf('执行型助手');
    const notesAt = text.indexOf('项目约定');
    const toolsAt = text.indexOf('可用工具');
    expect(roleAt).toBeLessThan(notesAt);
    expect(notesAt).toBeLessThan(toolsAt);
  });

  it('★ 工具段落来自注册表：注册一个工具，提示里立刻有它', () => {
    registerTool({
      name: 'deploy_tool',
      description: '部署（提示段落用例）',
      async run() {
        return 'ok';
      },
    });
    expect(buildSystemPrompt('D:/ws')).toContain('deploy_tool');
  });

  it('空段落不留空行（render 返回空串就跳过）', () => {
    registerPromptSection({ id: 'empty-section', order: 25, render: () => '   ' });
    const text = buildSystemPrompt('D:/ws');
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('重名 / 非法 id / 缺 render → 注册时直接拒', () => {
    expect(() => registerPromptSection({ id: 'role', render: () => 'x' })).toThrow(/重复注册/);
    expect(() => registerPromptSection({ id: 'Bad Id', render: () => 'x' })).toThrow(/kebab/);
    // @ts-expect-error 故意缺 render
    expect(() => registerPromptSection({ id: 'no-render' })).toThrow(/render/);
  });
});

/**
 * 第 59 批：`search_sessions` 的指引段是**条件注入**。
 *
 * 与 `file-reference` 同一个理由：讲一个模型调不到的工具只会让它反复试一个
 * 不存在的名字。所以只在（a）有工作区 且（b）该工具在这次的可用工具表里 时才出现。
 */
describe('★ search_sessions 指引段：条件注入', () => {
  it('工具可用时出现，并说清"什么时候用"', () => {
    const text = buildSystemPrompt('D:/ws', ['search_sessions'], { tools: ['search_sessions'] });
    expect(text).toContain('搜索历史会话');
    expect(text).toContain('上次');
  });

  it('工具不可用时不出现（不骗模型去调一个拿不到的工具）', () => {
    const text = buildSystemPrompt('D:/ws', [], { tools: ['read_file'] });
    expect(text).not.toContain('search_sessions 能搜');
  });

  it('没有工作区时不出现（没有项目就没有"这个项目的历史会话"）', () => {
    const text = buildSystemPrompt('', [], { tools: ['search_sessions'] });
    expect(text).not.toContain('search_sessions 能搜');
  });
});
