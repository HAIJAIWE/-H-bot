// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { messageActions } from "./message";
import { channelActions } from "./channel";
import { channelExtraActions } from "./channelRest";
import { groupActions } from "./group";
import { joinApprovalActions } from "./joinApproval";
import { menuActions } from "./menu";
import { panelActions } from "./panel";
import { miscActions } from "./misc";

var ALL_ACTION_HANDLERS = {
	...messageActions,
	...channelActions,
	// 频道「私域 REST 家族」：34 个模式与 channel_op 的选项表同源（见 channelRest.ts）
	...channelExtraActions,
	...groupActions,
	...joinApprovalActions,
	...menuActions,
	...panelActions,
	...miscActions
};

export { ALL_ACTION_HANDLERS };
export { LEGACY_ACTION_ALIASES, normalizeActionName } from "./aliases";
