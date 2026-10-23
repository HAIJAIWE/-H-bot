// tests/main/services/ai/proposal.test.ts
import { describe, it, expect } from 'vitest';
import vm from 'vm';
import { toolCallToOperations } from '@main/services/ai/proposal';

describe('toolCallToOperations', () => {
  it('add_node 转为 add_node operation', () => {
    const ops = toolCallToOperations('add_node', {
      nodeKind: 'message_received',
      tempRef: 'new_trigger',
      label: '收到消息',
      config: {},
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      kind: 'add_node',
      tempRef: 'new_trigger',
      nodeKind: 'message_received',
      label: '收到消息',
      config: {},
    });
  });

  it('connect_nodes 转为 connect operation（工具名是 connect_nodes 不是 connect）', () => {
    const ops = toolCallToOperations('connect_nodes', {
      sourceRef: 'new_trigger',
      sourcePortId: 'out',
      targetRef: 'new_action',
      targetPortId: 'in',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('connect');
    expect(ops[0]).toMatchObject({
      sourceRef: 'new_trigger',
      sourcePortId: 'out',
      targetRef: 'new_action',
      targetPortId: 'in',
    });
  });

  it('旧的 connect 工具名不再匹配（应返回空数组）', () => {
    const ops = toolCallToOperations('connect', {
      sourceRef: 'new_trigger',
      targetRef: 'new_action',
    });
    expect(ops).toEqual([]);
  });

  it('update_node 转为 update_config operation（工具名是 update_node 不是 update_config）', () => {
    const ops = toolCallToOperations('update_node', {
      nodeRef: 'node_1',
      config: { message: 'hi' },
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('update_config');
    expect(ops[0]).toMatchObject({ nodeRef: 'node_1', config: { message: 'hi' } });
  });

  it('旧的 update_config 工具名不再匹配（应返回空数组）', () => {
    const ops = toolCallToOperations('update_config', {
      nodeRef: 'node_1',
      config: {},
    });
    expect(ops).toEqual([]);
  });

  it('未知工具返回空数组', () => {
    const ops = toolCallToOperations('unknown_tool', {});
    expect(ops).toEqual([]);
  });

  it('generate_code 转为 generate_code operation', () => {
    const ops = toolCallToOperations('generate_code', {});
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('generate_code');
  });

  it('write_code 用 assessScriptRisk 独立评估，不信 LLM 自报 riskLevel', () => {
    // LLM 自报 low，但内容含 os.system，服务端应独立评出 high
    const ops = toolCallToOperations('write_code', {
      filePath: 'test.py',
      content: 'import os; os.system("rm -rf /")',
      riskLevel: 'low',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('write_code');
    expect((ops[0] as { riskLevel: string }).riskLevel).toBe('high');
  });

  it('write_code 兼容 filePath（主）', () => {
    const ops = toolCallToOperations('write_code', {
      filePath: 'handler.py',
      content: 'x = 1',
    });
    expect(ops).toHaveLength(1);
    expect((ops[0] as { filePath: string }).filePath).toBe('handler.py');
  });

  it('write_code 向后兼容 filename', () => {
    const ops = toolCallToOperations('write_code', {
      filename: 'handler.py',
      content: 'x = 1',
    });
    expect(ops).toHaveLength(1);
    expect((ops[0] as { filePath: string }).filePath).toBe('handler.py');
  });

  it('write_code 安全内容评估为 low', () => {
    const ops = toolCallToOperations('write_code', {
      filePath: 'safe.py',
      content: 'async def hello(): return "hi"',
      riskLevel: 'high',
    });
    expect(ops).toHaveLength(1);
    // 服务端独立评估为 low，覆盖 LLM 自报的 high
    expect((ops[0] as { riskLevel: string }).riskLevel).toBe('low');
  });
});

/**
 * create_ai_node 是**唯一会生成多个文件**的提案（插件包 = manifest + index.js）。
 *
 * 这里用 vm 真跑一遍 index.js 拿它导出的对象，而不是拿正则去抠字符串 ——
 * 前者能同时验"生成的代码语法没坏"和"字段确实在里面"，后者两边都会骗自己。
 *
 * 2026-10-23 恢复说明：原文件在第 119–207 行之间被裁掉（只剩 pkg 断言的尾巴），
 * 磁带里没有完整快照；这段按 `proposal.ts:237-272` 的现状（AI_PLUGIN_PREFIX='ai-'、
 * SNAKE_NAME_RE、parsePorts 只吃 JSON 字符串）重写。
 */
describe('create_ai_node 生成插件包', () => {
  const aiNodeArgs = {
    funcName: 'weather_query',
    label: '天气查询',
    summary: '查一个城市的天气',
    icon: '🌤️',
    handler: 'async (ctx) => ({ text: "天气:" + String(ctx.args.city) })',
    // 工具参数只支持基础类型，端口是 JSON **字符串**（parsePorts 的实现约束）
    inputs: JSON.stringify([
      { id: 'in', name: 'in', kind: 'control' },
      { id: 'city', name: 'city', kind: 'data', dataType: 'string' },
    ]),
    outputs: JSON.stringify([
      { id: 'out', name: 'out', kind: 'control' },
      { id: 'result', name: 'result', kind: 'data', dataType: 'string' },
    ]),
  };

  it('产出 manifest.json + index.js 两个写盘操作，index.js 能被 require 出插件包', () => {
    const ops = toolCallToOperations('create_ai_node', aiNodeArgs);

    expect(ops).toHaveLength(2);
    expect(ops.map((o) => (o as { filePath?: string }).filePath)).toEqual([
      'plugins/ai-weather_query/manifest.json',
      'plugins/ai-weather_query/index.js',
    ]);

    const manifest = JSON.parse((ops[0] as { content: string }).content) as { name: string; entry: string };
    expect(manifest.name).toBe('ai-weather_query');
    expect(manifest.entry).toBe('index.js');

    const sandbox: { module: { exports: unknown } } = { module: { exports: {} } };
    vm.runInNewContext((ops[1] as { content: string }).content, sandbox);
    const pkg = sandbox.module.exports as {
      name: string;
      nodes: Array<{
        kind: string;
        label: string;
        icon: string;
        handler: string;
        inputs: Array<{ id: string }>;
        outputs: Array<{ id: string }>;
      }>;
    };

    expect(pkg.name).toBe('ai-weather_query');
    expect(pkg.nodes).toHaveLength(1);
    expect(pkg.nodes[0].kind).toBe('weather_query');
    expect(pkg.nodes[0].label).toBe('天气查询');
    expect(pkg.nodes[0].icon).toBe('🌤️');
    expect(pkg.nodes[0].handler).toBe(aiNodeArgs.handler);
    expect(pkg.nodes[0].inputs.map((p) => p.id)).toEqual(['in', 'city']);
    expect(pkg.nodes[0].outputs.map((p) => p.id)).toEqual(['out', 'result']);
  });

  it('没给端口时用默认（一个控制进 / 一个控制出）', () => {
    const ops = toolCallToOperations('create_ai_node', {
      funcName: 'plain_node',
      handler: 'async () => ({ text: "ok" })',
    });
    const sandbox: { module: { exports: unknown } } = { module: { exports: {} } };
    vm.runInNewContext((ops[1] as { content: string }).content, sandbox);
    const pkg = sandbox.module.exports as {
      nodes: Array<{ inputs: Array<{ id: string }>; outputs: Array<{ id: string }> }>;
    };
    expect(pkg.nodes[0].inputs.map((p) => p.id)).toEqual(['in']);
    expect(pkg.nodes[0].outputs.map((p) => p.id)).toEqual(['out']);
  });

  it('create_ai_node 拒绝会拼进路径/源码的非法 funcName', () => {
    const cases = ['../../evil', 'class', 'Weather', '1bad', 'bad-name'];
    for (const funcName of cases) {
      expect(() => toolCallToOperations('create_ai_node', { ...aiNodeArgs, funcName })).toThrow();
    }
  });

  it('create_ai_node 拒绝非法 handler 源码', () => {
    expect(() =>
      toolCallToOperations('create_ai_node', {
        ...aiNodeArgs,
        handler: 'async (ctx) => {',
      }),
    ).toThrow();
    expect(() => toolCallToOperations('create_ai_node', { ...aiNodeArgs, handler: '' })).toThrow();
  });
});

/**
 * P1-2（2026-10-18）：write_file 在助手路径上曾经**没有提案转换** ——
 * 落到 default 返回空数组，模型却收到「操作已加入待确认计划」。
 * 这组用例钉住三件事：两个字段名都认、应用管理的文件仍然被拒、未知 mutation 返回空数组
 * （后者由 chatRun 的 ops.length===0 分支报「未执行」，不再假成功）。
 */
describe('write_file 与 write_code 在提案层同义', () => {
  it('write_file 的 path 转成 write_code 提案', () => {
    const ops = toolCallToOperations('write_file', {
      path: 'plugins/demo/index.js',
      content: 'module.exports = {}',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      kind: 'write_code',
      filePath: 'plugins/demo/index.js',
      content: 'module.exports = {}',
    });
  });

  it('write_file 也认 filePath（两个声明字段不能各写一个绕过校验）', () => {
    const ops = toolCallToOperations('write_file', { filePath: 'a.js', content: 'y' });
    expect(ops[0]).toMatchObject({ kind: 'write_code', filePath: 'a.js' });
  });

  it('write_file 改应用管理的文件（flow.json）必须被拒', () => {
    expect(() =>
      toolCallToOperations('write_file', { path: '.qqbat/flow.json', content: '{}' }),
    ).toThrow();
  });

  it('未知 mutation 返回空数组（交给 chatRun 报「未执行」）', () => {
    expect(toolCallToOperations('definitely_not_a_tool', {})).toHaveLength(0);
  });
});
