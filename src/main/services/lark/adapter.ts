// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import ws from "ws";
import { SandboxTranslator } from "../bot/sandboxTranslator";
import { LarkWsClient } from "./client";
import { parseLarkEvent } from "./event";
import { isMessageEvent } from "../../../shared/domain/common/standardEvent";
import { cardSendContextFromValue, extractCardCallbackContext, extractCardCommand, extractCardOperator, extractCardValueRaw, keyboardToCard } from "./card";
import { init_logger, logger } from "../infra/logger";

/**
* 真实 WebSocket 装配。
*
* ⚠️ **必须在这里装配**（而不是在 client.ts 里）：`LarkWsClient` 刻意不 import `ws`，
* 这样它能用假 socket 做单测（不用加载原生依赖）。代价是**调用方必须提供工厂** ——
* 我之前只把"必须注入"写进了错误提示，却**忘了在真实装配点提供**，
* 于是启动飞书时报：`LarkWsClient: 必须注入 wsFactory`。
*
* 所以本文件（= 装配层）就是那个"真实装配见 lark/adapter.ts"，错误提示里写的就是这里。
*/
function defaultWsFactory$1(url) {
	return new ws(url);
}
/**
* 飞书翻译器：对运行时是运行时事件契约服务，对飞书是长连接客户端。
*/
var LarkTranslator = class LarkTranslator extends SandboxTranslator {
	larkOpts;
	lark = null;
	/**
	* 已处理过的**幂等键**（飞书是**至少一次投递**，必须去重）。
	*
	* ⚠️ 键的取法**按事件类型不同**（这是官方要求的，不是随便定的）：
	*   - 消息事件 → `message_id`（官方原文：去重请用 message_id，**不要**依赖 event_id）
	*   - 卡片回调 → `event_id`（每次点击都是独立事件，不能按消息去重）
	*/
	seenEventIds = /* @__PURE__ */ new Set();
	/** 去重集合上限，防止长跑内存增长 */
	static SEEN_LIMIT = 5e3;
	/**
	* 记下幂等键。**返回 `false` 表示这条已经处理过，应跳过**。
	*
	* 键缺失（`undefined`）时返回 `true` —— **宁可不丢事件，也不要静默吞掉**
	* （拿不到键就没法判重，此时放行比误杀安全）。
	*/
	markSeen(key) {
		if (!key) return true;
		if (this.seenEventIds.has(key)) return false;
		this.seenEventIds.add(key);
		if (this.seenEventIds.size > LarkTranslator.SEEN_LIMIT) {
			const first = this.seenEventIds.values().next().value;
			if (first !== void 0) this.seenEventIds.delete(first);
		}
		return true;
	}
	/**
	* 发消息的实现。默认调飞书 REST API；测试可替换。
	*
	* 抽成属性而不是硬编码，是为了让"事件进来 → 回消息"这条链路能在**不联网**的情况下
	* 端到端验证（这是 QQ 沙箱那次的成功经验）。
	*/
	sendText = (p) => this.sendViaLarkApi(p);
	constructor(larkOpts) {
		super({
			port: larkOpts.port,
			selfId: "10000",
			fakeGroupId: "20001"
		});
		this.larkOpts = larkOpts;
	}
	/** 起长连接（网关服务由父类 start 建立） */
	async start() {
		await super.start();
		this.lark = new LarkWsClient({
			appId: this.larkOpts.appId,
			appSecret: this.larkOpts.appSecret,
			domain: this.larkOpts.domain,
			fetchImpl: this.larkOpts.fetchImpl,
			wsFactory: this.larkOpts.wsFactory ?? defaultWsFactory$1,
			onLog: (line) => this.log(line)
		});
		this.lark.onError((err) => this.log(`[lark] 连接错误: ${err.message}`));
		this.lark.onMessage((payload, eventId) => this.onLarkEvent(payload, eventId));
		await this.lark.start();
	}
	async stop() {
		this.lark?.stop();
		this.lark = null;
		await super.stop();
	}
	/** 长连接是否已建立（诊断用） */
	isLarkConnected() {
		return this.lark?.isConnected() ?? false;
	}
	/**
	* 飞书事件入口。
	*
	* **返回响应体**（`undefined` = 不需要响应）：卡片回调必须 3 秒内回，
	* 由 `client.handleFrame` 回写到同一 WebSocket。消息事件不需要响应。
	*/
	onLarkEvent(payload, eventId) {
		let parsed;
		try {
			parsed = parseLarkEvent(payload);
		} catch (e) {
			this.log(`[lark] 事件解析失败: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		if (!parsed) {
			if (!this.markSeen(eventId)) {
				this.log(`[lark] 跳过重复投递的卡片回调 ${eventId}`);
				return;
			}
			return this.tryHandleCardCallback(payload);
		}
		const dedupeKey = parsed.idempotencyKey ?? eventId;
		if (!this.markSeen(dedupeKey)) {
			this.log(`[lark] 跳过重复投递的消息 ${dedupeKey}`);
			return;
		}
		if (parsed.event.senderType === "bot") {
			this.log("[lark] 忽略机器人发送的消息（senderType=bot）");
			return;
		}
		if (!isMessageEvent(parsed.event)) return void 0;
		const evt = parsed.event;
		const isGroup = evt.subType === "group";
		this.log(`[lark] 收到消息: ${isGroup ? "group=" + String(evt.groupId) : "private"}, user=${evt.userId}, name=${evt.displayName ?? "(无)"}, text="${evt.rawMessage.slice(0, 50)}"`);
		const over = {
			userId: evt.userId,
			groupId: evt.groupId,
			displayName: evt.displayName,
			role: evt.role,
			messageId: evt.messageId,
			timestamp: evt.timestamp,
			isToMe: evt.isToMe,
			parsed: evt.parsed
		};
		if (isGroup) this.sandboxAdapter.emitGroupMessage(evt.rawMessage, over);
		else this.sandboxAdapter.emitPrivateMessage(evt.rawMessage, over);
	}
	/**
	* 处理卡片回调 `card.action.trigger`。
	*
	* ## 返回值 = 3 秒内的响应体（缺了用户会一直转圈）
	*
	* 官方原文：**业务服务器需要在 3 秒内响应回调请求**，声明"弹出 Toast / 更新卡片 /
	* 保持原内容不变"。长连接模式下这个响应是**回写同一 WebSocket**
	* （机制见 `client.ts` 的 `handleFrame`）。
	*
	* 响应里给一个 `toast` 告诉用户"已收到"——因为**流程是异步跑的**，
	* 我们不能等它跑完再响应（很可能超 3 秒）。
	*
	* ## 为什么必须处理它
	*
	* QQ 键盘的 `action.type: 2` 语义是"点击后**用户发出** data 里的命令"，
	* 平台直接帮你变成一条消息。**飞书卡片没有这个等价物** —— 点击只是回调。
	*
	* 所以这里把回调**折算成一条用户消息**注入事件管线，
	* 让流程图完全感知不到"这条命令是点按钮来的而不是打字的"。
	*
	* ## 一个控制台开关（否则收不到）
	*
	* 官方要求：**应用 → 事件与回调 → 回调配置**里开启。
	* 不开的话**不会报错，但一条回调都收不到**（官方明确没有预检）。
	* 排障时先查这个。
	*/
	tryHandleCardCallback(payload) {
		if (!payload || typeof payload !== "object") return void 0;
		const p = payload;
		if ((p.header?.event_type ?? p.type) !== "card.action.trigger") return void 0;
		const ack = (content, type = "info") => ({ toast: {
			type,
			content,
			i18n: {
				zh_cn: content,
				en_us: content
			}
		} });
		const event = p.event ?? {};
		const valueRaw = extractCardValueRaw(event);
		const cmd = extractCardCommand(event);
		if (!cmd) {
			this.log("[lark] 卡片回调里没有可取的命令（value 未设置 cmd？）已忽略");
			return ack("这个按钮没有绑定操作", "error");
		}
		const operatorId = extractCardOperator(event);
		if (!operatorId) {
			this.log("[lark] 卡片回调缺少操作者 open_id，无法确定是谁点的，已忽略");
			return ack("无法识别操作者", "error");
		}
		const fromValue = cardSendContextFromValue(valueRaw);
		const cbCtx = extractCardCallbackContext(event);
		const chatId = fromValue?.chatId ?? cbCtx.chatId ?? "";
		const knownChatType = fromValue?.chatType;
		const isGroupFinal = (knownChatType === void 0 ? void 0 : knownChatType === "group") === true;
		if (knownChatType === void 0 && chatId) this.log(`[lark] 警告: 卡片的群/单聊类型未知（不是本次运行发出的卡片），按单聊处理: chatId=${chatId}, messageId=${cbCtx.messageId ?? "无"}`);
		this.log(`[lark] 卡片按钮点击: user=${operatorId}, cmd="${cmd}", ${isGroupFinal ? "group=" + chatId : "private"}${cbCtx.messageId ? ", messageId=" + cbCtx.messageId : ""}`);
		const over = {
			userId: operatorId,
			groupId: isGroupFinal ? chatId : void 0,
			timestamp: Date.now(),
			isToMe: true,
			messageId: cbCtx.messageId,
			replyDeadlineMs: 3e3,
			replyToken: cbCtx.updateToken
		};
		if (isGroupFinal) this.sandboxAdapter.emitGroupMessage(cmd, over);
		else this.sandboxAdapter.emitPrivateMessage(cmd, over);
		return ack("已收到，正在处理…");
	}
	/**
	* 本绑定**支持哪些能力**（单一来源）。
	*
	* ⚠️ 动作名**不在这里写** —— 由 `actionsForCapabilities` 从这张能力表算出来。
	* 以前两边分开写（能力一处、动作名一处），迟早会对不上。
	*/
	capabilities() {
		return ["im.message.send", "im.message.send_keyboard"];
	}
	/**
	* 本绑定**实现了哪些动作**（基类据此显式拒绝其余动作）。
	*
	* ## 为什么必须声明（这是"静默失败"的修复）
	*
	* 原来这里第一行是：
	*
	* ```ts
	* if (!action.includes('send')) return;   // ← 静默丢弃，且基类已回了 ok
	* ```
	*
	* 于是「在飞书项目里放了一个 QQ 专属节点」的症状是：
	* **流程跑完、没有报错、日志空白、机器人没反应** —— 用户只会以为自己配错了。
	*
	* 现在改成**声明能力 + 基类拦截**：不在表里的动作会被明确拒绝，
	* 并回一条 `status: 'failed'` 让运行时 `callApi` **抛错**（`FlowRuntime.ts` 的行为），
	* 用户能直接看到"这个绑定不支持这个动作"。
	*
	* ## 只声明 send 系，是因为飞书这条路真的只做了"发消息"
	*
	* `im.message.send` → 文本；
	* `im.message.send_keyboard` → **转成飞书互动卡片**（按钮真的能点），转不出来才降级成编号文本。
	*
	* ⚠️ 其余能力（群管理 / 富媒体 / 撤回…）飞书这条路**都没实现** ——
	* 以前它们要么被静默丢弃，要么掉进"跳过发送（没有文本）"这种**误导性**日志。
	*/
	handleAction(msg) {
		if (!super.handleAction(msg)) return false;
		const action = String(msg.action ?? "");
		const params = msg.params ?? {};
		const chatType = params.message_type === "group" ? "group" : "private";
		const chatId = String((chatType === "group" ? params.group_id : params.user_id) ?? params.chat_id ?? "");
		if (!chatId) {
			this.log(`[lark] 跳过发送（缺少 chatId）: action=${action}`);
			return false;
		}
		if (action.includes("keyboard")) {
			const card = keyboardToCard(params, {
				chatId,
				chatType
			});
			if (card) {
				this.log("[lark] QQ 键盘 → 飞书互动卡片（按钮可点）");
				this.sendCard({
					chatId,
					chatType,
					card
				}).then((r) => {
					if (r.ok) this.log(`[lark] 卡片已发送: id=${r.messageId ?? "无"}`);
					else this.log(`[lark] 卡片发送失败: ${r.error ?? "未知原因"}`);
				}).catch((e) => {
					this.log(`[lark] 卡片发送异常: ${e instanceof Error ? e.message : String(e)}`);
				});
				return true;
			}
			this.log("[lark] 键盘里没有可用的按钮，改为编号纯文本");
		}
		let text = extractText$2(params);
		if (!text && action.includes("keyboard")) {
			text = keyboardToPlainText$1(params);
			if (!text) {
				this.log(`[lark] 跳过发送（键盘消息里没有可取的内容）: action=${action}`);
				return false;
			}
			this.log("[lark] 飞书不支持 QQ 键盘按钮，已降级为编号纯文本");
		}
		if (!text) {
			this.log(`[lark] 跳过发送（没有文本）: action=${action}`);
			return false;
		}
		this.log(`[lark] 准备发送: chatType=${chatType}, chatId=${chatId}, text="${text.slice(0, 50)}"`);
		this.sendText({
			chatId,
			chatType,
			text
		}).then((r) => {
			if (r.ok) this.log(`[lark] 发送成功: id=${r.messageId ?? "无"}`);
			else this.log(`[lark] 发送失败: ${r.error ?? "未知原因"}`);
		}).catch((e) => {
			this.log(`[lark] 发送异常: ${e instanceof Error ? e.message : String(e)}`);
		});
		return true;
	}
	/**
	* 发一条**互动卡片**。
	*
	* ⚠️ `content` 是**卡片 JSON 的字符串**（与文本消息一样是 JSON 字符串，不是对象）。
	*/
	async sendCard(p) {
		const fetchImpl = this.larkOpts.fetchImpl ?? globalThis.fetch;
		const domain = this.larkOpts.domain ?? "https://open.feishu.cn";
		try {
			const token = await this.getTenantToken(fetchImpl, domain);
			if (!token.ok) return {
				ok: false,
				error: token.error
			};
			const body = await (await fetchImpl(`${domain}/open-apis/im/v1/messages?receive_id_type=${p.chatType === "group" ? "chat_id" : "open_id"}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token.token}`
				},
				body: JSON.stringify({
					receive_id: p.chatId,
					msg_type: "interactive",
					content: JSON.stringify(p.card)
				})
			})).json();
			if (body.code !== 0) return {
				ok: false,
				error: `飞书卡片发送失败（code=${body.code}）: ${body.msg ?? ""}`
			};
			return {
				ok: true,
				messageId: body.data?.message_id
			};
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	/**
	* 调飞书 REST API 发文本消息。
	*
	* ⚠️ 需要 **tenant_access_token**：先用 app_id/app_secret 换，再带它调发消息接口。
	* token 有效期 2 小时，这里做了内存缓存（过期前 5 分钟刷新）。
	*/
	async sendViaLarkApi(p) {
		const fetchImpl = this.larkOpts.fetchImpl ?? globalThis.fetch;
		const domain = this.larkOpts.domain ?? "https://open.feishu.cn";
		try {
			const token = await this.getTenantToken(fetchImpl, domain);
			if (!token.ok) return {
				ok: false,
				error: token.error
			};
			const body = await (await fetchImpl(`${domain}/open-apis/im/v1/messages?receive_id_type=${p.chatType === "group" ? "chat_id" : "open_id"}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token.token}`
				},
				body: JSON.stringify({
					receive_id: p.chatId,
					msg_type: "text",
					content: JSON.stringify({ text: p.text })
				})
			})).json();
			if (body.code !== 0) return {
				ok: false,
				error: `飞书发送失败（code=${body.code}）: ${body.msg ?? ""}`
			};
			return {
				ok: true,
				messageId: body.data?.message_id
			};
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	/** 换 tenant_access_token（带缓存） */
	tokenCache = null;
	async getTenantToken(fetchImpl, domain) {
		const now = Date.now();
		if (this.tokenCache && this.tokenCache.expiresAt > now) return {
			ok: true,
			token: this.tokenCache.token
		};
		const body = await (await fetchImpl(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				app_id: this.larkOpts.appId,
				app_secret: this.larkOpts.appSecret
			})
		})).json();
		if (body.code !== 0 || !body.tenant_access_token) return {
			ok: false,
			error: `获取飞书 tenant_access_token 失败（code=${body.code}）: ${body.msg ?? ""}。请核对 App ID / App Secret，并确认应用已发布`
		};
		const ttlMs = Math.max(0, (body.expire ?? 7200) * 1e3 - 3e5);
		this.tokenCache = {
			token: body.tenant_access_token,
			expiresAt: now + ttlMs
		};
		return {
			ok: true,
			token: body.tenant_access_token
		};
	}
	log(line) {
		logger.info(line);
		this.larkOpts.onLog?.(line);
	}
};
/** 从协议动作参数里抽文本（`message` 可以是字符串或分段数组） */
function extractText$2(params) {
	const m = params.message;
	if (typeof m === "string") return m;
	if (Array.isArray(m)) return m.map((seg) => {
		const s = seg;
		return s.type === "text" ? String(s.data?.text ?? "") : "";
	}).join("");
	if (typeof params.raw_message === "string") return params.raw_message;
	if (typeof params.text === "string") return params.text;
	return "";
}
/**
* 把 QQ 键盘（`keyboard`）降级成**编号纯文本**。
*
* ## 为什么需要它
*
* `battle_panel` / `menu_config` 这类节点标注的是 `platform: 'qq'` ——
* 它们产出 QQ 官方的 `keyboard` 结构，**飞书没有这个概念**（飞书用互动卡片）。
* 不做降级的话，用户在飞书里发 `/菜单` 会"什么都没发生"，
* 而日志里只有一句"跳过发送"，用户根本不知道是平台不支持。
*
* ## 降级成什么
*
* 飞书里没有按钮，但**编号回复**是可用的通用交互：
*
*     菜单
*     1. 状态
*     2. 商店
*     3. 菜单
*     （回复数字即可选择）
*
* 这与"没有按钮的平台就用纯文本玩"的设计一致（见 docs/game/player-data-cards-design.md
* 里关于降级渲染的讨论）。
*/
function keyboardToPlainText$1(params) {
	const kb = params.keyboard;
	const rows = Array.isArray(kb?.content?.rows) ? kb.content.rows : kb?.rows;
	if (!Array.isArray(rows)) return "";
	const lines = [];
	let index = 0;
	for (const row of rows) {
		if (row === null || typeof row !== "object") continue;
		const buttons = row.buttons;
		if (!Array.isArray(buttons)) continue;
		for (const b of buttons) {
			if (b === null || typeof b !== "object") continue;
			const btn = b;
			const label = btn.render_data?.label ?? btn.render_data?.visited_label;
			if (typeof label !== "string" || !label) continue;
			index++;
			lines.push(`${index}. ${label}`);
		}
	}
	if (lines.length === 0) return "";
	return lines.join("\n") + "\n（回复数字即可选择）";
}

export { defaultWsFactory$1, LarkTranslator, extractText$2, keyboardToPlainText$1 };
