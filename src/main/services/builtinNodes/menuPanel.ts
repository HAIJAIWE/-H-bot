// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/**
* 解析 json 类型端口。
*
* 画布里用户常直接把 JSON 贴进文本框，所以字符串要解析；
* 但**不能把解析失败当空值放过去** —— 那会变成「设置成功但什么都没设」。
*/
function coerceJsonPort(raw, label) {
	if (raw === null || raw === void 0 || raw === "") return {
		ok: false,
		error: `${label}不能为空`
	};
	if (typeof raw === "string") try {
		return {
			ok: true,
			value: JSON.parse(raw)
		};
	} catch (e) {
		return {
			ok: false,
			error: `${label} 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	return {
		ok: true,
		value: raw
	};
}
/**
* 一行文本的 openid 列表 → 去重后的数组（容忍中英文逗号、顿号、分号与空白）。
*
* 去重是必要的：重复的 openid 对官方没有意义，还会白占「单次最多 20 个」的额度。
* 翻译器侧还有一层同样的归一化（它也可能被 `api_call` 直接调用），
* 两边都做是刻意的纵深防御，**但取值规则必须一致**。
*/
function parseIdList(raw) {
	const items = Array.isArray(raw) ? raw.map((v) => String(v).trim()) : String(raw ?? "").split(/[\s,;，、]+/).map((v) => v.trim());
	return [...new Set(items.filter(Boolean))];
}
async function call(bot, action, params, label) {
	try {
		return {
			success: true,
			data: await bot.callApi(action, params) ?? {},
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			data: null,
			error: `${label}失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}
/** 自定义菜单：查询 / 设置（官方仅 C2C 单聊场景生效） */
async function menuConfig(bot, _event = null, options = {}) {
	const rawMode = options.mode ?? "get";
	if (rawMode !== "get" && rawMode !== "set") return {
		success: false,
		data: null,
		error: `未知的菜单模式: ${String(rawMode)}（可选 get / set）`
	};
	if (rawMode === "get") return call(bot, "get_menu", {}, "查询自定义菜单");
	const parsed = coerceJsonPort(options.menu, "菜单内容");
	if (!parsed.ok) return {
		success: false,
		data: null,
		error: parsed.error
	};
	return call(bot, "set_menu", { menu: parsed.value }, "设置自定义菜单");
}
/** 指令面板：列表 / 详情 / 创建 / 修改内容 / 修改生效对象 / 删除 */
async function panelConfig(bot, _event = null, options = {}) {
	const mode = String(options.mode ?? "list");
	switch (mode) {
		case "list": return call(bot, "list_panels", { scope: String(options.scope ?? "c2c") }, "查询指令面板列表");
		case "get": return call(bot, "get_panel", { panel_id: String(options.panel_id ?? "") }, "查询指令面板详情");
		case "delete": return call(bot, "delete_panel", { panel_id: String(options.panel_id ?? "") }, "删除指令面板");
		case "create": {
			const parsed = coerceJsonPort(options.panel, "面板内容");
			if (!parsed.ok) return {
				success: false,
				data: null,
				error: parsed.error
			};
			const payload = {
				scope: String(options.scope ?? "c2c"),
				target_type: String(options.target_type ?? "all"),
				panel: parsed.value
			};
			const users = parseIdList(options.user_openids);
			const groups = parseIdList(options.group_openids);
			if (users.length) payload.user_openids = users;
			if (groups.length) payload.group_openids = groups;
			return call(bot, "create_panel", payload, "创建指令面板");
		}
		case "update": {
			const parsed = coerceJsonPort(options.panel, "面板内容");
			if (!parsed.ok) return {
				success: false,
				data: null,
				error: parsed.error
			};
			return call(bot, "update_panel", {
				panel_id: String(options.panel_id ?? ""),
				panel: parsed.value
			}, "修改指令面板");
		}
		case "set_target": {
			const users = parseIdList(options.user_openids);
			const groups = parseIdList(options.group_openids);
			if (!users.length && !groups.length) return {
				success: false,
				data: null,
				error: "修改生效对象需要至少填写「指定用户」或「指定群」之一"
			};
			return call(bot, "set_panel_target", {
				panel_id: String(options.panel_id ?? ""),
				user_openids: users,
				group_openids: groups
			}, "修改指令面板关联对象");
		}
		default: return {
			success: false,
			data: null,
			error: `未知的面板模式: ${mode}`
		};
	}
}

export { coerceJsonPort, parseIdList, call, menuConfig, panelConfig };
