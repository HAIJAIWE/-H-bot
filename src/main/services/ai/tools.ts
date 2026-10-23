// src/main/services/ai/tools.ts
import type { AiToolDefinition, AiToolCall, ToolCategory } from '@shared/types/ai'
import type { FlowGraph } from '@shared/types/flow'
import type { ToolExecutionContext as BaseToolExecutionContext } from './tools/registry'
import { readFile } from 'fs/promises'
import { join, resolve, relative, isAbsolute } from 'path'
import { existsSync } from 'fs'
import { getNodeRegistry } from '@main/nodes/registry'
import { registerAllBuiltinNodes } from '@main/nodes/builtin'

export type { ToolCategory } from '@shared/types/ai'
/** 取消信号在工具执行期间触发时抛这个（与 tools/execute.ts 同一身份，供 instanceof 判据） */
export { ToolAbortedError } from './tools/execute'

// ====== 路径安全：校验 userInput 解析后仍在 projectPath 内 ======

/**
 * 安全拼接 projectPath 与用户输入路径，阻止路径穿越。
 * 越界（../ 或绝对路径指向项目外）时抛出 Error。
 */
export function safeJoin(projectPath: string, userInput: string): string {
  const resolvedRoot = resolve(projectPath)
  const resolvedTarget = resolve(resolvedRoot, userInput)
  if (!isAbsolute(resolvedTarget)) {
    throw new Error(`路径越界：${userInput} 解析后非绝对路径`)
  }
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel === '') return resolvedTarget
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界：${userInput} 不在项目 ${projectPath} 内`)
  }
  return resolvedTarget
}

// ====== run_command 命令白名单 ======

const RUN_COMMAND_WHITELIST: RegExp[] = [
  /^\s*pip\s+install\b/,
  /^\s*pip3\s+install\b/,
  /^\s*python\s+-m\s+pip\s+install\b/,
  /^\s*python3\s+-m\s+pip\s+install\b/,
  /^\s*nonebot\b/,
  /^\s*nb\b/
]

/** 校验 run_command 的命令是否在白名单内（只允许 pip install / nonebot / nb 等安全命令） */
export function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim()
  return RUN_COMMAND_WHITELIST.some((re) => re.test(trimmed))
}

// ====== 工具分类映射 ======
// query 类：立即执行，结果回传 LLM
// mutation 类：累积到 Proposal，用户确认后执行
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // query 类（立即执行，结果回传 LLM）
  list_nodes: 'query',
  read_flow: 'query',
  read_code: 'query',
  read_file: 'query',
  read_logs: 'query',
  // mutation 类（累积到 proposal）
  add_node: 'mutation',
  connect_nodes: 'mutation',
  update_node: 'mutation',
  delete_node: 'mutation',
  write_code: 'mutation',
  write_file: 'mutation',
  generate_code: 'mutation',
  create_ai_node: 'mutation',
  // 运行类（run_bot/stop_bot 是状态控制保持 query；run_command 需用户确认改为 mutation）
  run_bot: 'query',
  stop_bot: 'query',
  run_command: 'mutation',
  install_plugin: 'query',
  search_plugin: 'query',
  begin_batch: 'query',
  commit_batch: 'query',
  rollback_batch: 'query'
}

export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? 'query'
}

// ====== 画布操作工具（返回指令，由渲染层执行） ======

const canvasToolDefs: AiToolDefinition[] = [
  {
    name: 'add_node',
    description: '在画布添加一个节点',
    parameters: {
      type: 'object',
      properties: {
        nodeKind: { type: 'string', description: '节点类型（kind），如 on_message/send_message/trigger/action/condition/logic' },
        tempRef: { type: 'string', description: '临时引用名，必须以 "new_" 前缀开头（如 new_trigger、new_action），用于后续 connect_nodes 引用' },
        label: { type: 'string', description: '节点显示标签' },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          description: '画布坐标'
        },
        config: { type: 'object', description: '节点配置参数（因类型而异）' }
      },
      required: ['nodeKind', 'label']
    },
    category: getToolCategory('add_node')
  },
  {
    name: 'update_node',
    description: '修改指定节点的配置',
    parameters: {
      type: 'object',
      properties: {
        nodeRef: { type: 'string', description: '节点引用（节点 ID 或 add_node 返回的 tempRef）' },
        config: { type: 'object', description: '新的配置参数' },
        label: { type: 'string', description: '新的标签（可选）' }
      },
      required: ['nodeRef', 'config']
    },
    category: getToolCategory('update_node')
  },
  {
    name: 'delete_node',
    description: '删除指定节点',
    parameters: {
      type: 'object',
      properties: { nodeRef: { type: 'string', description: '节点引用（节点 ID 或 tempRef）' } },
      required: ['nodeRef']
    },
    category: getToolCategory('delete_node')
  },
  {
    name: 'connect_nodes',
    description: '连接两个节点的端口',
    parameters: {
      type: 'object',
      properties: {
        sourceRef: { type: 'string', description: '源节点引用（节点 ID 或 add_node 返回的 tempRef）' },
        sourcePortId: { type: 'string', description: '源端口 ID' },
        targetRef: { type: 'string', description: '目标节点引用（节点 ID 或 tempRef）' },
        targetPortId: { type: 'string', description: '目标端口 ID' }
      },
      required: ['sourceRef', 'targetRef']
    },
    category: getToolCategory('connect_nodes')
  }
]

// ====== 查询类工具 ======

const queryToolDefs: AiToolDefinition[] = [
  {
    name: 'list_nodes',
    description: '列出所有可用的节点目录（内置/自定义/AI 生成），含 kind/label/summary/端口等元信息',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('list_nodes')
  }
]

// ====== 文件操作工具 ======

const fileToolDefs: AiToolDefinition[] = [
  {
    name: 'read_flow',
    description: '读取当前画布的流程图 JSON',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('read_flow')
  },
  {
    name: 'write_code',
    description: '写入 custom 目录下的代码文件',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '文件路径（如 __init__.py 或 handler.py）' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['filePath', 'content']
    },
    category: getToolCategory('write_code')
  },
  {
    name: 'read_code',
    description: '读取项目中的代码文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录，如 src/plugins/custom/__init__.py）' }
      },
      required: ['path']
    },
    category: getToolCategory('read_code')
  },
  {
    name: 'read_file',
    description: '读取项目中的任意文件',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' }
      },
      required: ['path']
    },
    category: getToolCategory('read_file')
  },
  {
    name: 'write_file',
    description: '写入项目中的任意文件',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    },
    category: getToolCategory('write_file')
  },
  {
    name: 'generate_code',
    description: '从当前画布流程图生成 NoneBot 代码（generated/__init__.py），生成后触发机器人热更新',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('generate_code')
  },
  {
    name: 'create_ai_node',
    description: '创建一个 AI 生成的自定义节点。会写入 ai_generated/<funcName>.py，自动注册到画布节点库。生成前会校验语法、签名、命名冲突。',
    parameters: {
      type: 'object',
      properties: {
        funcName: { type: 'string', description: '函数名，蛇形命名，如 weather_query' },
        label: { type: 'string', description: '节点中文显示名' },
        summary: { type: 'string', description: '30-80字摘要' },
        code: { type: 'string', description: '完整 Python 文件内容，必须含 @node 装饰器和 async def 函数，签名首参为 bot/event' }
      },
      required: ['funcName', 'label', 'summary', 'code']
    },
    category: getToolCategory('create_ai_node')
  }
]

// ====== 运行操作工具 ======

const runtimeToolDefs: AiToolDefinition[] = [
  {
    name: 'run_bot',
    description: '启动机器人进程',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('run_bot')
  },
  {
    name: 'stop_bot',
    description: '停止机器人进程',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('stop_bot')
  },
  {
    name: 'run_command',
    description: '在终端执行一条命令（如 pip install）',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' }
      },
      required: ['command']
    },
    category: getToolCategory('run_command')
  },
  {
    name: 'read_logs',
    description: '读取最近 N 行的运行日志',
    parameters: {
      type: 'object',
      properties: {
        lines: { type: 'number', description: '行数，默认 50' }
      }
    },
    category: getToolCategory('read_logs')
  }
]

// ====== 插件操作工具 ======

const pluginToolDefs: AiToolDefinition[] = [
  {
    name: 'install_plugin',
    description: '从 pip 安装 NoneBot 插件',
    parameters: {
      type: 'object',
      properties: {
        packageName: { type: 'string', description: 'pip 包名（如 nonebot-plugin-memes）' }
      },
      required: ['packageName']
    },
    category: getToolCategory('install_plugin')
  },
  {
    name: 'search_plugin',
    description: '搜索 NoneBot 插件商店',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' }
      },
      required: ['keyword']
    },
    category: getToolCategory('search_plugin')
  }
]

// ====== Batch 事务工具（AI 明确控制事务边界） ======

const batchToolDefs: AiToolDefinition[] = [
  {
    name: 'begin_batch',
    description: '开始一个事务性 batch 操作。在开始批量修改画布前调用，这样后续任何写操作失败时系统能自动回滚到当前状态',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('begin_batch')
  },
  {
    name: 'commit_batch',
    description: '提交当前 batch 操作。在所有画布修改完成后调用，确认修改生效。如果在 30 秒内没有提交，系统将自动提交',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('commit_batch')
  },
  {
    name: 'rollback_batch',
    description: '回滚当前 batch 操作。放弃本次 batch 中的所有修改，恢复到 begin_batch 时的状态',
    parameters: { type: 'object', properties: {} },
    category: getToolCategory('rollback_batch')
  }
]

export const ALL_TOOL_DEFINITIONS: AiToolDefinition[] = [
  ...canvasToolDefs,
  ...queryToolDefs,
  ...fileToolDefs,
  ...runtimeToolDefs,
  ...pluginToolDefs,
  ...batchToolDefs
]

export function findToolDef(name: string): AiToolDefinition | undefined {
  return ALL_TOOL_DEFINITIONS.find((t) => t.name === name)
}

// ====== Tool 执行引擎 ======

export interface ToolExecutionResult {
  result: unknown
  /** 是否需要渲染层执行（画布操作） */
  needsClientExecution?: boolean
  clientInstruction?: Record<string, unknown>
}

/**
 * 工具执行上下文：部分工具（如 generate_code）需要额外的运行时信息。
 *
 * 字段来源分两处，合成一个类型对外（pendingContext.ts:5 从这里取）：
 * - 运行期取消/预览图：tools/registry.ts 的 ToolExecutionContext（execute.ts 用的是它）
 * - 画布与热更新：本文件的 flow / onCodegenComplete（tools.ts:452 的 generate_code）
 * 分成两个同名类型会让「传了 pendingGraph 却被当成另一个类型」—— TS2353 已经踩过。
 */
export interface ToolExecutionContext extends BaseToolExecutionContext {
  /** 当前画布流程图，generate_code 等工具使用 */
  flow?: FlowGraph
  /** codegen 完成后的热更新回调（调用方负责重启 bot，1 秒防抖在工具内完成） */
  onCodegenComplete?: () => void
}

export async function executeTool(
  toolCall: AiToolCall,
  projectPath: string,
  ctx?: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { name, args } = toolCall

  switch (name) {
    case 'list_nodes': {
      const registry = getNodeRegistry()
      registerAllBuiltinNodes(registry)
      const allNodes = registry.listAll()
      return {
        result: allNodes.map((n) => ({
          kind: n.kind,
          label: n.label,
          summary: n.summary,
          sideEffects: n.sideEffects,
          exposedAsTool: n.exposedAsTool,
          inputs: n.inputs,
          outputs: n.outputs
        }))
      }
    }

    case 'add_node':
    case 'update_node':
    case 'delete_node':
    case 'connect_nodes':
      // 这些工具返回指令，由渲染层通过 IPC + flowStore 执行
      return { result: '操作已提交', needsClientExecution: true, clientInstruction: { name, args } }

    case 'read_flow': {
      const flowPath = join(projectPath, '.qqbat', 'flow.json')
      if (!existsSync(flowPath)) return { result: '画布为空' }
      const content = await readFile(flowPath, 'utf-8')
      return { result: JSON.parse(content) }
    }

    case 'read_code':
    case 'read_file': {
      let filePath: string
      try {
        filePath = safeJoin(projectPath, String(args.path))
      } catch (e) {
        return { result: `路径越界: ${e instanceof Error ? e.message : String(e)}` }
      }
      if (!existsSync(filePath)) return { result: `文件不存在: ${args.path}` }
      const content = await readFile(filePath, 'utf-8')
      return { result: content }
    }

    case 'write_code':
    case 'write_file': {
      // 只读验证，实际写入由调用方通过文件 IPC 完成
      return { result: '写入就绪', needsClientExecution: true, clientInstruction: { name, args } }
    }

    case 'run_bot':
    case 'stop_bot':
      return { result: '操作已提交', needsClientExecution: true, clientInstruction: { name, args } }

    case 'run_command':
      return { result: '命令已提交', needsClientExecution: true, clientInstruction: { name, args } }

    case 'read_logs': {
      const lines = (args.lines as number) || 50
      return { result: `（返回最近 ${lines} 行日志，由渲染层填充）`, needsClientExecution: true, clientInstruction: { name, args: { lines } } }
    }

    case 'install_plugin': {
      const pkg = String(args.packageName)
      return { result: `安装命令已提交: pip install ${pkg}`, needsClientExecution: true, clientInstruction: { name, args } }
    }

    case 'search_plugin': {
      return { result: `搜索关键词: ${args.keyword}（需要 npm run search 支持）` }
    }

    case 'begin_batch':
      return { result: 'batch 开始', needsClientExecution: true, clientInstruction: { name, args } }

    case 'commit_batch':
      return { result: 'batch 已提交', needsClientExecution: true, clientInstruction: { name, args } }

    case 'rollback_batch':
      return { result: 'batch 已回滚', needsClientExecution: true, clientInstruction: { name, args } }

    case 'generate_code': {
      if (!ctx?.flow) {
        throw new Error('generate_code 需要 flow 上下文')
      }
      const { CodegenService } = await import("../flow/codegen.js")
      const service = new CodegenService()
      await service.generate(projectPath, ctx.flow)
      // 触发热更新（1 秒防抖）：调用方通过 onCodegenComplete 重启 bot
      setTimeout(() => {
        ctx.onCodegenComplete?.()
      }, 1000)
      return { result: { success: true } }
    }

    case 'create_ai_node': {
      const { createAiNode } = await import('../plugins/aiNodeScaffold.js')
      const result = await createAiNode(
        projectPath,
        String(args.funcName),
        String(args.label),
        String(args.summary),
        String(args.code)
      )
      return { result }
    }

    default:
      throw new Error(`未知工具: ${name}`)
  }
}
