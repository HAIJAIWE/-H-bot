// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/main/__tests__/**/*.test.ts', 'src/main/services/builtinNodes/__tests__/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // 用户项目只读守卫：整个运行前后给 projects/ 下的机器人项目拍哈希，
    // 任何一处变动 → 整次运行以非 0 退出（见 tests/setup/globalGuard.ts）
    globalSetup: ['./tests/setup/globalGuard.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
      '@main': resolve('src/main'),
      '@logic': resolve('src/shared/nodes/builtin/logic'),
      '@actions': resolve('src/shared/nodes/builtin/actions'),
      '@triggers': resolve('src/shared/nodes/builtin/triggers'),
      '@data': resolve('src/shared/nodes/builtin/data'),
      '@ai': resolve('src/shared/nodes/builtin/ai'),
      '@interface': resolve('src/shared/nodes/builtin/interface'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
})
