// src/renderer/src/components/editor/pythonCompletions.ts
// Python 关键字 + NoneBot API 补全提供器（无需语言服务器）
//
// 类型说明：monaco-editor 不是直接依赖（@monaco-editor/react 内部按需加载），
// 这里定义最小化的 MonacoNamespace 结构类型，避免引入额外类型依赖。

/** Monaco 补全项最小结构 */
interface MonacoCompletionItem {
  label: string
  kind: number
  insertText: string
  insertTextRules?: number
  range: unknown
  detail?: string
  documentation?: unknown
}

interface MonacoLanguages {
  CompletionItemKind: Record<string, number>
  CompletionItemInsertTextRule: Record<string, number>
  registerCompletionItemProvider(
    languageId: string,
    provider: {
      triggerCharacters?: string[]
      provideCompletionItems(
        model: { getWordUntilPosition(position: { lineNumber: number; column: number }): { startColumn: number; endColumn: number } },
        position: { lineNumber: number; column: number }
      ): { suggestions: MonacoCompletionItem[] }
    }
  ): void
}

interface MonacoNamespace {
  languages: MonacoLanguages
}

/** Python 关键字 */
const PYTHON_KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield',
]

/** Python 内置函数 */
const PYTHON_BUILTINS = [
  'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray',
  'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
  'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec',
  'filter', 'float', 'format', 'frozenset', 'getattr', 'globals',
  'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
  'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max',
  'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
  'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
  'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
  'tuple', 'type', 'vars', 'zip', '__import__',
]

/** NoneBot 核心 API */
const NONEBOT_API = [
  { label: 'on_message', detail: '注册消息事件响应器' },
  { label: 'on_notice', detail: '注册通知事件响应器' },
  { label: 'on_request', detail: '注册请求事件响应器' },
  { label: 'on_startswith', detail: '注册前缀匹配响应器' },
  { label: 'on_endswith', detail: '注册后缀匹配响应器' },
  { label: 'on_fullmatch', detail: '注册全匹配响应器' },
  { label: 'on_keyword', detail: '注册关键词匹配响应器' },
  { label: 'on_command', detail: '注册命令响应器' },
  { label: 'on_regex', detail: '注册正则匹配响应器' },
  { label: 'on_type', detail: '注册事件类型响应器' },
  { label: 'get_driver', detail: '获取 NoneBot Driver 实例' },
  { label: 'get_bot', detail: '获取 Bot 实例' },
  { label: 'get_plugin_config', detail: '获取插件配置' },
  { label: 'require', detail: '声明依赖插件' },
  { label: 'export', detail: '导出插件接口' },
  { label: 'logger', detail: 'NoneBot 日志器' },
]

/** NoneBot 事件模型 */
const NONEBOT_MODELS = [
  'Event', 'MessageEvent', 'PrivateMessageEvent', 'GroupMessageEvent',
  'NoticeEvent', 'RequestEvent', 'Message', 'MessageSegment',
]

/** 注册 Python 补全提供器（只需注册一次） */
let registered = false

export function registerPythonCompletions(monaco: MonacoNamespace): void {
  if (registered) return
  registered = true

  // 关键字补全
  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const suggestions: MonacoCompletionItem[] = []

      // Python 关键字
      for (const kw of PYTHON_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: 'Python 关键字',
        })
      }

      // Python 内置函数
      for (const fn of PYTHON_BUILTINS) {
        suggestions.push({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: fn.endsWith('__') ? fn : `${fn}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: 'Python 内置函数',
        })
      }

      // NoneBot API
      for (const api of NONEBOT_API) {
        suggestions.push({
          label: api.label,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${api.label}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: api.detail,
          documentation: { value: `\`${api.label}\` — ${api.detail}`, isTrusted: true },
        })
      }

      // NoneBot 模型
      for (const model of NONEBOT_MODELS) {
        suggestions.push({
          label: model,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: model,
          range,
          detail: 'NoneBot 事件模型',
        })
      }

      // 常用代码片段
      const snippets: { label: string; insertText: string; detail: string }[] = [
        {
          label: 'on_command_handler',
          insertText: [
            'from nonebot import on_command',
            'from nonebot.params import CommandArg',
            'from nonebot.adapters.onebot.v11 import Event, Message',
            '',
            '${1:matcher} = on_command("${2:命令}", priority=${3:10})',
            '',
            '@${1:matcher}.handle()',
            'async def _${1:matcher}(event: Event, args: Message = CommandArg()):',
            '    ${4:pass}',
          ].join('\n'),
          detail: 'NoneBot 命令处理器模板',
        },
        {
          label: 'on_message_handler',
          insertText: [
            'from nonebot import on_message',
            'from nonebot.adapters.onebot.v11 import Event, Message',
            '',
            '${1:matcher} = on_message(priority=${2:10})',
            '',
            '@${1:matcher}.handle()',
            'async def _${1:matcher}(event: Event):',
            '    ${3:pass}',
          ].join('\n'),
          detail: 'NoneBot 消息处理器模板',
        },
        {
          label: 'async_def',
          insertText: 'async def ${1:func}(${2:params}):\n    ${3:pass}',
          detail: '异步函数定义',
        },
        {
          label: 'class_def',
          insertText: 'class ${1:ClassName}:\n    def __init__(self${2:, params}):\n        ${3:pass}',
          detail: '类定义',
        },
      ]

      for (const snippet of snippets) {
        suggestions.push({
          label: snippet.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: snippet.detail,
        })
      }

      return { suggestions }
    },
  })
}
