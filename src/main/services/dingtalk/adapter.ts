// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import ws from "ws";
import { SandboxTranslator } from "../bot/sandboxTranslator";
import { DingTalkStreamClient } from "./stream";
import { parseDingTalkMessage } from "./event";
import { isMessageEvent } from "../../../shared/domain/common/standardEvent";
import { init_logger, logger } from "../infra/logger";

/**
* 真实 WebSocket 装配。
*
* ⚠️ **必须在这里装配**（而不是在 `stream.ts` 里）：`DingTalkStreamClient` 刻意不
* import `ws`，这样它能用假 socket 做单测。代价是调用方必须提供工厂 ——
* 飞书那边我一开始只把"必须注入"写进了错误提示却忘了装配，启动就报
* `必须注入 wsFactory`。这次直接在这里提供。
*/
function defaultWsFactory(url) {
	return new ws(url);
}
/**
* 钉钉翻译器：对运行时是运行时事件契约服务，对钉钉是 Stream 客户端。
*/
var DingTalkTranslator = class DingTalkTranslator extends SandboxTranslator {
	dingOpts;
	stream = null;
	/** 已处理的幂等键（钉钉长连接在超时未应答时会**重推**同一条消息） */
	seen = /* @__PURE__ */ new Set();
	static SEEN_LIMIT = 5e3;
	/** 会话上下文：`conversationId` → 回复地址 */
	conversations = /* @__PURE__ */ new Map();
	static CTX_LIMIT = 500;
	tokenCache = null;
	/**
	* 发消息的实现。默认走 `sessionWebhook`；测试可替换。
	*
	* 抽成属性而不是硬编码，是为了让"事件进来 → 回消息"这条链路能在**不联网**的情况下
	* 端到端验证（QQ 沙箱与飞书都是这么做的）。
	*/
	sendText = (p) => this.sendViaSessionWebhook(p);
	constructor(dingOpts) {
		super({
			port: dingOpts.port,
			selfId: "10000",
			fakeGroupId: "20001"
		});
		this.dingOpts = dingOpts;
	}
	/** 起长连接（网关服务由父类 start 建立） */
	async start() {
		await super.start();
		this.stream = new DingTalkStreamClient({
			clientId: this.dingOpts.clientId,
			clientSecret: this.dingOpts.clientSecret,
			gatewayUrl: this.dingOpts.gatewayUrl,
			fetchImpl: this.dingOpts.fetchImpl,
			wsFactory: this.dingOpts.wsFactory ?? defaultWsFactory,
			onLog: (line) => this.log(line)
		});
		this.stream.onError((err) => this.log(`[dingtalk] 连接错误: ${err.message}`));
		this.stream.onFrame((frame) => this.onFrame(frame));
		await this.stream.start();
	}
	async stop() {
		this.stream?.stop();
		this.stream = null;
		await super.stop();
	}
	/** 长连接是否已建立（诊断用） */
	isDingTalkConnected() {
		return this.stream?.isConnected() ?? false;
	}
	/**
	* **订阅是否已生效**（诊断用）。
	*
	* ⚠️ 与飞书不同：钉钉"连上"≠"能收消息"，要等服务端推 `SYSTEM/REGISTERED`。
	* 排查"连上了但收不到消息"先看这个。
	*/
	isDingTalkRegistered() {
		return this.stream?.isRegistered() ?? false;
	}
	onFrame(frame) {
		const topic = frame.headers?.topic;
		if (topic !== "/v1.0/im/bot/messages/get") {
			this.log(`[dingtalk] 暂不处理的回调 topic="${topic ?? "(无)"}"（已忽略）`);
			return;
		}
		let payload;
		try {
			payload = frame.data ? JSON.parse(frame.data) : null;
		} catch (e) {
			this.log(`[dingtalk] 消息体不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		const parsed = parseDingTalkMessage(payload, topic);
		if (!parsed) {
			this.log("[dingtalk] 消息缺少会话或发送者，已忽略（不产出半截事件）");
			return;
		}
		const key = parsed.idempotencyKey;
		if (key) {
			if (this.seen.has(key)) {
				this.log(`[dingtalk] 跳过重复推送的消息 ${key}`);
				return;
			}
			this.seen.add(key);
			if (this.seen.size > DingTalkTranslator.SEEN_LIMIT) {
				const first = this.seen.values().next().value;
				if (first !== void 0) this.seen.delete(first);
			}
		}
		if (!isMessageEvent(parsed.event)) return void 0;
		const evt = parsed.event;
		if (evt.replyToken && evt.groupId) this.rememberConversation(evt.groupId, {
			sessionWebhook: evt.replyToken,
			expiresAt: evt.replyTokenExpiresAt ?? 0,
			chatType: "group",
			lastSenderStaffId: evt.userId
		});
		else if (evt.replyToken) this.rememberConversation(evt.userId, {
			sessionWebhook: evt.replyToken,
			expiresAt: evt.replyTokenExpiresAt ?? 0,
			chatType: "private",
			lastSenderStaffId: evt.userId
		});
		const isGroup = evt.subType === "group";
		this.log(`[dingtalk] 收到消息: ${isGroup ? "group=" + String(evt.groupId) : "private"}, user=${evt.userId}, name=${evt.displayName ?? "(无)"}, at=${evt.isToMe}, text="${evt.rawMessage.slice(0, 50)}"`);
		const over = {
			userId: evt.userId,
			groupId: evt.groupId,
			displayName: evt.displayName,
			role: evt.role,
			messageId: evt.messageId,
			timestamp: evt.timestamp,
			isToMe: evt.isToMe,
			parsed: evt.parsed,
			senderType: evt.senderType
		};
		if (isGroup) this.sandboxAdapter.emitGroupMessage(evt.rawMessage, over);
		else this.sandboxAdapter.emitPrivateMessage(evt.rawMessage, over);
	}
	rememberConversation(id, ctx) {
		this.conversations.set(id, ctx);
		if (this.conversations.size > DingTalkTranslator.CTX_LIMIT) {
			const first = this.conversations.keys().next().value;
			if (first !== void 0) this.conversations.delete(first);
		}
	}
	/**
	* 本绑定**支持哪些能力**（单一来源；动作名由基类从它算出来）。
	*
	* 钉钉这条路只做了"发消息"：
	* - `im.message.send` → 文本（经 `sessionWebhook`）
	* - `im.message.send_keyboard` → **降级成编号纯文本**（钉钉 ActionCard 结构未核实，见文件头）
	*
	* ⚠️ 其余能力都没实现 —— 尤其富媒体（钉钉要先传 media_id）、
	* 流式（钉钉有 AI 卡片流式但没接）、群管理（钉钉群管理 API 完全不同）。
	*/
	capabilities() {
		return ["im.message.send", "im.message.send_keyboard"];
	}
	handleAction(msg) {
		if (!super.handleAction(msg)) return false;
		const action = String(msg.action ?? "");
		const params = msg.params ?? {};
		const chatType = params.message_type === "group" ? "group" : "private";
		const chatId = String((chatType === "group" ? params.group_id : params.user_id) ?? params.chat_id ?? "");
		if (!chatId) {
			this.log(`[dingtalk] 跳过发送（缺少 chatId）: action=${action}`);
			return false;
		}
		let text = extractText(params);
		if (!text && action.includes("keyboard")) {
			text = keyboardToPlainText(params);
			if (!text) {
				this.log(`[dingtalk] 跳过发送（键盘消息里没有可取的内容）: action=${action}`);
				return false;
			}
			this.log("[dingtalk] 暂不支持 QQ 键盘按钮，已降级为编号纯文本");
		}
		if (!text) {
			this.log(`[dingtalk] 跳过发送（没有文本）: action=${action}`);
			return false;
		}
		this.log(`[dingtalk] 准备发送: chatType=${chatType}, chatId=${chatId}, text="${text.slice(0, 50)}"`);
		this.sendText({
			chatId,
			chatType,
			text
		}).then((r) => {
			if (r.ok) this.log("[dingtalk] 发送成功");
			else this.log(`[dingtalk] 发送失败: ${r.error ?? "未知原因"}`);
		}).catch((e) => {
			this.log(`[dingtalk] 发送异常: ${e instanceof Error ? e.message : String(e)}`);
		});
		return true;
	}
	/**
	* 通过 `sessionWebhook` 发消息（官方示例的做法）。
	*
	* ## 为什么要带 access_token
	*
	* 官方示例往 `sessionWebhook` POST 时带了 `x-acs-dingtalk-access-token` 头 ——
	* 少了它会被拒绝。token 走 `GET /gettoken?appkey=&appsecret=`，有效期 2 小时，这里做缓存。
	*
	* ## 已知限制（**如实记录，不假装完整**）
	*
	* `sessionWebhook` 是**会过期**的一次性地址（官方给了 `sessionWebhookExpiredTime`）。
	* 流程图如果跑很久才回复，这个地址可能已经失效 —— 那时这里会**明确报错**而不是
	* 静默丢弃。长效方案是走服务端 API（`/v1.0/robot/groupMessages/send`，
	* 但它**不支持 @**，且要按模板 `msgKey`/`msgParam` 拼），留待后续。
	*/
	async sendViaSessionWebhook(p) {
		const ctx = this.conversations.get(p.chatId);
		if (!ctx) return {
			ok: false,
			error: `没有 ${p.chatId} 的回复地址（sessionWebhook）。钉钉的回复地址来自**收到的消息**，所以只能回复"跟机器人说过话"的会话`
		};
		if (ctx.expiresAt && Date.now() > ctx.expiresAt) return {
			ok: false,
			error: `回复地址已过期（sessionWebhookExpiredTime=${ctx.expiresAt}）`
		};
		const fetchImpl = this.dingOpts.fetchImpl ?? globalThis.fetch;
		const base = this.dingOpts.tokenUrl ?? "https://oapi.dingtalk.com/gettoken";
		try {
			const token = await this.getAccessToken(fetchImpl, base);
			if (!token.ok) return {
				ok: false,
				error: token.error
			};
			const res = await fetchImpl(ctx.sessionWebhook, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-acs-dingtalk-access-token": token.token
				},
				body: JSON.stringify({
					msgtype: "text",
					text: { content: p.text },
					at: ctx.chatType === "group" && ctx.lastSenderStaffId ? {
						atUserIds: [ctx.lastSenderStaffId],
						isAtAll: false
					} : void 0
				})
			});
			if (!res.ok) return {
				ok: false,
				error: `钉钉发送失败（HTTP ${res.status}）`
			};
			const body = await res.json().catch(() => ({}));
			if (typeof body.errcode === "number" && body.errcode !== 0) return {
				ok: false,
				error: `钉钉发送失败（errcode=${body.errcode}）: ${body.errmsg ?? ""}`
			};
			return { ok: true };
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	/** 换 access_token（带缓存，提前 5 分钟过期） */
	async getAccessToken(fetchImpl, base) {
		const now = Date.now();
		if (this.tokenCache && this.tokenCache.expiresAt > now) return {
			ok: true,
			token: this.tokenCache.token
		};
		const body = await (await fetchImpl(`${base}?appkey=${encodeURIComponent(this.dingOpts.clientId)}&appsecret=${encodeURIComponent(this.dingOpts.clientSecret)}`)).json();
		if (body.errcode !== 0 || !body.access_token) return {
			ok: false,
			error: `获取钉钉 access_token 失败（errcode=${body.errcode}）: ${body.errmsg ?? ""}。请核对 AppKey / AppSecret`
		};
		const ttlMs = Math.max(0, (body.expires_in ?? 7200) * 1e3 - 3e5);
		this.tokenCache = {
			token: body.access_token,
			expiresAt: now + ttlMs
		};
		return {
			ok: true,
			token: body.access_token
		};
	}
	log(line) {
		logger.info(line);
		this.dingOpts.onLog?.(line);
	}
};
/** 从协议动作参数里抽文本（`message` 可以是字符串或分段数组） */
function extractText(params) {
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
* 钉钉**有** ActionCard，但它的结构与 QQ `keyboard` 完全不同，而官方文档我
* **没有核实过**（见 `docs/platforms/钉钉API开发参考.md` §9）——
* 所以先降级。**不静默丢弃**：用户会看到编号选项，能继续玩。
*/
function keyboardToPlainText(params) {
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

export { defaultWsFactory, DingTalkTranslator, extractText, keyboardToPlainText };
