// src/main/services/ai/projectAiConfig.ts
//
// 项目级 AI 配置（`.qqbat/project.json` 的两个字段）：
//   · ai    = 旧版作者助手配置（已被应用级 ai-config.json 取代，只读兜底）
//   · botAi = 机器人运行时（群里应答）专用模型；缺省 = 跟随应用级配置
//
// 只负责**读/写这两个字段**，不碰配置优先级 —— 优先级在 appAiConfig.resolveAuthorAiConfig。
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { atomicWrite } from '../infra/fileOps';
import { logger } from '../infra/logger';
import type { AiConfig } from '@shared/types/ai';

export interface ProjectAiConfigs {
  ai?: AiConfig;
  botAi?: AiConfig;
}

export function projectConfigPath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'project.json');
}

function asConfig(value: unknown): AiConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== 'string' || !v.provider) return undefined;
  if (typeof v.model !== 'string' || !v.model) return undefined;
  return {
    provider: v.provider as AiConfig['provider'],
    apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
    model: v.model,
    ...(typeof v.baseUrl === 'string' && v.baseUrl ? { baseUrl: v.baseUrl } : {}),
  };
}

export async function readProjectAiConfig(projectPath: string): Promise<ProjectAiConfigs> {
  const file = projectConfigPath(projectPath);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return { ai: asConfig(raw.ai), botAi: asConfig(raw.botAi) };
  } catch (e) {
    logger.warn(`[ai] 读取项目 AI 配置失败（按未配置处理）: ${String(e)}`);
    return {};
  }
}

export async function readProjectBotAiConfig(projectPath: string): Promise<AiConfig | null> {
  return (await readProjectAiConfig(projectPath)).botAi ?? null;
}

export async function writeProjectBotAiConfig(
  projectPath: string,
  config: AiConfig | null,
): Promise<void> {
  const file = projectConfigPath(projectPath);
  if (!existsSync(file)) {
    logger.warn('[ai] 项目配置不存在，跳过写 botAi: ' + file);
    return;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    logger.warn(`[ai] 项目配置不是合法 JSON，跳过写 botAi: ${String(e)}`);
    return;
  }
  if (config) raw.botAi = config;
  else delete raw.botAi;
  await atomicWrite(file, JSON.stringify(raw, null, 2));
}
