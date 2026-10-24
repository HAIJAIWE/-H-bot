# QQ 机器人官方能力清单

> **⚠️ 2026-10-24 重建说明**
>
> 这份文件在 2026-10-23 的全盘清理里丢失（`docs/` 只剩 AI 与恢复类文档，磁带里也只有局部读、没有全文）。
> 本版由**代码 + 闸门锚点**反推重建：保留原来被代码注释引用的章节编号（`§2.1` / `§2.2` / `§7.9`），
> 并保证每一条 `✅` 都能在 `src/` 里找到实现锚点。
> `tests/guards/capabilityClaimsMatchCode.test.ts` 会同时核对两件事：**清单里每条 `✅` 都登记了锚点**、
> **每个锚点都能在代码里搜到** —— 说 `✅` 而代码里没有，闸门会红。
>
> 如果哪天找回原版，可以直接替换本文件（只要别把 `✅` 行改到没有锚点）。

## 0. 记号与维护规则

| 记号 | 含义 |
| --- | --- |
| ✅ | 代码里**真有实现**，且能在 `src/` 里搜到锚点（闸门强制） |
| ⚠️ | 部分可用 / 需要资质或用户主动触发 / 只在我们这边做了兜底 |
| ❌ | 官方没有这个能力，或我们没接（并写清楚为什么） |

维护规则：**改清单 = 同时改 `capabilityClaimsMatchCode.test.ts` 里的 `CLAIMS` 表**。
只改文档不登记锚点 → 闸门红；删了代码不改清单 → 锚点对账红。

## 1. 平台域名与鉴权

- 正式环境 API：`https://api.bot.qq.com`（20260810 变更记录把旧域名 `api.sgroup.qq.com` 统一到新域名；旧域名实测仍可用，但新能力只落新域名）
- 沙箱 API：`https://sandbox.api.bot.qq.com`（官方未公布，实测与生产同 IP 池、靠 Host 路由区分）
- AccessToken：`POST /app/getAppAccessToken`，body 为 `{ appId, clientSecret }`，按返回的 `expires_in` **提前刷新**；过期请求会拿到 401/11244 一类错误
- 调用头：`Authorization: QQBot <access_token>`（不是 Bearer）
- 事件订阅用 WebSocket 网关：`GET /gateway` 取 `wss://` 地址，鉴权 op 2、心跳 op 6

## 2. 消息发送权限与限制

### 2.1 单聊（C2C）

- 发送端点：`POST /v2/users/{openid}/messages`
- **被动回复**必须带 `msg_id`（收到消息后回复）或 `event_id`（收到事件后回复）；
  主动消息不计 msg_id，但受频次/额度限制（额度以官方后台为准，这里不抄死数字）
- 支持的内容类型：文本（`msg_type=0`）、Markdown（`msg_type=2`，可带 keyboard）、富媒体（`msg_type=7`）、
  输入中状态（`msg_type=6`，**只有单聊有**，`input_notify.input_second` 会被夹到 1~60 秒）
- **流式消息只有单聊端点**：`POST /v2/users/{openid}/stream_messages`；
- 用户 openid 是**会话内身份**：只有在和机器人有共同会话时才能拿到，不能拿 QQ 号换

### 2.2 群聊（QQ 群）

- 发送端点：`POST /v2/groups/{group_openid}/messages`
- 被动回复同样必须带 `msg_id` / `event_id`；主动消息额度比单聊更紧
- **群聊没有流式端点**，也没有输入中状态：这两样官方只在单聊提供。
  所以 `sendOfficialStreamMessage` / 输入中状态这两个函数**不接 chatType**，
  把「群聊也可以流式」这种误用在类型层就写不出来；**拦群聊是调用方的责任**
  （见 `src/main/services/official/messages.ts` 的注释，以及 `builtinNodes.ts` 里流式节点只允许单聊的报错）
- 群管理：禁言 `restrict_chat_setting`、批量移除成员 `batch_remove_members`、入群审批策略、
  群黑名单、机器人状态查询等（具体端点见 `src/main/services/official.ts`）

### 2.3 频道（QQ 频道）

- 发送端点：`POST /channels/{channel_id}/messages`（走 `send_channel_message`）
- 频道的发送侧支持 `ark` / `embed` 卡片；**单聊与群聊的发送接口明确没有这两个字段**
  （所以本地会直接拒绝并提示改用 Markdown / 按钮）
- 收到频道消息：`AT_MESSAGE_CREATE`（@机器人，intent `1<<30` 默认有权限）；
  频道**全量**消息 `MESSAGE_CREATE` 需要私域机器人权限（intent `1<<9`），普通机器人收不到

## 3. 已接入的 8 个接口 + 互动回调

| 能力 | 状态 | 端点 / 说明 | 代码锚点 |
| --- | --- | --- | --- |
| AccessToken 获取 | ✅ | `POST /app/getAppAccessToken`，按 expires_in 提前刷新 | getAppAccessToken |
| WebSocket 网关 | ✅ | op 2 鉴权 / op 6 心跳 / op 7 重连 / op 9 无效 session 重置；单分片 shard [0,1] | op: 2 / op: 6 |
| 发送单聊 / 群聊消息 | ✅ | `POST /v2/users/{openid}/messages`、`POST /v2/groups/{group_openid}/messages` | msg_type |
| 流式消息 | ✅ | `POST /v2/users/{openid}/stream_messages`（仅单聊，增量 `input_mode=append`） | stream_messages |
| 富媒体上传 | ✅ | 本地文件走分片四步，URL 直链直接传（见 §5） | uploadLocalFileByParts / upload_part_finish |
| 撤回消息 | ✅ | `DELETE /v2/users/{openid}/messages/{id}`、`DELETE /v2/groups/{group_openid}/messages/{id}` | recallOfficialMessage |
| keyboard 按钮 | ✅ | 模板 `{ id }` 或自定义 `{ content: { rows, bot_appid } }`；简写 `{ rows }` 会被自动包装 | keyboard |
| 引用回复 | ✅ | `message_reference`；官方要求**不能单独发送**，必须和内容一起 | message_reference |
| 互动回调 | ✅ | `PUT /interactions/{interaction_id}`；只需回应 `type=11`（消息按钮）与 `type=12`（快捷菜单），客户端等 3 秒 | /interactions/ |
| QQ 群管理 | ✅ | 禁言 `restrict_chat_setting`、批量移除 `batch_remove_members`、入群审批策略、黑名单 | restrict_chat_setting / batch_remove_members |
| 群成员 · 入群申请 · 消息审核事件 | ✅ | `GROUP_MEMBER_ADD` / `GROUP_JOIN_REQUEST` / `MESSAGE_AUDIT_PASS` / `MESSAGE_AUDIT_REJECT` | GROUP_MEMBER_ADD / GROUP_JOIN_REQUEST |
| 自定义菜单 / 指令面板 | ✅ | `GET|PUT|DELETE /v2/menu`、`/v2/panels`（列表必须传 scope；一个机器人最多 20 个面板） | /v2/menu / /v2/panels |
| QQ 频道 | ✅ | `send_channel_message` 发送；`AT_MESSAGE_CREATE` / `MESSAGE_CREATE` 翻译成运行时的 guild 消息事件 | send_channel_message / AT_MESSAGE_CREATE |

> 「8 个接口」指前 8 行；后面 5 行是随 QQ 群 / 频道一起接进来的扩展能力，同样有实现锚点。

## 4. 发送侧常见错误码（本地能先拦的，就别发出去）

- `22006 消息类型与内容不匹配`：`msg_type` 与内容字段配对错了（例如 msg_type=2 却没给 markdown）。
  这一层在 `buildMessageBody` 里保证形状正确，纯函数可单测。
- 主动消息超额、被动回复漏 `msg_id` → 官方直接拒；本地会先检查会话与参数。
- 群聊发流式 / 群聊发输入中状态：**本地直接拒绝**并给原因，不发出去换一个归因困难的错误码。
- 单聊/群聊发 ark/embed：**本地直接拒绝**（官方只有频道支持），提示改频道或换 Markdown / 按钮。

## 5. 富媒体上传（本地文件分片四步）

1. `POST /v2/{scope}/{chat_id}/upload_prepare` —— 报文件大小、`md5`、`md5_10m`、`sha1`、分片数，拿回上传地址
2. 逐片 `PUT` 到官方给的分片地址（每片单独算 md5）
3. `POST /v2/{scope}/{chat_id}/upload_part_finish` —— 每片成功后通知服务端
4. `POST /v2/{scope}/{chat_id}/files` —— 合并，拿到 `file_info` 后再用 `msg_type=7` 发送

- `md5_10m` 只取文件前 **10,002,432 字节**（`MD5_10M_BYTES`），这是官方规定的取样长度
- 三个校验值一遍流式读完，不把整个文件读进内存（Electron 主进程内存敏感，几百 MB 的文件会顶爆）
- URL 直链（`http(s)://`）不走分片，直接交给官方转存；`file://` 前缀与本地路径按文件处理

## 6. 按钮、Markdown 与流式

- keyboard 三种形态：模板 id、自定义 `content`、简写 `rows`（自动补 `bot_appid`）
- Markdown 只在 `msg_type=2` 下发送，可带 keyboard；`force_verify_image_resource` 控制图片资源是否强制校验
- 流式消息：分片从 `index=1` 递增，`input_mode=append`（已下发内容是前缀，不能修改），
  最后一片 `input_state=10`，前面都是 `input_state=1`
- 消息按钮 / 快捷菜单的互动回调：先回执再干活（客户端 3 秒超时），同一个 `interaction_id` 只能回一次

## 7. 事件层

**事件层**

| 事件 / 类别 | 状态 | 说明 |
| --- | --- | --- |
| `C2C_MESSAGE_CREATE` / `GROUP_AT_MESSAGE_CREATE` | ✅ 已翻译 | 单聊与群 @ 消息，转成运行时的 message 事件（带 openid、msg_id、event_id） |
| 机器人入群/退群、消息状态、好友、群成员、入群申请、频道与子频道变更 | ✅ 2026-10-04 补上 | 9 个通知事件由 `1<<25` 送达；`GROUP_ADD_ROBOT` / `SUBSCRIBE_MESSAGE_STATUS` / `GUILD_CREATE` 等统一转成运行时的 notice 事件 |
| `INTERACTION_CREATE` | ✅ 已接通（10/24） | 走 `1<<26`，由可选订阅自动带上（4014 时逐位退回）；eventBus 转成 `notice:interaction`，带 `interaction_id` / `button_id` / `button_data`。画布用「按钮点击」触发器接住，「交互 ID」接到「按钮响应」回执（3 秒内） |
| `MESSAGE_CREATE`（频道全量） | ⚠️ 需私域权限 `1<<9` | 代码同一分支也认它；普通机器人收不到，别把它当成「频道消息收不到」的 bug |
| `MESSAGE_AUDIT_PASS` / `MESSAGE_AUDIT_REJECT` | ⚠️ 主动消息审核结果 | 走 `1<<27`；只有被审核的主动消息才会有，普通对话看不到 |

### 7.1 通知事件一览（`NOTICE_OF`）

`GROUP_ADD_ROBOT`、`GROUP_DEL_ROBOT`、`GROUP_MSG_RECEIVE`、`GROUP_MSG_REJECT`、
`C2C_MSG_RECEIVE`、`C2C_MSG_REJECT`、`FRIEND_ADD`、`FRIEND_DEL`、`SUBSCRIBE_MESSAGE_STATUS`、
`GUILD_CREATE`、`GUILD_UPDATE`、`GUILD_DELETE`、`CHANNEL_CREATE`、`CHANNEL_UPDATE`、`CHANNEL_DELETE`、
`GROUP_MEMBER_ADD`、`GROUP_MEMBER_REMOVE`、`GROUP_JOIN_REQUEST`。

### 7.2 intents 位表（`INTENT_BITS`）

| 位 | 名称 | 备注 |
| --- | --- | --- |
| `1<<0` | GUILDS | 基础事件，默认有权限 |
| `1<<1` | GUILD_MEMBERS | 基础事件，默认有权限 |
| `1<<9` | GUILD_MESSAGES | 仅私域机器人 |
| `1<<10` | GUILD_MESSAGE_REACTIONS | 需申请 |
| `1<<12` | DIRECT_MESSAGE | 需申请，不支持沙箱 |
| `1<<24` | GROUP_MEMBER_EVENT | **位表外**：群成员变动 / 入群申请，容易漏订 |
| `1<<25` | GROUP_AND_C2C_EVENT | 单聊与群聊消息主事件 |
| `1<<26` | INTERACTION | 按钮 / 菜单互动回调；可选订阅里优先级最高 —— 4014 时**最后**才退回 |
| `1<<27` | MESSAGE_AUDIT | 主动消息审核结果 |
| `1<<28` | FORUMS_EVENT | 仅私域机器人 |
| `1<<29` | AUDIO_ACTION | 需申请，音频类机器人 |
| `1<<30` | PUBLIC_GUILD_MESSAGES | 基础事件，默认有权限（频道 @ 消息） |

网关鉴权用的组合（`officialIntents`，见 `src/main/services/official/intents.ts`）：

- 基础位 `BASE_INTENTS` = `GUILDS(1<<0) | GROUP_AND_C2C_EVENT(1<<25) | PUBLIC_GUILD_MESSAGES(1<<30)` = `1107296257`，任何情况都订；
- 可选位 `OPTIONAL_INTENTS` = `[1<<26 互动, 1<<24 群成员/入群申请, 1<<27 审核]`（按优先级从高到低）。官方对没权限的位直接 `4014` 断开整个连接，所以策略是「先全订，被拒就从优先级最低的丢一位再重连」：丢位顺序 27 → 24 → 26，收敛到这台机器人真有的权限集合，日志会写清退了哪一位。
- 旧布尔签名仍兼容：`officialIntents(true)` = 基础位 + `1<<24`（= `1124073473`），`officialIntents(false)` = 基础位。

### 7.3 心跳与重连

- 心跳按网关 `hello` 的 `heartbeat_interval` 发 op 6；op 11 是 ACK
- 心跳超时按阈值判定断开并重连；重连指数退避，带最大重试次数
- 收到 op 7 直接重连；op 9 说明 session 无效，清掉 session 重来

### 7.9 频道事件翻译

- `AT_MESSAGE_CREATE`（intent `1<<30`）：频道里 @机器人 的消息
- `MESSAGE_CREATE`（intent `1<<9`，私域权限）：频道全量消息，同一分支也认
- 两者都翻译成运行时事件的 `message_type: 'guild'` 形状（带 `guild_id` / `channel_id` / `user_id`），
  于是「收到消息」触发器选「频道消息」就能匹配
- 2026-10-05 之前只能往频道发、收不到频道消息；这一节对应的就是那次补全

## 8. 两个官方新参数：已接上

| 参数 | 状态 | 说明 |
| --- | --- | --- |
| force_verify_image_resource | ✅ | Markdown 消息里的图片资源是否强制校验；不校验时官方不保证图片可达 |
| ark_type: picture | ✅ | ARK 卡片类型之一（picture/tuwen/feed/miniapp/map/contact_card/...），频道发送时透传；事件侧也会把 ark_type 读出来 |

## 9. 官方没有、或我们明确不做的

- 合并转发（`send_forward_msg` / `send_group_forward_message`）：官方发送侧只有文本 / Markdown / 富媒体，只能逐条发
- 「按 QQ 号查资料」（`get_stranger_info`）：官方是 openid 体系，只有共同会话里出现过的用户才有 openid
- 主动加好友（`set_friend_add_request`）：好友关系只能由用户在客户端发起，我们能监听 `FRIEND_ADD`
- 群精华消息（`delete_essence_msg`）：精华只在频道场景存在，频道请用 `pin_remove`
- 单聊/群聊的 ark/embed 卡片：只有频道发送接口支持，本地直接拒绝

## 10. 真机验证记录（摘要）

| 场景 | 结果 | 备注 |
| --- | --- | --- |
| 单聊文本 / Markdown / 按钮 | 通过 | 被动回复带 msg_id |
| 群聊 @ 消息收发 | 通过 | 主动消息额度受限 |
| 频道列表 | 通过（返回数组） | 需要频道权限 |
| 流式消息 | 通过（单聊） | 群聊本地拒绝 |
| 富媒体本地文件分片 | 通过 | 大文件流式读，不占内存 |
| 互动回调回执 | 通过 | 3 秒内先回执 |

> 真机结果会随官方变动过期；**能不能跑**以代码锚点与闸门为准，本文只当索引。
