// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  /**
   * 指令面板同步（**本项目里唯一会改动 QQ 线上状态的路径**）。
   *
   * `list` 只读；`apply` 走 `dryRun` 预览 → 用户在确认框点确定 → 不带 dryRun 再调一次。
   */
  panelSync: {
    list: (projectPath: string, scope: string) =>
      ipcRenderer.invoke('panel:list', { projectPath, scope }),
    /** 读当前自定义菜单（只读） */
    menu: (projectPath: string) => ipcRenderer.invoke('panel:menu', { projectPath }),
    apply: (
      projectPath: string,
      payload: { scope: string; items: unknown[]; remark?: string; dryRun?: boolean },
    ) => ipcRenderer.invoke('panel:apply', { projectPath, ...payload }),
  },
  /**
   * 能力自检（**全程只发 GET**，不改动机器人状态）。
   * 回答的是「这一个 bot 现在能用哪些能力」，不是「官方有哪些能力」。
   */
  capability: {
    probe: (projectPath: string) => ipcRenderer.invoke('capability:probe', { projectPath }),
  },
  project: {
    create: (config: unknown) => ipcRenderer.invoke('project:create', config),
    open: (path: string) => ipcRenderer.invoke('project:open', { path }),
    getMeta: (path: string) => ipcRenderer.invoke('project:getMeta', path),
    getConfig: (path: string) => ipcRenderer.invoke('project:getConfig', path),
    listRecent: () => ipcRenderer.invoke('project:listRecent'),
    removeRecent: (path: string) => ipcRenderer.invoke('project:removeRecent', path),
    pickDirectory: () => ipcRenderer.invoke('project:pickDirectory'),
    saveConfig: (config: unknown, projectPath: string) =>
      ipcRenderer.invoke('project:saveConfig', {
        ...(config as Record<string, unknown>),
        __projectPath: projectPath,
      }),
    updateTranslatorPort: (projectPath: string, port: number) =>
      ipcRenderer.invoke('project:updateTranslatorPort', projectPath, port),
    /** 改机器人类型（只改这一个字段；建项目后也能改） */
    updateBotType: (projectPath: string, botType: string) =>
      ipcRenderer.invoke('project:updateBotType', projectPath, botType),
    rename: (projectPath: string, newName: string) =>
      ipcRenderer.invoke('project:rename', projectPath, newName),
    delete: (projectPath: string) => ipcRenderer.invoke('project:delete', projectPath),
    move: (projectPath: string, offset: -1 | 1) =>
      ipcRenderer.invoke('project:move', projectPath, offset),
    openFolder: (projectPath: string) => ipcRenderer.invoke('project:openFolder', projectPath),
    clone: (projectPath: string, newName: string) =>
      ipcRenderer.invoke('project:clone', projectPath, newName),
  },
  flow: {
    load: (projectPath: string) => ipcRenderer.invoke('flow:load', projectPath),
    save: (projectPath: string, flow: unknown, reason?: string) =>
      ipcRenderer.invoke('flow:save', projectPath, flow, reason),
    /** 本地测试：跑真解释器（临时克隆 + 记录型假 bot，无真实副作用） */
    preview: (request: unknown) => ipcRenderer.invoke('flow:preview', request),
    /** 运行前问题清单（不执行流程）：统一真相层的 normalize + validate */
    validate: (projectPath: string, graph: unknown) =>
      ipcRenderer.invoke('flow:validate', projectPath, graph),
  },
  expression: {
    /**
     * 表达式静态校验（只判翻译/语法，**不判未定义变量**，也不执行表达式）。
     *
     * 判定必须在主进程做：渲染层 CSP 没有 unsafe-eval，`new Function` 在这里会抛
     * EvalError，而那个异常会被翻译器的自校验吞掉 → 合法写法反而被判成语法错。
     * 详见 `src/main/runtime/expressionCheck.ts` 与 `src/renderer/src/lib/expression/exprSyntax.ts`。
     */
    checkSyntax: (text: string) => ipcRenderer.invoke('expression:checkSyntax', text),
  },
  codegen: {
    /** version 三态：undefined=自动命名；null=不打版本；对象=用用户填的版号/名字 */
    generate: (
      projectPath: string,
      flow: unknown,
      debugMode?: boolean,
      version?: { name?: string; message?: string } | null,
    ) => ipcRenderer.invoke('codegen:generate', projectPath, flow, debugMode, version),
  },
  file: {
    read: (projectPath: string, relativePath: string) =>
      ipcRenderer.invoke('file:read', { projectPath, relativePath }),
    write: (projectPath: string, relativePath: string, content: string) =>
      ipcRenderer.invoke('file:write', { projectPath, relativePath, content }),
    list: (projectPath: string, relativeDir?: string) =>
      ipcRenderer.invoke('file:list', { projectPath, relativeDir }),
    /**
     * **框架开发模式**：读开关 + 框架根 + 现有回退点。
     *
     * 归位表里这一族是 **P 层（用户触发）** —— 模型拿不到。理由见
     * docs/ai/ai-capability-layering-2026-10-08.md 「file（6）」：
     * 一个能自己打开护栏的 AI，等于没有护栏。
     */
    getDevMode: () => ipcRenderer.invoke('file:getDevMode'),
    setDevMode: (enabled: boolean) => ipcRenderer.invoke('file:setDevMode', { enabled }),
    /**
     * 从某个回退点恢复（`relativePath` 不传 = 恢复整个回退点）。
     * 主进程会**先把当前内容也备份一份**再还原，返回里的 `rollbackPoint` 就是那份。
     */
    restoreDevBackup: (revisionId: string, relativePath?: string) =>
      ipcRenderer.invoke('file:restoreDevBackup', { revisionId, relativePath }),
  },
  terminal: {
    create: (projectPath: string) => ipcRenderer.invoke('terminal:create', { projectPath }),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', { id, data }),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', { id }),
    onData: (callback: (data: { id: string; data: string }) => void) => {
      const handler = (_event: unknown, items: Array<{ id: string; data: string }>) => {
        for (const item of items) callback(item);
      };
      ipcRenderer.on('terminal:batchData', handler);
      return () => ipcRenderer.removeListener('terminal:batchData', handler);
    },
  },
  runtime: {
    onLog: (callback: (data: unknown) => void) => {
      const handler = (_event: unknown, d: unknown) => callback(d);
      ipcRenderer.on('runtime:batchLog', handler);
      return () => ipcRenderer.removeListener('runtime:batchLog', handler);
    },
    onExecuteNode: (callback: (data: unknown) => void) => {
      const handler = (_event: unknown, d: unknown) => callback(d);
      ipcRenderer.on('runtime:executeNode', handler);
      return () => ipcRenderer.removeListener('runtime:executeNode', handler);
    },
    injectTestMessage: (
      projectPath: string,
      message: string,
      chatType?: 'group' | 'c2c',
      chatId?: number,
    ) =>
      ipcRenderer.invoke('runtime:injectTestMessage', { projectPath, message, chatType, chatId }),
  },
  launchData: {
    listDataSources: (projectPath: string) =>
      ipcRenderer.invoke('launch:listDataSources', projectPath),
    getSchema: (filePath: string) => ipcRenderer.invoke('launch:getSchema', filePath),
    queryTable: (
      filePath: string,
      tableName: string,
      page: number,
      pageSize: number,
      cursor?: number,
    ) => ipcRenderer.invoke('launch:queryTable', filePath, tableName, page, pageSize, cursor),
    updateRecord: (
      filePath: string,
      tableName: string,
      rowid: number,
      changes: Record<string, unknown>,
    ) => ipcRenderer.invoke('launch:updateRecord', filePath, tableName, rowid, changes),
    insertRecord: (filePath: string, tableName: string, values: Record<string, unknown>) =>
      ipcRenderer.invoke('launch:insertRecord', filePath, tableName, values),
    deleteRecord: (filePath: string, tableName: string, rowid: number) =>
      ipcRenderer.invoke('launch:deleteRecord', filePath, tableName, rowid),
    searchPlayer: (projectPath: string, query: string) =>
      ipcRenderer.invoke('launch:searchPlayer', projectPath, query),
    /** 把一个玩家并入另一个（存档 + 身份映射一起；机器人运行时会被拒绝） */
    mergePlayers: (projectPath: string, fromUid: string, toUid: string) =>
      ipcRenderer.invoke('launch:mergePlayers', projectPath, fromUid, toUid),
    /** 只读检查身份一致性（openid ↔ uid 映射 vs 实际存档） */
    checkIdentity: (projectPath: string) => ipcRenderer.invoke('launch:checkIdentity', projectPath),
    /** 玩家存档的字段契约（流程声明 ∪ 存档实际值，项目可在 player.schema.json 覆盖） */
    getPlayerSchema: (projectPath: string) =>
      ipcRenderer.invoke('launch:getPlayerSchema', projectPath),
    /** 把当前契约落成文件（data/players/player.schema.json） */
    savePlayerSchema: (projectPath: string, schema: unknown) =>
      ipcRenderer.invoke('launch:savePlayerSchema', projectPath, schema),
    /** 删掉某个玩家的全部存档数据（数据浏览器里"删除玩家"；主进程会先备份） */
    deletePlayer: (projectPath: string, qq: string) =>
      ipcRenderer.invoke('launch:deletePlayer', projectPath, qq),
    listPlayers: (projectPath: string) => ipcRenderer.invoke('launch:listPlayers', projectPath),
    queryPlayerTables: (filePath: string, qq: string) =>
      ipcRenderer.invoke('launch:queryPlayerTables', filePath, qq),
    // 2026-10-18（5.4）：频道从 plugin:saveSchema 改到本域自己的 launch:saveSchema。
    // 主进程两个频道都在，旧客户端/脚本不会断。
    saveSchema: (projectPath: string, tableName: string, fields: Record<string, unknown>) =>
      ipcRenderer.invoke('launch:saveSchema', projectPath, tableName, fields),
    // UID 映射
    getUidMapping: (projectPath: string) => ipcRenderer.invoke('launch:getUidMapping', projectPath),
    getPlayersWithUid: (projectPath: string) =>
      ipcRenderer.invoke('launch:getPlayersWithUid', projectPath),
    updatePlayerUid: (projectPath: string, openid: string, newUid: number) =>
      ipcRenderer.invoke('launch:updatePlayerUid', projectPath, openid, newUid),
    // 数据模板
    getDataTemplate: (projectPath: string) =>
      ipcRenderer.invoke('launch:getDataTemplate', projectPath),
    saveDataTemplate: (projectPath: string, template: unknown) =>
      ipcRenderer.invoke('launch:saveDataTemplate', projectPath, template),
    deriveDataTemplate: (projectPath: string) =>
      ipcRenderer.invoke('launch:deriveDataTemplate', projectPath),
    // 引擎基础数据（注册时间/最后在线/消息计数）
    //
    // ⚠️ 这里曾是**两份**定义里生效的那一份（另一份是 `src/preload/domains/**`，
    // 另一条线的拆分 WIP）。**2026-09-30 已把那份死代码整个删掉**（19 个文件，
    // 没有任何地方 import 它们），现在只有这一份 —— 加 IPC 方法不会再漏改。
    // 删它的理由就是下面这场真实事故：两份定义只改一份 →
    // `window.qqbat.launchData.xxx is not a function` 并让整个面板崩掉。
    // （踩过：countPlayersMissingBaseData 当时只加在了 domains 那份上。）
    countPlayersMissingBaseData: (projectPath: string) =>
      ipcRenderer.invoke('launch:countPlayersMissingBaseData', projectPath),
    backfillPlayerBaseData: (projectPath: string) =>
      ipcRenderer.invoke('launch:backfillPlayerBaseData', projectPath),
  },
  buttonPanel: {
    list: (projectPath: string) => ipcRenderer.invoke('buttonPanel:list', projectPath),
    get: (projectPath: string, panelId: string) =>
      ipcRenderer.invoke('buttonPanel:get', projectPath, panelId),
    create: (
      projectPath: string,
      payload: { name: string; description?: string; keyboard?: unknown },
    ) => ipcRenderer.invoke('buttonPanel:create', projectPath, payload),
    update: (projectPath: string, payload: { panelId: string; patch: Record<string, unknown> }) =>
      ipcRenderer.invoke('buttonPanel:update', projectPath, payload),
    delete: (projectPath: string, panelId: string) =>
      ipcRenderer.invoke('buttonPanel:delete', projectPath, panelId),
    duplicate: (projectPath: string, panelId: string, newName?: string) =>
      ipcRenderer.invoke('buttonPanel:duplicate', projectPath, panelId, newName),
    listBuiltin: () => ipcRenderer.invoke('buttonPanel:listBuiltin'),
    importBuiltin: (projectPath: string, templateIds?: string[]) =>
      ipcRenderer.invoke('buttonPanel:importBuiltin', projectPath, templateIds),
  },
  launchConfig: {
    listCategories: (projectPath: string) =>
      ipcRenderer.invoke('launch:listConfigCategories', projectPath),
    getTable: (projectPath: string, category: string, page: number, pageSize: number) =>
      ipcRenderer.invoke('launch:getConfigTable', projectPath, category, page, pageSize),
    getSchema: (projectPath: string, category: string) =>
      ipcRenderer.invoke('launch:getConfigSchema', projectPath, category),
    updateRecord: (
      projectPath: string,
      category: string,
      rowid: number,
      changes: Record<string, unknown>,
    ) => ipcRenderer.invoke('launch:updateConfigRecord', projectPath, category, rowid, changes),
    insertRecord: (projectPath: string, category: string, values: Record<string, unknown>) =>
      ipcRenderer.invoke('launch:insertConfigRecord', projectPath, category, values),
    deleteRecord: (projectPath: string, category: string, rowid: number) =>
      ipcRenderer.invoke('launch:deleteConfigRecord', projectPath, category, rowid),
    // 表结构管理
    createTable: (projectPath: string, displayName: string, fields: unknown[]) =>
      ipcRenderer.invoke('launch:createConfigTable', projectPath, displayName, fields),
    dropTable: (projectPath: string, category: string) =>
      ipcRenderer.invoke('launch:dropConfigTable', projectPath, category),
    renameTable: (projectPath: string, oldCategory: string, newDisplayName: string) =>
      ipcRenderer.invoke('launch:renameConfigTable', projectPath, oldCategory, newDisplayName),
    alterTable: (projectPath: string, category: string, options: unknown) =>
      ipcRenderer.invoke('launch:alterConfigTable', projectPath, category, options),
    // 说明：previewConfigTables / listLayerTemplates 随模板库移除（模板已不存在）
  },
  launchDashboard: {
    getStatus: (projectPath: string) =>
      ipcRenderer.invoke('launch:getDashboardStatus', projectPath),
    getTimeline: (projectPath: string) => ipcRenderer.invoke('launch:getTimeline', projectPath),
    getGroups: (projectPath: string) => ipcRenderer.invoke('launch:getGroups', projectPath),
  },
  audit: {
    log: (
      projectPath: string,
      entry: {
        user: string;
        table: string;
        action: 'update' | 'insert' | 'delete';
        before: string | null;
        after: string | null;
      },
    ) => ipcRenderer.invoke('audit:log', projectPath, entry),
    list: (projectPath: string, page: number, pageSize: number) =>
      ipcRenderer.invoke('audit:list', projectPath, page, pageSize),
    search: (projectPath: string, query: string) =>
      ipcRenderer.invoke('audit:search', projectPath, query),
  },
  backup: {
    create: (projectPath: string, dbPath: string, description: string) =>
      ipcRenderer.invoke('backup:create', projectPath, dbPath, description),
    list: (projectPath: string) => ipcRenderer.invoke('backup:list', projectPath),
    restore: (projectPath: string, backupName: string) =>
      ipcRenderer.invoke('backup:restore', projectPath, backupName),
    snapshot: (projectPath: string, name?: string) =>
      ipcRenderer.invoke('backup:snapshot', projectPath, name),
  },
  dataTransfer: {
    exportJson: (dbPath: string, tableName: string, outputPath: string) =>
      ipcRenderer.invoke('data:exportJson', dbPath, tableName, outputPath),
    exportCsv: (dbPath: string, tableName: string, outputPath: string) =>
      ipcRenderer.invoke('data:exportCsv', dbPath, tableName, outputPath),
    importJson: (dbPath: string, tableName: string, jsonPath: string) =>
      ipcRenderer.invoke('data:importJson', dbPath, tableName, jsonPath),
    importCsv: (dbPath: string, tableName: string, csvPath: string) =>
      ipcRenderer.invoke('data:importCsv', dbPath, tableName, csvPath),
  },
  ai: {
    /**
     * **用户侧**的能力守卫设置（高危开关 + 目标白名单）。
     *
     * 为什么放在 preload 算：渲染层执行提案操作前要做**独立的第二道复检**，
     * 而它读不到主进程的环境变量。preload 在渲染进程里、但有 `process.env`
     * （Electron 的 preload 是特权上下文），所以在暴露那一刻算一次即可。
     *
     * ⚠️ 这两个值**用户侧才改得动**（环境变量），模型能给的是工具参数、改不了它。
     */
    guardOptions: {
      allowDestructive: process.env.QQBAT_AI_ALLOW_DESTRUCTIVE === '1',
      allowedTargets: (process.env.QQBAT_AI_ALLOWED_TARGETS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    /**
     * `mode`：助手模式（blocks 低代码 / code 代码页 / duo 双向 / **creator 创作**）——
     * 主进程据此**分派专家角色**（M5：模式决定工具子集与边界提示）。不传按低代码处理。
     *
     * ⚠️ 值域必须与 `@shared/ai/roleDomains` 的 `AgentMode` **和** `aiChatSchema` 一致：
     * 2026-10-15 加 `duo` 时漏了 schema，双向模式下发送被 zod 静默拒绝（界面一直转圈）。
     */
    // ⚠️ 载荷三个键**与 aiChatSchema 完全一致**（ipcPayloadContract 闸门按字面比对）：
    // 所以 mode 总是发（缺省 blocks），不要用条件展开 —— 那会让闸门看不到键名。
    chat: (
      projectPath: string,
      message: string,
      mode: 'blocks' | 'code' | 'duo' | 'creator' = 'blocks',
      /** 任务线程：这一轮的记忆落到哪条线程（不传 = 默认那份） */
      threadId?: string,
      /** 这一轮贴的图（data URL）；只在内存里过一遍，不落盘 */
      images?: string[],
      /** **当前在编辑器里打开的文件**（项目内相对路径，P1-5）—— 代码页/双向模式下助手据此理解「这个文件」 */
      activeFilePath?: string,
    ) =>
      // 形状保持**普通对象字面量**：ipcPayloadContract 闸门要静态核对键名，三元表达式它读不出来。
      // threadId 为 undefined 时由 aiChatSchema 的可选字段接受。
      ipcRenderer.invoke('ai:chat', {
        projectPath,
        message,
        mode,
        threadId,
        images,
        activeFilePath,
      }),
    /**
     * **agent-core 运行入口**：workspace-first 循环（读/写/跑/校验）。
     *
     * 与 `chat` 并列而不是塞进它的参数里：那是另一套循环、另一处审批时机，
     * 回执形状也不同（`{ ok, finalText, rounds, phase, toolResults }`）。
     * 形状与闸门登记见 `docs/ai/agent-core-wiring.md`。
     */
    agentCoreRun: (
      projectPath: string,
      requirement: string,
      threadId?: string,
      maxRounds?: number,
      /** 先计划：只给只读工具，产出一份计划（写/命令这一轮不存在） */
      planFirst?: boolean,
      /** 完全权限：本次运行不再逐个审批（不落规则，重启失效） */
      fullAccess?: boolean,
      /** 本轮允许的工具名白名单（预设用；不传 = 注册表全量） */
      allowedTools?: string[],
      /** 会话预设名（读 .qqbat/agent-presets.json；显式 allowedTools 优先） */
      preset?: string,
      /** 角色（界面模式）：按角色裁工具 + 角色提示词 */
      agentMode?: 'blocks' | 'code' | 'duo' | 'creator',
      /** 这一轮贴的图（data URL；只进这一轮，不进记忆） */
      images?: string[],
      /** 代码编辑器里打开的文件（项目内相对路径；只对 coder/duo 生效） */
      activeFilePath?: string,
    ) =>
      ipcRenderer.invoke('ai:agentCoreRun', {
        projectPath,
        requirement,
        threadId,
        maxRounds,
        planFirst,
        fullAccess,
        allowedTools,
        preset,
        agentMode,
        images,
        activeFilePath,
      }),
    /** 保存会话预设（整表覆盖；未知工具/插件以 warnings 返回，不拒绝） */
    savePresets: (
      projectPath: string,
      presets: Array<{
        name: string;
        allowedTools?: string[];
        plugins?: string[];
        permissionMode?: 'ask' | 'full';
        description?: string;
      }>,
    ) => ipcRenderer.invoke('ai:savePresets', { projectPath, presets }),
    /**
     * **插话**：把一句话塞进正在跑的那一轮（下一个步边界注入给模型）。
     * 没在跑时主进程会直接拒绝 —— 界面据此提示"先发一条新要求"。
     */
    agentCoreSteer: (projectPath: string, text: string, target?: 'step' | 'turn') =>
      ipcRenderer.invoke('ai:agentCoreSteer', { projectPath, text, target }),
    /** **真正**停下主进程里这个项目的 AI 请求（不只是界面收尾） */
    cancelChat: (projectPath: string) => ipcRenderer.invoke('ai:cancelChat', { projectPath }),
    isRunning: (projectPath: string) => ipcRenderer.invoke('ai:isRunning', { projectPath }),
    tools: () => ipcRenderer.invoke('ai:tools'),
    // 工具结果上限（用户设置）：关掉 = 不裁剪；开着时超预算的完整结果会溢出到 .qqbat/ai-spill/
    getToolBudget: () => ipcRenderer.invoke('ai:getToolBudget'),
    setToolBudget: (setting: { enabled: boolean; thresholdChars: number }) =>
      ipcRenderer.invoke('ai:setToolBudget', setting),
    /**
     * 「以后别再问」的规则表（撤销口）：看 / 删单条 / 清空。
     * 形状与匹配语义见 `services/ai/allowRules.ts` —— 界面只需要原样展示 + 能删。
     */
    getAllowRules: (projectPath: string) => ipcRenderer.invoke('ai:getAllowRules', { projectPath }),
    removeAllowRule: (projectPath: string, kind: 'write' | 'command' | 'tool', match: string) =>
      ipcRenderer.invoke('ai:removeAllowRule', { projectPath, kind, match }),
    clearAllowRules: (projectPath: string) =>
      ipcRenderer.invoke('ai:clearAllowRules', { projectPath }),
    setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('ai:setConfig', config),
    /**
     * 「测试」按钮：拿表单里那份（**可能还没保存**的）配置真的发一次最小请求。
     * 零副作用 —— 主进程侧不走 provider 注册表（见 services/ai/testConfig.ts）。
     */
    testConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('ai:testConfig', { config }),
    /**
     * 读回该项目的**磁盘对话记忆**（`.qqbat/ai-history.jsonl`）。
     * 渲染层那份是内存态，重启就没了 —— 界面靠这条与"模型记得的东西"对齐。
     */
    getHistory: (projectPath: string, threadId?: string) =>
      ipcRenderer.invoke('ai:getHistory', { projectPath, threadId }),
    /**
     * 列出该项目的**任务线程**（按最后活动时间倒序）。
     * 一个项目可以有多条任务 —— 换任务就是换线程，而不是共用一份越滚越大的记忆。
     */
    listThreads: (projectPath: string) => ipcRenderer.invoke('ai:listThreads', { projectPath }),
    /** **真的**清空某条线程的记忆（在此之前界面上的「清空」只清渲染层） */
    clearThread: (projectPath: string, threadId: string) =>
      ipcRenderer.invoke('ai:clearThread', { projectPath, threadId }),
    /**
     * 列出**已记录的 AI 轮次**（新的在前）—— 「撤回这一轮」的候选列表。
     * 一轮 = 一个可撤销单元（它改过的文件 + 开始时的流程），见主进程 turnJournal.ts。
     */
    listAiTurns: (projectPath: string) => ipcRenderer.invoke('ai:listTurns', { projectPath }),
    /**
     * **撤回某一轮**：改过的文件按 before 回滚、flow.json 还原。
     * ⚠️ 调用方拿到结果后必须**重新加载画布**（主进程还原了文件，画布内存里还是旧的）。
     */
    /** 撤回**预览**：只读一轮将发生什么（不执行撤回） */
    previewAiTurn: (projectPath: string, turnId: string, threadId?: string) =>
      ipcRenderer.invoke('ai:previewTurn', { projectPath, turnId, threadId }),
    /**
     * **从此处重开对话**：回退这句之后的产物 + 把记忆截断到这句之前。
     * （用户 2026-10-15 要的行为：「编辑后将从此处重新开始对话，产物也将回退至此信息前版本」）
     */
    rewindAiTo: (projectPath: string, messageText: string, threadId?: string) =>
      // threadId **总是带**（可以 undefined）：载荷契约闸门按键名对账，条件展开会让它以为少了键
      ipcRenderer.invoke('ai:rewindTo', { projectPath, messageText, threadId }),
    rollbackAiTurn: (projectPath: string, turnId: string, threadId?: string) =>
      // threadId：撤回时把**对话**也退回去（撤回 = 回到那一轮之前，2026-10-15）
      ipcRenderer.invoke('ai:rollbackTurn', { projectPath, turnId, threadId }),
    /**
     * 把"用户对计划的处置"写进项目记忆（应用 / 拒绝 / 回滚）——
     * 模型下一轮才知道自己的计划落地了没有，不会原样再提一遍。
     */
    noteTurn: (projectPath: string, note: string, threadId?: string) =>
      ipcRenderer.invoke('ai:noteTurn', { projectPath, note, threadId }),
    // ===== 智能体面板：两套 AI（全局 / 每项目）=====
    getAppConfig: () => ipcRenderer.invoke('ai:getAppConfig'),
    setAppConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('ai:setAppConfig', { config }),
    getProjectBotConfig: (projectPath: string) =>
      ipcRenderer.invoke('ai:getProjectBotConfig', { projectPath }),
    setProjectBotConfig: (projectPath: string, config: Record<string, unknown> | null) =>
      ipcRenderer.invoke('ai:setProjectBotConfig', { projectPath, config }),
    listProjectBotConfigs: () => ipcRenderer.invoke('ai:listProjectBotConfigs'),
    getConfig: (projectPath?: string) => ipcRenderer.invoke('ai:getConfig', { projectPath }),
    /** Key 池（回退链）：只写它（读取走 getAppConfig，它带 fallbacks） */
    setAiFallbacks: (fallbacks: unknown[]) => ipcRenderer.invoke('ai:setFallbacks', { fallbacks }),
    saveProjectConfig: (projectPath: string, config: Record<string, unknown>) =>
      ipcRenderer.invoke('ai:saveProjectConfig', { projectPath, config }),
    // 批处理是**按项目**的事务，所以三个通道都要带 projectPath
    beginBatch: (projectPath: string) => ipcRenderer.invoke('ai:beginBatch', { projectPath }),
    commitBatch: (projectPath: string) => ipcRenderer.invoke('ai:commitBatch', { projectPath }),
    rollbackBatch: (projectPath: string) => ipcRenderer.invoke('ai:rollbackBatch', { projectPath }),
    /**
     * **回工具批准决定**（工具闸判定 ask 时，主进程会真的停下来等这个）。
     * decision：allow 批准这次 / deny 拒绝 / always 批准并「以后别再问」。
     */
    resolveApproval: (callId: string, decision: 'allow' | 'deny' | 'always') =>
      ipcRenderer.invoke('ai:resolveApproval', { callId, decision }),
    /** 主进程在等某个工具调用的批准（界面据此弹出确认条） */
    onApprovalRequest: (
      cb: (data: {
        projectPath?: string;
        callId: string;
        toolName: string;
        args: Record<string, unknown>;
        hint: string;
        timeoutMs: number;
      }) => void,
    ) => {
      const listener = (_e: unknown, data: Parameters<typeof cb>[0]) => cb(data);
      ipcRenderer.on('ai:approvalRequest', listener);
      return () => ipcRenderer.removeListener('ai:approvalRequest', listener);
    },
    /** 批准已出结果（界面把确认条收掉、把卡片标成已批/已拒） */
    onApprovalResolved: (
      cb: (data: {
        projectPath?: string;
        callId: string;
        decision: 'allow' | 'deny' | 'always';
      }) => void,
    ) => {
      const listener = (_e: unknown, data: Parameters<typeof cb>[0]) => cb(data);
      ipcRenderer.on('ai:approvalResolved', listener);
      return () => ipcRenderer.removeListener('ai:approvalResolved', listener);
    },

    onChunk: (cb: (data: { projectPath?: string; text: string }) => void) => {
      const listener = (_e: unknown, data: { projectPath?: string; text: string }) => cb(data);
      ipcRenderer.on('ai:chunk', listener);
      return () => ipcRenderer.removeListener('ai:chunk', listener);
    },
    /**
     * 工具调用事件（主进程在**开始/结束**时各发一条）。
     *
     * 为什么是**结构化事件**而不是让渲染层去解析 chunk 文本里的 `[工具调用] xxx(...)`：
     * 解析文本会在文案一改就崩，而且拿不到状态（running/done/error）与结果。
     */
    onToolCall: (
      cb: (data: {
        projectPath?: string;
        id: string;
        name?: string;
        args?: Record<string, unknown>;
        /**
         * 工具的**呈现契约**（可选：主进程有才带，缺省不带键）。
         * 形状与主进程 `agent-core/core.ts` 的 ToolPresentation、渲染层
         * `types/ipc.ts` 的同名接口一致 —— preload 不 import 主进程/渲染层代码，
         * 跨进程形状只能在这里再写一遍（与既有载荷声明同一做法）。
         */
        presentation?: import('@shared/ai/toolPresentation').ToolPresentation;
        /** 失败分类 + 建议动作（只在失败时带；老主进程不带键） */
        failure?: import('@shared/ai/toolFailure').ToolFailure;
        status: 'running' | 'done' | 'error' | 'aborted';
        result?: string;
        timestamp: number;
      }) => void,
    ) => {
      const listener = (_e: unknown, data: Parameters<typeof cb>[0]) => cb(data);
      ipcRenderer.on('ai:toolCall', listener);
      return () => ipcRenderer.removeListener('ai:toolCall', listener);
    },
    /** 步边界：这一轮走到第几步（1-based，maxSteps 是本轮上限） */
    onAgentStep: (cb: (data: { projectPath?: string; step: number; maxSteps: number }) => void) => {
      const listener = (
        _e: unknown,
        data: { projectPath?: string; step: number; maxSteps: number },
      ) => cb(data);
      ipcRenderer.on('ai:agentStep', listener);
      return () => ipcRenderer.removeListener('ai:agentStep', listener);
    },
    onResponse: (cb: (data: { projectPath?: string; message: string }) => void) => {
      const listener = (_e: unknown, data: { projectPath?: string; message: string }) => cb(data);
      ipcRenderer.on('ai:response', listener);
      return () => ipcRenderer.removeListener('ai:response', listener);
    },
    onNeedRollback: (cb: (data: { projectPath?: string }) => void) => {
      const listener = (_e: unknown, data: { projectPath?: string }) => cb(data);
      ipcRenderer.on('ai:needRollback', listener);
      return () => ipcRenderer.removeListener('ai:needRollback', listener);
    },
    /**
     * 主进程下发一条写指令（P1-1 回执协议）。
     *
     * requestId 存在时，**必须** 通过 resolveInstruction 回执，否则主进程会按超时判失败。
     * 老版本主进程不带 requestId（向后兼容）：此时不回执也没关系。
     */
    onClientInstruction: (
      cb: (data: {
        projectPath?: string;
        requestId?: string;
        instruction: { name: string; args: Record<string, unknown> };
      }) => void,
    ) => {
      const listener = (
        _e: unknown,
        data: {
          projectPath?: string;
          requestId?: string;
          instruction: { name: string; args: Record<string, unknown> };
        },
      ) => cb(data);
      ipcRenderer.on('ai:clientInstruction', listener);
      return () => ipcRenderer.removeListener('ai:clientInstruction', listener);
    },
    /** 回一条写指令的执行结果（applied / rejected / failed） */
    resolveInstruction: (result: {
      requestId: string;
      outcome:
        | { status: 'applied'; detail?: string }
        | { status: 'rejected'; reason: string }
        | { status: 'failed'; reason: string };
    }) => ipcRenderer.invoke('ai:instructionResult', result),
    onAgentState: (
      cb: (data: {
        projectPath?: string;
        state: string;
        message?: string;
        /** 多智能体阶段进度（侦察/规划/并行/执行）；没有就不带 */
        stage?: {
          id: string;
          label: string;
          status: 'start' | 'done' | 'skip' | 'fail';
          ms?: number;
          detail?: string;
        };
      }) => void,
    ) => {
      const listener = (
        _e: unknown,
        data: {
          projectPath?: string;
          state: string;
          message?: string;
          stage?: {
            id: string;
            label: string;
            status: 'start' | 'done' | 'skip' | 'fail';
            ms?: number;
            detail?: string;
          };
        },
      ) => cb(data);
      ipcRenderer.on('ai:agentState', listener);
      return () => ipcRenderer.removeListener('ai:agentState', listener);
    },
    /**
     * **本轮的统计**（状态条）：轮数 / 步数 / 厂商回传的 token / 缓存命中 / 上下文占用。
     *
     * token 那几个字段**只有厂商回传了才有意义**（`usageReported=false` 时界面一个数都不许显示）——
     * 这一条是从"别把估算当账"那条纪律来的：宁可不显示，也不给一个像是账单的数字。
     */
    onStats: (
      cb: (data: { projectPath?: string; stats: import('@shared/types/ai').AiRunStats }) => void,
    ) => {
      const listener = (
        _e: unknown,
        data: { projectPath?: string; stats: import('@shared/types/ai').AiRunStats },
      ) => cb(data);
      ipcRenderer.on('ai:stats', listener);
      return () => ipcRenderer.removeListener('ai:stats', listener);
    },
    onProposal: (
      cb: (data: {
        projectPath?: string;
        proposal: import('@shared/types/proposal').Proposal;
      }) => void,
    ) => {
      const listener = (
        _e: unknown,
        data: { projectPath?: string; proposal: import('@shared/types/proposal').Proposal },
      ) => cb(data);
      ipcRenderer.on('ai:proposal', listener);
      return () => ipcRenderer.removeListener('ai:proposal', listener);
    },
    /**
     * `ai:error` / `ai:warning` —— 主进程侧的运行期结果。
     *
     * 补这两条之前：主进程发了 5 处 error/warning（密钥错 / 断网 / 规划超时 / 已取消），
     * 而 preload 里**一个监听都没有** —— 错误对用户完全不可见，界面还停在 streaming:true
     * （输入框永久禁用）。可见性与收尾都靠这两条（2026-10-06 审查发现）。
     */
    onError: (cb: (data: { projectPath?: string; message: string }) => void) => {
      const listener = (_e: unknown, data: { projectPath?: string; message: string }) => cb(data);
      ipcRenderer.on('ai:error', listener);
      return () => ipcRenderer.removeListener('ai:error', listener);
    },
    onWarning: (cb: (data: { projectPath?: string; message: string }) => void) => {
      const listener = (_e: unknown, data: { projectPath?: string; message: string }) => cb(data);
      ipcRenderer.on('ai:warning', listener);
      return () => ipcRenderer.removeListener('ai:warning', listener);
    },
  },
  data: {
    notifyChange: (projectPath: string, table: string, action: string, qq?: string) =>
      ipcRenderer.invoke('data:notifyChange', projectPath, table, action, qq),
    registerBridge: (projectPath: string, port: number) =>
      ipcRenderer.invoke('data:registerBridge', projectPath, port),
    unregisterBridge: (projectPath: string) =>
      ipcRenderer.invoke('data:unregisterBridge', projectPath),
    startWatch: (projectPath: string) => ipcRenderer.invoke('data:startWatch', projectPath),
    stopWatch: (projectPath: string) => ipcRenderer.invoke('data:stopWatch', projectPath),
  },
  panel: {
    listRegistered: (projectPath: string) =>
      ipcRenderer.invoke('panel:listRegistered', projectPath),
    getSchema: (projectPath: string, panelId: string) =>
      ipcRenderer.invoke('panel:getSchema', projectPath, panelId),
    queryTable: (
      projectPath: string,
      panelId: string,
      page: number,
      pageSize: number,
      cursor?: number,
    ) => ipcRenderer.invoke('panel:queryTable', projectPath, panelId, page, pageSize, cursor),
    savePanel: (projectPath: string, panel: unknown) =>
      ipcRenderer.invoke('panel:savePanel', projectPath, panel),
  },
  debug: {
    start: () => ipcRenderer.invoke('debug:start'),
    stepOver: () => ipcRenderer.invoke('debug:stepOver'),
    stepInto: () => ipcRenderer.invoke('debug:stepInto'),
    stepOut: () => ipcRenderer.invoke('debug:stepOut'),
    continue: () => ipcRenderer.invoke('debug:continue'),
    pause: () => ipcRenderer.invoke('debug:pause'),
    stop: () => ipcRenderer.invoke('debug:stop'),
    getState: () => ipcRenderer.invoke('debug:getState'),
    getVariables: () => ipcRenderer.invoke('debug:getVariables'),
    setBreakpoints: (bps: unknown[]) => ipcRenderer.invoke('debug:setBreakpoints', bps),
    onStateChanged: (cb: (state: unknown) => void) => {
      const listener = (_e: unknown, state: unknown) => cb(state);
      ipcRenderer.on('debug:stateChanged', listener);
      return () => ipcRenderer.removeListener('debug:stateChanged', listener);
    },
  },
  history: {
    list: (projectPath: string) => ipcRenderer.invoke('history:list', { projectPath }),
    restore: (projectPath: string, fileName: string) =>
      ipcRenderer.invoke('history:restore', { projectPath, fileName }),
    read: (projectPath: string, fileName: string) =>
      ipcRenderer.invoke('history:read', { projectPath, fileName }),
  },
  git: {
    init: (projectPath: string) => ipcRenderer.invoke('git:init', { projectPath }),
    log: (projectPath: string, maxCount?: number) =>
      ipcRenderer.invoke('git:log', { projectPath, maxCount }),
    status: (projectPath: string) => ipcRenderer.invoke('git:status', { projectPath }),
    diff: (projectPath: string, hash: string) =>
      ipcRenderer.invoke('git:diff', { projectPath, hash }),
    /** 读档：把某个历史版本的 flow.json 取回来（服务层会先备份当前文件、再提交一条 restore） */
    restoreFlow: (projectPath: string, hash: string) =>
      ipcRenderer.invoke('git:restoreFlow', { projectPath, hash }),
    /** 清空历史：.git 改名留存后重新 init（历史仍可捞回，流程文件不动） */
    clearHistory: (projectPath: string) => ipcRenderer.invoke('git:clearHistory', { projectPath }),
    /** 删除若干条提交（可单条、可多条）：主进程用 plumbing 重建链，不改工作区，改前留备份 ref */
    deleteCommits: (projectPath: string, hashes: string[]) =>
      ipcRenderer.invoke('git:deleteCommits', { projectPath, hashes }),
    /** 重命名一条提交的说明（只改正文，作者/时间/内容不动） */
    rewordCommit: (projectPath: string, hash: string, message: string) =>
      ipcRenderer.invoke('git:rewordCommit', { projectPath, hash, message }),
    /** 版本标签：列出（含下一个建议版本号） */
    listVersionTags: (projectPath: string) =>
      ipcRenderer.invoke('git:listVersionTags', { projectPath }),
    /** 在 HEAD 上打一个版本标签；name 省略时自动取下一个（v1.0 → v1.1） */
    tagVersion: (projectPath: string, name?: string, message?: string) =>
      ipcRenderer.invoke('git:tagVersion', { projectPath, name, message }),
    /** 给版本改名（保留它指向的提交与说明） */
    renameVersionTag: (projectPath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke('git:renameVersionTag', { projectPath, oldName, newName }),
    /** 删除一个版本标签（提交本身不动） */
    deleteVersionTag: (projectPath: string, name: string) =>
      ipcRenderer.invoke('git:deleteVersionTag', { projectPath, name }),
  },
  diagnostics: {
    export: (projectPath: string) => ipcRenderer.invoke('diagnostics:export', { projectPath }),
    /** 渲染层把一行诊断写进主进程日志（仅开发环境使用；排查性能用） */
    rendererLog: (line: string) => ipcRenderer.invoke('diagnostics:rendererLog', { line }),
    onProgress: (cb: (data: { phase: string; message: string; error?: string }) => void) => {
      const listener = (_e: unknown, data: { phase: string; message: string; error?: string }) =>
        cb(data);
      ipcRenderer.on('diagnostics:progress', listener);
      return () => ipcRenderer.removeListener('diagnostics:progress', listener);
    },
  },
  // 说明：`debugger:*`（源码级调试 / debugpy）**已整个删除**（2026-09-30）。
  // 它调用的 12 个通道主进程**一个处理器都没注册**，而且它调试的是 **Python 源码**
  // （按文件+行号打断点、函数断点、会话失败报「venv 不存在」）—— Python 运行时早已按 ADR 删除。
  // 现在生效的调试是**节点级**的：`debug: { ... }`（见上方），断点打在流程节点上。

  customNode: {
    scan: (projectPath: string) => ipcRenderer.invoke('customNode:scan', { projectPath }),
    scanAiGenerated: (projectPath: string) =>
      ipcRenderer.invoke('customNode:scanAiGenerated', { projectPath }),
    watch: (projectPath: string) => ipcRenderer.invoke('customNode:watch', { projectPath }),
    unwatch: (projectPath: string) => ipcRenderer.invoke('customNode:unwatch', { projectPath }),
    fork: (projectPath: string, builtinKind: string, newName: string) =>
      ipcRenderer.invoke('customNode:fork', { projectPath, builtinKind, newName }),
    onChanged: (cb: (data: { projectPath: string }) => void) => {
      const listener = (_e: unknown, data: { projectPath: string }) => cb(data);
      ipcRenderer.on('customNode:changed', listener);
      return () => ipcRenderer.removeListener('customNode:changed', listener);
    },
  },
  // 说明：`template` 域（列表/应用/保存/导入导出流程模板）随模板库一并移除 ——
  // 内置模板皆为 AI 生成的占位内容，用户侧也从未真正使用。
  metrics: {
    start: () => ipcRenderer.invoke('metrics:start'),
    stop: () => ipcRenderer.invoke('metrics:stop'),
    getHistory: () => ipcRenderer.invoke('metrics:history'),
    getSnapshot: () => ipcRenderer.invoke('metrics:getSnapshot'),
    exportToCSV: () => ipcRenderer.invoke('metrics:exportToCSV'),
    exportToJSON: () => ipcRenderer.invoke('metrics:exportToJSON'),
    onSnapshot: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('metrics:snapshot', listener);
      return () => ipcRenderer.removeListener('metrics:snapshot', listener);
    },
  },
  crash: {
    getReports: (count?: number) => ipcRenderer.invoke('crash:getReports', { count }),
    readReport: (id: string) => ipcRenderer.invoke('crash:readReport', { id }),
    clearReports: () => ipcRenderer.invoke('crash:clearReports'),
    capture: (message: string, stack?: string, extra?: Record<string, unknown>) =>
      ipcRenderer.send('crash:capture', { message, stack, extra }),
    exportDiagnostic: () => ipcRenderer.invoke('crash:exportDiagnostic'),
    onShowCrashPanel: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on('crash:showPanel', listener);
      return () => ipcRenderer.removeListener('crash:showPanel', listener);
    },
  },
  // 说明：旧的 `resources`（resources:startMonitor / stopMonitor / getSnapshot / onSnapshot）
  // **已整个删除**（2026-09-30）。它被 `resourceMonitor:*` 取代已久，主进程那份标着
  // `@deprecated` 并写着"当所有调用方迁移完毕后可安全删除此文件及 registerResourceIpc()"。
  // 本轮核对：渲染层零调用方（`qqbat.resources.*` 全仓 0 命中）、无人引用 `registerResourceIpc`,
  // 条件是成立的。顺带消掉一个假象：`onSnapshot` 订阅的 `resources:snapshot`
  // **主进程从来不发**，是个永远不响的回调。
  resourceMonitor: {
    start: (pid: number) => ipcRenderer.invoke('resourceMonitor:start', pid),
    stop: () => ipcRenderer.invoke('resourceMonitor:stop'),
    getUsage: () => ipcRenderer.invoke('resourceMonitor:getUsage'),
    getConfig: () => ipcRenderer.invoke('resourceMonitor:getConfig'),
    setConfig: (config: { maxMemoryMB?: number; maxCPUPercent?: number }) =>
      ipcRenderer.invoke('resourceMonitor:setConfig', config),
    getHistory: () => ipcRenderer.invoke('resourceMonitor:getHistory'),
    onUsage: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('resourceMonitor:usage', listener);
      return () => ipcRenderer.removeListener('resourceMonitor:usage', listener);
    },
    onConfig: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('resourceMonitor:config', listener);
      return () => ipcRenderer.removeListener('resourceMonitor:config', listener);
    },
    onStatus: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('resourceMonitor:status', listener);
      return () => ipcRenderer.removeListener('resourceMonitor:status', listener);
    },
    onAlert: (cb: (data: { type: string; message: string; timestamp: number }) => void) => {
      const listener = (_e: unknown, data: { type: string; message: string; timestamp: number }) =>
        cb(data);
      ipcRenderer.on('resourceMonitor:alert', listener);
      return () => ipcRenderer.removeListener('resourceMonitor:alert', listener);
    },
  },
  stateStore: {
    set: (projectPath: string, key: string, value: unknown) =>
      ipcRenderer.invoke('stateStore:set', { projectPath, key, value }),
    get: (projectPath: string, key: string) =>
      ipcRenderer.invoke('stateStore:get', { projectPath, key }),
    delete: (projectPath: string, key: string) =>
      ipcRenderer.invoke('stateStore:delete', { projectPath, key }),
    listKeys: (projectPath: string, prefix?: string) =>
      ipcRenderer.invoke('stateStore:listKeys', { projectPath, prefix }),
    setSessionVar: (projectPath: string, sessionId: string, varName: string, value: unknown) =>
      ipcRenderer.invoke('stateStore:setSessionVar', { projectPath, sessionId, varName, value }),
    getSessionVar: (projectPath: string, sessionId: string, varName: string) =>
      ipcRenderer.invoke('stateStore:getSessionVar', { projectPath, sessionId, varName }),
    clearSession: (projectPath: string, sessionId: string) =>
      ipcRenderer.invoke('stateStore:clearSession', { projectPath, sessionId }),
    stats: (projectPath: string) => ipcRenderer.invoke('stateStore:stats', { projectPath }),
    getAllStateEntries: (projectPath: string) =>
      ipcRenderer.invoke('stateStore:getAllStateEntries', { projectPath }),
    clearAll: (projectPath: string) => ipcRenderer.invoke('stateStore:clearAll', { projectPath }),
  },
  plugin: {
    scan: (projectPath: string) => ipcRenderer.invoke('plugin:scan', { projectPath }),
    /** 新建一个**可编辑**的自定义节点骨架（plugins/<名>/{manifest.json,index.js}） */
    createNode: (projectPath: string, name: string, label?: string) =>
      ipcRenderer.invoke('plugin:createNode', { projectPath, name, label }),
    load: (pluginPath: string) => ipcRenderer.invoke('plugin:load', { pluginPath }),
    /** 装载 **AI 插件**包（清单 ai:true）：沙箱 activate，贡献的工具进宿主注册表 */
    loadAi: (pluginPath: string) => ipcRenderer.invoke('plugin:loadAi', { pluginPath }),
    unload: (pluginName: string) => ipcRenderer.invoke('plugin:unload', { pluginName }),
    install: (projectPath: string) => ipcRenderer.invoke('plugin:install', { projectPath }),
    listInstalled: () => ipcRenderer.invoke('plugin:listInstalled'),
    /** 宿主插件（应用级能力）只读清单：id/name/version/enabled/source/readOnlyReason */
    listHost: () => ipcRenderer.invoke('plugin:listHost'),
    setHostEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('plugin:setHostEnabled', { id, enabled }),
    setEnabled: (pluginName: string, enabled: boolean) =>
      ipcRenderer.invoke('plugin:setEnabled', { pluginName, enabled }),
    /** 插件市场：清单（含官方离线源）/ 来源管理 / 安装 / 卸载 */
    marketList: () => ipcRenderer.invoke('plugin:marketList'),
    marketAddSource: (source: string) => ipcRenderer.invoke('plugin:marketAddSource', { source }),
    marketRemoveSource: (source: string) =>
      ipcRenderer.invoke('plugin:marketRemoveSource', { source }),
    marketInstall: (id: string) => ipcRenderer.invoke('plugin:marketInstall', { id }),
    marketUninstall: (id: string) => ipcRenderer.invoke('plugin:marketUninstall', { id }),
    getAllSpecs: () => ipcRenderer.invoke('plugin:getAllSpecs'),
  },
  adapter: {
    list: () => ipcRenderer.invoke('adapter:list'),
    switch: (type: string) => ipcRenderer.invoke('adapter:switch', { type }),
    current: () => ipcRenderer.invoke('adapter:current'),
  },
  official: {
    start: (projectPath: string) => ipcRenderer.invoke('official:start', { projectPath }),
    stop: (projectPath: string) => ipcRenderer.invoke('official:stop', { projectPath }),
    status: (projectPath: string) => ipcRenderer.invoke('official:status', { projectPath }),
    saveConfig: (
      projectPath: string,
      appId: string,
      appSecret: string,
      sandbox?: boolean,
      wsUrl?: string,
    ) =>
      ipcRenderer.invoke('official:saveConfig', { projectPath, appId, appSecret, sandbox, wsUrl }),
    getConfig: (projectPath: string) => ipcRenderer.invoke('official:getConfig', projectPath),
    testConnection: (appId: string, appSecret: string) =>
      ipcRenderer.invoke('official:testConnection', { appId, appSecret }),
    sendMessage: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      content: string,
      options?: Record<string, unknown>,
    ) =>
      ipcRenderer.invoke('official:sendMessage', {
        projectPath,
        chatType,
        chatId,
        content,
        ...options,
      }),
    uploadFile: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      fileType: number,
      url: string,
      fileName?: string,
    ) =>
      ipcRenderer.invoke('official:uploadFile', {
        projectPath,
        chatType,
        chatId,
        fileType,
        url,
        fileName,
      }),
    sendMedia: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      mediaUrl: string,
      fileType: number,
      fileName?: string,
      eventId?: string,
      msgId?: string,
    ) =>
      ipcRenderer.invoke('official:sendMedia', {
        projectPath,
        chatType,
        chatId,
        mediaUrl,
        fileType,
        fileName,
        eventId,
        msgId,
      }),
    recallMessage: (
      projectPath: string,
      chatType: 'c2c' | 'group',
      chatId: string,
      msgId: string,
    ) => ipcRenderer.invoke('official:recallMessage', { projectPath, chatType, chatId, msgId }),
    onStatusChange: (callback: (data: unknown) => void) => {
      const handler = (_event: unknown, d: unknown) => callback(d);
      ipcRenderer.on('official:statusChanged', handler);
      return () => ipcRenderer.removeListener('official:statusChanged', handler);
    },
    onMessage: (callback: (data: unknown) => void) => {
      const handler = (_event: unknown, d: unknown) => callback(d);
      ipcRenderer.on('official:message', handler);
      return () => ipcRenderer.removeListener('official:message', handler);
    },
    startTranslator: (projectPath: string, port: number) =>
      ipcRenderer.invoke('official:startTranslator', { projectPath, port }),
    stopTranslator: (projectPath: string) => ipcRenderer.invoke('official:stopTranslator', { projectPath }),
    getTranslatorStatus: () => ipcRenderer.invoke('official:getTranslatorStatus', {}),
  },
  aiProvider: {
    list: () => ipcRenderer.invoke('aiProvider:list'),
    test: (config: unknown) => ipcRenderer.invoke('aiProvider:test', config),
    switch: (provider: string, config: unknown) =>
      ipcRenderer.invoke('aiProvider:switch', { provider, config }),
    getConfig: () => ipcRenderer.invoke('aiProvider:getConfig'),
  },
  botManager: {
    list: () => ipcRenderer.invoke('botManager:list'),
    start: (projectPath: string) => ipcRenderer.invoke('botManager:start', { projectPath }),
    stop: (projectPath: string) => ipcRenderer.invoke('botManager:stop', { projectPath }),
    restart: (projectPath: string) => ipcRenderer.invoke('botManager:restart', { projectPath }),
    register: (projectPath: string) => ipcRenderer.invoke('botManager:register', { projectPath }),
    unregister: (projectPath: string) => ipcRenderer.invoke('botManager:unregister', { projectPath }),
    onStatusChanged: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('botManager:statusChanged', listener);
      return () => ipcRenderer.removeListener('botManager:statusChanged', listener);
    },
    offStatusChanged: () => {},
  },
  docker: {
    export: (params: unknown) => ipcRenderer.invoke('docker:export', params),
    openFolder: (path: string) => ipcRenderer.invoke('docker:openFolder', { path }),
    onProgress: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, d: unknown) => cb(d);
      ipcRenderer.on('docker:progress', listener);
      return () => ipcRenderer.removeListener('docker:progress', listener);
    },
  },
  ssh: {
    deploy: (params: unknown) => ipcRenderer.invoke('ssh:deploy', params),
    testConnection: (params: unknown) => ipcRenderer.invoke('ssh:testConnection', params),
    onLog: (cb: (data: unknown) => void) => {
      const listener = (_e: unknown, d: unknown) => cb(d);
      ipcRenderer.on('ssh:log', listener);
      return () => ipcRenderer.removeListener('ssh:log', listener);
    },
  },
};

contextBridge.exposeInMainWorld('qqbat', api);

