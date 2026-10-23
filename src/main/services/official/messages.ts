// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { apiBase, authFetch, getSession } from "./client";
import { emitSystemLog } from "../runner/runtimeEvents";
import { isLocalFileSource, uploadLocalFileByParts } from "./media";

/**
* 把「输入中状态」的持续秒数夹到官方允许的 1~60 秒。
*
* `0` / 负数 / NaN / 空 一律当作**没填** → 回落 30 秒：
* 节点层在用户没填时传的正是 `0`（`Number(inputSecond) || 0`），
* 而官方范围是 1~60，所以 `0` 不可能是"我想要 0 秒" —— 把它夹成 1 秒
* 会让"没填"变成"闪一下"，那是个看不出来的行为改变。
*/
function clampInputSeconds(raw) {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 30;
	return Math.min(60, Math.max(1, Math.round(n)));
}
/**
* 将 keyboard 包装为 QQ 官方 API 期望的格式。
*
* QQ 官方 API 支持两种 keyboard 格式：
* 1. 模板格式：`{ id: '123' }` → 原样传递
* 2. 自定义格式：`{ content: { rows: [...], bot_appid: 123 } }` → 原样传递
* 3. 简化格式（来自用户配置）：`{ rows: [...] }` → 包装为 `{ content: { rows, bot_appid } }`
*
* @param keyboard 原始 keyboard 配置
* @param appIdStr bot 的 appId（字符串形式，会转换为 number）
* @returns 符合 QQ 官方 API 规范的 keyboard 对象
*/
function wrapKeyboardForApi(keyboard, appIdStr) {
	if (typeof keyboard === "string") try {
		const parsed = JSON.parse(keyboard);
		if (parsed && typeof parsed === "object") keyboard = parsed;
		else return {};
	} catch {
		return {};
	}
	if (!keyboard || typeof keyboard !== "object") return {};
	if ("id" in keyboard) return keyboard;
	if ("content" in keyboard) return keyboard;
	if ("rows" in keyboard) {
		const botAppId = Number(appIdStr);
		return { content: {
			rows: keyboard.rows,
			bot_appid: Number.isNaN(botAppId) ? 0 : botAppId
		} };
	}
	return keyboard;
}
/**
* 构造官方发消息请求体 —— **纯函数**，抽出来是为了能钉住**线上载荷形状**。
*
* ## 为什么必须能单测
*
* `sendOfficialMessage` 需要活的 session（token + 端点），测试里跑不到；
* 而这里产出的 body **就是发给 QQ 的线上契约**。"msg_type 与内容字段配对错了"
* 这类问题只有在这一层拦得住 —— 官方对不匹配的组合回 `22006 消息类型与内容不匹配`，
* 而那条错误在真机上很难归因（看起来像权限/参数问题）。
*
* 返回 `{ body: null, error }` 表示**本地就不该发**（例如输入中状态给了群聊）：
* 与其发出去换一个与被测行为无关的错误码，不如在这里停下并说清原因。
*/
function buildMessageBody(chatType, content, options, appId) {
	const body = { msg_type: options.msgType ?? 0 };
	if (options.ark || options.embed) return {
		body: null,
		error: `${options.ark ? "结构化卡片（ARK）" : "Embed 卡片"}发不出去：官方只有**频道**的发送接口有 ark/embed 字段，单聊与群聊的发送侧明确不支持（当前 chatType=${chatType}），已本地拒绝（不发送）。请把「推送目标类型」设为频道推送，或改用 Markdown / 按钮表达同样的内容。`
	};
	const wrappedKeyboard = options.keyboard ? wrapKeyboardForApi(options.keyboard, appId) : void 0;
	if (options.msgType === 6) {
		if (chatType !== "c2c") return {
			body: null,
			error: "输入中状态发不出去：官方只有单聊（c2c）端点有这个字段，当前 chatType=" + chatType + "，已本地拒绝（不发送）"
		};
		body.input_notify = {
			input_type: 1,
			input_second: clampInputSeconds(options.inputNotifySeconds)
		};
	} else if (options.msgType === 7 && options.media) body.media = { file_info: options.media.fileInfo };
	else if (options.msgType === 2 && options.markdown) {
		body.markdown = options.markdown;
		if (wrappedKeyboard) body.keyboard = wrappedKeyboard;
		if (options.forceVerifyImageResource) body.force_verify_image_resource = true;
	} else {
		body.content = content;
		if (wrappedKeyboard) body.keyboard = wrappedKeyboard;
	}
	if (options.isWakeup) body.is_wakeup = true;
	else {
		if (options.eventId) body.event_id = options.eventId;
		if (options.msgId) body.msg_id = options.msgId;
	}
	if (options.msgSeq != null) body.msg_seq = options.msgSeq;
	if (options.messageReference) body.message_reference = options.messageReference;
	return {
		body,
		error: ""
	};
}
async function sendOfficialMessage(projectPath, chatType, chatId, content, options = {}) {
	const session = getSession(projectPath);
	if (!session || !session.alive) {
		emitSystemLog(projectPath, "发送失败: session不存在或未连接", "error");
		return {
			ok: false,
			error: "session 不存在或未连接（机器人没在运行？）"
		};
	}
	const base = apiBase(session.sandbox);
	const endpoint = chatType === "c2c" ? `${base}/v2/users/${chatId}/messages` : chatType === "channel" ? `${base}/channels/${chatId}/messages` : `${base}/v2/groups/${chatId}/messages`;
	const built = chatType === "channel" ? buildChannelMessageBody(content, {
		markdown: options.markdown,
		media: options.media ? {
			fileInfo: options.media.fileInfo,
			url: options.mediaUrl
		} : null,
		ark: options.ark,
		embed: options.embed,
		msgId: options.msgId,
		eventId: options.eventId,
		messageReference: options.messageReference,
		keyboard: options.keyboard,
		isWakeup: options.isWakeup
	}) : buildMessageBody(chatType, content, options, session.appId);
	if (!built.body) {
		emitSystemLog(projectPath, "发送失败: " + built.error, "warn");
		return {
			ok: false,
			error: built.error
		};
	}
	const body = built.body;
	emitSystemLog(projectPath, "发送消息: chatType=" + chatType + ", chatId=" + chatId + ", content=\"" + content.slice(0, 50) + "\"");
	try {
		const res = await authFetch(session, endpoint, {
			method: "POST",
			body: JSON.stringify(body)
		});
		const data = await res.json();
		if (!res.ok) {
			emitSystemLog(projectPath, "消息发送失败: HTTP " + res.status + ", data=" + JSON.stringify(data), "error");
			return {
				ok: false,
				error: `HTTP ${res.status}` + (data.code ? ` code=${data.code}` : "") + (data.message ? `: ${data.message}` : "")
			};
		}
		emitSystemLog(projectPath, "消息发送成功: id=" + (data.id || ""));
		return {
			ok: true,
			data
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		emitSystemLog(projectPath, "消息发送异常: " + msg, "error");
		return {
			ok: false,
			error: msg
		};
	}
}
/**
* 流式发送**一片**（官方 `POST /v2/users/{openid}/stream_messages`）。
*
* ⚠️ **函数不接 chatType**：官方只有单聊流式端点（群聊接口明确"不支持流式参数"，
* 见 docs/platforms/QQ机器人官方能力清单.md §2.1/2.2）—— 拦群聊是**调用方**的责任，
* 这样"群聊也可以流式"这种误用在类型层就写不出来。
*
* `input_mode` 固定 `append`：本项目的分片计划（`@shared/message/stream`）产出的就是**增量**片，
* 天然满足官方"已下发内容前缀不可修改"的约束，也不需要把全文反复传上去。
*/
async function sendOfficialStreamMessage(projectPath, chatId, contentRaw, options) {
	const session = getSession(projectPath);
	if (!session || !session.alive) {
		emitSystemLog(projectPath, "流式发送失败: session不存在或未连接", "error");
		return { ok: false };
	}
	const endpoint = `${apiBase(session.sandbox)}/v2/users/${chatId}/stream_messages`;
	const body = {
		input_mode: "append",
		input_state: options.inputState,
		index: options.index,
		content_type: options.contentType === "markdown" ? "markdown" : "text",
		content_raw: contentRaw
	};
	if (options.streamMsgId) body.stream_msg_id = options.streamMsgId;
	if (options.eventId) body.event_id = options.eventId;
	if (options.msgId) body.msg_id = options.msgId;
	if (options.msgSeq != null) body.msg_seq = options.msgSeq;
	try {
		const res = await authFetch(session, endpoint, {
			method: "POST",
			body: JSON.stringify(body)
		});
		const data = await res.json();
		if (!res.ok) {
			emitSystemLog(projectPath, `流式发送失败: HTTP ${res.status}, index=${options.index}, data=` + JSON.stringify(data), "error");
			return { ok: false };
		}
		return {
			ok: true,
			data: { id: data.id || "" }
		};
	} catch (err) {
		emitSystemLog(projectPath, "流式发送异常: " + (err instanceof Error ? err.message : String(err)), "error");
		return { ok: false };
	}
}
async function uploadOfficialFile(projectPath, chatType, chatId, fileType, url, fileName) {
	const session = getSession(projectPath);
	if (!session || !session.alive) {
		emitSystemLog(projectPath, "发送失败: session不存在或未连接", "error");
		return { ok: false };
	}
	const base = apiBase(session.sandbox);
	const endpoint = chatType === "c2c" ? `${base}/v2/users/${chatId}/files` : `${base}/v2/groups/${chatId}/files`;
	if (isLocalFileSource(url)) {
		const localPath = url.startsWith("file://") ? decodeURIComponent(url.slice(7)) : url;
		const uploaded = await uploadLocalFileByParts({
			base,
			authFetch: (u, init) => authFetch(session, u, init)
		}, {
			chatType,
			chatId,
			filePath: localPath,
			fileType,
			fileName
		});
		if (!uploaded.ok) {
			emitSystemLog(projectPath, `分片上传失败: ${uploaded.error}`, "error");
			return { ok: false };
		}
		return {
			ok: true,
			data: {
				fileInfo: uploaded.fileInfo,
				fileUuid: uploaded.fileUuid,
				ttl: uploaded.ttl
			}
		};
	}
	const body = {
		file_type: fileType,
		url,
		srv_send_msg: false
	};
	if (fileName) body.file_name = fileName;
	try {
		const res = await authFetch(session, endpoint, {
			method: "POST",
			body: JSON.stringify(body)
		});
		const data = await res.json();
		return {
			ok: res.ok,
			data: {
				fileInfo: data.file_info ?? "",
				fileUuid: data.file_uuid ?? "",
				ttl: data.ttl ?? 0
			}
		};
	} catch (err) {
		emitSystemLog(projectPath, "官方文件上传异常: " + (err instanceof Error ? err.message : String(err)), "error");
		return { ok: false };
	}
}
/**
* 拼 QQ **频道**的消息请求体 —— **纯函数**，抽出来是为了能钉住**线上载荷形状**。
*
* 返回 `{ body: null, error }` 表示**本地就不该发**（与 {@link buildMessageBody} 同一约定）：
* 频道的规则是"`content` / `embed` / `ark` / `image` / `markdown` **至少要有一个**"，
* 一个字段都没有时服务端只会回一句含糊的错，不如在这里停下并说清原因。
*
* ## 为什么频道要单独一个构造器
*
* 频道和群聊/单聊是**两套请求体**，混用会被官方直接拒。逐条差异（测试钉着每一条）：
*
* | | 单聊 / 群聊 | 频道 |
* |---|---|---|
* | 文本 | `content` + `msg_type:0` | 只有 `content` |
* | markdown | `msg_type:2` + `markdown` | 只有 `markdown` |
* | 富媒体 | `msg_type:7` + `media.file_info` | `image`（平台自行拉取转存） |
* | **结构化卡片** | **不支持** | `ark`（需准入） |
* | **Embed** | **不支持** | `embed` |
* | 按钮 | `keyboard` | **不支持** |
* | 去重 | `msg_seq` 递增 | **没有 `msg_seq`** |
* | 唤醒 | `is_wakeup`（仅单聊） | **不消费**，只需 `msg_id` |
*
* 频道**没有上传流程**，所以本地文件发不出去（见 `sendOfficialMedia` 的 channel 分支）。
*
* 优先级：markdown > ark > embed > 媒体 > 纯文本。
*/
function buildChannelMessageBody(content, opts = {}) {
	const body = {};
	if (opts.markdown && String(opts.markdown.content ?? "").trim()) body.markdown = opts.markdown;
	else if (opts.ark) body.ark = {
		template_id: opts.ark.templateId,
		kv: opts.ark.kv
	};
	else if (opts.embed) body.embed = opts.embed;
	else if (opts.media && String(opts.media.url ?? "").trim()) {
		body.image = opts.media.url;
		if (String(content ?? "").trim()) body.content = content;
	} else if (String(content ?? "").trim()) body.content = content;
	if (opts.msgId) body.msg_id = opts.msgId;
	if (opts.eventId) body.event_id = opts.eventId;
	if (opts.messageReference) body.message_reference = opts.messageReference;
	opts.keyboard;
	opts.isWakeup;
	const CONTENT_KEYS = [
		"markdown",
		"ark",
		"embed",
		"image",
		"content"
	];
	if (!CONTENT_KEYS.some((k) => k in body)) return {
		body: null,
		error: `频道的消息至少要有一个内容字段（${CONTENT_KEYS.join(" / ")}）—— 官方原话是"至少需要有一个字段，否则无法下发消息"。当前一个都没有，已本地拒绝（不发送）。`
	};
	return {
		body,
		error: ""
	};
}
async function sendOfficialMedia(projectPath, chatType, chatId, mediaUrl, fileType, fileName, replyOptions) {
	if (chatType === "channel") {
		if (isLocalFileSource(mediaUrl)) return {
			ok: false,
			error: "频道不支持本地文件（频道没有上传流程）。请改用 http(s) 直链，或把文件发到单聊或群聊。"
		};
		if (!/^https?:\/\//i.test(String(mediaUrl ?? "").trim())) return {
			ok: false,
			error: "频道富媒体只接受 http(s) 直链（平台会自行拉取转存），当前地址不合法。"
		};
		return await sendOfficialMessage(projectPath, "channel", chatId, "", {
			mediaUrl,
			eventId: replyOptions?.eventId,
			msgId: replyOptions?.msgId
		});
	}
	const upload = await uploadOfficialFile(projectPath, chatType, chatId, fileType, mediaUrl, fileName);
	if (!upload.ok || !upload.data) return {
		ok: false,
		error: "富媒体上传失败（详见运行日志）"
	};
	return await sendOfficialMessage(projectPath, chatType, chatId, "", {
		msgType: 7,
		media: { fileInfo: upload.data.fileInfo },
		eventId: replyOptions?.eventId,
		msgId: replyOptions?.msgId
	});
}
async function recallOfficialMessage(projectPath, chatType, chatId, msgId) {
	const session = getSession(projectPath);
	if (!session || !session.alive) return false;
	const base = apiBase(session.sandbox);
	const endpoint = chatType === "c2c" ? `${base}/v2/users/${chatId}/messages/${msgId}` : `${base}/v2/groups/${chatId}/messages/${msgId}`;
	try {
		return (await authFetch(session, endpoint, { method: "DELETE" })).ok;
	} catch (err) {
		emitSystemLog(projectPath, "官方消息撤回异常: " + (err instanceof Error ? err.message : String(err)), "error");
		return false;
	}
}

export { clampInputSeconds, wrapKeyboardForApi, buildMessageBody, sendOfficialMessage, sendOfficialStreamMessage, uploadOfficialFile, buildChannelMessageBody, sendOfficialMedia, recallOfficialMessage };
