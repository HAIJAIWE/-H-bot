// src/renderer/src/stores/editorStore.ts
//
// # 代码编辑器「当前打开的文件」的**唯一落点**（2026-10-15，P1-5）
//
// ## 为什么要有它（用户原话：「他不在代码编辑器那边工作，也就是编程智能体」）
//
// 用户站在代码编辑器里说「帮我改这个文件」，助手**没有指代对象** —— 只能反问或瞎猜。
// 而这份状态原先只活在 CodePanel 组件内部（`useState`），`aiStore` 够不着，所以提升到这里。
//
// ## 为什么不放进 uiStore（它已经装着 centerTab）
//
// uiStore 的契约是「**布局偏好**」，它把字段持久化进 localStorage（`qqbat-ui` 的 partialize）。
// 而「当前打开的文件」是**按项目变化的会话状态**：一旦被持久化，重启后会指向上一个项目
// （甚至已不存在）的文件 —— 助手就会拿着一个假路径去回答「这个文件」。
// 放进同一个文件里只能靠「记得别加进 partialize」来防，那是会失效的约定；
// 单独一个 store 让「不持久化」成为**默认**（本文件没有 persist）。
// 另外本仓库本就是「一域一 store」（flowStore / testStore / debugStore / projectStore…）。
import { create } from 'zustand';

interface EditorState {
  /**
   * 编辑器里当前激活的文件（**项目内相对路径**，如 `src/plugins/hello/index.js`）。
   * `undefined` = 当前没有打开任何文件。
   */
  activeFilePath?: string;
  /** 切换当前文件；传 undefined / 空串 = 没有文件被打开 */
  setActiveFilePath: (path?: string) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  activeFilePath: undefined,
  setActiveFilePath: (path) => set({ activeFilePath: path || undefined }),
}));

/**
 * 项目文件加载完之后该打开哪个文件（纯函数，便于把「切项目不串味」钉在测试里）。
 *
 * @param loaded 刚读回来的文件列表
 * @param previous 提升到 store 之后**上一个**当前文件（可能是别的项目留下的）
 */
export function pickActiveFile(
  loaded: ReadonlyArray<{ path: string; readOnly?: boolean }>,
  previous?: string,
): string | undefined {
  // 旧路径仍在新列表里才保留：切走再切回代码页时不用重新点。
  if (previous && loaded.some((f) => f.path === previous)) return previous;
  // 否则取**第一个可编辑**的。原来停在列表第一个，而第一个是只读的「生成代码快照」——
  // 用户一进代码页就撞墙「不能输入」（2026-10-02）。
  // ⚠️ 换项目时这一步同时把**上一个项目的路径**换掉：留着它，助手会被告知
  // 「用户打开的是另一个项目的那个文件」，而 CodeEditor 只能退到只读快照上。
  return loaded.find((f) => !f.readOnly)?.path ?? loaded[0]?.path;
}
