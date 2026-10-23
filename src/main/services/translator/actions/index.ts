// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { messageActions } from "./message";
import { channelActions } from "./channel";
import { groupActions } from "./group";
import { joinApprovalActions } from "./joinApproval";
import { menuActions } from "./menu";
import { panelActions } from "./panel";
import { miscActions } from "./misc";

var ALL_ACTION_HANDLERS = {
	...messageActions,
	...channelActions,
	...groupActions,
	...joinApprovalActions,
	...menuActions,
	...panelActions,
	...miscActions
};

export { ALL_ACTION_HANDLERS };
