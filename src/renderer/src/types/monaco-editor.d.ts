// src/renderer/src/types/monaco-editor.d.ts
//
// monaco-editor 主包未作为 dependency 安装（仅运行时从 CDN 加载）。
// @monaco-editor/react 与本项目代码使用 `import type` 引用其类型，
// 但完整类型定义需要 monaco-editor 主包（体积大，不适合本地打包）。
//
// 此 ambient 声明提供宽松的 namespace + 值导出，让以下三种用法都通过：
//   1. `import type { editor } from 'monaco-editor'`  → editor 作为命名空间
//   2. `import type * as Monaco from 'monaco-editor'` → Monaco.languages.CompletionItem
//   3. `import * as monaco from 'monaco-editor'`       → monaco.Range / monaco.editor.*
//
// 实际运行时由 @monaco-editor/loader 从 CDN 加载完整 monaco 实例。
// 副作用：引用 monaco-editor 类型的位置将退化为 any，失去静态类型保护，
// 但保留运行时正确性与代码可读性。

declare module 'monaco-editor' {
  export namespace editor {
    type IStandaloneCodeEditor = any
    type IStandaloneDiffEditor = any
    interface IModel { [key: string]: any }
    interface IMarkerData { [key: string]: any }
    function create(...args: any[]): any
  }
  export namespace languages {
    interface CompletionItem { [key: string]: any }
    interface CompletionList { suggestions: CompletionItem[] }
    interface IDisposable { dispose(): void }
    function registerCompletionItemProvider(...args: any[]): IDisposable
  }
  export namespace MarkerSeverity {
    const Hint: 1
    const Info: 2
    const Warning: 4
    const Error: 8
  }
  const Range: any
  const editor: typeof editor
  const languages: typeof languages
  const MarkerSeverity: typeof MarkerSeverity
  export { Range, editor, languages, MarkerSeverity }
}

declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}
