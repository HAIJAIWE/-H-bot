// tests/main/services/ai/liveModel.e2e.test.ts
//
// **实盘测试**：拿真模型跑真项目。默认跳过，只有设了环境变量才跑：
//
//   $env:QWEN_API_KEY = "<key>"
//   $env:QWEN_BASE_URL = "https://maas.qianwenaiapi.com/compatible-mode/v1"   # 可选
//   $env:QWEN_MODEL    = "qwen3.8-27b"                                        # 可选
//   $env:QWEN_PROJECT  = "D:/QQ bot/projects/RPG测试项目"                       # 可选（要真存在）
//   node node_modules/vitest/vitest.mjs run tests/main/services/ai/liveModel.e2e.test.ts
//
// ## 为什么必须是"真跑"而不是再加几个单测
//
// 本仓库反复吃过的教训：**静态看没问题 ≠ 能干活**。
// 智能体的提示词/工具/记忆在单测和真项目闸门里都是绿的，但 **LLM 端到端从没跑过** ——
// 于是"模型拿到这份提示词之后到底会不会按预期行动"从来没有被验证过。
// 这个文件就是补这一条。
//
// ## 为什么不把密钥写进 .qqbat/project.json
//
// 那个文件里的 `ai.apiKey` 走应用的 `safeStorage`（DPAPI）加密路径；
// 手写进去是**明文**，等于绕过加密。密钥留在环境变量里，不落盘。
//
// ## 恢复说明（2026-10-23）
// 10/18 产物里没有测试源码，磁带里这个文件只有头 44 行 + 尾段（中间 100 行丢失）。
// 原文件里那两个"真项目大任务"用例（44 节点链 / 几分钟级）无法还原其断言基线，这里只保留
// 一条**不会骗人**的冒烟：真模型能回话、事件真的发出来、提案里的 nodeKind 都真实存在。
// 拿到原文后再补回大任务用例。
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { processAiChat, setAiConfig } from '@main/services/ai/index';
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog';

const API_KEY = process.env.QWEN_API_KEY;
const BASE_URL = process.env.QWEN_BASE_URL ?? 'https://maas.qianwenaiapi.com/compatible-mode/v1';
const MODEL = process.env.QWEN_MODEL ?? 'qwen3.7-flash-2026-07-15';
/**
 * 默认**关掉思考**。
 *
 * 实测（qwen3.7-flash）：同一个问题开思考 10.1s / 732 输出 token，关掉 0.8s / 30 ——
 * 快 12.6 倍、输出 token 少 24 倍。智能体在真项目上要跑十几轮，这个差距是"能不能用"级别的。
 * 想对照开思考的版本：设 `QWEN_ENABLE_THINKING=1`。
 */
const DISABLE_THINKING = process.env.QWEN_ENABLE_THINKING !== '1';
const PROJECT = process.env.QWEN_PROJECT ?? 'D:/QQ bot/projects/RPG测试项目';
const hasProject = existsSync(join(PROJECT, '.qqbat', 'flow.json'));

const sent: Array<{ channel: string; payload: any }> = [];
const fakeWin = () =>
  ({
    webContents: { send: (c: string, pay: any) => sent.push({ channel: c, payload: pay }) },
    isDestroyed: () => false,
  }) as never;

describe.skipIf(!API_KEY || !hasProject)('★ 实盘：真模型 × 真项目', () => {
  it(
    '模型能回话，且事件（chunk/response/stats）真的发出来',
    async () => {
      setAiConfig({
        provider: 'openai',
        apiKey: API_KEY!,
        model: MODEL,
        baseUrl: BASE_URL,
        enableThinking: DISABLE_THINKING ? false : undefined,
      });

      sent.length = 0;
      await processAiChat(PROJECT, '用一句话说明这个项目里有哪些命令，不要改任何东西', fakeWin(), {} as never);

      const chunks = sent.filter((s) => s.channel === 'ai:chunk');
      const text = chunks.map((s) => String(s.payload?.text ?? '')).join('');
      const response = sent.find((s) => s.channel === 'ai:response');
      const stats = sent.filter((s) => s.channel === 'ai:stats');

      // ① 真模型必须真的回了字（不是空、不是一句"未配置"）
      expect(text.length, '模型一个字都没回').toBeGreaterThan(0);
      expect(text).not.toContain('AI 未配置');
      // ② 收尾事件与状态事件都在（写好了没接线是高发区）
      expect(response, '没有 ai:response').toBeTruthy();
      expect(stats.length, '没有 ai:stats').toBeGreaterThan(0);
      // ③ 真模型回传了用量 ⇒ usageReported 应该是 true（这条同时钉住"用量接线"）
      expect(stats[stats.length - 1].payload.stats.usageReported).toBe(true);

      // ④ 它如果顺手提了计划，提议的 nodeKind 必须真实存在于目录里
      const proposal = sent.find((s) => s.channel === 'ai:proposal')?.payload?.proposal;
      if (proposal) {
        const known = new Set(NODE_CATALOG_V2.map((n) => n.kind));
        for (const op of proposal.operations as Array<{ kind: string; nodeKind?: string }>) {
          if (op.kind === 'add_node' && op.nodeKind) {
            expect(known.has(op.nodeKind), `提议了不存在的 nodeKind: ${op.nodeKind}`).toBe(true);
          }
        }
      }
    },
    600_000,
  );
});