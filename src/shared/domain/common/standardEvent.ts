// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import { PlatformIdSchema } from "./capabilities";

/**
* 标准事件（多平台统一格式）。
*
* ## 它在整条管线里的位置（接线前必须清楚这一点）
*
* ```
*   平台原始事件（QQ 官方 / 钉钉 / 飞书 / OneBot 网关 …）
*        │
*        │  ① 各适配器：平台字段 → StandardEvent（本文件的形状）
*        ▼
*   StandardEvent            ← 多平台在这里被抹平
*        │
*        │  ② 还需要**一层转换**：StandardEvent → OneBot v11 事件
*        ▼
*   FlowRuntime.handleMessage()   ← 运行时目前**只认 OneBot v11 形状**
* ```
*
* ⚠️ 第 ② 层是**必需**的，不是多余的：`FlowRuntime` 现在按 OneBot v11 的
* `post_type` / `message_type` / `sender` 等字段分发事件，全流程的节点、
* 内置函数、触发器匹配都建立在这个形状上。想直接让运行时吃 `StandardEvent`，
* 要动整条执行链（227 个节点的契约），风险远大于"在适配器边界做一次转换"。
*
* 所以多平台接入的现实路径是：
*   平台 → StandardEvent（统一语义）→ OneBot v11（运行时契约）→ 执行
*
* 第 ② 层放在适配器里（而不是运行时里）：这样运行时**一行都不用改**，
* 每接一个平台也只是多一个"翻译成 OneBot"的实现，而不是改核心。
*/
var MessageSegmentSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("text"),
		data: z.object({ text: z.string() })
	}),
	z.object({
		type: z.literal("at"),
		data: z.object({
			userId: z.string(),
			name: z.string().optional()
		})
	}),
	z.object({
		type: z.literal("image"),
		data: z.object({
			url: z.string(),
			file: z.string().optional()
		})
	}),
	z.object({
		type: z.literal("face"),
		data: z.object({ id: z.number() })
	}),
	z.object({
		type: z.literal("reply"),
		data: z.object({ messageId: z.string() })
	})
]);
/** 解析后的消息 */
var ParsedMessageSchema = z.object({
	command: z.string().optional(),
	args: z.array(z.string()).default([]),
	mentions: z.array(z.string()).default([]),
	rawSegments: z.array(MessageSegmentSchema).default([])
});
/**
* 从**纯文本**造 `ParsedMessage`（各适配器共用）。
*
* ## 为什么要抽出来
*
* 每个平台的文本消息最终都要回答同三个问题：命令是什么、参数是什么、@ 了谁。
* 这段逻辑原来只存在于 `lark/event.ts` 的私有函数里；接钉钉时再抄一遍就意味着
* **同一个语义有两份实现**，以后改命令解析（比如支持别名、多前缀）必然漏一处。
*
* ## 命令约定（与 OneBot 语义一致）
*
* 首个词带 `/` 前缀时作为 `command`，其余词进 `args`。
*
* @param text 已经**清理过平台特有噪音**的文本（比如 `<at>` 标签、@ 后面那个空格）
* @param mentions 被 @ 的显示名列表（拿不到就是空数组，**不要编造**）
*/
function buildParsedMessage(text, mentions = []) {
	const trimmed = text.trim();
	const rawSegments = text ? [{
		type: "text",
		data: { text }
	}] : [];
	const first = trimmed ? trimmed.split(/\s+/)[0] ?? "" : "";
	const command = first.startsWith("/") ? first : void 0;
	return {
		command,
		args: trimmed ? trimmed.split(/\s+/).slice(command ? 1 : 0) : [],
		mentions,
		rawSegments
	};
}
/**
* 标准事件基类（运行期校验）。
*
* ⚠️ 与上面的 `BaseEvent` 接口是**两份声明**，必须同步。
* 这是为了拿到"能判别的类型"而付的代价 —— 好在有测试钉住字段
* （tests/shared/domain/platforms.test.ts 的"StandardEvent 的显示名字段"那一组）。
*/
var BaseEventSchema = z.object({
	platform: PlatformIdSchema,
	type: z.enum([
		"message",
		"notice",
		"request",
		"meta",
		"custom"
	]),
	userId: z.string(),
	/**
	* 用户在**该平台**的显示名（昵称）。
	*
	* 为什么必须在基类里：每个平台都有，但名字各不相同，且**缺了它会静默降级** ——
	*   - QQ 官方：`author.username`
	*   - OneBot v11：`sender.nickname`（群名片是另一个字段 `sender.card`）
	*   - 飞书：`event.user.name`
	*
	* 我们已经在 QQ 官方上踩过一次：解析层漏读 `username`，导致下游只能把
	* `sender.nickname` 硬编码成空串，基础数据的"昵称"永远是空的
	* （详见 docs/game/research-base-data-fields.md §4.0）。
	* 有了这个公共字段，接平台的人只要填它，不用再重新发现一遍。
	*/
	displayName: z.string().optional(),
	/**
	* **跨应用**统一身份（可选）。
	*
	* QQ 官方的 `union_openid`、飞书的 `union_id` 属这一层：同一个人在不同机器人/
	* 不同应用下 `userId` 不同，但 `unionId` 相同。多平台合并同一玩家只能靠它。
	*/
	unionId: z.string().optional(),
	/** 平台内的角色/权限（QQ 官方 `member_role`、OneBot `sender.role`） */
	role: z.string().optional(),
	/**
	* 发送者是不是机器人（`user` / `bot`）。
	*
	* 详见 `BaseEvent.senderType` 的说明 —— **不区分会让两个机器人互相刷屏**。
	* 拿不到就留空，**不要猜成 `'user'`**。
	*/
	senderType: z.enum(["user", "bot"]).optional(),
	groupId: z.string().optional(),
	guildId: z.string().optional(),
	channelId: z.string().optional(),
	timestamp: z.number().default(() => Date.now()),
	messageId: z.string().optional(),
	/**
	* 平台原始事件名（如 `GROUP_AT_MESSAGE_CREATE` / `im.message.receive_v1`）。
	*
	* 各平台事件名差异极大，排查问题时必须能回看原名 —— 否则只能靠日志反推
	* "这条标准事件到底是哪个平台事件翻出来的"。
	*/
	rawEventType: z.string().optional()
});
/** 消息事件 */
var MessageEventSchema = BaseEventSchema.extend({
	type: z.literal("message"),
	subType: z.enum([
		"private",
		"group",
		"guild",
		"channel"
	]).optional(),
	rawMessage: z.string(),
	parsed: ParsedMessageSchema,
	isToMe: z.boolean().default(false),
	/**
	* 话题 ID（**话题群**才有）。
	*
	* 来源：飞书 `message.thread_id`（官方注明"不返回说明该消息非话题消息"）、
	* 钉钉 `conversationId`（会话即话题容器）。
	*
	* ⚠️ 话题群里**不回话题 = 消息跑到主频道**，用户看不到上下文。
	*/
	threadId: z.string().optional(),
	/**
	* **一次性回复/更新凭证**（各平台形态不同，语义都是"这次交互专用的一次性凭据"）。
	*
	* | 平台 | 是什么 | 有效期 |
	* | --- | --- | --- |
	* | 钉钉 | `sessionWebhook`（一个"往本会话发消息"的 URL） | 见 `replyTokenExpiresAt` |
	* | 飞书卡片回调 | `event.token`（**更新那张卡片**用的凭证） | 30 分钟 / **最多 2 次** |
	* | 微信公众号 | 回调里的 `Token`（用于拉取/回复） | 10 分钟 |
	*
	* ⚠️ 别把它当成"长期有效的发送通道" —— 它**会过期**，且飞书那个还有次数上限。
	*/
	replyToken: z.string().optional(),
	/** `replyToken` 的过期时刻（**毫秒时间戳**）。没有就留空 */
	replyTokenExpiresAt: z.number().optional(),
	/**
	* 平台要求**多久内对这个事件作出应答**（毫秒）。超时的后果各平台不同。
	*
	* | 平台 | 值 | 超时后果 |
	* | --- | --- | --- |
	* | 飞书卡片回调 | `3000` | 用户端一直转圈 / 错误码 200341 |
	* | 微信公众号 / 微博 | `5000` | 平台重试 3 次，然后用户看到"暂时无法提供服务" |
	* | 长连接类（钉钉 / 企业微信） | 传输层 ack，不走这个字段 | — |
	*
	* **这张表是"先应答、再异步跑流程"这个通用设计的依据** ——
	* 有了它，运行时/适配器就能统一决定"要不要先回 ack"，
	* 而不是每个平台各自记得（飞书那边就漏过一次，症状极难查）。
	*/
	replyDeadlineMs: z.number().optional(),
	reply: z.function({
		input: [z.union([z.string(), z.array(MessageSegmentSchema)])],
		output: z.promise(z.void())
	})
});
/** 通知事件 */
var NoticeEventSchema = BaseEventSchema.extend({
	type: z.literal("notice"),
	noticeType: z.enum([
		"group_increase",
		"group_decrease",
		"group_ban",
		"group_recall",
		"friend_add",
		"friend_recall",
		"guild_member_add",
		"guild_member_remove",
		"essence",
		"honor",
		"notify",
		"poke"
	]),
	targetId: z.string().optional(),
	operatorId: z.string().optional()
});
/** 请求事件 */
var RequestEventSchema = BaseEventSchema.extend({
	type: z.literal("request"),
	requestType: z.enum([
		"friend",
		"group",
		"guild"
	]),
	flag: z.string(),
	/** 申请附言（好友申请/入群申请常带） */
	comment: z.string().optional(),
	approve: z.function({
		input: [z.boolean(), z.string().optional()],
		output: z.promise(z.void())
	}),
	reject: z.function({
		input: [z.string().optional()],
		output: z.promise(z.void())
	})
});
/** 元事件 */
var MetaEventSchema = BaseEventSchema.extend({
	type: z.literal("meta"),
	metaType: z.enum(["lifecycle", "heartbeat"]),
	subType: z.enum([
		"enable",
		"disable",
		"connect"
	]).optional()
});
/**
* **自定义事件**（第 5 种，也是唯一一个"逃生舱"）。
*
* ## 为什么需要它
*
* 前 4 种（`message` / `notice` / `request` / `meta`）**就是 OneBot v11 的
* `post_type`** —— 它们的语义是 **IM** 的：发消息、进群退群、加好友申请、生命周期。
* 一个游戏绑定想推「boss 被击败」「副本通关」时，**塞不进这 4 种里的任何一种**
* （塞进 `notice` 就得编一个假的 `notice_type`，下游 `switch` 还得认识它）。
*
* ## 设计取舍（为什么不是"全开放信封"）
*
* 另一个方案是把 `StandardEvent` 整个改成 `{ platform, type: string, ... }` 的开放信封
* —— 更灵活，但**会丢掉编译期穷尽检查**：`switch (event.type)` 不再能保证覆盖所有分支，
* 而本项目到处在用 `isMessageEvent()` 这类收窄。**那个护栏比灵活性值钱。**
*
* 所以选「**4 种内置 + 1 个 custom**」：内置的保持类型安全，领域事件走逃生舱。
* ⚪ 这与 Microsoft Bot Framework 的 `channelData`（"Contains channel-specific content"）
* 是同一个思路 —— **官方承认归一化不可能彻底，明留一个口袋**。
*
* ## 命名约定（**建议遵守，但未强制**）
*
* `域.对象.动作` 风格，全小写 + 下划线，如：
*
* - `game.boss_defeated` · `game.dungeon_cleared`
* - `app.form_submitted` · `app.build_finished`
*
* ⚠️ 只校验"非空"，**不强制格式** —— 逃生舱一旦收窄就不叫逃生舱了。
* 但绑定作者应该遵守上面的约定：以后做「事件触发器」节点时，
* 用户是靠名字来匹配的，杂乱的命名会让节点没法用。
*/
var CustomEventSchema = BaseEventSchema.extend({
	type: z.literal("custom"),
	/** 命名空间化的事件名（见上方命名约定） */
	eventName: z.string().min(1),
	/**
	* 绑定自定义的载荷。**故意用 `unknown` 不约束类型**。
	*
	* 约束了就等于要求框架认识每个绑定的领域模型 —— 那正是这个逃生舱要避免的事。
	*/
	payload: z.unknown().optional()
});
/** 统一事件联合类型（运行期校验用；与上面的接口一一对应） */
var StandardEventSchema = z.discriminatedUnion("type", [
	MessageEventSchema,
	NoticeEventSchema,
	RequestEventSchema,
	MetaEventSchema,
	CustomEventSchema
]);
/** 事件工厂 */
function createStandardEvent(raw, platform) {
	const base = raw && typeof raw === "object" ? { ...raw } : {};
	return StandardEventSchema.parse({
		...base,
		platform
	});
}
/** 类型守卫 */
function isMessageEvent(event) {
	return event.type === "message";
}

export { MessageSegmentSchema, ParsedMessageSchema, buildParsedMessage, BaseEventSchema, MessageEventSchema, NoticeEventSchema, RequestEventSchema, MetaEventSchema, CustomEventSchema, StandardEventSchema, createStandardEvent, isMessageEvent };
