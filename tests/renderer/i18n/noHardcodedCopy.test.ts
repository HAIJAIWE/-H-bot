// tests/renderer/i18n/noHardcodedCopy.test.ts
//
// 闸门：已双语的目录里不允许再出现硬编码中文界面文案。
//
// ## 为什么要有这条闸门
// 双语文案散在 1000+ 处，靠人眼 review 抓不出漏网的中文；而漏网的表现是
// 「切到 English 后界面上还剩几处中文」，只有真机点一遍才看得见。
// 本批（P4-3 启动页 + 数据管理 + ui 基础件）已经全量迁移完，
// 这条测试把「已迁移」变成可自动校验的事实，后续改动一旦写回中文字面量就会红。
//
// ## 判定规则
// 只扫**字符串字面量**与 **JSX 纯文本**，注释里的中文不算（注释本来就该是中文）。
// 少数确实需要保留中文的地方写进 ALLOW：目前只有开发日志前缀（`[模块名] …`）
// 与 i18n 自身的兜底提示 —— 它们不是界面文案。
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const SCAN_DIRS = [
  'src/renderer/src/components/launch',
  'src/renderer/src/components/ui',
  'src/renderer/src/components/bots',
  'src/renderer/src/components/project',
  // P4-4a：编辑器 / 布局外壳 / 变量面板
  'src/renderer/src/components/editor',
  'src/renderer/src/components/layout',
  'src/renderer/src/components/panels',
  // P4-4b：设置对话框 / AI 面板
  'src/renderer/src/components/settings',
  'src/renderer/src/components/ai',
  // P4-4c：本地测试 / 部署
  // ⚠️ `src/renderer/src/components/debugger`（DebuggerPanel + VariableTree）已于
  // 2026-09-30 整个删除：那是 **Python 时代**的源码调试器（debugpy / DAP 形状），
  // 它调的 `debugger:*` 通道主进程一个都没注册，而 Python 运行时早已按 ADR 移除。
  'src/renderer/src/components/debug',
  'src/renderer/src/components/deploy',
  // P4-5a：画布
  'src/renderer/src/components/canvas',
  // P4-5b：低代码块编辑器 / 属性抽屉 / 各类配置编辑器
  'src/renderer/src/components/blocks',
  // P4-6a：renderer 非组件层（校验消息、分支标签、折平原因、变量说明、片段库文案）
  'src/renderer/src/lib',
  // P4-6b：状态层 / 服务层 / 页面 / hooks
  'src/renderer/src/stores',
  'src/renderer/src/services',
  'src/renderer/src/pages',
  'src/renderer/src/hooks',
];
/** 不属于上面这些目录、但同属已迁移范围的单文件 */
const SCAN_FILES: string[] = [
  // components 根级单文件（不在任何子目录里，SCAN_DIRS 覆盖不到）。
  // 它是错误边界全屏回退 UI，只在崩溃时出现 —— 漏了很难在真机上碰到，
  // 所以必须靠这条闸门守着。
  'src/renderer/src/components/ErrorBoundary.tsx',
];
const CJK = /[\u4e00-\u9fff]/;

/** 允许保留中文的字面量（非界面文案）。新增条目必须说明为什么它不是界面文案。 */
const ALLOW = new Set<string>([
  // 开发日志前缀：只在 DevTools 控制台可见，不进界面
  '[ConfigPanel] refreshCategories 失败:',
  '[DashboardPanel] 保存连接配置失败:',
  '[DashboardPanel] 加载项目配置失败:',
  '[DashboardPanel] 加载仪表盘数据失败:',
  '[DashboardPanel] 加载状态数据失败:',
  '[DashboardPanel] 启动失败:',
  '[DashboardPanel] 停止失败:',
  '[TableEditorPopup] 批量删除失败:',
  '[BotManagerPanel] 重命名失败：',
  '[BotManagerPanel] 删除项目失败：',
  '[BotManagerPanel] 打开文件夹失败：',
  '[BotManagerPanel] 克隆项目失败：',
  '[TopBar] 启动失败:',
  '[TopBar] 停止失败:',
  '[NodePalette] 自定义节点加载失败:',
  '[NodePalette] 插件节点加载失败:',
  '[NodePalette] 文件监听启动失败:',
  '[BlockEditor] 自动布局失败:',
  // ConfigApiPicker 里那段「生成代码预览」是**生成的代码本身**（Python 注释），
  // 必须与 codegen 实际产出一致，翻译了就成了假预览。
  '# 配置 API: ',
  // 主进程 IPC 的契约值：`new Error('用户取消')` 表示用户在文件选择框点了取消，
  // 渲染进程拿它做判断（不是显示），翻译后判断会静默失效。
  '用户取消',
  // 本地测试对话框的**表单默认值**（用户可改，且必须跟用户项目里的中文指令对得上，
  // 属于「用户数据不翻译」那一类）。正常路径下这两个值会被流程里真实存在的
  // 指令覆盖（见 pickDefaultTestCommand）。
  '战斗',
  '你好',
  // NodeSpec['group'] 是**中文常量联合类型**（分组键，参与分组/图标判断），
  // 显示走 getGroupDisplayName()。自定义节点扫描结果回填 group 时必须用字面量，
  // 翻译它会让类型不匹配、也会让分组判断在英文界面下失效。
  'AI 生成',
  '自定义',
  // SubflowTemplate['category'] 的**数据值**（中文常量联合类型），TemplateLibrary 用它
  // 过滤片段、显示走 CATEGORY_LABEL；翻译会让过滤在英文界面下失效。
  '数据读写',
  '消息回复',
  '流程控制',
  '游戏逻辑',
  '时间工具',
  // i18n 自身的开发者错误提示（只在写错 hook 用法时抛出）
  'useToast 必须在 <ToastProvider> 内部使用',

  // ===== P4-6a：lib 里的数据值（不是界面文案）=====
  // NodeSpec['group'] 的**分组键**（GROUP_ORDER 用它排序、NodePalette 用它选图标），
  // 显示一律走 getGroupDisplayName()（field.label 那套 i18n 表），所以这里是数据。
  '触发器',
  '消息',
  '动作',
  '存储',
  '数据',
  '计算',
  '判断',
  '文本',
  '上下文',
  '控制流',
  // configQueryChain 生成并写进用户 flow.json 的**节点标题**（用户可改），属用户数据。
  '取参数',
  '回复',
  // subflowTemplates 的 starter 内容：插入片段时被复制进用户 flow.json 的节点配置，
  // 用户可任意修改（同「战斗」「你好」那类表单默认值），按判据「能改的就是数据」不翻译。
  '你好，{name}！',
  '{"name":"朋友"}',
  '你的QQ是{var1}',
  '["在的","你好呀","怎么啦"]',
  '✅ 操作成功！',
  '⏳ 冷却中，请稍后再试！',
  '签到成功！当前经验：{var1}',
  '剩余血量：{var1}',
  '🎒 你的背包：{var1}',
  '新手剑',
  '✅ 已获得新物品！当前背包：{var1}',
  '✅ 购买成功！剩余金币：{var1}',
  '❌ 金币不足，需要 100 金币！',
  '✅ 任务已接取！',
  '❌ 等级不足，需达到 5 级！',
  '⚔️ 造成伤害：{var1}',
  '🌟 修炼成功！当前经验：{var1}',
  '🎉 抽到：{var1}',
  '🏆 排行榜：\n{var1}',

  // ===== P4-6b：stores 里的 console 开发者日志（只在 DevTools 可见，不进界面）=====
  // 判据：这些串只作为 console.* 的第一个参数出现（排查用），没有任何界面读取它们。
  // 保持中文是刻意的 —— 开发者日志跟着代码注释走，不跟界面语言走。
  '[flowStore] 撤销历史快照含不可克隆内容，已降级为 JSON 深拷贝:',
  '[flowStore] 已阻止保存：当前项目的 flow.json 加载失败，不能用空画布覆盖原文件',
  '保存 flow.json 失败:',
  '保存 flow.json 异常:',
  '代码生成失败:',
  '代码生成异常:',
  '[importTemplate] 子集自动布局失败:',
  '[relayoutNodes] 子图布局失败:',
  '[aiStore] AI 生成自动布局失败:',
  '[beginBatch] IPC 调用失败，未进入 batch 模式',
  '[commitBatch] IPC 调用失败',
  '[rollbackBatch] IPC 调用失败',
  'proposal 流程操作失败，已回滚',
  'proposal 磁盘操作失败：未打开项目',
  'proposal 磁盘操作失败，已回滚',
  'instruction 失败',
  '[debugStore] startDebug IPC 异常:',
  '[debugStore] startDebug 失败:',
  // ErrorBoundary 的崩溃上报日志（console，只在 DevTools 可见）
  '[ErrorBoundary] 崩溃上报失败:',
  '[ErrorBoundary] 崩溃上报异常:',
  '[ErrorBoundary] 渲染异常:',
  '[ErrorBoundary] 错误已复制到剪贴板',
  '[ErrorBoundary] 复制失败',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * 一段扫描范围 → 实际要读的文件列表。
 *
 * ⚠️ 这里**不再 statSync 就假定存在**：一个过期路径会让 statSync 抛错，
 * 而它在模块顶层跑 —— 结果整份闸门 0 用例运行、却显示"通过"的空壳。
 * 现在缺失路径由 `missingScanTargets()` 单独报，其余检查照常跑。
 */
function targetsOf(rel: string): string[] {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) return [];
  return statSync(abs).isDirectory() ? walk(abs) : [abs];
}

/** 配置里写了、但磁盘上不存在的扫描范围（单独一条用例负责报出来） */
function missingScanTargets(): string[] {
  return [...SCAN_DIRS, ...SCAN_FILES].filter((rel) => !existsSync(resolve(ROOT, rel)));
}

interface Hit {
  where: string;
  text: string;
}

const hits: Hit[] = [];

function scanFile(file: string): void {
  const src = readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const short = file.slice(ROOT.length + 1).replace(/\\/g, '/');
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      // 类型位置的字面量不是界面文案：`category: '数据读写' | '消息回复'` 是类型联合，
      // 描述数据值的合法取值（数据不翻译），不该按硬编码文案报错。
      if (ts.isLiteralTypeNode(parent)) return;
      const isPropName =
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        ts.isEnumMember(parent);
      if (!isPropName && CJK.test(node.text) && !ALLOW.has(node.text)) {
        hits.push({ where: `${short}:${line}`, text: node.text });
      }
    } else if (ts.isJsxText(node) && CJK.test(node.text)) {
      hits.push({ where: `${short}:${line}`, text: node.text.replace(/\s+/g, ' ').trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const rel of [...SCAN_DIRS, ...SCAN_FILES]) {
  for (const file of targetsOf(rel)) scanFile(file);
}

/**
 * ## 恢复期基线（2026-10-23）
 *
 * 10/18 这个构建里，上面这些目录**还在大量硬编码中文** —— i18n 全量迁移是更晚的 revision
 * 做的事（磁带里只有 `read`/`edit` 的局部片段，无法逐条重放）。所以这里不能直接
 * 断言"零命中"：那会让闸门永久红，最后没人看它。
 *
 * 口径改成和 `file-size-baseline.json` 同一个形状：**登记现状、只报新增**。
 *   · 每条用例红 = 你在已迁移目录里**新写**了中文字面量（真回归）；
 *   · 基线里某文件降到 0 → 提示从基线删掉（防僵尸条目）；
 *   · 迁移完成（基线为空）后，这条闸门自然变成"零硬编码"。
 * 重新生成：`QQBAT_UPDATE_I18N_BASELINE=1 node node_modules/vitest/vitest.mjs run … noHardcodedCopy`
 */
const BASELINE_PATH = resolve(__dirname, 'noHardcodedCopy-baseline.json');
const baseline: Record<string, number> = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Record<string, number>)
  : {};

/** 每个文件的命中数（where 形如 `路径:行号`，取最后一个冒号前的部分） */
const countByFile = new Map<string, number>();
for (const h of hits) {
  const file = h.where.slice(0, h.where.lastIndexOf(':'));
  countByFile.set(file, (countByFile.get(file) ?? 0) + 1);
}

if (process.env.QQBAT_UPDATE_I18N_BASELINE === '1') {
  const sorted = Object.fromEntries([...countByFile.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`[noHardcodedCopy] 基线已重写：${Object.keys(sorted).length} 个文件 / ${hits.length} 处`);
}

describe('已双语目录不允许硬编码中文界面文案', () => {
  it('已登记的文件不许再多出中文文案（只报新增）', () => {
    const regressions = [...countByFile.entries()]
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => {
        const samples = hits
          .filter((h) => h.where.startsWith(file + ':'))
          .slice(0, 5)
          .map((h) => `${h.where}  ${JSON.stringify(h.text)}`);
        return `${file}: ${baseline[file] ?? 0} → ${n}\n    ${samples.join('\n    ')}`;
      });
    expect(regressions).toEqual([]);
  });

  it('基线不许有幽灵（已经没命中的文件要从基线里删掉）', () => {
    const zombies = Object.keys(baseline).filter((file) => !countByFile.has(file));
    expect(zombies).toEqual([]);
  });

  it('扫描范围非空（防止路径写错导致测试空转通过）', () => {
    const files = [...SCAN_DIRS, ...SCAN_FILES].flatMap((d) => targetsOf(d));
    expect(files.length).toBeGreaterThan(30);
  });

  it('配置里列出的路径都真实存在（被删了就报出来，而不是让整份闸门崩掉）', () => {
    // 这条用例存在的唯一原因就是上面那次事故：一个过期路径让整个文件 0 用例运行。
    // 现在过期路径只会让**这一条**红，其余检查照常跑，信息不再丢失。
    expect(
      missingScanTargets().map((p) => `${p}（不存在：要么它被删了请从列表移除，要么路径写错了）`),
    ).toEqual([]);
  });
});
