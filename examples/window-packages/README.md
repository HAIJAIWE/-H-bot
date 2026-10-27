# 外部窗口包（示例）

第 73 批（P4 加载器 v1）的示例目录。把整个 `demo.compact/` 目录拷到：

```
<userData>/plugins/windows/demo.compact/manifest.json
```

Windows 上 `<userData>` 一般是 `%APPDATA%\qqbat`。重启应用后，设置 → 智能体窗口 的下拉里会出现「演示窗口（外部包）」。

## 清单字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 目前只认 `1` |
| `id` | 是 | `/^[a-z][a-z0-9.-]{2,47}$/`，目录名建议与它一致 |
| `name` | 是 | 下拉里显示的名字，1–60 字符 |
| `version` | 是 | 形如 `1.0.0` |
| `layout` | 是 | `compact`（紧凑单列）或 `full`（常规间距） |
| `order` | 否 | 0–100000，缺省 5000；想当默认就写比 1000 小的数 |
| `parts` | 否 | `{ header?, messages?, composer? }` 布尔，省略 = 画 |
| `description` | 否 | ≤200 字符，仅说明用 |

v1 **不执行任何第三方代码**：清单里不能有 JS，界面由宿主自己的组件画。可执行窗口包（带 `entry` 的 worker 沙箱）是 P4b。
