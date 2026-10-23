// src/main/services/plugins/builtinHostPlugins.ts
//
// **随应用构建的主进程插件**（2026-10-19 → 2026-10-20 内核化）：
//
//   builtin.tool-registry  —— 提供 'tools' 服务（工具注册表的内核包装）
//   builtin.core-tools     —— 文件域工具（read/write/list/search）注入 'tools'
//   builtin.tools.runtime  —— 命令执行（run_command）注入 'tools'（可在插件页停用）
//   builtin.tools.flow     —— 流程校验（validate_flow）注入 'tools'（可在插件页停用）
//
// 为什么拆：内核（kernel.ts）的语义是"按服务可用性激活 + 依赖级联卸载"，
// 拆成真实的服务提供者/消费者，才验证得了这套语义不是摆设；同时 runtime/flow
// 两域变成**可停用**的插件（核心文件工具仍受 not-removable 保护）。
//
// 工具本身仍在 core.ts 预注册（测试与早启动需要）；registry 的 add 对同名工具是
// "接管"语义（撤销权归贡献插件），与 host.ts 原来的行为一致。
import { CORE_TOOLS, registerTool, unregisterTool, type Tool } from '../agent-core/core';
import { listMainPlugins, registerMainPlugin } from './host';
import type { PluginKernelContext } from './kernel';

export const BUILTIN_CORE_TOOLS_ID = 'builtin.core-tools';
export const BUILTIN_TOOL_REGISTRY_ID = 'builtin.tool-registry';
export const BUILTIN_RUNTIME_TOOLS_ID = 'builtin.tools.runtime';
export const BUILTIN_FLOW_TOOLS_ID = 'builtin.tools.flow';

/** 'tools' 服务：领域插件通过它注册工具，effect 由调用方 ctx 负责回收 */
export interface ToolsService {
  add(tool: Tool, ctx: PluginKernelContext): void;
}

/** 领域分组（其余 CORE_TOOLS 名字都会在这里出现；漏了会直接抛，不静默丢工具） */
const FILES_TOOLS = ['read_file', 'write_file', 'list_dir', 'search_text'];
const RUNTIME_TOOLS = ['run_command'];
const FLOW_TOOLS = ['validate_flow'];

function pickTools(names: readonly string[]): Tool[] {
  const byName = new Map(CORE_TOOLS.map((tool) => [tool.name, tool]));
  return names.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error('builtin tool group references unknown tool: ' + name);
    return tool;
  });
}

function registerIfMissing(id: string, register: () => void): void {
  if (listMainPlugins().some((p) => p.id === id)) return;
  register();
}

/** 幂等：重复调用不会重复注册（patch 重放/测试里会多次进来） */
export function registerBuiltinHostPlugins(): void {
  registerIfMissing(BUILTIN_TOOL_REGISTRY_ID, () => {
    registerMainPlugin({
      manifest: {
        id: BUILTIN_TOOL_REGISTRY_ID,
        name: '工具注册表',
        version: '1.0.0',
        description: '提供 tools 服务，供工具域插件注册/回收',
        permissions: [],
      },
      activate(_api, ctx) {
        ctx.provideService<ToolsService>('tools', {
          add: (tool, ownerCtx) => {
            try {
              registerTool(tool);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (!message.startsWith('工具重复注册: ' + tool.name)) throw error;
            }
            ownerCtx.effect(() => unregisterTool(tool.name));
          },
        });
      },
    });
  });

  const groups: Array<{ id: string; name: string; description: string; tools: readonly string[] }> =
    [
      {
        id: BUILTIN_CORE_TOOLS_ID,
        name: '内置文件工具',
        description: '随应用构建的读写/列举/搜索工具（核心能力，不可停用）',
        tools: FILES_TOOLS,
      },
      {
        id: BUILTIN_RUNTIME_TOOLS_ID,
        name: '内置命令工具',
        description: '执行命令（run_command）',
        tools: RUNTIME_TOOLS,
      },
      {
        id: BUILTIN_FLOW_TOOLS_ID,
        name: '内置流程校验',
        description: '流程结构校验（validate_flow）',
        tools: FLOW_TOOLS,
      },
    ];

  for (const group of groups) {
    registerIfMissing(group.id, () => {
      registerMainPlugin({
        manifest: {
          id: group.id,
          name: group.name,
          version: '1.0.0',
          description: group.description,
          permissions: [],
          inject: ['tools'],
        },
        activate(_api, ctx) {
          const tools = ctx.requireService<ToolsService>('tools');
          for (const tool of pickTools(group.tools)) tools.add(tool, ctx);
        },
      });
    });
  }

  // 防御：所有 CORE_TOOLS 必须被某个领域认领（新增工具忘了分组会在这里炸，而不是静默消失）
  const claimed = new Set([...FILES_TOOLS, ...RUNTIME_TOOLS, ...FLOW_TOOLS]);
  const unclaimed = CORE_TOOLS.map((t) => t.name).filter((name) => !claimed.has(name));
  if (unclaimed.length > 0) {
    throw new Error('builtin tool plugins do not claim: ' + unclaimed.join(', '));
  }
}
