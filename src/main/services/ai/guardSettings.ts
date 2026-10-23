// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

/** 用户侧设置 → 守卫选项。默认全关（fail-closed）。 */
function readGuardOptions() {
	return {
		allowDestructive: process.env.QQBAT_AI_ALLOW_DESTRUCTIVE === "1",
		allowedTargets: (process.env.QQBAT_AI_ALLOWED_TARGETS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
	};
}

export { readGuardOptions };
