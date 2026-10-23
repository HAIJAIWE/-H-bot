// src/main/types/vite-plugins.d.ts
//
// 这些 Vite 插件包的 package.json exports 字段未声明 types 路径，
// TypeScript 在严格 node module resolution 下找不到类型声明。
// 此 ambient 声明让 typecheck 通过，运行时正确性不受影响。
//
// 类型来自各包 dist/index.d.ts（已存在但未被 exports 引用）。

declare module '@vitejs/plugin-react' {
  import type { Plugin } from 'vite'
  const plugin: () => Plugin
  export default plugin
}

declare module '@tailwindcss/vite' {
  import type { Plugin } from 'vite'
  const plugin: () => Plugin
  export default plugin
}
