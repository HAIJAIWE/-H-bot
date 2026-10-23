// tests/renderer/components/settings/GitHistoryDialog.test.tsx
//
// # 面板新增能力的验收：单删 / 多选后删 / 重命名
//
// 这三件事都是**改写用户的提交历史**，所以用例不只验"点得动"，还验：
//   · 删除是**两段式确认**（第一次点只进入确认态，不会真的删）；
//   · 单删只提交**那一条** hash，批量删提交**选中的那些**，都不多不少；
//   · 重命名把输入框里的新说明原样传下去（不是传旧值）。
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { GitHistoryDialog } from '@renderer/components/settings/GitHistoryDialog';
import { t } from '@renderer/i18n';

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const PROJECT = '/proj';
const ENTRIES = [
  { hash: 'a'.repeat(40), message: 'c1', timestamp: '2026-01-01T00:00:00.000Z' },
  { hash: 'b'.repeat(40), message: 'c2', timestamp: '2026-01-02T00:00:00.000Z' },
  { hash: 'c'.repeat(40), message: 'c3', timestamp: '2026-01-03T00:00:00.000Z' },
];

let deleteCommits: ReturnType<typeof vi.fn>;
let rewordCommit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  deleteCommits = vi.fn().mockResolvedValue({
    ok: true,
    data: {
      rewritten: 1,
      branch: 'master',
      backupRef: 'refs/qqbat/backup/x',
      worktreeDirty: false,
    },
  });
  rewordCommit = vi.fn().mockResolvedValue({
    ok: true,
    data: {
      rewritten: 1,
      branch: 'master',
      backupRef: 'refs/qqbat/backup/y',
      worktreeDirty: false,
    },
  });
  window.qqbat = {
    git: {
      status: vi.fn().mockResolvedValue({
        ok: true,
        data: { branch: 'master', commitCount: 3, clean: true, changes: [] },
      }),
      log: vi.fn().mockResolvedValue({ ok: true, data: ENTRIES }),
      diff: vi.fn().mockResolvedValue({ ok: true, data: { files: [], patch: '' } }),
      deleteCommits,
      rewordCommit,
    },
  } as never;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as never as { qqbat?: unknown }).qqbat;
});

const short = (h: string) => h.slice(0, 7);
/** 展开某一行的 diff 区（展开按钮的 aria-label 里带短 hash） */
function expand(hash: string) {
  fireEvent.click(screen.getByLabelText(t('settings.git.viewDiffAria', { hash: short(hash) })));
}

describe('★ Git 历史面板：单删 / 批量删 / 重命名', () => {
  it('★ 每条提交都有一个选择框（批量删的入口）', async () => {
    render(<GitHistoryDialog open onClose={() => {}} projectPath={PROJECT} />);
    for (const e of ENTRIES) {
      await waitFor(() =>
        expect(
          screen.getByLabelText(t('settings.git.selectCommitAria', { hash: short(e.hash) })),
        ).toBeInTheDocument(),
      );
    }
  });

  it('★ 单删是两段式：第一次点只进确认态，不会真删', async () => {
    render(<GitHistoryDialog open onClose={() => {}} projectPath={PROJECT} />);
    const hash = ENTRIES[0].hash;
    await waitFor(() => expect(screen.getByText('c1')).toBeInTheDocument());

    expand(hash);
    fireEvent.click(screen.getByLabelText(t('settings.git.deleteCommitAria', { hash: short(hash) })));
    // 第一下：只换文案
    await waitFor(() =>
      expect(screen.getByText(t('settings.git.deleteCommitConfirm'))).toBeInTheDocument(),
    );
    expect(deleteCommits, '第一次点绝不该真的删').not.toHaveBeenCalled();

    // 第二下：只提交这一条
    fireEvent.click(screen.getByLabelText(t('settings.git.deleteCommitAria', { hash: short(hash) })));
    await waitFor(() => expect(deleteCommits).toHaveBeenCalledWith(PROJECT, [hash]));
  });

  it('★ 批量删只提交选中的那些（不多不少），同样两段式', async () => {
    render(<GitHistoryDialog open onClose={() => {}} projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText('c3')).toBeInTheDocument());

    for (const e of ENTRIES.slice(0, 2)) {
      fireEvent.click(
        screen.getByLabelText(t('settings.git.selectCommitAria', { hash: short(e.hash) })),
      );
    }
    // 工具条出现并报出数量
    await waitFor(() =>
      expect(screen.getByText(t('settings.git.selectedCount', { count: 2 }))).toBeInTheDocument(),
    );

    const batchBtn = () =>
      screen.getByLabelText(t('settings.git.deleteSelectedAria', { count: 2 }));
    fireEvent.click(batchBtn());
    await waitFor(() =>
      expect(screen.getByText(t('settings.git.deleteSelectedConfirm', { count: 2 }))).toBeInTheDocument(),
    );
    expect(deleteCommits).not.toHaveBeenCalled();

    fireEvent.click(batchBtn());
    await waitFor(() =>
      expect(deleteCommits).toHaveBeenCalledWith(PROJECT, [ENTRIES[0].hash, ENTRIES[1].hash]),
    );
  });

  it('★ 重命名把输入框里的新说明原样传下去（不是传旧值）', async () => {
    render(<GitHistoryDialog open onClose={() => {}} projectPath={PROJECT} />);
    const hash = ENTRIES[1].hash;
    await waitFor(() => expect(screen.getByText('c2')).toBeInTheDocument());

    expand(hash);
    fireEvent.click(screen.getByLabelText(t('settings.git.rewordAria', { hash: short(hash) })));
    // 展开后按钮与输入框共用同一个 aria-label，输入框是最后一个
    const input = screen.getAllByLabelText(
      t('settings.git.rewordAria', { hash: short(hash) }),
    ).at(-1) as HTMLInputElement;
    expect(input.value, '草稿默认是原说明').toBe('c2');
    fireEvent.change(input, { target: { value: '  改过的说明  ' } });

    fireEvent.click(screen.getByText(t('settings.git.rewordSave')));
    await waitFor(() =>
      expect(rewordCommit).toHaveBeenCalledWith(PROJECT, hash, '  改过的说明  '),
    );
  });

  it('换项目 / 重新打开时清空选择（旧 hash 指向不存在的提交）', async () => {
    const { rerender } = render(<GitHistoryDialog open onClose={() => {}} projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText('c1')).toBeInTheDocument());
    fireEvent.click(
      screen.getByLabelText(t('settings.git.selectCommitAria', { hash: short(ENTRIES[0].hash) })),
    );
    await waitFor(() =>
      expect(screen.getByText(t('settings.git.selectedCount', { count: 1 }))).toBeInTheDocument(),
    );

    rerender(<GitHistoryDialog open onClose={() => {}} projectPath="/other" />);
    await waitFor(() =>
      expect(screen.queryByText(t('settings.git.selectedCount', { count: 1 }))).toBeNull(),
    );
  });
});
