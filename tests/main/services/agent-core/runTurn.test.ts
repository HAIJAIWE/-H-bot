// tests/main/services/agent-core/runTurn.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentTurn } from '@main/services/agent-core/runTurn';

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never;

describe('★ 总入口：模型 → 工具 → 落盘（默认拒绝写）', () => {
  it('★ 默认审批拒绝：模型想写也写不进去', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } }]);
      cb.onComplete('');
    }) as never;
    const r = await runAgentTurn({ projectPath: ws, requirement: '写文件', config, call, maxRounds: 1 });
    expect(r.toolResults[0].output).toContain('失败');
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow();
  });

  it('★ requirement 与系统提示真的进了第一轮请求（真机 400 的那个 bug）', async () => {
    // 第一版循环从空 messages 起步 —— 真机第一轮就被厂商 400 拒掉（last message role）。
    // 单测里模型是假的，所以只有这条断言能把它钉住。
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    let first: any[] = [];
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m;
      cb.onComplete('ok');
    }) as never;
    await runAgentTurn({
      projectPath: ws,
      requirement: '读一下 project.json',
      config,
      call,
      maxRounds: 1,
    });
    expect(first[0].role).toBe('system');
    expect(first[0].content).toContain(ws);
    expect(first[1]).toEqual({ role: 'user', content: '读一下 project.json' });
  });

  it('★ 跨轮记忆：历史拼在系统提示之后、本轮要求之前（顺序错了模型会以为那是刚说的）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    let first: any[] = [];
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m;
      cb.onComplete('ok');
    }) as never;
    await runAgentTurn({
      projectPath: ws,
      requirement: '这一轮继续',
      config,
      call,
      maxRounds: 1,
      history: [
        { role: 'user', content: '上一轮问的' },
        { role: 'assistant', content: '上一轮答的' },
      ],
      historyNote: '更早的 3 条已省略',
    });
    expect(first.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    // 裁掉的旧记忆要交代一句（不许静默）
    expect(first[0].content).toContain('更早的 3 条已省略');
    expect(first[3].content).toBe('这一轮继续');
  });

  it('★ 角色说明进系统提示，且排在历史交代之前（先"你是谁"再"你看不到什么"）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    let first: any[] = [];
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m;
      cb.onComplete('ok');
    }) as never;
    await runAgentTurn({
      projectPath: ws,
      requirement: '加个夜巡签到',
      config,
      call,
      maxRounds: 1,
      roleNote: '你是搭建者：只能改流程，不许改源码。',
      historyNote: '更早的 2 条已省略',
    });
    const sys = first[0].content as string;
    expect(sys).toContain('你是搭建者');
    expect(sys.indexOf('你是搭建者')).toBeLessThan(sys.indexOf('更早的 2 条已省略'));
    expect(first[1]).toEqual({ role: 'user', content: '加个夜巡签到' });
  });

  it('★ 先计划：写/命令在这一轮**工具列表里不存在**，且提示交代了计划阶段', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    let first: any[] = [];
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m;
      // 模型硬要写：这一轮它应该只拿到"未知工具"
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } }]);
      cb.onComplete('');
    }) as never;
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '先计划一下怎么加签到',
      config,
      call,
      maxRounds: 1,
      planOnly: true,
    });
    expect(r.toolResults[0].output).toContain('未知工具');
    expect(first[0].content).toContain('计划阶段');
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow();
  });

  it('★ onToolStart / onToolEnd 真的接到循环上（界面靠它摆工具行）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    await writeFile(join(ws, 'a.txt'), 'hello', 'utf-8');
    const events: string[] = [];
    let round = 0;
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      round += 1;
      if (round === 1) {
        cb.onToolCalls([{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }]);
        cb.onComplete('');
        return;
      }
      cb.onComplete('ok');
    }) as never;
    await runAgentTurn({
      projectPath: ws,
      requirement: '读文件',
      config,
      call,
      onToolStart: (c) => events.push('start:' + c.name),
      onToolEnd: (_c, output) => events.push('end:' + output.slice(0, 5)),
    });
    expect(events).toEqual(['start:read_file', 'end:hello']);
  });

  it('★ 显式放行后：写 → 再读回（完整一轮）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'));
    await mkdir(join(ws, '.qqbat'), { recursive: true });
    await writeFile(join(ws, 'a.txt'), 'hello', 'utf-8');
    let round = 0;
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      round += 1;
      if (round === 1) {
        cb.onToolCalls([{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }]);
        cb.onComplete('');
        return;
      }
      cb.onComplete('读到了 hello');
    }) as never;
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '读文件',
      config,
      call,
      approval: async () => true,
    });
    expect(r.finalText).toBe('读到了 hello');
    expect(r.toolResults[0].output).toContain('hello');
    expect(r.phase).toEqual({ kind: 'finished', reason: 'completed' });
  });
});
