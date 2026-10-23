// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

/** 脚手架生成的插件版本号（与既有四个生产者一致） */
var PLUGIN_MANIFEST_VERSION = "1.0.0";
/** 脚手架生成的入口文件名（与既有四个生产者一致） */
var PLUGIN_MANIFEST_ENTRY = "index.js";
/**
* 生成 manifest 对象（字段顺序固定：name / version / entry / description / permissions）。
*
* 字段顺序有意义：它决定 `JSON.stringify(…, null, 2)` 写出来的文件长相，
* 四条路径落盘的内容因此逐字节一致。
*/
function buildPluginManifest(input) {
	return {
		name: input.name,
		version: PLUGIN_MANIFEST_VERSION,
		entry: PLUGIN_MANIFEST_ENTRY,
		description: input.description,
		permissions: input.permissions ? [...input.permissions] : []
	};
}
/** 生成 manifest.json 文件内容（2 空格缩进，与四条生产路径原样一致） */
function buildPluginManifestJson(input) {
	return JSON.stringify(buildPluginManifest(input), null, 2);
}

export { PLUGIN_MANIFEST_VERSION, PLUGIN_MANIFEST_ENTRY, buildPluginManifest, buildPluginManifestJson };
