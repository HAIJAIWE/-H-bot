// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

var listJoinApprovalStrategies = async (host, { params, echo, responder }) => {
	const qs = new URLSearchParams();
	if (params.cursor) qs.set("cursor", String(params.cursor));
	if (params.limit) qs.set("limit", String(params.limit));
	const q = qs.toString();
	const r = await host.callOfficialApi("GET", `/v2/groups/join_approval_strategy${q ? `?${q}` : ""}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var createJoinApprovalStrategy = async (host, { params, echo, responder }) => {
	const r = await host.callOfficialApi("POST", "/v2/groups/join_approval_strategy", params.body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var updateJoinApprovalStrategy = async (host, { params, echo, responder }) => {
	const id = String(params.strategy_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "strategy_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("PATCH", `/v2/groups/join_approval_strategy/${id}`, params.body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var deleteJoinApprovalStrategy = async (host, { params, echo, responder }) => {
	const id = String(params.strategy_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "strategy_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("DELETE", `/v2/groups/join_approval_strategy/${id}`);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var executeJoinApprovalStrategy = async (host, { params, echo, responder }) => {
	const id = String(params.strategy_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "strategy_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("POST", `/v2/groups/join_approval_strategy/${id}/execute`);
	if (r.ok) responder.respond(echo, {
		accepted: true,
		...r.data
	});
	else responder.fail(echo, r.error);
};
var updateStrategyWhitelist = async (host, { params, echo, responder }) => {
	const id = String(params.strategy_id ?? "").trim();
	if (!id) {
		responder.fail(echo, "strategy_id 不能为空");
		return;
	}
	const r = await host.callOfficialApi("POST", `/v2/groups/join_approval_strategy/${id}/whitelist_users`, params.body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var joinApprovalActions = {
	list_join_approval_strategies: listJoinApprovalStrategies,
	create_join_approval_strategy: createJoinApprovalStrategy,
	update_join_approval_strategy: updateJoinApprovalStrategy,
	delete_join_approval_strategy: deleteJoinApprovalStrategy,
	execute_join_approval_strategy: executeJoinApprovalStrategy,
	update_strategy_whitelist: updateStrategyWhitelist
};

export { listJoinApprovalStrategies, createJoinApprovalStrategy, updateJoinApprovalStrategy, deleteJoinApprovalStrategy, executeJoinApprovalStrategy, updateStrategyWhitelist, joinApprovalActions };
