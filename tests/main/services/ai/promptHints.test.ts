// tests/main/services/ai/promptHints.test.ts
//
// # 两件提示小件：贴图留痕 / 「当前打开的文件」
//
// 这两段字会直接进系统提示，所以规则就两条：**该加的时候加对**、
// **拿不准就一个字都别加**（提示里出现空路径或假路径比没有更糟）。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeFileHintFor, withImageNote, MAX_ROUND_IMAGES } from '@main/services/ai/promptHints';

const dirs: string[] = [];
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qqbat-hints-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('withImageNote（图不落盘，只在记忆里留一句）', () => {
  it('没图就原样返回', () => {
    expect(withImageNote('改一下', 0)).toBe('改一下');
  });

  it('★ 有图时追加一句、带张数', () => {
    const text = withImageNote('你看这是怎么回事', 2);
    expect(text.startsWith('你看这是怎么回事')).toBe(true);
    expect(text).toContain('附了 2 张图');
    expect(text).toContain('仅那一轮可见');
  });

  it('界面侧的张数上限与主进程一致', () => {
    expect(MAX_ROUND_IMAGES).toBe(4);
  });
});

describe('activeFileHintFor（谁"这个文件"指谁）', () => {
  it('★ 代码页/双向 + 文件真在 → 给出可执行的一句话', () => {
    const dir = project();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    for (const role of ['coder', 'duo'] as const) {
      const hint = activeFileHintFor(role, dir, 'src/a.ts');
      expect(hint).toContain('src/a.ts');
      expect(hint).toContain('不要再反问');
    }
  });

  it('★ 低代码/创作角色不写源码 → 不吭声（避免引它去动代码）', () => {
    const dir = project();
    writeFileSync(join(dir, 'a.ts'), 'x');
    for (const role of ['builder', 'creator'] as const) {
      expect(activeFileHintFor(role, dir, 'a.ts')).toBe('');
    }
  });

  it('路径反斜杠归一成 /（Windows 渲染层传的就是反斜杠）', () => {
    const dir = project();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'x');
    expect(activeFileHintFor('coder', dir, 'src\\a.ts')).toContain('src/a.ts');
  });

  it('★ 拿不准就一个字都不加：空 / 空项目 / 绝对路径 / 越界 / 换行 / 超长 / 不存在', () => {
    const dir = project();
    writeFileSync(join(dir, 'a.ts'), 'x');
    expect(activeFileHintFor('coder', dir, '')).toBe('');
    expect(activeFileHintFor('coder', dir, '   ')).toBe('');
    expect(activeFileHintFor('coder', '', 'a.ts')).toBe('');
    expect(activeFileHintFor('coder', dir, '/etc/passwd')).toBe('');
    expect(activeFileHintFor('coder', dir, 'D:/p/a.ts')).toBe('');
    expect(activeFileHintFor('coder', dir, '../a.ts')).toBe('');
    expect(activeFileHintFor('coder', dir, 'src/../../a.ts')).toBe('');
    expect(activeFileHintFor('coder', dir, 'a.ts\nb.ts')).toBe('');
    expect(activeFileHintFor('coder', dir, `a${String.fromCharCode(96)}b.ts`)).toBe('');
    expect(activeFileHintFor('coder', dir, 'x'.repeat(301))).toBe('');
    // 文件被删/改名后别再指着它
    expect(activeFileHintFor('coder', dir, 'gone.ts')).toBe('');
  });
});
