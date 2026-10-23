// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { BUILTIN_PANEL_TEMPLATES, getPanelTemplate, instantiatePanelTemplate } from "../../../shared/panels/builtinPanelTemplates";
import { createEmptyKeyboard } from "../../../shared/types/keyboard";

var PANELS_FILE = "button_panels.json";
var LIB_VERSION = 1;
/** 生成面板 ID */
function generatePanelId() {
	return `panel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/** 获取面板库文件路径 */
function getLibraryPath(projectPath) {
	return (0, path.join)(projectPath, ".qqbat", PANELS_FILE);
}
/** 读取整个面板库，文件不存在或损坏时返回空库 */
function getButtonPanelLibrary(projectPath) {
	const filePath = getLibraryPath(projectPath);
	if (!(0, fs.existsSync)(filePath)) return {
		version: LIB_VERSION,
		panels: []
	};
	try {
		const parsed = JSON.parse((0, fs.readFileSync)(filePath, "utf-8"));
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.panels)) return {
			version: LIB_VERSION,
			panels: []
		};
		return parsed;
	} catch {
		return {
			version: LIB_VERSION,
			panels: []
		};
	}
}
/** 保存整个面板库 */
function saveButtonPanelLibrary(projectPath, library) {
	const dir = (0, path.join)(projectPath, ".qqbat");
	if (!(0, fs.existsSync)(dir)) (0, fs.mkdirSync)(dir, { recursive: true });
	const filePath = getLibraryPath(projectPath);
	(0, fs.writeFileSync)(filePath, JSON.stringify(library, null, 2), "utf-8");
}
/** 列出所有面板（按更新时间倒序） */
function listButtonPanels(projectPath) {
	return [...getButtonPanelLibrary(projectPath).panels].sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1);
}
/** 获取单个面板，不存在返回 null */
function getButtonPanel(projectPath, panelId) {
	return getButtonPanelLibrary(projectPath).panels.find((p) => p.id === panelId) ?? null;
}
/** 创建新面板，返回创建后的面板 */
function createButtonPanel(projectPath, name, description = "", keyboard) {
	if (!name || !name.trim()) throw new Error("面板名称不能为空");
	const lib = getButtonPanelLibrary(projectPath);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const panel = {
		id: generatePanelId(),
		name: name.trim(),
		description: description.trim(),
		keyboard: keyboard ?? createEmptyKeyboard(),
		createdAt: now,
		updatedAt: now
	};
	lib.panels.push(panel);
	saveButtonPanelLibrary(projectPath, lib);
	return panel;
}
/** 更新面板（部分字段），返回更新后的面板，不存在抛错 */
function updateButtonPanel(projectPath, panelId, patch) {
	const lib = getButtonPanelLibrary(projectPath);
	const idx = lib.panels.findIndex((p) => p.id === panelId);
	if (idx === -1) throw new Error(`面板不存在：${panelId}`);
	const current = lib.panels[idx];
	if (patch.name !== void 0) {
		if (!patch.name.trim()) throw new Error("面板名称不能为空");
		current.name = patch.name.trim();
	}
	if (patch.description !== void 0) current.description = patch.description.trim();
	if (patch.keyboard !== void 0) current.keyboard = patch.keyboard;
	current.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
	lib.panels[idx] = current;
	saveButtonPanelLibrary(projectPath, lib);
	return current;
}
/** 删除面板，不存在返回 false，存在并删除返回 true */
function deleteButtonPanel(projectPath, panelId) {
	const lib = getButtonPanelLibrary(projectPath);
	const idx = lib.panels.findIndex((p) => p.id === panelId);
	if (idx === -1) return false;
	lib.panels.splice(idx, 1);
	saveButtonPanelLibrary(projectPath, lib);
	return true;
}
/** 复制面板（用于"另存为"），返回新面板 */
function duplicateButtonPanel(projectPath, panelId, newName) {
	const src = getButtonPanel(projectPath, panelId);
	if (!src) throw new Error(`面板不存在：${panelId}`);
	return createButtonPanel(projectPath, newName ?? `${src.name} 副本`, src.description, JSON.parse(JSON.stringify(src.keyboard)));
}
/** 列出所有可用的预置面板模板 */
function listBuiltinPanelTemplates() {
	return BUILTIN_PANEL_TEMPLATES.map((t) => ({
		templateId: t.templateId,
		name: t.name,
		description: t.description,
		buttonCount: t.keyboard.rows.reduce((acc, r) => acc + (r?.buttons?.length ?? 0), 0)
	}));
}
/**
* 导入预置面板模板到项目面板库。
* - 若 templateIds 为空，则导入全部
* - 已存在同名面板不会重复导入
* 返回新创建的面板列表
*/
function importBuiltinPanels(projectPath, templateIds) {
	const lib = getButtonPanelLibrary(projectPath);
	const existingNames = new Set(lib.panels.map((p) => p.name));
	const templates = templateIds && templateIds.length > 0 ? templateIds.map((id) => getPanelTemplate(id)).filter((t) => !!t) : BUILTIN_PANEL_TEMPLATES;
	const created = [];
	for (const tpl of templates) {
		if (existingNames.has(tpl.name)) continue;
		const data = instantiatePanelTemplate(tpl);
		const panel = {
			id: generatePanelId(),
			...data
		};
		lib.panels.push(panel);
		created.push(panel);
	}
	if (created.length > 0) saveButtonPanelLibrary(projectPath, lib);
	return created;
}

export { PANELS_FILE, LIB_VERSION, generatePanelId, getLibraryPath, getButtonPanelLibrary, saveButtonPanelLibrary, listButtonPanels, getButtonPanel, createButtonPanel, updateButtonPanel, deleteButtonPanel, duplicateButtonPanel, listBuiltinPanelTemplates, importBuiltinPanels };
