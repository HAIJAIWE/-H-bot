// src/renderer/src/components/ai/presetOptions.ts
//
// 会话预设的**解析规则**（与界面无关的纯函数）：读 `.qqbat/agent-presets.json` 的原始 JSON，
// 归一出"选项 + 元信息"。改名自 PresetSelect.tsx —— DSH 里预设选择器是一个菜单而不是
// 一个原生下拉（`ui-agent-preset`：内置与自定义分组、当前项高亮、创建/修改另开入口），
// 我们的菜单要用同一份规则，规则就该单独住在这儿，被菜单和测试直接引用。
//
// 三条最容易写错的规则仍然集中在这一个函数里：
//   · 键就是 name（与主进程 readPreset 同一条规则；文件里的 id 不参与选择）；
//   · 同名只留第一条（主进程写盘时同名后者覆盖前者，界面不该列出两个一样的）；
//   · 未知的 role / permissionMode 丢掉那一项，**不连坐整条预设**。
import type { AgentRole } from '@shared/ai/roleDomains'

/** 预设文件名（与主进程 services/ai/presets.ts 的 PRESETS_FILE 是同一份磁盘契约） */
export const PRESETS_FILE = '.qqbat/agent-presets.json'

export interface PresetMeta {
  permissionMode?: 'ask' | 'full'
  /** 这个预设以哪个角色为底（未声明 = 角色跟着页面走） */
  role?: AgentRole
  /** 工具白名单（已归一：非空字符串、去重；空 = 不限制，与主进程 readPresets 同义） */
  allowedTools?: string[]
  /** 运行时插件限定（同上：空 = 不限定） */
  plugins?: string[]
}

/** 菜单里一项（value 就是预设名：主进程按名字查预设，界面必须发同一个值） */
export interface PresetOption {
  name: string
}

/**
 * 白名单字段归一：只留非空字符串、去重（与 main/services/ai/presets.ts 的 readPresets 同规则）。
 * 额外把纯空白项 trim 掉 —— 主进程那边它只会匹配不到任何工具，而界面会把它算进
 * 「工具只留 N 个」，数字就说大了。
 */
function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names = value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0)
  return [...new Set(names)]
}

export function parsePresetOptions(data: unknown): {
  options: PresetOption[]
  meta: Record<string, PresetMeta>
} {
  const meta: Record<string, PresetMeta> = {}
  const options: PresetOption[] = []
  if (!Array.isArray(data)) return { options, meta }
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const m = item as {
      name?: unknown
      permissionMode?: unknown
      role?: unknown
      allowedTools?: unknown
      plugins?: unknown
    }
    const name = typeof m.name === 'string' ? m.name.trim() : ''
    if (!name) continue
    if (meta[name]) continue
    options.push({ name })
    meta[name] = {
      ...(m.permissionMode === 'full' || m.permissionMode === 'ask'
        ? { permissionMode: m.permissionMode }
        : {}),
      ...(m.role === 'builder' || m.role === 'coder' || m.role === 'duo' || m.role === 'creator'
        ? { role: m.role }
        : {}),
      // 空数组在主进程里等于"没写"（不限制），这里也归一成 undefined —— 否则界面会显示
      // 「工具只留 0 个」，而实际是全放行，刚好说反。
      ...(nameList(m.allowedTools).length > 0 ? { allowedTools: nameList(m.allowedTools) } : {}),
      ...(nameList(m.plugins).length > 0 ? { plugins: nameList(m.plugins) } : {}),
    }
  }
  return { options, meta }
}
