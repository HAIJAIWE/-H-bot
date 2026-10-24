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

// 运行时用的是恢复副本 services/project/project.ts：serviceContainer.ts:7 从那里取类，
// 扁平的 services/project.ts 只剩类型被 ipc/project.ts 引用。测试必须打运行时那一份，
// 否则测的是死代码（2026-10-24 发现：扁平版改了行为，界面上一点变化都没有）。
import { ProjectService } from '@main/services/project/project'

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
    // 10/18 起的目录布局（以打包产物为准：FlowRuntime chunk 的 _createProjectDirectories
    // 只建 src/plugins/generated，没有 src/plugins/custom —— 扁平那份 project.ts 是自己加的，
    // 别照它写断言）。
    for (const rel of [
      '.qqbat',
      join('.qqbat', 'history'),
      join('data', 'players'),
      join('data', 'config', '.schema'),
      join('data', 'logs'),
      join('data', 'backups'),
      join('src', 'plugins', 'generated')
    ]) {
      expect(existsSync(join(projectPath, rel)), rel).toBe(true)
    }
    // project.json 由 _buildFullConfig 补端口块；翻译器端口 = TRANSLATOR_BASE(43100) + block
    // （shared/config/ports.ts 的 translatorPortForBlock；10/18 产物里就是这个公式，不是 1000+block）
    const raw = JSON.parse(await readFile(join(projectPath, '.qqbat', 'project.json'), 'utf-8'))
    expect(raw.portBlock).toBeGreaterThanOrEqual(1)
    expect(raw.translatorPort).toBe(43100 + Math.min(raw.portBlock, 80))
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
    // 从 recent.json 里移除后，工作区扫描会把仍存在的 bot-a 自动补回（项目没删，不该凭空消失）
    const recentFileAfterRemove = JSON.parse(await readFile(join(tmpRoot, 'qqbat', 'recent.json'), 'utf-8'))
    expect(recentFileAfterRemove.map((r: { name: string }) => r.name)).toEqual(['bot-b'])
    const after = await svc.listRecentProjects()
    expect(after.map((r) => r.name)).toEqual(['bot-b', 'bot-a'])
  })

  it('recent.json 为空时，按工作区里真实存在的项目自愈', async () => {
    const svc = new ProjectService(tmpRoot)
    const a = await svc.createProject(makeConfig({ name: 'bot-heal-a', qq: '1' }))
    const b = await svc.createProject(makeConfig({ name: 'bot-heal-b', qq: '2' }))
    await svc.recordRecentProject(a)
    await svc.recordRecentProject(b)

    // 模拟「最近项目被剪空 / 文件丢了」后重开应用
    const recentFile = join(tmpRoot, 'qqbat', 'recent.json')
    await writeFile(recentFile, '[]')

    const healed = await svc.listRecentProjects()
    expect(healed.map((r) => r.name).sort()).toEqual(['bot-heal-a', 'bot-heal-b'])
    // 补回来的条目也会落盘，下次开就不用再扫
    const persisted = JSON.parse(await readFile(recentFile, 'utf-8'))
    expect(persisted.map((r: { name: string }) => r.name).sort()).toEqual(['bot-heal-a', 'bot-heal-b'])
  })

  it('最近项目里混进已不存在的路径时，读列表会剪掉并回写', async () => {
    const svc = new ProjectService(tmpRoot)
    const alive = await svc.createProject(makeConfig({ name: 'bot-alive', qq: '1' }))
    await svc.recordRecentProject(alive)

    // 模拟「项目目录被改名/删除」后残留的死路径
    const recentFile = join(tmpRoot, 'qqbat', 'recent.json')
    const raw = JSON.parse(await readFile(recentFile, 'utf-8'))
    raw.unshift({
      id: 'dead-beef',
      name: 'ghost',
      path: join(tmpRoot, 'ghost-project'),
      lastOpenedAt: new Date().toISOString(),
    })
    await writeFile(recentFile, JSON.stringify(raw, null, 2))

    expect((await svc.listRecentProjects()).map((r) => r.name)).toEqual(['bot-alive'])
    // 回写后文件里也不再留死路径，不会一直占着最近列表的位置
    const persisted = JSON.parse(await readFile(recentFile, 'utf-8'))
    expect(persisted.map((r: { name: string }) => r.name)).toEqual(['bot-alive'])
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