# 能力三层归位表（prompts / resources / tools）

> **状态**：分析交付物，第一步（纯分析、零代码改动）
> **日期**：2026-10-08
> **对象**：前端全部可调用能力（35 个命名空间 / 247 个成员，其中 228 个方法由 `ipcSurfaceParity` 闸门对账）
> **2026-10-24**：`runtime` 的启动/停止/重启/状态/命令通道已下线（改走 `botManager:*`），本附录同步删除 6 个成员与 `onStatusChange`，合计 -7。
> **依据**：
>
> - MCP 规范三层控制分工 —— Prompts=用户控制 / Resources=应用控制 / Tools=模型控制
>   <https://modelcontextprotocol.io/specification/2025-06-18/server>
> - MCP Client Best Practices（渐进式发现，工具定义占上下文 1%–5% 即切换）
>   <https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices>
> - Anthropic Advanced Tool Use（>10K tokens、10+ 工具即应改检索；实测 77K→8.7K tokens、选择准确率 49%→74%）
>   <https://www.anthropic.com/engineering/advanced-tool-use>
> - WindowsWorld, ACL 2026 Findings（computer-use 跨应用成功率 **<21%**）→ GUI 路线不作为主路径
>   <https://aclanthology.org/2026.findings-acl.750/>

---

## 〇、结论先行

1. **目标不是"233 个工具"，而是"233 个能力各自归到正确的一层"。** 只读域若全做成模型可调工具，
   既烧上下文（Anthropic 实测 58 工具 ≈55K tokens）又伤选择准确率。
2. **真正该给模型的只有一小撮**：**Q + M 两层合计 189 个**（Q 85 + M 104），其余是 X（内部）与 ⛔（禁止）。
3. **最危险的不是"能力少"，是"不可信输入 × 高副作用动作"同时可达。** 见 §5 注入面清单。
4. **GUI/computer-use 全量路线排除**（跨应用 <21%）；画布这类自绘控件**只做兜底**，
   主路径走底层命令（Playwright MCP 官方也是"无障碍树优先、坐标只用于树里没有的元素"）。

## 能力域（专业分类）

257 个能力按「**这是干什么的**」归成 **9 个域**（35 个命名空间，一个不漏）：

| 能力域                                 | 命名空间                                                                                 | 能力    | 层分布      | 已开（直调/提案/高危） | 归属                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ------- | ----------- | ---------------------- | -------------------------- |
| **项目与工程** Project & Engineering   | project · git · history · file · codegen · expression                                    | 35      | M21 Q12 P2  | **12**                 | 作者智能体                 |
| **流程与交互** Flow & Interaction      | flow · panelSync · panel · buttonPanel                                                   | 19      | Q11 M6 P2   | **6**                  | 作者智能体                 |
| **数据与配置** Data & Config           | launchData · launchConfig · launchDashboard · dataTransfer · backup · audit · stateStore | 57      | Q28 M28 X1  | **23**                 | 作者智能体                 |
| **运行与观测** Runtime & Observability | runtime · botManager · metrics · resourceMonitor · diagnostics · crash · debug · data    | 53      | M21 X18 Q14 | **16**                 | 作者智能体                 |
| **协议与平台** Protocol & Platform     | official · adapter · aiProvider · capability                                             | 23      | M11 Q10 X2  | **3**                  | 作者智能体                 |
| **扩展与插件** Extensions              | plugin · customNode                                                                      | 23      | M14 Q8 X1   | **6**                  | 作者智能体                 |
| **部署与运维** Deploy & Ops            | docker · ssh                                                                             | 6       | M2 Q1 P1 X2 | **0**                  | 作者智能体（**一条未开**） |
| **本机终端** Local Shell               | terminal                                                                                 | 4       | **F3** X1   | **0**                  | **用户专属（模型禁用）**   |
| **智能体自身** Agent Internals         | ai                                                                                       | 41      | X41         | 0                      | 助手内部，不对外           |
| **合计**                               | 35                                                                                       | **258** |             | **66**                 |                            |

**你提到的三块都在里面，没有漏：**

- **日志** → 「运行与观测」域：`diagnostics`（诊断包）、`crash`（崩溃报告）、`audit`（审计日志）、`metrics`（指标）、`runtime.onLog`（事件流）。
- **终端** → 「本机终端」域：`terminal.create` / `write` / `kill` 三条**全部归 F（禁用）** ——
  任意命令执行等价于把主机交出去，**永不进模型层**（界面上它仍是用户自己开的子进程）。
- **后端** → 「部署与运维」域：`docker.export`、`ssh.deploy` / `ssh.testConnection`。
  目前**一条未开** —— 不是不敢，是「远程主机上会发生什么，本机算不出来」，缺的是估算器而不是开关。

### 命名空间 → 作用对象（**机器可读**）

「作用对象」只回答一件事：**这个能力碰到什么**。它与「层」（能不能动）、「角色」（谁在什么场景用）是**三把正交的尺子**。

生成器按这张表给每条能力标 `domain`；**每个命名空间必须恰好出现一次**，漏一个就报错。

```text
project = 工程
git = 工程
history = 工程
file = 工程
flow = 界面
panelSync = 界面
panel = 界面
buttonPanel = 界面
expression = 界面
codegen = 代码
customNode = 代码
plugin = 代码
launchData = 数据
launchConfig = 数据
launchDashboard = 数据
dataTransfer = 数据
backup = 数据
audit = 数据
stateStore = 数据
official = 对外
adapter = 对外
docker = 对外
ssh = 对外
aiProvider = 对外
runtime = 观测
botManager = 观测
metrics = 观测
resourceMonitor = 观测
diagnostics = 观测
crash = 观测
debug = 观测
data = 观测
capability = 内部
ai = 内部
terminal = 终端
```

> 为什么要有它：分类如果只写在散文里，就会和代码漂移 —— 本仓库已经漂移过两次
> （一次是加了 4 个工具却没进任何角色表；一次是统计时漏掉 2 个命名空间）。

### 两个智能体各管什么（分工的专业叫法）

|            | **作者智能体** Author Agent（开发期，在应用里） | **运行智能体** Runtime Agent（运行期，在群里）        |
| ---------- | ----------------------------------------------- | ----------------------------------------------------- |
| 面对谁     | 你                                              | 群里的人                                              |
| 能力来源   | **本文档的能力台账**（248 条逐条授权）          | **画布上的节点目录**（画出来就有）                    |
| 默认能用的 | 直调 29 + 提案 34 + 高危 3                      | `type=action` 且**无副作用**的节点                    |
| 数据与配置 | ✅ 读=直调 / 写=提案 / 删表=高危授权            | ❌ **碰不到**（数据节点不是 action，或已声明副作用）  |
| 部署与终端 | 未开 / 禁用                                     | ❌ 碰不到                                             |
| 记忆       | 按**项目**（`.qqbat/ai-history.jsonl`）         | 按**群 / 人**（会话记忆 + `ai-calls.jsonl` 调用日志） |
| 总闸       | 高危能力看**用户侧环境变量**                    | 策略层（限流 + 每人每日额度 + 群白名单）              |

**一句话**：作者智能体管「**把机器人做出来**」（工程 / 流程 / 数据 / 观测 / 部署），
运行智能体管「**把机器人当起来**」（按你画的流程回话）。
两边**共用的只有「节点目录」这一份真相**，能力面互不继承 —— **数据与部署只归作者智能体**。

---

## 一、判据（机械初判 + 人工复核）

| 层             | 代号                 | 谁控制 | 判据                                                                                                              | 归宿                                       |
| -------------- | -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Prompts        | **P** 人工 Manual    | 用户   | 需要人类在 OS/产品层做一次不可代劳的交互（文件选择框、打开文件夹），或"对外发布"类动作                            | 不进模型工具表；只作为**用户可点的入口**   |
| Resources      | **R** 注入 Injected  | 应用   | ⚠️ **本表当前为空** —— 见 §1.1。应用真正注入的是**提示词分段**，不是 IPC 能力；IPC 上的只读能力一律归 Q（按需取） | 保留为将来「确实需要常驻注入的状态」的格子 |
| Tools·query    | **Q** 可查 Query     | 模型   | 只读但**模型必须主动检索**（跨域探查、按需取详情）                                                                | 工具，常驻或按需                           |
| Tools·mutation | **M** 可议 Proposal  | 模型   | 有副作用，模型只能**提议**，用户确认后落盘                                                                        | 工具 + 提案 + 确认                         |
| 元域/内部      | **X** 内部 Internal  | —      | 助手自身的控制面、渲染层内部管道、事件流                                                                          | **不参与归位**（参与会自指）               |
| 禁止           | **F** 禁用 Forbidden | 用户   | 任意命令执行等"一旦开放即等价于交出主机"的能力                                                                    | **永不进模型层**                           |

### 1.1 为什么 R 层是空的（2026-10-08 自查更正）

**上一版把 69 个只读能力标成了 `R`（「应用注入」），但没有任何代码注入它们** ——
它们既不在附录 B（可直接调），也不在附录 C（可提议），于是处于**「谁也够不着」的悬空状态**。
而文档却写着「应用会注入」，属于本仓库最忌讳的那类**假承诺**。

根因是**把两类东西混成了一类**：

| 其实是                           | 举例                                                   | 归哪                                                                                                                |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **提示词分段**（应用真的在注入） | 能力索引、当前流程摘要、工具约定、项目词汇、领域知识包 | 不是 IPC 能力，**不该出现在本表** —— 落点是 `promptSections` / `context.ts`，且有 `realProjectSelfCheck` 等用例钉住 |
| **IPC 上的只读能力**             | `project.getMeta` / `runtime.status` / `git.log`       | **Q**（模型按需取）。「要不要注入」是**另一个决定**，不是层的含义                                                   |

所以更正为：**只读能力一律归 `Q`**；`R` 保留为「将来确实需要常驻注入的状态」的格子，**当前为空**。
这样每一条都有明确归属，不再有悬空承诺。

> 仍未决定（留给产品判断）：`runtime.status` / `metrics.getSnapshot` 这类**随时可查**的状态，
> 要不要真的注入进系统提示以减少往返。**那是加预算的决定，不该由我顺手做掉。**
> ⚠️ **判据只能给初判**。本仓库有血证：`ai-data-tools-redesign.md` 的 A1——
> `search_player` 描述写"搜索所有表"、实现只搜一半。**名字会骗人，所以最终必须人工复核 + 闸门钉住。**

---

## 二、总表（35 个命名空间）

| 命名空间        | 成员 | R   | Q   | M   | P   | ⛔  | X   | 归属判断                       |
| --------------- | ---- | --- | --- | --- | --- | --- | --- | ------------------------------ |
| panelSync       | 3    | –   | 2   | –   | 1   | –   | –   | 发布类由用户触发               |
| capability      | 1    | –   | 1   | –   | –   | –   | –   | 只读自检                       |
| project         | 15   | –   | 3   | 10  | 2   | –   | –   | **缺 `create` 的模型入口**     |
| flow            | 4    | –   | 3   | 1   | –   | –   | –   | 已有 AI 工具                   |
| expression      | 1    | –   | 1   | –   | –   | –   | –   | 纯校验                         |
| codegen         | 1    | –   | –   | 1   | –   | –   | –   | 只写快照，低危                 |
| file            | 6    | –   | 2   | 1   | 3   | –   | –   | 已有 AI 工具；框架开关 **P**   |
| terminal        | 4    | –   | –   | –   | –   | 3   | 1   | **⛔ 用户专用**                |
| runtime         | 3    | –   | –   | 1   | –   | –   | 2   | 仅日志/节点事件 + 注入测试消息 |
| launchData      | 23   | –   | 12  | 11  | –   | –   | –   | **★★★ 注入面**                 |
| buttonPanel     | 8    | –   | 3   | 5   | –   | –   | –   | 界面资产                       |
| launchConfig    | 10   | –   | 3   | 7   | –   | –   | –   | **★★★ DDL**                    |
| launchDashboard | 3    | –   | 3   | –   | –   | –   | –   | 纯只读                         |
| audit           | 3    | –   | 2   | –   | –   | –   | 1   | 只读可查                       |
| backup          | 4    | –   | 1   | 3   | –   | –   | –   | restore ★★★                    |
| dataTransfer    | 4    | –   | 2   | 2   | –   | –   | –   | import ★★                      |
| ai              | 56   | –   | –   | –   | –   | –   | 56  | **元域：助手自身，不归位**     |
| data            | 5    | –   | –   | –   | –   | –   | 5   | 渲染层内部管道                 |
| panel           | 4    | –   | 3   | –   | 1   | –   | –   | 发布=用户触发                  |
| debug           | 11   | –   | 2   | 8   | –   | –   | 1   | 仅调试会话，低危               |
| history         | 3    | –   | 2   | 1   | –   | –   | –   | restore ★★                     |
| git             | 12   | –   | 4   | 8   | –   | –   | –   | 破坏历史 ★★                    |
| diagnostics     | 3    | –   | 1   | –   | –   | –   | 2   | 导出诊断包                     |
| customNode      | 6    | –   | 2   | 3   | –   | –   | 1   | fork 生成插件                  |
| metrics         | 7    | –   | 4   | 2   | –   | –   | 1   | 只读为主                       |
| crash           | 6    | –   | 3   | 2   | –   | –   | 1   | —                              |
| resourceMonitor | 10   | –   | 3   | 3   | –   | –   | 4   | —                              |
| stateStore      | 10   | –   | 5   | 5   | –   | –   | –   | clearAll ★★★                   |
| plugin          | 19   | –   | 7   | 12  | –   | –   | –   | install ★★★                    |
| adapter         | 3    | –   | 2   | 1   | –   | –   | –   | —                              |
| official        | 15   | –   | 4   | 9   | –   | –   | 2   | sendMessage ★★★                |
| aiProvider      | 4    | –   | 3   | 1   | –   | –   | –   | —                              |
| botManager      | 8    | –   | 1   | 5   | –   | –   | 2   | —                              |
| docker          | 3    | –   | –   | 1   | 1   | –   | 1   | 生成部署件                     |
| ssh             | 3    | –   | 1   | 1   | –   | –   | 1   | **★★★ 远程部署**               |

**小计**：R **0** · Q **85** · M **104** · P **8** · ⛔ **3** · X **81**（合计 **281** ✓）

> X + ⛔ = **84** 个能力**不进模型工具表**；Q + M = **189 个**是「谁控制」意义上的候选 —— **是否放行仍由附录 B / C 决定**（层不说明「已开放」）。

---

## 三、逐域明细（只列需要判断的）

### project（15）— **"AI 生成项目"的缺口在这里**

- **Q**：`getMeta` `getConfig` `listRecent`
- **M**：`create` ⭐ `open` `saveConfig` `updateTranslatorPort` `updateBotType` `rename` `delete` `move` `clone` `removeRecent`
- **P**：`pickDirectory` `openFolder`（必须在 OS 对话框里由人选路径）

> `create` 是当前 26 个 AI 工具里**完全缺失**的一环——助手只能在已打开的项目里干活。
> 这是"AI 生成项目"最该先补的一个 M 类能力。

### launchData（23）— ★★★ 最高危域

- **Q（元信息，按需查）**：`listDataSources` `getSchema` `getPlayerSchema` `getUidMapping` `getPlayersWithUid` `getDataTemplate` `countPlayersMissingBaseData` `queryPlayerTables` `checkIdentity`
- **Q（取行数据，必须裁剪/分页）**：`queryTable` `listPlayers` `searchPlayer`
- **M**：`updateRecord` `insertRecord` `deleteRecord` `mergePlayers` `deletePlayer` `saveSchema` `savePlayerSchema` `updatePlayerUid` `saveDataTemplate` `deriveDataTemplate` `backfillPlayerBaseData`

> 为什么最危险：这个域的**输入来自玩家消息**（群里的 QQ 号是不可信内容），
> 而这个域能**删玩家 / 改 schema**。同时可达 = 提权路径。
> 正解不是"恢复 `exec_sql`"，而是 Retool 的"**只给 schema 不给数据**"+ 领域动作。

### launchConfig（10）— 配置表 DDL

- **Q**：`listCategories` `getTable` `getSchema`
- **M（普通写）**：`updateRecord` `insertRecord` `deleteRecord` `createTable` `renameTable`
- **M（★★★ 破坏性 DDL）**：`dropTable` `alterTable`（改结构 = 旧数据可能对不上）

### official（15）— 以机器人身份对外动作

- **Q**：`status` `getConfig` `getTranslatorStatus`
- **M**：`start` `stop` `saveConfig` `recallMessage` `uploadFile` `sendMedia` `startTranslator` `stopTranslator`
- **M（★★★）**：`sendMessage` —— 模型若能调它 = **机器人能主动给任意 chatId 发消息**（群发风险）
- **X**：4 个 `on*`

### ssh / docker — 部署面

- `ssh.deploy` → **M（★★★）**：远程执行 docker build/run 或 nohup，**批准后仍应受沙箱限制**
- `ssh.testConnection` → Q
- `docker.export` → M（生成 Dockerfile 等，低危）
- `docker.openFolder` → **P**

### terminal（4）— ⛔

`create` `write` `kill` 是**任意命令执行**。等价于把主机交出去。
**永不进模型层**；界面上是用户显式创建的子进程，与 agent 无关。

### ai（30）— 元域，不参与归位

20 个方法（`chat`/`cancelChat`/`tools`/`*Config`/`beginBatch`…）+ 11 个事件监听（`onChunk` `onProposal` `onCompact`…）。
它是**助手自身的控制面**。把它也归位会造成自指（助手调用助手）。
→ 归位表里显式**排除**，并在闸门里登记排除理由。

### data（5）— 渲染层内部管道

`notifyChange` `registerBridge` `unregisterBridge` `startWatch` `stopWatch`。同样是 X。

### file（6）— 文件访问边界 + 框架开发模式开关

- **Q**：`list` `read`
- **M**：`write`
- **P**：`getDevMode` `setDevMode` `restoreDevBackup`（2026-10-15 新增）

> **这三条为什么必须是 P（用户触发），不能是 Q/M/X**：
> 它们是「框架开发模式」的开关与回退点读取 —— 打开后 AI 才能读写**框架自己**的源码，
> 而每一次写都会先在 `<框架根>/.dev-backups/<时间戳>/` 留一份原内容。
> 如果开关是 M（模型可提议）或 Q（模型按需查），**被约束的一方就能自己解锁**，
> 护栏等于不存在（同 §1.1 那条"总闸必须握在用户手里"）。
> 状态本身由**主进程**持有（渲染层传标记 = 等于没拦），默认关，读不到设置也按关处理。

---

## 四、顺带发现（两条真实不一致，建议顺手登记）

1. **`launchData.saveSchema` 实际走的通道是 `plugin:saveSchema`**
   —— 命名空间与通道前缀不一致。现有 `channelContract` / `ipcSurfaceParity` 闸门对的是**名字**，
   不对**业务归属**，所以它一直绿着。影响：按命名空间自动归位时会归错域。
2. **（已处理 2026-10-24）`runtime.start/stop/status/sendCommand/restart/listRunning` 曾直连
   `services/botProcess`（Python 时代的 stdout 总线，该文件已随 Python 栈清理删除）** —— TS 运行时下
   永远收不到事件；控制改走 `botManager:*`、状态改走 `botManager:statusChanged`，本附录只留观测三项。

---

## 五、注入面清单（按"不可信输入 × 高副作用"排序）

**不可信输入源**（本项目的）：① 群消息 / 玩家消息；② 插件市场 / `plugin.install` 引入的第三方代码；③ AI 生成的提案内容本身。

| 级别 | 能力                                                            | 为什么                  |
| ---- | --------------------------------------------------------------- | ----------------------- |
| ⛔   | `terminal.*`                                                    | 任意命令执行            |
| ★★★  | `ssh.deploy`                                                    | 远程主机执行            |
| ★★★  | `launchData.deletePlayer` / `deleteRecord` / `savePlayerSchema` | 玩家数据不可逆          |
| ★★★  | `launchConfig.dropTable` / `alterTable`                         | 配置表结构不可逆        |
| ★★★  | `plugin.install`                                                | 装第三方代码 = 扩执行面 |
| ★★★  | `stateStore.clearAll`                                           | 清空运行状态            |
| ★★★  | `official.sendMessage`                                          | 以机器人身份对外发消息  |
| ★★★  | `backup.restore` / `dataTransfer.import*`                       | 覆盖现有数据            |
| ★★   | `git.deleteCommits` / `clearHistory` / `rewordCommit`           | 破坏可追溯性            |
| ★★   | `history.restore`                                               | 覆盖当前流程            |
| ★★   | `file.write`                                                    | 项目内任意文件          |
| ★    | `debug.*` / `metrics.start                                      | stop`                   | 影响运行中的调试会话 |

**推论（这是本表最重要的用途）**：
凡 ★★★ 者，必须同时满足三条才可对模型开放——① 走提案 + 用户确认；② **批准后仍受沙箱限制**（见下一步）；
③ 与不可信输入**不在同一会话上下文**里可达。

---

## 六、与现有代码/闸门的接口

- **已有的**：`proposal` + `proposalValidation`（差分校验）、`pendingGraph`（预览图）、
  `writeGuard`（先读后写）、`capabilityClaimsMatchCode`（清单 ↔ 代码锚点对账）——
  最后这条**就是本表要复用的闸门形态**。
- **建议新增闸门（`tests/guards/capabilityLayering.test.ts`）**：
  1. 每个 IPC 能力必须在本表登记层归属（R/Q/M/P/X/⛔），未登记即红；
  2. **`X` / `⛔` 层能力不得出现在工具注册表里**；
  3. **M 层能力必须有 `sideEffects` 声明**（fail-closed，对齐 MCP `destructiveHint` 默认 true）；
  4. **⛔ 层能力出现任何工具入口即红**；
  5. 表里每个锚点必须能在 `src/` 搜到（复用 `capabilityClaimsMatchCode` 的写法）。

---

## 七、下一步（本表之后）

| 步  | 做什么                                                                            | 机械验收                                                  |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2   | **能力目录 + 渐进式发现**：从 IPC 契约派生参数，人工写描述，高频常驻 + 长尾 defer | 新增 IPC 方法不写 AI 代码即可被检索到；描述与实现不符即红 |
| 3   | **批准后沙箱**（VS Code 两层：approvals + sandboxing）                            | 批准部署后，越界写文件/网络仍被拒                         |
| 4   | **补 `project.create`**                                                           | 一句话 → 可运行项目，全程进提案、可一次撤销               |

---

## 附录 A · 能力台账 Capability Ledger —— 逐方法层归属（机器可读）

> 闸门 [`tests/guards/capabilityLayering.test.ts`](../tests/guards/capabilityLayering.test.ts) **直接解析本段**。
> 格式：`<命名空间>.<方法> = <层>`；层取值 `R` / `Q` / `M` / `P` / `F` / `X`。
> **改这张表 = 同时改这里**，两边不一致即红（写法与 `capabilityClaimsMatchCode` 一致）。

```text
adapter.current = Q
adapter.list = Q
adapter.switch = M
ai.agentCoreRun = X
ai.agentCoreSteer = X
ai.beginBatch = X
ai.cancelChat = X
ai.clearAllowRules = X
ai.clearThread = X
ai.commitBatch = X
ai.exportPresets = X
ai.getAllowRules = X
ai.getAppConfig = X
ai.getConfig = X
ai.getHistory = X
ai.importPresets = X
ai.getPresets = X
ai.getProjectBotConfig = X
ai.getToolBudget = X
ai.isRunning = X
ai.listAiTurns = X
ai.listThreads = X
ai.listProjectBotConfigs = X
ai.noteTurn = X
ai.onAgentStep = X
ai.onAgentState = X
ai.onChunk = X
ai.onClientInstruction = X
ai.onCompact = X
ai.onError = X
ai.onProposal = X
ai.onResponse = X
ai.onStats = X
ai.onTodo = X
ai.onToolCall = X
ai.onWarning = X
ai.pickPresetShare = X
ai.rollbackBatch = X
ai.savePresets = X
ai.saveProjectConfig = X
ai.setAppConfig = X
ai.setConfig = X
ai.setPresetDefault = X
ai.setProjectBotConfig = X
ai.setToolBudget = X
ai.testConfig = X
ai.tools = X
ai.removeAllowRule = X
ai.rewindAiTo = X
ai.setAiFallbacks = X
ai.previewAiTurn = X
ai.resolveApproval = X
ai.resolveInstruction = X
ai.onApprovalRequest = X
ai.onApprovalResolved = X
ai.rollbackAiTurn = X
ai.undoPresetImport = X
ai.onThreadTitle = X
ai.renameThread = X
aiProvider.getConfig = Q
aiProvider.list = Q
aiProvider.test = Q
aiProvider.switch = M
audit.list = Q
audit.search = Q
audit.log = X
backup.list = Q
backup.create = M
backup.restore = M
backup.snapshot = M
botManager.list = Q
botManager.register = M
botManager.restart = M
botManager.start = M
botManager.stop = M
botManager.unregister = M
botManager.offStatusChanged = X
botManager.onStatusChanged = X
buttonPanel.get = Q
buttonPanel.list = Q
buttonPanel.listBuiltin = Q
buttonPanel.create = M
buttonPanel.delete = M
buttonPanel.duplicate = M
buttonPanel.importBuiltin = M
buttonPanel.update = M
capability.probe = Q
codegen.generate = M
crash.getReports = Q
crash.readReport = Q
crash.exportDiagnostic = Q
crash.capture = M
crash.clearReports = M
crash.onShowCrashPanel = X
customNode.scan = Q
customNode.scanAiGenerated = Q
customNode.unwatch = M
customNode.watch = M
customNode.fork = M
customNode.onChanged = X
data.notifyChange = X
data.registerBridge = X
data.startWatch = X
data.stopWatch = X
data.unregisterBridge = X
dataTransfer.exportCsv = Q
dataTransfer.exportJson = Q
dataTransfer.importCsv = M
dataTransfer.importJson = M
debug.getState = Q
debug.getVariables = Q
debug.continue = M
debug.pause = M
debug.setBreakpoints = M
debug.start = M
debug.stepInto = M
debug.stepOut = M
debug.stepOver = M
debug.stop = M
debug.onStateChanged = X
diagnostics.export = Q
diagnostics.onProgress = X
diagnostics.rendererLog = X
docker.export = M
docker.openFolder = P
docker.onProgress = X
expression.checkSyntax = Q
file.getDevMode = P
file.list = Q
file.read = Q
file.restoreDevBackup = P
file.setDevMode = P
file.write = M
flow.load = Q
flow.preview = Q
flow.validate = Q
flow.save = M
git.diff = Q
git.listVersionTags = Q
git.log = Q
git.status = Q
git.clearHistory = M
git.deleteCommits = M
git.deleteVersionTag = M
git.init = M
git.renameVersionTag = M
git.restoreFlow = M
git.rewordCommit = M
git.tagVersion = M
history.list = Q
history.read = Q
history.restore = M
launchConfig.getSchema = Q
launchConfig.getTable = Q
launchConfig.listCategories = Q
launchConfig.alterTable = M
launchConfig.createTable = M
launchConfig.deleteRecord = M
launchConfig.dropTable = M
launchConfig.insertRecord = M
launchConfig.renameTable = M
launchConfig.updateRecord = M
launchDashboard.getGroups = Q
launchDashboard.getStatus = Q
launchDashboard.getTimeline = Q
launchData.checkIdentity = Q
launchData.countPlayersMissingBaseData = Q
launchData.getDataTemplate = Q
launchData.getPlayerSchema = Q
launchData.getPlayersWithUid = Q
launchData.getSchema = Q
launchData.getUidMapping = Q
launchData.listDataSources = Q
launchData.queryPlayerTables = Q
launchData.listPlayers = Q
launchData.queryTable = Q
launchData.searchPlayer = Q
launchData.backfillPlayerBaseData = M
launchData.deletePlayer = M
launchData.deleteRecord = M
launchData.deriveDataTemplate = M
launchData.insertRecord = M
launchData.mergePlayers = M
launchData.saveDataTemplate = M
launchData.savePlayerSchema = M
launchData.saveSchema = M
launchData.updatePlayerUid = M
launchData.updateRecord = M
metrics.getHistory = Q
metrics.getSnapshot = Q
metrics.exportToCSV = Q
metrics.exportToJSON = Q
metrics.start = M
metrics.stop = M
metrics.onSnapshot = X
official.getConfig = Q
official.getTranslatorStatus = Q
official.status = Q
official.testConnection = Q
official.recallMessage = M
official.saveConfig = M
official.sendMedia = M
official.sendMessage = M
official.start = M
official.startTranslator = M
official.stop = M
official.stopTranslator = M
official.uploadFile = M
official.onMessage = X
official.onStatusChange = X
panel.getSchema = Q
panel.listRegistered = Q
panel.queryTable = Q
panel.savePanel = P
panelSync.list = Q
panelSync.menu = Q
panelSync.apply = P
plugin.getAllSpecs = Q
plugin.getSettings = Q
plugin.listHost = Q
plugin.listInstalled = Q
plugin.marketInspect = Q
plugin.marketList = Q
plugin.scan = Q
plugin.createNode = M
plugin.install = M
plugin.load = M
plugin.loadAi = M
plugin.marketAddSource = M
plugin.marketInstall = M
plugin.marketRemoveSource = M
plugin.marketUninstall = M
plugin.saveSettings = M
plugin.setEnabled = M
plugin.setHostEnabled = M
plugin.unload = M
project.getConfig = Q
project.getMeta = Q
project.listRecent = Q
project.clone = M
project.create = M
project.delete = M
project.move = M
project.open = M
project.removeRecent = M
project.rename = M
project.saveConfig = M
project.updateBotType = M
project.updateTranslatorPort = M
project.openFolder = P
project.pickDirectory = P
resourceMonitor.getConfig = Q
resourceMonitor.getHistory = Q
resourceMonitor.getUsage = Q
resourceMonitor.setConfig = M
resourceMonitor.start = M
resourceMonitor.stop = M
resourceMonitor.onAlert = X
resourceMonitor.onConfig = X
resourceMonitor.onStatus = X
resourceMonitor.onUsage = X
runtime.injectTestMessage = M
runtime.onExecuteNode = X
runtime.onLog = X
ssh.testConnection = Q
ssh.deploy = M
ssh.onLog = X
stateStore.get = Q
stateStore.getAllStateEntries = Q
stateStore.getSessionVar = Q
stateStore.listKeys = Q
stateStore.stats = Q
stateStore.clearAll = M
stateStore.clearSession = M
stateStore.delete = M
stateStore.set = M
stateStore.setSessionVar = M
terminal.create = F
terminal.kill = F
terminal.write = F
terminal.onData = X
```

**附录小计**：R 0 · Q 85 · M 104 · P 8 · ⛔ F 3 · X 79 = **279**

---

## 附录 B · 只读直调授权 Read Grant —— 可直接调用（effect = none）

> **为什么附录 A 不够**：A 只回答"归哪一层"。但**层与副作用是两个正交维度** ——
> 同为 `Q` 层，`flow.validate` 是纯函数，`dataTransfer.exportJson` 却**会写文件**，
> `official.testConnection` 会**带凭据联网**。把"Q 层"直接等同于"可以让模型直接调"是**错的**
> （这也是 MCP `ToolAnnotations` 把 readOnly / destructive / openWorld 分开的原因）。
>
> 因此本附录只登记**确实无副作用**的能力，判据三条**全满足**才算：
>
> 1. 层必须是 `Q`（R 由应用注入、M 要走提案、P/F/X 一律不给）；
> 2. **不写任何文件** —— 所以 `dataTransfer.export*` / `metrics.export*` / `diagnostics.export` / `crash.exportDiagnostic` **不在**此列；
> 3. **不发起网络请求** —— 所以 `capability.probe` / `official.testConnection` / `ssh.testConnection` / `aiProvider.test` **不在**此列。
>
> **格式与附录 C 相同**：每条也要写调用约定（`- <id> (参数1, 参数2?, …)`），
> 因为主进程要按它把具名参数翻成位置参数去调那条 IPC 通道。
>
> **默认拒绝**：不在本列的，一律不可直接调用（fail-closed）——
> 这条是刻意的，因为本仓库吃过"未命中时返回 query，安全方向是反的"那次亏
> （见 `tool-category-safety.test.ts` 的文件头）。

- flow.validate (projectPath, graph)
- flow.preview (request)
- expression.checkSyntax (text)
- launchData.queryTable (filePath, tableName, page, pageSize, cursor?)
- launchData.searchPlayer (projectPath, query)
- launchData.listPlayers (projectPath)

### B.2 第二批（2026-10-08 新增）：**只读自省**

上一版只开了 6 条，瓶颈是**机制**：直接调用跑在主进程，每开一个能力都要手写一条绑定。
现在改成「捕获已注册的 IPC handler 直接调它」（见 `src/main/services/ai/ipcBridge.ts`），
于是**开一个能力 = 在这一节加一行**，而且校验与守卫**还是 IPC 那一份**（不是第二套实现）。

- adapter.list ()
- audit.list (projectPath, page, pageSize)
- audit.search (projectPath, query)
- git.listVersionTags (projectPath)
- git.log (projectPath, maxCount?)
- git.status (projectPath)
- history.list (projectPath)
- launchConfig.getSchema (projectPath, category)
- launchConfig.getTable (projectPath, category, page, pageSize)
- launchConfig.listCategories (projectPath)
- launchDashboard.getStatus (projectPath)
- launchData.getSchema (filePath)
- launchData.listDataSources (projectPath)
- metrics.getHistory ()
- metrics.getSnapshot ()
- plugin.getAllSpecs ()
- plugin.listInstalled ()
- resourceMonitor.getUsage ()
- stateStore.get (projectPath, key)
- stateStore.listKeys (projectPath, prefix?)
- stateStore.stats (projectPath)

> 选它们的理由：都是**只读**，而且回答的是「我该照什么来做」——
> 数据源与配置表长什么样（`launchData.*` / `launchConfig.*`）、历史上改过什么（`git.*` / `history.list` /
> `audit.*`）、现在跑得怎么样（`metrics.*` / `resourceMonitor.*` / `launchDashboard.*` / `stateStore.*`）、
> 装了哪些扩展（`plugin.*` / `adapter.list`）。
>
> **故意排除的三类**（每类都有理由）：
> · **带凭据的读接口**：`project.getConfig` / `official.getConfig` / `aiProvider.getConfig` ——
> 它们会把 `appSecret` / `apiKey` 读出来。**凭证永不进模型上下文**（n8n 的做法，也是硬线）。
> · **按文件名读的接口**：`history.read(fileName)` / `crash.readReport(id)` ——
> 能不能安全取决于 id 有没有防穿越，我**没有逐个核实**，所以先不开。
> · **会写盘的只读语义接口**：`dataTransfer.export*` / `metrics.export*` / `diagnostics.export` /
> `crash.exportDiagnostic` —— 名字像只读，实际**写文件**（见附录 B 开头的判据 ②）。

### B.3 第三批（只读）：调试自省

调试面板的状态与变量是**只读**的，而且正是排查问题时最需要的东西
（Chrome DevTools MCP 的做法就是把调试 / 性能 / 网络暴露成只读工具，而不是去模拟点按钮）。

- debug.getState ()
- debug.getVariables ()

---

## 附录 C · 可逆提案授权 Reversible Grant —— 可提议（走提案 + 用户确认）

> 附录 B 管"**可以直接调**"，本附录管"**可以提议**"。
>
> M 层有 99 个能力，但**不全部立刻开放**：开放一个 = 往用户面前多推一个确认框。
> 而 ★★★ 那些（`ssh.deploy` / `launchData.deletePlayer` / `launchConfig.dropTable` /
> `plugin.install` / `official.sendMessage` …）在**主机白名单 / 资源限制**落地之前开放，
> 等于把一个不可逆动作压在一次点击上。
>
> 所以本表是**逐条登记**的白名单，**默认拒绝**（fail-closed）。

### C.1 调用约定（必须写，不写不给进）

每条都要写出**位置参数表**：`- <id> (参数1, 参数2, …)`。零参数写 `()`；**可选参数加 `?`**（如 `name?`）。

渲染层执行时按这张表取值，调用 `window.qqbat.<ns>.<method>(参数1, 参数2, …)`。
参数名与 preload 方法形参名一致。

**`projectPath` 是特殊参数**：它不是从模型给的参数里取，而是由**渲染层注入当前项目路径**。
模型给了也会被忽略 —— 这一条是硬约束，否则模型可以提议去改**另一个项目**。
（闸门 + 单元测试钉住这条。）

### C.2 本批开放的（★ 低危、可逆、不涉网络）

- project.create (config)
- buttonPanel.create (projectPath, payload)
- buttonPanel.update (projectPath, payload)
- project.updateBotType (projectPath, botType)
- adapter.switch (type)
- resourceMonitor.setConfig (config)

> 挑选理由（逐条）：
> · 都是**项目内、可逆**的改动（按钮面板可删可改、机器人类型是单字段、适配器可切回、阈值可调回）；
> · **不写任意路径、不联网、不发消息、不删数据**；
> · 反例（本轮**故意不收**）：`project.rename`（改的是**当前打开项目**的目录名 →
> 会让会话指向不存在的路径）、`history.restore`（覆盖当前流程）、`buttonPanel.delete`（删除，
> 可重建但仍是删除）、`project.saveConfig`（含凭据字段）。

### C.3 第二批（2026-10-08 新增）：**可逆 / 追加型**

判据只有一条，比"危不危险"更好判：**做错了能不能用相反的动作退回去**
（删除**不算**可逆 —— "重建"不等于"退回"）。

- buttonPanel.duplicate (projectPath, panelId, newName?)
- buttonPanel.importBuiltin (projectPath, templateIds?)
- customNode.fork (projectPath, builtinKind, newName)
- git.renameVersionTag (projectPath, oldName, newName)
- git.tagVersion (projectPath, name?, message?)
- launchConfig.createTable (projectPath, displayName, fields)
- launchConfig.insertRecord (projectPath, category, values)
- launchConfig.renameTable (projectPath, oldCategory, newDisplayName)
- launchConfig.updateRecord (projectPath, category, rowid, changes)
- metrics.start ()
- metrics.stop ()
- plugin.setEnabled (pluginName, enabled)
- stateStore.clearSession (projectPath, sessionId)
- stateStore.set (projectPath, key, value)

> 逐条说清"怎么退回去"：
> · 复制 / 导入 / fork / 建表 / 插记录 / 打标签 —— **纯追加**，不做就没有；
> · 改名 / 改记录 / 改标签名 —— **改回原名或原值**（原值在界面上可见）；
> · metrics 启停、plugin 启停、清会话变量 —— 开关型，**再点一次就回来**。
>
> 仍然**不给**的（这批里最容易手滑开错的）：
> `launchConfig.deleteRecord` / `dropTable` / `alterTable`、`stateStore.delete` / `clearAll`、
> `git.deleteCommits` / `clearHistory` / `restoreFlow`、`buttonPanel.delete`、`crash.clearReports`
> —— 它们**退不回去**，等沙箱与快照机制齐了再说。

### C.4 第三批（2026-10-08）：**★★ 可逆，但会改东西**

这批比 C.3 更进一步：它们**会改已有状态**，但每一条都能退回去。
开它们之前我逐条核对了「怎么退」，而不是只看名字像不像安全。

- customNode.unwatch (projectPath)
- customNode.watch (projectPath)
- debug.continue ()
- debug.pause ()
- debug.setBreakpoints (bps)
- debug.start ()
- debug.stepInto ()
- debug.stepOver ()
- debug.stepOut ()
- debug.stop ()
- git.init (projectPath)
- git.restoreFlow (projectPath, hash)
- project.updateTranslatorPort (projectPath, port)
- stateStore.setSessionVar (projectPath, sessionId, varName, value)

> 逐条说清「怎么退」：
> · **watch / unwatch**：一对开关，再调一次就回来；
> · **debug.***：调试会话控制（继续 / 暂停 / 单步 / 断点 / 起停），随时可 stop。
> 这批是照 Chrome DevTools MCP 的思路开的 —— 把调试能力暴露成工具，而不是让 AI 去点界面；
> · **git.init**：仓库不存在才建，纯追加；
> · **git.restoreFlow**：⚠️ 这条我**读了实现才敢开** —— src/main/services/ops/git.ts:530 写着并被测试锁住：
> 校验不过就**一个字节都不写**；成功时**先备份当前文件**、再写回、最后**追加一条 restore 提交**
> （原文：恢复本身也要进历史，否则「恢复错了」不可逆）。所以它是可逆的；
> · **updateTranslatorPort / setSessionVar**：改回原值即可（原值用户可见）。
>
> **仍然不给**：flow.save（覆盖画布本身）、git.rewordCommit / deleteCommits / clearHistory、
> stateStore.delete / clearAll、history.restore（按文件名，防穿越未核实）、
> project.rename / delete / move、buttonPanel.delete。

---

## 附录 D · 高危升级授权 Escalation Grant —— ★★★ 退不回去、或对外真的发生

> 与附录 C 的区别：附录 C 的能力**退得回去**；这里的能力退不回去——
> 给群里发了消息、往远程主机部署了、删了玩家数据、改了表结构、装了第三方代码。
>
> **两道闸门，缺一不可：**
>
> **① 总开关**：环境变量 `QQBAT_AI_ALLOW_DESTRUCTIVE=1`。**默认关** —— 默认一条都提不出来。
> 为什么用环境变量而不是界面开关：它是**用户侧的**、模型碰不到（模型能给的是参数，不是环境）；
> 而且这是本仓库已有的做法（`QQBAT_KB=0` / `QQBAT_MCP_SSE_PORT` / `AI_TRACE_REPORT` 都是这个模式）。
> 界面上的开关以后可以补，但**不能只有界面**——那等于把总闸交回给被约束的一方。
>
> **② 目标白名单**：带 `target=` 的能力，其目标必须出现在 `QQBAT_AI_ALLOWED_TARGETS`（逗号分隔）里。
> 白名单**为空 = 一律拒绝**（不是「不限制」——本仓库吃过「空 = 不限制」的亏）。
>
> 格式：`- <id> (参数1, 参数2, …) [target=参数名]`

### D.1 已开放（每条都**必须**有影响面预演）

- launchConfig.dropTable (projectPath, category)
- official.sendMessage (projectPath, chatType, chatId, content, options?) [target=chatId]
- stateStore.clearAll (projectPath)

**闸门**：附录 D 里的每一条，都必须在 `src/main/services/ai/capabilityImpact.ts` 里登记估算器；
**算不出来就不许提案**（`estimateImpact` 返回 null → 构造提案时直接抛错）。

> 为什么 `dropTable` 现在能开：它的伤害是「整表删除」，而预演会把它变成
> **「将删除配置表「monsters」的全部 12,847 行（整表删除，不可恢复）」** ——
> 用户看到的是数字，不是「一次删除」。这正是我上一轮说的门槛：
> ★★★ 的问题不是「没确认」，是**确认时不知道会删多少**。
>
> `stateStore.clearAll` 同理：预演会说清「将清空 N 个状态键与 M 个会话」。
>
> 为什么先开它 / 仍然不开其它：
> · `official.sendMessage`：有界（一条消息 + 一个 chatId），群发风险由 target 白名单挡；
> · `launchConfig.dropTable` / `stateStore.clearAll`：**影响面可用同步查询算准**，数字能摆给用户看；
> · **仍然不开** `ssh.deploy`（远程主机上发生什么，本机算不出来）、
> `launchData.deletePlayer` / `deleteRecord`（要先能算「这个人有多少条关联数据」）、
> `plugin.install`（第三方代码，影响不可枚举）、`backup.restore` / `dataTransfer.import*`
> （覆盖式写入，要先算「会覆盖多少行/哪些文件」）。
> 它们缺的不是开关，是**一个算得准的估算器**。

## 八、本表已知的边界

- 层归属是**建议值**，最终以人工复核为准；`Q` 与 `R` 的边界（"应用注入" vs "模型主动取"）
  取决于第 2 步的上下文预算实测，不是纯理论。
- 上表的计数来自 `preload/index.ts` 静态抽取；其中 `official.*` / `ssh.*` 的多行签名
  曾被我的抽取脚本误判为"无通道"，**已逐条核对确认是接好的**，未计入异常。
- 未做的事：没有改任何代码；没有跑真实模型；没有验证第 2 步的上下文预算数字。
