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
//
// ## 回退链（fallbacks）为什么必须「读-改-写」
//
// 回退链只由用户**手写**进 ai-config.json，界面不编辑它。而界面点一次「保存」走的是
// `writeAppAiConfig` 整份覆盖 —— 如果调用方没带 fallbacks 就直接清空，用户的 Key 池
// 会在一次无关的保存里凭空消失。所以：调用方带了就用调用方的，没带就把磁盘上那份
// **原样写回**（密文保持密文，不解密再加密 —— 换机器后密钥会变，重加密会毁掉它）。
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { existingUserDataPath, userDataPath } from '../infra/paths';
import { atomicWrite } from '../infra/fileOps';
import { logger } from '../infra/logger';
import { isEncryptionAvailable, encryptSecret, tryDecryptSecret } from '../infra/safeStorage';
import type { LlmConfig } from './llm';
import type { ProjectAiConfigs } from './projectAiConfig';
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
  enableThinking?: boolean;
  _encrypted?: boolean;
}

interface StoredAppConfig extends StoredProvider {
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
  const config: LlmConfig = {
    provider: stored.provider,
    apiKey: decoded,
    model: stored.model,
  };
  if (typeof stored.baseUrl === 'string' && stored.baseUrl) config.baseUrl = stored.baseUrl;
  // enableThinking 是「关思考」三态开关：只搬运显式写下的值，缺省不补 false。
  if (typeof stored.enableThinking === 'boolean') config.enableThinking = stored.enableThinking;
  return config;
}

function encodeProvider(config: LlmConfig): StoredProvider {
  const encrypt = isEncryptionAvailable() && !!config.apiKey;
  const stored: StoredProvider = {
    provider: config.provider,
    apiKey: encrypt ? encryptSecret(config.apiKey) : config.apiKey,
    model: config.model,
  };
  if (config.baseUrl) stored.baseUrl = config.baseUrl;
  if (config.enableThinking !== undefined) stored.enableThinking = config.enableThinking;
  if (encrypt) stored._encrypted = true;
  return stored;
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
  if (Array.isArray(raw.fallbacks)) {
    // 单条坏掉的备胎只丢那一条（并留痕），不因此判定整份配置不可用 ——
    // 否则用户会看到「全局智能体突然未配置」，而真正原因只是池里一条缺 model。
    const fallbacks: LlmConfig[] = [];
    for (const entry of raw.fallbacks) {
      const decoded = decodeProvider(entry);
      if (decoded) fallbacks.push(decoded);
      else logger.warn('[ai] 跳过一条字段不完整的 provider 回退项');
    }
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

/**
 * 磁盘上那份 fallbacks 的**原始形状**（密文保持原样）。
 *
 * 用途只有一个：`writeAppAiConfig` 在调用方没带 fallbacks 时把它原样写回。
 * 走 `raw` 而不是 `readAppAiConfig()`，是因为后者会解密 + 丢掉坏条目，再加密回去既可能
 * 解不开（换机器），也可能把用户手写的内容裁掉。
 */
async function readStoredFallbacksRaw(): Promise<StoredProvider[] | undefined> {
  const stored = await readStoredAppConfig();
  const raw = stored?.fallbacks;
  return Array.isArray(raw) && raw.length > 0 ? raw : undefined;
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
  const incoming = config.fallbacks;
  const fallbacks =
    incoming && incoming.length > 0 ? incoming.map((entry) => encodeProvider(entry)) : await readStoredFallbacksRaw();
  const stored: StoredAppConfig = encodeProvider(config);
  if (fallbacks && fallbacks.length > 0) stored.fallbacks = fallbacks;
  await writeStoredAppConfig(stored);
}

/** 只改回退链，保留主配置的其余字段 */
export async function writeAppAiFallbacks(fallbacks: LlmConfig[]): Promise<void> {
  const stored = await readStoredAppConfig();
  if (!stored) {
    // 与 10/18 客户端一致：这里**抛错**而不是安静跳过 —— IPC 会把它变成界面上的失败提示。
    // 之前的实现只 warn 然后 return，界面拿到 saved:true，用户以为存上了。
    throw new Error('还没有应用级 AI 配置，先保存一次主配置再编辑 Key 池');
  }
  if (fallbacks.length === 0) delete stored.fallbacks;
  else stored.fallbacks = fallbacks.map((entry) => encodeProvider(entry));
  await writeStoredAppConfig(stored);
}

/**
 * 作者助手实际使用的配置（**全局优先，项目历史字段兜底**）。
 * 读不到就返回 null —— 调用方据此显示「未配置」，而不是拿一个空 provider 去调用。
 */
export async function resolveAuthorAiConfig(projectPath?: string): Promise<LlmConfig | null> {
  const app = await readAppAiConfig();
  if (app) return app;
  if (!projectPath) return null;
  const project = await readProjectAiConfig(projectPath).catch(
    (): ProjectAiConfigs => ({}),
  );
  const legacy = project.ai;
  if (!legacy) return null;
  const resolved: LlmConfig = {
    provider: legacy.provider,
    apiKey: legacy.apiKey,
    model: legacy.model,
  };
  if (legacy.baseUrl) resolved.baseUrl = legacy.baseUrl;
  if (legacy.enableThinking !== undefined) resolved.enableThinking = legacy.enableThinking;
  if (legacy.fallbacks && legacy.fallbacks.length > 0) resolved.fallbacks = legacy.fallbacks;
  return resolved;
}
