// tests/main/services/ai/rag.test.ts
//
// # 长期记忆（向量检索）
//
// 只做一件确定的事：过去相似的对话轮次 → 注入上下文。
// 三条纪律：默认关、阈值过滤、失败不记（不写 0 向量污染检索）。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cosine,
  isRagEnabled,
  loadMemory,
  memoryFilePath,
  rankBySimilarity,
  recordTurnMemory,
  renderRetrieved,
  retrieveMemories,
} from '@main/services/ai/rag';

let projectPath: string;
beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-rag-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
});

/** 玩具嵌入：按关键词出现与否给一维向量，便于算相似度 */
const fakeEmbed = (text: string) => Promise.resolve([/[签]到/.test(text) ? 1 : 0, /菜单/.test(text) ? 1 : 0]);

describe('★ 长期记忆：检索、阈值、失败不记', () => {
  it('余弦相似度：同向=1、正交=0、维度不同=0（不猜）', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1], [1, 0])).toBe(0);
    expect(cosine([], [1])).toBe(0);
  });

  it('阈值 + top-k：低于阈值的不返回', () => {
    const query = [1, 0];
    const records = [
      { ts: 't1', text: '签到相关', vector: [1, 0] },
      { ts: 't2', text: '菜单相关', vector: [0, 1] },
    ];
    expect(rankBySimilarity(query, records, { minScore: 0.9 })).toHaveLength(1);
    expect(rankBySimilarity(query, records, { minScore: 0.9 })[0].text).toContain('签到');
  });

  it('★ 写一轮 ⇒ 检索得到；嵌入为空 ⇒ 不写（不污染）', async () => {
    const ok = await recordTurnMemory({
      projectPath,
      userText: '给签到加三档',
      assistantText: '已加',
      embed: fakeEmbed,
    });
    expect(ok).toBe(true);
    expect((await loadMemory(projectPath)).length).toBe(1);

    const empty = await recordTurnMemory({
      projectPath,
      userText: 'x',
      assistantText: 'y',
      embed: async () => [],
    });
    expect(empty).toBe(false);
    expect((await loadMemory(projectPath)).length).toBe(1);
  });

  it('★ 检索命中相似轮次，渲染带"可能过时"的提醒', async () => {
    await recordTurnMemory({ projectPath, userText: '签到的需求', assistantText: '结论', embed: fakeEmbed });
    const hits = await retrieveMemories({
      projectPath,
      query: '再给签到加个冷却',
      embed: fakeEmbed,
      minScore: 0.5,
    });
    expect(hits.length).toBeGreaterThan(0);
    const text = renderRetrieved(hits);
    expect(text).toContain('相关历史');
    expect(text).toContain('可能已过时');
  });

  it('默认关：只有 QQBAT_RAG=1 才开', () => {
    expect(isRagEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isRagEnabled({ QQBAT_RAG: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(memoryFilePath('/p')).toContain('vectors.jsonl');
  });
});
