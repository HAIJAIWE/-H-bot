// src/main/ipc/aiProvider.ts
import { ipcMain } from 'electron'
import { providerRegistry } from '@shared/types/ai-provider'
import { tryIpc, tryIpcAsync, errorMessage } from './_shared'
import { aiProviderTestSchema, aiProviderSwitchSchema } from '../schemas/aiProvider'

export function registerAIProviderIpc(): void {
  // 列出可用 Provider
  ipcMain.handle('aiProvider:list', async () => {
    return tryIpc(() => {
      const providers = providerRegistry.list()
      const current = providerRegistry.getCurrent()
      return { providers, current }
    })
  })

  // 测试连接
  ipcMain.handle('aiProvider:test', async (_event, args: unknown) => {
    const parsed = aiProviderTestSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    try {
      const provider = providerRegistry.getOrCreate(parsed.data.provider, parsed.data)

      const testMessages = [
        { role: 'user', content: '回复"连接成功"四个字（不要多余内容）' }
      ] as { role: 'user'; content: string }[]

      let result = ''
      await provider.chat(testMessages, [], {
        onChunk: (chunk: { content: string }) => { result += chunk.content },
        onComplete: () => {}
      })

      return { ok: true, data: { response: result.trim() || '连接成功（无返回内容）' } }
    } catch (e) {
      return { ok: false, error: `连接失败: ${errorMessage(e)}` }
    }
  })

  // 切换当前 Provider
  ipcMain.handle('aiProvider:switch', async (_event, args: unknown) => {
    const parsed = aiProviderSwitchSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      if (!providerRegistry.has(parsed.data.provider)) {
        throw new Error(`未知的 Provider: ${parsed.data.provider}`)
      }

      // 创建/获取实例并设为当前
      providerRegistry.getOrCreate(parsed.data.provider, parsed.data.config)
      providerRegistry.setCurrent(parsed.data.provider)

      return { provider: parsed.data.provider }
    })
  })

  // 获取 Provider 配置
  ipcMain.handle('aiProvider:getConfig', async () => {
    return tryIpc(() => {
      const current = providerRegistry.getCurrent()
      return { current }
    })
  })
}
