// tests/main/runtime/waitPersistence.test.ts
//
// # P2-2：挂起表要能跨重启
//
// 之前 waitRegistry 是纯内存 Map —— 崩溃/强退后，等待中的链**静默消失**：
// 下游既收不到超时分支，也再不会被唤醒。本用例钉住落盘与恢复。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _resetWaitsForTesting,
  clearWaits,
  listWaits,
  matchWait,
  registerWait,
  restoreWaitsFor,
  saveWaitsFor,
  waitsFilePath,
} from '@main/runtime/waitRegistry';

let projectPath: string;

beforeEach(async () => {
  _resetWaitsForTesting();
  projectPath = await mkdtemp(join(tmpdir(), 'qqbat-wait-'));
  // 挂起表落在 <项目>/.qqbat/runtime/ 下；saveWaitsFor 不会给已删除的项目重建目录
  await mkdir(join(projectPath, '.qqbat'), { recursive: true });
});

afterEach(async () => {
  _resetWaitsForTesting();
  await rm(projectPath, { recursive: true, force: true });
});

const spec = () => ({
  projectPath,
  scope: 'trigger_user' as const,
  userId: '1001',
  chatType: 'group' as const,
  chatId: '2002',
  chainId: 'chain-1',
  waitNodeId: 'wait-1',
  resumeNodeId: 'node-received',
  timeoutNodeId: 'node-timeout',
  variables: { exp: 42 },
  timeoutMs: 60_000,
});

describe('★ 挂起表跨重启（P2-2）', () => {
  it('★ 登记 ⇒ 落盘 ⇒ 内存清空 ⇒ 恢复后仍能被唤醒', async () => {
    registerWait(spec());
    await saveWaitsFor(projectPath);
    expect(existsSync(waitsFilePath(projectPath))).toBe(true);

    // 模拟"进程没了"：内存表清空
    _resetWaitsForTesting();
    expect(listWaits(projectPath)).toHaveLength(0);

    const restored = await restoreWaitsFor(projectPath);
    expect(restored).toBe(1);

    const hit = matchWait({ projectPath, userId: '1001', chatType: 'group', chatId: '2002' });
    expect(hit, '恢复出来的等待必须还能被同一个人唤醒').toBeTruthy();
    expect(hit!.variables).toEqual({ exp: 42 });
    expect(hit!.resumeNodeId).toBe('node-received');
  });

  it('★ 恢复时跳过坏记录（缺 id / 越界路径），不让一条脏数据毁掉整张表', async () => {
    registerWait(spec());
    await saveWaitsFor(projectPath);
    const raw = JSON.parse(await readFile(waitsFilePath(projectPath), 'utf-8'));
    const dirty = [...raw, { id: 123 }, { id: 'x', projectPath: '/other', chainId: 'c', resumeNodeId: 'n', deadline: 1, createdAt: 1 }];
    // 测试里直接写盘即可（这里要造的是"脏文件"，不需要走生产的 atomicWrite）
    await writeFile(waitsFilePath(projectPath), JSON.stringify(dirty), 'utf-8');

    _resetWaitsForTesting();
    expect(await restoreWaitsFor(projectPath)).toBe(1);
  });

  it('★ 正常停止（clearWaits）会删掉盘上的记录 —— 主动停不该在下次启动时复活', async () => {
    registerWait(spec());
    await saveWaitsFor(projectPath);
    expect(existsSync(waitsFilePath(projectPath))).toBe(true);

    clearWaits(projectPath);
    expect(existsSync(waitsFilePath(projectPath))).toBe(false);
    expect(await restoreWaitsFor(projectPath)).toBe(0);
  });
});
