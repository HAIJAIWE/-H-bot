// tests/main/services/project.test.ts
//
// 2026-10-24 恢复注：原文件还有两个 describe（「高代码模式」与「convertToHighcode」），
// 断言 pyproject.toml / bot.py / .env.example / qqbat_nodes.runtime 那套 Python 生成产物。
// ADR-003 之后运行时直接解释 .qqbat/flow.json，不再生成 bot.py；对应实现与模板都已删除，
// 那两个 describe 属于已退役 Python 栈，已归档到 _recovery/legacy-python-codegen-tests/。
// 这里只测当前 ProjectService 真正负责的事：目录结构、project.json 读写、最近项目。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProjectConfig } from '@shared/types/project'

// safeStorage 只有在真实 Electron 里才有；纯 Node 下是 undefined。
// 用一个开关模拟「系统支持/不支持安全存储」两条路径。
const { encAvailable } = vi.hoisted(() => ({ encAvailable: { value: false } }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/qqbat-test-userdata' },
  safeStorage: {
    isEncryptionAvailable: () => encAvailable.value,
    // 真实实现返回 Buffer；这里用可逆前缀编码，够验证「落盘是密文、读回是明文」
    encryptString: (plain: string) => Buffer.from('enc:' + plain, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, '')
  }
}))

import { ProjectService } from '@main/services/project'

let tmpRoot: string

function makeConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  const now = new Date().toISOString()
  return {
    name: 'my-bot',
    qq: '123456',
    adapter: 'official',
    ai: { provider: 'glm', apiKey: 'k', model: 'glm-4' },
    createdAt: now,
    updatedAt: now,
    ...over
  } as ProjectConfig
}

beforeEach(async () => {
  encAvailable.value = false
  tmpRoot = await mkdtemp(join(tmpdir(), 'qqbat-test-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('ProjectService', () => {
  it('创建项目生成标准目录结构', async () => {
    const svc = new ProjectService(tmpRoot)
    const meta = await svc.createProject(makeConfig({ name: 'my-bot' }))
    expect(meta.name).toBe('my-bot')
    const projectPath = join(tmpRoot, 'my-bot')
    // 10/18 起的目录布局：.qqbat/history、data/{players,config/.schema,logs,backups}、src/plugins/{generated,custom}
    for (const rel of [
      '.qqbat',
      join('.qqbat', 'history'),
      join('data', 'players'),
      join('data', 'config', '.schema'),
      join('data', 'logs'),
      join('data', 'backups'),
      join('src', 'plugins', 'generated'),
      join('src', 'plugins', 'custom')
    ]) {
      expect(existsSync(join(projectPath, rel)), rel).toBe(true)
    }
    // project.json 由 _buildFullConfig 补端口块：官方翻译器 = 1000 + block（ADR-003）
    const raw = JSON.parse(await readFile(join(projectPath, '.qqbat', 'project.json'), 'utf-8'))
    expect(raw.portBlock).toBeGreaterThanOrEqual(1)
    expect(raw.translatorPort).toBe(1000 + raw.portBlock)
    // 新项目从空白画布开始：flow.json 存在且没有节点
    const flow = JSON.parse(await readFile(join(projectPath, '.qqbat', 'flow.json'), 'utf-8'))
    expect(typeof flow.schemaVersion).toBe('string')
    expect(flow.nodes).toEqual([])
  })

  it('保存 project.json 原子写入', async () => {
    const svc = new ProjectService(tmpRoot)
    const config = makeConfig({ name: 'bot2', qq: '111' })
    await svc.createProject(config)
    const projectPath = join(tmpRoot, 'bot2')
    await svc.saveProjectConfig(projectPath, { ...config, qq: '222' })
    const raw = await readFile(join(projectPath, '.qqbat', 'project.json'), 'utf-8')
    expect(JSON.parse(raw).qq).toBe('222')
  })

  it('原子写入不残留临时文件', async () => {
    const svc = new ProjectService(tmpRoot)
    const config = makeConfig({ name: 'bot3', qq: '111' })
    await svc.createProject(config)
    const projectPath = join(tmpRoot, 'bot3')
    await svc.saveProjectConfig(projectPath, config)
    expect(existsSync(join(projectPath, '.qqbat', 'project.json.tmp'))).toBe(false)
  })

  it('加载项目配置', async () => {
    const svc = new ProjectService(tmpRoot)
    const meta = await svc.createProject(makeConfig({ name: 'bot4', qq: '999' }))
    const loaded = await svc.loadProjectConfig(meta.path)
    expect(loaded.qq).toBe('999')
  })

  it('记录最近项目列表', async () => {
    const svc = new ProjectService(tmpRoot)
    const a = await svc.createProject(makeConfig({ name: 'bot-a', qq: '1' }))
    const b = await svc.createProject(makeConfig({ name: 'bot-b', qq: '2' }))
    await svc.recordRecentProject(a)
    await svc.recordRecentProject(b)
    const recent = await svc.listRecentProjects()
    expect(recent.map((r) => r.name).sort()).toEqual(['bot-a', 'bot-b'])

    // 同一路径重复记录不产生重复项（按 path 去重）
    await svc.recordRecentProject(a)
    expect((await svc.listRecentProjects()).filter((r) => r.path === a.path)).toHaveLength(1)

    await svc.removeRecentProject(a.path)
    const after = await svc.listRecentProjects()
    expect(after.map((r) => r.name)).toEqual(['bot-b'])
  })
})

describe('ProjectService - 凭证落盘加密', () => {
  it('系统支持 safeStorage 时：ai.apiKey / official.appSecret 以密文落盘，读回是明文', async () => {
    encAvailable.value = true
    const svc = new ProjectService(tmpRoot)
    const config = makeConfig({
      name: 'secure-bot',
      ai: { provider: 'glm', apiKey: 'sk-plain-key', model: 'glm-4' },
      official: { appId: 'app-1', appSecret: 'plain-secret' }
    } as Partial<ProjectConfig>)
    const meta = await svc.createProject(config)

    const disk = JSON.parse(await readFile(join(meta.path, '.qqbat', 'project.json'), 'utf-8'))
    // safeStorage.encryptString 返回 Buffer，落盘前统一转 base64 —— 磁盘上不该出现明文
    expect(disk.ai.apiKey).toBe(Buffer.from('enc:sk-plain-key').toString('base64'))
    expect(disk.ai.apiKey).not.toContain('sk-plain-key')
    expect(disk.ai._encrypted).toBe(true)
    expect(disk.official.appSecret).toBe(Buffer.from('enc:plain-secret').toString('base64'))
    expect(disk.official.appSecret).not.toContain('plain-secret')
    expect(disk.official._encrypted).toBe(true)

    const loaded = await svc.loadProjectConfig(meta.path)
    expect(loaded.ai?.apiKey).toBe('sk-plain-key')
    expect(loaded.official?.appSecret).toBe('plain-secret')
    // 解密后不把内部标记漏给调用方
    expect((loaded.ai as { _encrypted?: boolean })._encrypted).toBeUndefined()
    expect((loaded.official as { _encrypted?: boolean })._encrypted).toBeUndefined()
  })

  it('系统不支持 safeStorage 时：保留明文且不阻塞保存', async () => {
    encAvailable.value = false
    const svc = new ProjectService(tmpRoot)
    const config = makeConfig({
      name: 'plain-bot',
      ai: { provider: 'glm', apiKey: 'sk-plain', model: 'glm-4' },
      official: { appId: 'app-2', appSecret: 'secret-plain' }
    } as Partial<ProjectConfig>)
    const meta = await svc.createProject(config)
    const disk = JSON.parse(await readFile(join(meta.path, '.qqbat', 'project.json'), 'utf-8'))
    expect(disk.ai.apiKey).toBe('sk-plain')
    expect(disk.ai._encrypted).toBeUndefined()
    expect(disk.official.appSecret).toBe('secret-plain')
    expect(disk.official._encrypted).toBeUndefined()
  })

  it('历史明文配置（无 _encrypted 标记）原样读出', async () => {
    encAvailable.value = true
    const svc = new ProjectService(tmpRoot)
    const projectPath = join(tmpRoot, 'legacy-bot')
    await mkdir(join(projectPath, '.qqbat'), { recursive: true })
    const legacy = {
      name: 'legacy-bot',
      qq: '7',
      adapter: 'official',
      ai: { provider: 'glm', apiKey: 'plain-legacy-key', model: 'glm-4' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    await writeFile(join(projectPath, '.qqbat', 'project.json'), JSON.stringify(legacy), 'utf-8')
    const loaded = await svc.loadProjectConfig(projectPath)
    expect(loaded.ai?.apiKey).toBe('plain-legacy-key')
  })
})