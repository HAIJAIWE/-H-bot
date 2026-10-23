// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/toolResultBudget.ts），只保证语法/行为，类型待补。


/**
* 默认生效的预算：DSH `dsh-compaction-tool-result-pruner` 的 DEFAULTS。
*
* ⚠️ 它的历史（两个决定，后者推翻了前者，理由都记下来）：
*
* - **2026-09-22**：改成默认 `null`（无上限）。当时的理由是"怕裁掉之后**看不到也找不回**"。
* - **2026-10-01 恢复为默认**：那个理由**已经被 spill 化解** ——
*   现在超预算的结果会**先落盘**（`.qqbat/ai-spill/`）再把路径写进省略标记，
*   所以裁剪**不再等于信息丢失**，只等于"多一次 read_file"。
*   而 DSH 的实证是：`maxInlineTokens` 在它自己的生产配置里**是开着的**（12500）。
*   留着不设上限，风险落在"任何新工具都能撑爆上下文"上 —— 而 `list_nodes` 不带 kind
*   一次就是 83,486 字符（≈2 万 token），这是**已经量到的事实**。
*
* 数字面向"编码 agent 的工具输出"（英文/代码为主），中文密度高的项目可以另调。
* 想关掉：`setToolResultBudget(null)`。
*/
var CODING_AGENT_BUDGET = {
	thresholdChars: 8192,
	headChars: 4096,
	tailChars: 1024
};
/**
* 当前生效的预算。
*
* **默认就是 `CODING_AGENT_BUDGET`**（2026-10-01 起）。
*
* 为什么敢默认开：**裁剪现在是有出路的** —— `pruneText` 拿不到可恢复的溢出路径时
* **根本不裁**（fail-open，见 `pruneText` 与 `spillStore.ts`）。
* 所以"默认开"最坏的结果是"这次没裁、上下文大了点"，而不是"信息丢了"。
*
* 它拦的是**与工具无关**的那一类风险：不该由每个工具各自记得"我别吐太多" ——
* 漏一个就是一个洞（`read_flow` 那个 30 万 token 就是per-tool 视角看不出来的）。
*/
var activeBudget = CODING_AGENT_BUDGET;
/** 设置当前生效的预算；传 null 表示不裁剪 */
function setToolResultBudget(budget) {
	activeBudget = budget;
}
/** 读取当前生效的预算（null = 不裁剪） */
function getToolResultBudget() {
	return activeBudget;
}
/**
* 中段被替换成这个标记。
*
* 标记不只是"这里少了东西"，还要告诉模型**下一步该怎么做** ——
* 否则它拿到半截 JSON 会自己脑补（这正是本项目最怕的静默失败形态）。
*/
var PRUNE_MARKER = "\n\n[... 中段已裁剪：本次工具结果超出单次预算。完整内容不在上下文里，请用更窄的参数重查（如指定 nodeId / 分组），不要据此猜测 ...]\n\n";
/**
* 省略计数的预留开销。
*
* 标记的文案里要写"省略了 N 字"，而 N 只有分配完头尾才知道 —— 所以：
* 先用 0 量一次标记长度，**再多留这么多码点**给那个数字。
* 这样"结果恒不超过 thresholdChars"这个硬上限仍然成立（数字不可能长过 32 位）。
*/
var COUNT_RESERVE = 32;
/** 生成省略标记；`omitted` 传 0 表示"还没算出来"（只用于量长度） */
function pruneMarker(omitted, spillRef) {
	if (!spillRef) return PRUNE_MARKER;
	const hint = spillRef.hint ? `；${spillRef.hint}` : "；也可以直接读这个文件找你要的部分";
	return `\n\n[... 中段已裁剪：省略 ${omitted} 字。**完整结果已保存到 ${spillRef.path}**，可用 read_file 读取${hint} ...]\n\n`;
}
/**
* 按 Unicode 码点计数（不拆代理对）。
*
* 为什么不直接用 `text.length`：那是 UTF-16 码元数，emoji 与增补平面汉字各算 2，
* 会让「预算」随内容而变。DSH 同样按码点计数（`codePointLength`）。
*/
function codePointLength(text) {
	let count = 0;
	for (let i = 0; i < text.length;) {
		const code = text.charCodeAt(i);
		if (code >= 55296 && code <= 56319 && i + 1 < text.length) {
			const next = text.charCodeAt(i + 1);
			if (next >= 56320 && next <= 57343) {
				i += 2;
				count++;
				continue;
			}
		}
		i += 1;
		count++;
	}
	return count;
}
/**
* 返回「前 n 个码点」结束处的 UTF-16 下标。
*
* 用它切字符串可以保证**不劈开代理对** —— 否则会切出一个孤立代理项，
* 在 JSON 里是无效的、发到 API 也可能被拒。
*/
function utf16OffsetOfCodePoint(text, n) {
	let count = 0;
	let i = 0;
	while (i < text.length && count < n) {
		const code = text.charCodeAt(i);
		if (code >= 55296 && code <= 56319 && i + 1 < text.length) {
			const next = text.charCodeAt(i + 1);
			if (next >= 56320 && next <= 57343) {
				i += 2;
				count++;
				continue;
			}
		}
		i += 1;
		count++;
	}
	return i;
}
/** 取前 n 个码点 */
function headByCodePoint(text, n) {
	return text.slice(0, utf16OffsetOfCodePoint(text, n));
}
/** 取后 n 个码点 */
function tailByCodePoint(text, n) {
	const total = codePointLength(text);
	if (n >= total) return text;
	return text.slice(utf16OffsetOfCodePoint(text, total - n));
}
/**
* 对单段文本做「头尾保留、中段丢弃」。
*
* 预算配置不合理（比如 head+tail+标记 本身就超阈值）时也不会漏出去：
* 先把标记的开销从预算里扣掉，再分配头尾，因此结果**恒不超过 thresholdChars**。
*/
function pruneText(text, budget = activeBudget, spillRef) {
	if (budget === null) {
		const chars = codePointLength(text);
		return {
			text,
			pruned: false,
			charsBefore: chars,
			charsAfter: chars
		};
	}
	const threshold = Math.max(1, Math.floor(budget.thresholdChars));
	if (text.length <= threshold) return {
		text,
		pruned: false,
		charsBefore: codePointLength(text),
		charsAfter: codePointLength(text)
	};
	const charsBefore = codePointLength(text);
	if (charsBefore <= threshold) return {
		text,
		pruned: false,
		charsBefore,
		charsAfter: charsBefore
	};
	/**
	* ⭐ fail-open：超预算了，但**拿不到可恢复的溢出路径** → 原样返回，不裁。
	*
	* 这是 DSH `dsh-spill-policy` 的硬规则（原文）：
	* 「无法保存可恢复内容时保留原结果」「策略不会用无法读取的路径替换内容」。
	*
	* 对用户的含义：**省略必须是有出路的**。旧行为（裁了、且只留一句"请用更窄的参数重查"）
	* 等于把信息**真的弄丢**了 —— 而上下文超标是**看得见**的问题（变慢/报错），
	* 信息丢失是**看不见**的。两害相权，选看得见的那个。
	*/
	if (!spillRef) return {
		text,
		pruned: false,
		failOpen: true,
		charsBefore,
		charsAfter: charsBefore
	};
	const markerCost = codePointLength(pruneMarker(0, spillRef)) + COUNT_RESERVE;
	if (threshold <= markerCost) {
		const clipped = headByCodePoint(text, threshold);
		return {
			text: clipped,
			pruned: true,
			charsBefore,
			charsAfter: codePointLength(clipped),
			spillPath: spillRef.path
		};
	}
	const usable = threshold - markerCost;
	const headBudget = Math.min(Math.max(0, Math.floor(budget.headChars)), usable);
	const tailBudget = Math.min(Math.max(0, Math.floor(budget.tailChars)), usable - headBudget);
	const head = headByCodePoint(text, headBudget);
	const tail = tailBudget > 0 ? tailByCodePoint(text, tailBudget) : "";
	const out = `${head}${pruneMarker(charsBefore - codePointLength(head) - codePointLength(tail), spillRef)}${tail}`;
	return {
		text: out,
		pruned: true,
		charsBefore,
		charsAfter: codePointLength(out),
		spillPath: spillRef.path
	};
}
/**
* 安全 JSON 序列化：处理循环引用与不可序列化值，失败时降级为 String()。
*
* 放在这里（而不是留在 index.ts）是因为预算层与调用方必须用**同一个**序列化结果，
* 否则「量出来的大小」和「真正送进上下文的东西」会不是一份。
*/
function safeStringify(value) {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		try {
			return String(value);
		} catch {
			return "[Unserializable]";
		}
	}
}
/**
* 工具结果的统一入口：任何值先序列化、再过预算。
*
* index.ts 应当在**唯一一处**调用它，这样"新增工具忘了裁剪"在结构上就不可能发生
* （预算与工具名无关）。
*
* 默认用 `activeBudget`（当前是**不裁剪**，见其说明）。仍可显式传一个预算给测试或未来的收敛策略。
*/
function budgetToolResult(value, budget = activeBudget, spillRef) {
	return pruneText(safeStringify(value), budget, spillRef);
}


export { setToolResultBudget, getToolResultBudget, pruneMarker, codePointLength, utf16OffsetOfCodePoint, headByCodePoint, tailByCodePoint, pruneText, safeStringify, budgetToolResult, CODING_AGENT_BUDGET, activeBudget, PRUNE_MARKER, COUNT_RESERVE };
