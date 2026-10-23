// tests/main/services/flow/turnJournal.test.ts
//
// # 轮次日志（turnJournal）：一份"能撤回"的镜像
//
// 这里钉的是**语义**，不是实现顺序：
//   · 每个轮次记的是「改动之前的原样」（before），不是 diff；
//   · 没有改动的一轮**不落盘**（否则「撤回上一轮」列表里全是空轮）；
//   · 回滚 = 按 before 写回、原本不存在的删掉、连同 flow.json 与 data/ 一起还原。
//
// 为什么这些用例值钱：撤回是"数据可能没了"的最后一道保险。
// before 记错一个字节，用户点撤回就是**用错误内容覆盖正确文件** —— 比不撤回更糟。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lineDiffCounts,
  turnsDir,
  turnFile,
  nextId,
  beginTurn,
  currentTurnId,
  peekTurn,
  _resetRunningTurns,
  recordFileBefore,
  endTurn,
  listTurns,
  readTurn,
  rollbackTurn,
  snapshotBeforeRun,
  MAX_DIFF_LINES,
} from '@main/services/flow/turnJournal';

let project: string;

beforeEach(async () => {
  _resetRunningTurns();
  project = await mkdtemp(join(tmpdir(), 'qqbat-turnjournal-'));
  await mkdir(join(project, '.qqbat'), { recursive: true });
});

afterEach(async () => {
  _resetRunningTurns();
  await rm(project, { recursive: true, force: true });
});

async function writeFlow(): Promise<void> {
  await writeFile(
    join(project, '.qqbat', 'flow.json'),
    JSON.stringify({ schemaVersion: '1.1', nodes: [{ id: 'n1' }], edges: [] }),
    'utf-8',
  );
}

describe('lineDiffCounts：行数差必须准，不能"差不多"', () => {
  it('两份完全一样 ⇒ 0 / 0 / exact', () => {
    expect(lineDiffCounts('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0, exact: true });
  });

  it('空文件是 0 行（不是 1 行）', () => {
    expect(lineDiffCounts('', '')).toEqual({ added: 0, removed: 0, exact: true });
    expect(lineDiffCounts('', 'a')).toEqual({ added: 1, removed: 0, exact: true });
  });

  it('结尾换行不多算一行', () => {
    expect(lineDiffCounts('a', 'a\n')).toEqual({ added: 0, removed: 0, exact: true });
    expect(lineDiffCounts('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0, exact: true });
  });

  it('纯追加 / 纯删除', () => {
    expect(lineDiffCounts('a\n', 'a\nb\nc\n')).toEqual({ added: 2, removed: 0, exact: true });
    expect(lineDiffCounts('a\nb\nc\n', 'a\n')).toEqual({ added: 0, removed: 2, exact: true });
  });

  it('改动中间一行 ⇒ 1 加 1 删（不是整段重写）', () => {
    expect(lineDiffCounts('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1, exact: true });
  });

  it('★ 超过 MAX_DIFF_LINES 就"不假装精确"：0 / 0 / exact=false', () => {
    const many = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => 'l' + i).join('\n');
    expect(lineDiffCounts(many, many + '\nx')).toEqual({ added: 0, removed: 0, exact: false });
    // 另一侧超限同样放弃
    expect(lineDiffCounts('x', many)).toEqual({ added: 0, removed: 0, exact: false });
  });
});

describe('轮次 id 与目录：可排序、路径可预测', () => {
  it('id 递增且可按字符串排序（"最近一轮"依赖这一点）', () => {
    const a = nextId();
    const b = nextId();
    expect(a < b).toBe(true);
    // 不含冒号/点：Windows 文件名里不允许
    expect(a).not.toMatch(/[:.]/);
  });

  it('目录固定为 .qqbat/history/turns，文件名为 <id>.json', () => {
    expect(turnsDir(project)).toBe(join(project, '.qqbat', 'history', 'turns'));
    expect(turnFile(project, 't1')).toBe(join(project, '.qqbat', 'history', 'turns', 't1.json'));
  });
});

describe('begin → record → end：记的是"改动之前"', () => {
  it('★ before 存的是原内容，不是改完的内容', async () => {
    await writeFile(join(project, 'a.ts'), 'OLD\n', 'utf-8');
    const id = await beginTurn(project, '把 a.ts 改成 NEW');
    await recordFileBefore(project, 'a.ts');
    // 模拟渲染层真的落盘
    await writeFile(join(project, 'a.ts'), 'NEW\n', 'utf-8');
    await endTurn(project, { hadChanges: true });

    const raw = JSON.parse(await readFile(turnFile(project, id), 'utf-8'));
    expect(raw.userMessage).toBe('把 a.ts 改成 NEW');
    expect(raw.files).toEqual([{ path: 'a.ts', before: 'OLD\n' }]);
    expect(currentTurnId(project)).toBeNull();
  });

  it('beginTurn 快照 flow.json（回滚时要能还原画布）', async () => {
    await writeFlow();
    const id = await beginTurn(project, 'x');
    const turn = peekTurn(project);
    expect(turn?.id).toBe(id);
    expect(turn?.flowBefore).toContain('"schemaVersion"');
  });

  it('项目里没有 flow.json ⇒ flowBefore = null（回滚按"原本没有"处理）', async () => {
    await beginTurn(project, 'x');
    expect(peekTurn(project)?.flowBefore).toBeNull();
  });

  it('userMessage 截到 200 字（别让历史目录被超长 prompt 撑爆）', async () => {
    const id = await beginTurn(project, 'x'.repeat(500));
    await endTurn(project, { hadChanges: true });
    const raw = JSON.parse(await readFile(turnFile(project, id), 'utf-8'));
    expect(raw.userMessage).toHaveLength(200);
  });

  it('重复记同一个文件只算一次（多工具改同一文件）', async () => {
    await writeFile(join(project, 'a.ts'), '1\n', 'utf-8');
    await beginTurn(project, 'x');
    await recordFileBefore(project, 'a.ts');
    await writeFile(join(project, 'a.ts'), '2\n', 'utf-8');
    await recordFileBefore(project, 'a.ts');
    expect(peekTurn(project)?.files).toHaveLength(1);
    // 记的是第一次那份（最早的"改动之前"）
    expect(peekTurn(project)?.files?.[0]?.before).toBe('1\n');
  });

  it('路径归一化：Windows 反斜杠与 ./ 前缀与正斜杠是同一条记录', async () => {
    await writeFile(join(project, 'sub', '__d'), '', 'utf-8').catch(async () => {
      await mkdir(join(project, 'sub'), { recursive: true });
      await writeFile(join(project, 'sub', 'a.ts'), 'x', 'utf-8');
    });
    await mkdir(join(project, 'sub'), { recursive: true });
    await writeFile(join(project, 'sub', 'a.ts'), 'x', 'utf-8');
    await beginTurn(project, 'x');
    await recordFileBefore(project, '.\\sub\\a.ts');
    await recordFileBefore(project, 'sub/a.ts');
    expect(peekTurn(project)?.files?.map((f: { path: string }) => f.path)).toEqual(['sub/a.ts']);
  });

  it('越界路径被跳过（不因为记日志失败就挡住写入）', async () => {
    await beginTurn(project, 'x');
    await recordFileBefore(project, '../outside.ts');
    expect(peekTurn(project)?.files).toEqual([]);
  });

  it('没有进行中的轮次时静默跳过（手工改文件不受影响）', async () => {
    await recordFileBefore(project, 'a.ts');
    expect(currentTurnId(project)).toBeNull();
  });
});

describe('endTurn：没有改动的一轮不落盘', () => {
  it('★ 空轮 + hadChanges=false ⇒ 不进历史（撤回列表里不该有空格子）', async () => {
    await beginTurn(project, '只是问了个问题');
    await endTurn(project, { hadChanges: false });
    expect(await listTurns(project)).toEqual([]);
    expect(existsSync(turnsDir(project))).toBe(false);
  });

  it('空轮但 hadChanges=true ⇒ 落盘（提案模式：改动等用户确认）', async () => {
    await beginTurn(project, '提出两个操作');
    await endTurn(project, { hadChanges: true });
    const turns = await listTurns(project);
    expect(turns).toHaveLength(1);
    expect(turns[0].fileCount).toBe(0);
  });

  it('没有进行中的轮次时 endTurn 返回 null（重复收尾不报错）', async () => {
    expect(await endTurn(project, { hadChanges: true })).toBeNull();
  });

  it('listTurns 新的在前', async () => {
    await beginTurn(project, '第一轮');
    await endTurn(project, { hadChanges: true });
    await new Promise((r) => setTimeout(r, 5));
    await beginTurn(project, '第二轮');
    await endTurn(project, { hadChanges: true });
    const turns = await listTurns(project);
    expect(turns.map((t) => t.userMessage)).toEqual(['第二轮', '第一轮']);
  });
});

describe('readTurn：预览要能说清"撤了会变成什么样"', () => {
  it('新文件 ⇒ kind=added；改过的 ⇒ kind=modified；被删的 ⇒ kind=removed', async () => {
    await writeFile(join(project, 'keep.ts'), 'a\n', 'utf-8');
    await writeFile(join(project, 'gone.ts'), 'x\n', 'utf-8');
    const id = await beginTurn(project, 'x');
    await recordFileBefore(project, 'keep.ts');
    await recordFileBefore(project, 'gone.ts');
    await recordFileBefore(project, 'new.ts');
    await writeFile(join(project, 'keep.ts'), 'a\nb\n', 'utf-8');
    await rm(join(project, 'gone.ts'));
    await writeFile(join(project, 'new.ts'), 'n1\nn2\n', 'utf-8');
    await endTurn(project, { hadChanges: true });

    const view = await readTurn(project, id);
    expect(view?.restore).toEqual(['keep.ts', 'gone.ts']);
    expect(view?.remove).toEqual(['new.ts']);
    const byPath = Object.fromEntries((view?.changes ?? []).map((c) => [c.path, c]));
    expect(byPath['keep.ts']).toMatchObject({ kind: 'modified', added: 1, removed: 0, exact: true });
    expect(byPath['gone.ts']).toMatchObject({ kind: 'removed', removed: 1 });
    expect(byPath['new.ts']).toMatchObject({ kind: 'added', added: 2 });
    expect(view?.data).toBe(false);
  });

  it('轮次文件不存在 ⇒ null（UI 里点了一条已被撤的轮次）', async () => {
    expect(await readTurn(project, 'missing-id')).toBeNull();
  });
});

describe('rollbackTurn：撤回要把文件、画布、数据一起还原', () => {
  it('★ 改过的写回 before、新建的删掉、flow.json 一并还原', async () => {
    await writeFlow();
    const flowBefore = await readFile(join(project, '.qqbat', 'flow.json'), 'utf-8');
    await writeFile(join(project, 'a.ts'), 'OLD\n', 'utf-8');
    const id = await beginTurn(project, 'x');
    await recordFileBefore(project, 'a.ts');
    await recordFileBefore(project, 'brand-new.ts');
    await writeFile(join(project, 'a.ts'), 'NEW\n', 'utf-8');
    await writeFile(join(project, 'brand-new.ts'), 'n\n', 'utf-8');
    await writeFile(join(project, '.qqbat', 'flow.json'), '{"nodes":[]}', 'utf-8');
    await endTurn(project, { hadChanges: true });

    const res = await rollbackTurn(project, id);
    expect(res.restored).toEqual(['a.ts']);
    expect(res.removed).toEqual(['brand-new.ts']);
    expect(await readFile(join(project, 'a.ts'), 'utf-8')).toBe('OLD\n');
    expect(existsSync(join(project, 'brand-new.ts'))).toBe(false);
    /**
     * flow.json **不在磁盘上还原**：快照是"文件内容"，但画布是有状态的编辑器 ——
     * 直接改盘上的 flow.json 会让画布与磁盘打架（下一次保存又把旧的写回去）。
     * 所以这里只把快照**交回调用方**（ipc/ai.ts:333 的日志写的是"已交回渲染层"），
     * 由渲染层套进画布、走正常的保存路径。
     */
    expect(res.flowSnapshot).toBe(flowBefore);
    expect(await readFile(join(project, '.qqbat', 'flow.json'), 'utf-8')).toBe('{"nodes":[]}');
  });

  it('撤完就删掉轮次文件（同一轮不能撤两次覆盖更早状态）', async () => {
    const id = await beginTurn(project, 'x');
    await recordFileBefore(project, 'a.ts');
    await endTurn(project, { hadChanges: true });
    await rollbackTurn(project, id);
    expect(existsSync(turnFile(project, id))).toBe(false);
    expect(await listTurns(project)).toEqual([]);
  });

  it('快照过 data/ 的轮次：撤的时候整目录还原（含"快照里有、现在被删"的文件）', async () => {
    await mkdir(join(project, 'data'), { recursive: true });
    await writeFile(join(project, 'data', 'players.json'), '{"coins":1}', 'utf-8');
    const id = await beginTurn(project, '运行一下');
    expect(await snapshotBeforeRun(project, '运行检查点')).toBe(true);
    // 运行期间改了数据、又新增一个文件
    await writeFile(join(project, 'data', 'players.json'), '{"coins":999}', 'utf-8');
    await writeFile(join(project, 'data', 'extra.json'), '{}', 'utf-8');
    await endTurn(project, { hadChanges: true });

    const res = await rollbackTurn(project, id);
    expect(res.restoredData).toBe(true);
    expect(await readFile(join(project, 'data', 'players.json'), 'utf-8')).toBe('{"coins":1}');
    expect(existsSync(join(project, 'data', 'extra.json'))).toBe(false);
  });

  it('没有进行中的轮次时 snapshotBeforeRun 自建"运行检查点"并立刻落盘', async () => {
    await mkdir(join(project, 'data'), { recursive: true });
    await writeFile(join(project, 'data', 'x.json'), '1', 'utf-8');
    const ok = await snapshotBeforeRun(project, '运行检查点');
    expect(ok).toBe(true);
    const turns = await listTurns(project);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe('运行检查点');
    expect(turns[0].fileCount).toBe(0);
    expect(await stat(join(turnsDir(project), turns[0].id, 'data', 'x.json')).then(() => true)).toBe(true);
  });

  it('没有 data/ 时返回 false（这次运行不可撤回），但"运行过"这件事仍然留下检查点', async () => {
    expect(await snapshotBeforeRun(project, '运行检查点')).toBe(false);
    const turns = await listTurns(project);
    expect(turns).toHaveLength(1);
    expect(turns[0].fileCount).toBe(0);
    // 空检查点撤了也什么都不做 —— 但它让"我运行过"在历史里可见
    expect(await readTurn(project, turns[0].id)).toMatchObject({ data: false, changes: [] });
  });
});
