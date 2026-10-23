// @ts-nocheck
// 由 10/18 打包产物还原（chunk: renderer-index.js）；见 _recovery/README-recovery.md

/** 主题配置（BUILT_IN_THEMES / 自定义主题共用的形状） */
export interface ThemeConfig {
  id: string;
  name: string;
  isDark: boolean;
  colors: Record<string, string>;
}

var BUILT_IN_THEMES = [{
	id: "qqbat-dark",
	name: "暗色默认",
	isDark: true,
	colors: {
		bg: "#09090b",
		bgAlt: "#18181b",
		surface: "#27272a",
		text: "#f4f4f5",
		textMuted: "#71717a",
		primary: "#818cf8",
		accent: "#22d3ee",
		border: "#3f3f46",
		error: "#f87171",
		success: "#4ade80",
		warning: "#fbbf24"
	}
}, {
	id: "qqbat-light",
	name: "亮色",
	isDark: false,
	colors: {
		bg: "#fafafa",
		bgAlt: "#f4f4f5",
		surface: "#e4e4e7",
		text: "#18181b",
		textMuted: "#71717a",
		primary: "#6366f1",
		accent: "#06b6d4",
		border: "#d4d4d8",
		error: "#ef4444",
		success: "#22c55e",
		warning: "#eab308"
	}
}];

export { BUILT_IN_THEMES };
