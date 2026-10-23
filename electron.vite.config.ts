import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/**
 * electron-vite 配置（恢复重建）。
 *
 * 10/18 打包产物只带编译后的 out/，不带构建配置；这里按项目的实际布局复原：
 * - 三目标标准布局：out/{main,preload,renderer}
 * - 主进程/预加载 externalizeDepsPlugin：better-sqlite3 / node-pty / electron-log
 *   等原生或运行时依赖不打进 bundle，与 electron-builder 的 asarUnpack 对应
 * - 渲染进程 root 是 src/renderer（index.html 在这里，入口 /src/main.tsx）
 *
 * 别名与 tsconfig.node.json / tsconfig.web.json / vitest.config.ts 保持一致。
 */
const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer/src'),
  '@logic': resolve('src/shared/nodes/builtin/logic'),
  '@actions': resolve('src/shared/nodes/builtin/actions'),
  '@triggers': resolve('src/shared/nodes/builtin/triggers'),
  '@data': resolve('src/shared/nodes/builtin/data'),
  '@ai': resolve('src/shared/nodes/builtin/ai'),
  '@interface': resolve('src/shared/nodes/builtin/interface'),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        // 三个入口，和 10/18 打包产物一致：
        //   · index          桌面主进程
        //   · standalone     Docker/SSH 部署用的 headless 运行时（node out/main/standalone.js <project>）
        //   · untrustedWorker 不可信节点沙箱子进程（untrustedWorkerHost 用 child_process.fork 起它）
        // 少任何一个都会在运行期才炸（worker 找不到入口 / 部署镜像收不到消息）。
        input: {
          index: resolve('src/main/index.ts'),
          standalone: resolve('src/main/runtime/standalone.ts'),
          untrustedWorker: resolve('src/main/runtime/untrustedWorker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
})
