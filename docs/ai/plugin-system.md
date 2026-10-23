# 插件系统 v0.1（树内插件，2026-10-18）

> 目标：让别人（或 AI）能**写插件扩展现有面板**，而不是改 ChatPanel。
> 这一版只做**形状**：清单 + 贡献 + 注册。运行时加载第三方代码**故意不做**。

## 1. 一个插件长什么样

```tsx
// src/renderer/src/plugins/my-plugin.tsx
import { definePlugin, registerPlugin } from '../lib/plugins/api';

registerPlugin(
  definePlugin({
    manifest: { id: 'me.my-plugin', name: 'My Plugin', version: '0.1.0' },
    activate(api) {
      api.contributeSlot({
        id: 'row',                       // 插件内唯一；注册时自动带前缀 me.my-plugin.row
        slot: 'composer.toolbar',        // 位置
        order: 20,                       // 同插槽内的排序
        render: () => <span>hi</span>,   // 内容（可读 store、可发 IPC —— 见 §4）
      });
    },
  }),
);
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

| 能力 | 状态 |
|---|---|
| 贡献 UI 到四个具名插槽 | ✅ v0.1 |
| 插件清单（id/name/version/description）与列表 API | ✅ `listPlugins()` |
| 贡献工具（`registerTool`） | ✅ 主进程已有（尚未接到插件 API） |
| 贡献提示段落（`registerPromptSection`） | ✅ 主进程已有（尚未接到插件 API） |
| 运行时加载 / 权限 / 沙箱 | ❌ 下一步 |

## 5. 给 AI 开发者的一句话规则

> 插件只做两件事：**声明清单**、**往插槽里放 UI**。
> 不要读别的模块的内部状态；需要数据就通过 store 的公开字段拿。
> 会改盘/跑命令的事不要放在渲染层插件里 —— 那是主进程工具（`registerTool`）的职责。
