# 第 54 批交接：预设导入的自动备份与一键撤销

> 写于 2026-10-26。基线：`E:\H Bot 制造`，分支 `main`，HEAD `679ce6a`（第 53 批提交），工作树干净。
> 这份文档是给**新会话**用的：读完直接实现，不需要回看旧会话。
> 旧会话只做到勘察与设计，源码一行没改。

## 0. 一页速览

| 项       | 内容                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目标     | 预设导入成功后，能一键恢复到导入前的**精确字节**；导入后又被改过则拒绝撤销                                                                                         |
| 范围     | 只备份 `.qqbat/agent-presets.json`；只保留最近一次“有实际变化”的导入                                                                                               |
| 不做     | 多级历史、redo、强制覆盖、备份默认预设文件、跨窗口锁、分享文件签名                                                                                                 |
| 新增文件 | `src/shared/ai/presetUndo.ts`、`src/main/services/ai/presetUndo.ts`、`PresetUndoDialog.tsx` + 测试                                                                 |
| 主要改动 | `presetShare.ts`（服务/类型）、`aiPresets.ts`、`schemas/ai.ts`、`preload/index.ts`、`types/ipc.ts`、`aiAgentCore.ts`、`AgentPresetMenu.tsx`、`ChatPanel.tsx`、i18n |
| 能力账   | 新增 `ai.undoPresetImport = X`，总数 278 → 279                                                                                                                     |
| 验收     | 导入→撤销后 sha256 与导入前一致；手改后撤销拒绝且不写盘；无变化导入不产生新撤销点；界面可完成全流程                                                                |

## 1. 前提与环境

- 仓库：`E:\H Bot 制造`（不是 `D:\QQ bot`；后者是空目录）。
- 分支 `main`，本批基线 HEAD `679ce6a`。
- 当前 dev 可能在跑：后台 job `pwsh-dbf344af39324dc9`，CDP 端口 `43191`。**改源码前必须先停 dev、杀 electron、确认 43191 空闲**，否则 Windows 会锁文件（`ReplaceFileW EIO (Win32 32)` / Vite `EBUSY`）。
- 起 dev 前要清环境变量：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:QQBAT_CDP_PORT = '1'
node node_modules/electron-vite/bin/electron-vite.js dev
```

- 基线闸门（第 53 批结束时全绿）：
  - `node node_modules/typescript/bin/tsc -p tsconfig.node.json` → 0
  - `node node_modules/typescript/bin/tsc -p tsconfig.web.json` → 0
  - `node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2` → 15 文件 / 107 例
  - 全量 `node node_modules/vitest/vitest.mjs run --maxWorkers=2` → **276 passed | 2 skipped（278 文件）、3493 passed | 7 skipped（3500 例）**
- 本批新增用例后，全量应是“3493 + 新增数”，不要拿旧数字交差。
- 注意：`run_code` 里 `process.execPath` 是 Electron，跑 vitest 会报 disk cache 且无输出；**必须用 `tools.pwsh` 执行 `node ...`**。

## 2. 当前行为与缺口

第 53 批已经做完导入导出：

1. 导出：`buildPresetShare` 只导用户自定义预设，写分享 JSON。
2. 导入：`pickPresetShare` 选文件并预览 → `importPresetShare` 重新解析原文 → 同名冲突检查 → 整表合并 → `writePresets` 覆盖 `.qqbat/agent-presets.json`。
3. 界面：冲突时整次拒绝，勾选“覆盖同名项”才继续；导入前可看预览。

缺口：

- 整表重写是**不可逆**的。用户导入错文件、导入了别人的整表、同名覆盖掉了自己的预设，当前只能手动找备份。
- 同名的旧内容被直接替换，没有任何旧值留存。
- 项目目录不一定在 git 里，不能指望 `git checkout`。
- 第 53 批的“整次拒绝”只防了“没勾覆盖”的情况；勾了覆盖之后仍然是全量替换。

最朴素的补法：**写之前把旧文件原样存一份，导入成功后提供一个“撤销上次导入”**。不要做版本历史，先解决“手滑一次能回去”。

## 3. 语义定案（实现时不要改）

### 3.1 “导入”指什么

指一次**成功且有实际变化**的 `importPresetShare`：

- 通过解析、冲突检查；
- `added > 0` 或 `replaced > 0`；
- `writePresets` 成功。

“有实际变化”是必要条件：如果 `added === 0 且 replaced === 0`，不写盘、不产生新撤销点，返回 `unchanged: true`，保留上一个撤销点。理由：没改文件却把“上次导入”的撤销点换掉，会让用户失去真正的回退能力。

### 3.2 撤销恢复到哪

恢复到**这次导入开始前**的 `.qqbat/agent-presets.json` 原始字节，不是“按名字删掉这次新增的条目”。

为什么按字节：

- 导入是整表重写，新增/替换/排序都可能变；按名字反推不可靠。
- 原文可能带 BOM、不同的换行、用户手写的缩进；重新 `JSON.stringify` 会改变格式，虽然语义相同，但不是“回到原样”。
- 用 base64 存原始 Buffer，撤销时原样写回；同时存 sha256 用于校验。

### 3.3 只保留一级

- 撤销点文件只有一个：`.qqbat/agent-presets.undo.json`。
- 第二次有变化的导入会覆盖第一次的撤销点；没有“再撤销回第二次”的 redo。
- 不建立历史目录、不按时间戳存多份。理由：这是“手滑急救”，不是版本控制；多级会引入清理、配额、界面选择等一整摊事。

### 3.4 撤销前必须校验当前文件

记录里存 `afterSha256`（导入完成时 presets 文件的哈希）。撤销前重算当前文件哈希：

- 相等：说明导入后没人动过，可以恢复。
- 不相等：说明导入后用户又编辑/删除了 presets，**拒绝撤销**，一个字都不写。
- 文件不存在：当前哈希视为 `null`；只有记录里 `afterSha256` 也是 `null` 才可能相等，但正常导入后文件一定存在，所以实际会拒绝。

这条是安全底线：绝不能用“旧备份”覆盖用户后来的编辑。

### 3.5 旧文件本来不存在

第一次导入前项目里没有 `agent-presets.json` 是合法的（第 53 批允许空表/只有内置）。记录 `previousExisted: false`，撤销 = 删除 `agent-presets.json`，而不是写一个空数组。这样“回到导入前”是真的没有文件。

### 3.6 只备份 presets，不备份默认预设文件

导入只新增/替换预设，不删除预设；默认预设名（`.qqbat/agent-preset-default.json`）仍然能解析。撤销恢复预设表后，默认名仍指向同一条（内容回到旧值）。因此本批**不备份默认文件**，也不在撤销时改默认选择。

边界：如果用户在导入后手动改了默认预设，撤销不会动它；这是有意的，撤销只负责“导入这件事”。

### 3.7 撤销点写失败怎么办

顺序是：先写 presets，再写撤销点。最坏情况是“导入成功，但撤销点没写成”。

- 导入仍返回成功（数据已经写进去了，不能谎报失败）。
- 但必须**删掉旧撤销点**（best effort），否则界面会把更早的撤销点当成“上次导入”，而它的 `afterSha256` 对不上当前文件，虽然会被校验拦住，但提示会误导。
- 返回 `undoProblem`，界面提示“这次导入没有留下撤销点”。

### 3.8 并发

- 界面在请求期间禁用导入/撤销按钮。
- 本批**不加跨进程锁**，跨窗口同时导入不在范围（与现有 `savePresets` 一致）。
- 如果以后要加，在 `presetUndo.ts` 里做一个模块级串行队列即可，不要动 `writePresets` 的签名。

## 4. 数据形状

### 4.1 新共享文件 `src/shared/ai/presetUndo.ts`

```ts
export const PRESET_UNDO_FILE = '.qqbat/agent-presets.undo.json'
export const PRESET_UNDO_VERSION = 1

/** 磁盘上的撤销点；只由主进程读写，不进分享文件 */
export interface PresetUndoRecord {
  version: 1
  createdAt: string // ISO
  action: 'import'
  sourceName?: string // 用户选的分享文件名，仅展示
  previousExisted: boolean
  previousSha256: string | null
  previousBase64: string | null
  afterSha256: string
  added: number
  replaced: number
  total: number
}

/** 给界面的状态；problem 表示有记录但读不出来 */
export interface PresetUndoState {
  available: boolean
  createdAt?: string
  sourceName?: string
  added?: number
  replaced?: number
  total?: number
  previousExisted?: boolean
  problem?: string
}

export interface PresetUndoResult {
  restored: true
  removed: boolean // 撤销前是否存在 presets 文件；true=删掉了，false=写回了
  createdAt: string
  added: number
  replaced: number
  total: number
}
```

### 4.2 `PresetImportResult` 扩展

在 `src/shared/ai/presetShare.ts` 里：

```ts
import type { PresetUndoState } from './presetUndo'

export interface PresetImportResult {
  added: number
  replaced: number
  total: number
  /** 没有任何实际变化：没写盘、没换撤销点 */
  unchanged: boolean
  /** 这次导入成功后留下的撤销点（正常情况） */
  undo?: PresetUndoState
  /** 导入成功但撤销点没写成；界面要提示 */
  undoProblem?: string
}
```

现有调用方只有 `PresetImportDialog` → `ChatPanel.onImported`；返回值加字段是向后兼容的，但测试里的对象字面量要补 `unchanged`。

### 4.3 磁盘记录校验规则

- 缺文件 → `{ available: false }`（没有 problem，这是正常“没有可撤销的导入”）。
- JSON 坏 / 顶层不是对象 → problem。
- `version !== 1` → problem。
- `action !== 'import'` → problem。
- `previousExisted === true` 时，`previousSha256` 必须是 64 位小写 hex，`previousBase64` 必须是非空字符串。
- `previousExisted === false` 时，两个 previous 字段必须是 `null`。
- `afterSha256` 必须是 64 位小写 hex。
- 记录合法后还要读当前 presets：哈希必须等于 `afterSha256`；不等时返回 `{ available: false, problem: '导入之后预设文件又被改过，撤销已失效' }`，不要给一个点了才报错的按钮。
- `added/replaced/total` 必须是非负整数。

撤销时如果记录坏了，抛“撤销点读不出来…”并拒绝；不要自动删除坏记录（用户可能想留证据），下一次成功导入会覆盖它。

## 5. 文件级方案

### 5.1 新增 `src/main/services/ai/presetUndo.ts`

建议导出：

```ts
import { createHash } from 'node:crypto'
import { readFile, rm } from 'fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../infra/fileOps'
import { PRESETS_BASENAME } from '@shared/ai/presetRoster'
import {
  PRESET_UNDO_FILE,
  PRESET_UNDO_VERSION,
  type PresetUndoRecord,
  type PresetUndoResult,
  type PresetUndoState,
} from '@shared/ai/presetUndo'

export interface PresetUndoCapture {
  previousExisted: boolean
  previousSha256: string | null
  previousBase64: string | null
}

export async function capturePresetUndo(projectPath: string): Promise<PresetUndoCapture>
export async function writePresetUndoPoint(
  projectPath: string,
  capture: PresetUndoCapture,
  meta: { sourceName?: string; added: number; replaced: number; total: number },
): Promise<PresetUndoState>
export async function readPresetUndo(projectPath: string): Promise<PresetUndoState>
export async function undoPresetImport(projectPath: string): Promise<PresetUndoResult>
export async function clearPresetUndo(projectPath: string): Promise<void>
```

内部私有：

- `presetsPath(projectPath)` = `join(projectPath, '.qqbat', PRESETS_BASENAME)`。
- `undoPath(projectPath)` = `join(projectPath, PRESET_UNDO_FILE)`（注意 `PRESET_UNDO_FILE` 已带 `.qqbat/`）。
- `sha256Hex(buf: Buffer): string`。
- `readRawOrNull(file): Promise<Buffer | null>`（ENOENT 返回 null，其他错误抛）。
- `loadRecord(projectPath): Promise<{kind:'missing'} | {kind:'ok', record} | {kind:'corrupt', reason}>`。
- `toState(record): PresetUndoState`。

关键行为：

| 函数                   | 行为                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capturePresetUndo`    | 在写 presets **之前**读旧字节；ENOENT → `previousExisted:false`；其他读错直接抛（导入中止，宁可不导也不做无备份的写）                                                 |
| `writePresetUndoPoint` | 在写 presets **之后**读当前字节；文件不存在 → 抛；组装 `PresetUndoRecord`；`atomicWrite(undoPath, JSON.stringify(record, null, 2) + '\n')`；返回 `toState(record)`    |
| `readPresetUndo`       | 缺文件 → `{available:false}`；坏记录 → `{available:false, problem}`；记录合法但当前文件哈希 ≠ afterSha → `{available:false, problem}`；正常 → `{available:true, ...}` |
| `undoPresetImport`     | 读记录 → 校验当前 afterSha → 校验 previousSha → 写回/删除 → 复核 → 删记录 → 返回结果                                                                                  |

### 5.2 改 `src/main/services/ai/presetShare.ts`

在 import 里加 `capturePresetUndo / writePresetUndoPoint` 和 `PresetUndoState` 类型。

`importPresetShare` 在现有冲突检查、`added/replaced` 计数之后：

```ts
const total = byName.size
if (added === 0 && replaced === 0) {
  return { added: 0, replaced: 0, total, unchanged: true }
}
const capture = await capturePresetUndo(projectPath)
await writePresets(projectPath, [...byName.values()])
let undo: PresetUndoState | undefined
let undoProblem: string | undefined
try {
  undo = await writePresetUndoPoint(projectPath, capture, {
    sourceName,
    added,
    replaced,
    total,
  })
} catch (e) {
  undoProblem = e instanceof Error ? e.message : String(e)
  await clearPresetUndo(projectPath).catch(() => {})
}
return {
  added,
  replaced,
  total,
  unchanged: false,
  ...(undo ? { undo } : {}),
  ...(undoProblem ? { undoProblem } : {}),
}
```

说明：

- `sourceName` 加在函数第 4 个参数（可选），由 IPC 从 `pick.fileName` 传；服务层不信任它做路径，只展示。
- `presetShare.ts` 不拼路径；用 `presetUndo.ts` 导出的 `clearPresetUndo(projectPath)`。`presetUndoPath` 保持内部私有，避免路径知识散在两处。
- 如果 `writePresets` 抛错：什么都不返回，旧撤销点保留。它指向更早状态，但 `undoPresetImport` 的 afterSha 校验会拦住错误恢复；安全。
- 如果 `capturePresetUndo` 抛错：导入中止，presets 没动。

### 5.3 IPC 与 schema

`src/main/schemas/ai.ts`：

```ts
export const aiPresetImportSchema = z.object({
  projectPath: z.string().min(1),
  text: z.string().max(PRESET_SHARE_MAX_BYTES * 2),
  overwrite: z.boolean(),
  sourceName: z.string().max(200).optional(),
})
```

`src/main/ipc/aiPresets.ts` 加第四条：

```ts
ipcMain.handle('ai:undoPresetImport', async (_event, args: unknown) => {
  const parsed = aiProjectPathSchema.safeParse(args)
  if (!parsed.success) return { ok: false, error: '参数校验失败: ' + parsed.error.message }
  return tryIpcAsync(() => undoPresetImport(parsed.data.projectPath))
})
```

`ai:importPresets` 的调用改成：

```ts
importPresetShare(
  parsed.data.projectPath,
  parsed.data.text,
  parsed.data.overwrite,
  parsed.data.sourceName,
)
```

### 5.4 preload 与渲染层类型

`src/preload/index.ts`：

- `importPresets(projectPath, text, overwrite, sourceName?)`，invoke 载荷必须是**对象字面量**且永远带 `sourceName` 键：

```ts
importPresets: (projectPath, text, overwrite, sourceName) =>
  ipcRenderer.invoke('ai:importPresets', { projectPath, text, overwrite, sourceName }),
```

- 新增：

```ts
undoPresetImport: projectPath =>
  ipcRenderer.invoke('ai:undoPresetImport', { projectPath }),
```

- `PresetImportDialog.confirm` 的调用改成 `importPresets(projectPath, pick.text, overwrite, pick.fileName)`。

为什么必须永远带 `sourceName`：`tests/guards/ipcPayloadContract.test.ts` 用正则只认紧跟通道名的对象字面量；条件表达式/展开会被判“找不到载荷”（第 50 批踩过）。

`src/renderer/src/types/ipc.ts`：

- import type 加 `PresetUndoState, PresetUndoResult`。
- `importPresets(projectPath, text, overwrite, sourceName?): Promise<{ok:true;data:PresetImportResult}|{ok:false;error:string}>`。
- `undoPresetImport(projectPath): Promise<{ok:true;data:PresetUndoResult}|{ok:false;error:string}>`。
- `getPresets` 返回类型加 `undo?: PresetUndoState`。

### 5.5 `ai:getPresets` 带撤销状态

`src/main/ipc/aiAgentCore.ts` 的 handler 当前在 :202-215：

1. `readPresetRoster`；
2. 有 threadId 时 `readPresetSession` 加 `session`。

加 2-3 行：

```ts
const undo = await readPresetUndo(projectPath)
if (!parsed.data.threadId) return { ok: true, data: { ...roster, undo } }
const session = await readPresetSession(projectPath, parsed.data.threadId)
return { ok: true, data: { ...roster, session, undo } }
```

注意这个文件 961 行、基线 916（+45，未过 10%）；**只加这几行**，别把对话框逻辑塞进来。

### 5.6 界面

#### `AgentPresetMenu.tsx`

- 加 `undo: PresetUndoState | undefined` state，在 `getPresets` effect 里 `setUndo(data.undo)`；重新加载时清空。
- props 加 `onUndoPresetImport?: (undo: PresetUndoState) => void`。
- 动作区（编辑/导出/导入之后）加按钮：

```tsx
{
  undo && (undo.available || undo.problem) ? (
    <button
      type="button"
      disabled={disabled || !undo.available || !projectPath || !onUndoPresetImport}
      title={undo.problem ?? t('ai.preset.undoTitle')}
      className={rowClass}
      onClick={() => {
        closeMenu()
        onUndoPresetImport?.(undo)
      }}
    >
      {t('ai.preset.undoAction')}
    </button>
  ) : null
}
```

- `undo.problem` 时按钮禁用并靠 `title` 说明；也可在按钮下方加一行琥珀小字（二选一，不要既禁用又不给原因）。
- 没有撤销记录（`undo?.available === false` 且无 problem）不显示按钮。

#### `ChatPanel.tsx`

- state：`const [undoTarget, setUndoTarget] = useState<PresetUndoState | null>(null)`。
- 菜单传 `onUndoPresetImport={setUndoTarget}`。
- 挂 `<PresetUndoDialog open={!!undoTarget} undo={undoTarget} ... />`。
- 导入成功回调 `onImported(result)`：

```ts
setPresetEpoch(v => v + 1)
if (result.unchanged) toast.info(t('ai.preset.importUnchanged'))
else if (result.undoProblem)
  toast.warning(t('ai.preset.undoUnavailable', { reason: result.undoProblem }))
else toast.success(t('ai.preset.importResult', { n: String(result.total) }))
```

- 撤销成功：`toast.success(t('ai.preset.undoDone'))`、`setUndoTarget(null)`、`setPresetEpoch(v => v + 1)`。

#### 新 `PresetUndoDialog.tsx`

建议约 100 行，复用 `ui/Modal`、`ModalFooter`、`Button`：

- 标题：撤销上次导入
- 正文：
  - 导入时间：`createdAt`（本地化）
  - 来源文件：`sourceName ?? '（未记录）'`
  - 这次导入：新增 `added` / 替换 `replaced` / 共 `total` 条
  - 将恢复到：`previousExisted ? '导入前的预设表' : '导入前的状态（没有预设文件）'`
  - 警告：只保留最近一次；导入后改过预设会拒绝。
- 确认按钮：调 `window.qqbat.ai.undoPresetImport(projectPath)`。
  - 成功：`onUndone(res.data)` 后关闭。
  - 失败：对话框内红字显示 `res.error`，不关闭，允许重试或取消。
- 取消按钮：关闭，不改任何文件。

#### i18n

`src/renderer/src/i18n/zh-CN.json` / `en-US.json` 各加约 10 个 key（放在现有 `ai.preset.*` 段）：

- `undoAction`：撤销上次导入… / Undo last import…
- `undoTitle`：只保留最近一次有变化的导入；导入后又改过预设会拒绝 / Only the latest changed import is kept…
- `undoDialogTitle`
- `undoHint`
- `undoTime`
- `undoSource`
- `undoCounts`（插值 added/replaced/total）
- `undoRestoreTo`
- `undoConfirm` / `undoing`
- `undoDone`
- `undoUnavailable`（插值 reason）
- `importUnchanged`
- `importUndoReady`（可选，导入成功提示“可撤销”）

注意插值用**单花括号**（项目 i18n 约定），不要写 `{{n}}`。

### 5.7 测试计划

新增 `tests/main/services/ai/presetUndo.test.ts`（建议 9 例）：

1. 没有记录：`readPresetUndo` → available false 且无 problem；`undoPresetImport` 抛“没有可撤销”。
2. 导入前不存在：capture `previousExisted:false`；写 presets 后写撤销点；undo 删除文件并删除记录。
3. 精确恢复：旧文件用非标准缩进/无结尾换行；导入后 undo，读回的 Buffer 与原字节 sha256 相同。
4. 导入后手改：read → available false + problem；undo 抛“又被改过”，文件内容不变，记录仍在。
5. 坏记录 JSON：read → problem；undo 抛“读不出来”，不写盘。
6. 记录里 previousSha 与 base64 不符：undo 抛“备份损坏”，不写盘。
7. 无变化导入：不写 presets、不新建撤销点，旧记录保留。
8. 撤销点写失败：导入仍成功，返回 `undoProblem`，旧撤销点被清掉（可用 mock `atomicWrite` 抛错）。
9. 撤销后记录被删除，再撤销得到“没有可撤销”。

`presetShare.test.ts` +2：

- 导入后结果带 `undo.available=true`、计数与 `sourceName`。
- 无变化导入返回 `unchanged:true` 且不覆盖前一个撤销点。

`aiPresets-ipc.test.ts` +3（mock `@main/services/ai/presetUndo`，补 `undoPresetImport`；`aiAgentCore-ipc.test.ts` 的 `getPresets` 断言补 `undo`，默认 `readPresetUndo` 返回 `{available:false}`）：

- `ai:undoPresetImport` 调用服务并返回结果。
- 非法 projectPath 不调服务。
- `ai:importPresets` 把 `sourceName` 作为第 4 参传给服务。

新 `PresetUndoDialog.test.tsx`（3 例）：显示 counts/source；确认调 API 并回调；失败留在对话框显示错误。

`AgentPresetMenu.test.tsx` +3：有 available 时显示“撤销上次导入…”并回调；无记录不显示；problem 时禁用且有 title。

`PresetImportDialog.test.tsx`：如果断言了返回对象，补 `unchanged:false`；如果没断言，可不动。

### 5.8 守卫与能力台账

- `tests/guards/projectWritesViaFileOps.test.ts`：登记新 `src/main/services/ai/presetUndo.ts`。若只用 `atomicWrite` + `rm`，按实际 `rm(` 调用数登记（预计 `{ rm: 2 }`：删 presets + 删撤销点）；理由写“应用自有数据：导入撤销点/恢复预设，路径由应用拼”。如果直接 `writeFile` 写记录，则再加 `writeFile: 1`。
- `tests/guards/ipcPayloadContract.test.ts`：`ai:undoPresetImport` 用 `aiProjectPathSchema.shape`；`ai:importPresets` 的 schema 已加 `sourceName`，预加载荷键要完全一致。
- `tests/guards/ipcSurfaceParity.test.ts`（若存在）：preload 新方法、handler、types 三处同名。
- 能力台账 `docs/ai/ai-capability-layering-2026-10-08.md`：
  - 附录 A 加 `ai.undoPresetImport = X`。
  - ai 行 53 → 54；X 78 → 79；合计 278 → 279；X+⛔ 81 → 82；附录小计 279。
  - 跑 `node scripts/gen-capability-catalog.mjs`，生成两份 279 条。
- 文件行数/死导出/孤儿 i18n：新增导出必须都有生产调用点；新 key 必须都被界面用到。

## 6. 关键实现细节

### 6.1 sha256 与 base64

```ts
function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
```

- 存 `previousBase64 = buf.toString('base64')`。
- 恢复时 `Buffer.from(record.previousBase64, 'base64')`。
- 读回后先算哈希，必须等于 `previousSha256`；不符就拒绝（备份损坏）。
- 不要用文本读再写：`readFile(path, 'utf-8')` 会做解码/替换，BOM 和非法字节都可能变。

### 6.2 atomicWrite 的用法

`src/main/services/infra/fileOps.ts:132` 的 `atomicWrite(filePath, content)`：

- 只接受绝对路径；内部会 `mkdir(dirname)`。
- 写临时文件再 rename；失败会清理临时文件。
- 文件是 `@ts-nocheck`，`content` 可以传 Buffer；内部 `writeFile(tmp, content, 'utf-8')` 对 Buffer 不会转码。
- 恢复旧 presets 用 `atomicWrite(presetsPath, previousBuf)`；写撤销点用 `atomicWrite(undoPath, JSON.stringify(record, null, 2) + '\n')`。
- 撤销点文件删除用 `rm(undoPath, { force: true })`。

### 6.3 撤销流程（逐字）

```ts
export async function undoPresetImport(projectPath: string): Promise<PresetUndoResult> {
  const loaded = await loadRecord(projectPath)
  if (loaded.kind === 'missing') {
    throw new Error('没有可撤销的导入（只保留最近一次，而且导入后又改过预设会失效）')
  }
  if (loaded.kind === 'corrupt') {
    throw new Error('撤销点读不出来：' + loaded.reason + '；为免写坏预设，这次没有撤销')
  }
  const record = loaded.record
  const current = await readRawOrNull(presetsPath(projectPath))
  const currentSha = current ? sha256Hex(current) : null
  if (currentSha !== record.afterSha256) {
    throw new Error(
      '导入之后预设文件又被改过（当前 sha256 ' +
        String(currentSha) +
        '，导入完成时 ' +
        record.afterSha256 +
        '）；为免覆盖你后来的改动，这次没有撤销',
    )
  }
  let previous: Buffer | null = null
  if (record.previousExisted) {
    previous = Buffer.from(record.previousBase64 ?? '', 'base64')
    if (sha256Hex(previous) !== record.previousSha256) {
      throw new Error('撤销点里的备份损坏（sha256 对不上）；为免写坏预设，这次没有撤销')
    }
  }
  if (previous) {
    await atomicWrite(presetsPath(projectPath), previous)
  } else {
    await rm(presetsPath(projectPath), { force: true })
  }
  const after = await readRawOrNull(presetsPath(projectPath))
  const afterSha = after ? sha256Hex(after) : null
  const wantSha = previous ? sha256Hex(previous) : null
  if (afterSha !== wantSha) {
    throw new Error('撤销写入后校验失败；文件可能被其他程序占用，请重试')
  }
  // 删记录失败不回滚（文件已经恢复）；readPresetUndo 会因哈希不符把它标成不可用
  await clearPresetUndo(projectPath).catch(() => {})
  return {
    restored: true,
    removed: !previous,
    createdAt: record.createdAt,
    added: record.added,
    replaced: record.replaced,
    total: record.total,
  }
}
```

错误文案可以微调，但**语义必须保留**：没有记录、记录坏、导入后又改过、备份坏、写后校验失败，要能区分。

### 6.4 记录文件的 JSON 示例

```json
{
  "version": 1,
  "createdAt": "2026-10-26T05:40:00.000Z",
  "action": "import",
  "sourceName": "同事的预设.json",
  "previousExisted": true,
  "previousSha256": "1fb6a2fd...",
  "previousBase64": "WwogIHsKICAgICJuYW1lIjog...",
  "afterSha256": "9cbb975...",
  "added": 2,
  "replaced": 1,
  "total": 6
}
```

### 6.5 为什么不在 writePresets 里做

`writePresets` 还被编辑器保存、默认预设写入等路径使用。把“备份/撤销”塞进去会让每个保存都产生撤销点，语义变成“撤销上一次保存”，不是本批要的“撤销上一次导入”。

本批只在 `importPresetShare` 这一条路径上显式 capture/write。

## 7. 界面交互（给实现者的验收脚本）

1. 打开 AI 智能体 → 预设菜单。
2. 导出当前预设为 `a.json`。
3. 把 `a.json` 改名/改内容后再导入（或直接用另一个分享文件），勾选覆盖同名项。
4. 导入成功 toast 后，菜单底部出现“撤销上次导入…”。
5. 点它 → 对话框显示时间、来源文件名、added/replaced/total、恢复目标。
6. 确认 → toast“已撤销”；菜单刷新，撤销按钮消失；presets 文件 sha256 回到导入前。
7. 再导入一次，然后手动编辑 `agent-presets.json`（加一条）→ 点撤销 → 对话框红字“导入之后预设文件又被改过…”，文件不变。
8. 没有撤销点时，菜单不显示该按钮；坏记录时显示禁用按钮 + title（或琥珀提示）。

注意：菜单的 `getPresets` 是挂载时读一次；导入/撤销后靠 `presetEpoch` 触发重挂载，不要指望 IPC 直调后菜单自动刷新。

## 8. 分阶段执行（建议 4 个提交）

### Phase A：服务与共享类型

- 新建 `src/shared/ai/presetUndo.ts`。
- 新建 `src/main/services/ai/presetUndo.ts`。
- 改 `src/shared/ai/presetShare.ts`（类型）。
- 改 `src/main/services/ai/presetShare.ts`（capture/write/unchanged）。
- 写 `presetUndo.test.ts`；补 `presetShare.test.ts`。
- 闸门：tsc node、定向测试。

### Phase B：IPC / preload / 类型

- `schemas/ai.ts` 加 `sourceName`。
- `ipc/aiPresets.ts` 加 `ai:undoPresetImport`、传 `sourceName`。
- `ipc/aiAgentCore.ts` 的 `getPresets` 加 `undo`。
- `preload/index.ts`、`renderer/types/ipc.ts`。
- 测试 `aiPresets-ipc.test.ts`；`ipcPayloadContract`。
- 闸门：tsc node/web、guards。

### Phase C：界面

- `AgentPresetMenu.tsx`、`ChatPanel.tsx`、新 `PresetUndoDialog.tsx`、i18n。
- 测试 `PresetUndoDialog.test.tsx`、`AgentPresetMenu.test.tsx`；补 `PresetImportDialog.test.tsx`。
- 闸门：tsc web、定向测试。

### Phase D：文档 / 能力 / 全量 / 真机 / 提交

- `docs/ai/agent-core-wiring.md` 追加 §54（**用 Node fs 全量读写，不要用 read 工具回读后重写**）。
- 能力台账 278→279；跑 `node scripts/gen-capability-catalog.mjs`。
- `prettier` 只格式化改动文件；如果 `register.ts` 之类被整篇重排，`git checkout` 后只贴最小改动。
- 全量 vitest。
- 真机（见 §9）。
- 提交信息建议：`feat(ai): 预设导入自动备份与一键撤销（精确字节恢复，导入后改动拒绝撤销）`。

## 9. 闸门与真机

### 9.1 命令

```powershell
# 1) 停 dev（如果开着）
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*H Bot 制造*' } | Stop-Process -Force
Get-NetTCPConnection -LocalPort 43191 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# 2) 类型
node node_modules/typescript/bin/tsc -p tsconfig.node.json
node node_modules/typescript/bin/tsc -p tsconfig.web.json

# 3) 定向
node node_modules/vitest/vitest.mjs run tests/main/services/ai/presetUndo.test.ts tests/main/services/ai/presetShare.test.ts tests/main/ipc/aiPresets-ipc.test.ts tests/renderer/components/ai/PresetUndoDialog.test.tsx tests/renderer/components/ai/AgentPresetMenu.test.tsx --maxWorkers=2

# 4) guards
node node_modules/vitest/vitest.mjs run tests/guards --maxWorkers=2

# 5) 全量（提交前一次）
node node_modules/vitest/vitest.mjs run --maxWorkers=2
```

### 9.2 真机探针

起 dev（见 §1），确认 CDP 43191 返回 200，再跑 smoke；然后用 `_recovery/cdp-eval.mjs` 直调 IPC：

1. 记下当前 `agent-presets.json` 的 sha256 与内容。
2. `window.qqbat.ai.getPresets(projectPath, 'default')` → 预期 `undo.available === false`（若之前有记录，先手动删 `agent-presets.undo.json` 并说明）。
3. 构造一个分享 JSON（`type:'qqbat-agent-presets'`、`version:1`、`presets:[...]`），调：

```js
window.qqbat.ai.importPresets(projectPath, text, false, 'probe.json')
```

预期 `{ok:true,data:{unchanged:false,undo:{available:true,...}}}`。4. 再 `getPresets` → `undo.available === true`，计数/来源名对得上。5. `window.qqbat.ai.undoPresetImport(projectPath)` → `{ok:true,data:{restored:true,...}}`；文件 sha256 回到步骤 1。6. 再导入一次；手动在 `agent-presets.json` 末尾加一条（用 Node fs，不要用 JSON.parse 重写，免得格式变化影响哈希）；调 undo → 预期 `ok:false`，error 含“又被改过”，文件不变。7. 用备份还原 `agent-presets.json` 和 `agent-presets.undo.json`，保持现场干净。8. UI：菜单截图（导入后出现撤销按钮）→ 对话框截图（计数/来源）→ 撤销后 toast 与按钮消失。参考 `_recovery/cdp-shot.mjs` / `cdp-eval.mjs`。

注意：

- `undoPresetImport` 会删撤销点；重复调用第二次应返回“没有可撤销”。
- 真实项目数据要备份再探针，探针结束还原。
- 不要留测试预设/测试撤销点。

## 10. 风险与坑

| 坑                                | 规避                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Windows 文件锁                    | 改源码前停 dev、杀 electron、放 43191                                                                           |
| read 工具截断大文档               | `docs/ai/agent-core-wiring.md` 用 Node `fs.readFileSync` 全量读 + 追加，不要用 read 的回读结果重写              |
| prettier 整篇重排                 | 只格式化改动文件；`register.ts` 等被整篇重排就 checkout 后手工贴最小 diff                                       |
| ipcPayloadContract 正则           | preload 永远传对象字面量，永远带 `sourceName` 键                                                                |
| aiAgentCore 行数                  | 只加 2-3 行；别把 undo 读逻辑/对话框塞进去                                                                      |
| 撤销点写失败                      | 导入仍成功 + `undoProblem` + 删旧撤销点                                                                         |
| 旧撤销点误用                      | `afterSha256` 校验；不匹配就拒绝                                                                                |
| 默认预设文件                      | 不备份；导入不删预设，默认名仍可解析                                                                            |
| 无变化导入                        | 不写盘、不换撤销点，返回 `unchanged`                                                                            |
| 跨窗口并发                        | 本批不做；界面禁用按钮，文档写明边界                                                                            |
| 导入写盘→撤销点落盘之间的极短窗口 | 不做锁；若外部恰好在这几毫秒改文件，afterSha 会记录外部改动，撤销会把它一起回退。本批不解决，跨窗口并发不在范围 |
| 坏记录自动删除                    | 不自动删；read 给 problem，undo 拒绝                                                                            |
| `rm` 计数                         | `projectWritesViaFileOps` 登记；`atomicWrite` 不计入                                                            |
| 能力账漂移                        | 278→279，跑生成脚本，guards 会查                                                                                |
| 测试 mock 缺导出                  | 新服务被 mock 时，hoisted 里补 `readPresetUndo/undoPresetImport`                                                |

## 11. 明确不做

- 多级历史/时间线/按次撤销。
- redo（撤销后再恢复）。
- 强制覆盖“导入后又改过”的文件。
- 备份编辑器保存、默认预设保存。
- 备份 `agent-preset-default.json`。
- 分享文件的签名/发布者身份/信任链（第 52 批只做了市场安装前检查，不是同一件事）。
- 跨窗口/跨进程锁。
- 把撤销点放进分享文件或导出。

## 12. 验收清单

- [ ] 导入成功后 `PresetImportResult.undo.available === true`，含 `createdAt/sourceName/added/replaced/total`。
- [ ] `undoPresetImport` 恢复的字节 sha256 与导入前一致；旧文件不存在时删除 presets。
- [ ] 导入后手改 presets → undo 拒绝，文件不变，错误能看懂。
- [ ] 无变化导入 → `unchanged:true`，不产生新撤销点，旧撤销点保留。
- [ ] 坏记录 → `getPresets.undo.problem` 有值，undo 拒绝且不写盘。
- [ ] 界面：有记录才显示撤销；确认对话框；成功 toast + 菜单刷新；失败留在对话框。
- [ ] 新 IPC 在 preload/types/handler 三处对齐；`ai.undoPresetImport = X` 已入能力账。
- [ ] tsc node/web 0；guards 全绿；全量 ≥ 3493 + 新增用例数。
- [ ] 真机导入→撤销→sha 一致；手改后拒绝；现场还原。
- [ ] 只改本批文件，无 prettier 大面积 churn。

## 13. 参考坐标（HEAD 679ce6a）

| 文件                                           | 位置                                                           |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `src/main/services/ai/presetShare.ts`          | 250 行；`importPresetShare` :221-250；`writePresets` 调用 :248 |
| `src/shared/ai/presetShare.ts`                 | 53 行；`PresetImportResult` :49-53                             |
| `src/main/ipc/aiPresets.ts`                    | 94 行；三个 handler :31/:55/:87                                |
| `src/main/schemas/ai.ts`                       | `aiPresetImportSchema` :118-122；`aiProjectPathSchema` :111    |
| `src/main/ipc/aiAgentCore.ts`                  | 961 行；`ai:getPresets` :202-215                               |
| `src/main/services/ai/presets.ts`              | 382 行；`writePresets` :348-382                                |
| `src/shared/ai/presetRoster.ts`                | 102 行；`PRESETS_FILE`/`PRESETS_BASENAME`                      |
| `src/renderer/.../PresetImportDialog.tsx`      | 220 行；`confirm` :76-93                                       |
| `src/preload/index.ts`                         | 导出/选文件/导入 :385-391                                      |
| `src/renderer/src/types/ipc.ts`                | 1609 行；预设方法 :560-584                                     |
| `src/renderer/.../AgentPresetMenu.tsx`         | 411 行；props :25-48；动作 :360-399                            |
| `src/renderer/.../ChatPanel.tsx`               | 1647 行；状态 :342-344；导出 :346-363；菜单 :1114-1136         |
| `src/main/services/infra/fileOps.ts`           | `atomicWrite` :132（文件带 @ts-nocheck）                       |
| `tests/guards/projectWritesViaFileOps.test.ts` | presets :563-566；aiPresets :567-570                           |
| `docs/ai/agent-core-wiring.md`                 | §53 :2816 起；§54 追加到文件尾                                 |
| `docs/ai/ai-capability-layering-2026-10-08.md` | 当前 278；新增 X 后 279                                        |

## 14. 一句话

**导入前把旧 presets 的原始字节存成 base64+sha256，导入成功后写一个一级撤销点；撤销前先确认当前文件没被改过，改过就拒绝——这样“手滑导入”能一键回去，又不会覆盖用户后来的编辑。**
