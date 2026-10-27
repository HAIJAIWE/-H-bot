// src/main/index.ts
import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { createMainWindow } from './window';
import { registerAllIpc } from './ipc/register';
import { registerBuiltinHostPlugins } from './services/plugins/builtinHostPlugins';
import { restoreInstalledMarketPlugins } from './services/plugins/market';
import {
  initializeGlobalContainer,
  disposeGlobalContainer,
  getGlobalContainer,
  SERVICE_KEYS,
} from './services/runner/serviceContainer';
import { botManager } from './services/bot/botManager';
import { killAllTerminals } from './services/runner/terminal';
import { stopAllTranslators } from './services/runner/eventBus';
import { stopUntrustedWorkerIfRunning } from './runtime/untrustedWorkerHost';
import { logger } from './services/infra/logger';
import { loadAndApplyToolBudget } from './services/ai/budgetSettings';
import { loadAndApplyParallelToolCalls } from './services/ai/parallelToolCallsSettings';
import { initCrashLogger } from './services/ops/crashLogger';
import { initErrorMonitoring, flushAndClose } from './services/ops/errorMonitoring';
import { createMcpServer } from './mcp/server';
import { resolveMcpTargets } from './mcp/targets';
import { CDP_PORT, MCP_SSE_PORT } from '@shared/config/ports';
import { MCP_SSE_PATH } from '@shared/protocol/mcp';
import {
  migrateLegacyProjectRoot,
  migrateUserDataLayout,
} from './services/infra/userDataMigration';
import { userDataPath } from './services/infra/paths';
import { sqliteEngine, sqliteStatus } from './services/infra/sqlite';

// 崩溃日志收集：尽早注册，覆盖 bootstrap 阶段之后的未捕获异常
initCrashLogger();

// 初始化错误监控
initErrorMonitoring();

async function bootstrap(): Promise<void> {
  // 0. userData 布局迁移（P4.3）：**必须最先跑**。
  //
  // 顺序错了就会出现"预算/供应商配置看起来没了"的假象：迁移没做，后面的
  // loadAndApplyToolBudget() 在新位置找不到文件 → 回落默认值。
  // 这里只复制不删除，失败会打 error 并在下次启动重试（见 infra/userDataMigration）。
  const layout = migrateUserDataLayout(app);
  if (layout.migrated.length > 0) {
    logger.info('[bootstrap] userData 布局迁移完成：' + layout.migrated.join('；'));
  }
  if (layout.failed.length > 0) {
    logger.error('[bootstrap] userData 布局迁移有失败项：' + layout.failed.join('；'));
  }

  // 项目根（P3-3.9 / P6-6.5 的前置）：
  //   · 打包后 cwd 由快捷方式/portable 决定，**不可控** → 必须落在 userData；
  //   · 开发态 cwd 就是仓库根，projects/ 是仓库自己的测试项目 → 保持原样，别污染真机数据。
  // 首次切到 userData 时把安装目录里的老项目**复制**过来（不删除、同名跳过、留墓碑）。
  const projectBase = app.isPackaged
    ? (userDataPath('projects', app) ?? join(process.cwd(), 'projects'))
    : join(process.cwd(), 'projects');
  if (app.isPackaged) {
    const legacyProjects = join(process.cwd(), 'projects');
    const moved = migrateLegacyProjectRoot(legacyProjects, app);
    if (moved.migrated.length > 0) {
      logger.info('[bootstrap] 已迁移安装目录里的项目：' + moved.migrated.join('、'));
    }
    if (moved.failed.length > 0) {
      logger.error('[bootstrap] 项目迁移失败（原目录仍在）：' + moved.failed.join('、'));
    }
  }
  await mkdir(projectBase, { recursive: true });

  // SQLite 自检：原生模块的 ABI 跟运行环境绑定（Electron 146 / 纯 Node 137），
  // 用错时 better-sqlite3 在加载阶段就抛。改成懒加载 + node:sqlite 兜底后应用还能起来，
  // 但这条日志必须显眼 —— 否则用户只会看到"数据面板空着"。
  const sqlite = sqliteStatus();
  if (!sqlite.ok) {
    logger.error('[bootstrap] ' + sqlite.error);
  } else if (sqlite.engine === 'node:sqlite') {
    logger.warn(
      '[bootstrap] SQLite 正在用 Node 内置 node:sqlite 兜底（better-sqlite3 的 ABI 与当前运行时不匹配）。' +
        '功能可用；要换回原生模块，跑 node scripts/ensure-sqlite.js electron 后重启。',
    );
  } else {
    // 落到这条说明原生模块真的在工作 —— 排查 ABI 问题时先看这一行
    logger.info('[bootstrap] SQLite 引擎：' + sqliteEngine());
  }

  // 初始化全局服务容器（自动配置 botManager 等核心服务）
  initializeGlobalContainer(projectBase);

  // 应用级 AI 设置：工具结果上限。**必须在使用 AI 之前应用** ——
  // 预算层是模块级状态，默认值在代码里（8192 码点），这里把用户改过的值覆盖上去。
  // 读失败不阻断启动（`loadAndApplyToolBudget` 内部兜底为默认值）。
  await loadAndApplyToolBudget();

  // 并行工具调用数（第 59 批）：同样必须在使用 AI 之前应用 —— 轮次里每轮同步读这个模块级状态。
  // 读失败不阻断启动（内部兜底为默认值 10 / 启用）。
  await loadAndApplyParallelToolCalls();

  registerAllIpc(projectBase);

  // 内置工具集注册成插件（默认层）：此后它可寻址、可启停、覆盖层可写（见 services/plugins/defaults.ts）
  registerBuiltinHostPlugins();

  // 市场装过的 AI 插件：启动时恢复。只装回哈希对得上的目录 ——
  // 被本地改过的（changed）不自动执行，记日志让用户决定卸载还是保留。
  try {
    const market = await restoreInstalledMarketPlugins();
    if (market.restored.length > 0) {
      logger.info('[market] 已恢复市场插件：' + market.restored.join('、'));
    }
    if (market.changed.length > 0) {
      logger.warn('[market] 安装目录被修改，未自动加载：' + market.changed.join('、'));
    }
    if (market.missing.length > 0) {
      logger.warn('[market] 安装目录缺失：' + market.missing.join('、'));
    }
    for (const failure of market.failed) {
      logger.error('[market] 恢复失败 ' + failure.id + '：' + failure.error);
    }
  } catch (e) {
    logger.error('[market] 恢复市场插件失败：' + (e instanceof Error ? e.message : String(e)));
  }

  // ← B.1: 注册业务 Hook 系统
  // 这些 Hook 将在代码生成的流程中自动触发
  // onVariableSet: 变量设置时触发 (在 dataflow.ts assignOutputVariables 中集成)
  // onTriggerStart/onTriggerEnd: 触发器开始/结束时触发 (在 generator.ts 中集成)
  // 通过 bot.hooks 可以扩展业务副作用：统计、监控、副作用处理
  //
  // 注意: Hook 注册应在 bot 实例创建时进行 (参考 botManager.ts startBot)
  // 此处暂不注册，待 bot 启动流程集成
  //
  // 实际业务 Hook 注册示例:
  // bot.hooks?.onVariableSet?.('user_count', (count: string) => { ... })
  // bot.hooks?.onTriggerStart?.('daily_sign', (triggerId: string) => { ... })
  // bot.hooks?.onError?.((error: string, context: string) => { ... })

  // 获取 ProjectService 进行启动时迁移
  const container = getGlobalContainer();
  const projectService = container.get(SERVICE_KEYS.PROJECT_SERVICE);

  // 一次性迁移历史明文凭证到加密形式（幂等，已加密的会跳过）
  try {
    const result = await projectService.migratePlaintextSecrets();
    if (result.migrated.length > 0) {
      logger.info(`[bootstrap] 已迁移 ${result.migrated.length} 个项目的明文凭证`);
    }
    if (result.failed.length > 0) {
      logger.warn(
        `[bootstrap] ${result.failed.length} 个项目凭证迁移失败: ${result.failed.join(', ')}`,
      );
    }
  } catch (e) {
    logger.warn('[bootstrap] 凭证迁移失败:', e);
  }

  // MCP SSE（可选）：设了 QQBAT_MCP_SSE_PORT 才启动。
  //
  // 支持**多项目**：QQBAT_MCP_PROJECTS 逗号分隔，每个项目一个端口（basePort 起递增），
  // 各自独立 token；只配一个项目时行为与以前完全一致（QQBAT_MCP_PROJECT / cwd）。
  // 解析规则抽在 ./mcp/targets（纯函数，可测）。
  const mcpTargets = resolveMcpTargets({
    portRaw: process.env.QQBAT_MCP_SSE_PORT,
    projects: process.env.QQBAT_MCP_PROJECTS,
    project: process.env.QQBAT_MCP_PROJECT,
    cwd: process.cwd(),
  });
  if (mcpTargets.length > 0 && !process.env.QQBAT_MCP_PROJECTS && !process.env.QQBAT_MCP_PROJECT) {
    logger.warn(
      '[mcp] 未设置 QQBAT_MCP_PROJECT(S)，以进程工作目录作为项目根:',
      mcpTargets[0].projectPath,
    );
  }
  for (const target of mcpTargets) {
    try {
      const mcp = createMcpServer({ projectPath: target.projectPath });
      await mcp.startSSE(target.port);
      logger.info(
        `[mcp] SSE 已监听 http://127.0.0.1:${target.port}${MCP_SSE_PATH}（项目：${target.projectPath}）`,
      );
      logger.info(`[mcp] 鉴权 token（本次启动有效）: ${mcp.getAuthToken()}`);
    } catch (e) {
      // MCP 是可选能力：一个项目起不来不该拦住应用启动，也不该拖垮其它项目
      logger.warn(`[mcp] MCP SSE 启动失败（${target.projectPath}）:`, e);
    }
  }

  createMainWindow();
}

/**
 * 开发/验证用的 CDP 开关。
 *
 * 设了 `QQBAT_CDP_PORT` 才开 `--remote-debugging-port`，**生产默认不开**。
 *
 * ## 为什么需要它
 *
 * `scripts/e2e/drive-gui.mjs` 能用 Chrome DevTools Protocol **截图 / 执行 JS / 点按钮**，
 * 但前提是应用带这个端口启动。而**视觉类改动 jsdom 测不出来**
 * （它不做布局计算 —— "标签会不会换行""缩放后大不大"这类问题断言不了），
 * 只能靠看。有了这个开关，改渲染层的人可以**自己截图验证**，
 * 不必每次都找人肉眼看一遍。
 *
 * 用法：
 *     QQBAT_CDP_PORT=1 pnpm dev            # 用默认端口 43191（见 @shared/config/ports）
 *     QQBAT_CDP_PORT=9333 pnpm dev         # 或显式指定
 *     node scripts/e2e/drive-gui.mjs shot out.png
 *
 * ⚠️ 必须在 `app.whenReady()` **之前**调用（Chromium 命令行开关只在启动阶段生效）。
 *
 * 默认端口不再是 9222：9222 是"全世界的 Electron 调试端口"，同机开两个应用就撞。
 */
const cdpPortRaw = (process.env.QQBAT_CDP_PORT ?? '').trim();
if (cdpPortRaw) {
  const cdpPort =
    cdpPortRaw === '1' || cdpPortRaw.toLowerCase() === 'true' ? String(CDP_PORT) : cdpPortRaw;
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
  logger.info('[debug] CDP 已开启：127.0.0.1:' + cdpPort);
}

/**
 * 单实例锁（2026-10-18 隔离审计 RT-34）。
 *
 * ## 为什么必须有
 *
 * 双开时会坏事：两个实例共享同一个 userData 与同一批项目，`resolveUsableTranslatorPort`
 * 各自顺延端口 → 同一个项目起两个翻译器 → 两条连接同时连官方网关 →
 * **同一条消息被处理两次**（eventBus.ts 里已记录过该事故）。
 *
 * ## 例外
 *
 * `QQBAT_ALLOW_MULTI_INSTANCE=1` 时跳过（调试/对比版本用），并在日志里显式留痕 ——
 * 不能让它变成一个没人知道的暗门。
 */
const allowMultiInstance = process.env.QQBAT_ALLOW_MULTI_INSTANCE === '1';
const gotSingleInstanceLock = allowMultiInstance ? true : app.requestSingleInstanceLock();

if (allowMultiInstance) {
  logger.warn('[lifecycle] QQBAT_ALLOW_MULTI_INSTANCE=1：本次启动**不**抢单实例锁');
} else if (!gotSingleInstanceLock) {
  logger.warn('[lifecycle] 已有实例在运行，本进程退出（避免双开导致同一条消息被处理两次）');
  app.quit();
}

// 只有持锁实例才注册启动流程与 second-instance（否则会出现第二个翻译器）
if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    logger.info('[lifecycle] 收到第二个实例的启动请求，已聚焦已有窗口');
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message + '\n\n' + (err.stack ?? '') : String(err);
      logger.error('[bootstrap] 启动失败:', msg);
      try {
        dialog.showErrorBox('启动失败', '应用启动时发生错误：\n' + msg);
      } catch {
        // dialog 可能尚未就绪
      }
      app.quit();
    });
}

app.on('window-all-closed', () => {
  /**
   * 诊断日志（2026-10-04）：之前几次"应用自己退了 / exit code 1"查不出原因 ——
   * 有了这两条，下次退出时 `main.log` 会明说是**窗口被关完**还是**走了 before-quit** ✓
   * （退出码 1 本身不说明崩溃：`electron-vite dev` 在窗口关闭后退出也会是 1 ✗）
   */
  logger.info(
    '[lifecycle] window-all-closed：所有窗口已关闭' +
      (process.platform === 'darwin' ? '（macOS 不退出）' : ' → 退出应用'),
  );
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

/**
 * 应用退出前清理所有子进程，防止孤儿进程残留。
 *
 * Electron 默认不会在退出时杀死 spawn 的子进程 —— bot（TS 运行时进程）、
 * 终端（cmd.exe/bash）会残留为孤儿进程，继续占用 CPU/内存、
 * 持有端口与文件句柄。before-quit 在所有窗口关闭后、应用真正退出前触发，
 * 是清理子进程的最后机会。
 *
 * 顺序：先停 bot（业务进程最重，需最早停止释放消息队列/日志缓冲），
 * 再清终端。
 * 每个 stop 调用内部已捕获异常，单点失败不影响后续清理。
 */
app.on('before-quit', () => {
  logger.info('[lifecycle] before-quit：应用即将退出（清理子进程）');
  try {
    // 迁移说明：旧实现枚举并 kill Python 子进程（bot.py）。
    // 现在运行时是主进程内的 FlowRuntime（WebSocket 客户端），
    // 停止是异步的且不阻塞退出：连接会随进程退出一并释放，
    // 这里只做一次尽力而为的优雅停止。
    const runningBots = botManager
      .listBots()
      .filter((bot) => bot.status === 'running' || bot.status === 'starting');
    if (runningBots.length > 0) {
      logger.info(`[quit] 正在停止 ${runningBots.length} 个运行中的机器人...`);
      void botManager.stopAllBots().catch((e) => logger.warn('[quit] 停止 bot 失败:', e));
    }
    // 翻译器是 **WS 服务端**（持有监听 socket 与重连定时器），而 `stopBot()` 按端口复用
    // 设计**故意不关它** —— 于是此前退出时这些监听 socket 只能等进程被回收，
    // 且一个待触发的 retryTimer 还可能在退出过程中把翻译器重新拉起来。
    // 放在 bot 之后、终端之前：bot 是连它的客户端，先断客户端再关服务端。
    // 该调用是同步的，不阻塞退出。
    stopAllTranslators();
    // 不可信节点代码的执行进程（P5a 起的子进程）。它用 `unref()` 摘掉了事件循环引用，
    // 所以**退出时不会被自动回收** —— 与终端同一类问题（见下方 killAllTerminals 的注释）：
    // Electron 不会替你杀死子进程，不显式停就留下一个孤儿 Node 进程。
    stopUntrustedWorkerIfRunning();
    killAllTerminals();

    // 监控缓冲的最后一批错误：`flushAndClose` 的注释就写着"应用退出时调用"，
    // 但这条线一直没接（零引用扫描发现）—— 不接的后果是**退出时丢掉最后一段上报**，
    // 而那往往正好是"崩之前发生了什么"。尽力而为：它内部有 2s 超时，不阻塞退出。
    void flushAndClose().catch((e) => logger.warn('[quit] 刷新监控失败:', e));
  } catch (e) {
    logger.warn('[quit] 子进程清理失败:', e);
  } finally {
    // 释放全局容器资源
    disposeGlobalContainer();
  }
});
