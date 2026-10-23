// tests/main/services/ai/appAiConfig.test.ts
//
// 全局智能体配置的读写语义（与 10/18 客户端对齐）：
//   · 读：新位置优先、旧位置（userData 根下 ai-config.json）双读；坏 JSON / 缺字段按「未配置」
//   · 写：整份覆盖，但**调用方没带 fallbacks 时把磁盘上那份原样写回**（界面保存不能抹掉 Key 池）
//   · Key 池单独写：没有主配置时明确报错，而不是安静跳过
//   · 项目的 botAi：密文 + _encrypted 落盘，读时解密（旧版写下的密文也要能读）
//
// 路径全部落在临时目录里：QQBAT_USER_DATA_DIR 在**动态 import 之前**设置（paths.ts 有进程级缓存）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import * as mod from '@main/services/ai/appAiConfig'

/**
 * 路径全部落在临时目录里。这里**不**用 QQBAT_USER_DATA_DIR：paths.ts 有进程级缓存，
 * 而 logger 在 import 期就会取一次 logs 目录 —— 缓存一旦落成 null，后面再设环境变量也没用。
 * 直接 mock 掉 paths 模块，测试只关心 appAiConfig 的读写语义。
 */
const pathsState = vi.hoisted(() => ({ root: '' }))

vi.mock('@main/services/infra/paths', async () => {
  const { join } = await import('node:path')
  const { existsSync } = await import('node:fs')
  const currentPath = () => join(pathsState.root, 'config', 'ai-config.json')
  const legacyPath = () => join(pathsState.root, 'ai-config.json')
  return {
    USER_DATA_LAYOUT: {},
    LEGACY_USER_DATA_LAYOUT: {},
    userDataRoot: () => pathsState.root || null,
    userDataPath: () => currentPath(),
    userDataPathOrThrow: () => currentPath(),
    legacyUserDataPath: () => legacyPath(),
    existingUserDataPath: () => (existsSync(currentPath()) ? currentPath() : existsSync(legacyPath()) ? legacyPath() : currentPath()),
    runtimeDir: () => null,
  }
})

/** 可控的「系统加密」开关：mock 里用 enc: 前缀模拟密文，能验证落盘形状 */
const cryptoState = vi.hoisted(() => ({ available: false }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => cryptoState.available,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
  },
  app: { getPath: () => '' },
}))

let root = ''
let projectPath = ''

function appConfigFile(): string {
  return join(root, 'config', 'ai-config.json')
}
function legacyConfigFile(): string {
  return join(root, 'ai-config.json')
}
function projectFile(): string {
  return join(projectPath, '.qqbat', 'project.json')
}
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}
function readJson(file: string): any {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 落盘的密文是 base64（safeStorage 的 encryptString 返回 Buffer，外层再 toString('base64')） */
function isEncryptedValue(value: string): boolean {
  return Buffer.from(value, 'base64').toString('utf8').startsWith('enc:')
}

/** 模拟旧版客户端写下的密文 */
function asStoredCipher(plain: string): string {
  return Buffer.from(`enc:${plain}`, 'utf8').toString('base64')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'qqbat-aiconf-'))
  projectPath = mkdtempSync(join(tmpdir(), 'qqbat-aiproject-'))
  pathsState.root = root
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(projectPath, { recursive: true, force: true })
})

beforeEach(() => {
  cryptoState.available = false
  rmSync(join(root, 'config'), { recursive: true, force: true })
  rmSync(legacyConfigFile(), { force: true })
  rmSync(join(projectPath, '.qqbat'), { recursive: true, force: true })
  mkdirSync(join(projectPath, '.qqbat'), { recursive: true })
})

describe('readAppAiConfig：读不到就是 null，不让调用方拿到半份配置', () => {
  it('文件不存在 → null', async () => {
    await expect(mod.readAppAiConfig()).resolves.toBeNull()
  })

  it('合法明文配置 → 原样返回（含 enableThinking）', async () => {
    writeJson(appConfigFile(), {
      provider: 'dashscope',
      apiKey: 'sk-plain',
      model: 'qwen3.8-flash',
      baseUrl: 'https://example.test/v1',
      enableThinking: false,
    })
    await expect(mod.readAppAiConfig()).resolves.toEqual({
      provider: 'dashscope',
      apiKey: 'sk-plain',
      model: 'qwen3.8-flash',
      baseUrl: 'https://example.test/v1',
      enableThinking: false,
    })
  })

  it('fallbacks 逐条解析，坏掉的那条只丢自己', async () => {
    writeJson(appConfigFile(), {
      provider: 'deepseek',
      apiKey: 'sk-main',
      model: 'deepseek-chat',
      fallbacks: [
        { provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash', enableThinking: true },
        { apiKey: 'sk-broken' },
      ],
    })
    const config = await mod.readAppAiConfig()
    expect(config?.fallbacks).toEqual([
      { provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash', enableThinking: true },
    ])
  })

  it('新位置不存在时回落 userData 根下的旧文件（双读）', async () => {
    writeJson(legacyConfigFile(), { provider: 'ollama', apiKey: '', model: 'qwen2.5:7b' })
    const config = await mod.readAppAiConfig()
    expect(config?.provider).toBe('ollama')
    expect(config?.apiKey).toBe('')
  })

  it('坏 JSON → null，不抛', async () => {
    mkdirSync(dirname(appConfigFile()), { recursive: true })
    writeFileSync(appConfigFile(), '{ not json', 'utf8')
    await expect(mod.readAppAiConfig()).resolves.toBeNull()
  })
})

describe('writeAppAiConfig：整份覆盖写，但不能抹掉手写的 Key 池', () => {
  it('能加密时落盘密文 + _encrypted，读回来是明文', async () => {
    cryptoState.available = true
    await mod.writeAppAiConfig({ provider: 'dashscope', apiKey: 'sk-secret', model: 'qwen3.8-flash' })
    const stored = readJson(appConfigFile())
    expect(isEncryptedValue(stored.apiKey)).toBe(true)
    expect(stored._encrypted).toBe(true)
    expect((await mod.readAppAiConfig())?.apiKey).toBe('sk-secret')
  })

  it('调用方没带 fallbacks → 磁盘上那份原样写回（密文保持密文）', async () => {
    writeJson(appConfigFile(), {
      provider: 'deepseek',
      apiKey: 'sk-old',
      model: 'deepseek-chat',
      fallbacks: [{ provider: 'dashscope', apiKey: 'sk-fb-cipher', model: 'qwen3.8-flash', _encrypted: true }],
    })
    await mod.writeAppAiConfig({ provider: 'deepseek', apiKey: 'sk-new', model: 'deepseek-reasoner' })
    const stored = readJson(appConfigFile())
    expect(stored.fallbacks).toEqual([
      { provider: 'dashscope', apiKey: 'sk-fb-cipher', model: 'qwen3.8-flash', _encrypted: true },
    ])
    expect(stored.model).toBe('deepseek-reasoner')
  })

  it('调用方带了 fallbacks → 用调用方那份覆盖', async () => {
    cryptoState.available = true
    writeJson(appConfigFile(), {
      provider: 'deepseek',
      apiKey: 'sk-old',
      model: 'deepseek-chat',
      fallbacks: [{ provider: 'old', apiKey: 'sk-old-fb', model: 'old-model' }],
    })
    await mod.writeAppAiConfig({
      provider: 'deepseek',
      apiKey: 'sk-new',
      model: 'deepseek-chat',
      fallbacks: [{ provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash' }],
    })
    const stored = readJson(appConfigFile())
    expect(stored.fallbacks).toHaveLength(1)
    expect(stored.fallbacks[0].provider).toBe('dashscope')
    expect(isEncryptedValue(stored.fallbacks[0].apiKey)).toBe(true)
    expect((await mod.readAppAiConfig())?.fallbacks?.[0].apiKey).toBe('sk-fb')
  })
})

describe('writeAppAiFallbacks：只换 Key 池，主配置原样', () => {
  it('没有主配置时明确抛错（IPC 会把它变成界面上的失败提示）', async () => {
    await expect(
      mod.writeAppAiFallbacks([{ provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash' }]),
    ).rejects.toThrow('还没有应用级 AI 配置')
  })

  it('有主配置时保留 provider/model，替换 fallbacks', async () => {
    writeJson(appConfigFile(), { provider: 'deepseek', apiKey: 'sk-main', model: 'deepseek-chat' })
    await mod.writeAppAiFallbacks([{ provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash' }])
    const stored = readJson(appConfigFile())
    expect(stored).toMatchObject({ provider: 'deepseek', apiKey: 'sk-main', model: 'deepseek-chat' })
    expect(stored.fallbacks).toHaveLength(1)
    expect((await mod.readAppAiConfig())?.fallbacks?.[0].provider).toBe('dashscope')
  })
})

describe('resolveAuthorAiConfig：全局优先，项目 ai 字段兜底', () => {
  it('全局存在时直接用它（项目里的旧字段不参与）', async () => {
    writeJson(appConfigFile(), { provider: 'deepseek', apiKey: 'sk-global', model: 'deepseek-chat' })
    writeJson(projectFile(), { ai: { provider: 'ollama', apiKey: '', model: 'legacy' } })
    const config = await mod.resolveAuthorAiConfig(projectPath)
    expect(config?.provider).toBe('deepseek')
  })

  it('没有全局配置时回落到项目的历史 ai 字段（含 enableThinking / fallbacks）', async () => {
    writeJson(projectFile(), {
      ai: {
        provider: 'ollama',
        apiKey: '',
        model: 'qwen2.5:7b',
        enableThinking: true,
        fallbacks: [{ provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash' }],
      },
    })
    const config = await mod.resolveAuthorAiConfig(projectPath)
    expect(config).toEqual({
      provider: 'ollama',
      apiKey: '',
      model: 'qwen2.5:7b',
      enableThinking: true,
      fallbacks: [{ provider: 'dashscope', apiKey: 'sk-fb', model: 'qwen3.8-flash' }],
    })
  })

  it('两边都没有 → null；不传项目路径也不报错', async () => {
    await expect(mod.resolveAuthorAiConfig(projectPath)).resolves.toBeNull()
    await expect(mod.resolveAuthorAiConfig()).resolves.toBeNull()
  })
})

describe('项目 botAi：加密落盘、解密读取，且不碰 project.json 其它字段', () => {
  const botAi = {
    provider: 'dashscope' as const,
    apiKey: 'sk-bot',
    model: 'qwen3.8-flash',
    enableThinking: false,
    fallbacks: [{ provider: 'deepseek' as const, apiKey: 'sk-bot-fb', model: 'deepseek-chat' }],
  }

  it('能加密时落盘 _encrypted，读回来是明文，adapter 等字段保留', async () => {
    cryptoState.available = true
    writeJson(projectFile(), { adapter: 'official', translatorPort: 1001 })
    await mod.writeProjectBotAiConfig(projectPath, botAi)
    const stored = readJson(projectFile())
    expect(stored).toMatchObject({ adapter: 'official', translatorPort: 1001 })
    expect(isEncryptedValue(stored.botAi.apiKey)).toBe(true)
    expect(stored.botAi._encrypted).toBe(true)
    expect(isEncryptedValue(stored.botAi.fallbacks[0].apiKey)).toBe(true)
    await expect(mod.readProjectBotAiConfig(projectPath)).resolves.toEqual(botAi)
  })

  it('null 表示「跟随全局」：删除 botAi，其它字段不动', async () => {
    writeJson(projectFile(), { adapter: 'official', botAi: { provider: 'ollama', apiKey: '', model: 'x' } })
    await mod.writeProjectBotAiConfig(projectPath, null)
    const stored = readJson(projectFile())
    expect(stored.botAi).toBeUndefined()
    expect(stored.adapter).toBe('official')
    await expect(mod.readProjectBotAiConfig(projectPath)).resolves.toBeNull()
  })

  it('能读旧版写下的密文 botAi（兼容客户端数据）', async () => {
    cryptoState.available = true
    writeJson(projectFile(), {
      botAi: { provider: 'dashscope', apiKey: asStoredCipher('sk-legacy'), model: 'qwen3.8-flash', _encrypted: true },
    })
    const config = await mod.readProjectBotAiConfig(projectPath)
    expect(config?.apiKey).toBe('sk-legacy')
  })

  it('解不开的密文按空 key 处理，不抛', async () => {
    cryptoState.available = false
    writeJson(projectFile(), {
      botAi: { provider: 'dashscope', apiKey: 'enc:sk-legacy', model: 'qwen3.8-flash', _encrypted: true },
    })
    await expect(mod.readProjectBotAiConfig(projectPath)).resolves.toEqual({
      provider: 'dashscope',
      apiKey: '',
      model: 'qwen3.8-flash',
    })
  })
})
