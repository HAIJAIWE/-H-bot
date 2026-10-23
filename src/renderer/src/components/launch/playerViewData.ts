// src/renderer/src/components/launch/playerViewData.ts
//
// 玩家数据卡片的**取数层**：把一个项目的「字段清单」「道具配置表」准备好交给卡片渲染。
//
// ## 为什么要单独一层
//
// 字段清单来自 `{项目}/.qqbat/flow.json`（`variable_persist` 节点），道具属性来自
// `{项目}/data/config/items.db`。这两份东西是**异步**的、都要容错（文件可能不存在、
// 表可能没建、列可能不同），而卡片组件应该是纯渲染。所以取数集中在这里。
//
// ## 失败时的行为
//
// - 取不到 flow → 退化成"只看存档里实际存在的字段"（仍然不画通用模板的字段）；
// - 取不到配置表 → 道具卡只显示名称+数量，并标注"配置表里没有"。
//
// 两条都不会抛、不会阻断面板 —— 面板本身能打开比字段完整更重要。
import type { FlowGraph } from '@shared/types/flow';
import type { TableSchema, QueryResult, FieldCategory } from '@shared/types/launch';
import { unwrapPersistentValue } from '@shared/persist/value';
import {
  buildPlayerFields,
  collectFieldUsages,
  type FieldUsage,
  type PlayerField,
} from './playerFieldsModel';
import {
  buildConfigTable,
  columnsFromSchema,
  type ConfigTable,
  type ConfigRow,
} from './playerItemsModel';

/** 面板里 `_persistent` 的一行 */
export interface StoredRow {
  key?: unknown;
  value?: unknown;
  scope?: unknown;
}

/** 卡片渲染需要的全部数据 */
export interface PlayerViewData {
  fields: PlayerField[];
  /** 项目里被解析成"道具表"的配置表（没找到时 null） */
  itemConfig: ConfigTable | null;
  /** 取数过程中遇到的非致命问题（面板可以据此提示，避免"看着是空的、其实是失败了"） */
  warnings: string[];
}

/** 一个项目的配置表所在的库文件（与面板 `buildFilePath` 同一规则） */
export function configDbPath(projectPath: string, table: string): string {
  return projectPath.replace(/\\/g, '/') + '/data/config/' + table + '.db';
}

/**
 * 从存档行里挑出属于玩家自己的那些（`scope != 'global'`）。
 *
 * 全局配置（`scope='global'`）不属于任何玩家，不能进角色卡 ——
 * 原实现已经在做这件事（`persistentRows` 过滤），这里保持同样的规则。
 */
export function playerOwnedRows(rows: StoredRow[]): { key: string; value: unknown }[] {
  return rows
    .filter((r) => String(r.scope ?? '') !== 'global')
    .map((r) => ({ key: String(r.key ?? ''), value: r.value }))
    .filter((r) => r.key !== '');
}

/**
 * 读一张配置表的「行 + 列名」。
 *
 * **抽成独立函数是为了能钉住一个踩过的坑**：`launch:queryTable` 的 IPC schema 是
 * `page: z.number().int().min(1)` —— 首页是 **1** 不是 0。传 0 会被参数校验挡掉、
 * 返回 `ok:false`，而这个失败是**静默**的：上层只看到"配置表读不到"，
 * 表现是道具卡把每一件都标成"配置表里没有"（明明查得到表）。
 *
 * @param schemaByTable `getSchema` 返回的**全部**表 schema（该接口没有按表过滤）
 */
export async function loadConfigTable(
  queryTable: (
    filePath: string,
    table: string,
    page: number,
    pageSize: number,
  ) => Promise<{ ok: boolean; data?: QueryResult | null }>,
  getSchema: (filePath: string) => Promise<{ ok: boolean; data?: TableSchema[] | null }>,
  dbPath: string,
  table: string,
): Promise<{ rows: ConfigRow[]; columns: string[] } | null> {
  const [q, s] = await Promise.all([
    queryTable(dbPath, table, 1, 500), // 首页 = 1（见上面的说明）
    getSchema(dbPath),
  ]);
  if (!q.ok || !q.data) return null;
  const tableSchema = s.ok && s.data ? s.data.find((x) => x.name === table) : undefined;
  return toConfigQueryResult(q.data, tableSchema);
}

/** 依赖注入的取数接口（便于单测，不真的碰 IPC） */
export interface PlayerViewDeps {
  /** 读项目的 flow.json */
  loadFlow: (projectPath: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /** 查一张配置表（返回行 + schema 列名） */
  queryConfigTable: (
    dbPath: string,
    table: string,
  ) => Promise<{ rows: ConfigRow[]; columns: string[] } | null>;
  /**
   * 玩家字段契约（主进程派生）。**可选**：没有它也能工作（退回本地推导），
   * 有它则用项目自己的中文名/分类 —— 这是"面板不再靠猜"的关键。
   */
  getPlayerSchema?: (projectPath: string) => Promise<{
    fields: { key: string; label: string; category: string }[];
  } | null>;
}

/**
 * 组装卡片数据。
 *
 * @param projectPath 项目根
 * @param storedRows 当前玩家的 `_persistent` 行
 * @param itemTable 项目里哪张配置表用来解析道具（默认 `items`）
 */
export async function loadPlayerView(
  projectPath: string,
  storedRows: StoredRow[],
  deps: PlayerViewDeps,
  itemTable = 'items',
): Promise<PlayerViewData> {
  const warnings: string[] = [];

  // 1) 字段清单：项目流程里 variable_persist 声明的 key
  let usages = new Map<string, FieldUsage>();
  if (projectPath) {
    try {
      const res = await deps.loadFlow(projectPath);
      if (res.ok && res.data) {
        usages = collectFieldUsages(res.data as FlowGraph);
      } else if (res.error) {
        warnings.push(`读取流程失败：${res.error}`);
      }
    } catch (e) {
      warnings.push(`读取流程异常：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 1.5) 玩家字段契约（增强项：拿不到就退回上面的本地推导，不影响功能）
  let schemaFields: Map<string, { label: string; category: FieldCategory }> | undefined;
  if (projectPath && deps.getPlayerSchema) {
    try {
      const s = await deps.getPlayerSchema(projectPath);
      if (s && s.fields.length > 0) {
        schemaFields = new Map(
          s.fields.map((f) => [f.key, { label: f.label, category: f.category as FieldCategory }]),
        );
      }
    } catch (e) {
      warnings.push(`读取玩家字段契约失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2) 道具配置表
  let itemConfig: ConfigTable | null = null;
  if (projectPath) {
    try {
      const q = await deps.queryConfigTable(configDbPath(projectPath, itemTable), itemTable);
      if (q) itemConfig = buildConfigTable(itemTable, q.columns, q.rows);
    } catch (e) {
      warnings.push(`读取配置表失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3) 合并成字段列表
  const fields = buildPlayerFields(
    usages,
    playerOwnedRows(storedRows),
    unwrapPersistentValue,
    schemaFields,
  );

  return { fields, itemConfig, warnings };
}

/** 把 `queryTable` 的返回（`QueryResult`）与 schema 拼成取数层要的形状 */
export function toConfigQueryResult(
  result: QueryResult | null | undefined,
  schema: TableSchema | null | undefined,
): { rows: ConfigRow[]; columns: string[] } | null {
  if (!result) return null;
  return {
    rows: result.rows ?? [],
    columns: columnsFromSchema(schema ?? null),
  };
}
