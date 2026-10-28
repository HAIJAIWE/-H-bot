# 外部窗口包（示例）

把整个包目录拷到（Windows 上 `<userData>` 一般是 `%APPDATA%\qqbat`）：

```
<userData>/plugins/windows/<包目录>/manifest.json
```

重启应用后，设置 → 智能体窗口 的下拉里就会出现它。示例：

| 目录 | 说明 |
|---|---|
| `demo.compact/` | 第 73 批：纯声明式窗口，清单里没有任何 JS |
| `demo.executable/` | 第 74 批：带 `entry.js` 的可执行窗口，跑在 Blob module worker 里 |

## 清单字段（声明式窗口）

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 目前只认 `1` |
| `id` | 是 | `/^[a-z][a-z0-9.-]{2,47}$/`，目录名建议与它一致 |
| `name` | 是 | 下拉里显示的名字，1–60 字符 |
| `version` | 是 | 形如 `1.0.0` |
| `layout` | 是 | `compact`（紧凑单列）或 `full`（常规间距）；可执行窗口可省，缺省 `compact` |
| `order` | 否 | 0–100000，缺省 5000；想当默认就写比 1000 小的数 |
| `parts` | 否 | `{ header?, messages?, composer? }` 布尔，省略 = 画 |
| `description` | 否 | ≤200 字符，仅说明用 |

## 可执行窗口包（第 74 批）

在清单里加一行 `"entry": "entry.js"` 就切换成可执行窗口。多出来的字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `entry` | 是 | 包内**单层**相对文件名，`.js` / `.mjs`，≤256 KB |
| `capabilities` | 否 | 允许请求的动作数组：`send-message` / `stop` / `select-thread` |

### 运行方式与安全边界

- 源码由主进程按规则读成字符串（路径穿越、符号链接逃逸、体积上限都在主进程挡住），
  渲染层用 `new Worker(URL.createObjectURL(new Blob([source])), { type: 'module' })` 跑。
- worker 里**没有 DOM、没有 Node、不能 import**（Blob 没有 base URL），只能收发消息。
- 宿主 → worker：`{ type: 'init', apiVersion, packageId, capabilities }`、
  `{ type: 'context', context }`（只读会话快照）。
- worker → 宿主：`{ type: 'view', view: { root } }`（白名单节点树，宿主画）、
  `{ type: 'command', command, payload? }`（必须先在 `capabilities` 里声明）。
- 视图协议见 `src/shared/plugins/windowView.ts`；节点类型只有
  `stack / header / text / message / list / button / divider / empty`，
  深度 ≤6、节点 ≤300、文本 ≤4000 字符，超出的部分被截断或丢弃（不会白屏）。

### 最小入口

```js
self.onmessage = event => {
  const msg = event.data
  if (msg && msg.type === 'context') {
    self.postMessage({
      type: 'view',
      view: { root: { type: 'text', content: '消息数：' + msg.context.messages.length } },
    })
  }
}
```

（`self.postMessage` 的入参就是上面说的 `view` / `command` 两种消息。）

## 管理已装的包（第 75 批）

设置 → 智能体窗口 → 「已安装的窗口包」面板。列表里的每一行是一个包：

| 列 | 说明 |
|---|---|
| 名称 / id | 清单里的 `name`，后面灰色是包 `id` |
| 版本 | 清单里的 `version` |
| 状态 | 已启用 / 已禁用 |
| 操作 | 禁用 / 启用（同一个按钮，按当前状态切换）、卸载（行内二次确认） |

面板底部还有一块「问题」：**清单坏了的目录**会连 manifest 的绝对路径和错在哪一起列出来。
它们不在上面的列表里 —— 扫盘给它们的身份是一行问题，不是一个可管理的包（没有可用的 id、
也不知道声明是否合法，拿什么去禁用），见下面「已知限制」。

三个动作都只改盘上的东西，不碰包里的内容：

- **禁用** = 在这个包目录里写一个空的 `.disabled` 标记文件。加载器扫到带标记的包就跳过
  （不注册窗口），**目录和文件都还在**；面板上的「启用」就是把那个文件删掉。
  禁用状态**跟着包走**：把整个目录拷到另一台机器，`.disabled` 一起过去，那边也是禁用的。
- **卸载** = 删掉整个包目录（`<userData>/plugins/windows/<包目录>`），不可撤销。
- **重新扫描** = 再读一遍目录（手工拷了新包进去，不用重启应用）。

### 已知限制

- **清单坏了**的包（JSON 解析失败 / 字段不合法）不在上面的列表里 —— 它没有可管理的身份，
  只会出现在面板底部的「问题」里，带 manifest 的绝对路径。要清掉它：按那条路径去文件管理器
  删掉目录，或者把清单改好再点「重新扫描」。
- 面板只出现在设置 → 智能体窗口 里，还不是独立的插件管理页。

