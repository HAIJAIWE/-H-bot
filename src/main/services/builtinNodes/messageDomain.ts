// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { buildStreamChunkPlan } from "../../runtime/signals";

/** 发送一条消息，覆盖纯文本/按钮UI/消息段/合并转发 × 回复/推送 全部场景。 */
async function messageSend(bot, event, text = "", mode = "text", markdown = "", keyboard = null, segments = null, messages = null, userId = "", targetType = "", targetId = "", vars = {}, mediaUrl = "", mediaType = "", fileName = "", replyTo = "", isWakeup = false, streamContentType = "", streamChunkSize = 0, streamIntervalMs = 300, inputSecond = 0, arkTemplateId = "", arkKv = "", embedTitle = "", embedPrompt = "", embedDescription = "", embedThumbnail = "", embedFields = "", forceVerifyImageResource = false) {
	const modeStr = String(mode || "text");
	const targetTypeStr = String(targetType || "").toLowerCase();
	const targetIdStr = String(targetId || "").trim();
	const isPush = ["user", "group"].includes(targetTypeStr) && targetIdStr;
	/**
	* 可选参数只在**有值**时才带上。
	*
	* 空串不是"没填"：`reply_to: ''` 会让官方按"引用一条空消息"处理，
	* `is_wakeup: false` 也无谓地把普通推送声明成召回。所以一律用 spread 有条件地加。
	*/
	const replyToStr = String(replyTo ?? "").trim();
	const withReplyTo = replyToStr ? { reply_to: replyToStr } : {};
	/** 互动召回只对**单聊**有效：群聊接口没有该字段（官方文档） */
	const wakeupFor = (chatType) => isWakeup === true && chatType === "private" ? { is_wakeup: true } : {};
	/**
	* 渲染 `{var1}~{var4}` 占位符。
	*
	* 复用「文本模板」节点的同一套规则（对象→JSON、数组→逗号连接、缺失的键原样保留），
	* 所以文案里普通的 `{}` 不会被吃掉；没连任何变量时整段原样返回。
	*/
	const renderTemplate = (tpl) => Object.keys(vars).length > 0 ? formatText(tpl, vars).result : tpl;
	if ((modeStr === "ark" || modeStr === "embed") && targetTypeStr !== "channel") return {
		success: false,
		message_id: "",
		error: `${modeStr === "ark" ? "结构化卡片（ARK）" : "Embed 卡片"}只有**频道**发得出去：官方支持矩阵里单聊与群聊的发送侧都不支持（那两个端点没有对应的字段）。请把「推送目标类型」设为**频道推送**并填子频道 ID；如果这条消息本来要发到群里，请改用 Markdown 或按钮模式表达同样的内容。`
	};
	if (targetTypeStr === "channel") {
		if (!targetIdStr) return {
			success: false,
			message_id: "",
			error: "「频道推送」需要填「推送目标 ID」（子频道 channel_id）。留空的话这个消息会不知道发到哪，已本地拒绝（未发送）。"
		};
		return await sendToChannel(bot, {
			text,
			markdown,
			media_url: mediaUrl,
			ark_template_id: arkTemplateId,
			ark_kv: arkKv,
			embed_title: embedTitle,
			embed_prompt: embedPrompt,
			embed_description: embedDescription,
			embed_thumbnail: embedThumbnail,
			embed_fields: embedFields
		}, modeStr, targetIdStr, renderTemplate, withReplyTo);
	}
	if (modeStr === "keyboard") {
		if (!keyboard) return {
			success: false,
			message_id: "",
			error: "keyboard 不能为空"
		};
		return await sendKeyboard(bot, event, renderTemplate(String(markdown ?? "")), keyboard, targetTypeStr, targetIdStr);
	}
	if (modeStr === "segment") return await sendSegment(bot, event, segments, targetTypeStr, targetIdStr);
	if (modeStr === "forward") return await sendForward(bot, event, messages, String(userId || ""), targetTypeStr, targetIdStr);
	if (modeStr === "media") {
		const url = String(mediaUrl ?? "").trim();
		if (!url) return {
			success: false,
			message_id: "",
			error: "media_url 不能为空"
		};
		if (!/^https?:\/\//i.test(url)) return {
			success: false,
			message_id: "",
			error: `富媒体只支持 http(s) 直链（官方由服务端拉取转存），本地路径发不出去：${url.slice(0, 80)}。请先把文件上传到可访问的地址。`
		};
		const [target] = resolveTarget(event, targetTypeStr, targetIdStr, { includeMessageId: false });
		if (!target || !target.message_type) return {
			success: false,
			message_id: "",
			error: "无法从事件中确定发送目标"
		};
		const chatType = target.message_type === "group" ? "group" : "private";
		const fileNameStr = String(fileName ?? "").trim();
		try {
			return {
				success: true,
				message_id: responseMessageId(await bot.callApi("send_media", {
					url,
					media_type: String(mediaType ?? "").trim() || "image",
					...target,
					...fileNameStr ? { file_name: fileNameStr } : {},
					...withReplyTo,
					...wakeupFor(chatType)
				})),
				error: ""
			};
		} catch (e) {
			return {
				success: false,
				message_id: "",
				error: (e instanceof Error ? e : new Error(String(e))).message
			};
		}
	}
	if (modeStr === "stream") {
		const streamText = renderTemplate(String(text ?? ""));
		if (!streamText.trim()) return {
			success: false,
			message_id: "",
			error: "流式模式需要正文（text）"
		};
		if (targetTypeStr !== "user" || !targetIdStr) return {
			success: false,
			message_id: "",
			error: "流式消息仅支持单聊：请把「推送目标类型」设为私聊推送并填目标 ID"
		};
		const plan = buildStreamChunkPlan(streamText, { chunkSize: Number(streamChunkSize) });
		if (plan.length === 0) return {
			success: false,
			message_id: "",
			error: "流式模式正文为空"
		};
		const contentType = String(streamContentType ?? "").trim() === "markdown" ? "markdown" : "text";
		const intervalMs = Number.isFinite(Number(streamIntervalMs)) ? Number(streamIntervalMs) : 300;
		let streamMsgId = "";
		const baseParams = {
			message_type: "private",
			user_id: targetIdStr,
			content_type: contentType
		};
		for (const chunk of plan) {
			try {
				const mid = responseMessageId(await bot.callApi("send_stream_msg", {
					...baseParams,
					content_raw: chunk.contentRaw,
					index: chunk.index,
					input_state: chunk.inputState,
					...streamMsgId ? { stream_msg_id: streamMsgId } : {}
				}));
				if (!streamMsgId && mid) streamMsgId = mid;
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				if (streamMsgId) try {
					await bot.callApi("send_stream_msg", {
						...baseParams,
						content_raw: "",
						index: chunk.index + 1,
						input_state: 10,
						stream_msg_id: streamMsgId
					});
				} catch {}
				return {
					success: false,
					message_id: streamMsgId,
					error: `流式发送在第 ${chunk.index} 片失败：${err.message}`
				};
			}
			if (intervalMs > 0 && chunk.index < plan.length - 1) await new Promise((r) => setTimeout(r, intervalMs));
		}
		return {
			success: true,
			message_id: streamMsgId,
			error: ""
		};
	}
	if (modeStr === "markdown") {
		const mdStr = renderTemplate(String(markdown ?? "") || String(text ?? ""));
		if (!mdStr.trim()) return {
			success: false,
			message_id: "",
			error: "markdown 不能为空"
		};
		const rows = keyboard?.rows;
		if (keyboard && typeof keyboard === "object" && Array.isArray(rows)) return await sendKeyboard(bot, event, mdStr, keyboard, targetTypeStr, targetIdStr, {
			...withReplyTo,
			...wakeupFor(isPush && targetTypeStr === "group" ? "group" : "private")
		});
		try {
			await bot.callApi("send_msg", {
				message: [{
					type: "markdown",
					data: {
						content: mdStr,
						force_verify_image_resource: forceVerifyImageResource === true || forceVerifyImageResource === "true"
					}
				}],
				...buildTargetParams(event),
				...withReplyTo,
				...wakeupFor(isPush && targetTypeStr === "group" ? "group" : "private")
			});
			return {
				success: true,
				message_id: "",
				error: ""
			};
		} catch (e) {
			return {
				success: false,
				message_id: "",
				error: (e instanceof Error ? e : new Error(String(e))).message
			};
		}
	}
	if (modeStr === "input_notify") {
		if (!isPush) return {
			success: false,
			message_id: "",
			error: "「输入中状态」需要指定目标：请设「目标类型 = 用户」并填「目标 ID」"
		};
		if (targetTypeStr === "group") return {
			success: false,
			message_id: "",
			error: "「输入中状态」只有单聊能用：官方 msg_type=6 仅 C2C 端点有这个字段，群聊没有对应的能力（不是\"发了被忽略\"，是根本没有）。"
		};
		try {
			const [targetParams] = resolveTarget(event, targetTypeStr, targetIdStr);
			return {
				success: true,
				message_id: responseMessageId(await bot.callApi("send_input_notify", {
					...targetParams,
					input_second: Number(inputSecond) || 0
				})),
				error: ""
			};
		} catch (e) {
			return {
				success: false,
				message_id: "",
				error: (e instanceof Error ? e : new Error(String(e))).message
			};
		}
	}
	if (!text) return {
		success: false,
		message_id: "",
		error: "text 不能为空"
	};
	try {
		if (isPush) {
			const msg = renderTemplate(String(text));
			const [targetParams] = resolveTarget(event, targetTypeStr, targetIdStr);
			if (targetTypeStr === "group") return {
				success: true,
				message_id: responseMessageId(await bot.callApi("send_group_msg", {
					...targetParams,
					message: msg,
					...withReplyTo
				})),
				error: ""
			};
			else return {
				success: true,
				message_id: responseMessageId(await bot.callApi("send_private_msg", {
					...targetParams,
					message: msg,
					...withReplyTo,
					...wakeupFor("private")
				})),
				error: ""
			};
		}
		await bot.callApi("send_msg", {
			message: renderTemplate(String(text)),
			...buildTargetParams(event),
			...withReplyTo,
			...wakeupFor(event?.group_id ? "group" : "private")
		});
		return {
			success: true,
			message_id: "",
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			message_id: "",
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
/**
* 把「发消息」的各个模式映射成**频道**的请求字段，并调 `send_channel_msg`。
*
* ## 为什么单独一个函数
*
* 频道的请求体与 OneBot 的 `message` 不是一回事（见调用点的说明）。把它收在这里，
* 好处是"频道支持哪些形态、不支持哪些"能一眼看完 —— 而不是散在七个模式分支里。
*
* ## 映射表（每一项都对应官方频道发送接口的某个字段）
*
* | 模式 | 频道字段 | 说明 |
* |---|---|---|
* | text / stream | `content` | 频道没有流式接口，正文就是普通文本 |
* | markdown | `markdown` | |
* | media | `image` | 频道富媒体就是直链，平台自行拉取（没有上传流程） |
* | **ark** | `ark` | 结构化卡片，**需准入** |
* | **embed** | `embed` | Embed 卡片 |
* | keyboard | —— | **拒绝**：频道接口没有 `keyboard` 字段（按钮挂在 markdown 底部，是群聊/单聊的能力） |
* | segment / forward / input_notify | —— | **拒绝**：频道没有对应的官方能力 |
*
* 「拒绝」都带**可执行的下一步**，不是只说"不行"。
*/
async function sendToChannel(bot, config, mode, channelId, renderTemplate, withReplyTo) {
	const params = {
		channel_id: channelId,
		...withReplyTo
	};
	const md = String(config.markdown ?? "");
	switch (mode) {
		case "text":
		case "stream":
			params.content = renderTemplate(String(config.text ?? ""));
			break;
		case "markdown":
			params.markdown = renderTemplate(md || String(config.text ?? ""));
			break;
		case "media": {
			const url = String(config.media_url ?? "").trim();
			if (!url) return {
				success: false,
				message_id: "",
				error: "media_url 不能为空"
			};
			params.image = url;
			break;
		}
		case "ark": {
			const templateId = Number(config.ark_template_id);
			if (!Number.isInteger(templateId) || templateId <= 0) return {
				success: false,
				message_id: "",
				error: "「结构化卡片」缺少模板 ID：请填官方模板 id（文档给出的是 23 / 24 / 37）。卡片是\"选模板 + 填变量\"，没有模板就无从渲染。"
			};
			const kv = parseArkKv(config.ark_kv);
			if (typeof kv === "string") return {
				success: false,
				message_id: "",
				error: kv
			};
			params.ark = {
				templateId,
				kv
			};
			break;
		}
		case "embed": {
			const title = String(config.embed_title ?? "").trim();
			if (!title) return {
				success: false,
				message_id: "",
				error: "「Embed 卡片」缺少标题：官方 Embed 里 `title` 是唯一必填字段。"
			};
			const embed = { title };
			const prompt = String(config.embed_prompt ?? "").trim();
			if (prompt) embed.prompt = prompt;
			const desc = String(config.embed_description ?? "").trim();
			if (desc) embed.description = desc;
			const thumb = String(config.embed_thumbnail ?? "").trim();
			if (thumb) embed.thumbnail = { url: thumb };
			const fields = parseEmbedFields(config.embed_fields);
			if (typeof fields === "string") return {
				success: false,
				message_id: "",
				error: fields
			};
			if (fields.length > 0) embed.fields = fields;
			params.embed = embed;
			break;
		}
		case "keyboard": return {
			success: false,
			message_id: "",
			error: "频道发不了按钮：频道发送接口没有 `keyboard` 字段（按钮是挂在 markdown 消息底部的，只有单聊/群聊有）。请把模式改成「Markdown / 按钮」以外的形态，或把这条消息发到群聊。"
		};
		case "segment": return {
			success: false,
			message_id: "",
			error: "频道发不了消息段：官方频道发送接口只有 content / markdown / ark / embed / image 五种字段，没有 OneBot 消息段。请改用文本或 Markdown。"
		};
		case "forward": return {
			success: false,
			message_id: "",
			error: "频道发不了合并转发：官方没有频道的合并转发接口。请把这条消息发到群聊，或改用 Markdown。"
		};
		case "input_notify": return {
			success: false,
			message_id: "",
			error: "频道没有「输入中状态」：官方 msg_type=6 只有单聊端点有该字段。这个模式只对「私聊推送」有意义。"
		};
		default: return {
			success: false,
			message_id: "",
			error: `未知的发送模式「${mode}」，频道不知道该发什么形态（已本地拒绝，未发送）。`
		};
	}
	try {
		return {
			success: true,
			message_id: responseMessageId(await bot.callApi("send_channel_msg", params)),
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			message_id: "",
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
/**
* 解析 ARK 的模板变量（`kv`）。
*
* 接受官方那两种形态：标量 `{key, value}` 与数组型 `{key, obj:[{obj_kv:[{key,value}]}]}`。
* **原样透传**，不重排、不压平 —— 官方对每个模板的变量类型有自己的要求，替他"整理"只会更难查。
*
* 返回 `string` 表示**错误信息**（调用方直接当 error 用），返回数组表示解析成功。
*/
function parseArkKv(raw) {
	if (raw === void 0 || raw === null || String(raw).trim() === "") return [];
	let parsed;
	try {
		parsed = JSON.parse(String(raw));
	} catch (e) {
		return `「卡片变量」不是合法 JSON：${e instanceof Error ? e.message : String(e)}。应当是 [{"key":"#DESC#","value":"…"}]`;
	}
	if (!Array.isArray(parsed)) return "「卡片变量」应当是一个 JSON 数组，例如 [{\"key\":\"#DESC#\",\"value\":\"通知\"}]";
	const out = [];
	for (const item of parsed) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return "「卡片变量」的每一项都应当是对象（{\"key\":\"#XXX#\",\"value\":\"…\"}）";
		const kv = item;
		if (!String(kv.key ?? "").trim()) return "「卡片变量」有一项缺少 key（形如 \"#DESC#\"）";
		if (kv.value === void 0 && kv.obj === void 0) return `「卡片变量」${String(kv.key)} 既没有 value 也没有 obj（数组型变量要用 obj/obj_kv）`;
		out.push(kv);
	}
	return out;
}
/**
* 解析 Embed 的 `fields`。
*
* 官方结构是 `[{name: "当前等级：黄金"}]`，但**纯字符串数组也收**（`["当前等级：黄金"]`）——
* 画布上填一串行文本比让人手写 JSON 对象常见得多，而这两种写法表达的是同一件事。
*/
function parseEmbedFields(raw) {
	if (raw === void 0 || raw === null || String(raw).trim() === "") return [];
	let parsed;
	try {
		parsed = JSON.parse(String(raw));
	} catch (e) {
		return `「卡片字段」不是合法 JSON：${e instanceof Error ? e.message : String(e)}。应当是 ["当前等级：黄金"] 或 [{"name":"当前等级：黄金"}]`;
	}
	if (!Array.isArray(parsed)) return "「卡片字段」应当是一个 JSON 数组，例如 [\"当前等级：黄金\"]";
	const out = [];
	for (const item of parsed) {
		if (typeof item === "string") {
			if (item.trim()) out.push({ name: item });
			continue;
		}
		if (item && typeof item === "object" && !Array.isArray(item)) {
			const name = String(item.name ?? "").trim();
			if (name) out.push({ name });
			continue;
		}
		return "「卡片字段」的每一项应当是字符串或 {\"name\": \"…\"}";
	}
	return out;
}
async function messageRecall(bot, event, messageId = 0) {
	const mid = messageId || event?.message_id || 0;
	if (!mid) return {
		success: false,
		error: "message_id 不能为空"
	};
	try {
		await bot.callApi("delete_msg", { message_id: mid });
		return {
			success: true,
			error: ""
		};
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		if (err.message.includes("1300") || err.message.includes("权限")) return {
			success: false,
			error: "机器人权限不足（需要管理员/群主权限）"
		};
		return {
			success: false,
			error: err.message
		};
	}
}
async function messageEdit(bot, _event = null, messageId = "", newText = "") {
	if (!messageId) return {
		success: false,
		error: "message_id 为空"
	};
	if (!newText) return {
		success: false,
		error: "new_text 为空"
	};
	try {
		await bot.callApi("edit_msg", {
			message_id: messageId,
			message: newText
		});
		return {
			success: true,
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
function keyboardToSegments(markdown, keyboard) {
	const segments = [{
		type: "markdown",
		data: { content: String(markdown) }
	}];
	if (keyboard && keyboard.rows) segments.push({
		type: "keyboard",
		data: { content: keyboard }
	});
	return segments;
}
async function sendKeyboard(bot, event, markdown, keyboard, targetType = "", targetId = "", extra = {}) {
	if (!markdown) return {
		success: false,
		message_id: "",
		error: "markdown 不能为空"
	};
	if (!keyboard || typeof keyboard !== "object") return {
		success: false,
		message_id: "",
		error: "keyboard 按钮配置不能为空"
	};
	const [target, msgId] = resolveTarget(event, targetType, targetId);
	if (!target) return {
		success: false,
		message_id: "",
		error: "无法从事件中确定回复目标"
	};
	const mdStr = String(markdown);
	const errors = [];
	try {
		const params = {
			markdown: mdStr,
			keyboard,
			...target,
			...extra
		};
		if (msgId) params.msg_id = msgId;
		console.info(`[message_send] 按钮UI模式-方式1: send_keyboard_msg, message_type=${target.message_type}`);
		const mid = responseMessageId(await bot.callApi("send_keyboard_msg", params));
		if (mid) {
			console.info(`[message_send] 按钮UI模式-方式1成功: message_id=${mid}`);
			return {
				success: true,
				message_id: mid,
				error: ""
			};
		}
		errors.push("send_keyboard_msg 返回空 message_id");
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		console.warn(`[message_send] 按钮UI模式-方式1不可用: ${err.name}: ${err.message}`);
		errors.push(`send_keyboard_msg: ${err.message}`);
	}
	try {
		const params2 = {
			message: keyboardToSegments(mdStr, keyboard),
			...target
		};
		if (msgId) params2.msg_id = msgId;
		console.info(`[message_send] 按钮UI模式-方式2: send_msg(markdown+keyboard 段), message_type=${target.message_type}`);
		const mid2 = responseMessageId(await bot.callApi("send_msg", params2));
		if (mid2) {
			console.info(`[message_send] 按钮UI模式-方式2成功: message_id=${mid2}`);
			return {
				success: true,
				message_id: mid2,
				error: ""
			};
		}
		errors.push("send_msg(markdown+keyboard) 返回空 message_id");
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		console.warn(`[message_send] 按钮UI模式-方式2不可用: ${err.name}: ${err.message}`);
		errors.push(`send_msg(markdown+keyboard): ${err.message}`);
	}
	const errSummary = errors.join("；");
	console.error(`[message_send] 按钮UI模式-所有发送方式均失败: ${errSummary}`);
	try {
		if (target.message_type === "group") await bot.callApi("send_group_msg", {
			group_id: target.group_id,
			message: String(markdown)
		});
		else if (target.message_type === "private") await bot.callApi("send_private_msg", {
			user_id: target.user_id,
			message: String(markdown)
		});
		else await bot.callApi("send_msg", {
			message: String(markdown),
			...target
		});
		console.warn("[message_send] 按钮UI发送失败，已降级为纯文本发送");
		return {
			success: true,
			message_id: "",
			error: ""
		};
	} catch (fallback_e) {
		console.error(`[message_send] 按钮UI降级发送也失败: ${fallback_e}`);
	}
	return {
		success: false,
		message_id: "",
		error: `当前适配器不支持按钮消息（已尝试 send_keyboard_msg 和 send_msg+markdown/keyboard 段）: ${errSummary}`
	};
}
function buildForwardNodes(messages, userId, event) {
	let uid = String(userId || (event || {}).user_id || "");
	let msgList = [];
	if (typeof messages === "string") try {
		msgList = JSON.parse(messages);
	} catch (e) {
		return [[], `messages JSON 解析失败: ${e}`];
	}
	else if (Array.isArray(messages)) msgList = messages;
	else return [[], "messages 格式错误，需要 JSON 字符串或 list"];
	if (!Array.isArray(msgList) || !msgList.length) return [[], "messages 为空或格式错误"];
	if (msgList.length > 200) return [[], "合并转发消息数超过上限 200"];
	return [msgList.map((msg) => {
		const m = msg;
		const msgContent = m.content || "";
		const senderId = String(m.user_id || uid);
		return {
			type: "node",
			data: {
				name: m.name || "",
				uin: senderId,
				content: msgContent
			}
		};
	}), ""];
}
async function sendSegment(bot, event, segments, targetType, targetId) {
	if (!segments) return {
		success: false,
		message_id: "",
		error: "segments 不能为空"
	};
	try {
		const [target] = resolveTarget(event, targetType, targetId);
		return {
			success: true,
			message_id: responseMessageId(await bot.callApi("send_msg", {
				message: segments,
				...target
			})),
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			message_id: "",
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
async function sendForward(bot, event, messages, userId, targetType, targetId) {
	try {
		const [nodes, err] = buildForwardNodes(messages, userId, event);
		if (err) return {
			success: false,
			message_id: "",
			error: err
		};
		let groupId = "";
		if (targetType === "group" && targetId) groupId = targetId;
		if (!groupId) return {
			success: false,
			message_id: "",
			error: "合并转发需要群聊目标"
		};
		return {
			success: true,
			message_id: responseMessageId(await bot.callApi("send_group_forward_msg", {
				group_id: groupId,
				messages: nodes
			})),
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			message_id: "",
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
function buildTargetParams(event, opts = {}) {
	const msgId = opts.includeMessageId === false ? "" : eventMessageId(event);
	const withMsgId = msgId ? { message_id: msgId } : {};
	if (event?.channel_id) return {
		message_type: "channel",
		channel_id: String(event.channel_id),
		...withMsgId
	};
	if (event?.group_id) return {
		message_type: "group",
		group_id: String(event.group_id),
		...withMsgId
	};
	if (event?.user_id) return {
		message_type: "private",
		user_id: String(event.user_id),
		...withMsgId
	};
	return {};
}
function extractMsgId(event) {
	try {
		const msgId = event.get_message_id?.();
		return msgId ? String(msgId) : "";
	} catch {
		return "";
	}
}
function resolveTarget(event, targetType, targetId, opts = {}) {
	const selfMsgId = eventMessageId(event);
	/**
	* ⚠️ 只有**回复当前会话**时才带上触发消息的 id。
	*
	* 主动推给**别的**会话时带上它是错的：那条 eventId 属于触发这条流程的消息，
	* 不属于目标会话 —— 官方会拒，或者归错条。所以这里按"目标是否就是事件本身的会话"决定。
	*/
	const sameConversation = (kind) => String((kind === "user" ? event?.user_id : event?.group_id) ?? "") === String(targetId);
	const withMsgId = (kind) => selfMsgId && sameConversation(kind) ? { message_id: selfMsgId } : {};
	if (targetType === "user" && targetId) return [{
		message_type: "private",
		user_id: String(targetId),
		...withMsgId("user")
	}, ""];
	if (targetType === "group" && targetId) return [{
		message_type: "group",
		group_id: String(targetId),
		...withMsgId("group")
	}, ""];
	if (targetType === "channel" && targetId) return [{
		message_type: "channel",
		channel_id: String(targetId)
	}, ""];
	return [buildTargetParams(event, opts), extractMsgId(event)];
}
/** 从 OneBot API 返回里取 message_id（返回体形状由适配器决定，故按 unknown 收窄） */
function responseMessageId(resp) {
	if (resp && typeof resp === "object" && "message_id" in resp) {
		const mid = resp.message_id;
		return mid === void 0 || mid === null ? "" : String(mid);
	}
	return "";
}
/**
* 翻译器给这条事件分配的 `message_id`（= `hashToInt(官方 eventId)`）。
*
* 被动回复**必须**把它带回去：官方要求引用"触发它的那条消息"，
* 而翻译器按目标 openid 存的槽位会被同群后来的消息覆盖 ——
* 不带回去的话，A 触发的回复会引用 B 的 event_id（被官方按错条归属或去重）。
*/
function eventMessageId(event) {
	const mid = event?.message_id;
	return mid === void 0 || mid === null || String(mid) === "" ? "" : String(mid);
}
function formatText(template = "", variables = {}) {
	/**
	* 把值渲染成文本。
	*
	* 历史实现直接用 `String(value)`：于是 `variable_merge(dict)` 的输出、`json_op` 解析出的
	* 对象，在消息里全是 `[object Object]`（对小白来说等于"坏了"）。对象改按 JSON 渲染，
	* 数组仍按元素连接（与原行为一致：`['a','b']` → `a,b`）。
	*/
	const render = (v) => {
		if (v === null || v === void 0) return "";
		if (typeof v === "string") return v;
		if (typeof v === "number" || typeof v === "boolean") return String(v);
		if (Array.isArray(v)) return v.map(render).join(",");
		if (typeof v === "object") try {
			return JSON.stringify(v);
		} catch {
			return String(v);
		}
		return String(v);
	};
	try {
		let result = template;
		for (const [key, value] of Object.entries(variables)) result = result.replace(new RegExp(`\\{${key}\\}`, "g"), render(value));
		return {
			result,
			error: ""
		};
	} catch (e) {
		return {
			result: "",
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}

export { messageSend, sendToChannel, parseArkKv, parseEmbedFields, messageRecall, messageEdit, keyboardToSegments, sendKeyboard, buildForwardNodes, sendSegment, sendForward, buildTargetParams, extractMsgId, resolveTarget, responseMessageId, eventMessageId, formatText };
