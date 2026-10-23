// tests/main/services/dockerExport.test.ts
// 覆盖：Docker 部署包的产物形状（Dockerfile / compose / runtime/ / 项目文件）、
// 缺流程文件与缺运行时两种失败路径，以及 _checkPath 的越界拒绝。
//
// 关键断言（都是踩过的坑）：
//   - 镜像里没有 Python（ADR-003 后运行时不依赖 python/pip/requirements.txt）；
//   - HEALTHCHECK 用 TCP 探翻译器端口，不用 pgrep（进程活着 ≠ 服务可用）；
//   - runtime/node_modules/electron 占位包必须进包，否则 standalone 在纯 Node 下 require('electron') 崩。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { exportProjectToDocker, _checkPath } from '@main/services/dockerExport'

let workDir: string
let projectDir: string
let runtimeDir: string
let outputDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'qqbat-docker-'))
  projectDir = join(workDir, 'project')
  runtimeDir = join(workDir, 'out-main')
  outputDir = join(workDir, 'bundle')

  mkdirSync(join(projectDir, '.qqbat'), { recursive: true })
  mkdirSync(join(projectDir, 'data'), { recursive: true })
  mkdirSync(join(projectDir, 'plugins'), { recursive: true })
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, '.qqbat', 'flow.json'), JSON.stringify({ nodes: [], edges: [] }))
  writeFileSync(join(projectDir, '.qqbat', 'project.json'), JSON.stringify({ translatorPort: 1001 }))
  writeFileSync(join(projectDir, 'data', 'players.json'), '{"players":[]}')
  writeFileSync(join(projectDir, 'plugins', 'p.js'), '// plugin')
  writeFileSync(join(projectDir, 'src', 'custom.ts'), '// custom node')
  writeFileSync(join(projectDir, '.env'), 'QQ_APP_ID=1\n')

  mkdirSync(join(runtimeDir, 'chunks'), { recursive: true })
  writeFileSync(join(runtimeDir, 'standalone.js'), '// standalone')
  writeFileSync(join(runtimeDir, 'chunks', 'FlowRuntime.js'), '// chunk')
  vi.stubEnv('QQBAT_STANDALONE_DIR', runtimeDir)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(workDir, { recursive: true, force: true })
})

describe('exportProjectToDocker', () => {
  it('生成 Node 运行时的完整构建上下文', async () => {
    const result = await exportProjectToDocker(projectDir, {
      adapter: 'official',
      includeNapcat: false,
      outputDir,
      imageName: 'test-bot',
      port: 9000
    })

    expect(result.success).toBe(true)
    expect(result.error).toBe('')
    expect(result.buildCommand).toContain('docker build -t test-bot')
    for (const rel of [
      'Dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      'start.sh',
      '.env.example',
      'README.md',
      'runtime/standalone.js',
      'runtime/chunks/FlowRuntime.js',
      'runtime/node_modules/electron/package.json',
      // 运行时依赖清单：镜像构建时按它装 ws/zod/better-sqlite3 等 external 依赖
      'package.json',
      'pnpm-lock.yaml',
      '.qqbat/flow.json',
      'data/players.json',
      '.env'
    ]) {
      expect(existsSync(join(outputDir, rel)), rel).toBe(true)
    }

    const dockerfile = readFileSync(join(outputDir, 'Dockerfile'), 'utf-8')
    expect(dockerfile).toContain('FROM node:22-slim')
    expect(dockerfile).toContain('CMD ["node", "/app/runtime/standalone.js", "/app"]')
    expect(dockerfile).toContain('QQBOT_PROJECT_ROOT=/app')
    // external 依赖必须在镜像里按锁文件安装（只拷 runtime/ 会 MODULE_NOT_FOUND: ws）
    expect(dockerfile).toContain('COPY package.json ./')
    expect(dockerfile).toContain('COPY pnpm-lock.yaml ./')
    expect(dockerfile).toContain('pnpm install --prod --frozen-lockfile --ignore-scripts')
    // 原生依赖必须在镜像里现装并验证（拷 Windows 的 .node 一定加载失败）
    expect(dockerfile).toContain('./node_modules/.bin/prebuild-install')
    expect(dockerfile).toContain("require('better-sqlite3')")
    expect(dockerfile.indexOf('pnpm install --prod')).toBeLessThan(
      dockerfile.indexOf('COPY . /app')
    )
    expect(dockerfile).toContain("require('net').connect")
    expect(dockerfile).toContain('QQBOT_BUS_PORT')
    // 假健康的旧写法（pgrep 当 CMD）与 Python 时代残留都不该回来
    expect(dockerfile).not.toMatch(/CMD pgrep/)
    expect(dockerfile).not.toMatch(/python|pip3?\s/)
    expect(dockerfile).not.toContain('requirements.txt')

    const compose = readFileSync(join(outputDir, 'docker-compose.yml'), 'utf-8')
    expect(compose).toContain('./data:/app/data')
    expect(compose).toContain('./.qqbat:/app/.qqbat')
    expect(compose).toContain('"9000:9000"')

    const startSh = readFileSync(join(outputDir, 'start.sh'), 'utf-8')
    expect(startSh).toContain('exec node /app/runtime/standalone.js /app')

    const envExample = readFileSync(join(outputDir, '.env.example'), 'utf-8')
    expect(envExample).toContain('QQBOT_PROJECT_ROOT=/app')
    expect(envExample).toContain('QQ_APP_ID=')

    const readme = readFileSync(join(outputDir, 'README.md'), 'utf-8')
    expect(readme).toContain('不需要 Python')
    expect(readme).toContain('runtime/standalone.js')
  })

  it('napcat 模式把 NapCat 写进镜像与启动脚本', async () => {
    const result = await exportProjectToDocker(projectDir, {
      adapter: 'napcat',
      includeNapcat: true,
      outputDir,
      imageName: 'test-bot'
    })
    expect(result.success).toBe(true)

    const dockerfile = readFileSync(join(outputDir, 'Dockerfile'), 'utf-8')
    expect(dockerfile).toContain('NapCat')
    expect(dockerfile).toContain('CMD ["/app/start.sh"]')

    const startSh = readFileSync(join(outputDir, 'start.sh'), 'utf-8')
    expect(startSh).toContain('napcat.mjs')
    expect(startSh).toContain('node /app/runtime/standalone.js /app &')

    const envExample = readFileSync(join(outputDir, '.env.example'), 'utf-8')
    expect(envExample).toContain('NAPCAT_QQ=')
  })

  it('缺 .qqbat/flow.json 时直接失败且不产出半成品', async () => {
    rmSync(join(projectDir, '.qqbat', 'flow.json'))
    const result = await exportProjectToDocker(projectDir, {
      adapter: 'official',
      includeNapcat: false,
      outputDir
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('.qqbat/flow.json')
    expect(existsSync(join(outputDir, 'Dockerfile'))).toBe(false)
  })

  it('找不到构建产物时报错并提示先 build', async () => {
    vi.stubEnv('QQBAT_STANDALONE_DIR', join(workDir, 'not-built'))
    mkdirSync(join(workDir, 'not-built'), { recursive: true })
    // resolveRuntimeDir 的第三个候选是 cwd/out/main；切到临时目录才能模拟“真的没构建”
    const originalCwd = process.cwd()
    process.chdir(workDir)
    try {
      const result = await exportProjectToDocker(projectDir, {
        adapter: 'official',
        includeNapcat: false,
        outputDir
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('pnpm build')
    } finally {
      process.chdir(originalCwd)
    }
  })
})

describe('_checkPath', () => {
  it('拒绝越界路径，接受 baseDir 内的路径', async () => {
    writeFileSync(join(projectDir, 'inside.txt'), 'ok')
    expect(await _checkPath(projectDir, join(projectDir, 'inside.txt'))).toBe(true)
    expect(await _checkPath(projectDir, join(workDir, 'outside.txt'))).toBe(false)
    expect(await _checkPath(projectDir, projectDir)).toBe(false)
  })
})
