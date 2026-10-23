// src/main/codegen/dataflow.ts
//
// 数据流绑定解析（拉取模型）。
//
// ⚠️ **两条代码生成栈共用这个模块**（恢复期发现的事实，记在这里防止再踩）：
//   · Python 栈：generator.ts / emitterV2.ts → 产出 `qqbat_nodes` 的 Python 代码，
//     使用 pythonLiteral / pyIdentifier；
//   · TS 栈：controlFlowEmitter.ts / emitters.ts → 产出 TypeScript 代码，
//     使用 ctx.flowVars / tsLiteral；
//   两边的"变量访问器"是同一套作用域语义（flow/user/group/global），只是承载语言不同。
//   所以这里同时提供 getVariableAccessor（TS 侧）与 pyIdentifier（Python 侧）。
import type { FlowGraph, FlowNode } from '@shared/types/flow'
import { inferTypeFromConfig, normalizePortType } from '@shared/types/ports'
import { pythonLiteral, pyIdentifier } from './pythonUtils'

/** 配置 API 边的 source 标识符 */
export const CONFIG_API_SOURCE = '__config_api__'

/** {{var}} 命名变量语法正则：匹配 {{word}} 形式的变量引用 */
const NAMED_VAR_RE = /\{\{(\w+)\}\}/g
/** 整体单个 {{var}} 匹配（用于区分"纯变量引用"与"混合文本模板"） */
const SINGLE_NAMED_VAR_RE = /^\{\{(\w+)\}\}$/

/** 命名变量的作用域：决定生成的访问器指向哪个变量袋 */
export type VariableScope = 'flow' | 'user' | 'group' | 'global'

/** 一个数据端口绑定的变量（TS 代码生成侧需要类型信息才能做解构/类型声明） */
export interface VariableInfo {
  name: string
  /** 端口声明类型（dataType 归一化后的 TS 类型名） */
  type: string
  scope: VariableScope
  sourceNodeId: string
  sourcePortId: string
  /** 上游节点可能没产出（分支未走到）时为 true */
  isNullable: boolean
}

export interface DataflowContext {
  graph: FlowGraph
  /** 数据输出端口 → 变量名 (key: `${nodeId}:${portId}`) */
  variables: Map<string, string>
  /** 同一个 key 的变量元信息（TS 栈用；Python 栈不读） */
  variableInfos: Map<string, VariableInfo>
  /** handler 里已经声明过、可以安全复用的变量名（去重用） */
  availableVarNames: string[]
  /** 配置 API 绑定预生成的变量名 (key: `${targetNodeId}:${targetPortId}`)
   * 由 emitterV2.emitConfigApiPreCalls 在节点调用前填充，
   * resolveDataInput 识别配置 API 边时返回此变量名。
   */
  configApiVars: Map<string, string>
}

export function createDataflowContext(graph: FlowGraph): DataflowContext {
  return {
    graph,
    variables: new Map(),
    variableInfos: new Map(),
    availableVarNames: [],
    configApiVars: new Map(),
  }
}

/** 判断边是否为配置 API 绑定边 */
export function isConfigApiEdge(edge: { source: string; configApi?: unknown }): boolean {
  return edge.source === CONFIG_API_SOURCE && edge.configApi != null
}

/**
 * 解析节点数据输入端口的值（拉取模型）。
 * - 配置 API 边：返回预生成的变量名（由 emitConfigApiPreCalls 填充到 ctx.configApiVars）
 * - 普通数据流边：返回上游输出端口的变量名
 * - 无连线：使用节点配置的默认值（config[portId]）的 Python 字面量
 */
export function resolveDataInput(
  node: FlowNode,
  portId: string,
  ctx: DataflowContext
): string {
  const edge = ctx.graph.edges.find(
    (e) => e.target === node.id && e.targetPort === portId
  )
  if (edge) {
    // 配置 API 边：返回预生成的变量名
    if (isConfigApiEdge(edge)) {
      return ctx.configApiVars.get(`${node.id}:${portId}`) ?? 'None'
    }
    return ctx.variables.get(`${edge.source}:${edge.sourcePort}`) ?? 'None'
  }
  const configValue = node.data.config[portId]
  return pythonLiteral(configValue)
}

/**
 * 为节点的数据输出端口分配变量名并记录到 context。
 * 返回 portId → varName 映射（仅数据端口）。
 */
export function assignOutputVariables(
  node: FlowNode,
  ctx: DataflowContext,
  scope: VariableScope = 'flow'
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const port of node.data.outputs.filter((p) => p.kind === 'data')) {
    const varName = pyIdentifier(node.id, port.id)
    const key = `${node.id}:${port.id}`
    ctx.variables.set(key, varName)
    // TS 栈需要变量类型才能声明/解构；没有 dataType 时按配置值推导
    const portDef = node.data.outputs.find((p) => p.id === port.id)
    const varType = portDef?.dataType
      ? normalizePortType(portDef.dataType)
      : inferTypeFromConfig(node.data.config[port.id])
    ctx.variableInfos.set(key, {
      name: varName,
      type: varType,
      scope,
      sourceNodeId: node.id,
      sourcePortId: port.id,
      isNullable: true,
    })
    // 去重要看这个列表：emitNode 里重复调用会把同名变量推两次
    if (!ctx.availableVarNames.includes(varName)) ctx.availableVarNames.push(varName)
    result[port.id] = varName
  }
  return result
}

/**
 * 把 `{{var}}` 命名变量语法转成 TS 表达式。
 *
 * - 纯变量引用 `{{user_name}}` → `ctx.flowVars['user_name']`（可独立用于表达式）
 * - 混合文本模板 `你好 {{user_name}}` → 模板字面量（仅字符串上下文）
 * - 不含 `{{var}}` → null（调用方走 tsLiteral 默认逻辑）
 */
export function resolveNamedVarSyntax(value: unknown, scope: VariableScope = 'flow'): string | null {
  if (typeof value !== 'string' || !NAMED_VAR_RE.test(value)) return null
  NAMED_VAR_RE.lastIndex = 0
  const single = value.match(SINGLE_NAMED_VAR_RE)
  if (single) return `${getVariableAccessor(scope)}['${single[1]}']`
  NAMED_VAR_RE.lastIndex = 0
  const segments = value.split(NAMED_VAR_RE)
  const prefix = getVariableAccessor(scope)
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) {
      // 变量段：走作用域变量袋（user/group/global 各自独立，不能混成一个）
      parts.push('${' + prefix + "['" + segments[i] + "']}")
    } else {
      // 文本段：转义反引号 / 反斜杠 / $ / { 才能安全放进模板字面量
      parts.push(
        segments[i].replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\{/g, '\\{'),
      )
    }
  }
  return '`' + parts.join('') + '`'
}

/** 获取变量作用域访问器前缀（TS 生成代码里的变量袋） */
export function getVariableAccessor(scope: VariableScope): string {
  switch (scope) {
    case 'user': return 'ctx.userVars'
    case 'group': return 'ctx.groupVars'
    case 'global': return 'ctx.globalVars'
    default: return 'ctx.flowVars'
  }
}

/**
 * 生成变量解构声明。
 *
 * 只在**同一作用域**内解构：跨作用域的变量各自在自己的袋里取，混在一个解构里会把
 * 作用域语义抹平（user 变量被当成 flow 变量后，重启就丢了）。
 */
export function generateVariableDestructuring(
  variables: readonly VariableInfo[],
  scope: VariableScope = 'flow',
): string {
  const names = variables.filter((v) => v.scope === scope).map((v) => v.name)
  if (names.length === 0) return ''
  return `const { ${names.join(', ')} } = ${getVariableAccessor(scope)};`
}
