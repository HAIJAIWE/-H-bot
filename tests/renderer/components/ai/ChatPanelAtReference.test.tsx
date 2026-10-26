// tests/renderer/components/ai/ChatPanelAtReference.test.tsx
//
// 第 58 批「@ 文件引用」的**端到端**渲染层行为：真实 ChatPanel + useAtReference + 候选浮层，
// 只把项目路径和主进程桥换掉。逐条对应任务书要求的交互（触发→过滤→键盘插入→目录下钻→Esc→
// 空态/失败态/桥缺失/不可表达路径/邮箱不误触发）。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ApiResult } from '@renderer/types/ipc'
import { FILE_REFERENCE_MAX_RESULTS, type FileReference } from '@shared/ai/fileReference'

// 必须在 import aiStore 之前 mock flowStore（vi.mock 会自动提升到文件顶部）
vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: {
    getState: () => ({
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNodeConfig: vi.fn(),
      removeNode: vi.fn(),
      autoLayout: vi.fn(),
      snapshot: vi.fn(() => ({ nodes: [], edges: [] })),
      rollback: vi.fn(),
      generateCode: vi.fn().mockResolvedValue(true),
    }),
  },
}))

// 有项目才有候选：本文件固定一个工作区路径
const PROJECT_PATH = 'E:/proj'
vi.mock('@renderer/stores/projectStore', () => {
  const state = { currentProject: { path: 'E:/proj' } }
  return {
    useProjectStore: (selector: (s: typeof state) => unknown) => selector(state),
    // 若哪条用例意外走进发送分支，让 store 读得动（否则只会看到一条无关的 TypeError）
    useProjectStoreGetState: () => state,
    default: { getState: () => state },
  }
})

import { t } from '@renderer/i18n'
import { useAiStore } from '@renderer/stores/aiStore'
import { ChatPanel } from '@renderer/components/ai/ChatPanel'

type ReferencesResult = ApiResult<{ references: FileReference[] }>
type SearchFn = (projectPath: string, query: string, limit?: number) => Promise<ReferencesResult>

const ROOTS: FileReference[] = [
  { path: 'src/renderer', kind: 'directory' },
  { path: 'src/main/index.ts', kind: 'file' },
]
const CHILDREN: FileReference[] = [{ path: 'src/renderer/App.tsx', kind: 'file' }]

/** 主进程桥的替身：直接挂到 window.qqbat.file.searchReferences 上 */
function setSearch(search: SearchFn): void {
  ;(window as unknown as { qqbat: unknown }).qqbat = { file: { searchReferences: search } }
}

function ok(references: FileReference[]): ReferencesResult {
  return { ok: true, data: { references } }
}

beforeEach(() => {
  // 重置 store 状态，确保测试隔离
  useAiStore.setState({
    currentProposal: null,
    messages: [],
    streaming: false,
    currentChunk: '',
    toolCalls: [],
    agentState: { state: 'idle' },
    isBatchMode: false,
  })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { qqbat?: unknown }).qqbat
})

/** 输入框是受控的：改值靠 change 事件，光标由 jsdom 落到末尾（和真人打字一致） */
function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(t('ai.chat.placeholder')) as HTMLTextAreaElement
}

function typeValue(value: string): HTMLTextAreaElement {
  const el = textarea()
  fireEvent.change(el, { target: { value } })
  return el
}

/** 等候选浮层出现（防抖 120ms + IPC 往返；浮层先于结果出现，所以还要等 option） */
async function findMenu(): Promise<HTMLElement> {
  return screen.findByRole('listbox', { name: t('ai.at.title') })
}

/** 等候选真正回来（不是只剩「正在查找…」的空壳） */
async function findOptions(): Promise<HTMLElement[]> {
  const menu = await findMenu()
  return within(menu).findAllByRole('option')
}

describe('ChatPanel @ 文件引用', () => {
  it('行首打 @ 弹候选，并把 projectPath / 空 query / limit 传给主进程', async () => {
    const search = vi.fn<SearchFn>(() => Promise.resolve(ok(ROOTS)))
    setSearch(search)
    render(<ChatPanel />)

    typeValue('@')
    const menu = await findMenu()
    await within(menu).findByText('src/renderer/')

    expect(search).toHaveBeenCalledWith(PROJECT_PATH, '', FILE_REFERENCE_MAX_RESULTS)
    // 目录行带 / 后缀（插入后就是这句文本），文件行原样
    expect(within(menu).getByText('src/renderer/')).toBeInTheDocument()
    expect(within(menu).getByText('src/main/index.ts')).toBeInTheDocument()
  })

  it('空格后 @ + 查询词会先过滤，且过滤词原样作为 query 传给主进程', async () => {
    const search = vi.fn<SearchFn>((_p, query) =>
      Promise.resolve(ok(query === 'mai' ? [ROOTS[1]] : ROOTS)),
    )
    setSearch(search)
    render(<ChatPanel />)

    typeValue('帮我看看 @mai')
    const menu = await findMenu()
    await within(menu).findByTitle('src/main/index.ts')

    expect(search).toHaveBeenLastCalledWith(PROJECT_PATH, 'mai', FILE_REFERENCE_MAX_RESULTS)
    expect(within(menu).queryByText('src/renderer/')).not.toBeInTheDocument()
    // 命中片段要高亮（<mark> 里正是 query）
    expect(within(menu).getByRole('option').querySelector('mark')?.textContent).toBe('mai')
  })

  it('↑↓ + Enter 插入文件路径：补一个空格，caret 落在路径之后', async () => {
    setSearch(() => Promise.resolve(ok(ROOTS)))
    render(<ChatPanel />)

    const el = typeValue('@')
    await findOptions()
    // 第一项是目录，↓ 到文件
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    fireEvent.keyDown(el, { key: 'Enter' })

    await waitFor(() => expect(textarea().value).toBe('@src/main/index.ts '))
    // 插入后菜单关闭，caret 在末尾（接着就能打字/发送）
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await waitFor(() => expect(textarea().selectionStart).toBe('@src/main/index.ts '.length))
  })

  it('Enter 选中目录后进入该目录（query 变成 dir/，菜单继续列子项）', async () => {
    const search = vi.fn<SearchFn>((_p, query) => {
      if (query === 'src/renderer/') return Promise.resolve(ok(CHILDREN))
      return Promise.resolve(ok(ROOTS))
    })
    setSearch(search)
    render(<ChatPanel />)

    // 从行首 @ 开始，默认高亮第一项 = 目录
    typeValue('@')
    await findOptions()
    fireEvent.keyDown(textarea(), { key: 'Enter' })

    await waitFor(() => expect(textarea().value).toBe('@src/renderer/'))
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        PROJECT_PATH,
        'src/renderer/',
        FILE_REFERENCE_MAX_RESULTS,
      ),
    )
    // 下钻后菜单仍开着，列出目录里的文件
    const menu = await findMenu()
    await within(menu).findByTitle('src/renderer/App.tsx')
  })

  it('Esc 关闭菜单但不清空已经打进去的文字', async () => {
    setSearch(() => Promise.resolve(ok(ROOTS)))
    render(<ChatPanel />)

    typeValue('@src')
    await findOptions()
    fireEvent.keyDown(textarea(), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(textarea().value).toBe('@src')
  })

  it('没有匹配时显示空态（不是一直转圈）', async () => {
    setSearch((_p, query) => Promise.resolve(ok(query === 'zzz' ? [] : ROOTS)))
    render(<ChatPanel />)

    typeValue('@zzz')
    const menu = await findMenu()

    await within(menu).findByText(t('ai.at.empty'))
    expect(within(menu).queryByText(t('ai.at.searching'))).not.toBeInTheDocument()
  })

  it('主进程返回失败时显示错误文案，不静默当成没搜到', async () => {
    setSearch(() => Promise.resolve({ ok: false, error: 'boom' }))
    render(<ChatPanel />)

    typeValue('@x')
    const menu = await findMenu()

    await waitFor(() =>
      expect(within(menu).getByRole('alert').textContent).toBe(
        t('ai.at.failed', { message: 'boom' }),
      ),
    )
  })

  it('桥不存在（ipc-missing）时显示错误文案，且输入框还能继续打字', async () => {
    // 不挂 window.qqbat = 界面与主进程版本不一致
    render(<ChatPanel />)

    typeValue('@')
    const menu = await findMenu()
    await waitFor(() =>
      expect(within(menu).getByRole('alert').textContent).toBe(
        t('ai.at.failed', { message: 'ipc-missing' }),
      ),
    )

    // 不抛错、不吞字：继续输入仍然生效
    typeValue('@src')
    expect(textarea().value).toBe('@src')
  })

  it('路径不可表达（含引号）时插入失败：给出原因、原文一个字都不动', async () => {
    setSearch(() => Promise.resolve(ok([{ path: 'a"b.ts', kind: 'file' }])))
    render(<ChatPanel />)

    typeValue('@')
    await findOptions()
    fireEvent.keyDown(textarea(), { key: 'Enter' })

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('ai.at.unsupported')))
    expect(textarea().value).toBe('@')
  })

  it('邮箱里的 @ 不触发候选（否则每敲一个邮箱就弹一次菜单）', async () => {
    const search = vi.fn<SearchFn>(() => Promise.resolve(ok(ROOTS)))
    setSearch(search)
    render(<ChatPanel />)

    typeValue('a@b')
    // 给防抖留出窗口：真的不该发请求
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(search).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('搜索还没回来时按 Enter 不插旧候选、也不把这句话发出去', async () => {
    // 第一次立刻回结果（让菜单里有候选），第二次永远 pending（模拟换查询后正在查）
    let pendingCall = false
    const send = vi.spyOn(useAiStore.getState(), 'sendMessage')
    setSearch((_p, query) => {
      if (query === 'ren') {
        pendingCall = true
        return new Promise<ReferencesResult>(() => {})
      }
      return Promise.resolve(ok(ROOTS))
    })
    render(<ChatPanel />)

    const el = typeValue('@')
    await findOptions()
    // 换成还没回来的查询：菜单里还挂着上一轮的 items，同时 loading=true
    typeValue('@ren')
    await waitFor(() => expect(pendingCall).toBe(true))

    fireEvent.keyDown(el, { key: 'Enter' })
    await new Promise(resolve => setTimeout(resolve, 50))

    // 既没插入过期路径，也没走发送分支
    expect(textarea().value).toBe('@ren')
    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
  })
})
