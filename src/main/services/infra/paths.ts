// src/main/services/infra/paths.ts
/**
 * userData 路径的**唯一出入口**。
 *
 * ## 为什么必须收敛到这里
 *
 * 2026-10-18 的隔离审计（计划里的 RT-13 / RT-16 / R7）发现：主进程有 13 处直接拼
 * `app.getPath('userData')`，拼出 `qqbat-data/official`、根下平铺的 `ai-config.json`、
 * `logs/main.log`、`crashes/` 等等 —— 同一份根目录下混着品牌目录与通用目录，
 * 换个版本就不知道该去哪找；改根目录（或换 app 名）时也没有单一改点。
 *
 * ## 当前布局（**与 2026-10 之前保持一致**，没搬家）
 *
 * ```
 * <userData>/                      ← %APPDATA%\qqbat
 * ├── ai-config.json               ← AI 供应商配置
 * ├── ai-tool-budget.json          ← 工具结果预算
 * ├── framework-dev-mode.json      ← 开发者模式开关
 * ├── qqbat-data/official/         ← 官方凭据旧位置（只读，迁移来源）
 * ├── logs/                        ← main.log / renderer.log / crashes/
 * ├── crashes/                     ← JS 层崩溃报告
 * ├── crash-reports/               ← Electron 原生 .dmp
 * ├── projects/                    ← 用户项目
 * └── runtime/                     ← 端口租约等「重启即丢」的状态
 * ```
 *
 * ⚠️ **这一版只做「收敛访问点」，不搬目录**。搬家（config/ logs/ data/ 五域布局）是 P4.3，
 * 那时**只改下面这张表 + 加一个迁移器**，13 个调用方一行都不用动 —— 这正是把它抽出来的价值。
 *
 * ## 非 Electron 环境
 *
 * 远程部署（Docker / SSH 无头）里没有 `app`。此时：
 *   · 优先用显式覆盖 `QQBAT_USER_DATA_DIR`；
 *   · 否则返回 `null` —— 调用方据此**跳过落盘**，而不是猜一个目录写到别人家里。
 * 需要「必须有」的场景用 `userDataPathOrThrow`，让错误在启动时就暴露，而不是写进错误的目录。
 */

import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Electron `app` 的最小形状。
 *
 * 只声明 `'userData'` 这一个重载：Electron 的 `App.getPath` 接受的是 `PathName` 联合类型，
 * 写成 `(name: string) => string` 会**不兼容**（参数逆变），而写成 `'userData'` 则两边都成立。
 */
export interface ElectronAppLike {
  getPath(name: 'userData'): string;
}

/**
 * userData 下的固定条目表 —— **搬家时只改这里**。
 *
 * 值是相对 userData 根的**路径分段**（不用字符串拼，避免有人写出 `..` 或重复分隔符）。
 */
export const USER_DATA_LAYOUT = {
  /** 日志目录（electron-log 的 main.log / renderer.log，以及 logs/crashes/） */
  logs: ['logs'],
  /** JS 层崩溃报告（crash-*.json） */
  crashReports: ['crashes'],
  /** Electron 原生崩溃 dump（.dmp） */
  nativeCrashDumps: ['crash-reports'],
  /** 崩溃日志的细分目录（errorMonitoring 写这里） */
  crashLogs: ['logs', 'crashes'],
  /** 官方平台凭据（旧位置 `qqbat-data/official`，P4.3 起搬到 `config/official`） */
  officialConfig: ['config', 'official'],
  /** 应用级 AI 配置（旧位置在根下，P4.3 起搬到 `config/`） */
  aiConfig: ['config', 'ai-config.json'],
  /** AI 工具结果预算设置 */
  aiToolBudget: ['config', 'ai-tool-budget.json'],
  /** 开发者模式开关 */
  devModeSetting: ['config', 'dev-mode.json'],
  /** 用户项目根 */
  projects: ['projects'],
  /** 运行期状态（端口租约等，重启即丢） */
  runtime: ['runtime'],
  /** 宿主（Agent）插件：覆盖层等应用级配置 —— 插件是宿主能力，跟应用走而不是跟项目走 */
  hostPlugins: ['plugins'],
  /** 插件市场：来源列表、已装记录、安装目录（与 hostPlugins 分开，市场状态是应用级缓存） */
  market: ['market'],
  /** 迁移前的备份（P4.3 起使用） */
  backups: ['backups'],
} as const;

export type UserDataEntry = keyof typeof USER_DATA_LAYOUT;

/**
 * **P4.3 之前**的旧位置（只用于「读取回落」，写入永远走新位置）。
 *
 * 为什么保留：布局迁移是「只复制不删除」的，但迁移本身可能失败（磁盘满/权限）。
 * 失败时如果读方只看新位置，用户就会看到"配置没了"（回落到默认值）——
 * 那是最坏的一种静默降级。双读让迁移失败只影响"新位置干净"，不影响可用性。
 */
export const LEGACY_USER_DATA_LAYOUT = {
  officialConfig: ['qqbat-data', 'official'],
  aiConfig: ['ai-config.json'],
  aiToolBudget: ['ai-tool-budget.json'],
  devModeSetting: ['framework-dev-mode.json'],
} as const satisfies Partial<Record<UserDataEntry, readonly string[]>>;

let cachedRoot: string | null | undefined;

/** 取 Electron 的 userData 根；纯 Node 下返回 null（不猜测目录） */
function resolveRoot(): string | null {
  try {
    // 惰性 require：纯 Node / 测试环境里根本不存在 electron 模块
    const electron = require('electron') as { app?: Partial<ElectronAppLike> };
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // 不在 Electron 进程中
  }
  const override = (process.env.QQBAT_USER_DATA_DIR ?? '').trim();
  return override || null;
}

/**
 * userData 根目录（`%APPDATA%\qqbat`）。
 *
 * 注意：它**已经**是本应用的专属目录（Electron 用 app name 派生），所以不要再往里
 * 套一层 `qqbat/`，否则会变成 `%APPDATA%\qqbat\qqbat`。
 */
/**
 * 取 userData 根。
 *
 * 优先用**调用方传进来的 app**，其次才是本模块的惰性 require ——
 * 这不是洁癖：Electron 的 `app` 在测试里是被 `vi.mock('electron')` 替换的假对象，
 * 而 `require('electron')` 拿不到那份 mock（vite 的 mock 只作用于 import 图）。
 * 让调用方把 app 递进来，测试里就是"用它们已经 mock 的那个 app"，行为与生产一致。
 */
export function userDataRoot(app?: ElectronAppLike | null): string | null {
  if (app && typeof app.getPath === 'function') {
    try {
      const fromApp = app.getPath('userData');
      if (fromApp) return fromApp;
    } catch {
      // 假 app 没有这个方法 / 抛错 —— 退回下面的兜底
    }
  }
  if (cachedRoot === undefined) cachedRoot = resolveRoot();
  return cachedRoot;
}

/** userData 下的某个固定条目；没有 userData 时返回 null */
export function userDataPath(entry: UserDataEntry, app?: ElectronAppLike | null): string | null {
  const root = userDataRoot(app);
  if (!root) return null;
  return join(root, ...USER_DATA_LAYOUT[entry]);
}

/** 同 `userDataPath`，但缺失时抛错（用于「主进程里必须有」的场景） */
export function userDataPathOrThrow(entry: UserDataEntry, app?: ElectronAppLike | null): string {
  const found = userDataPath(entry, app);
  if (!found) {
    throw new Error(
      'userData 不可用（当前不是 Electron 主进程，且未设置 QQBAT_USER_DATA_DIR）：' + entry,
    );
  }
  return found;
}

/** 旧位置路径（P4.3 之前）；该条目没有旧位置时返回 null */
export function legacyUserDataPath(
  entry: UserDataEntry,
  app?: ElectronAppLike | null,
): string | null {
  const root = userDataRoot(app);
  const segs = (LEGACY_USER_DATA_LAYOUT as Record<string, readonly string[] | undefined>)[entry];
  if (!root || !segs) return null;
  return join(root, ...segs);
}

/**
 * 读取用：**新位置存在就用新的，否则回落旧位置**（双读单写）。
 *
 * 返回的可能是旧路径 —— 调用方读完之后如果要写，必须用 §userDataPath§（新位置）。
 */
export function existingUserDataPath(
  entry: UserDataEntry,
  app?: ElectronAppLike | null,
): string | null {
  const current = userDataPath(entry, app);
  if (current && existsSync(current)) return current;
  const legacy = legacyUserDataPath(entry, app);
  if (legacy && existsSync(legacy)) return legacy;
  return current;
}

/** 运行期状态目录：端口租约等「重启即可丢弃」的文件放这里 */
export function runtimeDir(): string | null {
  return userDataPath('runtime');
}
