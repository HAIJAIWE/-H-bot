// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/**
* 布尔端口的取值判定。
*
* 端口值可能来自三种地方：面板上的开关（真布尔）、数据边连进来的值（可能是字符串
* `'true'` / `'false'`）、以及**老节点里根本没有这个键**（undefined）。
* 只写 `if (kwargs.x)` 会把字符串 `'false'` 当成开 —— 这种"关不掉"的开关比没有更糟。
*/
function isTruthyFlag(v) {
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	if (typeof v === "string") return [
		"true",
		"1",
		"yes",
		"on"
	].includes(v.trim().toLowerCase());
	return false;
}
/**
* 为了"改一份副本"而做的拷贝（`json_op` 的命名变量模式用）。
*
* `jsonOp` 的 set/delete 是原地改传入的对象；直接把命名变量里的对象递进去，
* 即使「结果写回该变量」是关的，变量也已经被改了 —— 开关关不住行为。
* 优先 `structuredClone`（保留嵌套结构），遇到不可克隆的值（如函数）退化成浅拷贝：
* 浅拷贝下"改顶层字段"仍然安全（不会动到原对象），只有嵌套对象的原地改动会漏出去，
* 那也比整个节点报错好。
*/
function cloneForEdit(v) {
	if (v === null || typeof v !== "object") return v;
	try {
		return structuredClone(v);
	} catch {
		return Array.isArray(v) ? [...v] : { ...v };
	}
}
/**
* 端口 id → 参数名：**只登记 toCamelCase 产不出来的真例外**。
*
* ## 规则（有闸门守着，见 `tests/main/runtime/portAliasGate.test.ts`）
*
* `portToParam(id)` = `PORT_ALIASES[id] ?? toCamelCase(id)`。所以
* **只有"camelCase 化之后仍然不对"的名字才配写进这张表**。
*
* ## 为什么要把这条规则写死
*
* 这张表原先有 16 条，其中 **14 条是冗余的** —— `message_id → messageId`、
* `max_tokens → maxTokens`、`user_id → userId`…… 全都是 `toCamelCase` 本来就会
* 产出的结果。冗余条目本身无害，但它**制造了错误的印象**：
* 后来的人看到"哦，端口映射有一张特殊表"，于是新加端口时也照着抄一条，
* 久而久之没人知道哪些是真例外、哪些是抄来的 —— 而一旦有人以为
* "不写进这张表就不会被映射"，就会漏掉真正需要例外的那一条（`variables_json`）。
*
* 现在只留 2 条，且闸门保证：**任何一条 `toCamelCase(k) === v` 的条目都不许存在**。
*/
var PORT_ALIASES = {
	variables_json: "variables",
	default: "defaultValue"
};
/** snake_case → camelCase */
function toCamelCase(s) {
	return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
/** 端口 ID → 参数名 */
function portToParam(portId) {
	return PORT_ALIASES[portId] ?? toCamelCase(portId);
}

export { isTruthyFlag, cloneForEdit, PORT_ALIASES, toCamelCase, portToParam };
