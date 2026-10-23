// src/main/services/ai/appAiConfig.ts
//
// 「全局智能体」配置 —— 存在**应用级**，不属于任何项目。
//
// 三层配置，各自只读自己那份：
//   %APPDATA%/qqbat/config/ai-config.json   ← ① 全局智能体（本文件）
//   <项目>/.qqbat/project.json 的 ai        ← 历史字段，一次性迁移后只读兜底
//   <项目>/.qqbat/project.json 的 botAi     ← ② 该项目的机器人运行时（缺省=跟随全局）
//
// API Key 走系统加密（safeStorage）：落盘的是密文 + _encrypted: true，读取时解密。
// 加密不可用时明文落盘但记日志 —— 静默降级比报错更危险（用户以为自己有加密）。
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { existingUserDataPath, userDataPath } from '../infra/paths';
import { atomicWrite } from '../infra/fileOps';
import { logger } from '../infra/logger';
import { isEncryptionAvailable, encryptSecret, tryDecryptSecret } from '../infra/safeStorage';
import type { LlmConfig } from './llm';
import {
  readProjectAiConfig,
  readProjectBotAiConfig,
  writeProjectBotAiConfig,
} from './projectAiConfig';

export { readProjectBotAiConfig, writeProjectBotAiConfig };

/** 落盘形状：apiKey 可能是密文，_encrypted 标记它到底是不是 */
interface StoredProvider {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  _encrypted?: boolean;
}

interface StoredAppConfig extends StoredProvider {
  enableThinking?: boolean;
  fallbacks?: StoredProvider[];
}

function configPathForRead(): string | null {
  return existingUserDataPath('aiConfig');
}

function configPathForWrite(): string | null {
  return userDataPath('aiConfig');
}

function decodeApiKey(stored: StoredProvider): string {
  if (!stored.apiKey) return '';
  if (!stored._encrypted) return stored.apiKey;
  return tryDecryptSecret(stored.apiKey);
}

function decodeProvider(stored: StoredProvider): LlmConfig | null {
  if (!stored || typeof stored.provider !== 'string' || !stored.provider) return null;
  if (typeof stored.model !== 'string' || !stored.model) return null;
  const decoded = decodeApiKey(stored);
  return {
    provider: stored.provider,
    apiKey: decoded,
    model: stored.model,
    ...(typeof stored.baseUrl === 'string' && stored.baseUrl ? { baseUrl: stored.baseUrl } : {}),
  };
}

function encodeProvider(config: LlmConfig): StoredProvider {
  const encrypt = isEncryptionAvailable() && !!config.apiKey;
  return {
    provider: config.provider,
    apiKey: encrypt ? encryptSecret(config.apiKey) : config.apiKey,
    model: config.model,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(encrypt ? { _encrypted: true } : {}),
  };
}

/** 读应用级配置；文件不存在 / 不是合法 JSON / 缺必填字段 ⇒ null（按未配置处理） */
export async function readAppAiConfig(): Promise<LlmConfig | null> {
  const file = configPathForRead();
  if (!file || !existsSync(file)) return null;
  let raw: StoredAppConfig;
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as StoredAppConfig;
  } catch (e) {
    logger.warn('[ai] 读取应用级 AI 配置失败（按未配置处理）: ' + String(e));
    return null;
  }
  const config = decodeProvider(raw);
  if (!config) return null;
  if (raw.enableThinking !== undefined) config.enableThinking = raw.enableThinking;
  if (Array.isArray(raw.fallbacks)) {
    const fallbacks = raw.fallbacks
      .map((entry) => decodeProvider(entry))
      .filter((entry): entry is LlmConfig => entry !== null);
    if (fallbacks.length > 0) config.fallbacks = fallbacks;
  }
  return config;
}

async function readStoredAppConfig(): Promise<StoredAppConfig | null> {
  const file = configPathForRead();
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as StoredAppConfig;
  } catch (e) {
    logger.warn('[ai] 读取应用级 AI 配置失败: ' + String(e));
    return null;
  }
}

async function writeStoredAppConfig(config: StoredAppConfig): Promise<void> {
  const file = configPathForWrite();
  if (!file) {
    logger.warn('[ai] userData 不可用，跳过写应用级 AI 配置');
    return;
  }
  await atomicWrite(file, JSON.stringify(config, null, 2));
}

/** 整份覆盖写。调用方要改单个字段请先 read 再写（或走 writeAppAiFallbacks） */
export async function writeAppAiConfig(config: LlmConfig): Promise<void> {
  const stored: StoredAppConfig = {
    ...encodeProvider(config),
    ...(config.enableThinking !== undefined ? { enableThinking: config.enableThinking } : {}),
    ...(config.fallbacks && config.fallbacks.length > 0
      ? { fallbacks: config.fallbacks.map((entry) => encodeProvider(entry)) }
      : {}),
  };
  await writeStoredAppConfig(stored);
}

/** 只改回退链，保留主配置的其余字段 */
export async function writeAppAiFallbacks(fallbacks: LlmConfig[]): Promise<void> {
  const stored = await readStoredAppConfig();
  if (!stored) {
    logger.warn('[ai] 应用级 AI 配置不存在，跳过写回退链');
    return;
  }
  if (fallbacks.length === 0) delete stored.fallbacks;
  else stored.fallbacks = fallbacks.map((entry) => encodeProvider(entry));
  await writeStoredAppConfig(stored);
}

/**
 * 作者助手实际使用的配置（**全局优先，项目历史字段兜底**）。
 * 读不到就返回 null —— 调用方据此显示「未配置」，而不是拿一个空 provider 去调用。
 */
export async function resolveAuthorAiConfig(projectPath: string): Promise<LlmConfig | null> {
  const app = await readAppAiConfig();
  if (app) return app;
  const project = await readProjectAiConfig(projectPath).catch(() => null);
  const legacy = project?.ai;
  if (!legacy) return null;
  return {
    provider: legacy.provider,
    apiKey: legacy.apiKey,
    model: legacy.model,
    ...(legacy.baseUrl ? { baseUrl: legacy.baseUrl } : {}),
  };
}
