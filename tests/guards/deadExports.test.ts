// tests/guards/deadExports.test.ts
//
// # 闸门：**导出了但全仓零引用**的函数/常量必须登记
//
// ## 为什么要有它（2026-10-01 架构复盘的结论）
//
// 本次盘点一个人就抓出 **4 处**"写好了没接线"（本 session 共 7 处）：
//   · `initDebugListener` 零调用点 · 工具参数 `required` 声明了没人读
//   · **插件装载 `loadPlugin` 零调用点**（AI 创建的节点运行时装不上）
//   · `ai:executeTool` + 8 个数据工具 **有记录以来从未接上**
//   · 面板工具列表停在 8 个（agent 有 22 个）
//   · `addToolCall` 零调用点（工具调用卡片永远不渲染）
//   · **`cancelAiChat` 零调用点 —— 「停止」按钮是假动作**（点完主进程照跑满 10 轮）
//
// **这不是架构问题，是流程问题** —— 而本仓库已经反复证明"机器管约定"非常有效
// （描述对账 / 目录对账 / 通道对账 / 反重复）。这条闸门就是把"接线"也纳入机器管。
//
// ## 判据
//
// 扫全仓（`src` + `tests`，单遍解析），收集 `export function` / `export const f = () =>`，
// 数每个名字在**声明处之外**的出现次数。**完全零引用**的必须在下面的基线里，
// 否则红 —— 修法二选一：
//   ① **接上它**（生产路径真的调用；这才是正常情况）
//   ② 在基线里登记并**写明理由**（"留给将来"也要写清是什么将来）
//
// 基线是**待清理清单**，不是免死金牌：闸门会把"已接上但还留在基线里"的项报出来（不失败）。
// ## 怎么更新基线
//
// 跑 `node scripts/scan-dead-exports.mjs` 看当前名单，然后：
//   · **接上它**（正常情况）· 或在本文件 BASELINE_* 里登记并写明理由
//
// ⚠️ 基线**不能**从"带 bug 的中间态"生成 —— 我自己踩过：反向对照时先把接线摘了、
// 又拿那个中间态重新生成基线，于是 `cancelAiChat` 被登记进基线，闸门就再也抓不到它了。
//
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()

/** 整个文件级别的豁免（该文件多数导出都零引用 —— 整块登记比逐条清楚） */
const BASELINE_FILES: Record<string, string> = {
  'src\\main\\codegen\\expressionCompiler.ts': '同上：表达式编译/缓存的辅助 API，当前无调用点',
  'src\\main\\codegen\\typescriptUtils.ts':
    '代码生成辅助库（TS 片段拼装）；当前 codegen 路径没用到 —— 疑似旧路径遗留，待核实后整体删除',
  'src\\main\\runtime\\baseData.ts': '基础数据读取辅助 —— 当前无调用点',
  'src\\main\\runtime\\previewRunner.ts':
    '预览运行器的测试/辅助出口（_resetPreviewCollectors/hasLongWaitNodes…）',
  'src\\main\\services\\project\\configService.ts':
    '配置表的辅助 API（getConfigRecord/createConfigTableWithSeed/renameConfigFile）',
  'src\\main\\services\\ops\\errorMonitoring.ts':
    '监控模块的部分 API（setUserContext/flushAndClose/isInitialized…）未接入 —— 上报链路只做了一半',
  'src\\main\\services\\plugins\\pluginLoader.ts':
    '插件管理界面的备用 API（setPluginRegistrar/getPluginPackage/getPluginCount…）—— 界面走的是另一条路',
  'src\\renderer\\src\\lib\\canvas\\connectionValidator.ts':
    '连线校验（validateConnection/validateGraph）—— 当前靠 connect 时的即时校验',
  'src\\renderer\\src\\lib\\canvas\\executionOrder.ts':
    '执行顺序分析辅助（findControlEdge/findAllEdgesBetween/getOrphanNodes）未接入',
  'src\\shared\\domain\\common\\standardEvent.ts':
    '事件类型判定辅助（isNoticeEvent/isRequestEvent…）—— 目前靠字段判断，未用到这些谓词',
  'src\\shared\\domain\\common\\utils.ts': '目录工具（listSubdirectories/projectDirOf）未接入',
  'src\\shared\\errors\\codes.ts': '错误码工具（fromUnknown/isAppError）未接入',
  'src\\shared\\message\\compose.ts':
    '消息拼装辅助（md* 系列）；当前消息都由节点配置拼，用不到这些',
}

/** 单条豁免（键 = `相对路径:名字`） */
const BASELINE_NAMES: Record<string, string> = {
  // 2026-10：dataBrowserConstants.ts 拆成 dataBrowserData + 三个逻辑文件后，原来那条**文件级豁免**
  // （"字段判定辅助部分未用"）变成按名登记 —— 分散到哪个文件就登记哪个文件。
  'src\\renderer\\src\\components\\launch\\dataBrowserData.ts:getClustersForBotType':
    '数据面板的字段判定辅助（部分未用）—— 面板本体在跑，这个按需保留',
  'src\\renderer\\src\\components\\launch\\fieldValues.ts:isBooleanValue':
    '同上：按需保留的判定函数（当前没有调用点）',
  'src\\renderer\\src\\components\\launch\\characterFields.ts:isInBattleField':
    '同上：按需保留的判定函数（当前没有调用点）',
  'src\\renderer\\src\\components\\launch\\characterFields.ts:isGameMode':
    '同上：按需保留的判定函数（当前没有调用点）',
  'src\\renderer\\src\\components\\launch\\characterFields.ts:shouldDisplayField':
    '同上：按需保留的判定函数（当前没有调用点）',
  'src\\main\\ipc\\_shared.ts:ipcHandle': '零引用扫描基线（2026-10-01 首次登记；清理时请补上用途）',
  'src\\main\\services\\ai\\context.ts:collectUserMessage':
    '提示词组装的辅助（当前直接拼 user 消息）',
  'src\\main\\services\\project\\dataNotifyService.ts:getBridgePort':
    '数据变更通知的端口查询未接入',
  'src\\main\\services\\ops\\dockerExport.ts:_checkPath': '导出时的路径检查（内部辅助）',
  'src\\main\\services\\infra\\logger.ts:initRendererLogger':
    '渲染层日志初始化未接入（主进程日志在跑）',
  'src\\main\\services\\project\\schemaService.ts:getCompositeTypeDef': '复合类型查询未接入',
  'src\\main\\services\\runner\\terminal.ts:resizeTerminal':
    '终端尺寸调整未接入（终端在跑，尺寸没同步）',
  'src\\renderer\\src\\lib\\infra\\format.ts:formatFullDateTime':
    '零引用扫描基线（2026-10-01 首次登记；清理时请补上用途）',
  'src\\renderer\\src\\lib\\infra\\format.ts:formatTimeOnly':
    '零引用扫描基线（2026-10-01 首次登记；清理时请补上用途）',
  'src\\renderer\\src\\lib\\canvas\\portMatcher.ts:findCompatibleSources': '端口兼容性建议未接入',
  'src\\main\\services\\builtinNodes\\controlNodes.ts:switchCase':
    '⚠️ 由代码生成器**按名发射**（nodeRegistry handlerModule: switchCase），生成的代码会 import 它 —— 静态引用扫不到，属真例外',
  'src\\main\\services\\builtinNodes\\controlNodes.ts:subflowCall':
    '⚠️ 同上：代码生成器按名发射 subflowCall(...)（codegen/emitters.ts:281），静态引用扫不到',
  'src\\main\\services\\ai\\historyStore.ts:defaultHistoryFile':
    '泛化出口（可指向任意 JSONL）：机器人侧自己拼 conversationFile，所以没人调它；保留是为了让"追加式落盘"只有一个入口（接上或删除时从基线移除）',
}

/**
 * **仅测试引用**（生产路径没接）的基线。
 *
 * 这一类是"写好了没接线"最常见的藏身处：
 * 测试里调得好好的，生产路径上却没人调 ——
 * `cancelAiChat`（「停止」按钮真正的 abort）就是这么躲过了半年。
 * 所以**两类都管**：新增的仅测试引用同样红。
 */
const BASELINE_TEST_ONLY: Record<string, string> = {
  'src\\main\\services\\agent-core\\runTurn.ts:isToolCall':
    '⚠️ 进行中：供调用方做类型收窄（避免 UI 层写 as），接线时使用。',
  'src\\main\\services\\agent-core\\modelAdapter.ts:createModelFn':
    '⚠️ 进行中：模型适配器，**接代码页开关时**由 main 装配（createModelFn(config) → runAgentLoop）。接线后删掉本条。',
  'src\\main\\services\\agent-core\\sandbox.ts:setSandboxProvider':
    '**缝**：生产里还没有第二个沙箱实现，测试用它证明"换提供者循环不改一行"。' +
    '接容器/受限账户时会有真实调用点，届时删掉本条。',
  'src\\main\\services\\agent-core\\sandbox.ts:getSandboxProvider':
    '**缝**：同上（读当前提供者，只有测试与未来的诊断面板用）。',
  'src\\main\\services\\plugins\\sandboxPluginActivator.ts:activateSandboxPlugin':
    '**沙箱插件激活**：目前只有闭环测试在驱动；等 pluginScanner 真正调它装机后删掉本条。',
  'src\\main\\services\\plugins\\sandboxPluginBridge.ts:createSandboxPluginBridge':
    '**沙箱插件桥**：目前只有测试在驱动（真实接线要等 pluginScanner 把桥接进沙箱）。接线后删掉本条。',
  'src\\main\\services\\plugins\\host.ts:registerMainPlugin':
    '**主进程插件宿主 v0.1**：目前只有测试在驱动（树内插件示例）。' +
    '等 inspectDir IPC / 预设接入后就有真实调用点，届时删掉本组条目。',
  'src\\main\\services\\plugins\\host.ts:setMainPluginEnabled':
    '同上：启停入口，等界面（插件页）或预设切换接入后删。',
  'src\\main\\services\\plugins\\host.ts:unregisterMainPlugin':
    '同上：卸载入口，测试清理用，等卸载流程接入后删。',
  'src\\main\\services\\plugins\\host.ts:listMainPlugins': '同上：清单，等插件页展示接入后删。',
  'src\\main\\services\\infra\\sqlite.ts:setSqliteLoaderForTesting':
    '**测试接缝**：注入会抛错的假 loader，证明「原生模块不可用 → 兜底/明确报错」这条路径；生产只走真实加载。',
  'src\\main\\services\\infra\\sqlite.ts:setSqliteFallbackForTesting':
    '**测试接缝**：模拟没有 node:sqlite 的运行时，验证兜底也缺失时的报错文案；生产靠自动探测。',
  'src\\main\\services\\agent-core\\computerUse.ts:CdpPage':
    '⚠️ 进行中：CDP 客户端（截图/求值/点击），**接进工具层（computer_use 工具）时**由循环持有。接线后删掉本条。',
  'src\\main\\services\\agent-core\\computerUse.ts:listCdpTargets':
    '⚠️ 进行中：列可调试页面，接线时由 computer_use 工具调用。',
  'src\\main\\services\\agent-core\\terminal.ts:ShellSession':
    '⚠️ 进行中：持久 shell 会话，**接进工具层（terminal 工具）时**由循环持有。接线后删掉本条。',
  'src\\main\\services\\agent-core\\adapters.ts:makeContextService':
    '⚠️ 进行中：上下文适配器，接线阶段由 main 注入 tokenBudget/spill。',
  'src\\main\\services\\agent-core\\adapters.ts:makeSessionStore':
    '⚠️ 进行中：会话适配器，接线阶段由 main 注入 historyStore。',
  'src\\main\\services\\agent-core\\adapters.ts:assembleAgentServices':
    '⚠️ 进行中：装配点，循环接入时在 main 里调用；接线后删掉本条。',
  'src\\main\\services\\agent-core\\adapters.ts:makeSandboxService':
    '⚠️ 进行中：契约适配器，**循环接入阶段**装配到 AgentServices。接线后删掉。',
  'src\\main\\services\\agent-core\\adapters.ts:makeTraceSink':
    '⚠️ 进行中：trace 适配器，接线后由 main 装配传入 appendTrace。',
  'src\\main\\services\\agent-core\\adapters.ts:makeApprovalService':
    '⚠️ 进行中：审批适配器，接线后由 main 装配传入 requestApproval。',
  'src\\main\\services\\agent-core\\core.ts:runAgentLoop':
    '⚠️ 进行中：workspace-first 重写的循环骨架，**生产接线在下一阶段**（agent-core 接到助手链路）。接线后删掉这条。',
  'src\\main\\services\\agent-core\\core.ts:CORE_TOOLS':
    '⚠️ 进行中：agent-core 的内置工具集（read/write/run），接线后由循环消费。',
  'src\\main\\services\\agent-core\\core.ts:resolveInWorkspace':
    '⚠️ 进行中：工作区路径沙箱，供工具/测试复用；接线后由工具层调用。',
  'src\\main\\services\\agent-core\\core.ts:runCommand':
    '⚠️ 进行中：白名单命令执行，run_command 工具的实现体；接线后在循环里被调。',
  'src\\main\\services\\agent-core\\core.ts:MAX_ROUNDS_DEFAULT':
    '⚠️ 进行中：循环默认轮数上限，接线后由配置覆盖。',
  'src\\main\\services\\ai\\codeSnippet.ts:runCodeSnippet':
    '⚠️ 进行中：CodeAct 闭环的沙箱执行核心，**工具层接线在下一步**（run_code_snippet → execute.ts）。' +
    '接线完成后这条豁免要删掉 —— 它是"还没接上"，不是"不需要"。',
  'src\\main\\services\\ai\\instructionBridge.ts:pendingInstructionCount':
    '观测/自省口：断言"还有多少条写指令在等回执"（用例间隔离与诊断都用得上）。' +
    '生产暂无消费方 —— 诊断包接入时接上，或删除。',
  'src\\main\\services\\ai\\toolApproval.ts:_resetApprovals':
    '仅测试引用：清空等待中的批准（用例间隔离）。生产走 cancelApprovalsFor（整轮取消时调）',
  'src\\main\\services\\flow\\turnJournal.ts:peekTurn':
    '仅测试引用的自省口（看「当前这一轮记了什么」）—— 生产路径不需要它：' +
    '回滚走 rollbackTurn(读盘上的轮次文件)，UI 走 listTurns',
  'src\\main\\services\\flow\\turnJournal.ts:_resetRunningTurns':
    '仅测试引用：清掉内存里的进行中轮次（用例间隔离）。生产里轮次由 begin/endTurn 成对管理',
  'src\\main\\services\\plugins\\market.ts:listInstalledMarketPlugins':
    '仅测试引用的自省口（看装了哪些、哈希是多少）；生产只经 listMarketPlugins 的 installed 字段与 restore 时的 readInstalled 消费。',
  'src\\renderer\\src\\components\\ui\\Tabs.tsx:Tabs':
    '⚠️ 待定：通用 UI 组件；它原本的**生产消费者是已删的 deploy 对话框**（级联暴露）—— ' +
    '现在只有测试用。接上别的界面，还是跟着一起删？',
  'src\\main\\runtime\\portValue.ts:coercePortValue':
    '闸 2 的**严格规格**函数（按声明类型硬转）—— 运行时**不用它**（用它接线会改坏真实流程，' +
    '见 docs/nodes/nodes-architecture-review-2026-10-03.md 附录 H）。运行时用的是同文件的 ' +
    'normalizePortValueForRuntime（保守版）。它的价值是当"行为规格"：38 条矩阵钉着它。',
  'src\\main\\codegen\\expressionCompiler.ts:clearCache':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\codegen\\expressionSafety.ts:isExpressionSafe':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\ipc\\ai.ts:loadAiConfigFromProject':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\ipc\\customNode.ts:_closeAllWatchersForTesting':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\ipc\\customNode.ts:setAiGeneratedScanner':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\ai\\ipcBridge.ts:clearCapturedHandlersForTest':
    '仅测试引用：捕获表是模块级单例，测试之间必须清空（否则前一个用例喂的假 handler 会漏到下一个）。' +
    '生产路径不该清它 —— 启动时捕获一次，之后一直有效。',
  'src\\main\\ipc\\metrics.ts:cleanupMetricsIpc':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\nodes\\compat.ts:toNodeSpecV2':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\baseData.ts:baseDataFullKey':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\dynamicHandlers.ts:_clearDynamicHandlersForTesting':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\dynamicHandlers.ts:dynamicHandlerCount':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\dynamicHandlers.ts:unregisterDynamicHandler':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\handlerRegistry.ts:listHandlers':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\previewRunner.ts:_isPreviewRunning':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\waitRegistry.ts:_resetWaitsForTesting':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\runtime\\waitRegistry.ts:listWaits':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\ai\\index.ts:clearAiHistory':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\ai\\protocolApiCatalog.ts:allProtocolApis':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  // 2026-10-08：`tokenBudget` 的 usage 校准层整块**已删除**（那 5 条基线随之移除）。
  // 原因写在 `tokenBudget.ts` 对应位置：① 它在生产里零调用点；② 用途本身站不住 ——
  // 估算的用途是"上下文治理"这个功能参数，不是账。要看真实用量，界面显示的是厂商口径的 token。
  'src\\main\\services\\ai\\toolMessages.ts:buildToolFailureMessages':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\ai\\writeGuard.ts:resetObservedFiles':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\bot\\memory.ts:forgetConversation':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\bot\\policy.ts:addDailyUsage':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\project\\dataService.ts:closeAllConnectionsForTesting':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\project\\dataService.ts:setDbCtorForTesting':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\ops\\git.ts:resetGitWarnState':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\lark\\frame.ts:decodePayloadJson':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\plugins\\pluginLoader.ts:clearAllPlugins':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\bot\\segmentTranslator.ts:attachmentsToSegments':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\bot\\segmentTranslator.ts:translateSegments':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  // 扁平副本（生产走 services/bot/segmentTranslator.ts）：原先唯一引用是已删除的旧翻译器测试
  'src\\main\\services\\segmentTranslator.ts:attachmentsToSegments':
    '扁平副本，零生产引用；整文件去重时一并处理（与 bot/segmentTranslator.ts 合并）',
  'src\\main\\services\\segmentTranslator.ts:translateSegments':
    '扁平副本，零生产引用；整文件去重时一并处理（与 bot/segmentTranslator.ts 合并）',
  'src\\renderer\\src\\components\\launch\\characterFields.ts:extractCharacterFields':
    '仅测试引用，生产路径未接（2026-10 拆文件后从 dataBrowserConstants.ts 跟到这里）',
  'src\\renderer\\src\\components\\ui\\Input.tsx:Input':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\components\\ui\\Select.tsx:Select':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\components\\ui\\Textarea.tsx:Textarea':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\components\\ui\\Tooltip.tsx:Tooltip':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\lib\\canvas\\autoGroup.ts:groupSummary':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\lib\\canvas\\connectionValidator.ts:validateGraph':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\lib\\canvas\\executionOrder.ts:getOrphanNodes':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\lib\\expression\\expressionVars.ts:isLegalExprVarName':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\lib\\canvas\\panelSelection.ts:samePanelItems':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\stores\\flowStore.ts:_cancelAutoSaveForTesting':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\renderer\\src\\stores\\flowStore.ts:getFirstErrorField':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\domain\\common\\capabilities.ts:capabilityOfAction':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\domain\\common\\capabilities.ts:describeCapability':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\domain\\common\\capabilities.ts:missingCapabilities':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\domain\\common\\runtimeEventConvert.ts:fromRuntimeEvent':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\domain\\common\\standardEvent.ts:isCustomEvent':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\message\\compose.ts:mdImage':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\catalog\\build.ts:collectMissingCopy':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\catalog\\build.ts:resetMissingCopy':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\fieldVisibility.ts:findVisibilityDrift':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\fieldVisibility.ts:partitionDataInputs':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\flowNormalize.ts:dropInvalidEdges':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\flowNormalize.ts:hasBlockingIssues':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\nodes\\portUtils.ts:portsArePlain':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\shared\\persist\\value.ts:describeExpiry':
    '仅测试引用，生产路径未接（首次登记；接上或删除时从基线移除）',
  'src\\main\\services\\runner\\runtimeLogStore.ts:clearRuntimeLogs':
    '测试夹具用；生产侧不需要主动清空 —— 缓冲有 300 条上限，自己会收敛（接上或删除时从基线移除）',
  'src\\main\\vendor\\dsh\\tool-pipeline\\pipeline.ts:fuseToolSignals':
    'vendored 纯函数；本仓 dispatch 直接用 caller 的 signal（不另建 wrapper），生产侧不调它。保留供以后接内部取消源时用。',
}

/**
 * **恢复树专用基线**（2026-10-23 重组时新增）：
 * 本树是 10/18 asar 的源码还原 + 磁带里更晚 revision 的测试，两边不同步会让同一批导出在
 * 「零引用」和「仅测试引用」之间漂移。下面按**原因分组**登记存量，按组写理由（逐条写会重复一百遍）。
 * 它同样是**待清理清单**：接上或删除时把对应键移出。
 */
const RESTORED_REASON =
  '恢复树存量（分组理由见上方注释）：10/18 产物与磁带测试不同步造成；接上或删除时移出本条'

const RESTORED_BASELINE: Record<string, string> = {
  // 10/18 之后的 AI 分流/规划/检索层（planner·rag·lanes·scout·readOnlyRoute·benchmark·allowRules·legacyTools）—— 源码已恢复、测试在驱动，但入口（processAiChat 的只读分流/规划开关）尚未接线；接线后逐条移出。
  'src\\main\\services\\agent-core\\legacyTools.ts:adaptLegacyTools': RESTORED_REASON,
  'src\\main\\services\\ai\\allowRules.ts:toolRuleMatch': RESTORED_REASON,
  'src\\main\\services\\ai\\lanes.ts:isSubagentLanesEnabled': RESTORED_REASON,
  'src\\main\\services\\ai\\lanes.ts:renderLaneReports': RESTORED_REASON,
  'src\\main\\services\\ai\\lanes.ts:runPlanLanes': RESTORED_REASON,
  'src\\main\\services\\ai\\planner.ts:arbitratePlan': RESTORED_REASON,
  'src\\main\\services\\ai\\planner.ts:isPlanningEnabled': RESTORED_REASON,
  'src\\main\\services\\ai\\planner.ts:planWithModel': RESTORED_REASON,
  'src\\main\\services\\ai\\planner.ts:renderPlan': RESTORED_REASON,
  'src\\main\\services\\ai\\planner.ts:shouldPlan': RESTORED_REASON,
  'src\\main\\services\\ai\\rag.ts:authorEmbedder': RESTORED_REASON,
  'src\\main\\services\\ai\\rag.ts:isRagEnabled': RESTORED_REASON,
  'src\\main\\services\\ai\\rag.ts:recordTurnMemory': RESTORED_REASON,
  'src\\main\\services\\ai\\rag.ts:renderRetrieved': RESTORED_REASON,
  'src\\main\\services\\ai\\rag.ts:retrieveMemories': RESTORED_REASON,
  'src\\main\\services\\ai\\readOnlyRoute.ts:shouldRouteReadOnlyToLoop': RESTORED_REASON,
  'src\\main\\services\\ai\\scout.ts:renderFindings': RESTORED_REASON,
  'src\\main\\services\\ai\\scout.ts:scoutWithModel': RESTORED_REASON,
  'src\\main\\services\\benchmark.ts:runBenchmark': RESTORED_REASON,

  // 渲染层组件可编译但本构建无挂载点（BlockView 等旧画布视图）。已按客户端基准归档的组件见 _recovery/dead-renderer/。
  'src\\renderer\\src\\lib\\mockRunner.ts:simulateExecution': RESTORED_REASON,

  // 扁平副本的导出：生产走同名嵌套实现或另一条路径（crashReporter/dockerExport/terminal/pluginLoader/templates/schemaService/runtimeLogStore/configTemplateService）—— 属恢复树里的重复副本，去重时整文件处理。
  'src\\main\\services\\configTemplateService.ts:_getConfigTemplatesDir': RESTORED_REASON,
  'src\\main\\services\\configTemplateService.ts:initProjectConfigTables': RESTORED_REASON,
  'src\\main\\services\\crashReporter.ts:initCrashReporter': RESTORED_REASON,
  'src\\main\\services\\dockerExport.ts:_checkPath': RESTORED_REASON,
  'src\\main\\services\\dockerExport.ts:detectProjectRequirements': RESTORED_REASON,
  'src\\main\\services\\dockerExport.ts:readProjectRequirements': RESTORED_REASON,
  'src\\main\\services\\runner\\runtimeLogStore.ts:pushRuntimeLog': RESTORED_REASON,
  'src\\main\\services\\schemaService.ts:getCompositeTypeDef': RESTORED_REASON,
  'src\\main\\services\\templates.ts:getTemplatesByCategory': RESTORED_REASON,
  'src\\main\\services\\terminal.ts:resizeTerminal': RESTORED_REASON,
  'src\\main\\templates\\index.ts:getImportableTemplate': RESTORED_REASON,

  // codegen 辅助：TS 生成器已接通（controlFlowEmitter/emitters 走 dataflow 的 tsLiteral/tsIdentifier），
  // 这两个导出留给后续「变量解构」优化，目前无调用点。
  'src\\main\\codegen\\dataflow.ts:generateVariableDestructuring': RESTORED_REASON,
  'src\\main\\codegen\\dataflow.ts:resolveNamedVarSyntax': RESTORED_REASON,

  // 恢复树存量：10/18 产物与磁带测试不同步造成的零/仅测试引用；逐条在清理时确认（接上、或删除）。
  'src\\main\\ipc\\adapter.ts:getCurrentAdapterType': RESTORED_REASON,
  'src\\main\\ipc\\customNode.ts:closeAllWatchersForTesting': RESTORED_REASON,
  'src\\main\\runtime\\waitRegistry.ts:restoreWaitsFor': RESTORED_REASON,
  'src\\main\\schemas\\project.ts:projectPathSchemaWithin': RESTORED_REASON,
  'src\\main\\services\\flow\\turnProjection.ts:listTurnProjections': RESTORED_REASON,
  'src\\main\\services\\plugins\\layers.ts:composeLayer': RESTORED_REASON,
  'src\\shared\\nodes\\varRef.ts:isNamedVarKey': RESTORED_REASON,
  'src\\shared\\nodes\\varRef.ts:namedVarNameOf': RESTORED_REASON,
  'src\\shared\\runtime\\rolldownShim.ts:__commonJSMin': RESTORED_REASON,
  'src\\shared\\types\\nodeV2.ts:inferRiskLevel': RESTORED_REASON,
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.dsh-tmp') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

interface DeadExport {
  name: string
  rel: string
}

/** 单遍解析：统计标识符出现 + 收集导出（别写成"每个导出都重扫全仓"，那是 O(n²)） */
function scan(): { dead: DeadExport[]; testOnly: DeadExport[]; exportCount: number } {
  const srcFiles = walk(join(ROOT, 'src'))
  const testFiles = walk(join(ROOT, 'tests'))
  const refs = new Map<string, { src: number; tests: number }>()
  const bump = (name: string, bucket: 'src' | 'tests'): void => {
    const e = refs.get(name) ?? { src: 0, tests: 0 }
    e[bucket] += 1
    refs.set(name, e)
  }

  const exports: Array<{ name: string; file: string }> = []
  for (const file of [...srcFiles, ...testFiles]) {
    const bucket = file.startsWith(join(ROOT, 'tests')) ? 'tests' : 'src'
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf-8'),
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    )
    /**
     * ⚠️ `import { x }` / `export { x }` 里的标识符**不算使用**。
     * 否则"导入了但从不调用"会被当成已接线 ——
     * 本闸门的第一版就是这么把 `cancelAiChat` 漏掉的（反向对照时才发现）。
     */
    const isImportExportName = (node: ts.Node): boolean => {
      const parent = node.parent as ts.Node | undefined
      if (!parent) return false
      return (
        ts.isImportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isNamespaceImport(parent) ||
        ts.isExportSpecifier(parent)
      )
    }
    /**
     * ★ 别名映射：`import { formatTimeOnly as formatTime }` 之后，**使用点写的是别名**
     * `formatTime`，而本闸门数的是**原名** `formatTimeOnly` —— 于是"导入了、也真的在用"
     * 会被误判成零引用 ✗（2026-10-03 实测：差点删掉 format.ts 的两个活函数，靠 tsc 兜住）。
     * 所以先把别名记下来，遇到别名时按**原名**计数。
     */
    const aliases = new Map<string, string>()
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue
      const nb = stmt.importClause.namedBindings
      if (!ts.isNamedImports(nb)) continue
      for (const spec of nb.elements) {
        if (spec.propertyName) aliases.set(spec.name.text, spec.propertyName.text)
      }
    }
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isImportExportName(node)) {
        bump(node.text, bucket)
        const original = aliases.get(node.text)
        if (original) bump(original, bucket)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    if (bucket !== 'src') continue
    for (const stmt of sf.statements) {
      const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined
      if (!mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      if (ts.isFunctionDeclaration(stmt) && stmt.name) exports.push({ name: stmt.name.text, file })
      else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(d.name) &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          ) {
            exports.push({ name: d.name.text, file })
          }
        }
      }
    }
  }

  const dead: DeadExport[] = []
  const testOnly: DeadExport[] = []
  for (const e of exports) {
    const r = refs.get(e.name) ?? { src: 0, tests: 0 }
    const srcOthers = r.src - 1
    const item = { name: e.name, rel: relative(ROOT, e.file) }
    if (srcOthers + r.tests <= 0) dead.push(item)
    else if (srcOthers <= 0) testOnly.push(item)
  }
  return { dead, testOnly, exportCount: exports.length }
}

describe('零引用导出', () => {
  const { dead, testOnly, exportCount } = scan()

  it('★ 每一个零引用导出都在基线里（新增的必须接上或写明理由）', () => {
    const unregistered = dead.filter(d => {
      const rel = d.rel.replace(/\//g, '\\')
      const key = `${rel}:${d.name}`
      // 恢复树：源（10/18 产物）与测试（更晚 revision）不同步，同一批导出会在两个桶之间漂移；
      // 因此三类基线都算已登记，但**新增**的死导出仍然会红。
      return (
        !(rel in BASELINE_FILES) &&
        !(key in BASELINE_NAMES) &&
        !(key in BASELINE_TEST_ONLY) &&
        !(key in RESTORED_BASELINE)
      )
    })

    expect(
      unregistered,
      unregistered.length === 0
        ? ''
        : '这些导出**全仓零引用**（生产与测试都没人用）。两种修法：\n' +
            '  ① **接上它** —— 生产路径真的调用（正常情况，本仓库 7 处"写好了没接线"都是这么修的）\n' +
            '  ② 在 BASELINE_FILES / BASELINE_NAMES 里登记并**写明理由**\n' +
            unregistered.map(d => `  ${d.rel}  ${d.name}`).join('\n'),
    ).toEqual([])
  })

  // ★ 正控（2026-10-03 加）：别名导入必须算引用。
  // 起因：`import { formatTimeOnly as formatTime }` 的使用点写的是**别名**，而扫描数的是**原名**
  // → 两个真在用的函数被判成"零引用"，我差点把它们删掉（tsc 兜住）。这条断言把它们钉在"活"的一侧。
  it('★ 别名导入（import { X as Y }）必须算引用 —— 否则活函数会被误判成零引用', () => {
    const deadKeys = new Set(dead.map(d => `${d.rel.replace(/\//g, '\\')}:${d.name}`))
    for (const key of [
      'src\\renderer\\src\\lib\\infra\\format.ts:formatTimeOnly',
      'src\\renderer\\src\\lib\\infra\\format.ts:formatFullDateTime',
    ]) {
      expect(deadKeys.has(key), `${key} 被判成零引用 —— 别名映射可能失效了`).toBe(false)
    }
  })

  it('★ 仅测试引用的导出也必须登记（这类正是"写好了没接线"）', () => {
    const unregistered = testOnly.filter(d => {
      const rel = d.rel
      const key = `${rel}:${d.name}`
      return !(key in BASELINE_TEST_ONLY) && !(key in BASELINE_NAMES) && !(key in RESTORED_BASELINE)
    })

    expect(
      unregistered,
      unregistered.length === 0
        ? ''
        : '这些导出**只有测试引用、生产路径没接**（测试里调得好好的）。两种修法：\n' +
            '  ① **接上它**（正常情况：「停止」按钮就是这么假了半年）\n' +
            '  ② 在 BASELINE_TEST_ONLY 里登记并写明理由\n' +
            unregistered.map(d => `  ${d.rel}  ${d.name}`).join('\n'),
    ).toEqual([])
  })

  it('扫描确实在工作（防止某次改动把扫描变成空转）', () => {
    expect(exportCount).toBeGreaterThan(800)
    expect(dead.length).toBeGreaterThan(0)
  })

  it('基线里"已经不再零引用"的项会被报出来（提示可以清理）', () => {
    const deadKeys = new Set(dead.map(d => `${d.rel.replace(/\//g, '\\')}:${d.name}`))
    const deadFiles = new Set(dead.map(d => d.rel.replace(/\//g, '\\')))
    const stale = [
      ...Object.keys(BASELINE_FILES).filter(f => !deadFiles.has(f)),
      ...Object.keys(BASELINE_NAMES).filter(k => !deadKeys.has(k)),
    ]
    if (stale.length > 0) {
      // 只提示不失败：接上了是好事，别让"清理"变成负担
      console.log(
        `[deadExports] 基线里有 ${stale.length} 项已经接上了，可以从基线移除：\n  ${stale.join('\n  ')}`,
      )
    }
    expect(true).toBe(true)
  })
})
