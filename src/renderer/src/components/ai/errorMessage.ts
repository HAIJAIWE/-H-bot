// src/renderer/src/components/ai/errorMessage.ts
//
// **把模型报错翻译成人话**。
//
// ## 为什么（2026-10-08 真机）
//
// 用户报「新建对话好像没用」——实际是模型 403 额度用尽。界面之所以帮不上忙，
// 是因为它把错误原样吐出来：
//
//     ⚠️ AI 出错：ProviderHttpError: OpenAI API 请求失败 (403):
//     {"error":{"message":"Free quota exhausted. ..."}}
//
// 对用户**等于没说**：他不知道该充值、换 Key，还是查网络。
//
// ## 口径
//
// 这里**只返回 i18n 的 key 与参数**，不写死任何面向用户的文案 ——
// 文案在语言包里（界面文案闸门也要求如此），本文件保持纯函数、可穷举测试。
// **原始错误仍然进日志**（main.log 里那行 `[ai] 本轮失败：` 一个字不变），
// 那是给排查用的；界面上给的是"该怎么办"。

/** 把 HTTP 状态码包成可读小尾巴（没有就留空，文案里对应 {code}） */
function wrap(code: string): string {
  return code ? `（${code}）` : '';
}

/** 分类结果：i18n key + 插值参数 */
export interface AiErrorHint {
  key: string;
  params?: Record<string, string>;
}

/**
 * 把原始错误串分类。**顺序有意义**：先判额度，再判鉴权 ——
 * 因为额度用尽同样返回 403，先判 401 会把它误报成 Key 问题。
 */
export function classifyAiError(raw: string): AiErrorHint {
  const s = String(raw ?? '').toLowerCase();
  const codeMatch = String(raw ?? '').match(/\b(4\d\d|5\d\d)\b/);
  const code = codeMatch ? codeMatch[1] : '';

  // ① 模型不支持看图（贴了图但模型是纯文本的 —— 最可能踩的一条，先说清楚）
  if (
    s.includes('does not support image') ||
    s.includes('image_url') ||
    s.includes('vision') ||
    s.includes('multimodal') ||
    s.includes('unsupported content') ||
    s.includes('invalid content type')
  ) {
    return { key: 'ai.err.vision' };
  }

  // ② 额度/余额（403 + Free quota exhausted / insufficient balance …）
  if (
    s.includes('quota') ||
    s.includes('exhausted') ||
    s.includes('insufficient') ||
    s.includes('balance') ||
    s.includes('欠费') ||
    s.includes('余额')
  ) {
    return { key: 'ai.err.quota', params: { code: wrap(code) } };
  }

  // ③ 鉴权（401 / invalid api key / unauthorized）
  if (
    s.includes('401') ||
    s.includes('invalid api key') ||
    s.includes('incorrect api key') ||
    s.includes('unauthorized') ||
    s.includes('authentication')
  ) {
    return { key: 'ai.err.auth', params: { code: wrap(code) } };
  }

  // ④ 限流（429 / rate limit）
  if (s.includes('429') || s.includes('rate limit') || s.includes('too many requests')) {
    return { key: 'ai.err.rateLimit' };
  }

  // ⑤ 连不上（超时 / 拒绝 / DNS / 代理）
  if (
    s.includes('timeout') ||
    s.includes('etimedout') ||
    s.includes('econnrefused') ||
    s.includes('enotfound') ||
    s.includes('fetch failed') ||
    s.includes('network') ||
    s.includes('socket')
  ) {
    return { key: 'ai.err.network' };
  }

  // ⑥ 认不出来：把原文截断后原样给用户（总比什么都不说强），完整那份在日志里
  const detail = String(raw ?? '');
  return {
    key: 'ai.err.other',
    params: { detail: detail.length > 300 ? `${detail.slice(0, 300)}…` : detail },
  };
}
