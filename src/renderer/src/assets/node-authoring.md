# 写一个自定义节点

> **30 秒版**：在项目的 `plugins/` 下建一个目录，放 `manifest.json` + `index.js`；
> `index.js` 导出一个 `nodes` 数组，每个节点带一个 **handler 函数源码字符串**。
> 保存即生效（**不用重启应用**），节点随即出现在画布的节点库里。
>
> 能跑的最小例子：[docs/examples/plugins/hello-world](examples/plugins/hello-world/index.js) —— 直接复制走。

> **术语（2026-10-10 澄清）**
>
> · **自定义节点** = **内容**：一个新的动作。用户拿到的是它。
> · **节点包**（过去的叫法：插件包）= **包装**：`plugins/<名字>/` 这个目录，
> 用来**分发 / 安装 / 启用停用**一组节点。一个包可以装**多个**节点。
>
> 界面上**只出现「自定义节点」**；「插件」这个词只在本文件里作为**包的实现方式**出现 ——
> 过去两者混着叫，是让人困惑的根源。

---

## 1. 这解决什么问题

画布上的节点来自「节点库」。往库里加节点有两条路：

| 方式                   | 适合                                           | 代价                 |
| ---------------------- | ---------------------------------------------- | -------------------- |
| 改应用源码里的内置节点 | 通用能力、要跟所有人共享                       | 要改应用、要发版     |
| **节点包（本文）**     | 某个项目专有的逻辑；写流程写到一半发现缺个节点 | **不改应用、不重启** |

节点包是**项目级**的：`<项目>/plugins/` 里的节点只属于那个项目。

---

## 2. 目录结构

```
<你的项目>/
└─ plugins/
   └─ hello-world/            ← 目录名随意，建议和 manifest.name 一致
      ├─ manifest.json        ← 元信息（必填）
      └─ index.js             ← 入口（文件名由 manifest.entry 指定）
```

生成物里的**其他目录不受影响**：扫描器只认「**带 manifest.json 的子目录**」，
散落的 `.ts`/`.js` 文件不会被当成插件。

---

## 3. `manifest.json`

| 字段          | 必填 | 类型     | 说明                           |
| ------------- | ---- | -------- | ------------------------------ |
| `name`        | ✅   | string   | 插件名                         |
| `version`     | ✅   | string   | 版本号（如 `1.0.0`）           |
| `entry`       | ✅   | string   | 入口文件名，如 `index.js`      |
| `description` |      | string   | 说明                           |
| `permissions` |      | string[] | 权限声明（数组，元素为字符串） |

```json
{
  "name": "hello-world",
  "version": "1.0.0",
  "entry": "index.js",
  "description": "示例插件：把名字格式化成一句问候",
  "permissions": []
}
```

> 任一必填项缺失或类型不对 → 加载时报「manifest 验证失败」，并说明是哪一项。

---

## 4. `index.js`

CommonJS，导出含 `nodes` 数组的对象：

```javascript
module.exports = {
  name: 'hello-world',
  version: '1.0.0',
  description: '示例插件',
  nodes: [/* 见下 */],
};
```

### 节点字段

| 字段                 | 必填 | 说明                                                                                          |
| -------------------- | ---- | --------------------------------------------------------------------------------------------- |
| `kind`               | ✅   | 节点标识，**包内唯一**。写**裸名**（如 `greet`）—— **不要自己加 `plugin_` 前缀**（见下方 ⚠️） |
| `type`               | ✅   | `trigger` \| `action` \| `logic` \| `data` \| `ai` \| `plugin` \| `custom`                    |
| `label`              | ✅   | 画布上显示的名字（中文）                                                                      |
| `handler`            | ✅   | **函数表达式源码字符串**，见第 6 节                                                           |
| `icon`               |      | emoji                                                                                         |
| `group`              |      | 节点库里的分组（如 `'自定义'`）                                                               |
| `description`        |      | 节点说明                                                                                      |
| `defaultConfig`      |      | 默认配置对象（键 = 你在 handler 里读的 `ctx.config.<键>`）                                    |
| `inputs` / `outputs` |      | 端口数组，见第 5 节                                                                           |

> ⚠️ **`kind` 写裸名，前缀交给框架**（2026-10-16 澄清，别再自己拼）
>
> 你在 `index.js` 里写的 `kind` 是**包内的名字**（如 `greet`）。
> 节点在画布/流程里的**完整 kind** 由框架按 `plugin_<插件目录名>_<你写的 kind>` 拼出来 ——
> 例：目录 `hello-world` + `kind: 'greet'` → **`plugin_hello-world_greet`**。
>
> **不要自己拼前缀**：写成 `plugin_hello-world_greet` 会被框架**再拼一次**，
> 变成 `plugin_hello-world_plugin_hello-world_greet`。这种节点能跑（画布与运行时仍然一致），
> 但名字与文档/工具里说的对不上，排查时格外费劲 —— 以前这份文档就是这么教的，已改。
>
> 另外：**`ai-` 开头的目录名是保留的**（表示这个包是 AI 生成的节点，框架会把它归到「AI 生成」分组）。

### 端口

```javascript
{ id: 'name', name: '名字', kind: 'data', dataType: 'string' }
```

| 字段                                   | 说明                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `kind`                                 | `'control'`（流程连线）或 `'data'`（数据连线）                          |
| `id`                                   | **数据端口的值会以这个 id 出现在 `ctx.inputs` 里**；返回对象也用这些 id |
| `dataType`                             | `string` / `number` / `event` …                                         |
| `required` / `description` / `default` | 可选                                                                    |

> 不传 `inputs`/`outputs` 时，节点只有一个控制端口 `in`/`out`。

---

## 5. handler 的 `ctx` 契约

handler 必须写成**匿名函数表达式**，签名固定为 `async (ctx) => { ... }`：

```javascript
async (ctx) => {
  const city = String(ctx.config.city || ctx.inputs.city || '');
  ctx.log('查询天气', city);
  await ctx.callBuiltin('message_send', { message: '晴 25°C' }); // 需要发消息时
  return { result: city + '：晴 25°C' };
};
```

### `ctx` 提供什么

| 字段                          | 说明                                               |
| ----------------------------- | -------------------------------------------------- |
| `ctx.config`                  | **节点配置**（用户在画布上填的 + `defaultConfig`） |
| `ctx.inputs`                  | **上游数据端口的值**，按端口 `id` 取               |
| `ctx.bot`                     | 协议端 API：`await ctx.bot.callApi(名称, 参数)`    |
| `ctx.event`                   | 触发事件（触发器节点会用到）                       |
| `ctx.projectPath`             | 当前项目根目录                                     |
| `ctx.log(...)`                | 写日志（**调试节点时第一个该用的东西**）           |
| `ctx.callBuiltin(kind, 配置)` | **调用任意内置节点** —— 复用已有能力的最快方式     |

**返回值**：对象的 **key 必须与 `outputs` 的端口 id 一致** —— `return { message: '...' }`
对应端口 `{ id: 'message' }`。

### 沙箱限制（重要）

handler 运行在 **vm 沙箱**里：

- ❌ 没有 `require` / `process` / `Buffer` / `fs` —— **只能用 `ctx`**
- ⚠️ `ctx.callBuiltin` 与 `ctx.bot.callApi` **必须 `await`**。handler 返回后再用会报
  「调用上下文已结束」
- ⚠️ **不要在加载期起定时器**（模块顶层不要 `setTimeout`）—— 加载期回调不会触发；
  需要延时请放在 handler 里

---

## 6. 完整示例

[docs/examples/plugins/hello-world](examples/plugins/hello-world/index.js)：

```javascript
module.exports = {
  name: 'hello-world',
  version: '1.0.0',
  description: '示例插件：把名字格式化成一句问候',
  nodes: [
    {
      // 写**裸名**；框架拼出来的完整 kind 是 plugin_hello-world_greet（见第 4 节的 ⚠️）
      kind: 'greet',
      type: 'action',
      label: '打招呼（示例）',
      icon: '👋',
      group: '自定义',
      description: '把名字格式化成一句问候；配置 greeting 可改前缀。',
      defaultConfig: { greeting: '你好' },
      inputs: [
        { id: 'in', name: '入', kind: 'control' },
        { id: 'name', name: '名字', kind: 'data', dataType: 'string' },
      ],
      outputs: [
        { id: 'out', name: '出', kind: 'control' },
        { id: 'message', name: '问候语', kind: 'data', dataType: 'string' },
      ],
      handler: `async (ctx) => {
  const name = String(ctx.inputs.name || ctx.config.name || '世界');
  const greeting = String(ctx.config.greeting || '你好');
  ctx.log('打招呼', name);
  return { message: greeting + '，' + name + '！' };
}`,
    },
  ],
};
```

**用起来**：把 `hello-world` 整个目录复制到 `<你的项目>/plugins/` 下。

---

## 7. 生效方式

`plugins/` 目录有**监听器**：新增/修改插件包会被自动发现并重新加载，**不需要重启应用**。
节点加载失败会在界面上报错（并带 `manifest 验证失败` / 加载失败等具体原因）。

---

## 8. 常见错误对照

| 现象                       | 原因                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| 节点没出现                 | `manifest.json` 缺 `name`/`version`/`entry`；或 `entry` 的文件名与实际文件不一致            |
| 「manifest 验证失败」      | 必填项缺失/类型不对；`permissions` 不是字符串数组                                           |
| 节点出现了，一执行就报错   | `handler` 不是**匿名函数表达式**（例如写成了具名函数声明）；或返回的 key 与端口 `id` 不一致 |
| 「调用上下文已结束」       | `ctx.callBuiltin` / `ctx.bot.callApi` **没 await**                                          |
| `require is not defined`   | 沙箱没有 `require` —— 要用的能力走 `ctx`                                                    |
| 加载期 `setTimeout` 不触发 | 加载期不要起定时器，延时逻辑放进 handler                                                    |

---

## 9. 契约的权威位置（改契约时要注意）

本文档是**人类版**；同一份契约还给 AI 用（`create_ai_node`）。改任何一条都要两处一起改：

| 位置                                             | 是什么                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `src/shared/types/plugin-sdk.ts`                 | `PluginNode` / `PluginPackage` / `PluginManifest` 类型           |
| `src/main/services/plugins/pluginDirContract.ts` | **准入判据**（目录 + manifest.json，不看目录名）、目录名前缀分类 |
| `src/main/services/plugins/pluginScanner.ts`     | manifest 校验、插件加载、入口沙箱编译                            |
| `src/main/runtime/sandbox.ts`                    | 硬化沙箱（null 原型上下文、禁代码生成、JSON 桥）                 |
| `src/main/runtime/dynamicHandlers.ts`            | handler 编译执行、`ctx` 构造、`validateHandlerSource`            |
| `src/main/services/ai/context.ts`                | **给 AI 的同一份契约文本**                                       |

> 本文档里的示例由 `tests/main/services/plugins/pluginAuthoringExample.test.ts`
> **真实加载并执行** —— 示例或契约失效，测试会红。这就是防止这份文档变成"说了假话"
> 的机制（2026-10-02 删除的「导出为可读 TypeScript」正是反面教材：承诺和实现对不上，
> 且没有任何东西会告诉你）。
