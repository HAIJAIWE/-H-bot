// tests/renderer/components/ui/codeHighlight.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { highlightCode } from '@renderer/components/ui/codeHighlight';

function classes(code: string, lang: string): string[] {
  const { container } = render(<pre>{highlightCode(code, lang)}</pre>);
  return [...container.querySelectorAll('span')].map((el) => el.className);
}

describe('★ 极简代码高亮', () => {
  it('TS：关键字 / 字符串 / 数字 / 注释分别着色', () => {
    const cls = classes('const x = "s"; // note\nconst n = 42;', 'ts');
    expect(cls.some((c) => c.includes('text-sky-300'))).toBe(true);
    expect(cls.some((c) => c.includes('text-green-300'))).toBe(true);
    expect(cls.some((c) => c.includes('text-amber-300'))).toBe(true);
    expect(cls.some((c) => c.includes('italic'))).toBe(true);
  });

  it('JSON：key 与字符串值分开；true 是关键字', () => {
    const cls = classes('{"a": "b", "on": true}', 'json');
    expect(cls).toContain('text-sky-300');
    expect(cls).toContain('text-green-300');
  });

  it('Bash：关键字 / 字符串 / 变量', () => {
    const cls = classes('if [ "$x" = 1 ]; then echo $HOME; fi', 'sh');
    expect(cls.some((c) => c.includes('text-purple-300'))).toBe(true);
    expect(cls.some((c) => c.includes('text-sky-300'))).toBe(true);
  });

  it('★ 不认识的语言 → 原样文本，不崩、不误着色', () => {
    const { container } = render(<pre>{highlightCode('some <weird> text', 'brainfuck')}</pre>);
    expect(container.querySelectorAll('span')).toHaveLength(0);
    expect(container.textContent).toBe('some <weird> text');
  });
});
