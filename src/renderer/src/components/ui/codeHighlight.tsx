// src/renderer/src/components/ui/codeHighlight.tsx
//
// **极简语法高亮**（2026-10-20）：不引第三方依赖，按语言家族做词法切分。
//
// 为什么手写：只服务聊天里的代码块，需要覆盖的是"AI 回复里最常见的几种语言"；
// 引一个 highlight.js/prism 会带几十种语言和主题，包里不值得。
// 安全：只产出 React 节点（不拼 innerHTML），认不出的语言原样返回纯文本。
import type { ReactNode } from 'react';

type TokenType = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'key' | 'variable';

const TOKEN_CLASS: Record<TokenType, string> = {
  plain: '',
  keyword: 'text-sky-300',
  string: 'text-green-300',
  comment: 'text-zinc-500 italic',
  number: 'text-amber-300',
  key: 'text-sky-300',
  variable: 'text-purple-300',
};

const JS_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'class',
  'extends',
  'import',
  'from',
  'export',
  'default',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'typeof',
  'instanceof',
  'in',
  'of',
  'this',
  'super',
  'null',
  'undefined',
  'true',
  'false',
  'interface',
  'type',
  'enum',
  'implements',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'as',
  'satisfies',
  'void',
  'yield',
]);

const BASH_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'export',
  'local',
  'return',
  'set',
  'unset',
  'shift',
  'source',
  'alias',
]);

interface Token {
  type: TokenType;
  text: string;
}

function scan(
  source: string,
  patterns: Array<{ type: TokenType; re: RegExp; keyword?: Set<string> }>,
): Token[] {
  const out: Token[] = [];
  let i = 0;
  let plain = '';
  const flush = (): void => {
    if (plain) {
      out.push({ type: 'plain', text: plain });
      plain = '';
    }
  };
  while (i < source.length) {
    let matched = false;
    for (const p of patterns) {
      const m = p.re.exec(source.slice(i));
      if (!m || m[0] === '') continue;
      const text = m[0];
      if (p.keyword && !p.keyword.has(text)) continue; // 词法命中但不在关键字表 → 当普通词
      flush();
      out.push({ type: p.type, text });
      i += text.length;
      matched = true;
      break;
    }
    if (!matched) {
      plain += source[i];
      i += 1;
    }
  }
  flush();
  return out;
}

const JS_PATTERNS = [
  { type: 'comment' as const, re: /^\/\/[^\n]*/ },
  { type: 'comment' as const, re: /^\/\*[\s\S]*?\*\// },
  { type: 'string' as const, re: /^`(?:\\[\s\S]|[^\\`])*`/ },
  { type: 'string' as const, re: /^"(?:\\.|[^"\\])*"/ },
  { type: 'string' as const, re: /^'(?:\\.|[^'\\])*'/ },
  { type: 'number' as const, re: /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/ },
  { type: 'keyword' as const, re: /^[A-Za-z_$][\w$]*/, keyword: JS_KEYWORDS },
];

const JSON_PATTERNS = [
  { type: 'string' as const, re: /^"(?:\\.|[^"\\])*"/ },
  {
    type: 'keyword' as const,
    re: /^\b(?:true|false|null)\b/,
    keyword: new Set(['true', 'false', 'null']),
  },
  { type: 'number' as const, re: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
];

const BASH_PATTERNS = [
  { type: 'comment' as const, re: /^#[^\n]*/ },
  { type: 'string' as const, re: /^"(?:\\.|[^"\\])*"/ },
  { type: 'string' as const, re: /^'(?:\\.|[^'\\])*'/ },
  { type: 'variable' as const, re: /^\$\{?[A-Za-z_]\w*\}?/ },
  { type: 'number' as const, re: /^\b\d+\b/ },
  { type: 'keyword' as const, re: /^[A-Za-z_]\w*/, keyword: BASH_KEYWORDS },
];

function normalizeLang(lang: string): 'js' | 'json' | 'bash' | 'plain' {
  const l = lang.trim().toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'javascript', 'typescript'].includes(l)) return 'js';
  if (['json', 'jsonc'].includes(l)) return 'json';
  if (['bash', 'sh', 'shell', 'zsh', 'console'].includes(l)) return 'bash';
  return 'plain';
}

/** 代码 → 着色节点。认不出的语言原样返回（不猜、不崩）。 */
export function highlightCode(code: string, lang: string): ReactNode[] {
  const family = normalizeLang(lang);
  if (family === 'plain') return [code];
  const patterns =
    family === 'js' ? JS_PATTERNS : family === 'json' ? JSON_PATTERNS : BASH_PATTERNS;
  const tokens = scan(code, patterns);
  if (family === 'json') {
    // JSON 的 key 也是字符串：后面紧跟冒号的字符串标成 key 色
    for (let i = 0; i < tokens.length; i += 1) {
      const next = tokens.slice(i + 1).find((t) => t.type !== 'plain' || t.text.trim() !== '');
      if (tokens[i].type === 'string' && next?.text.trimStart().startsWith(':'))
        tokens[i].type = 'key';
    }
  }
  return tokens.map((token, idx) =>
    token.type === 'plain' ? (
      token.text
    ) : (
      <span key={idx} className={TOKEN_CLASS[token.type]}>
        {token.text}
      </span>
    ),
  );
}
