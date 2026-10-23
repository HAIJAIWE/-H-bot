// tests/main/services/bot/agentUsageAccounting.test.ts
//
// # P1-5 的运行时证据：额度真的在记账
//
// 改造前 addDailyUsage 全仓只有测试引用 —— 日额度读到的已用量恒为 0，
// 「5 万 token/天」从来没生效过（策略层看起来是开的）。
// 本用例走**真实 agent_chat handler**（真实 policy / memory / pending），
// 只把模型调用换成桩，断言 usage 文件里真的出现 150 token。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@main/services/bot/llm', () => ({
  callBotLlm: vi.fn(async () => ({
    response: '你好呀',
    error: '',
    usage: { promptTokens: 120, completionTokens: 30 },
    configSource: 'botAi',
  })),
  callBotAgent: vi.fn(async () => ({ response: '', error: '', toolCalls: [] })),
}));

import { agentChat } from '@main/services/builtinNodes/agentNodes';

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-bot-usage-'));
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
});

const fakeBot = () => ({ projectPath, callApi: vi.fn() }) as unknown as never;
const fakeEvent = () =>
  ({
    self_id: 1,
    user_id: 1001,
    group_id: 2002,
    message_type: 'group',
    raw_message: '你好',
    message: '你好',
  }) as unknown as never;

describe('★ 机器人额度记账（P1-5）', () => {
  it('★ 模型回传 usage ⇒ 当天 usage 文件记下总和（不再恒 0）', async () => {
    const r = await agentChat(fakeBot(), fakeEvent(), '你好');
    expect(r.error, r.error).toBe('');

    const date = new Date().toISOString().slice(0, 10);
    const raw = await readFile(join(projectPath, 'data', 'bot-usage', date + '.json'), 'utf-8');
    const usage = JSON.parse(raw) as Record<string, number>;
    const total = Object.values(usage).reduce((a, b) => a + b, 0);
    expect(total, '120 prompt + 30 completion 必须被记下').toBe(150);
  });
});
