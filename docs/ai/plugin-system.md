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
3. **信任链**：来源校验（签名或本地路径+确认），AI 生成的代码默认不可信。

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
| 插件市场（索引 / sha256 / 安装卸载 / 回滚）                     | ✅ `market.ts` + 插件市场面板                                             |
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
