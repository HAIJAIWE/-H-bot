// src/main/services/ai/projectAiConfig.ts
//
// 项目级 AI 配置（`.qqbat/project.json` 的两个字段）：
//   · ai    = 旧版作者助手配置（已被应用级 ai-config.json 取代，只读兜底，明文）
//   · botAi = 机器人运行时（群里应答）专用模型；缺省 = 跟随应用级配置
//
// 只负责**读/写这两个字段**，不碰配置优先级 —— 优先级在 appAiConfig.resolveAuthorAiConfig。
//
// botAi 的 apiKey 与全局配置一样走 safeStorage：落盘密文 + `_encrypted: true`。
// 这与 10/18 客户端一致，也是兼容性要求：旧版写下的 botAi 是密文，不按标记解密就会
// 把密文当成 key 发出去（表现为「机器人模型突然 401」）；反过来，我们明文写进 project.json
// 的 key 在同一台机器上会被旧版当成明文正常用，但**安全性比基线差**。
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { atomicWrite } from '../infra/fileOps';
import { logger } from '../infra/logger';
import { isEncryptionAvailable, encryptSecret, tryDecryptSecret } from '../infra/safeStorage';
import type { AiConfig } from '@shared/types/ai';

export interface ProjectAiConfigs {
  ai?: AiConfig;
  botAi?: AiConfig;
}

/** 落盘形状：botAi 可能带 `_encrypted` 标记（`ai` 历史字段不会） */
interface StoredAiConfig extends AiConfig {
  _encrypted?: boolean;
}

export function projectConfigPath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'project.json');
}

/**
 * 把 project.json 里的一个字段解析成 AiConfig。
 *
 * `decrypt=true` 只给 botAi 用：旧版 `ai` 字段本来就是明文写的，对它解密只会得到空串。
 * 字段非法（缺 provider/model）返回 undefined —— 与 zod 校验失败同样按「未配置」处理。
 */
function asConfig(value: unknown, decrypt = false): AiConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== 'string' || !v.provider) return undefined;
  if (typeof v.model !== 'string' || !v.model) return undefined;
  const storedKey = typeof v.apiKey === 'string' ? v.apiKey : '';
  const apiKey = decrypt && v._encrypted === true && storedKey ? tryDecryptSecret(storedKey) : storedKey;
  const config: AiConfig = {
    provider: v.provider as AiConfig['provider'],
    apiKey,
    model: v.model,
  };
  if (typeof v.baseUrl === 'string' && v.baseUrl) config.baseUrl = v.baseUrl;
  if (typeof v.enableThinking === 'boolean') config.enableThinking = v.enableThinking;
  if (Array.isArray(v.fallbacks)) {
    const fallbacks: AiConfig[] = [];
    for (const entry of v.fallbacks) {
      const parsed = asConfig(entry, decrypt);
      if (parsed) fallbacks.push(parsed);
    }
    if (fallbacks.length > 0) config.fallbacks = fallbacks;
  }
  return config;
}

export async function readProjectAiConfig(projectPath: string): Promise<ProjectAiConfigs> {
  const file = projectConfigPath(projectPath);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    const result: ProjectAiConfigs = {};
    const ai = asConfig(raw.ai);
    if (ai) result.ai = ai;
    const botAi = asConfig(raw.botAi, true);
    if (botAi) result.botAi = botAi;
    return result;
  } catch (e) {
    logger.warn(`[ai] 读取项目 AI 配置失败（按未配置处理）: ${String(e)}`);
    return {};
  }
}

export async function readProjectBotAiConfig(projectPath: string): Promise<AiConfig | null> {
  return (await readProjectAiConfig(projectPath)).botAi ?? null;
}

/** 落盘编码：能加密就密文 + 标记，否则明文（调用方已记过 warn） */
function encodeBotAi(config: AiConfig, canEncrypt: boolean): StoredAiConfig {
  const stored: StoredAiConfig = {
    provider: config.provider,
    // 与客户端一致：空 key 也照样加密/标记，读取端解出来仍是空串。
    apiKey: canEncrypt ? encryptSecret(config.apiKey ?? '') : (config.apiKey ?? ''),
    model: config.model,
  };
  if (config.baseUrl) stored.baseUrl = config.baseUrl;
  if (config.enableThinking !== undefined) stored.enableThinking = config.enableThinking;
  if (canEncrypt) stored._encrypted = true;
  if (config.fallbacks && config.fallbacks.length > 0) {
    stored.fallbacks = config.fallbacks.map((entry) => encodeBotAi(entry, canEncrypt));
  }
  return stored;
}

export async function writeProjectBotAiConfig(
  projectPath: string,
  config: AiConfig | null,
): Promise<void> {
  const file = projectConfigPath(projectPath);
  let raw: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      // 与客户端唯一的刻意差异：project.json 解析失败时**不覆盖**。
      // 客户端那边会当成空对象接着写，等于把 adapter / translatorPort 等字段一起抹掉。
      logger.warn(`[ai] 项目配置不是合法 JSON，跳过写 botAi: ${String(e)}`);
      return;
    }
  }
  if (config) {
    const canEncrypt = isEncryptionAvailable();
    if (!canEncrypt) logger.warn('[ai] 系统加密不可用，项目的机器人 API Key 将以明文保存');
    raw.botAi = encodeBotAi(config, canEncrypt);
  } else {
    delete raw.botAi;
  }
  await atomicWrite(file, JSON.stringify(raw, null, 2));
}
