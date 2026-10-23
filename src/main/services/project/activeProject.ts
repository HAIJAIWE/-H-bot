// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as path from "path";

/**
* 判"同一个项目"用的规范化：绝对路径 + Windows 下大小写不敏感。
*
* 为什么不能直接比字符串：渲染层传来的路径可能带尾分隔符 / 大小写不同
* （`D:\QQ bot\projects\A` vs `d:\qq bot\projects\a`），而 Windows 上它们是同一个目录。
*/
function normalizeProjectPath(projectPath) {
	const resolved = (0, path.resolve)(projectPath);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
var ActiveProjectRegistry = class {
	/** 渲染层声明的当前项目：原文（给用户看）与规范化 key（给比较用） */
	activeRaw = null;
	activeKey = null;
	/** 渲染层把某个项目设为"当前打开的项目"（切项目后拉 meta / 新建 / 克隆时登记） */
	noteViewed(projectPath) {
		if (!projectPath) {
			this.clear();
			return;
		}
		this.activeRaw = projectPath;
		this.activeKey = normalizeProjectPath(projectPath);
	}
	clear() {
		this.activeRaw = null;
		this.activeKey = null;
	}
	/** 项目被删除时，若镜像正指着它就一起清掉（否则会拿一个不存在的路径去拦保存） */
	clearIfMatches(projectPath) {
		if (this.activeKey && this.activeKey === normalizeProjectPath(projectPath)) this.clear();
	}
	/** 当前项目原文（没有记录返回 null = 不知道） */
	getActivePath() {
		return this.activeRaw;
	}
	/** 目标是不是"当前打开的项目"；没有记录时返回 true（fail-open） */
	isActive(projectPath) {
		if (!this.activeKey) return true;
		return this.activeKey === normalizeProjectPath(projectPath);
	}
};
var activeProjectRegistry = new ActiveProjectRegistry();

export { normalizeProjectPath, ActiveProjectRegistry, activeProjectRegistry };
