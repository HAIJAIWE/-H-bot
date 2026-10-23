// src/renderer/src/lib/mockRunner.ts
// 前端模拟执行引擎 — 本地调试不需要连接 QQ

import { getExecutionChains, getControlOutputs } from './executionOrder'
import { findSpec } from './nodeCatalog'
import type { FlowNode, FlowEdge } from '../../../shared/types/flow'

/** 加权选项的 JSON 解析中间类型（来自用户配置或 AI 生成） */
interface WeightedItemCandidate {
  value?: unknown
  weight?: unknown
}

/**
 * 测试输入 — 用户选择的触发条件
 */
export interface TestInput {
  /** 触发方式 */
  triggerType: 'command' | 'text' | 'at_me' | 'schedule'
  /** 命令（triggerType=command 时） */
  command?: string
  /** 命令前缀（triggerType=command 时） */
  prefix?: string
  /** 消息文本（triggerType=text/at_me 时） */
  text?: string
  /** 用户 ID */
  userId?: string
  /** 群组 ID */
  groupId?: string
  /** 模拟持久化数据初始值（key → value），用于 persistent_op 节点 */
  mockData?: Record<string, string>
}

/**
 * 模拟执行单步结果
 */
export interface TraceStep {
  /** 节点 ID */
  nodeId: string
  /** 步骤编号（从 1 开始） */
  stepNum: number
  /** 节点名称（如"指令匹配"） */
  label: string
  /** 节点图标 */
  icon: string
  /** 执行状态 */
  status: 'ok' | 'skip' | 'error'
  /** 模拟耗时 (ms) */
  duration: number
  /** 输出端口值 */
  outputs: Record<string, string>
  /** 分支选择（仅分支节点） */
  branch?: 'true' | 'false'
  /** 分支标签（如"有记录？"） */
  branchLabel?: string
  /** 发送消息内容（仅 send_message 节点） */
  message?: string
  /** 错误消息 */
  error?: string
  /** 匹配的链索引 */
  chainIndex: number
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 单步列表 */
  steps: TraceStep[]
  /** 是否有链被触发 */
  triggered: boolean
  /** 摘要 */
  summary: {
    totalSteps: number
    okSteps: number
    errorSteps: number
    messageOutputs: string[]
    elapsed: number
  }
}

// ---------------------------------------------------------------------------
// 节点模拟数据
// ---------------------------------------------------------------------------

/**
 * 简单条件表达式求值（前端 mock 用，非 Python 真实 eval）
 *
 * 支持：
 *   value > 5, value >= 10, value < 3, value <= 20
 *   value == 5, value != 0
 *   value == 'hello', value != 'world'
 *   value is True / value is False / value is None
 *   'keyword' in value（包含判断，支持 or/and 组合）
 *   expr1 && expr2, expr1 || expr2
 *   纯真值判断（无比较运算符时）
 */
function evalCondition(expr: string, value: string | undefined): boolean {
  const exprTrimmed = expr.trim()

  // 处理 not 前缀（Python 语法）：catalog 中 if_branch 明确支持 'not value'
  // 不处理会导致 cooldown-check / signin-flow 等模板的 'not value' 表达式结果反转
  const notMatch = exprTrimmed.match(/^not\s+(.+)$/)
  if (notMatch) {
    return !evalCondition(notMatch[1], value)
  }

  if (exprTrimmed.includes('&&')) {
    return exprTrimmed.split('&&').every((part) => evalCondition(part.trim(), value))
  }
  // 注意：用 split('||') 会和 Python 的 `or` 冲突，先处理 Python or 关键字
  if (exprTrimmed.includes(' or ')) {
    return exprTrimmed.split(' or ').some((part) => evalCondition(part.trim(), value))
  }
  if (exprTrimmed.includes(' and ')) {
    return exprTrimmed.split(' and ').every((part) => evalCondition(part.trim(), value))
  }
  if (exprTrimmed.includes('||')) {
    return exprTrimmed.split('||').some((part) => evalCondition(part.trim(), value))
  }

  // 'keyword' in value —— 包含判断
  const inMatch = exprTrimmed.match(/^['"](.+?)['"]\s+in\s+value$/)
  if (inMatch) {
    return value !== undefined && value.includes(inMatch[1])
  }

  // value is True / value is False / value is None
  const isMatch = exprTrimmed.match(/^value\s+is\s+(True|False|None)$/)
  if (isMatch) {
    if (value === undefined) return isMatch[1] === 'None'
    if (isMatch[1] === 'True') {
      return !['False', 'false', '0', '', 'None', 'null', 'undefined'].includes(value)
    }
    if (isMatch[1] === 'False') {
      return ['False', 'false', '0', '', 'None', 'null', 'undefined'].includes(value)
    }
    if (isMatch[1] === 'None') {
      return value === 'None' || value === 'null' || value === ''
    }
  }

  // value == True / value == False（布尔字符串比较）
  const boolEqMatch = exprTrimmed.match(/^value\s*==\s*(True|False|None)$/)
  if (boolEqMatch) {
    if (value === undefined) return boolEqMatch[1] === 'None'
    if (boolEqMatch[1] === 'True') {
      return !['False', 'false', '0', '', 'None', 'null', 'undefined'].includes(value)
    }
    if (boolEqMatch[1] === 'False') {
      return ['False', 'false', '0', '', 'None', 'null', 'undefined'].includes(value)
    }
  }

  const cmpMatch = exprTrimmed.match(/^value\s*(>=|<=|==|!=|>|<)\s*(.+)$/)
  if (cmpMatch) {
    const [, op, rhsRaw] = cmpMatch
    const rhs = rhsRaw.trim()
    if (value === undefined) return false

    const numVal = parseFloat(value)
    const numRhs = parseFloat(rhs)
    if (!isNaN(numVal) && !isNaN(numRhs)) {
      switch (op) {
        case '>': return numVal > numRhs
        case '<': return numVal < numRhs
        case '>=': return numVal >= numRhs
        case '<=': return numVal <= numRhs
        case '==': return numVal === numRhs
        case '!=': return numVal !== numRhs
      }
    }

    const strRhs = rhs.replace(/^['"]|['"]$/g, '')
    switch (op) {
      case '==': return value === strRhs
      case '!=': return value !== strRhs
      default: return false
    }
  }

  if (value !== undefined) {
    return !['False', 'false', '0', '', 'None', 'null', 'undefined'].includes(value)
  }
  return !['False', 'false', '0', '', 'None', 'null'].includes(exprTrimmed)
}

/**
 * 节点模拟处理器 — 根据节点类型和输入配置生成模拟输出
 */
function mockNodeOutput(
  node: FlowNode,
  spec: ReturnType<typeof findSpec>,
  context: Record<string, string>,
  testInput: TestInput,
  persistStore: Map<string, string>
): { outputs: Record<string, string>; message?: string; branch?: 'true' | 'false' } {
  const kind = node.data.nodeKind
  const config = node.data.config ?? {}

  switch (kind) {
    // ---- 触发器 ----
    case 'on_message': {
      // 统一消息触发器（match: any/at_me/command/keyword/regex）
      const match = (config.match as string) ?? 'any'
      const cmd = (config.command as string) ?? ''
      const prefix = (config.prefix as string) ?? '/'
      const fullCmd = `${prefix}${cmd}`
      const text = testInput.text ?? ''
      // catalog 输出端口: event(event), raw_message(string), args(list), matched(string), groups(list)
      const args = match === 'command'
        ? text.replace(fullCmd, '').trim()
        : ''
      // regex 模式：模拟正则匹配，提取 matched 和 groups
      let matched = ''
      let groups: string[] = []
      if (match === 'regex') {
        const pattern = (config.pattern as string) ?? ''
        const flagsStr = (config.flags as string) ?? ''
        try {
          const flags = flagsStr.includes('i') ? 'i' : ''
          const re = new RegExp(pattern, flags)
          const m = text.match(re)
          if (m) {
            matched = m[0]
            groups = m.slice(1).filter((g) => g !== undefined)
          }
        } catch { /* 正则编译失败，返回空匹配 */ }
      }
      return {
        outputs: {
          event: `事件(用户=${testInput.userId ?? '123456'}, match=${match})`,
          raw_message: text,
          args,
          matched,
          groups: groups.length > 0 ? JSON.stringify(groups) : '[]'
        }
      }
    }
    case 'schedule': {
      // catalog 输出端口: time(datetime)
      return {
        outputs: {
          time: new Date().toISOString()
        }
      }
    }
    case 'on_request': {
      // catalog 输出端口: event, request_type, user_id, group_id, comment, flag
      return {
        outputs: {
          event: `请求事件(用户=${testInput.userId ?? '123456'})`,
          request_type: 'group',
          user_id: testInput.userId ?? '123456',
          group_id: testInput.groupId ?? '654321',
          comment: '请加群',
          flag: 'mock-flag-001'
        }
      }
    }
    case 'on_notice': {
      // catalog 输出端口: event, notice_type, user_id, group_id, sub_type
      return {
        outputs: {
          event: `通知事件(用户=${testInput.userId ?? '123456'})`,
          notice_type: 'group_increase',
          user_id: testInput.userId ?? '123456',
          group_id: testInput.groupId ?? '654321',
          sub_type: 'approve'
        }
      }
    }
    case 'on_button_click': {
      return {
        outputs: {
          event: `按钮点击事件(用户=${testInput.userId ?? '123456'})`,
          button_id: 'btn_1',
          button_data: (config.button_data as string) ?? 'attack',
          user_id: testInput.userId ?? '123456',
          group_id: testInput.groupId ?? '654321'
        }
      }
    }
    case 'on_ready': {
      // 生命周期触发器：模拟机器人连接就绪事件
      return {
        outputs: {
          event: '连接就绪事件(模拟)',
          ready_at: String(Math.floor(Date.now() / 1000))
        }
      }
    }
    case 'on_startup': {
      // 生命周期触发器：模拟机器人启动事件（早于 on_ready，无 bot 实例）
      return {
        outputs: {
          event: '启动事件(模拟)',
          started_at: String(Math.floor(Date.now() / 1000))
        }
      }
    }
    // ---- 动作 ----
    case 'send_message': {
      // catalog defaultConfig: { mode, text, segments, messages, user_id }, 输入端口: mode/text/segments/messages/user_id
      const smMode = (config.mode as string) ?? 'text'
      if (smMode === 'segment') {
        // 消息段模式：发送消息段
        const segMsg = context['segments'] ?? (config.segments as string) ?? '消息段'
        return { outputs: { success: 'true', message_id: 'mock-msg-seg-001', error: '' }, message: `[消息段] ${String(segMsg).slice(0, 30)}` }
      }
      if (smMode === 'forward') {
        // 合并转发模式
        const fwdMsg = context['messages'] ?? (config.messages as string) ?? '[]'
        return { outputs: { success: 'true', message_id: 'mock-msg-fwd-001', error: '' }, message: `[合并转发] ${String(fwdMsg).slice(0, 30)}` }
      }
      if (smMode === 'keyboard') {
        const kbMsg = (config.markdown as string) ?? '按钮消息'
        return { outputs: { success: 'true', message_id: 'mock-msg-kb-001', error: '' }, message: `[按钮UI] ${kbMsg.slice(0, 30)}` }
      }
      // text 模式（默认）
      const msg =
        context['text'] ??
        (config.text as string) ??
        context['response'] ??
        context['result'] ??
        '测试消息内容'
      return { outputs: { success: 'true', message_id: 'mock-msg-001', error: '' }, message: msg }
    }

    // ---- 持久化（统一 persistent_op 节点，根据 mode 分发） ----
    case 'persistent_op': {
      const mode = (config.mode as string) ?? 'save'
      const key = (config.key as string) ?? 'unknown'
      switch (mode) {
        case 'load': {
          // 优先从 persistStore 读取（支持 save 后再读取）
          const val = persistStore.get(key) ?? (config.value as string) ?? '0'
          return { outputs: { result: val } }
        }
        case 'save': {
          const val = context['value'] ?? (config.value as string) ?? '0'
          // mock 模式忽略 ttl（过期秒数），仅记录值；写入 persistStore 供后续 load 读取
          persistStore.set(key, String(val))
          return { outputs: { result: String(val), success: 'true' } }
        }
        case 'load_or_default': {
          const defaultVal = context['default'] ?? (config.default as string) ?? '0'
          const val = persistStore.get(key)
          const isDefault = val === undefined
          const result = isDefault ? defaultVal : val
          if (isDefault && (config.auto_save as boolean) !== false) {
            persistStore.set(key, String(result))
          }
          return { outputs: { result: String(result), is_default: String(isDefault), error: '' } }
        }
        case 'increment': {
          const amount = Number(context['amount'] ?? (config.amount as number) ?? 1)
          const defaultVal = Number(context['default'] ?? (config.default as number) ?? 0)
          const current = Number(persistStore.get(key) ?? defaultVal)
          const newVal = current + amount
          persistStore.set(key, String(newVal))
          return { outputs: { result: String(newVal), old_value: String(current), error: '' } }
        }
        case 'delete':
        case 'exists': {
          const val = persistStore.get(key)
          const exists = val !== undefined
          if (mode === 'delete' && exists) {
            persistStore.delete(key)
          }
          return { outputs: { exists: String(exists), value: exists ? val : '', error: '' } }
        }
        case 'batch_load':
        case 'batch_save': {
          // 批量持久化操作：mock 模式返回空结果
          return { outputs: { results: '[]', success: 'true', error: '' } }
        }
        case 'list_append': {
          // 列表追加：mock 模式返回简化结果
          const list = context['list'] ?? '[]'
          return { outputs: { list, result: '', error: '' } }
        }
        default: {
          return { outputs: { result: '', error: `未知 persistent_op mode: ${mode}` } }
        }
      }
    }
    // ---- 逻辑 ----
    case 'if_branch': {
      const boundValue = context['value']
      const rawExpr = (config.expression as string) ?? ''
      // 有数据连线时：
      //   - 若表达式包含 value 关键字（如 value >= 5、value is True、'关键字' in value），用表达式评估
      //   - 否则退化为真值判断（与 codegen bool(value) 一致）
      if (boundValue !== undefined) {
        if (rawExpr && rawExpr.includes('value')) {
          const isTruthy = evalCondition(rawExpr, boundValue)
          return {
            outputs: { result: isTruthy ? 'true' : 'false' },
            branch: isTruthy ? 'true' : 'false'
          }
        }
        const isTruthy = !['False', 'false', '0', '', 'None', 'null', 'undefined'].includes(boundValue)
        return {
          outputs: { result: isTruthy ? 'true' : 'false' },
          branch: isTruthy ? 'true' : 'false'
        }
      }
      // 无数据连线：用 expression 做静态判断
      const isTruthy = evalCondition(rawExpr || 'False', undefined)
      return {
        outputs: { result: isTruthy ? 'true' : 'false' },
        branch: isTruthy ? 'true' : 'false'
      }
    }
    case 'switch_case': {
      // 多分支选择：根据 value 匹配 cases 中的分支
      const value = context['value'] ?? ''
      const casesStr = (config.cases as string) ?? '[]'
      const defaultLabel = (config.default as string) ?? 'default'

      let caseList: Array<{ match?: string; label?: string }> = []
      try {
        caseList = JSON.parse(casesStr)
      } catch { // 测试用例 JSON 解析失败时返回空列表
        caseList = []
      }

      const valStr = String(value).trim()
      let matchedLabel = defaultLabel
      let matchedIndex = -1

      for (let i = 0; i < caseList.length; i++) {
        const caseItem = caseList[i]
        const matchVal = String(caseItem?.match ?? '').trim()
        const label = caseItem?.label ?? `case_${i}`

        // 精确匹配
        if (matchVal === valStr) {
          matchedLabel = label
          matchedIndex = i
          break
        }
        // 通配符
        if (matchVal === '*') {
          matchedLabel = label
          matchedIndex = i
          break
        }
        // 数值比较匹配
        if (matchVal.startsWith('>=') || matchVal.startsWith('<=') || matchVal.startsWith('==') || matchVal.startsWith('!=') || matchVal.startsWith('>') || matchVal.startsWith('<')) {
          try {
            const valNum = parseFloat(valStr)
            const cond = matchVal.trim()
            if (cond.startsWith('>=') && valNum >= parseFloat(cond.slice(2))) { matchedLabel = label; matchedIndex = i; break }
            if (cond.startsWith('<=') && valNum <= parseFloat(cond.slice(2))) { matchedLabel = label; matchedIndex = i; break }
            if (cond.startsWith('==') && valNum === parseFloat(cond.slice(2))) { matchedLabel = label; matchedIndex = i; break }
            if (cond.startsWith('!=') && valNum !== parseFloat(cond.slice(2))) { matchedLabel = label; matchedIndex = i; break }
            if (cond.startsWith('>') && valNum > parseFloat(cond.slice(1))) { matchedLabel = label; matchedIndex = i; break }
            if (cond.startsWith('<') && valNum < parseFloat(cond.slice(1))) { matchedLabel = label; matchedIndex = i; break }
          } catch { /* 忽略数值解析失败 */ }
        }
        // 包含匹配（逗号分隔多值）
        if (matchVal.includes(',')) {
          const options = matchVal.split(',').map((s) => s.trim())
          if (options.includes(valStr)) { matchedLabel = label; matchedIndex = i; break }
        }
      }

      return {
        outputs: {
          matched: matchedLabel,
          matched_value: matchedLabel,
          index: String(matchedIndex),
          is_default: String(matchedIndex === -1)
        }
      }
    }
    case 'loop': {
      // 循环节点（三合一：times/iterate/while）
      const mode = (config.mode as string) ?? 'times'
      if (mode === 'iterate') {
        // 遍历列表：mock 返回第一项
        return { outputs: { item: '模拟项', key: '0', index: '0', count: '1' } }
      }
      if (mode === 'while') {
        return { outputs: { result: String(0), index: String(0) } }
      }
      // times 模式
      const count = parseInt(context['count'] ?? String(config.count ?? 3)) || 3
      return { outputs: { index: '0', count: String(count) } }
    }

    // ---- 数学 ----
    case 'random': {
      const mode = (config.mode as string) ?? 'int'
      if (mode === 'int') {
        // 用 Number() 转换，避免字符串导致 NaN（用户输入字符串时回退默认值）
        const min = Number(config.min) || 0
        const max = Number(config.max) || 100
        const val = Math.floor(Math.random() * (max - min + 1)) + min
        return { outputs: { result: String(val) } }
      } else if (mode === 'choice') {
        // catalog 中 list 端口 dataType:'json'，defaultConfig.list='[]'（字符串）
        // 必须先 JSON.parse，否则字符串的 .length 是字符长度，返回单个字符
        const rawList = config.list
        let list: string[] = []
        if (typeof rawList === 'string') {
          try { const parsed = JSON.parse(rawList); if (Array.isArray(parsed)) list = parsed.map(String) } catch { list = [] }
        } else if (Array.isArray(rawList)) {
          list = rawList.map(String)
        }
        if (list.length === 0) return { outputs: { result: '选项A' } }
        const choice = list[Math.floor(Math.random() * list.length)]
        return { outputs: { result: String(choice) } }
      } else if (mode === 'weighted') {
        // catalog 中 items 端口 dataType:'json'，defaultConfig.items='[]'（字符串）
        // 必须先 JSON.parse，否则字符串没有 reduce 方法会抛 TypeError 导致 mock 崩溃
        const rawItems = config.items
        let items: Array<{ value: string; weight: number }> = []
        if (typeof rawItems === 'string') {
          try {
            const parsed = JSON.parse(rawItems)
            if (Array.isArray(parsed)) {
              items = parsed.map((it: WeightedItemCandidate) => ({
                value: String(it?.value ?? ''),
                weight: Number(it?.weight) || 1
              }))
            }
          } catch { items = [] }
        } else if (Array.isArray(rawItems)) {
          items = rawItems.map((it: WeightedItemCandidate) => ({
            value: String(it?.value ?? ''),
            weight: Number(it?.weight) || 1
          }))
        }
        if (items.length === 0) return { outputs: { result: '默认' } }
        // 按权重随机选择
        const totalWeight = items.reduce((sum, item) => sum + (item.weight ?? 1), 0)
        let r = Math.random() * totalWeight
        for (const item of items) {
          r -= (item.weight ?? 1)
          if (r <= 0) return { outputs: { result: item.value } }
        }
        return { outputs: { result: items[items.length - 1].value } }
      }
      return { outputs: { result: '' } }
    }

    // ---- AI ----
    case 'llm_chat': {
      const prompt = context['prompt'] ?? (config.prompt as string) ?? ''
      return {
        outputs: {
          response: `[模拟回复] 你说了: "${prompt.slice(0, 20)}...", 已收到!`
        }
      }
    }
    case 'embedding': {
      // mock 模式返回 8 维随机向量
      const vec = Array.from({ length: 8 }, () => Math.random().toFixed(4))
      return {
        outputs: {
          vector: JSON.stringify(vec),
          dimensions: String(8),
          error: ''
        }
      }
    }
    case 'memory_op': {
      const mode = (config.mode as string) ?? 'add'
      switch (mode) {
        case 'add':
          return { outputs: { result: String(Math.floor(Math.random() * 1000)), count: '1', success: 'true', error: '' } }
        case 'search':
          return { outputs: { result: '[]', count: '0', success: 'true', error: '' } }
        case 'clear':
          return { outputs: { result: '0', count: '0', success: 'true', error: '' } }
        case 'list':
          return { outputs: { result: '[]', count: '0', success: 'true', error: '' } }
        default:
          return { outputs: { result: '', count: '0', success: 'false', error: `未知 mode: ${mode}` } }
      }
    }

    // ---- 控制流/工具 ----
    case 'error_op': {
      const mode = (config.mode as string) ?? 'assert'
      if (mode === 'throw') {
        const msg = (context['message'] ?? (config.message as string) ?? '业务异常') as string
        return { outputs: { out: '', error: msg } }
      }
      // assert 模式：mock 默认通过
      return { outputs: { passed: 'true', error: '' } }
    }
    case 'retry_exec': {
      // mock 模式直接走 success 分支，尝试次数=1
      return { outputs: { attempts: '1', error: '' } }
    }
    case 'timer': {
      const mode = (config.mode as string) ?? 'start'
      if (mode === 'start') {
        return { outputs: { elapsed: '0', elapsed_ms: '0', error: '' } }
      }
      // stop / elapsed 返回模拟耗时
      const elapsed = (Math.random() * 2).toFixed(4)
      return { outputs: { elapsed, elapsed_ms: String(Math.floor(Number(elapsed) * 1000)), error: '' } }
    }
    case 'system_log': {
      const level = (config.level as string) ?? 'info'
      const msg = (context['message'] ?? (config.message as string) ?? '') as string
      void level
      return { outputs: { error: '' }, message: `[log] ${msg}` }
    }

    // ---- 文本 ----
    case 'format_text': {
      const tmpl = (config.template ?? config.format ?? '') as string
      let text = tmpl || `模板: ${(config.vars as string) ?? '{}'}`
      // 替换 {var1}、{var2}、{result}、{response} 等变量占位符
      text = text.replace(/\{(\w+)\}/g, (match, key: string) => {
        if (context[key] !== undefined) return context[key]
        return match // 未找到对应变量，保留原占位符
      })
      return { outputs: { result: text } }
    }
    // ---- 时间 ----
    case 'time_op': {
      const mode = (config.mode as string) ?? 'now'
      if (mode === 'is_today') {
        return { outputs: { result: 'true' } }
      }
      if (mode === 'date_diff') {
        return { outputs: { diff: '0', seconds: '0', is_past: 'false' } }
      }
      // mode === 'now'
      const now = new Date()
      return {
        outputs: {
          timestamp: String(now.getTime()),
          datetime: now.toISOString(),
          date: now.toISOString().slice(0, 10),
          time: now.toTimeString().slice(0, 8),
          weekday: String(now.getDay())
        }
      }
    }

    // ---- 变量 ----
    case 'set_variable': {
      return { outputs: {} }
    }

    // ---- 其他 ----
    case 'http_request': {
      return {
        outputs: {
          status: '200',
          data: '{"ok": true}',
          error: ''
        }
      }
    }
    case 'query': {
      // 批量查询节点（list/sort/filter/aggregate）
      const mode = (config.mode as string) ?? 'list'
      void mode
      return {
        outputs: {
          results: '[{"key":"score:1","value":"100"},{"key":"score:2","value":"50"}]',
          count: '2',
          error: ''
        }
      }
    }
    case 'db_write': {
      const mode = node.data.config?.mode || 'insert'
      if (mode === 'insert') {
        return { outputs: { success: 'true', lastrowid: '1', rows_updated: '0', rows_deleted: '0', error: '' } }
      } else if (mode === 'update') {
        return { outputs: { success: 'true', lastrowid: '0', rows_updated: '1', rows_deleted: '0', error: '' } }
      } else if (mode === 'select') {
        // select 模式应返回 rows，而非 rows_deleted（原 else 分支把 select 和 delete 混在一起）
        return { outputs: { success: 'true', rows: '[{"id":1,"name":"mock"}]', lastrowid: '0', rows_updated: '0', rows_deleted: '0', error: '' } }
      } else {
        // delete 模式
        return { outputs: { success: 'true', lastrowid: '0', rows_updated: '0', rows_deleted: '1', error: '' } }
      }
    }

    // ---- 别名：catalog 节点名 → 已有 case 的旧名 ----
    case 'delay':           // catalog: delay（旧名 sleep）
      return { outputs: {} }
    case 'json_op':    // 统一 JSON 节点（get/set/delete/merge 四模式）
      return { outputs: { result: '{"parsed": true}', error: '' } }

    // ---- 新增：catalog 中有但 mock 缺失的节点 ----
    case 'recall': {
      return { outputs: {}, message: '↩️ 已撤回消息' }
    }
    case 'api_call': {
      return { outputs: { result: '{"ok": true, "data": "mock"}' } }
    }
    case 'get_context': {
      // 统一上下文节点（合并 get_context_id + get_message_part + get_name + get_command_args）
      const mode = (config.mode as string) ?? 'user_id'
      // 基础信息
      if (mode === 'group_id') {
        return { outputs: { result: testInput.groupId ?? '654321', error: '' } }
      }
      if (mode === 'message_text' || mode === 'raw_message') {
        return { outputs: { result: testInput.text ?? '模拟消息文本', error: '' } }
      }
      if (mode === 'self_id') {
        return { outputs: { result: '10000', error: '' } }
      }
      if (mode === 'operator_id') {
        return { outputs: { result: testInput.userId ?? '123456', error: '' } }
      }
      if (mode === 'message_id') {
        return { outputs: { result: 'mock-msg-001', error: '' } }
      }
      if (mode === 'sub_type') {
        return { outputs: { result: 'normal', error: '' } }
      }
      // 指令参数
      if (mode === 'command_args') {
        const index = (config.index as number) ?? 0
        const argsStr = context['args'] ?? context['event'] ?? ''
        const argList = argsStr.split(/\s+/).filter((s) => s.length > 0)
        const val = argList[index] ?? ''
        return { outputs: { result: val, args_list: JSON.stringify(argList), error: '' } }
      }
      // 群成员列表
      if (mode === 'group_members') {
        return {
          outputs: {
            result: JSON.stringify([
              { user_id: '123456', nickname: '用户A', role: 'owner' },
              { user_id: '789012', nickname: '用户B', role: 'member' }
            ]),
            members: JSON.stringify([
              { user_id: '123456', nickname: '用户A', role: 'owner' },
              { user_id: '789012', nickname: '用户B', role: 'member' }
            ]),
            success: 'true', error: ''
          }
        }
      }
      // 消息片段
      if (mode === 'message_part') {
        const partMode = (config.part_mode as string) ?? 'at'
        if (partMode === 'image') {
          return { outputs: { result: 'https://example.com/img.png', part_list: '["https://example.com/img.png"]', part_count: '1', error: '' } }
        }
        if (partMode === 'file') {
          return { outputs: { result: 'https://example.com/file.zip', part_list: '[]', part_count: '1', error: '' } }
        }
        // at 模式
        const atTarget = testInput.userId ?? '123456'
        return { outputs: { result: atTarget, part_list: `["${atTarget}"]`, part_count: '1', error: '' } }
      }
      // 名称查询
      if (mode === 'user_name') {
        return { outputs: { result: '模拟昵称', card: '模拟群名片', nickname: '模拟昵称', error: '' } }
      }
      if (mode === 'group_name') {
        return { outputs: { result: '模拟群名称', card: '', nickname: '', error: '' } }
      }
      // 默认: user_id
      return { outputs: { result: testInput.userId ?? '123456', error: '' } }
    }
    case 'message_op': {
      // 构造消息段节点（不发送），通过 segment_type 切换 9 种段类型
      // 输出供 send_message(mode='segment') 发送
      const segType = (config.segment_type as string) ?? 'at'
      const segMap: Record<string, string> = {
        at: `{"type":"at","data":{"qq":"${testInput.userId ?? '123456'}"}}`,
        image: `{"type":"image","data":{"file":"${(config.url as string) ?? 'mock.png'}"}}`,
        face: `{"type":"face","data":{"id":"${(config.face_id as string) ?? '1'}"}}`,
        record: `{"type":"record","data":{"file":"${(config.file as string) ?? 'mock.amr'}"}}`,
        share: `{"type":"share","data":{"url":"${(config.url as string) ?? 'https://example.com'}"}}`,
        music: `{"type":"music","data":{"type":"${(config.music_type as string) ?? '163'}"}}`,
        poke: `{"type":"poke","data":{"qq":"${testInput.userId ?? '123456'}"}}`,
        reply: `{"type":"reply","data":{"id":"${(config.message_id as string) ?? 'mock-msg-001'}"}}`,
        forward: `{"type":"forward","data":{"id":"${(config.forward_id as string) ?? 'mock-fwd-res'}"}}`,
      }
      const msgMap: Record<string, string> = {
        at: `@${testInput.userId ?? '123456'} `,
        image: `🖼️ [图片] ${(config.url as string) ?? 'mock.png'}`,
        face: `[表情${(config.face_id as string) ?? '1'}]`,
        record: `🎤 [语音] ${(config.file as string) ?? 'mock.amr'}`,
        share: `🔗 [分享] ${(config.url as string) ?? 'https://example.com'}`,
        music: `🎵 分享音乐: ${(config.title as string) ?? '未知曲目'}`,
        poke: `👆 戳了戳 ${testInput.userId ?? '用户'}`,
        reply: `💬 [引用回复] 消息ID=${(config.message_id as string) ?? 'mock-msg-001'}`,
        forward: `🔗 [合并转发] 资源ID=${(config.forward_id as string) ?? 'mock-fwd-res'}`,
      }
      return { outputs: { segment: segMap[segType] ?? '{}', success: 'true', error: '' }, message: msgMap[segType] ?? `消息段(${segType})` }
    }
    case 'file_op': {
      // 统一文件操作节点（8 种 mode）
      const mode = (config.mode as string) ?? 'read'
      const fp = (config.file_path as string) ?? 'mock.txt'
      if (mode === 'write') {
        return { outputs: { success: 'true', path: fp, size: '100', error: '' } }
      }
      if (mode === 'copy' || mode === 'move') {
        return { outputs: { success: 'true', path: (config.dest_path as string) ?? 'mock_dest.txt', error: '' } }
      }
      if (mode === 'delete') {
        return { outputs: { success: 'true', error: '' }, message: `🗑️ 已删除 ${fp}` }
      }
      if (mode === 'exists') {
        return { outputs: { exists: 'true', is_file: 'true', is_dir: 'false', success: 'true', error: '' } }
      }
      if (mode === 'list_dir') {
        return { outputs: { result: '["file1.txt","file2.json","subdir"]', count: '3', success: 'true', error: '' } }
      }
      if (mode === 'mkdir') {
        return { outputs: { success: 'true', path: fp, error: '' } }
      }
      // read 模式：返回模拟文本内容
      return { outputs: { result: '{"key": "value"}', success: 'true', path: fp, error: '' } }
    }
    case 'edit_msg': {
      return { outputs: { success: 'true', error: '' }, message: `✏️ 已编辑消息` }
    }
    case 'group_op': {
      // 统一群管理节点（合并 group_punish/set_member_attr/set_group_leave 等）
      const mode = (config.mode as string) ?? 'ban'
      const msgMap: Record<string, string> = {
        ban: `🔇 已禁言用户 ${config.duration ?? 600}s`,
        kick: '👢 已踢出用户',
        mute_all: '🔇 已开启全员禁言',
        set_card: '✅ 已修改群名片',
        set_title: '✅ 已修改群头衔',
        leave: '👋 已退出群聊',
        approve_friend: '✅ 已审批好友请求',
        approve_group: '✅ 已审批加群请求',
        notice: '📢 已发送群公告',
        upload_file: '📤 已上传群文件',
      }
      return { outputs: { success: 'true', error: '' }, message: msgMap[mode] ?? `群管操作(${mode})` }
    }
    case 'data_table': {
      return { outputs: { schema: '{"columns": []}' } }
    }
    case 'admin_panel': {
      return { outputs: {} }
    }
    case 'ai_tool_call': {
      const msg = context['user_message'] ?? (config.user_message as string) ?? ''
      return { outputs: { response: `[AI工具回复] ${msg.slice(0, 20)}` } }
    }
    case 'try_catch': {
      // mock 模式下不模拟异常，走 try 分支
      return { outputs: { result: 'ok', error_message: '' } }
    }

    case 'wait_input': {
      // 等待回复节点（交互暂停，支持正则校验）
      return { outputs: { reply: '模拟回复', user_id: testInput.userId ?? '123456', timed_out: String(false), is_valid: String(true) } }
    }

    // ---- 模板中使用的节点 ----
    case 'expression_eval': {
      // mode='formulas' 多公式批量计算（原 formula_block 合并）
      const evalMode = (config.mode as string) ?? 'single'
      if (evalMode === 'formulas') {
        const formulas = (config.formulas as Array<{ name: string; expression: string }>) ?? []
        const outputs: Record<string, string> = { error: '' }
        for (const f of formulas) {
          if (!f?.name || !f?.expression) continue
          try {
            let jsExpr = f.expression
            // catalog 中 expression_eval 定义了 v1~v11（11 个变量端口），原代码只替换 v1~v6
            // 导致用户使用 v7~v11 时表达式不被替换，正则检查不通过返回错误
            for (let i = 1; i <= 11; i++) {
              const val = context[`v${i}`] ?? '0'
              const numVal = parseFloat(val)
              jsExpr = jsExpr.replace(new RegExp(`\\bv${i}\\b`, 'g'), String(isNaN(numVal) ? 0 : numVal))
            }
            jsExpr = jsExpr.replace(/int\(/g, 'Math.floor(')
            jsExpr = jsExpr.replace(/float\(/g, 'Number(')
            if (/^[\d\s+\-*/().,MathfloorNumber]+$/.test(jsExpr)) {
              outputs[f.name] = String(Function(`"use strict"; return (${jsExpr})`)())
            } else {
              outputs[f.name] = '0'
              outputs.error = `公式 ${f.name} 不支持`
            }
          } catch {
            outputs[f.name] = '0'
            outputs.error = `公式 ${f.name} 评估失败`
          }
        }
        return { outputs }
      }
      // single 模式：简单数学表达式求值（支持 v1~v5 变量、int()、+-*/、括号）
      const expr = (config.expression as string) ?? '0'
      try {
        let jsExpr = expr
        // 替换变量 v1~v11（catalog 中 expression_eval 定义了 11 个变量端口）
        for (let i = 1; i <= 11; i++) {
          const val = context[`v${i}`] ?? '0'
          const numVal = parseFloat(val)
          jsExpr = jsExpr.replace(new RegExp(`\\bv${i}\\b`, 'g'), String(isNaN(numVal) ? 0 : numVal))
        }
        // Python int() → JS Math.floor()
        jsExpr = jsExpr.replace(/int\(/g, 'Math.floor(')
        jsExpr = jsExpr.replace(/float\(/g, 'Number(')
        // 安全评估（仅含数字和运算符）
        if (/^[\d\s+\-*/().,MathfloorNumber]+$/.test(jsExpr)) {
          const val = String(Function(`"use strict"; return (${jsExpr})`)())
          return { outputs: { result: val, error: '' } }
        }
        return { outputs: { result: '0', error: '表达式不支持' } }
      } catch {
        return { outputs: { result: '0', error: '表达式评估失败' } }
      }
    }
    case 'check_permission': {
      // 权限检查：mock 模式默认有权限
      const level = (config.level as string) ?? 'member'
      void level
      return { outputs: { passed: 'true', user_role: 'owner', error: '' } }
    }

    case 'list_op': {
      // 统一列表操作节点（mode: get/append/remove/slice/concat/unique/sort/reverse）
      const mode = (config.mode as string) ?? 'get'
      const list = context['list'] ?? (config.list as string) ?? '[]'
      if (mode === 'get') {
        return { outputs: { result: '模拟项', index: '0', error: '' } }
      }
      return { outputs: { result: list, count: '1', error: '' } }
    }
    case 'flow_control': {
      // 流程控制（break/return）
      const fcMode = (config.mode as string) ?? 'break'
      if (fcMode === 'return') {
        const val = context['value'] ?? (config.value as string) ?? ''
        return { outputs: { result: val } }
      }
      // break 模式：无输出
      return { outputs: {} }
    }
    case 'parallel_exec': {
      // 并行执行：mock 返回空结果集
      return { outputs: { results: '[]', error: '' } }
    }
    case 'subflow_define': {
      // 定义子流程：无副作用
      return { outputs: {} }
    }
    case 'subflow_call': {
      // 调用子流程：返回占位结果，实际子流程链的递归执行在 walkChain 中处理
      return { outputs: { result: 'ok', error: '' } }
    }
    case 'regex_extract': {
      // 正则提取：用 testInput.text 尝试匹配 pattern
      const text = context['text'] ?? (config.text as string) ?? testInput.text ?? ''
      const pattern = (config.pattern as string) ?? ''
      let matched = ''
      let groups: string[] = []
      try {
        const flags = ((config.flags as string) ?? '').includes('i') ? 'i' : ''
        const re = new RegExp(pattern, flags)
        const m = text.match(re)
        if (m) {
          matched = m[0]
          groups = m.slice(1).filter((g) => g !== undefined)
        }
      } catch { /* 正则编译失败 */ }
      return {
        outputs: {
          matched,
          groups: groups.length > 0 ? JSON.stringify(groups) : '[]',
          error: ''
        }
      }
    }
    default: {
      // 未知节点：输出配置中的值
      const resultKey = spec?.outputs?.find((o) => o.kind === 'data')?.id ?? 'result'
      return { outputs: { [resultKey]: (config[resultKey] as string) ?? 'mock' } }
    }
  }
}

/**
 * 检查触发器是否匹配测试输入
 */
function triggerMatches(node: FlowNode, input: TestInput): boolean {
  const kind = node.data.nodeKind

  if (kind === 'on_message') {
    const match = (node.data.config?.match as string) ?? 'any'
    if (match === 'at_me') return input.triggerType === 'at_me'
    if (match === 'command') {
      if (input.triggerType !== 'command') return false
      const cmd = node.data.config?.command as string
      return input.command === cmd || (!input.command && !cmd)
    }
    // match=any / keyword → 匹配任意文本或 @机器人
    return input.triggerType === 'text' || input.triggerType === 'at_me'
  }
  if (kind === 'schedule') {
    return input.triggerType === 'schedule'
  }
  if (kind === 'on_request') {
    // 请求事件用 schedule 类型触发（因为不是普通消息）
    return input.triggerType === 'schedule'
  }
  if (kind === 'on_notice') {
    return input.triggerType === 'schedule'
  }
  if (kind === 'on_ready') {
    // 生命周期触发器用 schedule 类型触发（非消息驱动）
    return input.triggerType === 'schedule'
  }
  if (kind === 'on_startup') {
    // 生命周期触发器用 schedule 类型触发（非消息驱动）
    return input.triggerType === 'schedule'
  }

  // 非触发器默认不匹配
  return false
}

/**
 * 收集节点的上游数据输入值
 */
function resolveInputs(
  node: FlowNode,
  edges: FlowEdge[],
  mockContext: Map<string, string>
): Record<string, string> {
  const inputs: Record<string, string> = {}

  // 查找连接到 node 输入端口的数据边
  const dataEdges = edges.filter(
    (e) => e.target === node.id && e.targetPort !== 'in'
  )

  for (const edge of dataEdges) {
    const key = `${edge.source}:${edge.sourcePort}`
    const val = mockContext.get(key)
    if (val !== undefined) {
      inputs[edge.targetPort] = val
    }
  }

  return inputs
}

/**
 * 记录节点输出到上下文
 */
function recordOutputs(
  nodeId: string,
  outputs: Record<string, string>,
  mockContext: Map<string, string>
): void {
  for (const [portId, val] of Object.entries(outputs)) {
    mockContext.set(`${nodeId}:${portId}`, val)
  }
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

/**
 * 在浏览器中模拟执行当前流程图
 *
 * @param nodes  当前流程所有节点
 * @param edges  当前流程所有边
 * @param input  测试输入
 * @returns      执行跟踪结果
 */
export function simulateExecution(
  nodes: FlowNode[],
  edges: FlowEdge[],
  input: TestInput
): ExecutionResult {
  const chains = getExecutionChains(nodes, edges)
  const t0 = performance.now()
  const steps: TraceStep[] = []
  const messageOutputs: string[] = []
  let stepCounter = 1

  // 持久化存储：从 testInput.mockData 初始化
  // 关键：persistStore 必须跨链共享，模拟实际运行时全局持久化的语义
  // 原实现每次循环新建 persistStore，导致链 A 的 save 在链 B 的 load 中读不到
  const persistStore = new Map<string, string>(Object.entries(input.mockData ?? {}))
  for (let ci = 0; ci < chains.length; ci++) {
    const chain = chains[ci]
    const trigger = chain.trigger

    if (!triggerMatches(trigger, input)) {
      // 记录为 skip
      steps.push({
        nodeId: trigger.id,
        stepNum: -1,
        label: trigger.data.label,
        icon: getNodeIcon(trigger),
        status: 'skip',
        duration: 0,
        outputs: {},
        chainIndex: ci,
        error: '触发器不匹配，跳过'
      })
      continue
    }

    // 该链被触发，模拟执行
    const mockContext = new Map<string, string>()
    walkChain(
      { nodes: chain.sequence },
      nodes,
      edges,
      input,
      mockContext,
      persistStore,
      steps,
      messageOutputs,
      { n: stepCounter },
      ci
    )
    stepCounter = steps.filter((s) => s.status === 'ok').length + 1
  }

  const total = performance.now() - t0
  const okSteps = steps.filter((s) => s.status === 'ok')
  const errorSteps = steps.filter((s) => s.status === 'error')

  return {
    steps,
    triggered: okSteps.length > 0,
    summary: {
      totalSteps: steps.length,
      okSteps: okSteps.length,
      errorSteps: errorSteps.length,
      messageOutputs,
      elapsed: Math.round(total * 100) / 100
    }
  }
}

/**
 * 收集分支节点所有出口下游的节点 ID（用于跳过未被选中的分支）
 * 使用 getControlOutputs 获取所有控制流出口，兼容 if_branch(true/false) 和 loop(body/done)
 */
function collectBranchDownstream(
  branchNode: FlowNode,
  edges: FlowEdge[],
  nodes: FlowNode[]
): string[] {
  const ids: string[] = []
  const outPorts = getControlOutputs(branchNode)
  for (const port of outPorts) {
    const branchEdge = edges.find(
      (e) => e.source === branchNode.id && e.sourcePort === port.portId
    )
    if (branchEdge) {
      const seq = collectSequence(branchEdge.target, edges, nodes)
      for (const n of seq) ids.push(n.id)
    }
  }
  return ids
}

/**
 * 递归走链
 *
 * stepCounter 使用可变对象 { n: number }，递归调用共享同一个计数器，
 * 避免按值传递 number 导致的步骤编号重复。
 */
function walkChain(
  chain: { nodes: FlowNode[] },
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
  input: TestInput,
  mockContext: Map<string, string>,
  persistStore: Map<string, string>,
  steps: TraceStep[],
  messageOutputs: string[],
  stepCounter: { n: number },
  chainIndex: number,
  /** 由外层传入的、需要跳过的节点 ID（分支递归处理后标记） */
  skipIds?: Set<string>
): void {
  const localSkip = skipIds ?? new Set<string>()

  for (const node of chain.nodes) {
    // 跳过已被分支递归处理过的节点
    if (localSkip.has(node.id)) continue

    const t1 = performance.now()
    const spec = findSpec(node.data.nodeKind)

    // 解析数据输入
    const resolvedInputs = resolveInputs(node, allEdges, mockContext)

    // 执行模拟
    const { outputs, message, branch } = mockNodeOutput(node, spec, resolvedInputs, input, persistStore)

    const t2 = performance.now()
    const duration = Math.round((t2 - t1) * 100) / 100

    // 记录输出到上下文（供下游使用）
    recordOutputs(node.id, outputs, mockContext)

    const stepNum = stepCounter.n
    stepCounter.n++

    const step: TraceStep = {
      nodeId: node.id,
      stepNum,
      label: node.data.label,
      icon: getNodeIcon(node),
      status: 'ok',
      duration,
      outputs,
      chainIndex
    }

    if (node.data.nodeKind === 'if_branch' || node.data.nodeKind === 'if_condition') {
      step.branch = branch
      step.branchLabel = node.data.label
    }
    // switch_case：记录匹配的分支标签用于展示
    if (node.data.nodeKind === 'switch_case' && outputs.matched) {
      step.branchLabel = `${node.data.label} → ${outputs.matched}`
    }

    if (message) {
      step.message = message
      messageOutputs.push(message)
    }

    steps.push(step)

    // 处理分支递归
    if (node.data.nodeKind === 'if_branch' || node.data.nodeKind === 'if_condition') {
      const branchPort = branch === 'true' ? 'true' : 'false'
      const nextEdge = allEdges.find(
        (e) => e.source === node.id && e.sourcePort === branchPort
      )
      if (nextEdge) {
        const branchNodes = collectSequence(nextEdge.target, allEdges, allNodes)
        if (branchNodes.length > 0) {
          // 关键：递归调用必须传递 localSkip，否则嵌套分支的下游节点会被外层主链重复处理
          // （BFS 主链包含所有可达节点，内层标记的跳过集必须影响外层）
          walkChain(
            { nodes: branchNodes },
            allNodes, allEdges, input, mockContext, persistStore,
            steps, messageOutputs, stepCounter, chainIndex,
            localSkip
          )
        }
      }

      // 标记两条分支的所有下游节点为"跳过"
      const downstream = collectBranchDownstream(node, allEdges, allNodes)
      for (const did of downstream) localSkip.add(did)
    }

    // 处理 switch_case 分支递归
    if (node.data.nodeKind === 'switch_case') {
      const matchedLabel = outputs.matched ?? ''
      // 找到匹配分支的边（sourcePort === 匹配的 label）
      const nextEdge = allEdges.find(
        (e) => e.source === node.id && e.sourcePort === matchedLabel
      )
      if (nextEdge) {
        const branchNodes = collectSequence(nextEdge.target, allEdges, allNodes)
        if (branchNodes.length > 0) {
          // 同 if_branch：递归必须传递 localSkip 防止嵌套分支下游重复处理
          walkChain(
            { nodes: branchNodes },
            allNodes, allEdges, input, mockContext, persistStore,
            steps, messageOutputs, stepCounter, chainIndex,
            localSkip
          )
        }
      }

      // 标记所有分支的下游节点为"跳过"（switch_case 的所有 case 出口）
      const downstream = collectBranchDownstream(node, allEdges, allNodes)
      for (const did of downstream) localSkip.add(did)
    }

    // 处理循环递归
    if (node.data.nodeKind === 'loop') {
      const bodyEdge = allEdges.find(
        (e) => e.source === node.id && e.sourcePort === 'body'
      )
      // 循环体执行一次（mock 中不重复 N 次，仅展示单次迭代效果）
      if (bodyEdge) {
        const bodyNodes = collectSequence(bodyEdge.target, allEdges, allNodes)
        if (bodyNodes.length > 0) {
          // 同 if_branch：递归必须传递 localSkip
          walkChain(
            { nodes: bodyNodes },
            allNodes, allEdges, input, mockContext, persistStore,
            steps, messageOutputs, stepCounter, chainIndex,
            localSkip
          )
        }
      }

      // done 分支（循环结束后执行）
      const doneEdge = allEdges.find(
        (e) => e.source === node.id && e.sourcePort === 'done'
      )
      if (doneEdge) {
        const doneNodes = collectSequence(doneEdge.target, allEdges, allNodes)
        if (doneNodes.length > 0) {
          walkChain(
            { nodes: doneNodes },
            allNodes, allEdges, input, mockContext, persistStore,
            steps, messageOutputs, stepCounter, chainIndex,
            localSkip
          )
        }
      }

      // 标记 body + done 所有下游为"跳过"
      const downstream = collectBranchDownstream(node, allEdges, allNodes)
      for (const did of downstream) localSkip.add(did)
    }

    // 处理 subflow_call：递归执行子流程链
    if (node.data.nodeKind === 'subflow_call') {
      const subflowId = node.data.config?.subflow_id as string | undefined
      if (subflowId) {
        const defineNode = allNodes.find((n) => n.id === subflowId)
        if (defineNode && defineNode.data.nodeKind === 'subflow_define') {
          // 从 subflow_define 的 next 端口找到子流程的第一个节点
          const nextEdge = allEdges.find(
            (e) => e.source === subflowId && e.sourcePort === 'next'
          )
          if (nextEdge) {
            const subflowNodes = collectSequence(nextEdge.target, allEdges, allNodes)
            if (subflowNodes.length > 0) {
              // 递归执行子流程（用同一 mockContext 简化处理，不做变量隔离）
              walkChain(
                { nodes: subflowNodes },
                allNodes, allEdges, input, mockContext, persistStore,
                steps, messageOutputs, stepCounter, chainIndex,
                localSkip
              )
            }
          }
        }
      }
    }
  }
}

/**
 * 收集从某个节点开始的线性序列（用于分支）
 * 使用 getControlOutputs 获取端口名，兼容 'out'/'next'/'done' 等不同命名
 */
function collectSequence(
  startNodeId: string,
  edges: FlowEdge[],
  nodes: FlowNode[]
): FlowNode[] {
  const seq: FlowNode[] = []
  const visited = new Set<string>()
  let currentId: string | null = startNodeId

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = nodes.find((n) => n.id === currentId)
    if (!node) break

    // 遇到分支节点停止（分支机构自己处理递归）
    if (node.data.nodeKind === 'if_branch' || node.data.nodeKind === 'if_condition' || node.data.nodeKind === 'switch_case') {
      seq.push(node)
      break
    }

    seq.push(node)

    // 用 getControlOutputs 获取控制流出口端口名（兼容端口定义缺失的模板节点）
    const outPorts = getControlOutputs(node)
    if (outPorts.length !== 1) break
    const nextEdge = edges.find(
      (e) => e.source === currentId && e.sourcePort === outPorts[0].portId
    )
    currentId = nextEdge?.target ?? null
  }

  return seq
}

function getNodeIcon(node: FlowNode): string {
  const spec = findSpec(node.data.nodeKind)
  return spec?.icon ?? '⬡'
}
