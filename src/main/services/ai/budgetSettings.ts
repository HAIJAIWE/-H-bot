// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import * as electron from "electron";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { existingUserDataPath, init_paths, userDataPathOrThrow } from "../infra/paths";
import { init_logger, logger } from "../infra/logger";
import { CODING_AGENT_BUDGET, getToolResultBudget, setToolResultBudget } from "./toolResultBudget";
import { atomicWrite } from "../infra/fileOps";

var MAX_THRESHOLD_CHARS = 2e5;
var toolBudgetSchema = z.object({
	/** false = 不裁剪（相当于以前的"无上限"） */
	enabled: z.boolean(),
	/** 超过这个**码点数**就裁剪 */
	thresholdChars: z.number().int().min(512).max(MAX_THRESHOLD_CHARS)
});
/** 默认值 = 代码里那套预设（`CODING_AGENT_BUDGET` 的阈值） */
var DEFAULT_TOOL_BUDGET_SETTING = {
	enabled: true,
	thresholdChars: CODING_AGENT_BUDGET.thresholdChars
};
/** 设置文件的绝对路径（**写入位置**，P4.3 起在 config/ 下） */
function toolBudgetSettingPath() {
	return userDataPathOrThrow("aiToolBudget", electron.app);
}
/** **读取位置**：新位置优先，否则回落 P4.3 之前的根下文件（双读单写） */
function toolBudgetReadPath() {
	return existingUserDataPath("aiToolBudget", electron.app) ?? toolBudgetSettingPath();
}
/** 由「设置」算出真正生效的预算（头 50% / 尾 12.5%，按比例缩放） */
function budgetFromSetting(setting) {
	if (!setting.enabled) return null;
	const thresholdChars = setting.thresholdChars;
	return {
		thresholdChars,
		headChars: Math.round(thresholdChars * .5),
		tailChars: Math.round(thresholdChars * .125)
	};
}
/**
* 读设置。
*
* 文件不存在 / 字段非法 → 返回**默认值**（不是抛错，也不是"未配置"）：
* 这是"有个合理默认"的设置，不是"必须用户填"的配置。
* 但非法时留一条 warn —— 用户手改坏了文件，得能从日志看出来。
*/
async function readToolBudgetSetting() {
	const path = toolBudgetReadPath();
	try {
		if (!(0, fs.existsSync)(path)) return { ...DEFAULT_TOOL_BUDGET_SETTING };
		const result = toolBudgetSchema.safeParse(JSON.parse(await (0, fs_promises.readFile)(path, "utf-8")));
		if (!result.success) {
			logger.warn("[ai] 工具结果上限设置没通过校验，改用默认值:", result.error.message);
			return { ...DEFAULT_TOOL_BUDGET_SETTING };
		}
		return result.data;
	} catch (e) {
		logger.warn("[ai] 读取工具结果上限设置失败，改用默认值:", e);
		return { ...DEFAULT_TOOL_BUDGET_SETTING };
	}
}
/** 写设置（幂等覆盖） */
async function writeToolBudgetSetting(setting) {
	await atomicWrite(toolBudgetSettingPath(), JSON.stringify(setting, null, 2));
}
/** 把设置应用到运行时（`enabled: false` → 传 null = 不裁剪） */
function applyToolBudgetSetting(setting) {
	setToolResultBudget(budgetFromSetting(setting));
}
/**
* 启动时调用：读设置并应用。
*
* 读失败也**不阻断启动**（返回默认值并已应用）—— 一个上限设置没读到，
* 不该让整个应用起不来。
*/
async function loadAndApplyToolBudget() {
	const setting = await readToolBudgetSetting();
	applyToolBudgetSetting(setting);
	return setting;
}
/** 当前生效的设置（从运行时的预算反推，供 IPC 回读） */
function currentToolBudgetSetting() {
	const active = getToolResultBudget();
	if (active === null) return {
		enabled: false,
		thresholdChars: DEFAULT_TOOL_BUDGET_SETTING.thresholdChars
	};
	return {
		enabled: true,
		thresholdChars: active.thresholdChars
	};
}

export { MAX_THRESHOLD_CHARS, toolBudgetSchema, DEFAULT_TOOL_BUDGET_SETTING, toolBudgetSettingPath, toolBudgetReadPath, budgetFromSetting, readToolBudgetSetting, writeToolBudgetSetting, applyToolBudgetSetting, loadAndApplyToolBudget, currentToolBudgetSetting };
