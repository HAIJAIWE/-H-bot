// src/main/services/ai/codeSafety.ts
//
// AI 生成 Python 代码的安全风险评估。
//
// 双层防护：
// 1. 正则快速筛查（同步，~0.1ms）：覆盖常见危险调用与简单绕过
// 2. Python AST 深度检查（异步，可选）：通过子进程调用 Python 解析 AST，
//    覆盖字符串拼接绕过、字节字面量、Unicode 编码等正则无法识别的 case
//
// 调用方建议：先用 assessCodeRisk 同步过滤，high 直接拒绝；
// 若需更严格（如生产环境），再调用 assessCodeRiskDeep 异步深度检查。

/** 高危模式：执行任意代码 / 逃逸沙箱 */
const HIGH_RISK_PATTERNS: RegExp[] = [
  // 系统调用入口
  /os\.system\s*\(/,
  /\bos\.popen\s*\(/,
  /\bos\.exec(v|l|le|vp|vpe)?\s*\(/,
  /subprocess\.\w+\s*\(/,
  /\bpty\.\w+\s*\(/,
  /\bcommands\.\w+\s*\(/,

  // 动态执行
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\bcompile\s*\(/,
  /__import__\s*\(/,

  // 动态导入
  /\bimportlib\.\w+/,
  /\bimp\.\w+/,

  // 内建命名空间访问绕过
  /\bglobals\s*\(\s*\)/,
  /\blocals\s*\(\s*\)/,
  /\bvars\s*\(\s*\)/,
  /__builtins__/,

  // 动态属性访问绕过：getattr(obj, 'system'/'eval'/'exec'/'__import__'/'popen')
  /getattr\s*\(\s*[^,]+,\s*['"](system|popen|eval|exec|__import__|fork|kill|chmod|chown)['"]/,

  // 反序列化漏洞：pickle/marshal 可执行任意代码
  /\bpickle\.loads?\s*\(/,
  /\bmarshal\.loads?\s*\(/,
  /\byaml\.load\s*\(/, // yaml.load 不安全（应使用 yaml.safe_load）
  /\bshelve\.open\s*\(/,

  // 网络外泄：socket 可建立任意连接
  /\bsocket\.socket\s*\(/,
  /\basyncio\.(open_connection|start_server|create_connection)\s*\(/,

  // 系统调用：ctypes 可调用任意 C API
  /\bctypes\.\w+/,

  // 输入读取绕过（用户控制输入执行）
  /\binput\s*\(\s*\)/,

  // 退出/中止（影响服务可用性）
  /\b(exit|quit|sys\.exit)\s*\(/,

  // 文件描述符直接操作（绕过文件路径守卫）
  /\bos\.(dup|dup2|fdopen|open)\s*\(/,

  // 类型代码对象绕过
  /\btypes\.CodeType\b/,
  /\bfunc_globals\b/,
  /\bfunc_code\b/,

  // 多进程绕过（可启动任意进程）
  /\bmultiprocessing\.\w+/,

  // threading + 任意目标（保守标记 high，让用户审查）
  /\bthreading\.Thread\s*\(\s*target\s*=/,

  // fork
  /\bos\.fork\s*\(/,
]

/** 中危模式：文件/系统副作用，非任意代码执行 */
const MEDIUM_RISK_PATTERNS: RegExp[] = [
  // 文件写入：要求 w/a 后必须紧跟引号闭合
  // 修复正则误报：原 /open\s*\([^)]*['"][wa]/ 会匹配 open(x, "world.txt")
  /open\s*\([^)]*['"][wa]['"]/,
  // 补充 r+/w+/a+ 等可读写模式
  /open\s*\([^)]*['"][wa][+b]['"]/,

  // shutil 文件操作
  /\bshutil\.\w+/,

  // os 文件/目录操作
  /\bos\.(remove|unlink|rmdir|mkdir|makedirs|rename|replace|chmod|chown|utime)\s*\(/,

  // pathlib 写入
  /\bpathlib\.Path\b[^.\n]*\.write_/,

  // 网络 HTTP 客户端
  /\burllib\.request\.\w+/,
  /\bhttp\.client\.\w+/,
  /\brequests\.\w+/,
  /\bhttpx\.\w+/,

  // 环境变量读取（信息泄露）
  /\bos\.environ\b/,

  // 临时文件（路径不可控）
  /\btempfile\.\w+/,

  // 子进程相关导入（即使未调用，存在使用意图）
  /\bimport\s+subprocess\b/,
]

/** 字符串拼接绕过检测：'sy' + 'stem' / "sy" "stem" / chr(115)+chr(115) */
const STRING_CONCAT_PATTERNS: RegExp[] = [
  // 'sy' + 'stem'：显式 + 拼接危险字符串
  /['"][a-z_]+['"]\s*\+\s*['"][a-z_]+['"]/i,
  // 字符串字面量相邻自动拼接 "sy" "stem"
  /['"][a-z_]+['"]\s+['"][a-z_]+['"]/i,
  // chr() 拼接绕过
  /chr\s*\(\s*\d+\s*\)\s*(\+|chr\s*\()/,
]

/** 高危字符串字面量：当出现拼接时，检测目标字符串是否包含这些词 */
const DANGEROUS_STRING_TARGETS: RegExp[] = [
  /system/i,
  /popen/i,
  /__import__/i,
  /\beval\b/i,
  /\bexec\b/i,
  /fork/i,
  /builtins/i,
]

export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * 提取代码中所有字符串字面量内容（单/双引号 + 字节字面量），拼成一个大字符串。
 *
 * 用于检测字符串拼接绕过：'sy' + 'stem' 拼接后，提取出的字符串大集合会包含 "system"，
 * 触发危险词匹配。
 *
 * 注意：此函数仅做粗略提取，不解析 AST。 chr(115) 等动态构造由
 * scripts/python_safety_check.py 通过 AST 求值精确识别。
 */
function extractAllStringLiterals(code: string): string {
  const literals: string[] = []

  // 1. 普通字符串字面量：'...' / "..."
  //    使用非贪婪匹配，简单规避转义引号
  const stringLiteralRe = /(['"])((?:\\.|(?!\1).)*)\1/g
  let m: RegExpExecArray | null
  while ((m = stringLiteralRe.exec(code)) !== null) {
    literals.push(m[2])
  }

  // 2. 字节字面量：b'...' / b"..."
  const byteLiteralRe = /b(['"])((?:\\.|(?!\1).)*)\1/g
  while ((m = byteLiteralRe.exec(code)) !== null) {
    literals.push(m[2])
  }

  // 3. f-string 内的字符串部分：f'...' / f"..."
  //    已被普通字符串正则覆盖

  // 4. chr(N) 调用：提取 N 并转换为字符
  const chrRe = /\bchr\s*\(\s*(\d+)\s*\)/g
  while ((m = chrRe.exec(code)) !== null) {
    const codePoint = parseInt(m[1], 10)
    if (codePoint >= 0 && codePoint <= 0x10ffff) {
      try {
        literals.push(String.fromCodePoint(codePoint))
      } catch {
        // 无效 code point，忽略
      }
    }
  }

  return literals.join('')
}

/**
 * 同步快速风险评估：基于正则的模式匹配。
 *
 * 优势：~0.1ms，无外部依赖，可在 IPC 主线程调用
 * 局限：无法识别字符串拼接、字节字面量、Unicode 编码等 AST 级绕过
 *
 * 对安全敏感场景，应额外调用 assessCodeRiskDeep() 进行 AST 检查。
 */
/** JS/TS 脚本的高危模式（10/18 的 `assessScriptRisk` 与 Python 规则同一道闸：AI 生成的插件 index.js 也要过） */
const JS_HIGH_RISK_PATTERNS: RegExp[] = [
  /\bnew\s+Function\s*\(/,
  /\bchild_process\b/,
  /\brequire\s*\(/,
  /\bprocess\.(env|binding|mainModule|exit|kill)\b/,
  /\bvm\.(runIn\w*|createContext|compileFunction|Script)\b/,
]

/** JS/TS 脚本的中危模式：只写文件/动态 import，不算任意代码执行 */
const JS_MEDIUM_RISK_PATTERNS: RegExp[] = [
  /\bfs\.(writeFile|appendFile|unlink|rm|rmdir|mkdir)\w*\s*\(/,
  /\bimport\s*\(/,
]

/**
 * 评估一段**脚本源码**（Python 或 JS/TS）的风险等级。
 *
 * 为什么和 `assessCodeRisk` 分开：后者的规则表是 Python 专用的（os.system /
 * pickle / ctypes…），拿去扫 JS 只会全判 low。插件市场与 write_code 提案扫的是
 * **JS/TS**，所以这里合并两张表、取最高风险。
 */
export function assessScriptRisk(code: string): RiskLevel {
  for (const pattern of HIGH_RISK_PATTERNS) if (pattern.test(code)) return 'high'
  for (const pattern of JS_HIGH_RISK_PATTERNS) if (pattern.test(code)) return 'high'
  for (const pattern of MEDIUM_RISK_PATTERNS) if (pattern.test(code)) return 'medium'
  for (const pattern of JS_MEDIUM_RISK_PATTERNS) if (pattern.test(code)) return 'medium'
  return 'low'
}

export function assessCodeRisk(pythonCode: string): RiskLevel {
  // 1. 高危模式直接 high
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(pythonCode)) return 'high'
  }

  // 2. 字符串拼接绕过检测：拼接 + 目标字符串包含危险词
  //    策略：若代码中存在字符串拼接（'sy' + 'stem'）或 chr() 拼接，
  //    提取所有字面量拼成大字符串，检查是否包含危险词
  let hasConcat = false
  for (const concatPattern of STRING_CONCAT_PATTERNS) {
    if (concatPattern.test(pythonCode)) {
      hasConcat = true
      break
    }
  }
  if (hasConcat) {
    const aggregated = extractAllStringLiterals(pythonCode)
    for (const target of DANGEROUS_STRING_TARGETS) {
      if (target.test(aggregated)) return 'high'
    }
  }

  // 3. 中危模式
  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(pythonCode)) return 'medium'
  }

  return 'low'
}

/**
 * 深度风险评估：通过 Python AST 解析识别正则无法覆盖的绕过。
 *
 * 实现方式：调用 Python 子进程运行 scripts/python_safety_check.py，
 * 该脚本使用 ast 模块解析代码，识别：
 * - 字符串拼接构造危险函数名（'sy' + 'stem'）
 * - 字节字面量绕过（b'system'）
 * - Unicode 编码绕过（'\x73ystem'）
 * - 动态属性访问（getattr / __getattribute__）
 * - 隐式导入（__import__ 通过字符串变量）
 *
 * 若 Python 环境不可用或检查失败，回退到 assessCodeRisk 结果。
 *
 * @param pythonCode 待检查的 Python 代码
 * @param pythonBin 可选，Python 可执行文件路径（默认 'python'）
 */
export async function assessCodeRiskDeep(
  pythonCode: string,
  pythonBin = 'python'
): Promise<RiskLevel> {
  // 先做正则快速筛查
  const regexRisk = assessCodeRisk(pythonCode)
  if (regexRisk === 'high') return 'high'

  // 尝试调用 Python AST 检查
  try {
    const { spawn } = await import('node:child_process')
    const scriptPath = require('path').join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'scripts',
      'python_safety_check.py'
    )

    return await new Promise<RiskLevel>((resolve) => {
      const proc = spawn(pythonBin, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      // 5 秒超时
      const timer = setTimeout(() => {
        proc.kill()
        resolve(regexRisk) // 超时回退
      }, 5000)

      proc.on('error', () => {
        clearTimeout(timer)
        resolve(regexRisk) // Python 不可用，回退
      })

      proc.on('close', (code: number | null) => {
        clearTimeout(timer)
        if (code !== 0) {
          // Python 脚本异常，回退
          resolve(regexRisk)
          return
        }
        // 输出格式：'low' | 'medium' | 'high'
        const result = stdout.trim() as RiskLevel
        if (result === 'high' || result === 'medium' || result === 'low') {
          // 取正则与 AST 中更高风险等级
          const order: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }
          resolve(order[result] >= order[regexRisk] ? result : regexRisk)
        } else {
          resolve(regexRisk)
        }
      })

      // 通过 stdin 传入代码（避免命令行参数转义问题）
      proc.stdin.write(pythonCode)
      proc.stdin.end()
    })
  } catch {
    // spawn 不可用或其他异常，回退
    return regexRisk
  }
}
