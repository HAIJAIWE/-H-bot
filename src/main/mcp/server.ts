// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
/**
 * SDK 是纯 ESM（package.json exports 的 "./*" 指向 dist/esm），**没有 default 导出**：
 * 恢复时写成 `import X from "..."` 会在运行期拿到 undefined（`X.Server` 直接炸）。
 * 这里用命名空间导入，再把打包器生成的长名字别名过去，正文一个字都不用改。
 */
import * as serverSdk from '@modelcontextprotocol/sdk/server/index.js'
import * as stdioSdk from '@modelcontextprotocol/sdk/server/stdio.js'
const _modelcontextprotocol_sdk_server_index_js = serverSdk
const _modelcontextprotocol_sdk_server_stdio_js = stdioSdk
import * as node_crypto from 'node:crypto'
import * as node_fs from 'node:fs'
import { isMcpTurnJournalEnabled, shouldJournalTurn, turnLabelFor } from './mcpTurnJournal'
import { mcpToolVerdict } from './mcpToolGuard'
import * as electron from 'electron'
import { PROPOSAL_ONLY_TOOLS, buildProposalForToolCall } from './mcpProposal'
import { denialForAppManagedWrite, denialForWrites, noteFileRead } from '../services/ai/writeGuard'
import * as sdkTypes from '@modelcontextprotocol/sdk/types.js'
const _modelcontextprotocol_sdk_types_js = sdkTypes
import { TransportManager } from './transport-manager'
import { init_logger, logger } from '../services/infra/logger'
import { ALL_TOOL_DEFINITIONS, findToolDef } from '../services/ai/tools/defs'
import { joinSafe } from '../services/infra/pathGuard'
import { beginTurn, currentTurnId, endTurn } from '../services/flow/turnJournal'
import { budgetToolResult, pruneText } from '../services/ai/toolResultBudget'
import { VERDICT_HINT } from '../services/ai/toolGuard'
import { requestApproval } from '../services/ai/toolApproval'
import { executeTool } from '../services/ai/tools/execute'
import { dispatchInstruction } from '../services/ai/instructionBridge'
import { describeInstructionOutcome } from '../../shared/protocol/instruction'

/** 整文件覆盖类工具 → writeGuard 的操作 kind */
var WRITE_TOOL_KIND = {
  write_code: 'write_code',
  write_file: 'write_file',
}
/**
 * 取写文件类工具的目标相对路径。
 *
 * ⚠️ **必须与渲染层真正写下去的字段取法一致**（2026-10-16，P0-7 顺手发现的不一致）：
 * `write_code` 的声明参数是 `filePath`、`write_file` 的是 `path`，而渲染层
 * `handleClientInstruction` 原本只认 `filename || path` —— 两个字段各写一个值的时候，
 * **主进程校验的路径与真正写下去的路径可以不是同一个**（校验放过 A、写下去 B）。
 * 现在两边用同一个顺序取（渲染层那边同步改成了 `filename || filePath || path`），
 * 于是"这里拒掉的就是客户端真会写到的"。
 */
function writeTargetOf(_name, args) {
  const raw = args.filename ?? args.filePath ?? args.path
  return typeof raw === 'string' && raw.trim() ? raw : void 0
}
interface McpCallToolResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}
/** 工具调用入口的公开形状（测试与外部客户端都按它取 content/isError） */
type McpCallTool = (name: string, args?: Record<string, unknown>) => Promise<McpCallToolResult>
/**
 * 创建 MCP server 实例并注册工具。
 *
 * 工具集复用 ALL_TOOL_DEFINITIONS（包含 list_nodes/add_node/connect_nodes/
 * generate_code/read_flow/read_code 等）。第一版直接调用 executeTool 执行，
 * 不经过 Proposal 累积/确认流程（方式 B）。
 */
function createMcpServer(ctx) {
  const authToken =
    ctx.authToken && ctx.authToken.trim() ? ctx.authToken : (0, node_crypto.randomUUID)()
  const server = new _modelcontextprotocol_sdk_server_index_js.Server(
    {
      name: 'qqbat-mcp',
      version: '1.0.0',
    },
    { capabilities: { tools: {} } },
  )
  const toolNames = ALL_TOOL_DEFINITIONS.map(t => t.name)
  const listTools = async () => ({
    tools: ALL_TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    })),
  })
  /**
   * 目标文件在项目内且已存在。
   *
   * 越界路径交给 executeTool 去报错 —— 这里返回 false，即"不当作可覆盖的已存在文件"，
   * 免得 pathGuard 抛出的异常把整次 callTool 变成 500 风格的失败。
   */
  const existsOnDisk = relPath => {
    try {
      return (0, node_fs.existsSync)(joinSafe(ctx.projectPath, relPath))
    } catch {
      return false
    }
  }
  /**
   * ── 【轮次日志】（P0-6）───────────────────────────────────────────────
   *
   * MCP 是**唯一不经 Proposal 的写路径**（直接 executeTool 派发）。在补这段之前，`beginTurn`
   * 只在对话引擎里调，于是外部 IDE 改完流程/文件**没有轮次记录、没有快照、撤不回来**。
   * 这里补上一轮：会**产生改动**的调用开轮次（复用 turnJournal 的 beginTurn/endTurn），
   * 只读调用不开（否则 `.qqbat/history/turns/` 会被查资料刷满）。
   *
   * ## 为什么状态放在**闭包**里（而不是模块级）
   *
   * 一个 MCP server 实例只服务一个项目，但同一进程里可能同时有 AI 会话在同一个项目上干活 ——
   * 收尾时必须确认"这一轮**还是我开的**那一轮"，否则会把别人的轮次收掉。`openTurn` 记住的
   * 就是这个身份；判据用既有的 `currentTurnId`（与对话引擎的 finally 守卫同一条纪律）。
   */
  let openTurn = null
  /** 「别人有轮次」这条日志只打一次（一个客户端连改十次不必刷十行日志） */
  let loggedJoinedTurn = false
  /**
   * 开一轮（幂等：一次调用只开一个；已有别人的轮次时不抢）。
   *
   * ⚠️ **P0-13 ④：这里以前有个粘滞开关**（`declinedExistingTurn`）——
   * 一旦撞上别人的轮次就**这一整条连接都不再开轮次**，哪怕那条 AI 轮次早就结束了。
   * 于是「并发撞一次 ⇒ 之后每次改动都不进轮次日志（撤不回来）」—— 一次偶发冲突被放大成
   * 永久失效。现在改成**每次都重新判**：撞上就加入（`recordFileBefore` 会记进别人那一轮，
   * 同一时间窗的改动一起撤回），没有就自己开。
   */
  const openTurnIfNeeded = async toolName => {
    if (!isMcpTurnJournalEnabled() || !shouldJournalTurn(toolName)) return
    if (openTurn) return
    /**
     * 已经有进行中的轮次（例如用户正在应用内让 AI 干活）⇒ **不抢**。
     * `beginTurn` 会无条件覆盖 RUNNING 槽位，抢了会把别人的轮次顶掉（对方的记录就丢了）。
     * 加入它是对的：本 call 里 `recordFileBefore` 会写进**那一轮**，用户撤那一轮时一起还原。
     */
    if (currentTurnId(ctx.projectPath)) {
      if (!loggedJoinedTurn) {
        loggedJoinedTurn = true
        logger.info(`[mcp] 该项目已有进行中的轮次，本次改动并进那一轮（${toolName}）`)
      }
      return
    }
    const turnId = await beginTurn(ctx.projectPath, turnLabelFor(toolName))
    openTurn = {
      projectPath: ctx.projectPath,
      turnId,
    }
    logger.info(`[mcp] 已开轮次（${turnLabelFor(toolName)}）：${turnId}`)
  }
  /**
   * ── 【工具闸】（P0-13 ①）──────────────────────────────────────────────
   *
   * 外部 IDE 通过 MCP 调工具**以前从不经过用户**：`run_bot` 能起机器人、`run_test` 真跑流程
   * （写玩家数据）、`invoke_capability` 能删表/发消息 —— 全都没有确认。
   * 循环路径早就有一道闸（tool-batch 派发前 `classifyTool` → `requestApproval`），MCP 这条直接
   * executeTool 的旁路把它整个绕过了。
   *
   * 这里**复用同一套**：判据 `mcpToolVerdict`（= toolGuard.classifyTool）、弹窗与等待
   * `requestApproval`（同一个 `ai:approvalRequest` 通道，界面无需新增）。
   *
   * 三条纪律（与 toolApproval.ts 对齐）：
   *   · **没有窗口 = 拒绝**（fail-safe）：没人能确认就不能默认放行；
   *   · 用户拒绝 / 超时 = **拒绝**，被拒的调用**不派发**（客户端拿到可读的 isError，不是假成功）；
   *   · 「以后别再问」的作用域是**这一条 MCP 连接**（与助手路径的「本轮内」同一语义）。
   */
  const approvedTools = /* @__PURE__ */ new Set()
  /** 统一的 MCP 错误响应（走同一个预算裁剪，别让异常文本无限大） */
  const errorResult = text => ({
    isError: true,
    content: [
      {
        type: 'text',
        text: pruneText(text).text,
      },
    ],
  })
  const applyToolGuard = async (name, args) => {
    const verdict = mcpToolVerdict(name, approvedTools)
    if (verdict === 'auto') return { ok: true }
    if (verdict === 'deny') {
      logger.warn(`[mcp] 工具闸禁止调用：${name}`)
      return {
        ok: false,
        result: errorResult(`工具 ${name} 已被策略禁止：${VERDICT_HINT.deny}。`),
      }
    }
    /** verdict === 'ask'：**真的停下来等用户**（与助手路径同一条通道） */
    const win = electron.BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) {
      /**
       * 没有窗口 = 没人能点确认。**必须拒绝**：
       * 否则外部客户端只要在窗口关掉时调用，闸门就等于不存在。
       */
      logger.warn(`[mcp] 需要用户确认但当前没有应用窗口，按拒绝处理：${name}`)
      return {
        ok: false,
        result: errorResult(
          `工具 ${name} ${VERDICT_HINT.ask}，但当前没有可用的应用窗口。请先打开 H Bot 制造 主窗口再重试；这一步**没有执行**，也没有产生任何改动。`,
        ),
      }
    }
    const decision = await requestApproval(
      {
        projectPath: ctx.projectPath,
        callId: `mcp-${(0, node_crypto.randomUUID)()}`,
        toolName: name,
        args,
        hint: VERDICT_HINT.ask,
      },
      { emit: (channel, payload) => win.webContents.send(channel, payload) },
    )
    if (decision === 'deny') {
      logger.info(`[mcp] 用户拒绝（或超时）工具调用：${name}`)
      return {
        ok: false,
        result: errorResult(
          `用户拒绝了 ${name}（工具闸；超时也按拒绝处理）。这一步**没有执行**，也没有产生任何改动。不要重复同一个调用，先问用户。`,
        ),
      }
    }
    if (decision === 'always') {
      approvedTools.add(name)
      logger.info(`[mcp] 本连接内不再询问：${name}`)
    }
    return { ok: true }
  }
  /**
   * ── 【组合类工具】交给应用内确认（P0-13 ③）────────────────────────────
   *
   * `apply_template` / `new_command` / `new_lookup` 只走提案路（没有 execute 实现，
   * 由 toolDefinitionDispatchSync 闸门钉住），真正铺链的唯一实现在渲染层
   * （`insertChain.ts`）。所以 MCP 这边**不重写铺链**，而是把工具调用转成提案，
   * 经既有 `ai:proposal` 通道送到 AI 面板 —— 用户点「应用」后走渲染层那份实现。
   * 见 `mcpProposal.ts` 文件头（为什么不选「主进程自己铺一遍」那条路）。
   */
  const dispatchComposeTool = (name, args) => {
    let proposal
    try {
      proposal = buildProposalForToolCall(name, args, ctx.projectPath)
    } catch (e) {
      return errorResult(`工具执行失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    const win = electron.BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed())
      return errorResult(
        `「${name}」需要你在 H Bot 制造 应用内确认计划才能改动流程，但当前没有可用的应用窗口。请先打开主窗口再重试；这一步**没有提交**，也没有产生任何改动。`,
      )
    win.webContents.send('ai:proposal', {
      projectPath: ctx.projectPath,
      proposal,
    })
    logger.info(`[mcp] 组合类工具已转成提案：${name}（${proposal.operations.length} 个操作）`)
    return {
      content: [
        {
          type: 'text',
          text: budgetToolResult({
            status: 'pending_user_confirmation',
            tool: name,
            proposalId: proposal.id,
            operationCount: proposal.operations.length,
            instructions:
              '计划已发到 H Bot 制造 的 AI 面板，等用户点「应用」后才会改动流程。这不是失败：不要重复调用同一个工具，也不要改用 add_node 手工重搭一遍。',
          }).text,
        },
      ],
    }
  }
  /**
   * 收尾：**成功 / 失败 / 连接断开**三种结局都走这里（与 autoTx 同一套语义 ——
   * 唯一一个汇合点，别在各自的分支里各写一遍 endTurn）。
   *
   * @param hadChanges 这次调用有没有**真的派发出去**（没派发 = 没有改动，轮次不落盘）
   */
  const closeTurnIfOpen = async (hadChanges, reason) => {
    const turn = openTurn
    if (!turn) return
    openTurn = null
    if (currentTurnId(turn.projectPath) !== turn.turnId) {
      logger.warn(`[mcp] 轮次 ${turn.turnId} 已不是当前轮次，跳过 endTurn（${reason}）`)
      return
    }
    await endTurn(turn.projectPath, { hadChanges })
    logger.info(`[mcp] 轮次已收尾（${reason}；${hadChanges ? '有改动' : '无改动'}）`)
  }
  /**
   * 连接断开（SSE 关流 / STDIO 关闭 / stopSSE）时，把**还开着的**轮次收掉。
   *
   * 不这么做的话它留在 RUNNING 里：既不进轮次列表（用户看不见），又会被下一次
   * `beginTurn` 顶掉（那条记录就永远没了）。保守按"有改动"收尾：指令可能已经派发到渲染层，
   * 用户点「撤回这一轮」最多是空撤一次，比丢掉记录强。
   */
  const dispose = async () => {
    await closeTurnIfOpen(true, '连接断开')
  }
  server.onclose = () => {
    dispose()
  }
  const callTool: McpCallTool = async (name, args) => {
    /** 这次调用有没有**真的派发出去**（= 会改东西）；它决定轮次要不要落盘（见 closeTurnIfOpen） */
    let changed = false
    /** 收尾原因：成功 / 失败（"连接断开"由 server.onclose 那条路自己报） */
    let reason = '调用成功'
    try {
      /**
       * 先判「是不是真工具」：未知名字交给工具闸会被判成 `ask`（fail-safe 分类），
       * 让用户为一个拼错的工具名点一次确认纯属噪音。这里先如实回一句「没有这个工具」。
       */
      if (!findToolDef(name))
        return errorResult(`未知工具: ${name}（不在工具清单里；先用 list_tools 看能调什么）`)
      const guard = await applyToolGuard(name, args)
      if (!guard.ok) return guard.result
      if (PROPOSAL_ONLY_TOOLS.has(name)) return dispatchComposeTool(name, args)
      const writeKind = WRITE_TOOL_KIND[name]
      const writeTarget = writeKind ? writeTargetOf(name, args) : void 0
      if (writeKind && writeTarget) {
        /**
         * P0-7：**应用自己管理的文件一律拒绝**（先于「先读后写」那条判）——
         * 它是画布的数据源，被通用写通道改掉就是丢数据（见 writeGuard 的文件头）。
         * 判据与提案路径、编辑器只读规则**同一个函数、同一份清单**。
         *
         * 为什么必须在**主进程侧**先拦一道：这条路径的返回是给外部 IDE 看的 ——
         * 只在渲染层拦的话，这之前已经返回过「dispatched」，客户端会以为改动生效了（谎报）。
         */
        const appManaged = denialForAppManagedWrite(writeTarget)
        if (appManaged) {
          logger.warn(`[mcp] 拒绝写入应用管理的文件：${writeTarget}`)
          return errorResult(appManaged)
        }
        const denial = denialForWrites(
          ctx.projectPath,
          [
            {
              kind: writeKind,
              filePath: writeTarget,
            },
          ],
          existsOnDisk,
        )
        if (denial) return errorResult(denial)
      }
      const readTarget =
        (name === 'read_code' || name === 'read_file') && typeof args.path === 'string'
          ? args.path
          : void 0
      await openTurnIfNeeded(name)
      /**
       * **并发守卫（P0-13 ④）**：开完轮次到真正派发之间，应用内的 AI 会话可能刚开始新一轮 ——
       * `beginTurn` 是无条件覆盖 RUNNING 槽位的，我这一轮就被顶掉了。此时若继续派发，
       * 改动会**落在一个已经消失的轮次里**（撤不回来），而客户端完全不知道。
       * 所以派发前**再确认一次这一轮还是我的**；已经不是就如实拒绝（fail-safe），
       * 绝不 endTurn（那会收掉别人的轮次）。
       */
      if (openTurn && currentTurnId(ctx.projectPath) !== openTurn.turnId) {
        openTurn = null
        logger.warn(`[mcp] 轮次被并发顶掉，拒绝派发：${name}`)
        return errorResult(
          `并发冲突：应用内 AI 已经开始了新一轮，本次 ${name} **没有执行**（改动会记不进轮次日志，撤不回来）。请等应用内这一轮结束后重试。`,
        )
      }
      const result = await executeTool(
        {
          id: `mcp-${name}-${Date.now()}`,
          name,
          args,
        },
        ctx.projectPath,
      )
      if (readTarget && existsOnDisk(readTarget)) noteFileRead(ctx.projectPath, readTarget)
      if (result.needsClientExecution && result.clientInstruction) {
        const win = electron.BrowserWindow.getAllWindows()[0]
        if (!win || win.isDestroyed())
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: pruneText(
                  `指令未执行：当前没有可用的应用窗口来接收「${name}」（MCP 的 mutation 由渲染层执行）。请先打开 H Bot 制造 主窗口再重试，或改用 query 类工具。`,
                ).text,
              },
            ],
          }
        /**
         * **派发 ≠ 成功**（P1-1）：走 instructionBridge 真的等渲染层回执。
         *
         * 老写法 send 完就 return "dispatched"，渲染层后续失败（路径越界 / 写盘异常 /
         * 指令名对不上）主进程完全不知道 —— 外部 IDE 收到的是"已派发"，
         * 用户看到的是"没改"或是更糟的"改了一半"。
         * 现在只有回 applied 才算派发成功；rejected/failed/超时都如实回错，
         * 并且 changed 保持 false（没落盘就不该进"撤回这一轮"）。
         */
        const settled = await dispatchInstruction(win, {
          name: result.clientInstruction.name,
          args: result.clientInstruction.args,
          projectPath: ctx.projectPath,
        })
        if (settled.outcome.status !== 'applied') {
          reason = '指令未执行'
          logger.warn(
            `[mcp] 写指令没有生效：${name} → ${describeInstructionOutcome(settled.outcome)}`,
          )
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: pruneText(`指令未执行：${describeInstructionOutcome(settled.outcome)}`).text,
              },
            ],
          }
        }
        changed = true
        return {
          content: [
            {
              type: 'text',
              text: budgetToolResult({
                status: 'dispatched',
                instruction: result.clientInstruction,
                receipt: settled.outcome,
              }).text,
            },
          ],
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: budgetToolResult(result.result).text,
          },
        ],
      }
    } catch (e) {
      reason = '调用失败'
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: pruneText(`工具执行失败: ${e instanceof Error ? e.message : String(e)}`).text,
          },
        ],
      }
    } finally {
      /**
       * P0-6：**三种结局的唯一汇合点** —— 成功 / 失败都从这里收尾（"连接断开"由 onclose 收）。
       * 放在 finally 而不是各个 return 之前：这条路径有 5 个 return（拒绝写、无窗口、
       * 派发成功、直出结果、异常），各自收一遍必漏。
       */
      await closeTurnIfOpen(changed, reason)
    }
  }
  server.setRequestHandler(_modelcontextprotocol_sdk_types_js.ListToolsRequestSchema, listTools)
  server.setRequestHandler(
    _modelcontextprotocol_sdk_types_js.CallToolRequestSchema,
    async request => {
      const { name, arguments: args } = request.params
      return callTool(name, args || {})
    },
  )
  const transportManager = new TransportManager()
  return {
    server,
    /** 返回所有已注册工具的名字 */
    getTools: () => toolNames,
    /** 列出工具（MCP 协议形状），供测试与外部客户端调用 */
    listTools,
    /** 直接执行工具（方式 B），返回 MCP 协议形状的结果 */
    callTool,
    /**
     * 把本连接**还开着的**轮次收尾（P0-6）。连接断开/SSE 停止时调用；幂等。
     * `server.onclose` 已经挂在它上面，这里暴露出来是为了调用方能显式收尾（与测试）。
     */
    dispose,
    /** 启动 STDIO transport；transport 未传时按需创建 */
    start: async transport => {
      await server.connect(
        transport ?? new _modelcontextprotocol_sdk_server_stdio_js.StdioServerTransport(),
      )
    },
    /**
     * 本次启动的 SSE 鉴权 token（外部 IDE 需带 `Authorization: Bearer <token>`）。
     * 调用方（main/index.ts）负责把它写进日志，否则没人知道该填什么。
     */
    getAuthToken: () => authToken,
    /**
     * 启动 SSE (HTTP) transport。
     * 在指定端口创建 HTTP 服务器，暴露两个端点：
     * - GET  /sse       建立 SSE 流连接
     * - POST /messages  接收客户端 JSON-RPC 消息
     *
     * ⚠️ 两个端点都要带 `Authorization: Bearer <authToken>`，否则 401：
     * 服务器虽然只绑 127.0.0.1，但**本机不等于可信**（本机任意进程都能连）。
     */
    startSSE: async port => {
      await transportManager.startHttpServer(port, server, { authToken })
    },
    /**
     * 停止 SSE transport：关闭所有活跃连接和 HTTP 服务器。
     */
    stopSSE: async () => {
      await dispose()
      await transportManager.stop()
    },
  }
}

export { WRITE_TOOL_KIND, writeTargetOf, createMcpServer }
