// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

var listPanels = async (host, { params, echo, responder }) => {
	const scope = String(params.scope ?? "c2c");
	const r = await host.callOfficialApi("GET", `/v2/panels?scope=${encodeURIComponent(scope)}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var getPanel = async (host, { params, echo, responder }) => {
	const id = String(params.panel_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "panel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("GET", `/v2/panels/${id}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var createPanel = async (host, { params, echo, responder }) => {
	const rawBody = params.body;
	const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {
		scope: params.scope,
		target_type: params.target_type,
		panel: params.panel
	};
	if (!body.scope || !body.panel) {
		responder.fail(echo, "创建指令面板缺少必填字段：官方要求 scope（c2c/group/channel/dm）与 panel（面板内容）都要给");
		return;
	}
	const r = await host.callOfficialApi("POST", "/v2/panels", body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var updatePanel = async (host, { params, echo, responder }) => {
	const id = String(params.panel_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "panel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("PUT", `/v2/panels/${id}`, params.panel);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var deletePanel = async (host, { params, echo, responder }) => {
	const id = String(params.panel_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "panel_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("DELETE", `/v2/panels/${id}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var setPanelTarget = async (host, { params, echo, responder }) => {
	const id = String(params.panel_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "panel_id 不能为空");
		return;
	}
	const rawTarget = params.body;
	const targetBody = rawTarget && typeof rawTarget === "object" && !Array.isArray(rawTarget) ? rawTarget : {
		user_openids: params.user_openids,
		group_openids: params.group_openids
	};
	const r = await host.callOfficialApi("PUT", `/v2/panels/${id}/target`, targetBody);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var panelActions = {
	list_panels: listPanels,
	get_panel: getPanel,
	create_panel: createPanel,
	update_panel: updatePanel,
	delete_panel: deletePanel,
	set_panel_target: setPanelTarget
};

export { listPanels, getPanel, createPanel, updatePanel, deletePanel, setPanelTarget, panelActions };
