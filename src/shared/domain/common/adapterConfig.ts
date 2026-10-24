// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import { PlatformIdSchema, RETIRED_PLATFORMS, normalizePlatformId } from "./capabilities";

/** 基础适配器配置 */
var BaseAdapterConfigSchema = z.object({
	platform: PlatformIdSchema,
	enabled: z.boolean().default(true),
	priority: z.number().int().min(0).max(100).default(10),
	/** 连接超时(ms) */
	connectTimeout: z.number().int().positive().default(3e4),
	/** 重连间隔(ms) */
	reconnectInterval: z.number().int().positive().default(5e3),
	/** 最大重连次数 */
	maxReconnectAttempts: z.number().int().min(0).default(10),
	/** 心跳间隔(ms) */
	heartbeatInterval: z.number().int().positive().default(3e4)
});
/** QQ 官方配置 */
var OfficialConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("qq-official"),
	/** App ID */
	appId: z.string().min(1),
	/** App Secret */
	appSecret: z.string().min(1),
	/** 沙箱环境 */
	sandbox: z.boolean().default(false),
	/** WebSocket 地址 */
	wsUrl: z.string().url().optional(),
	/** 预设群组 */
	presetGuilds: z.array(z.string()).optional()
});
/** QQ 网关（运行时事件契约：NapCat / Lagrange / 本项目内置桥） */
var QqGatewayConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("qq-gateway"),
	/** 网关地址，如 ws://127.0.0.1:8080/runtime/ws */
	wsUrl: z.string().url(),
	/** 鉴权 token（网关侧配了才需要） */
	accessToken: z.string().optional()
});
/**
* 企业微信配置。
*
* ⚠️ 这是**独立平台**，不是"微信的一种实现"：它是 CorpID + AgentID 的自建应用体系，
* 与企业认证绑定。以前它被塞在 `wechat` 的 `implementation: 'wework'` 里，是错的。
*/
var WecomConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("wecom"),
	/** 企业 ID */
	corpId: z.string().min(1),
	/** 自建应用 Secret */
	corpSecret: z.string().min(1),
	/** 应用 AgentID */
	agentId: z.string().min(1),
	/** 接收事件用的 Token（回调验签） */
	callbackToken: z.string().optional(),
	/** 回调加密 Key（EncodingAESKey） */
	encodingAesKey: z.string().optional()
});
/**
* 微信公众号（服务号）配置。
*
* ⚠️ 同样**独立平台**：走服务号的消息接口，且有"必须尽快响应"的窗口
* （否则微信会重试；具体秒数与重试次数见 docs/platforms/微信生态API开发参考.md §3.1，已核对官方原文）。
*/
var WechatMpConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("wechat-mp"),
	/** 公众号 AppID */
	appId: z.string().min(1),
	/** 公众号 AppSecret */
	appSecret: z.string().min(1),
	/** 服务器配置 Token（回调验签） */
	token: z.string().min(1),
	/** 消息加解密密钥 */
	encodingAesKey: z.string().optional(),
	/** 消息加解密方式 */
	encryptMode: z.enum([
		"plain",
		"compatible",
		"safe"
	]).default("plain")
});
BaseAdapterConfigSchema.extend({
	platform: z.literal("wechat-personal"),
	implementation: z.string().optional()
});
/** 飞书配置 */
var LarkConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("lark"),
	/** App ID */
	appId: z.string().min(1),
	/** App Secret */
	appSecret: z.string().min(1),
	/** 加密 Key */
	encryptKey: z.string().optional(),
	/** 验证 Token */
	verificationToken: z.string().optional(),
	/** 事件订阅 */
	eventSubscriptions: z.array(z.string()).default(["im.message.receive_v1"]),
	/**
	* 接收事件的方式。
	*
	* 飞书两种都支持：**长连接**（WebSocket 全双工，不需要公网地址、SDK 已封装鉴权与验签）
	* 与 **webhook**（需要公网地址，要自己解密验签）。
	* 详见 docs/platforms/飞书API开发参考.md（订阅方式与长连接协议）。
	*/
	eventMode: z.enum(["long-connection", "webhook"]).default("long-connection")
});
/**
* 钉钉配置。
*
* Stream 长连接 / webhook 两种模式官方都有；**本项目只接 Stream**
* （webhook 需要公网地址，桌面形态用不了）。
*
* ⚠️ 这是**多平台抽象层**的配置（`ADAPTER_CONFIG_SCHEMAS`）。
* 真正生效的项目配置在 `src/shared/types/project.ts` 的 `ProjectConfig.dingtalk`
* 与 `src/main/schemas/project.ts` —— 两处都要改（见 `多平台适配设计.md` §5.4）。
*
* 协议细节已核实：`docs/platforms/钉钉API开发参考.md`。
*/
var DingtalkConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("dingtalk"),
	/** 应用 AppKey（企业内部应用） */
	clientId: z.string().min(1),
	/** 应用 AppSecret */
	clientSecret: z.string().min(1),
	/** 机器人编码（群机器人场景） */
	robotCode: z.string().optional(),
	/** 接收事件的方式：Stream 长连接 / webhook */
	eventMode: z.enum(["stream", "webhook"]).default("stream")
});
/** KOOK（原开黑啦）配置 */
var KookConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("kook"),
	/** Bot Token */
	token: z.string().min(1),
	/** 是否压缩传输（KOOK 的 websocket 选项） */
	compress: z.boolean().default(false)
});
/** Telegram 配置 */
var TelegramConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("telegram"),
	/** Bot Token（@BotFather 发的） */
	botToken: z.string().min(1),
	/** 接收方式：长轮询 / webhook */
	mode: z.enum(["polling", "webhook"]).default("polling"),
	/** webhook 地址（mode=webhook 时必填） */
	webhookUrl: z.string().url().optional()
});
/** Discord 配置 */
var DiscordConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("discord"),
	/** Bot Token */
	botToken: z.string().min(1),
	/** 订阅的 intents 数值（Discord 要求显式声明） */
	intents: z.number().int().nonnegative().default(0)
});
/** Slack 配置 */
var SlackConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("slack"),
	/** Bot Token（xoxb-…） */
	botToken: z.string().min(1),
	/** Signing Secret（验签） */
	signingSecret: z.string().min(1),
	/** Socket Mode 的 App Token（xapp-…），用 Socket Mode 时必填 */
	appToken: z.string().optional()
});
/**
* 本地沙箱配置 —— **不接真实账号**。
*
* 为什么先做它：多平台的管线（AdapterInterface → StandardEvent → FlowRuntime）
* 一次都没跑通过。先用假平台把它打通并测住，再一个平台一个平台接，
* 否则每接一个平台都在调同一段未验证的管线。
* 参考：Zhin.js 也把 Sandbox 列为唯一 Stable 档位。
*/
var SandboxConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("sandbox"),
	/** 假用户列表（用于构造事件） */
	fakeUsers: z.array(z.string()).default(["10001", "10002"]),
	/** 假群号 */
	fakeGroupId: z.string().default("20001"),
	/** 自动回复前缀（便于肉眼确认链路通了） */
	echoPrefix: z.string().default("[sandbox] ")
});
/** Minecraft 配置 */
var MinecraftConfigSchema = BaseAdapterConfigSchema.extend({
	platform: z.literal("minecraft"),
	/** 服务器地址 */
	host: z.string().default("localhost"),
	/** 服务器端口 */
	port: z.number().int().min(1).max(65535).default(25565),
	/** 认证类型 */
	auth: z.enum([
		"offline",
		"microsoft",
		"yggdrasil"
	]).default("offline"),
	/** 机器人用户名 */
	username: z.string().min(1),
	/** 机器人密码(离线模式可选) */
	password: z.string().optional(),
	/** 版本 */
	version: z.string().optional(),
	/** 监听的聊天类型 */
	chatTypes: z.array(z.enum([
		"chat",
		"tell",
		"say"
	])).default(["chat"])
});
/**
* 可使用的平台配置联合。
*
* ⚠️ **`wechat-personal` 刻意不在这个联合里**：微信个人号没有官方 API，
* 第三方方案已停止维护。放进来等于给出一个永远走不通的选项。
* 想给存量配置一个可读报错的，看 `explainAdapterConfigError()`。
*/
var AdapterConfigSchema = z.discriminatedUnion("platform", [
	OfficialConfigSchema,
	QqGatewayConfigSchema,
	WecomConfigSchema,
	WechatMpConfigSchema,
	LarkConfigSchema,
	DingtalkConfigSchema,
	KookConfigSchema,
	TelegramConfigSchema,
	DiscordConfigSchema,
	SlackConfigSchema,
	SandboxConfigSchema,
	MinecraftConfigSchema
]);
/** 配置验证器 */
var AdapterConfigValidator = {
	/**
	* 验证并规范化配置。
	*
	* ⚠️ **`T` 是调用方的断言，不是这里能推出来的。**
	* schema 只保证"**是联合里的某一个成员**"，收窄到具体平台（例如 `OfficialConfig`）
	* 得靠调用方自己已经判过分支。所以这里必须显式 `as T` ——
	* 不加断言就是 `AdapterConfig`（联合）赋给 `T`，编译不过。
	* （`safeValidate` 早就是这么写的，两处口径现在一致了。）
	*/
	validate(config) {
		return AdapterConfigSchema.parse(normalizeAdapterConfigPlatform(config));
	},
	/** 安全验证(不抛出异常) */
	safeValidate(config) {
		const result = AdapterConfigSchema.safeParse(normalizeAdapterConfigPlatform(config));
		if (result.success) return {
			success: true,
			data: result.data
		};
		return {
			success: false,
			error: result.error
		};
	},
	/**
	* 验证并给出**可读的失败原因**。
	*
	* 比 `safeValidate` 多做的事：识别"已废弃平台"（微信个人号 / Gewechat / Wechaty），
	* 返回一句人话而不是 `invalid discriminated union` 这种看不出所以然的英文校验错。
	* 界面应该用这个而不是 `safeValidate`。
	*/
	validateWithReason(config) {
		const normalized = normalizeAdapterConfigPlatform(config);
		const retired = explainRetiredPlatform(normalized && typeof normalized === "object" ? normalized.platform : void 0);
		if (retired) return {
			ok: false,
			reason: retired
		};
		const result = AdapterConfigSchema.safeParse(normalized);
		if (result.success) return {
			ok: true,
			data: result.data
		};
		return {
			ok: false,
			reason: result.error.issues.map((i) => i.message).join("；")
		};
	},
	/** 获取平台默认配置 */
	getDefaults(platform) {
		return {
			"qq-official": {
				platform: "qq-official",
				enabled: true,
				priority: 10
			},
			"qq-gateway": {
				platform: "qq-gateway",
				enabled: false,
				priority: 9
			},
			wecom: {
				platform: "wecom",
				enabled: false,
				priority: 5
			},
			"wechat-mp": {
				platform: "wechat-mp",
				enabled: false,
				priority: 5
			},
			lark: {
				platform: "lark",
				enabled: false,
				priority: 5
			},
			dingtalk: {
				platform: "dingtalk",
				enabled: false,
				priority: 5
			},
			kook: {
				platform: "kook",
				enabled: false,
				priority: 5
			},
			telegram: {
				platform: "telegram",
				enabled: false,
				priority: 3
			},
			discord: {
				platform: "discord",
				enabled: false,
				priority: 3
			},
			slack: {
				platform: "slack",
				enabled: false,
				priority: 3
			},
			sandbox: {
				platform: "sandbox",
				enabled: false,
				priority: 1
			},
			minecraft: {
				platform: "minecraft",
				enabled: false,
				priority: 1
			}
		}[platform] || {};
	},
	/** 合并默认配置 */
	mergeWithDefaults(config) {
		return {
			...this.getDefaults(config.platform),
			...config
		};
	}
};
/**
* 把配置里的历史平台标识迁移成现行标识（`wechat` → `wechat-mp`、`qq` → `qq-official`）。
*
* 非对象、无 platform 字段时**原样返回**：让 Zod 去报真正的形状错误，
* 而不是在这里把问题掩盖成"platform 不对"。
*/
function normalizeAdapterConfigPlatform(config) {
	if (!config || typeof config !== "object") return config;
	const obj = config;
	if (!("platform" in obj)) return config;
	const normalized = normalizePlatformId(obj.platform);
	if (normalized === obj.platform) return config;
	return {
		...obj,
		platform: normalized
	};
}
/**
* 如果 platform 是**已废弃**的标识（微信个人号 / Gewechat / Wechaty），返回一句可读的原因。
*
* 返回 `null` 表示不是废弃标识，交给正常校验流程。
*/
function explainRetiredPlatform(rawPlatform) {
	if (typeof rawPlatform !== "string") return null;
	if (rawPlatform === "wechat-personal") return "微信个人号已不支持：官方无 API，第三方方案（Gewechat）已停止维护。请改接「企业微信」或「微信公众号」。";
	return RETIRED_PLATFORMS[rawPlatform] ?? null;
}

export { BaseAdapterConfigSchema, OfficialConfigSchema, QqGatewayConfigSchema, WecomConfigSchema, WechatMpConfigSchema, LarkConfigSchema, DingtalkConfigSchema, KookConfigSchema, TelegramConfigSchema, DiscordConfigSchema, SlackConfigSchema, SandboxConfigSchema, MinecraftConfigSchema, AdapterConfigSchema, AdapterConfigValidator, normalizeAdapterConfigPlatform, explainRetiredPlatform };
