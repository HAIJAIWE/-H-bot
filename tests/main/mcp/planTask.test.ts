// tests/main/mcp/planTask.test.ts
//
// # MCP 专属工具 plan_task（多智能体对外暴露）
//
// 外部 IDE 只读地拿到"计划 + 侦察事实"，**不执行、不产生提案**。
//
// ⚠️ **本构建（10/18 04:50 打包）没有 plan_task**：已核实两个产物
// （out/main/index.js 与 renderer-index.js）都不含这个字符串，src 里也只有
// planner.ts / scout.ts（规划与侦察的实现），没有把它们包成 MCP 工具的模块。
// 也就是说这条测试来自 10/18 之后的 revision。移植 plan_task 时把 describe.skip 改回来。
//
// 顺带说明：第三个用例（"缺 requirement ⇒ isError"）以前在工具**不存在**时也会通过
// （未知工具本来就回 isError）—— 那是假阳性，所以整组一起跳过，不单独留着装绿。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAllWindows, planMock, scoutMock, resolveConfigMock } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn((): unknown[] => []),
  planMock: vi.fn(),
  scoutMock: vi.fn(),
  resolveConfigMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
  app: {
    getPath: vi.fn(() => '/mock'),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false,
    getName: vi.fn(() => 'qqbat'),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@main/services/ai/appAiConfig', () => ({ resolveAuthorAiConfig: resolveConfigMock }));
vi.mock('@main/services/ai/planner', () => ({ planWithModel: planMock }));
vi.mock('@main/services/ai/scout', () => ({
  scoutWithModel: scoutMock,
  renderFindings: (f: { findings: string[] }) => '侦察：' + f.findings.join(' / '),
}));

import { createMcpServer } from '@main/mcp/server';

beforeEach(() => {
  planMock.mockReset();
  scoutMock.mockReset();
  resolveConfigMock.mockReset();
});

describe.skip('★ plan_task：只给计划，不动手（本构建未移植，见文件头）', () => {
  it('工具列表里有 plan_task', () => {
    const server = createMcpServer({ projectPath: '/p' });
    expect(server.getTools()).toContain('plan_task');
  });

  it('★ 返回计划 + 侦察事实，但不执行任何工具', async () => {
    resolveConfigMock.mockResolvedValue({ provider: 'glm', apiKey: 'k', model: 'm' });
    scoutMock.mockResolvedValue({ findings: ['已有 /签到'], by: 'llm' });
    planMock.mockResolvedValue({
      goal: '给 /签到 加三档',
      steps: [{ intent: '查片段', tools: ['list_templates'] }],
      risks: [],
      by: 'llm',
    });

    const server = createMcpServer({ projectPath: '/p' });
    const res = await server.callTool('plan_task', { requirement: '给签到加三档奖励' });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('planned');
    expect(text).toContain('给 /签到 加三档');
    expect(text).toContain('已有 /签到');
    // 侦察事实被拼进规划输入
    expect(planMock.mock.calls[0][0].brief).toContain('已有 /签到');
  });

  it('缺 requirement / 没配模型 / 计划解析失败 ⇒ 明确 isError', async () => {
    const server = createMcpServer({ projectPath: '/p' });
    expect((await server.callTool('plan_task', {})).isError).toBe(true);

    resolveConfigMock.mockResolvedValue(null);
    expect((await server.callTool('plan_task', { requirement: 'x' })).isError).toBe(true);

    resolveConfigMock.mockResolvedValue({ provider: 'glm', apiKey: 'k', model: 'm' });
    scoutMock.mockResolvedValue(null);
    planMock.mockResolvedValue(null);
    expect((await server.callTool('plan_task', { requirement: 'x' })).isError).toBe(true);
  });
});
