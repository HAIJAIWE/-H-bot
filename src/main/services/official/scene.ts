// src/main/services/official/scene.ts
//
// 官方 `message_scene.ext` 解析（纯函数）。
//
// 官方给的是 `["msg_idx=REFIDX_x", "auth_token=…", "ref_msg_idx=…"]` 这种 `k=v` 列表；
// 历史实现里也可能塞 JSON 字符串，所以两种都认 —— 认不出的条目直接跳过，不抛。
//
// 之前它在 monolithic 的 `services/official.ts` 里；统一到 `official/` 后仍是纯函数，
// 留给接收侧解析引用消息时使用（当前事件解析只在 attachments 上取用，见 ws.ts:parseOfficialEvent）。
export function parseMessageSceneExt(ext: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(ext)) return out
  for (const item of ext) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    if (!s) continue
    if (s.startsWith('{')) {
      try {
        const obj = JSON.parse(s) as Record<string, unknown>
        for (const [k, v] of Object.entries(obj)) {
          if (v !== null && v !== undefined) out[k] = String(v)
        }
      } catch {
        // 不是合法 JSON：当作普通字符串，下面按 k=v 再试一次
        const idx = s.indexOf('=')
        if (idx > 0) out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim()
      }
      continue
    }
    const idx = s.indexOf('=')
    if (idx <= 0) continue
    out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim()
  }
  return out
}
