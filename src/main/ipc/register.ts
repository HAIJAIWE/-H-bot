// src/main/ipc/register.ts
import { getGlobalContainer, SERVICE_KEYS } from '../services/runner/serviceContainer';
import { registerProjectIpc } from './project';
import { registerFlowIpc } from './flow';
import { registerExpressionIpc } from './expression';
import { registerCodegenIpc } from './codegen';
import { registerFileIpc } from './file';
import { registerTerminalIpc } from './terminal';
import { registerRuntimeIpc } from './runtime';
import { registerAiIpc } from './ai';
import { registerAiAgentCoreIpc } from './aiAgentCore';
import { registerAiInstructionIpc } from './aiInstruction';
import { registerAiAllowRulesIpc } from './aiAllowRules';
import { registerAiPresetsIpc } from './aiPresets';
import { registerHistoryIpc } from './history';
import { registerGitIpc } from './git';
import { registerDiagnosticsIpc } from './diagnostics';
import { registerMetricsIpc } from './metrics';
import { registerMetricsExportIpc } from './metricsExport';
import { registerCustomNodeIpc } from './customNode';
import { registerCrashReporterIpc } from './crashReporter';
import { registerResourceMonitorIpc } from './resourceMonitor';
import { registerStateStoreIpc } from './stateStore';
import { registerAdapterIpc } from './adapter';
import { registerAIProviderIpc } from './aiProvider';
import { registerDebuggerIpc } from './debugger';
import { registerPluginIpc } from './plugins';
import { registerBotManagerIpc } from './botManager';
import { registerLaunchDataIpc } from './launchData';
import { registerLaunchConfigIpc } from './launchConfig';
import { registerLaunchDashboardIpc } from './launchDashboard';
import { registerLaunchAuditIpc } from './launchAudit';
import { registerLaunchBackupIpc } from './launchBackup';
import { registerLaunchTransferIpc } from './launchTransfer';
import { registerLaunchPanelIpc } from './launchPanel';
import { registerOfficialIpc } from './official';
import { registerDockerExportIpc } from './dockerExport';
import { registerSshDeployIpc } from './sshDeploy';
import { registerDataNotifyIpc } from './dataNotify';
import { registerButtonPanelIpc } from './buttonPanel';
import { registerPanelSyncIpc } from './panelSync';
import { registerCapabilityIpc } from './capability';
import { captureIpcHandlers } from '../services/ai/ipcBridge';

/**
 * 注册全部 IPC。
 *
 * 外面这层只做一件事：**在注册期间把 handler 记下来**（见 ipcBridge.ts 文件头），
 * 好让主进程里的 AI 工具能调用**同一条** handler —— 校验、守卫、业务逻辑都还是那一份，
 * 不会出现"手写绑定"那样的第二套实现。
 *
 * 包装是刻意的：39 个域的注册写法一行都不用改，捕获只在启动那一瞬生效。
 */
export function registerAllIpc(baseDir: string): void {
  captureIpcHandlers(() => registerAllIpcInner(baseDir));
}

function registerAllIpcInner(baseDir: string): void {
  // 初始化全局容器
  const container = getGlobalContainer(baseDir);

  // 从容器获取核心服务（类型安全）
  const projectService = container.get(SERVICE_KEYS.PROJECT_SERVICE);
  const flowService = container.get(SERVICE_KEYS.FLOW_SERVICE);
  const codegenService = container.get(SERVICE_KEYS.CODEGEN_SERVICE);

  // 注册所有 IPC
  registerProjectIpc(projectService);
  registerFlowIpc(flowService);
  // 表达式实时校验（属性面板边打字边报语法错）。无状态、不碰项目数据，
  // 之所以要开 IPC 通道是因为渲染层 CSP 没有 unsafe-eval —— 见该文件头。
  registerExpressionIpc();
  registerCodegenIpc(codegenService);
  registerFileIpc(baseDir);
  registerTerminalIpc();
  registerRuntimeIpc();
  // registerAiIpc 需要 ProjectService 来"列出所有项目"——
  // 智能体面板的核心诉求是「不用切项目就能配」，所以它必须能一次拿到全部项目。
  registerAiIpc(projectService);
  // agent-core 运行入口（workspace-first 循环）。单独一个文件见它的文件头：
  // `ai.ts` 已经贴着 800 行红线，这条通道是另一套循环，不该挤进去。
  registerAiAgentCoreIpc();
  // MCP 写指令回流（渲染层执行完必须回执，否则主进程只能按超时判失败）
  registerAiInstructionIpc();
  // 「以后别再问」的规则表（撤销口）：看 / 删单条 / 清空。单独一个文件见它的文件头。
  registerAiAllowRulesIpc();
  // 会话预设的导入导出（第 53 批）：文件选择 + 校验 + 写盘，全是用户显式操作。
  registerAiPresetsIpc();
  registerHistoryIpc();
  registerGitIpc();
  registerDiagnosticsIpc();
  registerMetricsIpc();
  registerMetricsExportIpc();
  registerCustomNodeIpc();
  registerCrashReporterIpc();
  registerResourceMonitorIpc();
  registerStateStoreIpc();
  registerAdapterIpc();
  registerAIProviderIpc();
  // 节点级流程调试器（断点/单步，命名空间 debug:*）
  registerDebuggerIpc();
  registerPluginIpc();
  registerBotManagerIpc();
  registerLaunchDataIpc();
  registerLaunchConfigIpc();
  registerLaunchDashboardIpc();
  registerLaunchAuditIpc();
  registerLaunchBackupIpc();
  registerLaunchTransferIpc();
  registerLaunchPanelIpc();
  registerOfficialIpc();
  registerDockerExportIpc();
  registerSshDeployIpc();
  registerDataNotifyIpc();
  registerButtonPanelIpc();
  registerPanelSyncIpc();
  // 2026-10-04：这条**已经接上**了（原来这里写着"从写下那天起就没被注册过"，是过时注释 ✗）。
  // 「出厂配置」第 5 行「能力自检」靠它跑；ipcReachability 闸门里有"每个 register*Ipc 都必须被本文件引用"的用例守着 ✓
  registerCapabilityIpc();
}
