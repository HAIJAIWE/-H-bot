// tests/main/schemas/aiChatSchema.test.ts
//
// # 闸门：**渲染层能选的每个 mode，主进程 schema 都必须接受**
//
// 2026-10-15 真机事故：给助手加了「🔀 双向」= duo，渲染层类型、preload、ChatPanel 都改了，
// 唯独漏了主进程的 aiChatSchema（z.enum 只认 blocks|code）→ 双向模式下发送被**静默拒绝**
// （返回 {ok:false}）：界面一直转圈、主进程日志里一条请求都没有。
//
// 既有闸门抓不到它：能力分层那条只对账**形参**，不看**枚举取值**。所以补这一条。
// ⚠️ 以后再加 mode，先改这里（它就是那条漏网的值域契约）。
import { describe, it, expect } from 'vitest';
import { aiChatSchema } from '@main/schemas/ai';
import type { AgentMode } from '@shared/ai/roleDomains';

/** 与 @shared/ai/roleDomains 的 AgentMode 保持一致（**四档**，2026-10-15 加 creator） */
const AGENT_MODES = ['blocks', 'code', 'duo', 'creator'] as const;
/** 编译期穷尽：两侧集合必须完全一致（谁多一个值都不编译） */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const MODES_MATCH: Same<(typeof AGENT_MODES)[number], AgentMode> = true;

const base = { projectPath: '/proj', message: '你好' };

describe('aiChatSchema', () => {
  it('mode 枚举与渲染层四档一一对应（编译期穷尽）', () => {
    expect(MODES_MATCH).toBe(true);
    expect(new Set(AGENT_MODES).size).toBe(AGENT_MODES.length);
  });

  it('★ 每个 mode 都被接受（漏一个就是「双向/创作模式发不出去」那个事故）', () => {
    for (const mode of AGENT_MODES) {
      const r = aiChatSchema.safeParse({ ...base, mode });
      expect(r.success, `mode=${mode}`).toBe(true);
    }
  });

  it('不传 mode 仍然接受（老客户端 / 默认按低代码）', () => {
    expect(aiChatSchema.safeParse(base).success).toBe(true);
  });

  it('未知 mode 被拒（加档位却忘了改 schema 时，这条会红）', () => {
    const r = aiChatSchema.safeParse({ ...base, mode: 'roam' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].code).toMatch(/^invalid/);
  });

  it('projectPath 允许空串（开荒模式：还没有任何项目）', () => {
    expect(aiChatSchema.safeParse({ projectPath: '', message: '帮我建一个项目' }).success).toBe(true);
  });

  it('message 允许空串（只贴一张图直接发）', () => {
    const r = aiChatSchema.safeParse({ ...base, message: '', images: ['data:image/png;base64,AAA'] });
    expect(r.success).toBe(true);
  });

  it('threadId 只认字母数字与 - _（会拼进文件名）', () => {
    expect(aiChatSchema.safeParse({ ...base, threadId: 'turn-1_A' }).success).toBe(true);
    for (const bad of ['../x', 'a b', 'a/b', '']) {
      expect(aiChatSchema.safeParse({ ...base, threadId: bad }).success, bad).toBe(false);
    }
  });

  it('images 只收 data URL，最多 4 张', () => {
    const ok = 'data:image/png;base64,AAA';
    expect(aiChatSchema.safeParse({ ...base, images: [ok, ok, ok, ok] }).success).toBe(true);
    expect(aiChatSchema.safeParse({ ...base, images: [ok, ok, ok, ok, ok] }).success).toBe(false);
    expect(aiChatSchema.safeParse({ ...base, images: ['https://x/y.png'] }).success).toBe(false);
  });

  it('activeFilePath 不做格式约束（空串 / 绝对路径都收，规范化在消费端）', () => {
    for (const v of ['', '/abs/path.ts', '../escape.ts', 'a\nb']) {
      expect(aiChatSchema.safeParse({ ...base, activeFilePath: v }).success, JSON.stringify(v)).toBe(true);
    }
  });

  it('缺 projectPath / message 被拒（字段本身必填，只是允许空串）', () => {
    expect(aiChatSchema.safeParse({ message: 'x' }).success).toBe(false);
    expect(aiChatSchema.safeParse({ projectPath: '/p' }).success).toBe(false);
  });
});
