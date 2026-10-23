// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

var listDataSourcesSchema = z.tuple([z.string().min(1)]);
var getSchemaSchema = z.tuple([z.string()]);
var queryTableSchema = z.tuple([
	z.string(),
	z.string().min(1),
	z.number().int().min(1),
	z.number().int().min(1),
	z.number().int().nonnegative().optional()
]);
var updateRecordSchema = z.tuple([
	z.string(),
	z.string().min(1),
	z.number().int().nonnegative(),
	z.record(z.string(), z.unknown())
]);
var insertRecordSchema = z.tuple([
	z.string(),
	z.string().min(1),
	z.record(z.string(), z.unknown())
]);
var deleteRecordSchema = z.tuple([
	z.string(),
	z.string().min(1),
	z.number().int().nonnegative()
]);
var searchPlayerSchema = z.tuple([z.string().min(1), z.string().min(1)]);
var listPlayersSchema = z.tuple([z.string().min(1)]);
var queryPlayerTablesSchema = z.tuple([z.string(), z.string().min(1)]);
/** launch:deletePlayer —— 删掉某玩家的全部存档（不可逆，服务层会先备份） */
var deletePlayerSchema = z.tuple([z.string().min(1), z.string().min(1)]);
/** launch:mergePlayers —— 把 fromUid 并入 toUid（uid 用字符串传，避免精度/前导零问题） */
var mergePlayersSchema = z.tuple([
	z.string().min(1),
	z.string().min(1),
	z.string().min(1)
]);
/** launch:checkIdentity —— 只读检查"身份一致性"（openid ↔ uid 映射 vs 实际存档） */
var checkIdentitySchema = z.tuple([z.string().min(1)]);
/** launch:getPlayerSchema —— 取玩家存档的字段契约（派生 + 项目覆盖，见 playerSchemaService） */
var getPlayerSchemaSchema = z.tuple([z.string().min(1)]);
/** launch:savePlayerSchema —— 把当前契约落成可编辑文件
*/ var savePlayerSchemaSchema = z.tuple([z.string().min(1), z.object({
	table: z.literal("player"),
	displayName: z.string(),
	fields: z.array(z.object({
		key: z.string().min(1),
		label: z.string(),
		type: z.string(),
		category: z.string(),
		isBaseData: z.boolean(),
		isEngineState: z.boolean(),
		source: z.string(),
		usage: z.object({
			modes: z.array(z.string()),
			nodeCount: z.number(),
			scope: z.string()
		}).optional()
	}))
})]);
var uidMappingSchema = z.tuple([z.string().min(1)]);
var updatePlayerUidSchema = z.tuple([
	z.string().min(1),
	z.string().min(1),
	z.number().int()
]);
var templateFieldSchema = z.object({
	key: z.string().min(1),
	label: z.string().min(1),
	type: z.enum([
		"number",
		"boolean",
		"text",
		"date",
		"datetime",
		"json",
		"enum"
	]),
	default: z.unknown().optional(),
	auto: z.boolean().optional(),
	options: z.array(z.object({
		value: z.string(),
		label: z.string()
	})).optional(),
	description: z.string().optional(),
	category: z.enum([
		"identity",
		"level",
		"economy",
		"combat",
		"exploration",
		"cultivation",
		"collection",
		"business",
		"martial",
		"social_base",
		"status",
		"stats"
	]).optional()
});
var templateGroupSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	icon: z.string().min(1),
	fields: z.array(templateFieldSchema)
});
var dataTemplateSchema = z.tuple([z.string().min(1), z.object({
	version: z.number().int(),
	groups: z.array(templateGroupSchema)
})]);

export { listDataSourcesSchema, getSchemaSchema, queryTableSchema, updateRecordSchema, insertRecordSchema, deleteRecordSchema, searchPlayerSchema, listPlayersSchema, queryPlayerTablesSchema, deletePlayerSchema, mergePlayersSchema, checkIdentitySchema, getPlayerSchemaSchema, savePlayerSchemaSchema, uidMappingSchema, updatePlayerUidSchema, templateFieldSchema, templateGroupSchema, dataTemplateSchema };
