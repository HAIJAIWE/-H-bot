// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

var getMenu = async (host, { echo, responder }) => {
	const r = await host.callOfficialApi("GET", "/v2/menu");
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var setMenu = async (host, { params, echo, responder }) => {
	const rawMenu = params.menu;
	if (rawMenu === null || rawMenu === void 0 || rawMenu === "") {
		responder.fail(echo, "设置自定义菜单缺少必填字段：menu 不能为空");
		return;
	}
	const asObj = rawMenu && typeof rawMenu === "object" && !Array.isArray(rawMenu) ? rawMenu : null;
	const body = asObj && asObj.menu && typeof asObj.menu === "object" ? asObj : { menu: rawMenu };
	const r = await host.callOfficialApi("PUT", "/v2/menu", body);
	if (r.ok) responder.respond(echo, r.data);
	else responder.fail(echo, r.error);
};
var menuActions = {
	get_menu: getMenu,
	set_menu: setMenu
};

export { getMenu, setMenu, menuActions };
