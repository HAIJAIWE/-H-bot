// tests/main/services/deploy/runtimeBundle.test.ts
// 覆盖：运行时目录定位（QQBAT_STANDALONE_DIR）、递归复制、electron 占位包。
// 这层是部署包的“运行时半边”：漏一个 chunk 或占位包，镜像里 node standalone.js 就起不来。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  copyRuntimeBundle,
  copyRuntimeManifest,
  detectLockfile,
  getAppRoot,
  nodeInstallShell,
  resolveRuntimeDir,
  runtimeEntryRel,
  RUNTIME_DIR_NAME
} from '@main/services/deploy/runtimeBundle'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'qqbat-runtime-'))
  vi.stubEnv('QQBAT_STANDALONE_DIR', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(workDir, { recursive: true, force: true })
})

/** 造一个最小可用的“构建产物”目录（standalone.js + 一个 chunk） */
function makeFakeRuntime(): string {
  const dir = join(workDir, 'out-main')
  mkdirSync(join(dir, 'chunks'), { recursive: true })
  writeFileSync(join(dir, 'standalone.js'), '// standalone\n')
  writeFileSync(join(dir, 'chunks', 'FlowRuntime.js'), '// chunk\n')
  return dir
}

describe('resolveRuntimeDir', () => {
  it('优先使用 QQBAT_STANDALONE_DIR 指向的目录', () => {
    const dir = makeFakeRuntime()
    vi.stubEnv('QQBAT_STANDALONE_DIR', dir)
    expect(resolveRuntimeDir()).toBe(dir)
  })

  it('环境变量目录缺 standalone.js 时不采信，回退到可用的 out/main', () => {
    const empty = join(workDir, 'empty')
    mkdirSync(empty, { recursive: true })
    vi.stubEnv('QQBAT_STANDALONE_DIR', empty)
    // 仓库里存在 out/main（构建产物）；没有时这个用例会被跳过式失败，
    // 因此只断言“返回的目录里确实有 standalone.js”这个不变量。
    const resolved = resolveRuntimeDir()
    expect(existsSync(join(resolved, 'standalone.js'))).toBe(true)
    expect(resolved).not.toBe(empty)
  })
})

describe('copyRuntimeBundle', () => {
  it('递归复制运行时并写入 electron 占位包', async () => {
    const src = makeFakeRuntime()
    vi.stubEnv('QQBAT_STANDALONE_DIR', src)
    const dest = join(workDir, 'bundle', RUNTIME_DIR_NAME)

    const result = await copyRuntimeBundle(dest)

    expect(result.sourceDir).toBe(src)
    expect(result.destDir).toBe(dest)
    // standalone.js + chunks/FlowRuntime.js + 占位包 2 个文件
    expect(result.fileCount).toBe(4)
    expect(readFileSync(join(dest, 'standalone.js'), 'utf-8')).toContain('standalone')
    expect(readFileSync(join(dest, 'chunks', 'FlowRuntime.js'), 'utf-8')).toContain('chunk')

    const stubPkg = JSON.parse(
      readFileSync(join(dest, 'node_modules', 'electron', 'package.json'), 'utf-8')
    ) as { name: string; main: string }
    expect(stubPkg.name).toBe('electron')
    expect(stubPkg.main).toBe('index.js')
    expect(readFileSync(join(dest, 'node_modules', 'electron', 'index.js'), 'utf-8')).toContain(
      'module.exports = {}'
    )
  })
})

describe('运行时依赖清单', () => {
  it('在仓库根找到 package.json 与 pnpm 锁文件', () => {
    const root = getAppRoot()
    expect(existsSync(join(root, 'package.json'))).toBe(true)
    expect(detectLockfile(root)).toBe('pnpm-lock.yaml')
  })

  it('复制清单到部署包（镜像/远程 install 的前提）', async () => {
    const dest = join(workDir, 'bundle')
    const result = await copyRuntimeManifest(dest)
    expect(result.lockfileName).toBe('pnpm-lock.yaml')
    expect(result.files).toEqual(['package.json', 'pnpm-lock.yaml'])
    for (const file of result.files) expect(existsSync(join(dest, file))).toBe(true)
  })

  it('没有锁文件时明确报错，而不是静默产出不可复现的包', async () => {
    const empty = join(workDir, 'no-lock')
    mkdirSync(empty, { recursive: true })
    writeFileSync(join(empty, 'package.json'), '{"name":"x"}')
    const originalCwd = process.cwd()
    process.chdir(empty)
    try {
      await expect(copyRuntimeManifest(join(workDir, 'out'))).rejects.toThrow('找不到锁文件')
    } finally {
      process.chdir(originalCwd)
    }
  })
})

describe('nodeInstallShell', () => {
  it('pnpm 锁：跳过生命周期脚本，再单独装 better-sqlite3 并验证加载', () => {
    const cmd = nodeInstallShell('pnpm-lock.yaml')
    expect(cmd).toContain('pnpm install --prod --frozen-lockfile --ignore-scripts')
    expect(cmd).toContain('prebuild-install')
    expect(cmd).toContain("require('better-sqlite3')")
  })

  it('npm 锁走 npm ci，同样跳过脚本', () => {
    const cmd = nodeInstallShell('package-lock.json')
    expect(cmd).toContain('npm ci --omit=dev --ignore-scripts')
    expect(cmd).not.toContain('pnpm install')
  })
})

describe('runtimeEntryRel', () => {
  it('返回 POSIX 风格的容器内入口路径', () => {
    expect(runtimeEntryRel()).toBe('runtime/standalone.js')
  })
})
