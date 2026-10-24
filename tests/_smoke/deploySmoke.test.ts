// tests/_smoke/deploySmoke.test.ts
// 可选的真实冒烟：导出一个 Docker 构建上下文，再用纯 Node 启动包里的 runtime/standalone.js。
// 验证的不只是文件在不在，而是"导出的包真的能跑"：
//   - runtime/node_modules/electron 占位包能让 FlowRuntime chunk 的 require('electron') 通过；
//   - 翻译器按 project.json 的 translatorPort 监听，HEALTHCHECK 探的就是这个端口。
// 默认跳过（会起子进程 + 占端口）：QQBAT_DEPLOY_SMOKE=1 时执行。
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createServer, connect } from 'net'
import { exportProjectToDocker } from '@main/services/dockerExport'

const enabled = process.env.QQBAT_DEPLOY_SMOKE === '1'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function tcpProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1', () => {
      sock.end()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
    setTimeout(() => {
      sock.destroy()
      resolve(false)
    }, 3000)
  })
}

describe.skipIf(!enabled)('导出的部署包可被纯 Node 启动', () => {
  it('standalone 起翻译器并监听 project.json 的 translatorPort', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'qqbat-deploy-smoke-'))
    const projectDir = join(workDir, 'project')
    const outputDir = join(workDir, 'bundle')
    const port = await freePort()
    vi.stubEnv('QQBAT_STANDALONE_DIR', '')
    try {
      mkdirSync(join(projectDir, '.qqbat'), { recursive: true })
      writeFileSync(
        join(projectDir, '.qqbat', 'flow.json'),
        JSON.stringify({ nodes: [], edges: [], version: 1 })
      )
      writeFileSync(
        join(projectDir, '.qqbat', 'project.json'),
        JSON.stringify({ translatorPort: port })
      )

      const exported = await exportProjectToDocker(projectDir, {
        adapter: 'official',
        outputDir,
        imageName: 'smoke-bot'
      })
      expect(exported.success, exported.error).toBe(true)
      // 部署包必须带依赖清单（镜像/远程据此装 external 依赖）
      expect(exported.files).toContain('package.json')
      expect(exported.files).toContain('pnpm-lock.yaml')

      // 真实依赖树不复制（那是镜像 pnpm install 的活）；本地冒烟用目录联接指向仓库
      // node_modules，只为验证 electron 占位包优先级 + 启动链路。
      const repoNodeModules = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules')
      if (existsSync(repoNodeModules) && !existsSync(join(outputDir, 'node_modules'))) {
        symlinkSync(repoNodeModules, join(outputDir, 'node_modules'), 'junction')
      }

      const child = spawn('node', [join(outputDir, 'runtime', 'standalone.js'), outputDir], {
        cwd: outputDir,
        env: { ...process.env, QQBOT_PROJECT_ROOT: outputDir },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      child.stdout.on('data', (d: Buffer) => (output += d.toString()))
      child.stderr.on('data', (d: Buffer) => (output += d.toString()))

      const ready = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 25000)
        const check = (): void => {
          if (output.includes('已就绪')) {
            clearTimeout(timer)
            resolve(true)
          }
        }
        child.stdout.on('data', check)
        child.stderr.on('data', check)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve(false)
        })
      })

      expect(ready, output.slice(-4000)).toBe(true)
      expect(await tcpProbe(port), output.slice(-4000)).toBe(true)

      child.kill('SIGTERM')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    } finally {
      vi.unstubAllEnvs()
      rmSync(workDir, { recursive: true, force: true, maxRetries: 3 })
    }
  }, 40000)
})
