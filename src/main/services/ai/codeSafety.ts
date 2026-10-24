// src/main/services/ai/codeSafety.ts
//
// AI 生成/提案的**脚本源码**风险评估（插件 index.js、write_code 提案）。
//
// 只有一套栈：JS/TS。这里做同步正则筛查（~0.1ms，可在 IPC 主线程调用）：
//   high   = 任意代码执行 / 宿主逃逸（沙箱里不该出现的东西）
//   medium = 写文件 / 动态 import（有副作用，让用户看一眼）
//
// 说明：10/18 之前的 Python 专属规则表（os.system / pickle / ctypes / getattr 绕过
// + 调 python AST 深检）已随 Python 栈一起删掉 —— 那套规则扫 JS 只会全判 low。

export type RiskLevel = 'low' | 'medium' | 'high'

/** 高危模式：执行任意代码 / 逃逸沙箱 */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bnew\s+Function\s*\(/,
  /\beval\s*\(/,
  /\bchild_process\b/,
  /\brequire\s*\(/,
  /\bprocess\.(env|binding|mainModule|exit|kill)\b/,
  /\bvm\.(runIn\w*|createContext|compileFunction|Script)\b/,
]

/** 中危模式：文件写入 / 动态 import */
const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /\bfs\.(writeFile|appendFile|unlink|rm|rmdir|mkdir)\w*\s*\(/,
  /\bimport\s*\(/,
]

/**
 * 评估一段脚本源码的风险等级（插件市场安装与 write_code 提案共用这一道闸）。
 *
 * 沙箱内的节点 handler 约定无 require / process / Buffer，所以上面这些模式一出现
 * 就说明代码想跳出沙箱；写文件与动态 import 有副作用但不算逃逸，判 medium。
 */
export function assessScriptRisk(code: string): RiskLevel {
  for (const pattern of HIGH_RISK_PATTERNS) if (pattern.test(code)) return 'high'
  for (const pattern of MEDIUM_RISK_PATTERNS) if (pattern.test(code)) return 'medium'
  return 'low'
}
