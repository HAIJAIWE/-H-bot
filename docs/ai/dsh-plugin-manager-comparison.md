# DSH 插件管理器对照笔记（2026-10-19）

读的是 `deepseek-ai/deepseek-harness` 的 `packages/boot/plugin-manager`（MIT）。本文只记录**已读到的**内容，
未读部分明确标注；所有结论都可以回到源文件核对。

## 0. 读了什么、怎么读的

| 文件 | 读法 | 结论可信度 |
|---|---|---|
| `README.md`（28KB） | 全文 | 高（用户可见语义） |
| `types.ts`（13KB） | 全文（去注释后约 4.8KB） | 高（模型即类型） |
| `index.ts`（53KB） | **只读公开成员签名**（21 个） | 中（知道有哪些操作，不知道内部实现） |
| `patch.ts`（4.3KB） | 前 2.4KB（`flatten`、`writePluginEnabled`） | 中高（核心写覆盖逻辑） |
| `operations.ts`（33KB） | **只读导出签名** | 低-中（知道有 pnpm 操作，细节未读） |
| `tools.ts` / `registry.ts` / `run-tree.ts` / `install-spec.ts` / `build-approval.ts` / `failure.ts` / `install-failure.ts` / `github-connection.ts` / `official-install-target.ts` | 只读导出签名与首行注释 | 低-中 |

**没做**：逐行读 `index.ts` / `operations.ts` 的实现。所以"他们内部怎么保证一致性"这类问题，本文不回答。

## 1. 他们的模型（从类型和签名能确认的）

### 1.1 组合 = 多行 + 覆盖，且**地址能力**是显式的

```ts
type PluginInfo = PluginInventoryEntry & (
  | { patchId: string; readOnlyReason?: never }   // 存在于 patch → 可启停
  | { patchId?: never; readOnlyReason: ReadOnlyReason } // 不可寻址 → 只读
)
type ReadOnlyReason = 'management-required' | 'unaddressable'
```

这不是"界面故意不给开关"，而是**数据结构上没有可写的 id**：没有 `patchId` 就无法表达"改哪一行"。
`management-required` 指"要走 `plugin_manager` 工具/管理端才能改"，`unaddressable` 指"根本不在可编辑的组合里"。

### 1.2 变更结果不是 ok/false，而是有语义的状态机

```ts
interface ChangeResult {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  restartReason?: 'no-hmr' | 'package-moved' | 'host-module' | 'unmanaged-plugin' | 'module-comparison'
  stage: 'install' | 'enable' | 'remove'
  target: string
  error?: ManagementError
  warnings?: string[]
  packageResult?: PackageResult
  pendingBuilds?: string[]
  approvedBuilds?: string[]
  registries?: Registry[]
  failedAt?: 'registry' | 'spec-host'
}
```

关键在 `application`：**"改了但被覆盖"（overridden）和"需要重启"（restart-required）是两种不同的真实结果**，
不是二值成功/失败能表达的。

### 1.3 错误是**闭合枚举**，不是自由字符串

```ts
code: 'management-required' | 'unaddressable' | 'unknown-plugin' | 'invalid-spec'
    | 'already-installed' | 'ambiguous-install' | 'not-bundle' | 'not-removable'
    | 'stop-profile' | 'bundle-in-use' | 'stale-approval' | 'incompatible-version' | 'operation-error'
diagnostic?: string
incompatible?: IncompatiblePlugin[]
```

安装失败另有分类（`PluginInstallFailureKind`）：`pnpm-missing / timeout / not-found / no-matching-version /
network / disk-full / permission / build-blocked / integrity / unknown`，由 `classifyInstallFailure` 从
退出方式与 `ERR_PNPM_*` 输出推断（`install-failure.ts`）。

### 1.4 安装 = 解析 → 检视 → 安装 → 构建审批

- `InstallSpecKind = 'registry' | 'path' | 'git' | 'tarball'`（`install-spec.ts`）；
- `inspect(spec)` 返回 `accepted`（带 kind/name/version/bundle 判定）或 `refused`（`invalid-spec /
  already-installed / not-found / not-a-package / not-bundle / network / unknown`）；
- 安装是**两步审批**：`InstallBundleOptions.approvedBuilds`，失败时回报 `pendingBuilds`；
  `build-approval.ts` 把 pnpm 的待批准脚本名写入/读出 workspace 设置；
- 注册表顺序与失败归因单独成文件（`registry.ts`：官方源 + 镜像 + `attributeFailure`）。

### 1.5 Bundle 是组合单位，插件是行

`BundleInfo` 有 `official / availability('installation'|'profile'|'missing') / installTarget /
rows: BundleRowInfo[] / overrides: string[] / enabled / installed / optional / removable /
readOnlyReason / error`。启停**两层**：`setBundleEnabled` 与 `setPluginEnabled`。

### 1.6 兼容性是**可豁免**的，但豁免本身是一次受控操作

`listVersionExemptions()` 与 `setVersionExemption(packageVersion, runtimeVersion, enabled, acceptRisk?)`：
不兼容不是硬拒绝，而是一个**要显式接受风险**的覆盖。这与我们"不兼容不许强行启用"是两种取舍。

### 1.7 写覆盖：与组合结果比较后**最小化**

`patch.ts` 的 `writePluginEnabled`：读 `cordis.patch.yml`（YAML AST，保留注释）→ 找到最后一条匹配覆盖 →
**如果 bundle 层与其余 patch 已经给出相同的 disabled 值，就删掉/不追加这条覆盖**。
即：patch 文件恒等于"与默认的差集"。

### 1.8 AI 也能管：与界面共用同一个服务

`tools.ts`：`export const inject = ['tools', 'pluginManager', 'sandboxPolicy']`，
把同一个 `PluginManager` 暴露成代理工具；是否放行由 sandboxPolicy（危险权限/逐次审批）决定。

## 2. 我们现在的模型

| 能力 | 我们的实现 | 位置 |
|---|---|---|
| 清单身份 | `PluginIdentity` + `validatePluginIdentity`（id/name/version/permissions/requires） | `src/shared/plugins/manifest.ts` |
| 版本范围 | `satisfiesPluginRange`（>=,<=,^,~,=，fail-closed） | `src/shared/plugins/version.ts` |
| 渲染层贡献 | 插槽注册 + 可撤销 + localStorage disabled | `renderer/lib/plugins/api.ts` |
| 主进程贡献 | 工具/提示 + 权限 + cleanup + 兼容性 | `main/services/plugins/host.ts` |
| 沙箱装载 | `ai:true` 判别 → `plugin:loadAi` → 硬化 vm → activate → 代理工具 | `sandboxPlugin{Adapter,Bridge,Activator}` + `aiPluginLoader` |
| 启停 | 同一个 `plugin:setEnabled`：先 AI 后节点 | `ipc/plugins.ts` |
| 安装记录 | 渲染层 localStorage 记**目录**，启动重放（幂等） | `PluginManager.tsx` |
| 会话预设 | `.qqbat/agent-presets.json` 工具白名单，显式 > 预设 > 全量 | `services/ai/presets.ts` + composer |

**结构性问题只有一个**：我们没有"默认"这个概念 —— 所以没有覆盖、没有最小化、没有"当前等于默认可删"。
其余是功能缺口（来源/审批/失败分类/管理工具）。

## 3. 差距表与取舍

| 他们的机制 | 我们 | 决定 | 理由 |
|---|---|---|---|
| patchId 可寻址 vs 只读 | 无 | **采纳语义** | 只读要有**结构原因**，不能只是按钮置灰 |
| 最小化覆盖 | 无 | **采纳** | 否则配置文件会漂成"历史操作日志" |
| `ChangeResult.application` 多态 | ok/false + 中文字符串 | **采纳**（简化版） | "改了但被覆盖""需要重启"必须能表达 |
| 错误闭合枚举 | 自由字符串 | **采纳** | 界面要能按 code 给不同动作（重试/换源/批准构建） |
| 安装 spec 四种来源 + inspect | 只有本地目录 | **部分采纳**（path + git） | registry/tarball 依赖包管理器生态，我们暂无 |
| 构建审批 | 无 | **采纳**（沙箱脚本审批） | 我们的"构建"= 装载前确认来源与内容哈希 |
| Bundle 两层启停 | 只有插件 | **暂不采纳** | 我们没有 bundle 概念；先做插件级，等真有分组需求 |
| 版本豁免（接受风险） | 不兼容硬拒绝 | **暂不采纳** | 我们的不兼容=沙箱 API 不匹配，运行起来就是坏；豁免没有安全收益 |
| YAML AST + 注释保留 | 无 | **不采纳** | 我们配置是 JSON，没有注释可保 |
| HMR / 重启原因 | 无（运行时装载） | **不采纳** | 架构不同：他们是构建期组合，我们是运行时装沙箱 |
| pnpm/registry/GitHub 探测 | 无 | **不采纳** | 我们不分发 npm 包 |
| AI 管理工具 | 无 | **后置** | 先有稳定 IPC 语义，再做工具 |

## 4. 目标：我们版"基础插件功能"

### Phase A —— 层 + 可寻址 + 最小覆盖（先做，不依赖任何新来源）

数据：

```jsonc
// .qqbat/plugins.patch.json
[
  { "id": "ai.demo", "disabled": true }   // 只记与默认不同的项
]
```

```ts
interface PluginLayerEntry { id: string; disabled?: boolean }
function compose(defaults: PluginLayerEntry[], overrides: PluginLayerEntry[]): PluginLayerEntry[]
function writeOverride(defaults, overrides, id, enabled): PluginLayerEntry[] // 与默认相同 → 删除该条
function addressability(entry): { patchId } | { readOnlyReason: 'management-required' | 'unaddressable' }
```

验收：
1. 默认启用的插件停用 → patch 只多一条；再启用 → patch 恢复空；
2. 手改坏 patch → 容错回默认（读失败 = 空覆盖）；
3. 只读项没有 patchId → 启停入口按 code 拒绝并给出原因文案。

### Phase B —— 来源 + 内容哈希 + 装载审批

- 安装记录从"目录字符串"升级为 `{ dir, entrySha256, source: 'path'|'git' }`；
- 首次装载 / 哈希变化 → 走审批（复用既有 approval 通道）；拒绝即不装；
- `ChangeResult` 简化版：`{ changed, application: 'applied'|'restart-required'|'failed'|'cancelled', error?: { code, diagnostic? } }`。

### Phase C —— 失败分类 + 管理工具

- 失败码：`manifest_invalid | entry_missing | kind_conflict | incompatible | sandbox_timeout | permission_denied | not_found | operation_error`；
- 管理工具挂在 `fullAccess` 或逐次审批下（对应他们的 `management-required`）。

## 5. 不做什么（避免"照抄"）

- 不引入 Cordis 的组合/服务模型；
- 不抄 YAML/AST/pnpm/GitHub/registry 代码；
- 不把 `ChangeResult` 的全部字段照搬（只保留我们真能填的）；
- 不做 bundle 两层启停与版本豁免（没有对应问题）。

## 6. 一句话

值得学的是他们的**语义纪律**：可寻址才可写、覆盖等于差集、变更结果要能表达"被覆盖/需重启"、
错误闭合并可驱动不同动作、安装前先检视并审批。实现机制（cordis/pnpm/YAML/HMR）属于他们的分发方式，
不是我们的问题。
