# 插件系统 v0.2（树内插件 + AI 插件包，2026-10-25）

> 目标：让别人（或 AI）能**写插件扩展现有面板**，而不是改 ChatPanel。
> 树内**渲染层**插件只做形状：清单 + 贡献 + 注册（§1–§3）；
> 第三方 AI 插件包走主进程沙箱（清单 + 权限 + 设置 + 市场，§4–§6）。

## 1. 一个插件长什么样

```tsx
// src/renderer/src/plugins/my-plugin.tsx
import { definePlugin, registerPlugin } from '../lib/plugins/api'

registerPlugin(
  definePlugin({
    manifest: { id: 'me.my-plugin', name: 'My Plugin', version: '0.1.0' },
    activate(api) {
      api.contributeSlot({
        id: 'row', // 插件内唯一；注册时自动带前缀 me.my-plugin.row
        slot: 'composer.toolbar', // 位置
        order: 20, // 同插槽内的排序
        render: () => <span>hi</span>, // 内容（可读 store、可发 IPC —— 见 §4）
      })
    },
  }),
)
```

然后在 `src/renderer/src/plugins/index.tsx` 里 import 一次（树内插件清单）。

**可用的插槽**：`composer.toolbar`（输入区底部工具条）、`composer.hint`（提示语）、
`session.header`（会话头徽标）、`panel.aside`（侧栏）。

## 2. 加了插件之后会发生什么

- `registerPlugin` 立即调 `activate(api)`；
- `api.contributeSlot` 把内容注册进 `uiSlots` 注册表，**id 自动加插件前缀**（跨插件不会撞）；
- 面板里对应的 `<AiSlot name="..."/>` 就会渲染它；
- 插件 id 重复 / 清单缺字段 → **注册期直接抛错**（宁可启动就炸，也不要两个插件悄悄互相覆盖）。

## 3. 为什么不能"运行时加载 AI 写的插件"

插件代码以**完整渲染层权限**运行：能读 store（含对话内容）、能调 `window.qqbat.*`（含写盘/跑命令的 IPC）。
在补上下面三件事之前，动态加载第三方代码 = 把用户机器和项目文件交出去：

1. **沙箱**：插件跑在受限环境（无直接 IPC，只能调宿主暴露的能力）；
2. **权限声明**：manifest 里写清"我要读会话 / 我要发 IPC / 我要写文件"，安装时逐条授权；
3. **信任链**：来源透明 + 安装前检查 + 摘要钉住 + 跨来源不静默更新（§7），AI 生成的代码默认不可信。

这三件是独立的工程（不是加个 `import()`），所以 v0.1 先固定**贡献的形状**；
等插件多了、有真实的第三方开发需求，再按上面的顺序做加载器。

## 4. 我们现在真实支持的能力面

| 能力                                                            | 状态                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 贡献 UI 到四个具名插槽                                          | ✅ v0.1                                                                   |
| 插件清单（id/name/version/description）与列表 API               | ✅ `listPlugins()`                                                        |
| 贡献工具 / 提示段落                                             | ✅ AI 插件包里通过沙箱桥 `api.registerTool` / `api.registerPromptSection` |
| AI 插件包（`plugins/ai-*/manifest.json` + 沙箱进程 + 超时隔离） | ✅ `aiPluginLoader` / `sandboxPluginBridge`                               |
| 权限声明（`permissions: ['tool','prompt']`）与管理界面展示      | ✅ `plugin.listHost()` 回传，插件管理器逐条画徽标                         |
| 参数设置（清单 `settings[]` → 表单 → 热更新）                   | ✅ 见 §6                                                                  |
| 插件市场（索引 / sha256 / 安装前检查 / 摘要钉住 / 跨来源保护）  | ✅ `market.ts` + 插件市场面板（§7）                                       |
| 树内**渲染层**插件的权限/沙箱                                   | ❌ 仍是完整渲染层权限（只装自家插件）                                     |

## 5. 给 AI 开发者的一句话规则

> 插件只做两件事：**声明清单**、**往插槽里放 UI**。
> 不要读别的模块的内部状态；需要数据就通过 store 的公开字段拿。
> 会改盘/跑命令的事不要放在渲染层插件里 —— 那是主进程工具（`registerTool`）的职责。

## 6. 插件设置（参数表单，2026-10-25）

插件清单里写 `settings`，宿主就能生成表单、校验、落盘，并把值交给插件自己读 ——
**宿主不认识任何具体键**，界面完全由清单驱动。

```jsonc
// plugins/ai-clock/manifest.json 片段
{
  "permissions": ["tool"],
  "settings": [
    {
      "key": "timezone",
      "label": "Timezone",
      "type": "select",
      "default": "local",
      "options": [
        { "value": "local", "label": "本机时区" },
        { "value": "utc", "label": "UTC" },
      ],
    },
    { "key": "loud", "label": "Loud", "type": "boolean", "default": false },
  ],
}
```

清单一侧（`src/shared/plugins/settings.ts`，主进程与渲染层共用同一份纯函数）：

- 键名 `/^[a-z][a-z0-9_]{0,39}$/`；`label` 必填；`type` ∈ `string | number | boolean | select`；
- `select` 必须带至少一个可用选项（`value` 去空去重，`label` 缺省 = `value`）；
- 坏项**静默丢弃**而不是整包失败 —— 第三方清单里一条坏字段不该让插件装不上；
- 上限 `MAX_PLUGIN_SETTINGS = 24`，文本值上限 `MAX_PLUGIN_SETTING_TEXT = 200`；
- `default` 走与用户输入同一套 `coerceOne` 校验，坏默认值丢掉，不带坏值进表单。

值怎么走：

1. **装载**：`mergeSettingValues(specs, stored)` = 出厂值 + 已存值，放进内存热缓存
   `setLivePluginSettings(pluginId, values)`；
2. **读**：沙箱桥 `api.getSetting(key)` / `api.getSettings()` **每次调用都现取**热缓存 ——
   保存后立刻生效，**不需要**重载或重启插件；
3. **存**：`<userData>/plugins/plugin-settings.json`，形状
   `{ version: 1, plugins: { [pluginId]: values } }`。插件是**应用级能力**，设置跟应用走、不跟项目走
   （与 `pluginDataDir` 的既有语义一致），所以这份不写进 `.qqbat/`；
4. **保存失败**：内存里也已是新值 —— 宁可"下次启动回到旧值"，也不要"界面说保存了、插件读到的还是旧的"；
   卸载插件时 `forgetPluginSettings(pluginId)` 清缓存，重装不会读到上一轮的值。

界面对应 `src/renderer/src/components/settings/PluginSettingsDialog.tsx`（从插件管理器行上的「设置」进入）：
`plugin.getSettings` 拿声明 + 当前值 → 按 `type` 渲染 → `plugin.saveSettings` 提交；
没声明 `settings` 的插件不显示这个按钮。

**边界**：设置是"用户填的配置"，**不是权限**。读设置不需要声明 `permission`；
`permissions` 管的是"这个插件能不能往宿主里塞工具/提示段落"。

## 7. 插件市场信任链（2026-10-26）

**先说没做的：签名。** DSH 的市场索引本身不带签名，官方源与第三方源走同一套
`sha256` 内容寻址，所谓"官方"只是**标签**、不是验证。我们照这个语义复刻，
不发明一套假签名让界面看起来更安全。

真正做的是四件事：

### 7.1 安装前检查（只读，不写盘）

`inspectMarketPlugin(id, root?)` 返回一份 `MarketInstallPlan`：

| 字段                          | 含义                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `source` / `trust` / `signed` | 来源全地址；`official` 或 `community`；`signed` 恒为 `false`（目前没有签名） |
| `version` / `requires`        | 要装的版本与兼容范围；没有兼容版本时 `version` 为 `null`                     |
| `files` / `totalBytes`        | 每个文件的路径、字节数、单文件 sha256；总体积                                |
| `digest`                      | **整包指纹**（见 7.2），确认与安装都认它                                     |
| `manifest`                    | 名称、入口、权限、设置项数量；解析失败为 `null`                              |
| `update`                      | 已装旧版时给 `{ fromVersion, fromSource, sameSource }`                       |
| `blocked`                     | 不能装的原因（已装同版本 / 本地改过 / 跨来源 / 没有兼容版本 / manifest 坏）  |

**manifest 的 `permissions` / `settings` 以前会被解析器丢掉**（市场插件声明了权限与设置，
装完却像没声明一样）；这次一并修好，检查页会按 `tool` / `prompt` 逐条显示。

### 7.2 摘要怎么算

与 `hashDirectory` 同构，保证"检查时看到的"与"装完后盘上的"可比：

1. 文件按 `path` 字典序；
2. 逐条 update：`path` → `'\0'` → 文件内容的 sha256（Buffer）→ `'\n'`；
3. 最外层再 sha256，hex 即 `digest`。

`installMarketPlugin(id, root?, expectDigest?)` 会先做同一份检查；确认摘要与当前索引不符时
直接拒绝（"索引在确认后变了……请重新检查再安装"），**一个字节都不写**。写盘并装载后还会
再算一次目录指纹，和 `plan.digest` 不一致就卸载回滚。

### 7.3 跨来源不静默更新

已装版本来自 A 源，市场里同 id 的最新版来自 B 源时，直接更新会被拦下：

> 已安装版本来自另一个来源（A），不能从 B 静默更新；请先卸载再安装。

同一来源内的版本升级正常放行，记录的 `sha256` 随新包一起变。

### 7.4 记录与界面

- 安装记录新增 `trust` / `signed`；老记录没有这两个字段时按来源回落
  （`bundled://official` → official，其余 → community，`signed: false`），不因升级读不出旧记录。
- 界面是**两段式**：点"安装/更新"只做检查，行下展开确认块（版本、来源全地址、官方/第三方、
  文件数+体积、权限、设置项、完整摘要、未签名提醒、阻塞原因），再点"确认安装"才真正写盘。
- IPC：新增只读的 `plugin:marketInspect`；`plugin:marketInstall` 的载荷变成
  `{ id, expectDigest? }`（摘要必须是 64 位小写 hex）。能力台账登记
  `plugin.marketInspect = Q`。

### 7.5 这一层的边界

- `trust` 是**展示标签**，不是安全边界：第三方源标 community，官方源标 official，
  但两者都靠摘要钉住"装的和看到的是同一份"。
- 摘要绑定的是**索引里给的内容**；索引本身被中间人换掉时，检查页会显示新的来源/摘要，
  用户看到的是"换了"而不是"悄悄通过"。
- 仍然没有：签名、发布者身份、吊销列表、差分更新。这些等有真实第三方发布需求再做。

### 7.6 测试与闸门

- `tests/main/services/plugins/market.test.ts` 15 例（原 9 + 6）：计划字段与记录摘要一致、
  本地源的权限/设置不再丢、确认摘要不符不落盘、跨来源拒绝且卸载后可装、同来源升级摘要跟着变。
- `tests/main/ipc/pluginsMarket-ipc.test.ts` 8 例：`marketInspect` 透传计划；`marketInstall`
  把 `expectDigest` 作为第三参传给服务；坏摘要 / 空 id 一次服务都不调。
- `tests/renderer/components/settings/PluginMarket.test.tsx` 7 例：两段式安装、取消不装、
  第三方来源 + 阻塞时确认按钮禁用。
- 闸门：`tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 0；guards 15 文件 / 107 例；
  全量 273 文件通过 / 3468 例通过（7 跳过），0 失败。

真机验证（CDP）：官方 Clock 的检查结果显示 `signed:false`、2 个文件 / 476 B、
摘要 `d4944a13…3d5a`；用错误摘要安装被拒绝且未写盘；用该摘要安装成功、记录 trust=official、
再检查返回"已安装版本 1.0.0"，卸载后回到未安装。
