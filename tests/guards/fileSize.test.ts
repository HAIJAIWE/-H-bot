// tests/guards/fileSize.test.ts
//
// # 闸门：文件行数 —— **按"又长又热"排序**，而不是只看行数
//
// ## 为什么改成这样（2026-10-01 的自我批评）
//
// 第一版只用**绝对行数**当判据。它有个通病：**催生"为数字而拆"**。
// 实测打脸：我刚拆的 `builtinNodes.ts`（4,433 行）历史上只被改过 **27 次**，
// 根本排不进全仓前五 —— 而真正"又长又热"的是：
//
// | 文件 | 提交次数 | 行数 |
// |---|---|---|
// | `BlockEditor.tsx` | 68 | 1,860 |
// | `builtinCatalog.ts` | 65 | 6,122 |
// | `PropertyDrawer.tsx` | 59 | 1,492 |
// | `flowStore.ts` | 50 | 2,185 → **已拆**（2026-10-01：2186 → 123 行 barrel + 15 个 slice，`stores/flow/`）|
//
// **长不是问题，"又长又热"才是问题** —— 长且常改的文件，每次改动都要付导航成本；
// 长但几乎不改的文件（生成物、对照表）不该动。
//
// ## 判据（三层）
//
// 1. **硬限**：未登记 + 超过 `LIMIT` → 红（防止再长出 4,433 行的巨石）
// 2. **优先队列**：`行数 × 提交次数` 排序，前 `QUEUE_TOP` 名里超过 `WARN` 的**必须已登记**
//    —— 把"下一个该拆谁"变成**机器可见**的，而不是靠感觉
// 3. 提示：把队列按分数打出来，供排期（不失败）
//
// ## 诚实的边界
//
// · 提交次数来自 `git log`，**新拆出来的文件会严重低估**（历史留在了原文件上）——
//   可以接受：刚拆完的本来就不是优先项。
// · 没有 git（打包 / 浅克隆）时**降级跳过**第 2 层，不让闸门变得脆弱。
// · `builtinCatalog.ts` 被改 **65 次**却留在"数据"白名单里 —— 说明"是数据所以不用拆"
//   **不完全站得住**。白名单的通病是：一旦登记成"不用管"，就不再重新审视。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const LIMIT = 1200;
const WARN = 800;
const QUEUE_TOP = 8;

/** **数据/声明类**：内容是"表"而不是"逻辑" */
const DATA_FILES: Record<string, string> = {
  'src\\shared\\nodes\\builtinCatalog.ts':
    '声明式节点目录（每节点一条：端口/配置/文案）。**已改 65 次** —— "是数据"解释了它为什么长，' +
    '但没解释它为什么该一直这么长；真到改不动时按节点类别拆（当前接受这个摩擦力）',
  'src\\main\\templates\\builtinTemplates.ts':
    '**模板的流定义表**（按 BotType 组织的示例流程：节点位置/配置/连线）—— 内容是数据不是逻辑，长是因为模板多；拆成多文件只会让「加一个模板要记得登记在哪个文件」变复杂',
  'src\\shared\\nodes\\i18n\\catalog.en-US.ts':
    '节点目录的英文文案表 —— 与节点目录一一对应，按语言放一个整表比按节点散开好维护',
  'src\\renderer\\src\\components\\launch\\dataBrowserData.ts':
    '数据面板的字段映射表（**纯表**）—— 长是因为"字段元信息"本身就多（标签/类型/enum/簇/别名/战斗词典），' +
    '不是结构差。2026-10 已按这条登记原来的提示把**判定逻辑**抽了出去' +
    '（fieldValues / fieldLabels / characterFields；对外入口仍是 dataBrowserConstants.ts 这个 barrel）。' +
    '真要再短，路径是"把 FIELD_ALIASES 那 1360 行别名表变成数据文件 / 由数据模板声明"——那是产品决策，不是拆分',
  'src\\main\\services\\ai\\capabilityCatalog.generated.ts':
    '**由脚本生成的表**（`scripts/gen-capability-catalog.mjs` 从 docs/ai/ai-capability-layering-*.md 生成，' +
    '257 条）。改动它 = 改文档再重新生成，**手拆没有意义**；而且 `capabilityLayering` 闸门逐条盯着' +
    '它与文档一致 —— 真出问题会先在那里红',
  'src\\renderer\\src\\types\\ipc.ts':
    '桥的**声明**（228 个方法签名 + 支持类型）—— 没有运行时逻辑。' +
    '它长是因为**桥大**（228 个方法），不是因为结构差；' +
    '且已有 `ipcSurfaceParity` 闸门盯着它与 preload 一致。真要变短，' +
    '路径是**从单源生成**（而不是手拆）',
};

/** **逻辑类**但当前超限：已登记、**待拆**（顺序 = 优先队列，又长又热在前） */
const BASELINE: Record<string, string> = {
  'src\\renderer\\src\\components\\blocks\\BlockEditor.tsx':
    '**主体已拆完**（2,151 → 1,110 行，−48%）：2026-10-06 分四步抽出 —— 工具栏 → `BlockToolbar.tsx`、' +
    '纯常量 → `blockEditorModel.ts`、store 请求 → `useStoreRequests.ts`、交互回调 → `useEditorActions.tsx`、' +
    'React Flow 桥接 → `useFlowBridge.tsx`（13 输入 / 32 产出，AST 算出来的）。' +
    '剩下的是「状态订阅 + JSX 组装」—— 已从全仓最热掉到队列第 3，**暂不再拆** ✓' +
    '（有 4 条行为级用例盯着：`blockEditorToolbar.test.tsx`）',
  'src\\renderer\\src\\components\\ai\\ChatPanel.tsx':
    '**超 1200 硬限**（1,208 行 / 27 次）：2026-10-15 一整天加了四块 —— 模式条、工具批准条、' +
    '「本轮改动」卡、消息操作行（编辑/重新生成/撤回），于是越线 8 行。' +
    '拆的路径很清楚、而且低风险（都是自包含的 UI 块）：**批准条 → `ApprovalBar.tsx`**、' +
    '**改动卡 → `TurnChangesCard.tsx`**（两块各自只依赖 store 的一两个字段）。' +
    '下次动它时按这条拆，别为 8 行硬拆',
  'src\\renderer\\src\\components\\blocks\\PropertyDrawer.tsx':
    '**主体已拆**（1,529 → 986 行，−36%）：2026-10-06 三步 —— 公式编辑器 → `FormulaEditor.tsx`、' +
    '端口三区 → `PortsSections.tsx`、**配置字段区（398 行，抽屉核心）** → `ConfigFieldsSection.tsx`。' +
    '剩"头部 + 节点信息 + 子流程/键盘/分支等 Section 接线" —— 已从队列头名掉到第 3，**暂不再拆** ✓' +
    '（行为级用例：`propertyDrawer.test.tsx`，含"配置区真的渲染出控件"这条防漏传 props）',
  'src\\main\\services\\runner\\eventBus.ts':
    '待拆（1,462 行 / 31 次）：**协议域已拆完**（actions/*.ts + actionContext + messageContext）；' +
    '剩下的是 dispatch 表 + 还没归域的 action —— 继续拆的收益已经不大，优先级降到最低',
  'src\\main\\runtime\\FlowInterpreter.ts':
    '**已拆完**（1,855 → 964 行）：controlFlow / nodeInputs / nodeEvents 三块已抽出；' +
    '剩下的是解释器主循环本身 —— **不再拆**（再拆就是「为数字而拆」，见 docs/nodes/refactor-plan.md）',
  'src\\main\\services\\ai\\tools\\registry.ts':
    '**超 1200 硬限**（1,239 行 / 待拆）：工具声明 + 实现的分发表。2026-10-10 加了' +
    '`list_node_examples`（示例库查询）后越线。拆的路径已经很清楚：**把各域声明按域拆出去**' +
    '（已有 codegen / capability / template 等 registeredXxxDefinitions 的先例，直接照搬），' +
    'dispatch 表本身保持一处。下次动它时按这条拆',
  'src\\main\\services\\ai\\index.ts':
    '待拆（725 行 / 29 次）：AI 对话的**编排入口**（分轮、跑工具、发提案、落记忆）——' +
    '又长又热，但它是「一根线穿下来」的流程，拆之前得先把每轮的边界用测试钉住' +
    '（chatRun / proposal / tokenBudget 等已在旁边分担了一部分）。当前登记、暂不拆',
  'src\\main\\services\\project\\project.ts':
    '**已拆完一部分**（805 → 525 行）：加解密 → `configSecrets.ts`、official 段读写 → `officialConfigIo.ts`；' +
    '剩下的是「项目目录 + flow.json + ProjectService」，**不再拆**（再拆只能按方法切，属「为数字而拆」）',
  'src\\renderer\\src\\components\\launch\\DataBrowserPanel.tsx':
    '待拆（1,581 行 / 19 次）：数据面板按区块拆',
  'src\\renderer\\src\\components\\canvas\\CanvasNode.tsx':
    '**已拆出一块**（1,209 → 986 行）：纯函数/常量 → `canvasNodeModel.ts`；剩下的是组件本体',
  'src\\renderer\\src\\components\\launch\\TableEditorPopup.tsx':
    '待拆（1,074 行 / 20 次）：表格编辑弹窗，按区块拆',
  'src\\renderer\\src\\stores\\aiStore.ts':
    '待拆（766 行 / 28 次）：又长又热但没过 800 线 —— 对话状态机，拆之前先补测试',
  'src\\main\\services\\builtinNodes\\builtinNodes.ts':
    '待拆（2,881 行）：内置节点的 TypeScript 实现本体 —— 一个 kind 一个 handler，全放在一个文件里。拆的路径清楚：按域拆（消息 / 群管 / 文件 / 数据库 / 时间 / 变量…），每个域一个文件、入口仍是同一张 kind→handler 表。当前登记、暂不拆：handler 之间共享大量小工具（参数解析 / 回复封装），先拆会把它们复制成三份',
  'src\\main\\services\\official.ts':
    '待拆（3,202 行）：QQ 官方机器人协议端 —— API 客户端 + 会话 + 媒体上传 + 流式分片 + 事件分发，一根线穿下来。拆的路径：media / stream / events 三块先出去（各自只有少量跨块状态），剩下的 client + session 保持一处',
  'src\\renderer\\src\\components\\blocks\\BlockView.tsx':
    '待拆（1,243 行）：低代码画布上的节点卡 —— 端口渲染 + 配置摘要 + 内联编辑 + 右键菜单都在这里。拆的路径：端口区 → PortsView、配置摘要 → ConfigSummary、内联编辑 → InlineEditors（各自只依赖 node + spec）',
  'src\\renderer\\src\\lib\\mockRunner.ts':
    '待拆（1,405 行）：前端模拟执行引擎 —— 节点模拟 + 变量推进 + 分支判定。它是给编辑时预览用的第二套解释器，与 runtime 的解释器语义必须一致；拆之前建议先补一条「两边对同一流程结论相同」的用例',
  // 行数会随功能变化（2026-10-15 加了应用后自动校验后约 1560 行）—— 本表按**路径**登记，硬限检查不受行数文案影响。
  'src\\preload\\index.ts':
    '**不拆**（770 行 / 47 次）：preload 的价值就在"**一张平铺的表**"—— 一行一个 IPC 通道，' +
    '拆成多文件后反而看不出"桥上有哪些口"。它长是因为**桥大**，不是因为结构差；' +
    '且已有 \`ipcSurfaceParity\`（与 types/ipc.ts 一致）+ \`ipcReachability\`（主进程注册的都可达）两闸门盯着。' +
    '真要变短，路径是**从单源生成**（而不是手拆）',
  'src\\renderer\\src\\components\\canvas\\NodePalette.tsx':
    '待拆（617 行 / 34 次）：节点库面板 —— 搜索 / 类型过滤 / 分组渲染 / 插件扫描都耦合在同一份状态里。' +
    '2026-10-05 加了「平台过滤 + 类型横幅」又长了 ✗。拆之前先定**渲染契约**（现在只有少量用例护着），' +
    '优先级别排在 BlockEditor 之后',
  'src\\main\\codegen\\generator.ts':
    '待拆（623 行 / 31 次）：又长又热但没过 800 线 —— 代码生成主流程',
  'src\\main\\services\\builtinNodes\\persistentStore.ts':
    '**超 800 警示线**（1,075 行 / 2 次）：玩家库读写 —— 建表 + 旧全局库一次性迁移 + 批量接口。' +
    '拆的路径：迁移段 → `persistentStore.migrate.ts`、批量段 → `persistentStore.bulk.ts`；' +
    '拆之前先给迁移补「旧库存在 / 不存在」两条用例（现有 9 例只覆盖项目作用域）。当前登记、暂不拆',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.dsh-tmp') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** 每个文件被提交过多少次（一次 `git log` 拿全仓；失败返回 null = 降级） */
function churnCounts(): Map<string, number> | null {
  try {
    const out = execFileSync('git', ['log', '--pretty=format:', '--name-only'], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const counts = new Map<string, number>();
    for (const line of out.split('\n')) {
      const p = line.trim();
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return counts;
  } catch {
    return null;
  }
}

describe('文件行数 / 改动频次', () => {
  const files = [
    ...walk(join(ROOT, 'src/main')),
    ...walk(join(ROOT, 'src/renderer')),
    ...walk(join(ROOT, 'src/shared')),
    ...walk(join(ROOT, 'src/preload')),
  ].map((f) => ({ rel: relative(ROOT, f), lines: readFileSync(f, 'utf-8').split('\n').length }));

  const churn = churnCounts();
  const scored = files
    .map((f) => ({ ...f, commits: churn?.get(f.rel.replace(/\\/g, '/')) ?? 0 }))
    .map((f) => ({ ...f, score: f.lines * Math.max(f.commits, 1) }))
    .sort((a, b) => b.score - a.score);

  it('★ 没有"未登记的超长文件"（超限就拆，或登记并写明理由）', () => {
    const offenders = files
      .filter((f) => f.lines > LIMIT && !(f.rel in DATA_FILES) && !(f.rel in BASELINE))
      .map((f) => `${f.rel}  ${f.lines} 行`);

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `这些文件超过 ${LIMIT} 行且没有登记。两种修法：\n` +
            '  ① **拆开它**（首选）\n' +
            '  ② 放进 DATA_FILES（数据表）或 BASELINE（待拆）并**写明理由**\n' +
            offenders.join('\n'),
    ).toEqual([]);
  });

  it('★ 拆分优先队列的前几名必须已登记（把"下一个该拆谁"变成机器可见）', () => {
    if (!churn) {
      console.log('[fileSize] 没有 git 历史，跳过优先队列检查（降级）');
      return;
    }
    /**
     * ⚠️ **硬规则必须有界**：取"全局排名前 N"，**不能**"先滤掉已登记的再取前 N"。
     *
     * 后者是个**永远跑不完的跑步机**：登记了前 3 个，马上又冒出下 3 个，
     * 闸门永远红、人就开始乱登记 —— 那比没有闸门更坏。
     * 中等热度的文件（比如 1,053 行 × 34 次的 `types/ipc.ts`）走**下面那条提示**，
     * 不进硬规则 —— 它们确实值得看一眼，但不该阻断提交。
     */
    const queue = scored
      .filter((f) => f.lines > WARN)
      .slice(0, QUEUE_TOP)
      .filter((f) => !(f.rel in BASELINE) && !(f.rel in DATA_FILES))
      .map((f) => `${f.rel}  ${f.lines} 行 × ${f.commits} 次提交`);

    expect(
      queue,
      queue.length === 0
        ? ''
        : '这些是"**又长又热**"的文件（行数 × 提交次数 排前几名），但既没登记待拆、也没说明是数据：\n  ' +
            queue.join('\n  ') +
            '\n\n要么排进 BASELINE 待拆队列，要么写清楚它为什么是数据。',
    ).toEqual([]);
  });

  it('扫描确实在工作（防止空转）', () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files.some((f) => f.lines > 500)).toBe(true);
  });

  it('白名单/基线里的条目必须真的存在（防止写错路径后失效）', () => {
    const known = new Set(files.map((f) => f.rel));
    const ghost = [...Object.keys(DATA_FILES), ...Object.keys(BASELINE)].filter(
      (k) => !known.has(k),
    );
    expect(ghost, `这些登记项指向不存在的文件（改名了？）：\n  ${ghost.join('\n  ')}`).toEqual([]);
  });

  it('提示：按"行数 × 提交次数"排出的待拆队列（不失败，供排期）', () => {
    const top = scored.filter((f) => f.lines > 400).slice(0, 12);
    console.log('[fileSize] 又长又热 Top 12（行数 × 提交次数）：');
    for (const f of top) {
      const tag = f.rel in DATA_FILES ? '数据' : f.rel in BASELINE ? '待拆' : '★未登记';
      console.log(
        `  ${String(f.lines).padStart(5)} 行 × ${String(f.commits).padStart(2)} 次  ${tag}  ${f.rel}`,
      );
    }
    expect(true).toBe(true);
  });
});
