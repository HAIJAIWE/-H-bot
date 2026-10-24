// src/main/services/project.ts
//
// ⚠️ 这份**不是运行时实现**：serviceContainer.ts:7 取的是恢复副本
// `services/project/project.ts`（10/18 产物还原，带 activeProjectRegistry / 端口段公式）。
// 2026-10-24 踩过一次：在这份文件里改「最近项目剪掉死路径」，界面上毫无变化，
// 因为运行时根本没加载它。要改项目服务的行为，改 `project/project.ts`。
// 保留这份是为了后续收敛：它的注释/类型更干净，等恢复副本被它替换后删掉副本。
import { mkdir, writeFile, readFile, readdir, rm, cp } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  ProjectConfig,
  ProjectMeta,
  RecentProject,
} from '@shared/types/project';
import { FLOW_SCHEMA_VERSION } from '@shared/types/flow';
import { assertWithinProject } from './pathGuard';
import { logger } from './logger';
import { isEncryptionAvailable, encryptSecret, tryDecryptSecret } from './safeStorage';
import { atomicWrite } from './fileOps';
import { normalizeFlow, type NormalizableNode } from '@shared/nodes/flowNormalize';
import { migrateBotType } from '@shared/domain/project/botTypeConfig';

const APP_DATA_DIR = 'qqbat';
/** 最近项目列表最大保留数量 */
const MAX_RECENT_PROJECTS = 20;

function appDataRoot(baseDir: string): string {
  return join(baseDir, APP_DATA_DIR);
}

export class ProjectService {
  constructor(private baseDir: string) {}

  /** 暴露 baseDir 供其他服务做路径校验 */
  getBaseDir(): string {
    return this.baseDir;
  }

  private get appData(): string {
    return appDataRoot(this.baseDir);
  }

  async createProject(config: ProjectConfig): Promise<ProjectMeta> {
    const projectPath = join(this.baseDir, config.name);

    // 项目已存在：尝试加载（修复孤项目），否则抛错
    const existing = await this._tryLoadExistingProject(projectPath, config.name);
    if (existing) return existing;

    // 创建标准目录结构
    await this._createProjectDirectories(projectPath);

    // 准备完整配置：时间戳 + 端口块 + translatorPort
    const now = new Date().toISOString();
    const portBlock = await this.findNextPortBlock();
    const fullConfig = this._buildFullConfig(config, portBlock, now);

    // 写入 project.json
    await this.saveProjectConfig(projectPath, fullConfig);

    // 初始化 flow.json：空白流程（模板库已整体移除，见 _resolveInitialFlow 注释）
    const flow = await this._resolveInitialFlow(config);
    await this._writeFlowJson(projectPath, config, flow, now);

    // 生成 .env（运行时/部署用；不再生成 bot.py）
    await this._writeAdapterFiles(projectPath, fullConfig);

    return this._buildProjectMeta(config, projectPath, now);
  }

  /** 已存在项目：尝试加载并返回 ProjectMeta；不存在返回 null；存在但无配置文件抛错 */
  private async _tryLoadExistingProject(
    projectPath: string,
    projectName: string,
  ): Promise<ProjectMeta | null> {
    if (!existsSync(projectPath)) return null;
    const configPath = join(projectPath, '.qqbat', 'project.json');
    if (!existsSync(configPath)) {
      throw new Error(`项目已存在：${projectPath}`);
    }
    const existing = await this.loadProjectConfig(projectPath);
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      name: projectName,
      path: projectPath,
      qq: existing.qq,
      adapter: existing.adapter,
      botType: existing.botType,
      createdAt: existing.createdAt ?? now,
      updatedAt: now,
    };
  }

  /** 创建项目标准目录结构（.qqbat / data / src/plugins） */
  private async _createProjectDirectories(projectPath: string): Promise<void> {
    await mkdir(join(projectPath, '.qqbat', 'history'), { recursive: true });
    await mkdir(join(projectPath, 'data', 'players'), { recursive: true });
    await mkdir(join(projectPath, 'data', 'config'), { recursive: true });
    await mkdir(join(projectPath, 'data', 'config', '.schema'), { recursive: true });
    await mkdir(join(projectPath, 'data', 'logs'), { recursive: true });
    await mkdir(join(projectPath, 'data', 'backups'), { recursive: true });
    await mkdir(join(projectPath, 'src', 'plugins', 'generated'), { recursive: true });
    await mkdir(join(projectPath, 'src', 'plugins', 'custom'), { recursive: true });
  }

  /** 构建完整配置：合并时间戳与端口块，按适配器分配 translatorPort */
  private _buildFullConfig(config: ProjectConfig, portBlock: number, now: string): ProjectConfig {
    const fullConfig: ProjectConfig = { ...config, createdAt: now, updatedAt: now };
    fullConfig.portBlock = portBlock;
    // 按角色分配端口（ADR-003：只剩官方 API 一个适配器）：
    //   官方翻译器 = 1000 + block  (1001, 1002...)
    //   旧 NapCat 项目曾用 2000/3000 段（随 ADR-003 移除），历史项目按官方段重新分配
    fullConfig.translatorPort = 1000 + portBlock;
    return fullConfig;
  }

  /**
   * 解析初始 flow：**没有模板库了**（模板皆为 AI 生成的占位内容，已整体移除）。
   *
   * 新项目从空白画布开始：用户在调色板里自己搭。保留本方法是为了让调用方结构不变，
   * 同时明确记录"这里不再有任何模板来源"。
   */
  private _resolveInitialFlow(_config: ProjectConfig) {
    return { flowNodes: [] as unknown[], flowEdges: [] as unknown[] };
  }

  /**
   * 迁移旧 botType 值为新值（functional/game）
   * 检测到旧值时自动映射并回写 project.json
   *
   * ⚠️ 迁移表**只在 `shared/domain/project/botTypeConfig.ts` 定义一份**：
   * 这里以前又抄了一份（同一个映射两个真相，改一处漏一处）。
   */
  private async _migrateBotType(
    projectPath: string,
    config: ProjectConfig,
  ): Promise<ProjectConfig> {
    if (!config.botType) return config;
    const migrated = migrateBotType(config.botType);
    // 已经是新值 → 无需迁移、无需回写
    if (migrated.botType === config.botType) return config;
    config.botType = migrated.botType;
    await this.saveProjectConfig(projectPath, config);
    return config;
  }

  /** 写入 flow.json（空白 schema + 初始 nodes/edges，写入前经统一真相层补全端口） */
  private async _writeFlowJson(
    projectPath: string,
    config: ProjectConfig,
    flow: { flowNodes: unknown[]; flowEdges: unknown[] },
    now: string,
  ): Promise<void> {
    // 历史：内置模板只写 `{ id, kind, label, type, x, y, config }`，**不带端口定义**。
    // 若原样落盘，新项目从第一天起就是"残缺流程"：解释器拿到空 kwargs（不回复）、
    // 按钮连线被当成无效边删除。因此在诞生地就规范化，让新项目天生健康。
    const initial = {
      // 用 **flow** 的版本号：以前误用了 project 命名空间的 SCHEMA_VERSION（'1.0'），
      // 于是新项目一出生就是旧版本 → 首次打开必然迁移（备份 + 重写）
      schemaVersion: FLOW_SCHEMA_VERSION,
      systems: [],
      // 模板数据本身是无类型的（只有 kind/label/config），这里按统一层的最小结构断言，
      // 端口补全与合法性都由 normalizeFlow 负责
      nodes: flow.flowNodes as NormalizableNode[],
      edges: flow.flowEdges,
      variables: [],
      metadata: {
        name: config.name,
        version: '1.0',
        runtime: 'typescript',
        createdAt: now,
        updatedAt: now,
      },
    };
    const { graph: normalized, changes } = normalizeFlow(initial);

    if (changes.length > 0) {
      logger.info(`[project] 新建项目：已为 ${changes.length} 个模板节点补全端口定义`);
    }

    await atomicWrite(
      join(projectPath, '.qqbat', 'flow.json'),
      JSON.stringify(normalized, null, 2),
    );
  }

  /** 生成 .env（ADR-003：仅官方 API，不再生成 bot.py） */
  private async _writeAdapterFiles(projectPath: string, fullConfig: ProjectConfig): Promise<void> {
    // ADR-003：仅支持官方 API，不再有 napcat 分支
    await this._writeOfficialAdapterFiles(projectPath, fullConfig);
  }

  /** 写入 .env（运行时/部署用），不再生成 bot.py */
  private async _writeOfficialAdapterFiles(
    projectPath: string,
    fullConfig: ProjectConfig,
  ): Promise<void> {
    const translatorPort = fullConfig.translatorPort;
    // 迁移说明：旧实现写 Python 机器人栈的 .env（驱动/网关地址等键）并生成完整的 bot.py。
    // TS 运行时不读这些驱动配置，也不需要 bot.py —— 它由主进程直接解释
    // .qqbat/flow.json。这里只保留运行时与容器部署真正会用到的变量。
    const envContent = [
      'ENVIRONMENT=prod',
      '',
      '# 运行时连接的翻译器网关（TS 运行时作为 WS 客户端连它）',
      'QQBOT_TRANSLATOR_HOST=127.0.0.1',
      `QQBOT_TRANSLATOR_PORT=${translatorPort}`,
      '',
      '# 日志级别：debug | info | warn | error',
      'LOG_LEVEL=info',
      '',
      '# QQ 官方机器人凭证（也可在应用内配置，经 safeStorage 加密存于 .qqbat/project.json）',
      'QQ_APP_ID=',
      'QQ_APP_SECRET=',
      'QQ_SANDBOX=false',
      '',
    ].join('\n');
    await writeFile(join(projectPath, '.env'), envContent, 'utf-8');
  }


  /** 构建 createProject 返回的 ProjectMeta */
  private _buildProjectMeta(config: ProjectConfig, projectPath: string, now: string): ProjectMeta {
    return {
      id: randomUUID(),
      name: config.name,
      path: projectPath,
      qq: config.qq,
      adapter: config.adapter,
      botType: config.botType,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 查找下一个空闲端口块编号 */
  private async findNextPortBlock(): Promise<number> {
    let maxBlock = 0;
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const configPath = join(this.baseDir, entry.name, '.qqbat', 'project.json');
          const raw = JSON.parse(await readFile(configPath, 'utf-8'));
          if (raw.portBlock && typeof raw.portBlock === 'number') {
            maxBlock = Math.max(maxBlock, raw.portBlock);
          }
        } catch {
          /* 跳过非项目目录 */
        }
      }
    } catch {
      /* baseDir 可能还不存在，用默认值 */
    }
    return maxBlock + 1;
  }


  async saveProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
    assertWithinProject(this.baseDir, projectPath);
    const filePath = join(projectPath, '.qqbat', 'project.json');
    await mkdir(join(projectPath, '.qqbat'), { recursive: true });
    // 加密 official.appSecret 后再落盘，避免敏感凭证明文存储
    const persisted = this._encryptConfigSecret(config);
    await atomicWrite(filePath, JSON.stringify(persisted, null, 2));
  }

  async loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
    const filePath = join(projectPath, '.qqbat', 'project.json');
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as ProjectConfig & { official?: { _encrypted?: boolean } };
    const decrypted = this._decryptConfigSecret(parsed);
    // 迁移旧 botType 值为新值
    return await this._migrateBotType(projectPath, decrypted);
  }

  /**
   * 加密 ProjectConfig 中的所有敏感字段，返回可安全落盘的副本。
   * 若系统不支持 safeStorage，则保留明文并打日志（不阻塞保存）。
   */
  private _encryptConfigSecret(config: ProjectConfig): ProjectConfig {
    const persisted: ProjectConfig = { ...config };

    // 1. 加密 official.appSecret
    if (persisted.official?.appSecret && isEncryptionAvailable()) {
      persisted.official = { ...persisted.official };
      persisted.official.appSecret = encryptSecret(persisted.official.appSecret);
      persisted.official._encrypted = true;
    }

    // 2. 加密 ai.apiKey
    if (persisted.ai?.apiKey && isEncryptionAvailable()) {
      persisted.ai = { ...persisted.ai };
      persisted.ai.apiKey = encryptSecret(persisted.ai.apiKey);
      persisted.ai._encrypted = true;
    }

    return persisted;
  }

  /**
   * 解密 ProjectConfig 中的所有敏感字段。
   * 兼容历史明文（无 _encrypted 标记则原样返回）。
   */
  private _decryptConfigSecret(parsed: ProjectConfig): ProjectConfig {
    // 1. 解密 official.appSecret
    if (parsed.official?._encrypted && typeof parsed.official.appSecret === 'string') {
      const decrypted = tryDecryptSecret(parsed.official.appSecret);
      if (decrypted) {
        parsed.official = { ...parsed.official, appSecret: decrypted };
      } else {
        logger.error(
          `[project] AppSecret 解密失败: ${parsed.name}（凭证可能已损坏或在其他机器上加密）`,
        );
        parsed.official = { ...parsed.official, appSecret: '' };
      }
      delete parsed.official._encrypted;
    }

    // 2. 解密 ai.apiKey
    if (parsed.ai?._encrypted && typeof parsed.ai.apiKey === 'string') {
      const decrypted = tryDecryptSecret(parsed.ai.apiKey);
      if (decrypted) {
        parsed.ai = { ...parsed.ai, apiKey: decrypted };
      } else {
        logger.error(
          `[project] AI apiKey 解密失败: ${parsed.name}（凭证可能已损坏或在其他机器上加密）`,
        );
        parsed.ai = { ...parsed.ai, apiKey: '' };
      }
      delete parsed.ai._encrypted;
    }

    return parsed;
  }

  /**
   * 迁移历史明文凭证到加密形式。
   * 在应用启动时遍历所有项目，将未加密的敏感字段一次性加密。
   * 幂等：已加密的会被跳过。
   */
  async migratePlaintextSecrets(): Promise<{ migrated: string[]; failed: string[] }> {
    const migrated: string[] = [];
    const failed: string[] = [];
    if (!isEncryptionAvailable()) {
      logger.warn('[project] 系统不支持 safeStorage，跳过凭证迁移');
      return { migrated, failed };
    }
    // 扫描 baseDir 下的所有项目目录
    let entries: string[] = [];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return { migrated, failed };
    }
    for (const name of entries) {
      const projectPath = join(this.baseDir, name);
      const configPath = join(projectPath, '.qqbat', 'project.json');
      if (!existsSync(configPath)) continue;
      try {
        const raw = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as ProjectConfig & {
          official?: { _encrypted?: boolean };
          ai?: { _encrypted?: boolean };
        };
        // 检查所有敏感字段是否已加密或为空
        // （NapCat token 随 ADR-003 移除、多平台凭据随多平台面一并移除，
        //   现在需要迁移的只有 official.appSecret 与 ai.apiKey）
        const officialDone = parsed.official?._encrypted || !parsed.official?.appSecret;
        const aiDone = parsed.ai?._encrypted || !parsed.ai?.apiKey;
        if (officialDone && aiDone) continue;
        // 重新保存（会触发加密）
        await this.saveProjectConfig(projectPath, parsed);
        migrated.push(parsed.name);
        logger.info(`[project] 已迁移明文凭证: ${parsed.name}`);
      } catch (e) {
        failed.push(name);
        logger.error(`[project] 迁移凭证失败: ${projectPath}`, e);
      }
    }
    return { migrated, failed };
  }

  async getProjectMeta(projectPath: string): Promise<ProjectMeta | null> {
    try {
      const config = await this.loadProjectConfig(projectPath);
      return {
        id: randomUUID(),
        name: config.name,
        path: projectPath,
        qq: config.qq,
        adapter: config.adapter ?? 'official',
        botType: config.botType,
        createdAt: config.createdAt ?? new Date().toISOString(),
        updatedAt: config.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async recordRecentProject(meta: ProjectMeta): Promise<void> {
    await mkdir(this.appData, { recursive: true });
    const recent = await this.listRecentProjects();
    const filtered = recent.filter((r) => r.path !== meta.path);
    const entry: RecentProject = {
      id: meta.id,
      name: meta.name,
      path: meta.path,
      lastOpenedAt: new Date().toISOString(),
    };
    filtered.unshift(entry);
    const trimmed = filtered.slice(0, MAX_RECENT_PROJECTS);
    await atomicWrite(join(this.appData, 'recent.json'), JSON.stringify(trimmed, null, 2));
  }

  /**
   * 最近项目列表（主页面卡片的数据源）。
   *
   * 除了读 recent.json，还会**扫一遍工作区**把真实存在的项目补回来：
   * 项目目录被改名/迁移、recent.json 丢失或清空后，主页面不该变成空白
   * （2026-10-24 真机踩到：仓库改名后 recent.json 里全是死路径，剪完就剩空列表）。
   * 扫描只认 <目录>/.qqbat/project.json，一层深；运行时那份实现见
   * src/main/services/project/project.ts 的同名方法（两者行为保持一致）。
   */
  async listRecentProjects(): Promise<RecentProject[]> {
    const file = join(this.appData, 'recent.json');
    let entries: RecentProject[] = [];
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf-8'));
        if (Array.isArray(parsed)) entries = parsed;
      } catch {
        entries = [];
      }
    }
    // 项目目录被改名/移动/删除后 recent.json 会残留死路径：列表照旧返回，点开才报错
    // （「路径越界」「ENOENT project.json」）。读的时候按 .qqbat/project.json 过滤，
    // 免得死条目一直占着最近的 MAX_RECENT_PROJECTS 个位置。
    const alive = entries.filter(
      (r) => typeof r?.path === 'string' && existsSync(join(r.path, '.qqbat', 'project.json')),
    );
    const known = new Set(alive.map((r) => resolve(r.path)));
    const discovered: RecentProject[] = [];
    try {
      const dirs = await readdir(this.baseDir, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory() || d.name === APP_DATA_DIR) continue;
        const dirPath = join(this.baseDir, d.name);
        if (known.has(resolve(dirPath))) continue;
        const configPath = join(dirPath, '.qqbat', 'project.json');
        if (!existsSync(configPath)) continue;
        let cfg: Record<string, unknown> | null = null;
        try {
          cfg = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
        } catch {
          cfg = null;
        }
        if (!cfg || typeof cfg !== 'object') continue;
        let openedAt = new Date().toISOString();
        try {
          openedAt = statSync(configPath).mtime.toISOString();
        } catch {
          // 时间读不到就按现在算：排序不精确，但项目能出现
        }
        discovered.push({
          id: typeof cfg.id === 'string' ? cfg.id : `project-${d.name}`,
          name: typeof cfg.name === 'string' && cfg.name ? cfg.name : d.name,
          path: dirPath,
          lastOpenedAt: openedAt,
        });
        known.add(resolve(dirPath));
      }
    } catch (e) {
      logger.warn('[project] 扫描工作区项目失败（不影响 recent.json 的读取）', e);
    }
    discovered.sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)));
    const merged = alive.concat(discovered).slice(0, MAX_RECENT_PROJECTS);
    if (merged.length !== entries.length || discovered.length > 0) {
      if (alive.length !== entries.length) {
        logger.warn(`[project] 最近项目列表剪掉 ${entries.length - alive.length} 个已不存在的路径`);
      }
      try {
        await atomicWrite(file, JSON.stringify(merged, null, 2));
      } catch (e) {
        logger.warn('[project] 回写 recent.json 失败（下次读取仍会再算一遍）', e);
      }
    }
    return merged;
  }

  async removeRecentProject(path: string): Promise<void> {
    const recent = await this.listRecentProjects();
    const filtered = recent.filter((r) => r.path !== path);
    await atomicWrite(join(this.appData, 'recent.json'), JSON.stringify(filtered, null, 2));
  }

  /** 重命名项目 */
  async renameProject(projectPath: string, newName: string): Promise<void> {
    assertWithinProject(this.baseDir, projectPath);
    const configPath = join(projectPath, '.qqbat', 'project.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    config.name = newName;
    await atomicWrite(configPath, JSON.stringify(config, null, 2));
    // 同步更新 recent 列表中的名称
    const recent = await this.listRecentProjects();
    const entry = recent.find((r) => r.path === projectPath);
    if (entry) {
      entry.name = newName;
      await atomicWrite(join(this.appData, 'recent.json'), JSON.stringify(recent, null, 2));
    }
  }

  /** 删除整个项目文件夹 */
  async deleteProject(projectPath: string): Promise<void> {
    // 校验路径在项目根目录内，防止越权删除
    // 注意：必须用 pathGuard.assertWithinProject，startsWith 会被同级前缀目录绕过
    // （如 baseDir=D:\proj，projectPath=D:\proj-evil 会通过 startsWith 校验）
    assertWithinProject(this.baseDir, projectPath);
    const normalized = resolve(projectPath);
    // 进一步禁止删除项目根目录本身
    if (normalized === resolve(this.baseDir)) {
      throw new Error('不能删除项目根目录本身');
    }
    await rm(normalized, { recursive: true, force: true });
    // 从 recent 列表中移除
    await this.removeRecentProject(projectPath);
  }

  /** 移动项目在 recent 列表中的位置（offset: -1 上移, 1 下移） */
  async moveProject(projectPath: string, offset: -1 | 1): Promise<void> {
    const recent = await this.listRecentProjects();
    const idx = recent.findIndex((r) => r.path === projectPath);
    if (idx === -1) return;
    const target = idx + offset;
    if (target < 0 || target >= recent.length) return; // 交换
    [recent[idx], recent[target]] = [recent[target], recent[idx]];
    await atomicWrite(join(this.appData, 'recent.json'), JSON.stringify(recent, null, 2));
  }

  /** 克隆项目（复制整个文件夹，更新名称） */
  async cloneProject(projectPath: string, newName: string): Promise<ProjectMeta> {
    // 校验源路径与目标路径都在项目根目录内
    assertWithinProject(this.baseDir, projectPath);
    const newPath = join(this.baseDir, newName);
    if (existsSync(newPath)) throw new Error(`项目「${newName}」已存在`);
    await cp(projectPath, newPath, { recursive: true });
    // 更新新项目的 project.json
    const configPath = join(newPath, '.qqbat', 'project.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    config.name = newName;
    await atomicWrite(configPath, JSON.stringify(config, null, 2));
    const meta: ProjectMeta = {
      id: '',
      name: newName,
      path: newPath,
      qq: config.qq ?? '',
      adapter: config.adapter ?? 'official',
      createdAt: config.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.recordRecentProject(meta);
    return meta;
  }
}
