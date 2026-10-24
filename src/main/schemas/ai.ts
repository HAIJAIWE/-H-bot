// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/schemas/ai.ts），只保证语法/行为，类型待补。


import { z } from 'zod';
import { LLM_PRESET_IDS } from '@shared/types/llm-presets';
/**
 * 一张图片的 data URL（助手链路与智能体循环共用）。
 *
 * 为什么抽成一个常量：两条链路的**上限必须一致** —— 否则会出现「助手能贴、
 * 循环被拒」这种只在某条路上才撞得到的问题，而且两处各写一遍迟早漂移。
 * `.max(6e6)` 是**单张**上限（约 6MB 的 base64），张数上限在各自字段上给。
 */
const imageDataUrlSchema = z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,/).max(6e6);
var aiChatSchema = z.object({
	/**
	* 项目路径。**允许为空** —— 空 = 「开荒模式」（还没有任何项目）。
	*
	* 为什么要有这个模式（2026-10-08，用户原话："一开始打开客户端，智能体不知道我选没选项目"）：
	* 助手面板在**没有项目时也在界面上**，却因为这一行 `min(1)` 而完全发不出话 ——
	* 于是"让 AI 帮我建第一个项目"这件最自然的事**恰恰做不到**（鸡生蛋）。
	* 空路径下只给"发现 + 提议"三类工具，且不读不写项目记忆（见 services/ai/index.ts）。
	*/
	projectPath: z.string(),
	/**
	* 用户这一轮说的话。
	*
	* ⚠️ **允许为空**：只贴一张图直接发是常见用法（「你看这是怎么回事」）。
	* 「空且无图」由 handler 拦（保留 .shape 给 IPC 载荷闸门用，所以不写成 refine）。
	*/
	message: z.string(),
	/**
	* 当前页面：`blocks` = 低代码页（画布），`code` = 代码页。**按模式分专家**（M5）靠它。
	* 可选：不传按低代码处理（助手的主战场）；未知值同样回落，不让界面版本差异把请求挡在门外。
	*/
	/**
	* 页面/模式：`blocks` 低代码 · `code` 代码页 · **`duo` 双向**（流程 + 代码一次做）·
	* **`creator` 创作模式**（给应用自己加功能，要先在界面里进框架工作区）。
	*
	* ⚠️ 2026-10-15 真机事故：加了 `duo` 却**漏了这个 schema** —— 双向模式下发送被静默拒绝
	* （`{ok:false}`），表现是「界面一直转圈、主进程日志里一条请求都没有」。
	* 本仓库栽在同一件事上不止一次：**渲染层类型改了，主进程 schema 也得改**（zod 会拒未知枚举值）。
	* 加第 4 档 `creator` 时正是照着这条教训三处一起改的（类型 / 这个枚举 / 渲染层按钮表），
	* 并由 tests/main/schemas/aiChatSchema.test.ts 用**编译期穷尽**钉住。
	*/
	mode: z.enum([
		"blocks",
		"code",
		"duo",
		"creator"
	]).optional(),
	/**
	* **任务线程**（见 services/ai/threads.ts）。不传 = `default` = 老的单文件路径。
	*
	* 线程 id 会被拼进文件名，所以这里就限制字符集；服务端还会再 sanitize 一次（纵深防御）。
	*/
	threadId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "线程 id 只允许字母数字与 - _").optional(),
	/**
	* 用户贴的图片（data URL）。**只作用于这一轮**，不进记忆（见 ChatMessage.images）。
	*
	* 两道上限都在这里拦：**张数**与**单张体积** —— 界面侧也会先缩图，
	* 但界面可以被绕过（老版本 / 手搓调用），主进程这道是兜底。
	*/
	images: z.array(imageDataUrlSchema).max(4).optional(),
	/**
	* **用户当前在代码编辑器里打开的文件**（项目内相对路径，2026-10-15 P1-5）。
	*
	* 为什么在这里开口：助手要说得出「这个文件」指谁 —— 此前它没有指代对象，只能反问或瞎猜
	*（用户原话「他不在代码编辑器那边工作」）。只对代码页 / 双向模式有意义，
	* 那条规则在主进程按**角色**判定（services/ai/index.ts 的 activeFileHintFor）。
	*
	* ⚠️ **刻意不加 min/max/regex 任何约束**：这条字段的每个额外约束都会变成
	*「路径不合规 → 整条消息被拒」—— 正是上面 27-33 行那个事故的同一形态
	*（duo 漏进枚举 → 双向模式被静默拒绝）。所以这里**只声明类型**，
	* 规范化与丢弃一律放在消费端：空路径 / 绝对路径 / 带 .. / 含换行反引号 /
	* 文件不存在 —— 全都什么都不加。
	*/
	activeFilePath: z.string().optional()
});
/**
* `ai:noteTurn` —— 把"用户对上一份计划的处置"写进项目记忆（应用了 / 拒绝了 / 回滚了）。
*
* 为什么需要（2026-10-06）：模型提出计划之后**再也收不到结果** —— 计划落地没有、
* 被拒没有，它下一轮完全不知道，于是可能原样再提一遍（真机里发生过）。
* 这条回执让"提出 → 处置 → 下一轮"形成闭环。
*/
var aiNoteTurnSchema = z.object({
	projectPath: z.string().min(1),
	note: z.string().min(1).max(2e3),
	/** 写到哪条**任务线程**（不传 = 默认那份 = 老行为） */
	threadId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional()
});
/**
* **池里的一项**（一个可用的 provider 配置）。
*
* 刻意**不含它自己的 fallbacks** —— 池是**扁平**的，不允许嵌套：
* 嵌套的池谁也说不清切换顺序，而且配置文件的形状会失控。
*/
var aiProviderEntrySchema = z.object({
	provider: z.enum(LLM_PRESET_IDS),
	apiKey: z.string().min(1),
	model: z.string().min(1),
	baseUrl: z.string().optional()
});
var aiConfigSchema = aiProviderEntrySchema.extend({
	/**
	* 「关思考」开关。**必须显式 optional 且不能给默认值**：
	* zod 默认会**剥掉未知字段**，而这个字段一旦被剥掉，开关就在 IPC 边界静默失效
	* （界面看着保存成功、实际没传下去）。另外"没勾"必须是**不发该字段**，
	* 而不是发 false —— 真 OpenAI 端点收到未知字段可能直接 400。
	*/
	enableThinking: z.boolean().optional(),
	/**
	* **Key 池（回退链）**：主 provider 因额度/鉴权/限流/服务端故障不可用时，按顺序换。
	*
	* 机制早就有（见 llmFallback.ts），但过去**只能手写配置文件** ——
	* 界面上看不到、管不了，切了也没人告诉用户（2026-10-09 抬到界面）。
	* 上限 8：再多说明该整理配置了，而不是继续堆。
	*/
	fallbacks: z.array(aiProviderEntrySchema).max(8).optional()
});
/**
* 「测试」按钮的配置校验 —— 比 `aiConfigSchema` **松一点**。
*
* 那个要求 `apiKey` 至少 1 个字符（给"用户主动提交并落盘"用的），而 Ollama 这类本地模型
* 压根不需要 key：测试连通性时不该因为"没填 key"就被判成参数非法。
*/
/**
* **Key 池（回退链）** 的一项：与主配置同形，但**不再嵌套 fallbacks**（回退链只有一层）。
* 上限 8 —— 与 `src/shared/types/ai.ts` 的 AiConfig 注释一致。
*/
var aiFallbackSchema = aiProviderEntrySchema.extend({ apiKey: z.string() });
/**
* 回退链的**专用**载荷。
*
* ⚠️ 为什么不放进 `aiConfigSchema`：appAiConfig.ts 里那段注释写得很明白 ——
* 进了通用载荷就会变成「渲染层能设置、却被 zod 静默剥掉」的假字段
*（`enableThinking` 当初踩过同一个坑）。所以它走自己的通道。
*/
var aiFallbacksSchema = z.object({ fallbacks: z.array(aiFallbackSchema).max(8) });
var aiConfigTestSchema = aiConfigSchema.extend({ apiKey: z.string() });
/**
* 批处理三通道的参数（`ai:beginBatch` / `ai:commitBatch` / `ai:rollbackBatch`）。
*
* 为什么必须带 projectPath：批处理是**按项目**的事务（见 `services/ai/index.ts` 的 `batches`）。
* 以前这三个通道无参 → 状态只能是进程级 → 切换项目会把两个项目的批次串在一起。
*/
var approvalDecisionSchema = z.object({
	callId: z.string().min(1),
	decision: z.enum([
		"allow",
		"deny",
		"always"
	])
});
/**
* 「编辑后从此处重开对话」的载荷：给那句用户消息的原文，主进程自己去找位置。
* 传原文而不是下标：界面里的消息下标与磁盘记忆的条数**不是一一对应**（还有系统回执等），
* 按下标截断迟早截错地方。
*/
var rewindToSchema = z.object({
	projectPath: z.string().min(1),
	threadId: z.string().optional(),
	messageText: z.string().min(1)
});
var rollbackTurnSchema = z.object({
	projectPath: z.string().min(1),
	turnId: z.string().min(1),
	/** 撤回哪条线程的对话（不传=默认那条）——2026-10-15：撤回要把对话也退回去 */
	threadId: z.string().optional()
});
var aiProjectPathSchema = z.object({ projectPath: z.string().min(1) });
/** 读某条线程的历史（不传 threadId = 默认那份 = 老行为） */
var aiHistorySchema = z.object({
	projectPath: z.string().min(1),
	threadId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional()
});
/** 清空某条线程的记忆 */
var aiThreadSchema = z.object({
	projectPath: z.string().min(1),
	threadId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
});



/**
 * agent-core 运行入口（workspace-first 循环）。
 *
 * 与 aiChatSchema 并列：那是助手链路的载荷，这是另一个循环的载荷（回执形状也不同）。
 * 可选字段全部来自 preload 的 agentCoreRun 签名 —— 少收一个字段就等于静默丢功能。
 */
var aiAgentCoreRunSchema = z.object({
	projectPath: z.string().min(1),
	requirement: z.string().min(1),
	threadId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
	maxRounds: z.number().int().positive().max(200).optional(),
	planFirst: z.boolean().optional(),
	fullAccess: z.boolean().optional(),
	allowedTools: z.array(z.string().min(1)).optional(),
	preset: z.string().min(1).max(120).optional(),
	agentMode: z.enum(["blocks", "code", "duo", "creator"]).optional(),
	/**
	* 用户贴的图片（data URL）。与助手链路同一套上限：单张 ≤6e6 字符、最多 4 张。
	*
	* 此前这里是裸的 `z.array(z.string())` —— 张数与格式一概不查，任何字符串
	* （包括非 data URL 的 URL、超长 base64）都会被原样送进 provider 换一个 400。
	* 主进程是兜底那道（界面侧也会先缩图/限张数），所以按助手的口径对齐。
	*/
	images: z.array(imageDataUrlSchema).max(4).optional(),
	activeFilePath: z.string().max(500).optional()
});
/** 插话：把一句话塞进正在跑的那一轮（step = 本步之前，turn = 本轮结束后排队） */
var aiAgentCoreSteerSchema = z.object({
	projectPath: z.string().min(1),
	text: z.string().min(1).max(4000),
	target: z.enum(["step", "turn"]).optional()
});
/** 会话预设整表覆盖（未知工具/插件由 handler 以 warnings 返回，不拒绝） */
var aiSavePresetsSchema = z.object({
	projectPath: z.string().min(1),
	presets: z.array(z.object({
		name: z.string().min(1).max(120),
		allowedTools: z.array(z.string().min(1)).optional(),
		plugins: z.array(z.string().min(1)).optional(),
		permissionMode: z.enum(["ask", "full"]).optional(),
		/**
		* 角色（builder / coder / duo / creator）。
		*
		* ⚠️ **不声明就等于静默丢**：zod 的 object 默认是 strip —— 渲染层把
		* role 一起传上来，不写这一行，服务层收到的预设里就没有这个字段，
		* 存盘后「预设绑定的角色」凭空消失，而且全程没有任何报错。
		*/
		role: z.enum(["builder", "coder", "duo", "creator"]).optional(),
		/** 追加到这个角色的提示尾部的自定义要求（长度上限与 services/ai/presets.ts 的 PROMPT_MAX 对齐） */
		prompt: z.string().max(2000).optional(),
		description: z.string().max(500).optional()
	}))
});
/** 删掉一条"别再问"规则 */
var aiRemoveAllowRuleSchema = z.object({
	projectPath: z.string().min(1),
	kind: z.enum(["write", "command", "tool"]),
	match: z.string().min(1).max(500)
});

export { aiChatSchema, aiNoteTurnSchema, aiProviderEntrySchema, aiConfigSchema, aiFallbackSchema, aiFallbacksSchema, aiConfigTestSchema, approvalDecisionSchema, rewindToSchema, rollbackTurnSchema, aiProjectPathSchema, aiHistorySchema, aiThreadSchema, aiAgentCoreRunSchema, aiAgentCoreSteerSchema, aiSavePresetsSchema, aiRemoveAllowRuleSchema };
