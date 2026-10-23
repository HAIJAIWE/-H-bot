// src/main/codegen/emitterV2.ts
import type { FlowNode } from '@shared/types/flow'
import type { EmitContext } from './emitters'
import { indentStr, pythonLiteral } from './pythonUtils'
import { resolveDataInput, assignOutputVariables, isConfigApiEdge } from './dataflow'
import { getNodeRegistry } from '../nodes/registry'

/**
 * L2 修复：通过 registry 动态查找 db_write 节点的 import 路径，避免硬编码。
 *
 * 旧实现直接写死 `from qqbat_nodes.builtin.db_write import db_write`，
 * 若 db_write 节点的 handler.module 在 catalog 中改名，此处会失效。
 * 现在从 registry 查找 db_write 节点规格，取 handler.module 动态拼装 import。
 * registry 未初始化或找不到时回退到默认值（与旧实现一致，保证向后兼容）。
 */
function resolveDbWriteImport(): string {
  try {
    const spec = getNodeRegistry().find('db_write')
    if (spec?.handler.source === 'builtin') {
      const module = spec.handler.module
      return `from qqbat_nodes.builtin.${module} import ${module}`
    }
  } catch {
    // registry 未初始化——回退到默认值
  }
  return 'from qqbat_nodes.builtin.db_write import db_write'
}

/** 生成节点注释行，标注积木名称和 ID，便于用户在生成的 Python 代码中定位 */
function nodeComment(node: FlowNode, ind: string): string {
  return `${ind}# 节点: ${node.data.label} (${node.id})\n`
}

/**
 * 为节点的所有配置 API 绑定边预生成隐藏的 db_write 调用代码。
 * 在节点主调用之前执行，把结果变量存到 ctx.dataflow.configApiVars，
 * 供 resolveDataInput 在解析该节点输入端口时返回。
 *
 * 设计意图：让流程中不显示读配置节点，参数面板直接链接配置 API，
 * 代码生成时自动注入读取逻辑（"API 接口"风格）。
 */
export function emitConfigApiPreCalls(
  node: FlowNode,
  ctx: EmitContext,
  indent: number
): string {
  const ind = indentStr(indent)
  const indBody = indentStr(indent + 1)
  const cfgApiEdges = ctx.dataflow.graph.edges.filter(
    (e) => e.target === node.id && isConfigApiEdge(e)
  )
  if (cfgApiEdges.length === 0) return ''

  // L2 修复：通过 registry 动态查找 db_write import 路径，避免硬编码
  ctx.imports.add(resolveDbWriteImport())

  let code = ''
  for (const edge of cfgApiEdges) {
    const api = edge.configApi!
    // 变量名：_cfg_<nodeId>_<portId>
    const safeNodeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_')
    const safePortId = edge.targetPort.replace(/[^a-zA-Z0-9_]/g, '_')
    const varName = `_cfg_${safeNodeId}_${safePortId}`
    ctx.dataflow.configApiVars.set(`${node.id}:${edge.targetPort}`, varName)

    // 解析 WHERE 参数：引用上游节点输出端口，或使用 literalValue 字面量
    let whereParamsExpr = '[]'
    if (api.whereParamRef) {
      let refVar: string
      if (api.whereParamRef.literalValue !== undefined) {
        // literalValue 模式：直接使用 Python 字面量（数字/字符串/布尔值）
        refVar = pythonLiteral(api.whereParamRef.literalValue)
      } else {
        refVar = ctx.dataflow.variables.get(
          `${api.whereParamRef.nodeId}:${api.whereParamRef.portId}`
        ) ?? 'None'
      }
      // 自动包装标量：db_write handler 已支持标量自动转 [scalar]
      whereParamsExpr = `[${refVar}]`
    }

    const isQueryAll = api.mode === 'query_all'
    const label = isQueryAll ? `${api.table} (全部行)` : `${api.table}.${api.field}`

    code += `${ind}# 配置 API: ${label}\n`
    code += `${ind}try:\n`
    code += `${indBody}_cfg_res = await db_write(bot=bot, event=event, mode='select', table=${pythonLiteral(api.table)}, db_path=${pythonLiteral(api.dbPath)}, condition=${pythonLiteral(api.where ?? '')}, where_params=${whereParamsExpr}, result_field=${pythonLiteral(isQueryAll ? '' : api.field)})\n`
    if (isQueryAll) {
      // query_all 模式：返回 rows 列表（如 [{name, expression}, ...]）
      code += `${indBody}${varName} = _cfg_res.get('rows', []) if isinstance(_cfg_res, dict) else []\n`
    } else {
      // query 模式：返回单值
      code += `${indBody}${varName} = _cfg_res.get('value') if isinstance(_cfg_res, dict) else None\n`
    }
    code += `${ind}except Exception as _e:\n`
    code += `${indBody}${varName} = ${isQueryAll ? '[]' : 'None'}\n`
    // 安全修复：label 来自用户配置（api.table/api.field），可能含有 `{` `}` `"` 等
    // f-string 特殊字符，直接放入 f-string 会破坏 Python 语法或注入代码。
    // 改为在 f-string 外用 + 拼接 pythonLiteral 转义后的字符串字面量。
    code += `${indBody}logger.error("配置 API " + ${pythonLiteral(label)} + f" 错误: {_e}")\n`
  }
  return code
}

/**
 * 生成内置节点调用代码（schema 驱动）。
 * 模板：
 *   from qqbat_nodes.<path> import <func>
 *   try:
 *       [out = ] await <func>(bot=bot, event=event, <args>)
 *   except Exception as _e:
 *       print(...)
 */
export function emitBuiltinCall(
  node: FlowNode,
  ctx: EmitContext,
  indent: number,
  moduleName: string
): string {
  const ind = indentStr(indent)

  // 配置 API 预调用（隐藏的 db_write 调用）
  const preCalls = emitConfigApiPreCalls(node, ctx, indent)

  // ai_tool_call 特殊处理：不在 builtin 子包下，且需注入 available_tools 参数
  if (moduleName === 'ai_tool_call') {
    const importLine = `from qqbat_nodes.ai_tool_call import ai_tool_call`
    ctx.imports.add(importLine)

    const userMsg = resolveDataInput(node, 'user_message', ctx.dataflow)
    const outVars = assignOutputVariables(node, ctx.dataflow)
    const responseVar = outVars.response ?? '_ai_response'

    // config 缺失时回退到默认值（与 builtinCatalog.ts 中 ai_tool_call 的 defaultConfig 一致）
    const maxRounds = (node.data.config.max_rounds as number) ?? 3
    const confirmHighRisk = (node.data.config.confirm_high_risk as boolean) ?? true
    const systemPrompt = (node.data.config.system_prompt as string) ?? ''

    const callLine = `await ai_tool_call(bot=bot, event=event, user_message=${userMsg}, max_rounds=${pythonLiteral(maxRounds)}, confirm_high_risk=${pythonLiteral(confirmHighRisk)}, system_prompt=${pythonLiteral(systemPrompt)}, available_tools=_available_tools)`

    return (
      preCalls +
      nodeComment(node, ind) +
      `${ind}${importLine}\n` +
      `${ind}try:\n` +
      `${ind}    ${responseVar} = ${callLine}\n` +
      `${ind}except Exception as _e:\n` +
      `${ind}    ${responseVar} = None\n` +
      `${ind}    logger.error(f"[{${ctx.traceVar}}]" + " 节点 " + ${pythonLiteral(node.id)} + " AI 调用错误: {_e}")\n`
    )
  }

  // 通用内置节点调用
  const funcName = moduleName
  const importLine = `from qqbat_nodes.builtin.${moduleName} import ${funcName}`
  ctx.imports.add(importLine)

  // 解析数据输入参数
  const args: string[] = ['bot=bot', 'event=event']
  for ( const input of node.data.inputs.filter((p) => p.kind === 'data')) {
    const value = resolveDataInput(node, input.id, ctx.dataflow)
    args.push(`${input.id}=${value}`)
  }

  // expression_eval 的 mode/formulas 作为输入端口，由 resolveDataInput 自动从 config 解析，
  // 无需特殊处理（formula_block 已合并到 expression_eval(mode='formulas')）

  // 为数据输出端口分配变量
  const outVars = assignOutputVariables(node, ctx.dataflow)
  const outEntries = Object.entries(outVars)
  const firstOut = outEntries[0]?.[1]

  // 包 try/except 防止节点崩溃整个 bot
  const callLine = `await ${funcName}(${args.join(', ')})`
  // 安全修复：node.id 直接放入 f-string 会破坏语法（含 `{` `}` `"` 时）。
  // 改为在 f-string 外用 + 拼接 pythonLiteral 转义后的字符串字面量。
  const errorLogLine = `${ind}    logger.error(f"[{${ctx.traceVar}}]" + " 节点 " + ${pythonLiteral(node.id)} + " 错误: {_e}")\n`
  if (outEntries.length > 1 && firstOut) {
    // 多输出：函数返回 dict，按 portId 提取字段
    const tempVar = `_tmp_${node.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
    const extractLines = outEntries.map(([portId, varName]) =>
      `${ind}    ${varName} = ${tempVar}.get(${pythonLiteral(portId)}) if isinstance(${tempVar}, dict) else ${tempVar}\n`
    ).join('')
    // except 块：有 error 端口时赋 str(_e)，其余赋 None
    const errorPortVar = outVars.error
    const exceptLines = outEntries.map(([, varName]) =>
      `${ind}    ${varName} = None\n`
    ).join('').replace(
      errorPortVar ? `${ind}    ${errorPortVar} = None\n` : '__no_error_port__',
      errorPortVar ? `${ind}    ${errorPortVar} = str(_e)\n` : ''
    )
    return (
      preCalls +
      nodeComment(node, ind) +
      `${ind}${importLine}\n` +
      `${ind}try:\n` +
      `${ind}    ${tempVar} = ${callLine}\n` +
      extractLines +
      `${ind}except Exception as _e:\n` +
      exceptLines +
      errorLogLine
    )
  }
  if (firstOut) {
    const isErrorPort = outVars.error === firstOut
    return (
      preCalls +
      nodeComment(node, ind) +
      `${ind}${importLine}\n` +
      `${ind}try:\n` +
      `${ind}    ${firstOut} = ${callLine}\n` +
      `${ind}except Exception as _e:\n` +
      `${ind}    ${firstOut} = ${isErrorPort ? 'str(_e)' : 'None'}\n` +
      errorLogLine
    )
  }
  return (
    preCalls +
    nodeComment(node, ind) +
    `${ind}${importLine}\n` +
    `${ind}try:\n` +
    `${ind}    ${callLine}\n` +
    `${ind}except Exception as _e:\n` +
    errorLogLine
  )
}

/**
 * 生成 AI 生成节点调用代码。
 * nodeKind 形如 ai_generated_<funcName>，由 aiGeneratedScanner 扫描 ai_generated/*.py 生成。
 * 模板（问题 M5：import 包进 try 块，AI 生成的 .py 有语法错误时不致整个 bot.py 无法启动）：
 *   try:
 *       from ..ai_generated import <func>
 *       [out = ] await <func>(bot=bot, event=event, <args>)
 *   except Exception as _e:
 *       [out = None]
 *       print(...)
 */
export function emitAiGeneratedNode(
  node: FlowNode,
  ctx: EmitContext,
  indent: number,
  funcName: string
): string {
  const ind = indentStr(indent)
  const indBody = indentStr(indent + 1)
  // 配置 API 预调用
  const preCalls = emitConfigApiPreCalls(node, ctx, indent)
  // 问题 M5：import 放在 try 块内——AI 生成的 .py 可能有语法错误，
  // 若 import 在 try 外会导致整个生成的 bot.py ImportError 无法启动
  const importLine = `from ..ai_generated import ${funcName}`
  // 仍向 ImportCollector 注册（保持 import 集合的统计/去重能力）
  ctx.imports.add(importLine)

  const args: string[] = ['bot=bot', 'event=event']
  for ( const input of node.data.inputs.filter((p) => p.kind === 'data')) {
    const value = resolveDataInput(node, input.id, ctx.dataflow)
    args.push(`${input.id}=${value}`)
  }

  const outVars = assignOutputVariables(node, ctx.dataflow)
  const firstOut = Object.values(outVars)[0]

  const callLine = `await ${funcName}(${args.join(', ')})`
  // 安全修复：node.id 直接放入 f-string 会破坏语法（含 `{` `}` `"` 时）。
  // 改为在 f-string 外用 + 拼接 pythonLiteral 转义后的字符串字面量。
  const errorLogLine = `${indBody}logger.error(f"[{${ctx.traceVar}}]" + " 节点 " + ${pythonLiteral(node.id)} + " 错误: {_e}")\n`
  if (firstOut) {
    return (
      preCalls +
      nodeComment(node, ind) +
      `${ind}try:\n` +
      `${indBody}${importLine}\n` +
      `${indBody}${firstOut} = ${callLine}\n` +
      `${ind}except Exception as _e:\n` +
      `${indBody}${firstOut} = None\n` +
      errorLogLine
    )
  }
  return (
    preCalls +
    nodeComment(node, ind) +
    `${ind}try:\n` +
    `${indBody}${importLine}\n` +
    `${indBody}${callLine}\n` +
    `${ind}except Exception as _e:\n` +
    errorLogLine
  )
}
